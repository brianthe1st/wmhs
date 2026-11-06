const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireTeacher } = require('../middleware/auth');
const { validate, uuidParams, isUuid, paging } = require('../middleware/validate');
const { materialUpload, runUpload, withFileType, removeStoredFile } = require('../middleware/upload');
const { now } = require('../utils/serverTime');
const { currentYear } = require('../utils/years');
const { visibleAnnouncement, addReply } = require('../utils/access');
const { toCSV } = require('../utils/csv');

const router = express.Router();
router.use(authenticate, requireTeacher);
uuidParams(router, 'id', 'workItemId', 'moduleId');

// ── Ownership helpers ─────────────────────────────────────────────────────────
async function ownsModule(teacherId, moduleId) {
  const { rows } = await pool.query('SELECT id FROM modules WHERE id=$1 AND teacher_id=$2', [moduleId, teacherId]);
  return rows.length > 0;
}
// Returns the work item if this teacher teaches its module (admin may read any).
async function accessibleWorkItem(user, workItemId) {
  const { rows } = await pool.query(
    `SELECT w.id, w.module_id, w.class_id, w.type, w.year_id, w.max_score, m.teacher_id
       FROM work_items w JOIN modules m ON m.id = w.module_id WHERE w.id=$1`, [workItemId]);
  const w = rows[0];
  if (!w) return null;
  if (user.role === 'admin' || w.teacher_id === user.id) return w;
  return null;
}
// ?year=all | <uuid> | (default: current year)
async function resolveYear(req) {
  const cur = await currentYear();
  const q = req.query.year;
  if (q === 'all') return { all: true, current: cur };
  if (isUuid(q)) return { id: q, current: cur };
  return { id: cur ? cur.id : null, current: cur };
}

const optDate = (f) => body(f).optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage(`${f} must be a valid date.`);

// ── MY MODULES ─────────────────────────────────────────────────────────────────
router.get('/modules', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, c.name AS class_name, c.level, c.stream,
             COUNT(DISTINCT u.id) AS student_count
      FROM   modules m
      JOIN   classes c ON c.id = m.class_id
      LEFT JOIN users u ON u.class_id = c.id AND u.role='student' AND u.status='active'
      WHERE  m.teacher_id = $1
      GROUP  BY m.id, c.id
      ORDER  BY c.level, c.stream, m.name
    `, [req.user.id]);
    res.json({ modules: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch modules.' });
  }
});

// ── WORK ITEMS ─────────────────────────────────────────────────────────────────

// GET /api/teacher/work-items?year=all|<id>   (default: current academic year)
router.get('/work-items', async (req, res) => {
  try {
    const y = await resolveYear(req);
    const params = [req.user.id];
    let yearClause = '';
    if (!y.all) { params.push(y.id); yearClause = 'AND w.year_id = $2'; }
    const { rows } = await pool.query(`
      SELECT w.*, m.name AS module_name, c.name AS class_name,
             COUNT(DISTINCT s.id) AS submission_count
      FROM   work_items w
      JOIN   modules m   ON m.id = w.module_id
      JOIN   classes c   ON c.id = w.class_id
      LEFT JOIN submissions s ON s.work_item_id = w.id
      WHERE  m.teacher_id = $1 ${yearClause}
      GROUP  BY w.id, m.name, c.name
      ORDER  BY w.created_at DESC
      LIMIT  500
    `, params);
    res.json({ workItems: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch work items.' });
  }
});

// POST /api/teacher/work-items
router.post('/work-items',
  [
    body('moduleId').isUUID().withMessage('Valid moduleId required.'),
    body('type').isIn(['assignment','quiz']).withMessage('Type must be assignment or quiz.'),
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Title required (2–200 chars).'),
    body('instructions').optional({ nullable: true }).isLength({ max: 5000 }).withMessage('Instructions too long (max 5000).'),
    body('maxScore').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 1000 }).withMessage('maxScore must be 1–1000.'),
    optDate('deadline'), optDate('openAt'), optDate('closeAt'),
  ],
  validate,
  async (req, res) => {
    try {
      const { moduleId, type, title, instructions, deadline, openAt, closeAt, maxScore } = req.body;
      if (!await ownsModule(req.user.id, moduleId)) {
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      if (openAt && closeAt && new Date(closeAt) <= new Date(openAt)) {
        return res.status(422).json({ error: 'Closing time must be after opening time.' });
      }
      const [{ rows: modRows }, year] = await Promise.all([
        pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]),
        currentYear(),
      ]);
      const { rows } = await pool.query(
        `INSERT INTO work_items
           (module_id, class_id, type, title, instructions, max_score, deadline, open_at, close_at, created_by, created_at, year_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [moduleId, modRows[0].class_id, type, title, instructions || null,
         maxScore || 20, deadline || null, openAt || null, closeAt || null, req.user.id, now(), year ? year.id : null]
      );
      res.status(201).json({ workItem: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not create work item.' });
    }
  }
);

// PATCH /api/teacher/work-items/:id   (edit title, instructions, dates, max score)
router.patch('/work-items/:id',
  [
    body('title').optional().trim().isLength({ min: 2, max: 200 }).withMessage('Title required (2–200 chars).'),
    body('instructions').optional({ nullable: true }).isLength({ max: 5000 }).withMessage('Instructions too long (max 5000).'),
    body('maxScore').optional().isInt({ min: 1, max: 1000 }).withMessage('maxScore must be 1–1000.'),
    optDate('deadline'), optDate('openAt'), optDate('closeAt'),
  ],
  validate,
  async (req, res) => {
    try {
      const w = await accessibleWorkItem(req.user, req.params.id);
      if (!w || w.teacher_id !== req.user.id) return res.status(404).json({ error: 'Work item not found or not yours.' });
      const year = await currentYear();
      if (year && w.year_id !== year.id) return res.status(403).json({ error: 'Work from a past academic year is read-only.' });

      const b = req.body;

      // Check the resulting window BEFORE saving anything.
      const { rows: cur } = await pool.query('SELECT open_at, close_at FROM work_items WHERE id=$1', [w.id]);
      const nextOpen  = 'openAt'  in b ? (b.openAt  || null) : cur[0].open_at;
      const nextClose = 'closeAt' in b ? (b.closeAt || null) : cur[0].close_at;
      if (nextOpen && nextClose && new Date(nextClose) <= new Date(nextOpen)) {
        return res.status(422).json({ error: 'Closing time must be after opening time.' });
      }

      const sets = [], vals = [];
      const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
      if (b.title !== undefined)        add('title', b.title);
      if (b.instructions !== undefined) add('instructions', b.instructions || null);
      if ('deadline' in b)              add('deadline', b.deadline || null);
      if ('openAt' in b)                add('open_at', b.openAt || null);
      if ('closeAt' in b)               add('close_at', b.closeAt || null);
      if (b.maxScore !== undefined && w.type === 'assignment') {
        const { rows: mx } = await pool.query('SELECT MAX(score) AS m FROM submissions WHERE work_item_id=$1', [w.id]);
        if (mx[0].m !== null && Number(mx[0].m) > Number(b.maxScore)) {
          return res.status(400).json({ error: `Some students already scored ${mx[0].m}. Max score cannot be lower than that.` });
        }
        add('max_score', parseInt(b.maxScore, 10));
      }
      if (sets.length === 0) return res.status(422).json({ error: 'Nothing to change.' });

      vals.push(w.id);
      const { rows } = await pool.query(`UPDATE work_items SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
      if (b.maxScore !== undefined && w.type === 'assignment') {
        await pool.query('UPDATE submissions SET max_score=$1 WHERE work_item_id=$2', [rows[0].max_score, w.id]);
      }
      res.json({ workItem: rows[0] });
    } catch (err) {
      console.error('Edit work item error:', err.message);
      res.status(500).json({ error: 'Could not update work item.' });
    }
  }
);

// DELETE /api/teacher/work-items/:id
router.delete('/work-items/:id', async (req, res) => {
  try {
    const w = await accessibleWorkItem(req.user, req.params.id);
    if (!w || w.teacher_id !== req.user.id) return res.status(404).json({ error: 'Work item not found or not yours.' });
    // delete files attached to the submissions being removed
    const { rows: files } = await pool.query('SELECT file_url FROM submissions WHERE work_item_id=$1 AND file_url IS NOT NULL', [w.id]);
    await pool.query('DELETE FROM work_items WHERE id=$1', [w.id]);
    files.forEach(f => removeStoredFile(f.file_url));
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete work item.' });
  }
});

// ── QUESTIONS ──────────────────────────────────────────────────────────────────

// GET /api/teacher/questions/:workItemId  (includes the answer key → owner only)
router.get('/questions/:workItemId', async (req, res) => {
  try {
    if (!await accessibleWorkItem(req.user, req.params.workItemId)) {
      return res.status(403).json({ error: 'Not yours.' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM questions WHERE work_item_id=$1 ORDER BY order_index', [req.params.workItemId]);
    res.json({ questions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// POST /api/teacher/questions/:workItemId  (replace all questions)
router.post('/questions/:workItemId',
  [
    body('questions').isArray({ min: 1, max: 100 }).withMessage('Add between 1 and 100 questions.'),
    body('questions.*.questionText').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Every question needs text (max 1000 chars).'),
    body('questions.*.options').isArray({ min: 2, max: 6 }).withMessage('Every question needs 2–6 options.'),
    body('questions.*.options.*').isString().trim().isLength({ min: 1, max: 300 }).withMessage('Options cannot be empty (max 300 chars).'),
    body('questions.*.correctOption').isInt({ min: 0, max: 5 }).withMessage('Choose the correct option.'),
  ],
  validate,
  async (req, res) => {
    const qsIn = req.body.questions;
    if (qsIn.some(q => parseInt(q.correctOption, 10) >= q.options.length)) {
      return res.status(422).json({ error: 'The correct option must be one of the listed options.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: wi } = await client.query(
        `SELECT w.id, w.type FROM work_items w JOIN modules m ON m.id=w.module_id
          WHERE w.id=$1 AND m.teacher_id=$2`, [req.params.workItemId, req.user.id]);
      if (wi.length === 0) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not yours.' }); }
      if (wi[0].type !== 'quiz') { await client.query('ROLLBACK'); return res.status(422).json({ error: 'Only quizzes have questions.' }); }
      const { rows: subs } = await client.query('SELECT 1 FROM submissions WHERE work_item_id=$1 LIMIT 1', [req.params.workItemId]);
      if (subs.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Students have already submitted this quiz, so its questions can no longer change.' });
      }
      await client.query('DELETE FROM questions WHERE work_item_id=$1', [req.params.workItemId]);
      const saved = [];
      for (let i = 0; i < qsIn.length; i++) {
        const q = qsIn[i];
        const { rows } = await client.query(
          `INSERT INTO questions (work_item_id, question_text, options, correct_option, order_index)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.params.workItemId, q.questionText, JSON.stringify(q.options), parseInt(q.correctOption, 10), i]
        );
        saved.push(rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ questions: saved });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: 'Could not save questions.' });
    } finally {
      client.release();
    }
  }
);

// ── SUBMISSIONS / GRADING ──────────────────────────────────────────────────────

// GET /api/teacher/submissions?workItemId=&year=&limit=&offset=
router.get('/submissions', async (req, res) => {
  try {
    const { workItemId } = req.query;
    if (workItemId !== undefined && !isUuid(workItemId)) return res.status(400).json({ error: 'Invalid workItemId.' });
    const { limit, offset } = paging(req, 300, 1000);
    const y = await resolveYear(req);

    const params = [req.user.id];
    let where = 'WHERE m.teacher_id = $1';
    if (workItemId) { params.push(workItemId); where += ` AND s.work_item_id=$${params.length}`; }
    if (!y.all)     { params.push(y.id);        where += ` AND w.year_id=$${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(`
      SELECT s.id, s.work_item_id, s.student_id, s.content, s.submitted_at, s.score, s.max_score,
             s.tag, s.feedback, s.graded_by, s.graded_at, s.duplicate_flag, s.is_late,
             s.file_name, s.file_type, s.file_size,
             u.name AS student_name, u.email AS student_email,
             w.title AS work_title, w.type AS work_type, c.name AS class_name
      FROM   submissions s
      JOIN   users u      ON u.id = s.student_id
      JOIN   work_items w ON w.id = s.work_item_id
      JOIN   modules m    ON m.id = w.module_id
      JOIN   classes c    ON c.id = w.class_id
      ${where}
      ORDER  BY s.submitted_at DESC
      LIMIT  $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ submissions: rows, limit, offset, hasMore: rows.length === limit });
  } catch (err) {
    console.error('List submissions error:', err.message);
    res.status(500).json({ error: 'Could not fetch submissions.' });
  }
});

// PATCH /api/teacher/submissions/:id/grade   (score + optional tag + written feedback)
router.patch('/submissions/:id/grade',
  [
    body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer.'),
    body('tag').optional({ nullable: true }).isIn(['Incomplete','Wrong format','Missing parts','']).withMessage('Invalid tag.'),
    body('feedback').optional({ nullable: true }).isLength({ max: 2000 }).withMessage('Feedback is too long (max 2000 characters).'),
  ],
  validate,
  async (req, res) => {
    try {
      const { score, tag, feedback } = req.body;
      const { rows: check } = await pool.query(
        `SELECT s.id, s.max_score FROM submissions s
         JOIN work_items w ON w.id=s.work_item_id
         JOIN modules m ON m.id=w.module_id
         WHERE s.id=$1 AND m.teacher_id=$2`,
        [req.params.id, req.user.id]
      );
      if (check.length === 0) return res.status(403).json({ error: 'Submission not found or not yours.' });
      if (score > check[0].max_score) {
        return res.status(400).json({ error: `Score cannot exceed max (${check[0].max_score}).` });
      }
      const { rows } = await pool.query(
        `UPDATE submissions
         SET score=$1, tag=$2, feedback=$3, graded_by=$4, graded_at=$5
         WHERE id=$6
         RETURNING id, work_item_id, student_id, score, max_score, tag, feedback, graded_by, graded_at`,
        [score, tag || null, (feedback || '').trim() || null, req.user.id, now(), req.params.id]
      );
      res.json({ submission: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not grade submission.' });
    }
  }
);

// ── MATERIALS ──────────────────────────────────────────────────────────────────

router.get('/materials', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mat.id, mat.module_id, mat.class_id, mat.title, mat.file_name, mat.file_type,
             mat.file_size, mat.uploaded_at, m.name AS module_name, c.name AS class_name
      FROM   materials mat
      JOIN   modules m ON m.id=mat.module_id
      JOIN   classes c ON c.id=mat.class_id
      WHERE  m.teacher_id=$1
      ORDER  BY mat.uploaded_at DESC
      LIMIT  1000
    `, [req.user.id]);
    res.json({ materials: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch materials.' });
  }
});

// POST /api/teacher/materials  (multipart/form-data)
router.post('/materials',
  runUpload(materialUpload),
  withFileType,
  async (req, res) => {
    const discard = () => { if (req.file) removeStoredFile(req.file.fileUrl); };
    try {
      if (!req.file) return res.status(400).json({ error: 'File is required.' });
      const moduleId = req.body.moduleId;
      const title = (req.body.title || '').trim();
      if (!isUuid(moduleId) || title.length < 1 || title.length > 200) {
        discard();
        return res.status(400).json({ error: 'A valid module and a title (max 200 characters) are required.' });
      }
      if (!await ownsModule(req.user.id, moduleId)) {
        discard();
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      const { rows: modRows } = await pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]);
      const { rows } = await pool.query(
        `INSERT INTO materials
            (module_id, class_id, title, file_url, file_name, file_type, file_size, uploaded_by, uploaded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING id, module_id, class_id, title, file_name, file_type, file_size, uploaded_at`,
        [moduleId, modRows[0].class_id, title, req.file.fileUrl, req.file.originalname.slice(0, 255),
         req.file.fileType, req.file.size, req.user.id, now()]
      );
      res.status(201).json({ material: rows[0] });
    } catch (err) {
      discard();
      console.error('Materials upload error:', err.message);
      res.status(500).json({ error: 'Could not save material.' });
    }
  }
);

// PATCH /api/teacher/materials/:id  (rename)
router.patch('/materials/:id',
  [body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title required (max 200 chars).')],
  validate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE materials mat SET title=$1
           FROM modules m
          WHERE mat.id=$2 AND m.id=mat.module_id AND m.teacher_id=$3
          RETURNING mat.id, mat.title`,
        [req.body.title, req.params.id, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Material not found or not yours.' });
      res.json({ material: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not rename material.' });
    }
  }
);

// DELETE /api/teacher/materials/:id
router.delete('/materials/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mat.id, mat.file_url FROM materials mat
       JOIN modules m ON m.id=mat.module_id
       WHERE mat.id=$1 AND m.teacher_id=$2`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found or not yours.' });
    await pool.query('DELETE FROM materials WHERE id=$1', [req.params.id]);
    removeStoredFile(rows[0].file_url);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete material.' });
  }
});

// ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────────

router.get('/announcements', async (req, res) => {
  try {
    const year = await currentYear();
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role,
             m.name AS module_name, c.name AS class_name
      FROM   announcements a
      LEFT JOIN users u ON u.id=a.posted_by
      LEFT JOIN modules m ON m.id=a.module_id
      LEFT JOIN classes c ON c.id=a.class_id
      WHERE  a.year_id = $2
        AND  (a.scope='school' OR (a.scope='module' AND m.teacher_id=$1))
      ORDER  BY a.created_at DESC
      LIMIT  100
    `, [req.user.id, year ? year.id : null]);
    const ids = rows.map(a => a.id);
    let replies = [];
    if (ids.length) {
      ({ rows: replies } = await pool.query(
        `SELECT r.id, r.announcement_id, r.body, r.created_at, r.author_role,
                u.name AS author_name, u.name AS student_name
           FROM replies r JOIN users u ON u.id=r.student_id
          WHERE r.announcement_id = ANY($1) ORDER BY r.created_at ASC`, [ids]));
    }
    res.json({ announcements: rows, replies });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch announcements.' });
  }
});

router.post('/announcements',
  [
    body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Message required (max 5000 characters).'),
    body('moduleId').isUUID().withMessage('Valid moduleId required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { body: msgBody, moduleId } = req.body;
      if (!await ownsModule(req.user.id, moduleId)) {
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      const [{ rows: modRows }, year] = await Promise.all([
        pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]), currentYear(),
      ]);
      const { rows } = await pool.query(
        `INSERT INTO announcements (posted_by, scope, module_id, class_id, body, created_at, year_id)
         VALUES ($1,'module',$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.id, moduleId, modRows[0].class_id, msgBody, now(), year ? year.id : null]
      );
      res.status(201).json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not post announcement.' });
    }
  }
);

// PATCH /api/teacher/announcements/:id  (edit your own module announcement)
router.patch('/announcements/:id',
  [body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Message required (max 5000 characters).')],
  validate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE announcements a SET body=$1
           FROM modules m
          WHERE a.id=$2 AND a.scope='module' AND m.id=a.module_id AND m.teacher_id=$3
          RETURNING a.*`,
        [req.body.body, req.params.id, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found or not yours.' });
      res.json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not update announcement.' });
    }
  }
);

router.delete('/announcements/:id', async (req, res) => {
  try {
    const { rows: annRows } = await pool.query(
      `SELECT a.id FROM announcements a
       LEFT JOIN modules m ON m.id=a.module_id
       WHERE a.id=$1 AND a.scope='module' AND (a.posted_by=$2 OR m.teacher_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (annRows.length === 0) return res.status(404).json({ error: 'Not found or not yours.' });
    await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete announcement.' });
  }
});

// POST /api/teacher/announcements/:id/replies  (teacher answers students)
router.post('/announcements/:id/replies',
  [body('body').trim().isLength({ min: 1, max: 1000 }).withMessage('Reply must be 1–1000 characters.')],
  validate,
  async (req, res) => {
    try {
      if (!await visibleAnnouncement(req.user, req.params.id)) {
        return res.status(404).json({ error: 'Announcement not found.' });
      }
      res.status(201).json({ reply: await addReply(req.user, req.params.id, req.body.body) });
    } catch (err) {
      res.status(500).json({ error: 'Could not post reply.' });
    }
  }
);

// ── REPORTS ────────────────────────────────────────────────────────────────────
async function buildReport(moduleId, req) {
  const { rows: [mod] } = await pool.query(
    `SELECT m.id, m.name, m.class_id, c.name AS class_name
       FROM modules m JOIN classes c ON c.id=m.class_id WHERE m.id=$1`, [moduleId]);
  const y = await resolveYear(req);
  const yearParam = y.all ? [] : [y.id];
  const yw = y.all ? '' : ' AND w.year_id = $2';

  const { rows: workItems } = await pool.query(
    `SELECT w.id, w.title, w.type, w.max_score, w.year_id FROM work_items w
      WHERE w.module_id=$1${yw} ORDER BY w.created_at`, [moduleId, ...yearParam]);
  const { rows: subs } = await pool.query(
    `SELECT s.id, s.work_item_id, s.student_id, s.score, s.max_score, s.tag, s.is_late, s.feedback
       FROM submissions s JOIN work_items w ON w.id=s.work_item_id
      WHERE w.module_id=$1${yw}`, [moduleId, ...yearParam]);

  // Current class (only when looking at the current year) plus anyone who actually has work in the report.
  const includeClass = y.all || (y.current && y.id === y.current.id);
  const { rows: students } = await pool.query(
    `SELECT u.id, u.name, u.email FROM users u
      WHERE u.role='student'
        AND ( ($1::boolean AND u.class_id=$2 AND u.status='active')
              OR u.id IN (SELECT s.student_id FROM submissions s JOIN work_items w ON w.id=s.work_item_id
                           WHERE w.module_id=$3${y.all ? '' : ' AND w.year_id=$4'}) )
      ORDER BY u.name`,
    [includeClass, mod.class_id, moduleId, ...(y.all ? [] : [y.id])]);

  let yearName = 'All years';
  if (!y.all && y.id) {
    const { rows: yr } = await pool.query('SELECT name FROM academic_years WHERE id=$1', [y.id]);
    yearName = yr[0] ? yr[0].name : '';
  }
  return { module: mod, yearName, students, workItems, submissions: subs };
}

router.get('/reports/:moduleId', async (req, res) => {
  try {
    if (!await ownsModule(req.user.id, req.params.moduleId)) return res.status(403).json({ error: 'Not your module.' });
    const r = await buildReport(req.params.moduleId, req);
    res.json({ students: r.students, workItems: r.workItems, submissions: r.submissions, yearName: r.yearName });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: 'Could not fetch report.' });
  }
});

// GET /api/teacher/reports/:moduleId/export  → CSV gradebook (opens in Excel)
router.get('/reports/:moduleId/export', async (req, res) => {
  try {
    if (!await ownsModule(req.user.id, req.params.moduleId)) return res.status(403).json({ error: 'Not your module.' });
    const r = await buildReport(req.params.moduleId, req);
    const header = ['Student', 'Email', ...r.workItems.map(w => `${w.title} (out of ${w.max_score})`), 'Average %'];
    const rows = r.students.map(st => {
      const cells = r.workItems.map(w => {
        const s = r.submissions.find(x => x.student_id === st.id && x.work_item_id === w.id);
        if (!s) return '';
        return s.score === null ? 'Pending' : s.score;
      });
      const graded = r.workItems
        .map(w => r.submissions.find(x => x.student_id === st.id && x.work_item_id === w.id))
        .filter(s => s && s.score !== null && s.max_score > 0);
      const avg = graded.length ? (graded.reduce((a, s) => a + s.score / s.max_score, 0) / graded.length * 100).toFixed(1) : '';
      return [st.name, st.email, ...cells, avg];
    });
    const safe = `${r.module.class_name}-${r.module.name}-${r.yearName}`.replace(/[^A-Za-z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
    res.send('﻿' + toCSV([header, ...rows]));   // BOM so Excel reads accents correctly
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Could not export report.' });
  }
});

module.exports = router;

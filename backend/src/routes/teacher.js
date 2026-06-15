const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireTeacher } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { upload, withFileType } = require('../middleware/upload');
const { now } = require('../utils/serverTime');

const router = express.Router();
router.use(authenticate, requireTeacher);

// ── GUARD: ensure teacher owns the module ─────────────────────────────────────
async function ownsModule(teacherId, moduleId) {
  const { rows } = await pool.query(
    "SELECT id FROM modules WHERE id=$1 AND teacher_id=$2",
    [moduleId, teacherId]
  );
  return rows.length > 0;
}

// ── MY MODULES ─────────────────────────────────────────────────────────────────
router.get('/modules', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, c.name AS class_name, c.level, c.stream,
             COUNT(DISTINCT u.id) AS student_count
      FROM   modules m
      JOIN   classes c ON c.id = m.class_id
      LEFT JOIN users u ON u.class_id = c.id AND u.role='student'
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

// GET /api/teacher/work-items
router.get('/work-items', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.*, m.name AS module_name, c.name AS class_name,
             COUNT(DISTINCT s.id) AS submission_count
      FROM   work_items w
      JOIN   modules m   ON m.id = w.module_id
      JOIN   classes c   ON c.id = w.class_id
      LEFT JOIN submissions s ON s.work_item_id = w.id
      WHERE  m.teacher_id = $1
      GROUP  BY w.id, m.name, c.name
      ORDER  BY w.created_at DESC
    `, [req.user.id]);
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
    body('maxScore').optional().isInt({ min: 1 }).withMessage('maxScore must be positive integer.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { moduleId, type, title, instructions, deadline, openAt, closeAt, maxScore } = req.body;
      if (!await ownsModule(req.user.id, moduleId)) {
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      const { rows: modRows } = await pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]);
      const classId = modRows[0].class_id;

      const { rows } = await pool.query(
        `INSERT INTO work_items
           (module_id, class_id, type, title, instructions, max_score, deadline, open_at, close_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [moduleId, classId, type, title, instructions || null,
         maxScore || 20, deadline || null, openAt || null, closeAt || null, req.user.id, now()]
      );
      res.status(201).json({ workItem: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not create work item.' });
    }
  }
);

// DELETE /api/teacher/work-items/:id
router.delete('/work-items/:id', async (req, res) => {
  try {
    const { rows: wiRows } = await pool.query(
      'SELECT w.* FROM work_items w JOIN modules m ON m.id=w.module_id WHERE w.id=$1 AND m.teacher_id=$2',
      [req.params.id, req.user.id]
    );
    if (wiRows.length === 0) return res.status(404).json({ error: 'Work item not found or not yours.' });
    await pool.query('DELETE FROM work_items WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete work item.' });
  }
});

// ── QUESTIONS ──────────────────────────────────────────────────────────────────

// GET /api/teacher/questions/:workItemId
router.get('/questions/:workItemId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM questions WHERE work_item_id=$1 ORDER BY order_index',
      [req.params.workItemId]
    );
    res.json({ questions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// POST /api/teacher/questions/:workItemId  (replace all questions)
router.post('/questions/:workItemId',
  [body('questions').isArray({ min: 1 }).withMessage('Questions array required.')],
  validate,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verify ownership
      const { rows: wi } = await client.query(
        'SELECT w.id FROM work_items w JOIN modules m ON m.id=w.module_id WHERE w.id=$1 AND m.teacher_id=$2',
        [req.params.workItemId, req.user.id]
      );
      if (wi.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not yours.' });
      }
      // Replace
      await client.query('DELETE FROM questions WHERE work_item_id=$1', [req.params.workItemId]);
      const saved = [];
      for (let i = 0; i < req.body.questions.length; i++) {
        const q = req.body.questions[i];
        const { rows } = await client.query(
          `INSERT INTO questions (work_item_id, question_text, options, correct_option, order_index)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.params.workItemId, q.questionText, JSON.stringify(q.options), q.correctOption, i]
        );
        saved.push(rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ questions: saved });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Could not save questions.' });
    } finally {
      client.release();
    }
  }
);

// ── SUBMISSIONS / GRADING ──────────────────────────────────────────────────────

// GET /api/teacher/submissions?workItemId=xxx
router.get('/submissions', async (req, res) => {
  try {
    const { workItemId } = req.query;
    let query = `
      SELECT s.*, u.name AS student_name, u.email AS student_email,
             w.title AS work_title, w.type AS work_type,
             c.name AS class_name
      FROM   submissions s
      JOIN   users u      ON u.id = s.student_id
      JOIN   work_items w ON w.id = s.work_item_id
      JOIN   modules m    ON m.id = w.module_id
      JOIN   classes c    ON c.id = w.class_id
      WHERE  m.teacher_id = $1
    `;
    const params = [req.user.id];
    if (workItemId) { query += ' AND s.work_item_id=$2'; params.push(workItemId); }
    query += ' ORDER BY s.submitted_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ submissions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch submissions.' });
  }
});

// PATCH /api/teacher/submissions/:id/grade
router.patch('/submissions/:id/grade',
  [
    body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer.'),
    body('tag').optional().isIn(['Incomplete','Wrong format','Missing parts','']).withMessage('Invalid tag.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { score, tag } = req.body;
      // Verify teacher owns the submission's work item
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
         SET score=$1, tag=$2, graded_by=$3, graded_at=$4
         WHERE id=$5 RETURNING *`,
        [score, tag || null, req.user.id, now(), req.params.id]
      );
      res.json({ submission: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not grade submission.' });
    }
  }
);

// ── MATERIALS ──────────────────────────────────────────────────────────────────

// GET /api/teacher/materials
router.get('/materials', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mat.*, m.name AS module_name, c.name AS class_name
      FROM   materials mat
      JOIN   modules m ON m.id=mat.module_id
      JOIN   classes c ON c.id=mat.class_id
      WHERE  m.teacher_id=$1
      ORDER  BY mat.uploaded_at DESC
    `, [req.user.id]);
    res.json({ materials: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch materials.' });
  }
});

// POST /api/teacher/materials  (multipart/form-data)
router.post('/materials',
  (req, res, next) => {
    console.log('📬 POST /api/teacher/materials - Starting Multer upload');
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('❌ Multer/Cloudinary Error:', err);
        const msg = err.message || 'File upload failed.';
        return res.status(400).json({ error: msg });
      }
      console.log('✅ Multer upload complete. File:', req.file ? req.file.originalname : 'NONE');
      next();
    });
  },
  withFileType,
  async (req, res) => {
    try {
      if (!req.file) {
        console.warn('⚠️  Upload failed: No file in request');
        return res.status(400).json({ error: 'File is required.' });
      }
      const { moduleId, title } = req.body;
      console.log('📝 Metadata received:', { moduleId, title });

      if (!moduleId || !title) {
        console.warn('⚠️  Upload failed: Missing moduleId or title');
        return res.status(400).json({ error: 'moduleId and title required.' });
      }
      
      if (!await ownsModule(req.user.id, moduleId)) {
        console.warn(`🔒 Ownership Denied: Teacher ${req.user.id} does not own module ${moduleId}`);
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      const { rows: modRows } = await pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]);
      const { rows } = await pool.query(
        `INSERT INTO materials
            (module_id, class_id, title, file_url, file_name, file_type, file_size, uploaded_by, uploaded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [moduleId, modRows[0].class_id, title, req.file.fileUrl, req.file.originalname,
         req.file.fileType, req.file.size, req.user.id, now()]
      );

      res.status(201).json({ material: rows[0] });
    } catch (err) {
      console.error('🔥 Materials Upload DB Error:', err);
      res.status(500).json({ error: 'Could not save material metadata.' });
    }
  }
);

// DELETE /api/teacher/materials/:id
router.delete('/materials/:id', async (req, res) => {
  try {
    const { rows: matRows } = await pool.query(
      `SELECT mat.id FROM materials mat
       JOIN modules m ON m.id=mat.module_id
       WHERE mat.id=$1 AND m.teacher_id=$2`,
      [req.params.id, req.user.id]
    );
    if (matRows.length === 0) return res.status(404).json({ error: 'Material not found or not yours.' });
    await pool.query('DELETE FROM materials WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete material.' });
  }
});

// ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────────

router.get('/announcements', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role, m.name AS module_name, c.name AS class_name
      FROM   announcements a
      LEFT JOIN users u ON u.id=a.posted_by
      LEFT JOIN modules m ON m.id=a.module_id
      LEFT JOIN classes c ON c.id=a.class_id
      WHERE  a.scope='school'
        OR   (a.scope='module' AND m.teacher_id=$1)
      ORDER  BY a.created_at DESC
    `, [req.user.id]);
    res.json({ announcements: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch announcements.' });
  }
});

router.post('/announcements',
  [
    body('body').trim().isLength({ min: 1 }).withMessage('Message body required.'),
    body('moduleId').isUUID().withMessage('Valid moduleId required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { body: msgBody, moduleId } = req.body;
      if (!await ownsModule(req.user.id, moduleId)) {
        return res.status(403).json({ error: 'You do not teach this module.' });
      }
      const { rows: modRows } = await pool.query('SELECT class_id FROM modules WHERE id=$1', [moduleId]);
      const { rows } = await pool.query(
        `INSERT INTO announcements (posted_by, scope, module_id, class_id, body, created_at)
         VALUES ($1,'module',$2,$3,$4,$5) RETURNING *`,
        [req.user.id, moduleId, modRows[0].class_id, msgBody, now()]
      );
      res.status(201).json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not post announcement.' });
    }
  }
);

router.delete('/announcements/:id', async (req, res) => {
  try {
    const { rows: annRows } = await pool.query(
      `SELECT a.id FROM announcements a
       LEFT JOIN modules m ON m.id=a.module_id
       WHERE a.id=$1 AND (a.posted_by=$2 OR m.teacher_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (annRows.length === 0) return res.status(404).json({ error: 'Not found or not yours.' });
    await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete announcement.' });
  }
});

// ── REPORTS ────────────────────────────────────────────────────────────────────
router.get('/reports/:moduleId', async (req, res) => {
  try {
    if (!await ownsModule(req.user.id, req.params.moduleId)) {
      return res.status(403).json({ error: 'Not your module.' });
    }
    const { rows: students } = await pool.query(
      `SELECT u.id, u.name FROM users u
       JOIN modules m ON m.class_id=u.class_id
       WHERE m.id=$1 AND u.role='student' ORDER BY u.name`,
      [req.params.moduleId]
    );
    const { rows: workItems } = await pool.query(
      'SELECT id, title, type, max_score FROM work_items WHERE module_id=$1 ORDER BY created_at',
      [req.params.moduleId]
    );
    const { rows: subs } = await pool.query(
      `SELECT s.* FROM submissions s
       JOIN work_items w ON w.id=s.work_item_id
       WHERE w.module_id=$1`,
      [req.params.moduleId]
    );
    res.json({ students, workItems, submissions: subs });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch report.' });
  }
});

module.exports = router;

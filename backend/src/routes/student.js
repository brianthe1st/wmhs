const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireStudent } = require('../middleware/auth');
const { validate, uuidParams, isUuid } = require('../middleware/validate');
const { now, isLate, isWithinWindow } = require('../utils/serverTime');
const { currentYear } = require('../utils/years');
const { visibleAnnouncement, addReply } = require('../utils/access');
const { submissionUpload, runUpload, withFileType, removeStoredFile } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate, requireStudent);
uuidParams(router, 'workItemId', 'id');

const MAX_TEXT = 20000;        // characters of typed answer
const MAX_WORDS = 3000;        // words compared for duplicate detection
const COMPARE_LAST = 300;      // compare against at most this many earlier submissions

// ── Duplicate detection (bounded, so one huge paste cannot freeze the server) ─
function wordSet(text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return new Set(words.length > MAX_WORDS ? words.slice(0, MAX_WORDS) : words);
}
function jaccard(sa, sb) {
  if (sa.size === 0 || sb.size === 0) return 0;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let inter = 0;
  for (const w of small) if (big.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── GET /api/student/work-items  (work for my class, current year) ────────────
router.get('/work-items', async (req, res) => {
  try {
    if (!req.user.class_id) return res.json({ workItems: [] });
    const year = await currentYear();
    const { rows } = await pool.query(`
      SELECT w.*, m.name AS module_name, m.teacher_id,
             COALESCE(u.name, 'Former Teacher') AS teacher_name, c.name AS class_name
      FROM   work_items w
      JOIN   modules m ON m.id=w.module_id
      LEFT JOIN users u ON u.id=m.teacher_id
      JOIN   classes c ON c.id=w.class_id
      WHERE  w.class_id=$1 AND w.year_id=$2
      ORDER  BY w.created_at DESC
      LIMIT  500
    `, [req.user.class_id, year ? year.id : null]);
    res.json({ workItems: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch work items.' });
  }
});

// ── GET /api/student/questions/:workItemId ────────────────────────────────────
router.get('/questions/:workItemId', async (req, res) => {
  try {
    const year = await currentYear();
    const { rows: wi } = await pool.query(
      'SELECT id, open_at, close_at, year_id FROM work_items WHERE id=$1 AND class_id=$2',
      [req.params.workItemId, req.user.class_id]
    );
    if (wi.length === 0) return res.status(403).json({ error: 'Not in your class.' });
    if (year && wi[0].year_id !== year.id) return res.status(403).json({ error: 'This work belongs to a past academic year.' });

    // The quiz questions are secret until the quiz opens.
    const win = isWithinWindow(wi[0].open_at, wi[0].close_at);
    if (!win.open) return res.status(403).json({ error: win.reason });

    const { rows: sub } = await pool.query(
      'SELECT id FROM submissions WHERE work_item_id=$1 AND student_id=$2',
      [req.params.workItemId, req.user.id]
    );
    if (sub.length > 0) return res.status(400).json({ error: 'Already submitted.' });

    // Never send correct_option to students.
    const { rows } = await pool.query(
      'SELECT id, question_text, options, order_index FROM questions WHERE work_item_id=$1 ORDER BY order_index',
      [req.params.workItemId]
    );
    res.json({ questions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ── POST /api/student/submissions ─────────────────────────────────────────────
// Accepts JSON (typed answer / quiz answers) or multipart (typed answer and/or one file).
router.post('/submissions',
  runUpload(submissionUpload, { optional: true }),
  withFileType,
  async (req, res) => {
    const file = req.file || null;
    const discardFile = () => { if (file) removeStoredFile(file.fileUrl); };

    const workItemId = req.body.workItemId;
    let content = typeof req.body.content === 'string' ? req.body.content : '';
    if (!isUuid(workItemId)) { discardFile(); return res.status(422).json({ error: 'Valid workItemId required.' }); }
    if (content.length > MAX_TEXT) {
      discardFile();
      return res.status(422).json({ error: `Your answer is too long (max ${MAX_TEXT.toLocaleString()} characters). Attach a file instead.` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const year = await currentYear(client);

      const { rows: wiRows } = await client.query(
        'SELECT * FROM work_items WHERE id=$1 AND class_id=$2',
        [workItemId, req.user.class_id]
      );
      if (wiRows.length === 0) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(403).json({ error: 'Work item not found in your class.' });
      }
      const wi = wiRows[0];
      if (year && wi.year_id !== year.id) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(403).json({ error: 'This work belongs to a past academic year and is closed.' });
      }

      // Time window uses NTP-corrected server time
      const window = isWithinWindow(wi.open_at, wi.close_at);
      if (!window.open) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(403).json({ error: window.reason });
      }

      if (wi.type === 'quiz' && file) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(422).json({ error: 'Quizzes cannot have file attachments.' });
      }
      if (wi.type === 'assignment' && !content.trim() && !file) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(422).json({ error: 'Write an answer, attach a file, or both.' });
      }

      const { rows: exist } = await client.query(
        'SELECT id FROM submissions WHERE work_item_id=$1 AND student_id=$2',
        [workItemId, req.user.id]
      );
      if (exist.length > 0) {
        await client.query('ROLLBACK'); discardFile();
        return res.status(409).json({ error: 'Already submitted. Submissions are locked.' });
      }

      // ── AUTO-GRADE quiz ────────────────────────────────────────────────────
      let score = null, maxScore = wi.max_score, gradedBy = null, gradedAt = null;
      let qs = [];
      if (wi.type === 'quiz') {
        ({ rows: qs } = await client.query(
          'SELECT id, correct_option FROM questions WHERE work_item_id=$1', [workItemId]
        ));
        let answers;
        try { answers = JSON.parse(content); } catch { answers = null; }
        if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Quiz answers must be a JSON object.' });
        }
        const asIndex = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : -1));
        score    = qs.reduce((acc, q) => acc + (asIndex(answers[q.id]) === q.correct_option ? 1 : 0), 0);
        maxScore = qs.length;
        gradedBy = 'system';
        gradedAt = now().toISOString();
      }

      // ── DUPLICATE DETECTION (typed assignments only) ───────────────────────
      let duplicateFlag = false;
      if (wi.type === 'assignment' && content.trim()) {
        const mine = wordSet(content);
        if (mine.size >= 8) {   // very short answers ("yes", "42") are not meaningful to compare
          const { rows: others } = await client.query(
            `SELECT left(content, ${MAX_TEXT}) AS content FROM submissions
              WHERE work_item_id=$1 AND content <> ''
              ORDER BY submitted_at DESC LIMIT ${COMPARE_LAST}`,
            [workItemId]
          );
          for (const o of others) {
            if (jaccard(mine, wordSet(o.content)) > 0.70) { duplicateFlag = true; break; }
          }
        }
      }

      const { rows } = await client.query(
        `INSERT INTO submissions
           (work_item_id, student_id, content, locked, score, max_score, graded_by, graded_at,
            duplicate_flag, is_late, submitted_at, file_url, file_name, file_type, file_size)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [workItemId, req.user.id, content, score, maxScore, gradedBy, gradedAt, duplicateFlag,
         isLate(wi.deadline), now(),
         file ? file.fileUrl : null, file ? file.originalname.slice(0, 255) : null,
         file ? file.fileType : null, file ? file.size : null]
      );
      await client.query('COMMIT');

      let correctAnswers = null;
      if (wi.type === 'quiz') {
        correctAnswers = qs.reduce((acc, q) => ({ ...acc, [q.id]: q.correct_option }), {});
      }
      res.status(201).json({ submission: rows[0], correctAnswers });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      discardFile();
      if (err.code === '23505') return res.status(409).json({ error: 'Already submitted. Submissions are locked.' });
      console.error('Submit error:', err.message);
      res.status(500).json({ error: 'Could not submit. Please try again.' });
    } finally {
      client.release();
    }
  }
);

// ── GET /api/student/submissions  (own submissions, all years) ────────────────
router.get('/submissions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.work_item_id, s.submitted_at, s.score, s.max_score, s.tag, s.feedback,
              s.is_late, s.duplicate_flag, s.file_name, s.file_type, s.file_size, s.graded_by,
              (s.content <> '') AS has_text,
              w.title, w.type, w.module_id
       FROM   submissions s
       JOIN   work_items w ON w.id=s.work_item_id
       WHERE  s.student_id=$1
       ORDER  BY s.submitted_at DESC
       LIMIT  2000`,
      [req.user.id]
    );
    res.json({ submissions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch submissions.' });
  }
});

// ── GET /api/student/materials (class materials carry over from year to year) ─
router.get('/materials', async (req, res) => {
  try {
    if (!req.user.class_id) return res.json({ materials: [] });
    const { rows } = await pool.query(
      `SELECT mat.id, mat.module_id, mat.class_id, mat.title, mat.file_name, mat.file_type,
              mat.file_size, mat.uploaded_at, m.name AS module_name
       FROM   materials mat
       JOIN   modules m ON m.id=mat.module_id
       WHERE  mat.class_id=$1
       ORDER  BY mat.uploaded_at DESC
       LIMIT  1000`,
      [req.user.class_id]
    );
    res.json({ materials: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch materials.' });
  }
});

// ── GET /api/student/announcements (current year) ─────────────────────────────
router.get('/announcements', async (req, res) => {
  try {
    const year = await currentYear();
    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role, m.name AS module_name
       FROM   announcements a
       LEFT JOIN users u ON u.id=a.posted_by
       LEFT JOIN modules m ON m.id=a.module_id
       WHERE  a.year_id = $2
         AND  (a.scope='school' OR (a.scope='module' AND a.class_id=$1))
       ORDER  BY a.created_at DESC
       LIMIT  100`,
      [req.user.class_id, year ? year.id : null]
    );
    const annIds = rows.map(a => a.id);
    let replies = [];
    if (annIds.length > 0) {
      const { rows: rep } = await pool.query(
        `SELECT r.id, r.announcement_id, r.body, r.created_at, r.author_role,
                u.name AS author_name, u.name AS student_name
         FROM replies r JOIN users u ON u.id=r.student_id
         WHERE r.announcement_id = ANY($1)
         ORDER BY r.created_at ASC`,
        [annIds]
      );
      replies = rep;
    }
    res.json({ announcements: rows, replies });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch announcements.' });
  }
});

// ── POST /api/student/announcements/:id/replies ───────────────────────────────
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

// ── GET /api/student/results  (full transcript: every year, grouped by the app) ─
router.get('/results', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.score, s.max_score, s.tag, s.feedback, s.graded_at, s.is_late,
              s.file_name, s.file_type,
              w.id AS work_item_id, w.title, w.type, w.deadline, w.module_id, w.year_id,
              m.name AS module_name, c.name AS class_name,
              y.name AS year_name, y.created_at AS year_created_at,
              COALESCE(u.name, 'Former Teacher') AS teacher_name
       FROM   submissions s
       JOIN   work_items w ON w.id=s.work_item_id
       JOIN   modules m    ON m.id=w.module_id
       JOIN   classes c    ON c.id=w.class_id
       LEFT JOIN academic_years y ON y.id=w.year_id
       LEFT JOIN users u   ON u.id=m.teacher_id
       WHERE  s.student_id=$1
       ORDER  BY y.created_at DESC NULLS LAST, m.name, w.created_at
       LIMIT  2000`,
      [req.user.id]
    );
    res.json({ results: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch results.' });
  }
});

module.exports = router;

const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireStudent, requireAny } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { now, isLate, isWithinWindow } = require('../utils/serverTime');

const router = express.Router();
router.use(authenticate);

// ── Jaccard similarity for duplicate detection ────────────────────────────────
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const sa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const sb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (sa.size === 0 || sb.size === 0) return 0;
  const inter = new Set([...sa].filter(x => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return inter.size / union.size;
}

// ── GET /api/student/work-items  (work for my class) ──────────────────────────
router.get('/work-items', requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.*, m.name AS module_name, m.teacher_id,
             COALESCE(u.name, 'Former Teacher') AS teacher_name, c.name AS class_name
      FROM   work_items w
      JOIN   modules m ON m.id=w.module_id
      LEFT JOIN users u ON u.id=m.teacher_id
      JOIN   classes c ON c.id=w.class_id
      WHERE  w.class_id=$1
      ORDER  BY w.created_at DESC
    `, [req.user.class_id]);
    res.json({ workItems: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch work items.' });
  }
});

// ── GET /api/student/questions/:workItemId ────────────────────────────────────
router.get('/questions/:workItemId', requireStudent, async (req, res) => {
  try {
    // Only return questions for work in student's class
    const { rows: wi } = await pool.query(
      'SELECT id FROM work_items WHERE id=$1 AND class_id=$2',
      [req.params.workItemId, req.user.class_id]
    );
    if (wi.length === 0) return res.status(403).json({ error: 'Not in your class.' });

    // Check no existing locked submission
    const { rows: sub } = await pool.query(
      'SELECT id FROM submissions WHERE work_item_id=$1 AND student_id=$2 AND locked=TRUE',
      [req.params.workItemId, req.user.id]
    );
    if (sub.length > 0) return res.status(400).json({ error: 'Already submitted.' });

    // Return questions WITHOUT correct_option (prevent cheating)
    const { rows } = await pool.query(
      'SELECT id, question_text, options, order_index FROM questions WHERE work_item_id=$1 ORDER BY order_index',
      [req.params.workItemId]
    );
    res.json({ questions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ── POST /api/student/submissions  (submit assignment or quiz) ─────────────────
router.post('/submissions',
  requireStudent,
  [
    body('workItemId').isUUID().withMessage('Valid workItemId required.'),
    body('content').notEmpty().withMessage('Content is required.'),
  ],
  validate,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { workItemId, content } = req.body;

      // Verify work item belongs to student's class
      const { rows: wiRows } = await client.query(
        'SELECT * FROM work_items WHERE id=$1 AND class_id=$2',
        [workItemId, req.user.class_id]
      );
      if (wiRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Work item not found in your class.' });
      }
      const wi = wiRows[0];

      // Check time window using NTP-synced server time
      const window = isWithinWindow(wi.open_at, wi.close_at);
      if (!window.open) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: window.reason });
      }

      // Prevent double submission
      const { rows: exist } = await client.query(
        'SELECT id FROM submissions WHERE work_item_id=$1 AND student_id=$2',
        [workItemId, req.user.id]
      );
      if (exist.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Already submitted. Submissions are locked.' });
      }

      // ── AUTO-GRADE quiz ────────────────────────────────────────────────────
      let score = null, maxScore = wi.max_score, gradedBy = null, gradedAt = null;

      if (wi.type === 'quiz') {
        const { rows: qs } = await client.query(
          'SELECT id, correct_option FROM questions WHERE work_item_id=$1',
          [workItemId]
        );
        let answers;
        try { answers = JSON.parse(content); } catch {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Quiz answers must be valid JSON.' });
        }
        score    = qs.reduce((acc, q) => acc + (answers[q.id] === q.correct_option ? 1 : 0), 0);
        maxScore = qs.length;
        gradedBy = 'system';
        gradedAt = now().toISOString();
      }

      // ── DUPLICATE DETECTION (assignments only) ─────────────────────────────
      let duplicateFlag = false;
      if (wi.type === 'assignment') {
        const { rows: otherSubs } = await client.query(
          'SELECT content FROM submissions WHERE work_item_id=$1',
          [workItemId]
        );
        for (const other of otherSubs) {
          if (jaccardSimilarity(content, other.content) > 0.70) {
            duplicateFlag = true;
            break;
          }
        }
      }

      // ── INSERT submission ──────────────────────────────────────────────────
      const { rows } = await client.query(
        `INSERT INTO submissions
           (work_item_id, student_id, content, locked, score, max_score, graded_by, graded_at, duplicate_flag, is_late, submitted_at)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [workItemId, req.user.id, content, score, maxScore, gradedBy, gradedAt, duplicateFlag, isLate(wi.deadline), now()]
      );

      await client.query('COMMIT');

      // Return quiz answers with correct options revealed
      let correctAnswers = null;
      if (wi.type === 'quiz') {
        const { rows: qs } = await pool.query(
          'SELECT id, correct_option FROM questions WHERE work_item_id=$1',
          [workItemId]
        );
        correctAnswers = qs.reduce((acc, q) => ({ ...acc, [q.id]: q.correct_option }), {});
      }

      res.status(201).json({ submission: rows[0], correctAnswers });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Submit error:', err.message);
      res.status(500).json({ error: 'Could not submit. Please try again.' });
    } finally {
      client.release();
    }
  }
);

// ── GET /api/student/submissions  (own submissions) ───────────────────────────
router.get('/submissions', requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, w.title, w.type, w.module_id
       FROM   submissions s
       JOIN   work_items w ON w.id=s.work_item_id
       WHERE  s.student_id=$1`,
      [req.user.id]
    );
    res.json({ submissions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch submissions.' });
  }
});

// ── GET /api/student/materials ────────────────────────────────────────────────
router.get('/materials', requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mat.*, m.name AS module_name
       FROM   materials mat
       JOIN   modules m ON m.id=mat.module_id
       WHERE  mat.class_id=$1
       ORDER  BY mat.uploaded_at DESC`,
      [req.user.class_id]
    );
    res.json({ materials: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch materials.' });
  }
});

// ── GET /api/student/announcements ────────────────────────────────────────────
router.get('/announcements', requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role, m.name AS module_name
       FROM   announcements a
       LEFT JOIN users u ON u.id=a.posted_by
       LEFT JOIN modules m ON m.id=a.module_id
       WHERE  a.scope='school'
         OR   (a.scope='module' AND a.class_id=$1)
       ORDER  BY a.created_at DESC`,
      [req.user.class_id]
    );
    // Attach replies
    const annIds = rows.map(a => a.id);
    let replies = [];
    if (annIds.length > 0) {
      const { rows: rep } = await pool.query(
        `SELECT r.*, u.name AS student_name
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
  requireStudent,
  [body('body').trim().isLength({ min: 1 }).withMessage('Reply cannot be empty.')],
  validate,
  async (req, res) => {
    try {
      const { rows: ann } = await pool.query('SELECT id FROM announcements WHERE id=$1', [req.params.id]);
      if (ann.length === 0) return res.status(404).json({ error: 'Announcement not found.' });
      const { rows } = await pool.query(
        'INSERT INTO replies (announcement_id, student_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.params.id, req.user.id, req.body.body, now()]
      );
      res.status(201).json({ reply: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not post reply.' });
    }
  }
);

// ── GET /api/student/results ──────────────────────────────────────────────────
router.get('/results', requireStudent, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.score, s.max_score, s.tag, s.graded_at, s.is_late,
              w.id AS work_item_id, w.title, w.type, w.deadline, w.module_id,
              m.name AS module_name, c.name AS class_name,
              COALESCE(u.name, 'Former Teacher') AS teacher_name
       FROM   submissions s
       JOIN   work_items w ON w.id=s.work_item_id
       JOIN   modules m    ON m.id=w.module_id
       JOIN   classes c    ON c.id=w.class_id
       LEFT JOIN users u   ON u.id=m.teacher_id
       WHERE  s.student_id=$1
       ORDER  BY m.name, w.created_at`,
      [req.user.id]
    );
    res.json({ results: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch results.' });
  }
});

// ── GET /api/admin/announcements (admin posts school-wide) ────────────────────
// This is accessed by admin, re-exported via admin router
// but replies/view for students come through here
router.get('/announcements/:id/replies', requireAny, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS student_name
       FROM replies r JOIN users u ON u.id=r.student_id
       WHERE r.announcement_id=$1 ORDER BY r.created_at`,
      [req.params.id]
    );
    res.json({ replies: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch replies.' });
  }
});

module.exports = router;

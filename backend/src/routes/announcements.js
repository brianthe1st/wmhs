const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAdmin, requireAny } = require('../middleware/auth');
const { validate, uuidParams } = require('../middleware/validate');
const { now } = require('../utils/serverTime');
const { currentYear } = require('../utils/years');
const { visibleAnnouncement, listReplies, addReply } = require('../utils/access');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);
uuidParams(router, 'id');

// GET /api/announcements  (admin: all school-wide announcements, newest first)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role,
             COUNT(r.id)::int AS reply_count
      FROM   announcements a
      LEFT JOIN users u ON u.id=a.posted_by
      LEFT JOIN replies r ON r.announcement_id=a.id
      WHERE  a.scope='school'
      GROUP  BY a.id, u.name, u.role
      ORDER  BY a.created_at DESC
      LIMIT  200
    `);
    res.json({ announcements: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch announcements.' });
  }
});

// POST /api/announcements  (admin only - school-wide)
router.post('/',
  requireAdmin,
  [body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Message required (max 5000 characters).')],
  validate,
  async (req, res) => {
    try {
      const year = await currentYear();
      const { rows } = await pool.query(
        `INSERT INTO announcements (posted_by, scope, body, created_at, year_id)
         VALUES ($1,'school',$2,$3,$4) RETURNING *`,
        [req.user.id, req.body.body, now(), year ? year.id : null]
      );
      res.status(201).json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not post announcement.' });
    }
  }
);

// PATCH /api/announcements/:id  (admin edits a school-wide announcement)
router.patch('/:id',
  requireAdmin,
  [body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Message required (max 5000 characters).')],
  validate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        "UPDATE announcements SET body=$1 WHERE id=$2 AND scope='school' RETURNING *",
        [req.body.body, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      res.json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not update announcement.' });
    }
  }
);

// DELETE /api/announcements/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM announcements WHERE id=$1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    await audit(req.user, 'announcement.delete', req.params.id);
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete.' });
  }
});

// GET /api/announcements/:id/replies — only if you are allowed to see that announcement
router.get('/:id/replies', requireAny, async (req, res) => {
  try {
    if (!await visibleAnnouncement(req.user, req.params.id)) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }
    res.json({ replies: await listReplies(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch replies.' });
  }
});

// POST /api/announcements/:id/replies — students, teachers and admin can all reply
router.post('/:id/replies',
  requireAny,
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

module.exports = router;

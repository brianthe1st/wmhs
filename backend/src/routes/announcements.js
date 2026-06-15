const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAdmin, requireAny } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { now } = require('../utils/serverTime');

const router = express.Router();
router.use(authenticate);

// GET /api/announcements  (admin sees all school-wide)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(u.name, 'Former Staff') AS poster_name, u.role AS poster_role,
             COUNT(r.id) AS reply_count
      FROM   announcements a
      LEFT JOIN users u ON u.id=a.posted_by
      LEFT JOIN replies r ON r.announcement_id=a.id
      WHERE  a.scope='school'
      GROUP  BY a.id, u.name, u.role
      ORDER  BY a.created_at DESC
    `);
    res.json({ announcements: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch announcements.' });
  }
});

// POST /api/announcements  (admin only - school-wide)
router.post('/',
  requireAdmin,
  [body('body').trim().isLength({ min: 1 }).withMessage('Body required.')],
  validate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `INSERT INTO announcements (posted_by, scope, body, created_at)
         VALUES ($1,'school',$2,$3) RETURNING *`,
        [req.user.id, req.body.body, now()]
      );
      res.status(201).json({ announcement: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not post announcement.' });
    }
  }
);

// DELETE /api/announcements/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM announcements WHERE id=$1 RETURNING id',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    res.json({ message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete.' });
  }
});

// GET /api/announcements/:id/replies
router.get('/:id/replies', requireAny, async (req, res) => {
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

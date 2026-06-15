const express  = require('express');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAdmin, requireAny } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { now }      = require('../utils/serverTime');

const router = express.Router();
router.use(authenticate);

// ── GET /api/calendar (Anyone logged in) ──────────────────────────────────────
router.get('/', requireAny, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, description, TO_CHAR(event_date, 'YYYY-MM-DD') as event_date, type FROM calendar_events ORDER BY event_date ASC"
    );
    res.json({ events: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch calendar events.' });
  }
});

// ── POST /api/calendar (Admin only) ───────────────────────────────────────────
router.post('/',
  requireAdmin,
  [
    body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title required (max 100 chars).'),
    body('event_date').isISO8601().withMessage('Valid date required.'),
    body('type').isIn(['assessment', 'event', 'other']).withMessage('Invalid event type.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { title, description, event_date, type } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO calendar_events (title, description, event_date, type, posted_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title, description || '', event_date, type, req.user.id, now()]
      );
      res.status(201).json({ event: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not create event.' });
    }
  }
);

// ── DELETE /api/calendar/:id (Admin only) ─────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM calendar_events WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Event not found.' });
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete event.' });
  }
});

module.exports = router;

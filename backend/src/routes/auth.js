const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAny } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET is not defined in environment variables.');
    throw new Error('Server configuration error: JWT_SECRET is missing.');
  }
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').notEmpty().withMessage('Password required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const { rows } = await pool.query(
        'SELECT id, name, email, password, role, class_id FROM users WHERE email = $1',
        [email]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const user = rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

      const token = signToken(user);
      const { password: _, ...safe } = user;
      res.json({ token, user: safe });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/register  (students only, via join code) ───────────────────
router.post('/register',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('joinCode').trim().notEmpty().withMessage('Join code is required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, password, joinCode } = req.body;

      // Validate join code
      const { rows: clsRows } = await pool.query(
        'SELECT id, name FROM classes WHERE join_code = $1 AND code_active = TRUE',
        [joinCode.toUpperCase()]
      );
      if (clsRows.length === 0) {
        return res.status(400).json({ error: 'Invalid or inactive join code.' });
      }
      const cls = clsRows[0];

      // Check email unique
      const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email already registered.' });
      }

      const hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password, role, class_id)
         VALUES ($1,$2,$3,'student',$4)
         RETURNING id, name, email, role, class_id`,
        [name, email, hash, cls.id]
      );
      const user  = rows[0];
      const token = signToken(user);
      res.status(201).json({ token, user });
    } catch (err) {
      console.error('Register error:', err.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

// ── GET /api/auth/me  (get current user) ──────────────────────────────────────
router.get('/me', authenticate, requireAny, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, class_id FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch user.' });
  }
});

// ── PATCH /api/auth/password  (change own password) ───────────────────────────
router.patch('/password',
  authenticate, requireAny,
  [
    body('currentPassword').notEmpty().withMessage('Current password required.'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
      const match = await bcrypt.compare(currentPassword, rows[0].password);
      if (!match) return res.status(400).json({ error: 'Current password is incorrect.' });

      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
      res.json({ message: 'Password updated successfully.' });
    } catch (err) {
      res.status(500).json({ error: 'Could not update password.' });
    }
  }
);

module.exports = router;

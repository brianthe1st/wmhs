const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAny } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { strongPassword, hashPassword, DUMMY_HASH } = require('../utils/passwords');

const router = express.Router();
const GRAD_MONTHS = parseInt(process.env.GRADUATE_ACCESS_MONTHS, 10) || 12;

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, tv: user.token_version || 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

// What the browser is allowed to know about a user. Never includes the password hash.
function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, class_id: u.class_id,
    status: u.status || 'active',
    must_change_password: !!u.must_change_password,
    graduated_at: u.graduated_at || null,
  };
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').isString().notEmpty().isLength({ max: 200 }).withMessage('Password required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const { rows } = await pool.query(
        `SELECT id, name, email, password, role, class_id, status, graduated_at,
                must_change_password, token_version
           FROM users WHERE email = $1`,
        [email]
      );
      const user = rows[0];
      // Compare against a dummy hash for unknown emails so response time does not reveal which emails exist.
      const match = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
      if (!user || !match) return res.status(401).json({ error: 'Invalid email or password.' });

      if (user.status === 'inactive') {
        return res.status(403).json({ error: 'This account has been deactivated. Contact the school office.' });
      }
      if (user.status === 'graduated') {
        const limit = new Date(user.graduated_at || 0);
        limit.setMonth(limit.getMonth() + GRAD_MONTHS);
        if (Date.now() > limit.getTime()) {
          return res.status(403).json({ error: 'Graduate access has ended. Contact the school office for your records.' });
        }
      }

      res.json({ token: signToken(user), user: publicUser(user) });
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
    body('password').custom(strongPassword),
    body('joinCode').trim().isLength({ min: 1, max: 20 }).withMessage('Join code is required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, password, joinCode } = req.body;

      const { rows: clsRows } = await pool.query(
        'SELECT id, name FROM classes WHERE join_code = $1 AND code_active = TRUE',
        [joinCode.toUpperCase()]
      );
      if (clsRows.length === 0) {
        return res.status(400).json({ error: 'Invalid or inactive join code.' });
      }

      const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email already registered.' });
      }

      const hash = await hashPassword(password);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password, role, class_id)
         VALUES ($1,$2,$3,'student',$4)
         RETURNING id, name, email, role, class_id, status, must_change_password, token_version`,
        [name, email, hash, clsRows[0].id]
      );
      res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
      console.error('Register error:', err.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/forgot ─────────────────────────────────────────────────────
// No e-mail system: this puts the person on the admin's "password requests" list.
// The answer is always the same, so nobody can use it to find out which e-mails exist.
router.post('/forgot',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required.')],
  validate,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND status = 'active'", [req.body.email]
      );
      if (rows[0]) {
        await pool.query(
          `INSERT INTO password_requests (user_id) VALUES ($1)
           ON CONFLICT (user_id) WHERE resolved_at IS NULL DO NOTHING`,
          [rows[0].id]
        );
      }
    } catch (err) {
      console.error('Forgot-password error:', err.message);
    }
    res.json({ message: 'If that email is registered, the school office has been notified and will give you a temporary password.' });
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, requireAny, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ── PATCH /api/auth/password  (change own password) ───────────────────────────
router.patch('/password',
  authenticate, requireAny,
  [
    body('currentPassword').isString().notEmpty().withMessage('Current password required.'),
    body('newPassword').custom(strongPassword),
  ],
  validate,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
      const match = await bcrypt.compare(currentPassword, rows[0].password);
      if (!match) return res.status(400).json({ error: 'Current password is incorrect.' });
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must be different from the current one.' });
      }

      const hash = await hashPassword(newPassword);
      // token_version+1 signs out every other device; we hand back a fresh token for this one.
      const { rows: upd } = await pool.query(
        `UPDATE users
            SET password=$1, must_change_password=FALSE, token_version=token_version+1, updated_at=NOW()
          WHERE id=$2
        RETURNING id, name, email, role, class_id, status, graduated_at, must_change_password, token_version`,
        [hash, req.user.id]
      );
      res.json({ message: 'Password updated successfully.', token: signToken(upd[0]), user: publicUser(upd[0]) });
    } catch (err) {
      console.error('Change-password error:', err.message);
      res.status(500).json({ error: 'Could not update password.' });
    }
  }
);

module.exports = router;

const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

// ── Verify JWT and attach user to req ─────────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      return res.status(401).json({ error: 'Invalid token.' });
    }

    // Fetch fresh user from DB (catches deleted/suspended accounts)
    const { rows } = await pool.query(
      'SELECT id, name, email, role, class_id FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Account not found.' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Authentication error.' });
  }
}

// ── Role guard factory ─────────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
}

const requireAdmin   = requireRole('admin');
const requireTeacher = requireRole('admin', 'teacher');
const requireStudent = requireRole('student');
const requireAny     = requireRole('admin', 'teacher', 'student');

module.exports = { authenticate, requireAdmin, requireTeacher, requireStudent, requireAny };

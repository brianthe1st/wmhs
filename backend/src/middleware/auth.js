const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

// How long a graduated student may still log in (read-only) to see their results.
const GRAD_MONTHS = parseInt(process.env.GRADUATE_ACCESS_MONTHS, 10) || 12;

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
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      return res.status(401).json({ error: 'Invalid token.' });
    }

    // Always read the user fresh from the DB: catches deleted, deactivated,
    // graduated and password-changed accounts immediately.
    const { rows } = await pool.query(
      `SELECT id, name, email, role, class_id, status, graduated_at,
              must_change_password, token_version
         FROM users WHERE id = $1`,
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Account not found.' });
    const user = rows[0];

    // Changing or resetting a password bumps token_version → every old token dies.
    if ((decoded.tv || 0) !== user.token_version) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (user.status === 'inactive') {
      return res.status(401).json({ error: 'This account has been deactivated. Contact the school office.' });
    }

    const onAuthRoutes = req.baseUrl.startsWith('/api/auth');

    if (user.status === 'graduated') {
      const limit = new Date(user.graduated_at || 0);
      limit.setMonth(limit.getMonth() + GRAD_MONTHS);
      if (Date.now() > limit.getTime()) {
        return res.status(401).json({ error: 'Graduate access has ended. Contact the school office for your records.' });
      }
      const readOnly = req.method === 'GET' || req.method === 'HEAD';
      if (!readOnly && !onAuthRoutes) {
        return res.status(403).json({ error: 'Graduated accounts are read-only.' });
      }
    }

    // After an admin reset the user must choose their own password first.
    if (user.must_change_password && !onAuthRoutes) {
      return res.status(403).json({
        error: 'You must change your temporary password before continuing.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    req.user = user;
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

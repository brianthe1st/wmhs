const express  = require('express');
const bcrypt   = require('bcryptjs');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate, requireAdmin);

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join('');
  return `${part(3)}-${part(2)}`;
}

// ── CLASSES ────────────────────────────────────────────────────────────────────

// GET /api/admin/classes
router.get('/classes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
             COUNT(DISTINCT u.id) FILTER (WHERE u.role='student') AS student_count,
             (
               SELECT COALESCE(json_agg(json_build_object(
                 'id', m.id,
                 'name', m.name,
                 'teacher_name', COALESCE(tu.name, 'Unassigned')
               ) ORDER BY m.name), '[]')
               FROM modules m
               LEFT JOIN users tu ON tu.id = m.teacher_id
               WHERE m.class_id = c.id
             ) AS modules
      FROM   classes c
      LEFT JOIN users u   ON u.class_id = c.id
      GROUP BY c.id
      ORDER BY c.level, c.stream
    `);
    res.json({ classes: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch classes.' });
  }
});

// PATCH /api/admin/classes/:id/reset-code
router.patch('/classes/:id/reset-code', async (req, res) => {
  try {
    let newCode, tries = 0;
    do {
      newCode = genCode();
      tries++;
      if (tries > 20) throw new Error('Could not generate unique code.');
    } while (
      (await pool.query('SELECT id FROM classes WHERE join_code=$1', [newCode])).rows.length > 0
    );
    const { rows } = await pool.query(
      'UPDATE classes SET join_code=$1, code_active=TRUE WHERE id=$2 RETURNING *',
      [newCode, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found.' });
    res.json({ class: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not reset code.' });
  }
});

// PATCH /api/admin/classes/:id/toggle-code
router.patch('/classes/:id/toggle-code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE classes SET code_active = NOT code_active WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found.' });
    res.json({ class: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Could not toggle code.' });
  }
});

// ── MODULES ────────────────────────────────────────────────────────────────────

// GET /api/admin/classes/:classId/modules
router.get('/classes/:classId/modules', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.name AS teacher_name
       FROM modules m
       LEFT JOIN users u ON u.id = m.teacher_id
       WHERE m.class_id = $1
       ORDER BY m.name`,
      [req.params.classId]
    );
    res.json({ modules: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch modules.' });
  }
});

// POST /api/admin/modules  (create or update module assignment)
router.post('/modules',
  [
    body('classId').isUUID().withMessage('Valid classId required.'),
    body('moduleName').trim().notEmpty().withMessage('Module name required.'),
    body('teacherId').isUUID().withMessage('Valid teacherId required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { classId, moduleName, teacherId } = req.body;

      // Verify teacher exists and is a teacher
      const { rows: trRows } = await pool.query(
        "SELECT id FROM users WHERE id=$1 AND role='teacher'", [teacherId]
      );
      if (trRows.length === 0) return res.status(400).json({ error: 'Teacher not found.' });

      // Upsert module
      const { rows } = await pool.query(
        `INSERT INTO modules (name, class_id, teacher_id, approved)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (name, class_id) DO UPDATE
           SET teacher_id=$3, approved=TRUE
         RETURNING *`,
        [moduleName, classId, teacherId]
      );
      res.status(201).json({ module: rows[0] });
    } catch (err) {
      // Add unique constraint if not exists
      if (err.message.includes('unique') || err.message.includes('constraint')) {
        // Try update instead
        try {
          const { rows } = await pool.query(
            `UPDATE modules SET teacher_id=$1, approved=TRUE
             WHERE name=$2 AND class_id=$3 RETURNING *`,
            [req.body.teacherId, req.body.moduleName, req.body.classId]
          );
          return res.json({ module: rows[0] });
        } catch (e) { /* fall through */ }
      }
      res.status(500).json({ error: 'Could not assign module.' });
    }
  }
);

// ── TEACHERS ───────────────────────────────────────────────────────────────────

// GET /api/admin/teachers
router.get('/teachers', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.created_at,
             json_agg(
               json_build_object(
                 'moduleId', m.id, 'moduleName', m.name,
                 'classId', c.id, 'className', c.name
               )
             ) FILTER (WHERE m.id IS NOT NULL) AS modules
      FROM   users u
      LEFT JOIN modules m ON m.teacher_id = u.id
      LEFT JOIN classes c ON c.id = m.class_id
      WHERE  u.role = 'teacher'
      GROUP  BY u.id
      ORDER  BY u.name
    `);
    res.json({ teachers: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch teachers.' });
  }
});

// POST /api/admin/teachers  (admin creates teacher account)
router.post('/teachers',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;
      const { rows: exist } = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (exist.length > 0) return res.status(409).json({ error: 'Email already registered.' });

      const hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password, role)
         VALUES ($1,$2,$3,'teacher')
         RETURNING id, name, email, role, created_at`,
        [name, email, hash]
      );
      res.status(201).json({ teacher: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not create teacher.' });
    }
  }
);

// DELETE /api/admin/teachers/:id
router.delete('/teachers/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }
    const { rows } = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='teacher' RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Teacher not found.' });
    res.json({ message: 'Teacher deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete teacher.' });
  }
});

// ── STUDENTS ───────────────────────────────────────────────────────────────────

// GET /api/admin/students?classId=xxx
router.get('/students', async (req, res) => {
  try {
    const where = req.query.classId ? 'AND u.class_id=$1' : '';
    const params = req.query.classId ? [req.query.classId] : [];
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.class_id, u.created_at, c.name AS class_name
       FROM users u LEFT JOIN classes c ON c.id=u.class_id
       WHERE u.role='student' ${where}
       ORDER BY c.name, u.name`,
      params
    );
    res.json({ students: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch students.' });
  }
});

// DELETE /api/admin/students/:id
router.delete('/students/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='student' RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    res.json({ message: 'Student removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove student.' });
  }
});

// ── STATS (dashboard) ─────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [cls, teachers, students, work] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM classes'),
      pool.query("SELECT COUNT(*) FROM users WHERE role='teacher'"),
      pool.query("SELECT COUNT(*) FROM users WHERE role='student'"),
      pool.query('SELECT COUNT(*) FROM work_items'),
    ]);
    res.json({
      classes:  parseInt(cls.rows[0].count),
      teachers: parseInt(teachers.rows[0].count),
      students: parseInt(students.rows[0].count),
      workItems: parseInt(work.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────

// PATCH /api/admin/users/:id/reset-password
router.patch('/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent admin from resetting their own password here (they should use /api/auth/password)
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Use your personal profile settings to change your own password.' });
    }

    const newPassword = '1234567';
    const hash = await bcrypt.hash(newPassword, 12);

    const { rows } = await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role',
      [hash, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ 
      message: `Password for ${rows[0].name} has been reset to: ${newPassword}`,
      user: rows[0] 
    });
  } catch (err) {
    console.error('Admin password reset error:', err.message);
    res.status(500).json({ error: 'Could not reset user password.' });
  }
});

module.exports = router;

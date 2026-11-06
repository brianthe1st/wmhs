const express  = require('express');
const crypto   = require('crypto');
const { body } = require('express-validator');
const pool     = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate, uuidParams, isUuid, paging } = require('../middleware/validate');
const { strongPassword, hashPassword, generateTempPassword } = require('../utils/passwords');
const { parseCSV } = require('../utils/csv');
const { audit } = require('../utils/audit');
const { currentYear, clearYearCache } = require('../utils/years');
const { normalizeEmail } = require('../utils/access');
const { removeStoredFile } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate, requireAdmin);
uuidParams(router, 'id', 'classId');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  const part = (n) => Array.from({ length: n }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  return `${part(3)}-${part(2)}`;
}
async function uniqueCode(db = pool, taken = new Set()) {
  for (let i = 0; i < 30; i++) {
    const c = genCode();
    if (taken.has(c)) continue;
    const { rows } = await db.query('SELECT 1 FROM classes WHERE join_code=$1', [c]);
    if (rows.length === 0) { taken.add(c); return c; }
  }
  throw new Error('Could not generate a unique join code.');
}

// ── STATS (dashboard) ─────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const year = await currentYear();
    const [cls, teachers, students, work, pw] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM classes'),
      pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='teacher'"),
      pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='student' AND status='active'"),
      pool.query('SELECT COUNT(*)::int AS n FROM work_items WHERE year_id=$1', [year ? year.id : null]),
      pool.query('SELECT COUNT(*)::int AS n FROM password_requests WHERE resolved_at IS NULL'),
    ]);
    res.json({
      classes: cls.rows[0].n, teachers: teachers.rows[0].n, students: students.rows[0].n,
      workItems: work.rows[0].n, passwordRequests: pw.rows[0].n, currentYear: year ? year.name : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

// ── CLASSES ────────────────────────────────────────────────────────────────────

router.get('/classes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
             COUNT(DISTINCT u.id) FILTER (WHERE u.role='student' AND u.status='active') AS student_count,
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

// POST /api/admin/classes  — add a class (e.g. a new level or stream)
router.post('/classes',
  [
    body('level').isInt({ min: 1, max: 9 }).withMessage('Level must be a number from 1 to 9.'),
    body('stream').trim().matches(/^[A-Za-z0-9]{2,10}$/).withMessage('Stream must be 2–10 letters/numbers (e.g. SOD).'),
  ],
  validate,
  async (req, res) => {
    try {
      const level = parseInt(req.body.level, 10);
      const stream = req.body.stream.toUpperCase();
      const name = `L${level}-${stream}`;
      const { rows: dup } = await pool.query('SELECT 1 FROM classes WHERE name=$1', [name]);
      if (dup.length) return res.status(409).json({ error: `Class ${name} already exists.` });
      const { rows } = await pool.query(
        'INSERT INTO classes (name, level, stream, join_code) VALUES ($1,$2,$3,$4) RETURNING *',
        [name, level, stream, await uniqueCode()]
      );
      await audit(req.user, 'class.create', name);
      res.status(201).json({ class: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not create class.' });
    }
  }
);

// POST /api/admin/classes/reset-all-codes — new join code for every class (start of a new intake)
router.post('/classes/reset-all-codes', async (req, res) => {
  try {
    const { rows: all } = await pool.query('SELECT id FROM classes');
    const taken = new Set();
    for (const c of all) {
      await pool.query('UPDATE classes SET join_code=$1, code_active=TRUE WHERE id=$2', [await uniqueCode(pool, taken), c.id]);
    }
    await audit(req.user, 'class.reset_all_codes', null, { count: all.length });
    res.json({ message: `Reset ${all.length} join codes.` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not reset codes.' });
  }
});

router.patch('/classes/:id/reset-code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE classes SET join_code=$1, code_active=TRUE WHERE id=$2 RETURNING *',
      [await uniqueCode(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found.' });
    await audit(req.user, 'class.reset_code', rows[0].name);
    res.json({ class: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not reset code.' });
  }
});

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

// POST /api/admin/modules  (create or re-assign a module's teacher)
router.post('/modules',
  [
    body('classId').isUUID().withMessage('Valid classId required.'),
    body('moduleName').trim().isLength({ min: 2, max: 100 }).withMessage('Module name required (2–100 characters).'),
    body('teacherId').isUUID().withMessage('Valid teacherId required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { classId, moduleName, teacherId } = req.body;
      const { rows: trRows } = await pool.query("SELECT id FROM users WHERE id=$1 AND role='teacher'", [teacherId]);
      if (trRows.length === 0) return res.status(400).json({ error: 'Teacher not found.' });
      const { rows: cl } = await pool.query('SELECT id FROM classes WHERE id=$1', [classId]);
      if (cl.length === 0) return res.status(404).json({ error: 'Class not found.' });

      const { rows } = await pool.query(
        `INSERT INTO modules (name, class_id, teacher_id, approved)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (name, class_id) DO UPDATE SET teacher_id=$3, approved=TRUE
         RETURNING *`,
        [moduleName, classId, teacherId]
      );
      await audit(req.user, 'module.assign', moduleName, { classId, teacherId });
      res.status(201).json({ module: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Could not assign module.' });
    }
  }
);

// ── TEACHERS ───────────────────────────────────────────────────────────────────

router.get('/teachers', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.created_at, u.must_change_password,
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

// POST /api/admin/teachers — password is optional; leave it out and a one-time one is generated
router.post('/teachers',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').optional({ checkFalsy: true }).custom(strongPassword),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email } = req.body;
      const generated = !req.body.password;
      const password = req.body.password || generateTempPassword();
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password, role, must_change_password)
         VALUES ($1,$2,$3,'teacher',TRUE)
         RETURNING id, name, email, role, created_at`,
        [name, email, await hashPassword(password)]
      );
      await audit(req.user, 'teacher.create', email);
      res.status(201).json({ teacher: rows[0], tempPassword: generated ? password : undefined });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
      res.status(500).json({ error: 'Could not create teacher.' });
    }
  }
);

router.delete('/teachers/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='teacher' RETURNING id, email", [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Teacher not found.' });
    await audit(req.user, 'teacher.delete', rows[0].email);
    res.json({ message: 'Teacher deleted. Their modules stay in place, unassigned, until you appoint someone.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete teacher.' });
  }
});

// ── STUDENTS ───────────────────────────────────────────────────────────────────

// GET /api/admin/students?classId=&status=active|graduated|inactive|all&q=&limit=&offset=
router.get('/students', async (req, res) => {
  try {
    const { classId, status = 'active', q } = req.query;
    if (classId !== undefined && classId !== '' && !isUuid(classId)) return res.status(400).json({ error: 'Invalid classId.' });
    if (!['active', 'graduated', 'inactive', 'all'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const { limit, offset } = paging(req, 500, 1000);

    const params = [];
    const where = ["u.role='student'"];
    if (classId) { params.push(classId); where.push(`u.class_id=$${params.length}`); }
    if (status !== 'all') { params.push(status); where.push(`u.status=$${params.length}`); }
    if (q && String(q).trim()) { params.push(`%${String(q).trim().slice(0, 60)}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const whereSql = where.join(' AND ');

    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM users u WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.class_id, u.status, u.graduated_at, u.created_at, c.name AS class_name
         FROM users u LEFT JOIN classes c ON c.id=u.class_id
        WHERE ${whereSql}
        ORDER BY c.name NULLS LAST, u.name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ students: rows, total: n, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch students.' });
  }
});

// DELETE /api/admin/students/:id
//   default            → deactivate (cannot log in; grades are kept; can be restored)
//   ?permanent=true    → erase the account AND all their submissions (cannot be undone)
router.delete('/students/:id', async (req, res) => {
  try {
    if (req.query.permanent === 'true') {
      const { rows: files } = await pool.query(
        'SELECT file_url FROM submissions WHERE student_id=$1 AND file_url IS NOT NULL', [req.params.id]);
      const { rows } = await pool.query("DELETE FROM users WHERE id=$1 AND role='student' RETURNING id, email", [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
      files.forEach(f => removeStoredFile(f.file_url));
      await audit(req.user, 'student.delete_permanent', rows[0].email);
      return res.json({ message: 'Student and all their records were erased.' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET status='inactive', token_version=token_version+1, updated_at=NOW()
        WHERE id=$1 AND role='student' RETURNING id, email`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    await audit(req.user, 'student.deactivate', rows[0].email);
    res.json({ message: 'Student deactivated. Their grades are kept; you can restore them at any time.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove student.' });
  }
});

// POST /api/admin/students/:id/restore
router.post('/students/:id/restore', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET status='active', graduated_at=NULL, updated_at=NOW()
        WHERE id=$1 AND role='student' RETURNING id, email, class_id`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
    await audit(req.user, 'student.restore', rows[0].email);
    res.json({ message: rows[0].class_id ? 'Student restored.' : 'Student restored — now assign them to a class.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not restore student.' });
  }
});

// PATCH /api/admin/students/:id/class  — move a student to another class (e.g. stream change)
router.patch('/students/:id/class',
  [body('classId').isUUID().withMessage('Valid classId required.')],
  validate,
  async (req, res) => {
    try {
      const { rows: cl } = await pool.query('SELECT id, name FROM classes WHERE id=$1', [req.body.classId]);
      if (cl.length === 0) return res.status(404).json({ error: 'Class not found.' });
      const { rows } = await pool.query(
        `UPDATE users SET class_id=$1, updated_at=NOW()
          WHERE id=$2 AND role='student' RETURNING id, email`, [req.body.classId, req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
      await audit(req.user, 'student.move', rows[0].email, { to: cl[0].name });
      res.json({ message: `Moved to ${cl[0].name}.` });
    } catch (err) {
      res.status(500).json({ error: 'Could not move student.' });
    }
  }
);

// POST /api/admin/students/import   { classId, csv }   — columns: name,email   (max 200 rows)
router.post('/students/import',
  [
    body('classId').isUUID().withMessage('Choose a class.'),
    body('csv').isString().isLength({ min: 3, max: 200000 }).withMessage('The file is empty or too large.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { rows: cl } = await pool.query('SELECT id, name FROM classes WHERE id=$1', [req.body.classId]);
      if (cl.length === 0) return res.status(404).json({ error: 'Class not found.' });

      let rows = parseCSV(req.body.csv);
      let nameCol = 0, emailCol = 1;
      const head = rows[0] ? rows[0].map(h => String(h).trim().toLowerCase()) : [];
      if (head.includes('email') || head.includes('e-mail')) {
        emailCol = Math.max(head.indexOf('email'), head.indexOf('e-mail'));
        const n = head.findIndex(h => h === 'name' || h === 'full name' || h === 'student' || h === 'student name');
        nameCol = n >= 0 ? n : (emailCol === 0 ? 1 : 0);
        rows = rows.slice(1);
      }
      if (rows.length === 0) return res.status(422).json({ error: 'No student rows found. Use two columns: name, email.' });
      if (rows.length > 200) return res.status(422).json({ error: 'Maximum 200 students per import. Split the file.' });

      const created = [], skipped = [], seen = new Set();
      for (let i = 0; i < rows.length; i++) {
        const lineNo = i + 1;
        const name = String(rows[i][nameCol] || '').trim();
        const rawEmail = String(rows[i][emailCol] || '').trim();
        if (name.length < 2 || name.length > 100) { skipped.push({ row: lineNo, email: rawEmail, reason: 'Name must be 2–100 characters' }); continue; }
        const email = await normalizeEmail(rawEmail);
        if (!email) { skipped.push({ row: lineNo, email: rawEmail, reason: 'Invalid email' }); continue; }
        if (seen.has(email)) { skipped.push({ row: lineNo, email, reason: 'Duplicate in this file' }); continue; }
        seen.add(email);

        const { rows: ex } = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
        if (ex.length) { skipped.push({ row: lineNo, email, reason: 'Already registered' }); continue; }

        const tempPassword = generateTempPassword();
        try {
          await pool.query(
            `INSERT INTO users (name, email, password, role, class_id, must_change_password)
             VALUES ($1,$2,$3,'student',$4,TRUE)`,
            [name, email, await hashPassword(tempPassword), cl[0].id]
          );
          created.push({ name, email, tempPassword });
        } catch (e) {
          skipped.push({ row: lineNo, email, reason: e.code === '23505' ? 'Already registered' : 'Could not save' });
        }
      }
      await audit(req.user, 'student.import', cl[0].name, { created: created.length, skipped: skipped.length });
      res.status(201).json({ class: cl[0].name, created, skipped });
    } catch (err) {
      console.error('Import error:', err.message);
      res.status(500).json({ error: 'Import failed.' });
    }
  }
);

// ── PASSWORDS ─────────────────────────────────────────────────────────────────

// PATCH /api/admin/users/:id/reset-password  → a random one-time password, shown once
router.patch('/users/:id/reset-password', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Use "Change Password" to change your own password.' });
    }
    const tempPassword = generateTempPassword();
    const { rows } = await pool.query(
      `UPDATE users
          SET password=$1, must_change_password=TRUE, token_version=token_version+1, updated_at=NOW()
        WHERE id=$2 AND role IN ('teacher','student')
        RETURNING id, name, email, role`,
      [await hashPassword(tempPassword), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    await pool.query('UPDATE password_requests SET resolved_at=NOW() WHERE user_id=$1 AND resolved_at IS NULL', [req.params.id]);
    await audit(req.user, 'user.reset_password', rows[0].email);
    res.json({
      message: `Temporary password for ${rows[0].name}. Give it to them in person — it is shown only once, and they must choose a new one at first login.`,
      tempPassword, user: rows[0],
    });
  } catch (err) {
    console.error('Admin password reset error:', err.message);
    res.status(500).json({ error: 'Could not reset user password.' });
  }
});

// GET /api/admin/password-requests — people who tapped "Forgot password"
router.get('/password-requests', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.id, pr.created_at, u.id AS user_id, u.name, u.email, u.role, c.name AS class_name
         FROM password_requests pr
         JOIN users u ON u.id=pr.user_id
         LEFT JOIN classes c ON c.id=u.class_id
        WHERE pr.resolved_at IS NULL
        ORDER BY pr.created_at ASC
        LIMIT 200`
    );
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch password requests.' });
  }
});

router.post('/password-requests/:id/dismiss', async (req, res) => {
  try {
    await pool.query('UPDATE password_requests SET resolved_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ message: 'Dismissed.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not dismiss request.' });
  }
});

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const { limit, offset } = paging(req, 100, 500);
    const { rows } = await pool.query(
      `SELECT id, actor_name, action, target, meta, created_at FROM audit_log
        ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch the activity log.' });
  }
});

// ── ACADEMIC YEARS & PROMOTION ────────────────────────────────────────────────

router.get('/years', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, is_current, created_at FROM academic_years ORDER BY created_at DESC');
    res.json({ years: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch years.' });
  }
});

// Target class for a class: same stream, next level. No such class → the students graduate.
function buildTargets(classes) {
  const byKey = new Map(classes.map(c => [`${c.level}|${c.stream}`, c]));
  return new Map(classes.map(c => [c.id, byKey.get(`${c.level + 1}|${c.stream}`) || null]));
}

// GET /api/admin/promotion/preview — what WOULD happen (nothing is changed)
router.get('/promotion/preview', async (req, res) => {
  try {
    const year = await currentYear();
    const { rows: classes } = await pool.query('SELECT id, name, level, stream FROM classes ORDER BY level, stream');
    const { rows: students } = await pool.query(
      `SELECT id, name, email, class_id FROM users
        WHERE role='student' AND status='active' AND class_id IS NOT NULL ORDER BY name`);
    const targets = buildTargets(classes);

    const out = classes.map(c => {
      const t = targets.get(c.id);
      return {
        id: c.id, name: c.name, level: c.level, stream: c.stream,
        target: t ? { id: t.id, name: t.name } : null,           // null = graduates
        students: students.filter(s => s.class_id === c.id).map(s => ({ id: s.id, name: s.name, email: s.email })),
      };
    });

    const { rows: last } = await pool.query(
      `SELECT b.id, b.created_at, b.promoted, b.repeated, b.graduated, fy.name AS from_year, ty.name AS to_year, b.to_year_id
         FROM promotion_batches b
         JOIN academic_years fy ON fy.id=b.from_year_id JOIN academic_years ty ON ty.id=b.to_year_id
        WHERE b.undone_at IS NULL ORDER BY b.created_at DESC LIMIT 1`);
    let lastBatch = null;
    if (last[0]) {
      const { rows: used } = await pool.query(
        `SELECT (EXISTS (SELECT 1 FROM work_items WHERE year_id=$1) OR EXISTS (SELECT 1 FROM announcements WHERE year_id=$1)) AS used`,
        [last[0].to_year_id]);
      lastBatch = { ...last[0], canUndo: !used[0].used };
    }

    const next = /^\d{4}$/.test(year ? year.name : '') ? String(parseInt(year.name, 10) + 1) : '';
    res.json({ currentYear: year ? year.name : null, suggestedNextYear: next, classes: out, lastBatch });
  } catch (err) {
    console.error('Promotion preview error:', err.message);
    res.status(500).json({ error: 'Could not build the preview.' });
  }
});

// POST /api/admin/promotion/commit  { newYearName, holdBackIds: [studentId...], resetCodes: bool }
router.post('/promotion/commit',
  [
    body('newYearName').trim().isLength({ min: 2, max: 30 }).withMessage('Give the new academic year a name (e.g. 2027).'),
    body('holdBackIds').optional().isArray({ max: 5000 }).withMessage('holdBackIds must be a list.'),
    body('resetCodes').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    const holdBack = new Set((req.body.holdBackIds || []).filter(isUuid));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(72012)');

      const { rows: curRows } = await client.query('SELECT id, name FROM academic_years WHERE is_current FOR UPDATE');
      if (curRows.length === 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'No current academic year is set.' }); }
      const cur = curRows[0];
      const { rows: dup } = await client.query('SELECT 1 FROM academic_years WHERE lower(name)=lower($1)', [req.body.newYearName]);
      if (dup.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Academic year "${req.body.newYearName}" already exists.` }); }

      await client.query('UPDATE academic_years SET is_current=FALSE WHERE id=$1', [cur.id]);
      const { rows: [newYear] } = await client.query(
        'INSERT INTO academic_years (name, is_current) VALUES ($1, TRUE) RETURNING id, name', [req.body.newYearName]);

      const { rows: classes } = await client.query('SELECT id, name, level, stream FROM classes');
      const targets = buildTargets(classes);
      const { rows: students } = await client.query(
        `SELECT id, class_id FROM users
          WHERE role='student' AND status='active' AND class_id IS NOT NULL FOR UPDATE`);

      const moves = students.map(s => {
        if (holdBack.has(s.id)) return { id: s.id, from: s.class_id, to: null, outcome: 'repeat' };
        const t = targets.get(s.class_id);
        return t ? { id: s.id, from: s.class_id, to: t.id, outcome: 'promote' }
                 : { id: s.id, from: s.class_id, to: null, outcome: 'graduate' };
      });
      const promote  = moves.filter(m => m.outcome === 'promote');
      const graduate = moves.filter(m => m.outcome === 'graduate');
      const repeat   = moves.filter(m => m.outcome === 'repeat');

      const { rows: [batch] } = await client.query(
        `INSERT INTO promotion_batches (from_year_id, to_year_id, created_by, promoted, repeated, graduated)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [cur.id, newYear.id, req.user.id, promote.length, repeat.length, graduate.length]);

      if (moves.length) {
        await client.query(
          `INSERT INTO promotion_moves (batch_id, student_id, from_class_id, to_class_id, outcome)
           SELECT $1, a, b, c, d FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[]) AS t(a,b,c,d)`,
          [batch.id, moves.map(m => m.id), moves.map(m => m.from), moves.map(m => m.to), moves.map(m => m.outcome)]);
      }
      if (promote.length) {
        await client.query(
          `UPDATE users u SET class_id=t.to_class, updated_at=NOW()
             FROM unnest($1::uuid[], $2::uuid[]) AS t(id, to_class)
            WHERE u.id=t.id`,
          [promote.map(m => m.id), promote.map(m => m.to)]);
      }
      if (graduate.length) {
        await client.query(
          `UPDATE users SET status='graduated', graduated_at=NOW(), class_id=NULL, updated_at=NOW()
            WHERE id = ANY($1::uuid[])`, [graduate.map(m => m.id)]);
      }

      if (req.body.resetCodes !== false) {   // default: yes — last year's codes must stop working
        const taken = new Set();
        for (const c of classes) {
          await client.query('UPDATE classes SET join_code=$1, code_active=TRUE WHERE id=$2', [await uniqueCode(client, taken), c.id]);
        }
      }

      await audit(req.user, 'promotion.commit', `${cur.name} → ${newYear.name}`,
        { promoted: promote.length, repeated: repeat.length, graduated: graduate.length }, client);
      await client.query('COMMIT');
      clearYearCache();
      res.status(201).json({
        message: `New academic year ${newYear.name} started.`,
        batchId: batch.id, promoted: promote.length, repeated: repeat.length, graduated: graduate.length,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Promotion commit error:', err.message);
      res.status(500).json({ error: 'Promotion failed. Nothing was changed.' });
    } finally {
      client.release();
    }
  }
);

// POST /api/admin/promotion/undo  { batchId } — only the latest promotion, and only if teachers
// have not yet added work or announcements to the new year.
router.post('/promotion/undo',
  [body('batchId').isUUID().withMessage('batchId required.')],
  validate,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(72012)');
      const { rows } = await client.query(
        'SELECT * FROM promotion_batches WHERE undone_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE');
      const batch = rows[0];
      if (!batch) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Nothing to undo.' }); }
      if (batch.id !== req.body.batchId) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only the most recent promotion can be undone.' }); }

      const { rows: used } = await client.query(
        `SELECT (EXISTS (SELECT 1 FROM work_items WHERE year_id=$1) OR EXISTS (SELECT 1 FROM announcements WHERE year_id=$1)) AS used`,
        [batch.to_year_id]);
      if (used[0].used) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Teachers have already added work or announcements to the new year, so it can no longer be undone.' });
      }

      const { rows: moves } = await client.query('SELECT * FROM promotion_moves WHERE batch_id=$1', [batch.id]);
      const promote  = moves.filter(m => m.outcome === 'promote');
      const graduate = moves.filter(m => m.outcome === 'graduate');
      let skipped = 0;
      if (promote.length) {
        const r = await client.query(
          `UPDATE users u SET class_id=t.from_class, updated_at=NOW()
             FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS t(id, from_class, to_class)
            WHERE u.id=t.id AND u.class_id=t.to_class`,
          [promote.map(m => m.student_id), promote.map(m => m.from_class_id), promote.map(m => m.to_class_id)]);
        skipped += promote.length - r.rowCount;      // students an admin has moved since → left alone
      }
      if (graduate.length) {
        const r = await client.query(
          `UPDATE users u SET status='active', graduated_at=NULL, class_id=t.from_class, updated_at=NOW()
             FROM unnest($1::uuid[], $2::uuid[]) AS t(id, from_class)
            WHERE u.id=t.id AND u.status='graduated'`,
          [graduate.map(m => m.student_id), graduate.map(m => m.from_class_id)]);
        skipped += graduate.length - r.rowCount;
      }

      await client.query('DELETE FROM promotion_batches WHERE id=$1', [batch.id]);   // cascades to its moves
      await client.query('UPDATE academic_years SET is_current=FALSE WHERE id=$1', [batch.to_year_id]);
      await client.query('UPDATE academic_years SET is_current=TRUE WHERE id=$1', [batch.from_year_id]);
      await client.query('DELETE FROM academic_years WHERE id=$1', [batch.to_year_id]);

      await audit(req.user, 'promotion.undo', batch.id, { skipped }, client);
      await client.query('COMMIT');
      clearYearCache();
      res.json({ message: 'Promotion undone.', skipped });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Promotion undo error:', err.message);
      res.status(500).json({ error: 'Could not undo. Nothing was changed.' });
    } finally {
      client.release();
    }
  }
);

router.get('/promotion/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.created_at, b.promoted, b.repeated, b.graduated, fy.name AS from_year, ty.name AS to_year
         FROM promotion_batches b
         JOIN academic_years fy ON fy.id=b.from_year_id JOIN academic_years ty ON ty.id=b.to_year_id
        ORDER BY b.created_at DESC LIMIT 50`);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch history.' });
  }
});

module.exports = router;

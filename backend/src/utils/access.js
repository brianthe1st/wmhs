const pool = require('../db/pool');
const { body, validationResult } = require('express-validator');

// Can this user see this announcement? Returns the announcement row or null.
//  - everyone logged in sees school-wide announcements
//  - students see module announcements for their own class only
//  - teachers see module announcements for modules they teach
//  - admin sees everything
async function visibleAnnouncement(user, id) {
  const { rows } = await pool.query(
    `SELECT a.id, a.scope, a.class_id, a.module_id, a.posted_by, m.teacher_id
       FROM announcements a
       LEFT JOIN modules m ON m.id = a.module_id
      WHERE a.id = $1`,
    [id]
  );
  const a = rows[0];
  if (!a) return null;
  if (user.role === 'admin' || a.scope === 'school') return a;
  if (user.role === 'student') return a.class_id && a.class_id === user.class_id ? a : null;
  if (user.role === 'teacher') return a.teacher_id === user.id ? a : null;
  return null;
}

async function listReplies(announcementId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.announcement_id, r.body, r.created_at, r.author_role,
            u.name AS author_name, u.name AS student_name
       FROM replies r JOIN users u ON u.id = r.student_id
      WHERE r.announcement_id = $1
      ORDER BY r.created_at ASC`,
    [announcementId]
  );
  return rows;
}

async function addReply(user, announcementId, text) {
  const { rows } = await pool.query(
    `INSERT INTO replies (announcement_id, student_id, body, author_role)
     VALUES ($1,$2,$3,$4)
     RETURNING id, announcement_id, body, created_at, author_role`,
    [announcementId, user.id, text, user.role]
  );
  return { ...rows[0], author_name: user.name, student_name: user.name };
}

// Run express-validator's e-mail normaliser outside a request, so imports store exactly the
// same address form that the login form will look up.
async function normalizeEmail(email) {
  const fake = { body: { email: String(email || '').trim() } };
  await body('email').isEmail().normalizeEmail().run(fake);
  return validationResult(fake).isEmpty() ? fake.body.email : null;
}

module.exports = { visibleAnnouncement, listReplies, addReply, normalizeEmail };

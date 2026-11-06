// Authenticated file downloads. Uploaded files are NEVER served from a public folder:
// every download goes through here and is checked against who is asking.
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const pool    = require('../db/pool');
const { authenticate, requireAny } = require('../middleware/auth');
const { uuidParams } = require('../middleware/validate');
const { resolveStoredFile, CONTENT_TYPES } = require('../middleware/upload');

const router = express.Router();
router.use(authenticate, requireAny);
uuidParams(router, 'id');

function deliver(res, fileUrl, downloadName, fileType) {
  if (/^https:\/\//.test(fileUrl || '')) {
    // Cloudinary storage: hand the browser the link (it fetches it directly).
    return res.json({ url: fileUrl });
  }
  const abs = resolveStoredFile(fileUrl);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File not found (it may have been removed).' });
  const ext = path.extname(abs).slice(1).toLowerCase() || fileType;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // "attachment" so a browser never renders an uploaded file as a web page on our own origin.
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName || 'download')}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(abs, { dotfiles: 'deny' });
}

// GET /api/files/materials/:id
router.get('/materials/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mat.file_url, mat.file_name, mat.file_type, mat.class_id, m.teacher_id
         FROM materials mat JOIN modules m ON m.id = mat.module_id
        WHERE mat.id = $1`, [req.params.id]);
    const f = rows[0];
    if (!f) return res.status(404).json({ error: 'File not found.' });
    const u = req.user;
    const allowed = u.role === 'admin'
      || (u.role === 'teacher' && f.teacher_id === u.id)
      || (u.role === 'student' && f.class_id === u.class_id);
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this file.' });
    deliver(res, f.file_url, f.file_name, f.file_type);
  } catch (err) {
    console.error('File download error:', err.message);
    res.status(500).json({ error: 'Could not download file.' });
  }
});

// GET /api/files/submissions/:id  — a student's attached file
router.get('/submissions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.file_url, s.file_name, s.file_type, s.student_id, m.teacher_id
         FROM submissions s
         JOIN work_items w ON w.id = s.work_item_id
         JOIN modules m ON m.id = w.module_id
        WHERE s.id = $1`, [req.params.id]);
    const f = rows[0];
    if (!f || !f.file_url) return res.status(404).json({ error: 'File not found.' });
    const u = req.user;
    const allowed = u.role === 'admin'
      || (u.role === 'teacher' && f.teacher_id === u.id)
      || (u.role === 'student' && f.student_id === u.id);
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this file.' });
    deliver(res, f.file_url, f.file_name, f.file_type);
  } catch (err) {
    console.error('File download error:', err.message);
    res.status(500).json({ error: 'Could not download file.' });
  }
});

module.exports = router;

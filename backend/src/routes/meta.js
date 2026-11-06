const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireAny } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAny);

// GET /api/meta/years — academic years, newest first (used by year pickers)
router.get('/years', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, is_current, created_at FROM academic_years ORDER BY created_at DESC'
    );
    res.json({ years: rows, current: rows.find(y => y.is_current) || null });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch academic years.' });
  }
});

module.exports = router;

const pool = require('../db/pool');

// The "current academic year" is read on almost every request, so keep it for 30 s.
let cache = null;
let cachedAt = 0;

async function currentYear(db = pool) {
  if (db === pool && cache && Date.now() - cachedAt < 30000) return cache;
  const { rows } = await db.query('SELECT id, name FROM academic_years WHERE is_current = TRUE');
  const y = rows[0] || null;
  if (db === pool) { cache = y; cachedAt = Date.now(); }
  return y;
}

function clearYearCache() { cache = null; cachedAt = 0; }

module.exports = { currentYear, clearYearCache };

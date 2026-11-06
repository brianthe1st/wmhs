const pool = require('../db/pool');

// Record a sensitive action. Never throws: a failed log write must not break the real action.
async function audit(user, action, target = null, meta = null, db = pool) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, target, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [user ? user.id : null, user ? user.name : null, action, target, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('audit log write failed:', err.message);
  }
}

module.exports = { audit };

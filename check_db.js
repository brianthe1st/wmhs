const pool = require('./backend/src/db/pool');
async function check() {
  try {
    const { rows } = await pool.query('SELECT count(*) FROM users WHERE email = $1', ['admin@wmhs.ac.rw']);
    console.log('Admin user count:', rows[0].count);
    process.exit(0);
  } catch (err) {
    console.error('Check failed:', err.message);
    process.exit(1);
  }
}
check();

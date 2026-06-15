const pool = require('./backend/src/db/pool');
async function check() {
  try {
    const { rows } = await pool.query('SELECT email, role FROM users');
    console.log('Users in DB:');
    rows.forEach(r => console.log(`- ${r.email} (${r.role})`));
    process.exit(0);
  } catch (err) {
    console.error('Check failed:', err.message);
    process.exit(1);
  }
}
check();

// Run AFTER db:init → npm run db:seed
// Seeds: 9 classes + 1 admin account
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 9 CLASSES (hardcoded, never change) ──────────────────────────────────
    const classes = [
      { name: 'L3-SOD', level: 3, stream: 'SOD', join_code: 'XK7-R2' },
      { name: 'L3-NIT', level: 3, stream: 'NIT', join_code: 'MP4-W9' },
      { name: 'L3-MMP', level: 3, stream: 'MMP', join_code: 'TQ1-B5' },
      { name: 'L4-SOD', level: 4, stream: 'SOD', join_code: 'YJ8-C3' },
      { name: 'L4-NIT', level: 4, stream: 'NIT', join_code: 'FN2-Z6' },
      { name: 'L4-MMP', level: 4, stream: 'MMP', join_code: 'DG5-H4' },
      { name: 'L5-SOD', level: 5, stream: 'SOD', join_code: 'WL9-A7' },
      { name: 'L5-NIT', level: 5, stream: 'NIT', join_code: 'RV3-K1' },
      { name: 'L5-MMP', level: 5, stream: 'MMP', join_code: 'JB6-E8' },
    ];

    for (const cls of classes) {
      await client.query(
        `INSERT INTO classes (name, level, stream, join_code)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (join_code) DO NOTHING`,
        [cls.name, cls.level, cls.stream, cls.join_code]
      );
    }
    console.log('✅  9 classes seeded.');

    // ── ADMIN ACCOUNT ─────────────────────────────────────────────────────────
    const adminPass = await bcrypt.hash('Admin@WMHS2024!', 12);
    await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO NOTHING`,
      ['Administrator', 'admin@wmhs.ac.rw', adminPass]
    );
    console.log('✅  Admin account seeded.');
    console.log('    Email:    admin@wmhs.ac.rw');
    console.log('    Password: Admin@WMHS2024!');
    console.log('    ⚠️  Change this password immediately after first login.');

    await client.query('COMMIT');
    console.log('\n🎉  Seed complete. Run the server with: npm run dev');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));

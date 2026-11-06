// Run AFTER db:init → npm run db:seed.   Safe to re-run.
// Creates: 9 starter classes (only if there are none) and the first admin (only if there is none).
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool   = require('./pool');
const { generateTempPassword, hashPassword } = require('../utils/passwords');

// These join codes and passwords were published in older versions of this project.
// If a database still contains them, neutralise them automatically.
const OLD_PUBLIC_CODES = ['XK7-R2','MP4-W9','TQ1-B5','YJ8-C3','FN2-Z6','DG5-H4','WL9-A7','RV3-K1','JB6-E8'];
const OLD_ADMIN_EMAIL = 'admin@wmhs.ac.rw';
const OLD_ADMIN_PASSWORD = 'Admin@WMHS2024!';

function newJoinCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n) => Array.from({ length: n }, () => c[crypto.randomInt(c.length)]).join('');
  return `${part(3)}-${part(2)}`;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Starter classes (only on an empty database) ──────────────────────────
    const { rows: [{ n: classCount }] } = await client.query('SELECT COUNT(*)::int AS n FROM classes');
    if (classCount === 0) {
      for (const level of [3, 4, 5]) {
        for (const stream of ['SOD', 'NIT', 'MMP']) {
          await client.query(
            `INSERT INTO classes (name, level, stream, join_code) VALUES ($1,$2,$3,$4)`,
            [`L${level}-${stream}`, level, stream, newJoinCode()]
          );
        }
      }
      console.log('✅  9 starter classes created with random join codes.');
    }

    // ── Replace any join code that was ever published in the old source code ──
    const { rows: oldCodes } = await client.query(
      'SELECT id FROM classes WHERE join_code = ANY($1)', [OLD_PUBLIC_CODES]
    );
    for (const c of oldCodes) {
      await client.query('UPDATE classes SET join_code=$1 WHERE id=$2', [newJoinCode(), c.id]);
    }
    if (oldCodes.length) console.log(`🔐  Replaced ${oldCodes.length} join code(s) that were public in the old source code.`);

    // ── First admin (only if the school has no admin at all) ─────────────────
    const { rows: admins } = await client.query("SELECT id, email, password FROM users WHERE role='admin'");
    if (admins.length === 0) {
      const email = (process.env.ADMIN_EMAIL || OLD_ADMIN_EMAIL).trim().toLowerCase();
      let password = process.env.ADMIN_PASSWORD;
      let generated = false;
      if (!password) { password = generateTempPassword(14); generated = true; }
      await client.query(
        `INSERT INTO users (name, email, password, role, must_change_password)
         VALUES ('Administrator',$1,$2,'admin',TRUE)`,
        [email, await hashPassword(password)]
      );
      console.log('✅  Admin account created.');
      console.log(`    Email:    ${email}`);
      if (generated) {
        console.log(`    Password: ${password}`);
        console.log('    ⚠️  Shown ONCE. Save it now. You must change it at first login.');
      } else {
        console.log('    Password: (the ADMIN_PASSWORD you set). You must change it at first login.');
      }
    } else {
      // An admin that still has the password published in the old README must change it now.
      for (const a of admins) {
        if (await bcrypt.compare(OLD_ADMIN_PASSWORD, a.password)) {
          await client.query(
            'UPDATE users SET must_change_password=TRUE, token_version=token_version+1 WHERE id=$1', [a.id]
          );
          console.log(`🔐  Admin ${a.email} still used the old published password → forced to change it at next login.`);
        }
      }
    }

    await client.query('COMMIT');
    console.log('\n🎉  Seed complete.');
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

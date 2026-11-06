const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Cost 10 keeps logins fast on a small server; override with BCRYPT_ROUNDS (min 10).
const ROUNDS = Math.max(10, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);

// No 0/O/1/l/I so a password read out loud or copied from paper is not misread.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

// One-time password for resets and imports. Always has letters AND digits.
function generateTempPassword(length = 10) {
  let out;
  do {
    out = Array.from({ length }, () => CHARS[crypto.randomInt(CHARS.length)]).join('');
  } while (!/[A-Za-z]/.test(out) || !/\d/.test(out));
  return out;
}

function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

// Same rule everywhere: 8-72 chars, at least one letter and one digit.
// (72 because bcrypt ignores everything after 72 bytes.)
function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

// express-validator custom validator
function strongPassword(value) {
  const problem = passwordProblem(value);
  if (problem) throw new Error(problem);
  return true;
}

// Used so a login for an unknown email takes as long as a real one.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', ROUNDS);

module.exports = { generateTempPassword, hashPassword, passwordProblem, strongPassword, DUMMY_HASH, ROUNDS };

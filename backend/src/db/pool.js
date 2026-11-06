const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { Pool } = require('pg');

const isProd = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL is not set. Falling back to individual DB_* variables.');
}

const poolConfig = connectionString
  ? { connectionString }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME     || 'wmhs_db',
      user:     process.env.DB_USER     || 'wmhs_user',
      password: process.env.DB_PASSWORD || '',
    };

// DB_SSL=false  → no TLS (e.g. database on the same private network)
// DB_SSL=strict → TLS and verify the certificate (use this if your host gives you a CA)
// anything else → TLS, certificate not verified (works on most managed hosts)
function sslConfig() {
  if (!isProd || process.env.DB_SSL === 'false') return false;
  return { rejectUnauthorized: process.env.DB_SSL === 'strict' };
}

const pool = new Pool({
  ...poolConfig,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,          // a runaway query can never hold a connection for long
  ssl: sslConfig(),
});

// IMPORTANT: without this handler, a database restart emits an unhandled 'error'
// event on an idle connection and the whole Node process crashes.
pool.on('error', (err) => {
  console.error('Postgres pool error (connection will be replaced):', err.message);
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed!');
    console.error('   Error Code:', err.code);
    console.error('   Message:   ', err.message);
    if (connectionString) {
      console.error('   URL used:  ', connectionString.replace(/:([^:@]+)@/, ':****@'));
    }
    return;
  }
  release();
  console.log('✅ Database connected successfully.');
});

module.exports = pool;

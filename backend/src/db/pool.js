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
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'wmhs_db',
      user:     process.env.DB_USER     || 'wmhs_user',
      password: process.env.DB_PASSWORD || '',
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Increased timeout
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed!');
    console.error('   Error Code:', err.code);
    console.error('   Message:   ', err.message);
    console.error('   Environment:', process.env.NODE_ENV);
    if (connectionString) {
      const maskedUrl = connectionString.replace(/:([^:@]+)@/, ':****@');
      console.error('   URL used:  ', maskedUrl);
    }
    return;
  }
  release();
  console.log('✅ Database connected successfully.');
});

module.exports = pool;

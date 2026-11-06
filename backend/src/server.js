const path      = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const fs        = require('fs');

const PROD = process.env.NODE_ENV === 'production';

// ── Fail fast on unsafe configuration ────────────────────────────────────────
if (!process.env.JWT_SECRET || (PROD && process.env.JWT_SECRET.length < 32)) {
  console.error('FATAL: JWT_SECRET must be set (at least 32 characters in production).');
  process.exit(1);
}

const authRouter          = require('./routes/auth');
const adminRouter         = require('./routes/admin');
const teacherRouter       = require('./routes/teacher');
const studentRouter       = require('./routes/student');
const calendarRouter      = require('./routes/calendar');
const announcementsRouter = require('./routes/announcements');
const metaRouter          = require('./routes/meta');
const filesRouter         = require('./routes/files');
const { getStatus }       = require('./utils/serverTime');

const app  = express();
const PORT = process.env.PORT || 5000;

// Behind Render / any reverse proxy, req.ip must be the real client for rate limiting.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : (parseInt(process.env.TRUST_PROXY, 10) || 1));
app.disable('x-powered-by');

// ── Origins ──────────────────────────────────────────────────────────────────
const strip = (o) => String(o || '').trim().replace(/\/$/, '');
const allowedOrigins = [
  ...String(process.env.FRONTEND_URL || '').split(','),
  process.env.RENDER_EXTERNAL_URL,
].map(strip).filter(Boolean);

if (!PROD) allowedOrigins.push('http://localhost:3000', 'http://localhost:5000');
const frontendHosts = allowedOrigins.filter(o => /^https?:\/\//.test(o));

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", ...frontendHosts],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                 // same-origin / curl / server-to-server
    const o = strip(origin);
    if (allowedOrigins.includes(o)) return cb(null, true);
    return cb(null, false);                              // no CORS headers → browser blocks it
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limiting ────────────────────────────────────────────────────────────
const msg = (error) => ({ error });
const num = (v, d) => (parseInt(v, 10) > 0 ? parseInt(v, 10) : d);
const WINDOW = num(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000;

// A whole school may share one public IP, so the global limit is generous.
app.use('/api/', rateLimit({
  windowMs: WINDOW, limit: num(process.env.RATE_LIMIT_MAX_REQUESTS, 3000),
  standardHeaders: true, legacyHeaders: false,
  message: msg('Too many requests. Please try again in a few minutes.'),
  skip: (req) => req.path === '/health',
}));

// Per (ip + email): stops password guessing without locking out a classroom behind one IP.
const loginPerAccount = rateLimit({
  windowMs: 15 * 60 * 1000, limit: num(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase().slice(0, 120)}`,
  validate: { keyGeneratorIpFallback: false },
  message: msg('Too many login attempts for this account. Please wait 15 minutes.'),
});
// Per IP: stops one machine spraying thousands of different emails.
const loginPerIp = rateLimit({
  windowMs: 15 * 60 * 1000, limit: num(process.env.LOGIN_IP_RATE_LIMIT_MAX, 300),
  standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  message: msg('Too many failed logins from this network. Please wait 15 minutes.'),
});
app.use('/api/auth/login', loginPerIp, loginPerAccount);
app.use('/api/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000, limit: num(process.env.REGISTER_RATE_LIMIT_MAX, 300),
  standardHeaders: true, legacyHeaders: false, message: msg('Too many sign-ups from this network. Try again later.'),
}));
app.use('/api/auth/forgot', rateLimit({
  windowMs: 60 * 60 * 1000, limit: num(process.env.FORGOT_RATE_LIMIT_MAX, 30),
  standardHeaders: true, legacyHeaders: false, message: msg('Too many requests. Try again later.'),
}));

// ── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/teacher',       teacherRouter);
app.use('/api/student',       studentRouter);
app.use('/api/calendar',      calendarRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/meta',          metaRouter);
app.use('/api/files',         filesRouter);     // authenticated downloads (no public /uploads)

app.get('/api/server-time', (req, res) => {
  const s = getStatus();
  res.json({ serverTime: s.serverTime, timezone: s.timezone });
});

app.get('/api/health', async (req, res) => {
  try {
    await require('./db/pool').query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'db_unavailable' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── React frontend (production) ──────────────────────────────────────────────
if (PROD) {
  const buildPath = path.join(__dirname, '../../frontend/build');
  if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath, {
      setHeaders: (res, file) => {
        if (/service-worker\.js$|index\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
  } else {
    console.warn('Frontend build not found at', buildPath, '— run "npm run build".');
    app.get('/', (req, res) => res.status(404).send('Frontend build not found. Run "npm run build".'));
  }
}

// ── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
  if (err.type === 'entity.too.large')    return res.status(413).json({ error: 'Request too large.' });
  if (err.code === 'LIMIT_FILE_SIZE')     return res.status(413).json({ error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10}MB.` });
  if (err.name === 'MulterError')         return res.status(400).json({ error: 'Upload failed.' });
  console.error('Unhandled error:', req.method, req.path, err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r && r.message ? r.message : r));
process.on('uncaughtException', (e) => { console.error('Uncaught exception:', e); process.exit(1); });

if (require.main === module) {
  const server = app.listen(PORT, () => console.log(`WMHS API listening on :${PORT} (${PROD ? 'production' : 'development'})`));
  server.keepAliveTimeout = 65000;           // longer than most proxies' idle timeout
  server.headersTimeout = 66000;
  process.on('SIGTERM', () => {
    console.log('SIGTERM: draining…');
    server.close(() => require('./db/pool').end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}

module.exports = app;

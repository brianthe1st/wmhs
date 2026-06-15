require('dotenv').config();
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

// ── Route handlers ────────────────────────────────────────────────────────────
const authRouter          = require('./routes/auth');
const adminRouter         = require('./routes/admin');
const teacherRouter       = require('./routes/teacher');
const studentRouter       = require('./routes/student');
const calendarRouter      = require('./routes/calendar');
const announcementsRouter = require('./routes/announcements');
const { getStatus }       = require('./utils/serverTime');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow file serving
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5000',
].filter(Boolean).map(o => o.replace(/\/$/, ''));

app.use(cors({
  origin: (origin, cb) => {
    // Strip trailing slash for comparison
    const cleanOrigin = origin ? origin.replace(/\/$/, '') : null;

    if (
      !cleanOrigin || 
      allowedOrigins.includes(cleanOrigin) || 
      (process.env.NODE_ENV === 'production' && cleanOrigin.includes('onrender.com'))
    ) {
      return cb(null, true);
    }
    console.warn('🚫 CORS blocked origin:', origin);
    cb(new Error(`CORS: origin ${origin} not allowed.`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Serve Uploaded Files (Local Storage) ──────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Global rate limiter ───────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15) * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)    || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please try again later.' },
});
// app.use('/api/', globalLimiter); // DISABLED FOR TESTING

// Stricter limiter for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  skipSuccessfulRequests: true,
});
// app.use('/api/auth/login', loginLimiter); // DISABLED FOR TESTING

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/teacher',       teacherRouter);
app.use('/api/student',       studentRouter);
app.use('/api/calendar',      calendarRouter);
app.use('/api/announcements', announcementsRouter);

// ── Server Time Endpoint (No auth needed) ──────────────────────────────────
app.get('/api/server-time', (req, res) => {
  const status = getStatus();
  res.json({ serverTime: status.serverTime, timezone: status.timezone });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── 404 for unknown API routes ────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found.` });
});

// ── Serve React frontend in production ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '../../frontend/build');
  const fs = require('fs');
  
  if (fs.existsSync(buildPath)) {
    console.log('✅ Serving frontend from:', buildPath);
    app.use(express.static(buildPath));
    app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
  } else {
    console.warn('⚠️ Frontend build NOT found at:', buildPath);
    app.get('/', (req, res) => {
      res.status(404).send('Frontend build not found. Please run "npm run build" in the frontend directory.');
    });
  }
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10}MB.` });
  }
  
  // Log full error in all environments to help debugging on Render
  console.error('🔥 Global Error Handler:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error.' 
      : `Internal server error: ${err.message}` 
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
// Vercel handles the app object directly, but Render/Heroku/local need app.listen()
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🚀  WMHS API running on port ${PORT}`);
    console.log(`    Mode:    ${process.env.NODE_ENV || 'development'}`);
    console.log(`    Health:  http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = app;

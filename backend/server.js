require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');
const requireAuth  = require('./middleware/auth');
const { createBackup } = require('./routes/backup');
const { registerWebhook } = require('./telegram');

const app = express();

// ── Trust Railway's proxy (required for rate limiter + real IP) ───────────
app.set('trust proxy', 1);

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

// ── CORS — only allow the configured frontend origin ────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin:      FRONTEND_URL,
  credentials: true,           // required for cookies
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));   // cap payload size
app.use(cookieParser());

// ── Rate limiters ────────────────────────────────────────────────────────────
// Login: 10 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// General API: 300 requests per IP per minute (prevents scraping / DoS)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      300,
  message:  { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth/login',      loginLimiter);
app.use('/api',                 apiLimiter);

app.use('/api/auth',            require('./routes/auth'));
app.use('/api/telegram',        require('./routes/telegram'));   // public — Telegram webhook
app.use('/api/items',           requireAuth, require('./routes/items'));
app.use('/api/requests',        requireAuth, require('./routes/requests'));
app.use('/api/users',           requireAuth, require('./routes/users'));
app.use('/api/activity',        requireAuth, require('./routes/activity'));
app.use('/api/backup',          requireAuth, require('./routes/backup').router);

// ── Serve React frontend in production ────────────────────────────────────
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// ── Error handler ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

// ── Auto-backup: on startup + every 24 hours ──────────────────────────────
function runAutoBackup() {
  try {
    createBackup();
    console.log('[backup] Auto-backup saved.');
  } catch (e) {
    console.error('[backup] Auto-backup failed:', e.message);
  }
}
runAutoBackup();
setInterval(runAutoBackup, 24 * 60 * 60 * 1000);

// ── Borrow return reminders: every hour ───────────────────────────────────
const { runBorrowReminders } = require('./reminders');
runBorrowReminders().catch(e => console.error('[reminders] Startup run failed:', e.message));
setInterval(() => {
  runBorrowReminders().catch(e => console.error('[reminders] Hourly run failed:', e.message));
}, 60 * 60 * 1000);

// ── Register Telegram webhook (production only) ───────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL) {
  registerWebhook(process.env.FRONTEND_URL);
}

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

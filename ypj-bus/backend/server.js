require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');
const requireAuth  = require('./middleware/auth');
const { requireRole } = require('./middleware/auth');
const db           = require('./db');
const { reconcileCardStatuses, todayWIT, materializeDutySchedule, getSetting, setSetting } = require('./lib/cards');
const { createBackup, createUploadsBackup } = require('./routes/backup');

const app = express();

// ── Trust Railway's proxy (required for rate limiter + real IP) ─────────────
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

// ── Body parsing ────────────────────────────────────────────────────────────
// A submission carries the student photo plus the signature PNG as base64 data
// URLs. The browser compresses the photo to ≤100 KB first, so a normal body is
// well under 400 KB; the headroom here exists only so an uncompressed 2 MB photo
// still reaches the route and gets the friendly "melebihi batas penyimpanan"
// message instead of an opaque body-size error.
//
// 8mb (not 4mb): event bus request attachments allow a 5 MB PDF/image, which
// base64-encodes to ~6.8 MB — needs to fit with room to spare for the rest of
// the JSON body, or it hits Express's raw body-size limit instead of
// lib/files.js's friendly "melebihi batas penyimpanan" message.
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

// ── Rate limiters ───────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      300,
  message:  { error: 'Terlalu banyak permintaan. Mohon perlambat.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Submitting is expensive (two file writes): 12 per hour per IP is generous for
// a family with several children and still blocks abuse.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      12,
  message:  { error: 'Terlalu banyak pengajuan dari perangkat ini. Coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Routes ──────────────────────────────────────────────────────────────────
// Every /api response is per-request dynamic data (schedules, applications,
// rotation state...) that can change from one admin action to the next —
// Express's default weak ETag is meant for exactly this, but a browser or an
// intermediary cache sitting between the client and this server has no other
// signal that these responses are never safe to reuse across requests.
// Explicit no-store closes that gap regardless of which layer was doing it.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api',               apiLimiter);

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/meta',         requireAuth, require('./routes/meta'));
app.use('/api/applications', requireAuth, submitLimiterForWrites, require('./routes/applications'));
app.use('/api/cards',        requireAuth, require('./routes/cards'));
app.use('/api/complaints',   requireAuth, require('./routes/complaints'));
// Both sides live here: parent routes are open to any signed-in user, and the
// /threads endpoints check for staff themselves.
app.use('/api/chat',         requireAuth, require('./routes/chat'));
app.use('/api/files',        requireAuth, require('./routes/files'));
app.use('/api/scan',         requireAuth,
                             requireRole('attendant', 'helper', 'transport_admin', 'school_staff'),
                             require('./routes/scan'));
app.use('/api/safety',       requireAuth,
                             requireRole('attendant', 'driver', 'helper', 'transport_admin', 'school_staff'),
                             require('./routes/safety'));
// Stop-progress map — Helper, Parent, and Guru per the feature request, plus
// the same supervisors read-only everywhere else gets in on (leader/admin/
// transport_admin). Not GPS (see routes/track.js) so there's nothing
// sensitive being exposed beyond what /api/meta's bus list already shows.
app.use('/api/track',        requireAuth,
                             requireRole('parent', 'helper', 'school_staff', 'leader', 'admin', 'transport_admin'),
                             require('./routes/track'));
// 'leader' and 'admin' (Admin Sekolah) are read-only supervisors — allowed
// in here, but routes/admin.js itself blocks every non-GET request from
// either role (see the router.use guard near the top of that file).
app.use('/api/admin',        requireAuth, requireRole('transport_admin', 'leader', 'admin'),
                             require('./routes/admin'));
// Not under /api/admin: Leader may raise a request here (unlike everywhere
// else in that router), only approving one is Tim Transportasi-only, and
// Driver/Helper/Guru are let in read-only (see the seesAll comment in
// routes/eventRequests.js) to know about an upcoming event trip and which
// bus gets assigned. Role checks live per-route inside eventRequests.js.
app.use('/api/event-requests', requireAuth,
                             requireRole('admin', 'leader', 'transport_admin', 'driver', 'helper', 'school_staff'),
                             require('./routes/eventRequests'));
// Database backups — Super Admin + Tim Transportasi only (leader/admin are
// read-only supervisors and don't get this). super_admin passes every
// requireRole check, so listing 'transport_admin' here covers both.
app.use('/api/backup',       requireAuth, requireRole('transport_admin'),
                             require('./routes/backup').router);
// Guru (school_staff) dashboard — read-only aggregate/roster data with no
// operational fields (see routes/guru.js). Its own narrow router rather than
// widening /api/admin, since that router has no per-route granularity beyond
// its blanket write-block and would otherwise expose the whole verification
// queue, accounts, and activity log to Guru too.
app.use('/api/guru',         requireAuth, requireRole('school_staff'),
                             require('./routes/guru'));

// Only the POST that writes files needs the tighter limit; listing is cheap.
function submitLimiterForWrites(req, res, next) {
  if (req.method === 'POST' && req.path === '/') return submitLimiter(req, res, next);
  next();
}

app.get('/api/health', (req, res) => res.json({ ok: true, at: new Date().toISOString() }));

// ── Serve React frontend in production ──────────────────────────────────────
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
  // { index: false }: without this, express.static serves dist/index.html
  // for GET / itself (its default directory-index behaviour) using ITS OWN
  // default Cache-Control ("public, max-age=0") — before the catch-all
  // route below ever runs, silently defeating the no-store set there. Every
  // request for index.html must go through that route so it's never cached
  // (it's what references the current content-hashed JS/CSS bundle names);
  // the hashed asset files themselves still get served — and stay safely
  // long-cacheable — by this same middleware for every other path.
  app.use(express.static(DIST, { index: false }));
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({
    // 4xx messages are written for parents to read, so they are always passed
    // through; 5xx details stay in the server log.
    error: err.status && err.status < 500
      ? err.message
      : (process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan pada server.' : err.message),
  });
});

// ── Nightly housekeeping: expire cards, lift finished suspensions ───────────
function runReconcile() {
  try {
    const { expired, lifted } = reconcileCardStatuses();
    if (expired || lifted) {
      console.log(`[cards] ${expired} kartu kadaluarsa, ${lifted} penangguhan berakhir.`);
    }
  } catch (e) {
    console.error('[cards] Reconcile failed:', e.message);
  }
}
runReconcile();
setInterval(runReconcile, 6 * 60 * 60 * 1000);

// ── Auto-backup: on startup + every 24 hours ──────────────────────────────
// Database and uploads (photos/signatures) are backed up separately — the
// uploads archive can be considerably larger and there's no reason a slow
// tar should block the database snapshot from being written.
function runAutoBackup() {
  try {
    createBackup();
    console.log('[backup] Auto-backup (database) saved.');
  } catch (e) {
    console.error('[backup] Auto-backup (database) failed:', e.message);
  }
  try {
    createUploadsBackup();
    console.log('[backup] Auto-backup (uploads) saved.');
  } catch (e) {
    console.error('[backup] Auto-backup (uploads) failed:', e.message);
  }
}
runAutoBackup();
setInterval(runAutoBackup, 24 * 60 * 60 * 1000);

// ── Self-heal: periodic integrity check ─────────────────────────────────────
// node:sqlite is still experimental (see the startup warning it prints), and
// this app has hit real index corruption in production (indexes on
// applications/consents/bus_id_cards/users out of sync with their table
// data — table data itself was intact, REINDEX fixed it). It only ever
// surfaces once some request happens to touch the specific broken index
// entry, by which point a parent is looking at "Terjadi kesalahan pada
// server." with no idea why. This runs on the app's own long-lived `db`
// connection — never a second process opening the file independently, which
// is the classic way to actually cause corruption on a volume whose file
// locking can't be fully trusted — so a clean run costs nothing.
function runIntegrityCheck() {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
    if (ok) return;
    console.error('[integrity] Corruption detected:', JSON.stringify(rows));
    db.exec('REINDEX');
    const after = db.prepare('PRAGMA integrity_check').all();
    const fixed = after.length === 1 && after[0].integrity_check === 'ok';
    console.log(fixed
      ? '[integrity] REINDEX fixed it.'
      : '[integrity] REINDEX did NOT fully fix it: ' + JSON.stringify(after));
  } catch (e) {
    console.error('[integrity] Check failed:', e.message);
  }
}
runIntegrityCheck();
setInterval(runIntegrityCheck, 10 * 60 * 1000);

// ── Duty-slot rotation: re-materialize when a new WIT day starts ───────────
// Daily, not just weekly: a duty slot's TPS/trips can differ by weekday
// (small buses split dropoff coverage across days — Senin/Rabu vs Selasa/
// Kamis/Jumat), even though which bus fills a duty_number only rotates
// weekly. Checked on startup + every few hours rather than scheduled for
// exactly midnight — cheap to check, and catches the boundary even if the
// container happened to be mid-restart right then. materializeDutySchedule
// itself no-ops on a weekend and skips any slot/day with nothing configured,
// so this is harmless until an admin actually sets up the rotation.
function runDutyRotationCheck() {
  try {
    const today = todayWIT();
    if (getSetting('duty_materialized_date') === today) return;
    const applied = materializeDutySchedule(today);
    setSetting('duty_materialized_date', today);
    if (applied.length) {
      console.log(`[duty] Rotasi ${today} diterapkan ke ${applied.length} bis.`);
    }
  } catch (e) {
    console.error('[duty] Rotation check failed:', e.message);
  }
}
runDutyRotationCheck();
setInterval(runDutyRotationCheck, 3 * 60 * 60 * 1000);

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`YPJ Bus server running on http://localhost:${PORT}`));

// ── Graceful shutdown: checkpoint WAL before the process dies ──────────────
// Every deploy kills this process (Railway sends SIGTERM, then SIGKILL after
// a grace period) to swap in the new one. In WAL journal mode, a committed
// write lives in bus.sqlite-wal until something checkpoints it into the main
// file — normally on its own schedule, but with no handler here the process
// could be SIGKILLed mid-window, and whether that write survives then depends
// on the wal/shm files actually making it onto the volume before the new
// container starts (this is the leading suspect for duty-schedule settings
// that were saved, confirmed in the UI, then gone after the next deploy).
// Checkpointing + closing on SIGTERM removes that window entirely.
function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, checkpointing WAL and closing.`);
  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (e) {
      console.error('[shutdown] checkpoint/close failed:', e.message);
    }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

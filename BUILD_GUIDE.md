# How to Build a School Inventory App — Complete Guide
### Based on YPJ KK Inventory System (for replication at YPJ Tembagapura or any campus)

---

## Overview

This guide walks you through building a full-stack web inventory app from scratch — the same way YPJ KK Inventory was built. By the end you will have a live, production web app hosted at your own domain, with:

- Login system with 5 roles (Manager, Storekeeper, Principal, Teacher, Other)
- Inventory management per store location
- Request & approval workflow with auto stock updates
- Email notifications (Resend API) — including welcome email with set-password link
- Principal CC notifications on submission and approval/rejection
- Telegram bot notifications
- CSV import/export
- Database backup system
- In-app user guide
- Barcode scanner (mobile camera) for quick item lookup and update
- PWA support — installable as a home-screen shortcut on Android & iOS

**Stack:** Node.js + Express (backend) · React + Vite (frontend) · SQLite (database) · Railway (hosting)

---

## Part 1 — Prerequisites

### Tools to install on your Mac
1. **Node.js** (v20+) — download from [nodejs.org](https://nodejs.org)
2. **Git** — already on Mac, or install via Xcode: `xcode-select --install`
3. **VS Code** — code editor from [code.visualstudio.com](https://code.visualstudio.com)

### Accounts to create (all free tiers work)
| Service | URL | Purpose |
|---|---|---|
| GitHub | github.com | Store your code |
| Railway | railway.app | Host the app |
| Resend | resend.com | Send emails |
| Telegram | telegram.org | Notification bot |

---

## Part 2 — Project Structure

Create this folder structure from scratch:

```
YPJTembagapura-Inventory/        ← root folder (rename as needed)
├── package.json                 ← root scripts
├── railway.json                 ← Railway build config
├── .gitignore
├── backend/
│   ├── package.json
│   ├── server.js                ← Express entry point
│   ├── db.js                    ← SQLite setup + schema
│   ├── mailer.js                ← Email via Resend
│   ├── telegram.js              ← Telegram bot
│   ├── reminders.js             ← Borrow return reminder scheduler
│   ├── middleware/
│   │   └── auth.js              ← JWT cookie middleware
│   └── routes/
│       ├── auth.js
│       ├── items.js
│       ├── requests.js
│       ├── users.js
│       ├── activity.js
│       └── backup.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── index.css
        ├── components/
        │   ├── Layout/
        │   │   ├── Topbar.jsx
        │   │   └── Sidebar.jsx
        │   └── shared/
        │       ├── Toast.jsx
        │       └── Modal.jsx    (optional)
        └── pages/
            ├── LoginPage.jsx
            ├── DashboardPage.jsx
            ├── InventoryPage.jsx
            ├── AddItemPage.jsx
            ├── RequestsPage.jsx
            ├── ApprovalsPage.jsx
            ├── UsersPage.jsx
            ├── ReportsPage.jsx
            ├── ActivityLogPage.jsx
            ├── BackupPage.jsx
            └── HelpPage.jsx
```

---

## Part 3 — Backend Setup

### Step 1 — Create root package.json

```json
{
  "name": "school-inventory",
  "private": true,
  "scripts": {
    "build":        "cd frontend && npm install && npm run build",
    "start":        "cd backend && node server.js",
    "dev:backend":  "cd backend && node server.js",
    "dev:frontend": "cd frontend && npm run dev",
    "install:all":  "cd backend && npm install && cd ../frontend && npm install"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### Step 2 — Create railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd backend && npm install && cd ../frontend && npm install && npm run build"
  },
  "deploy": {
    "startCommand": "node backend/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

### Step 3 — Create .gitignore

```
node_modules/
frontend/dist/
backend/database.sqlite
backend/backups/
.env
*.env
```

### Step 4 — Create backend/package.json

```json
{
  "name": "school-inventory-backend",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.3.1",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2"
  }
}
```

> ⚠️ Node.js v22+ includes `node:sqlite` built-in — no extra package needed for the database.

Run in terminal:
```bash
cd backend && npm install
```

### Step 5 — Create backend/db.js (Database Schema)

This file creates all tables and runs migrations automatically.

```javascript
require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// In production (Railway), DB_PATH points to a persistent volume.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const DB_DIR  = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

// ── Create tables ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    code           TEXT,
    category       TEXT    NOT NULL,
    store_category TEXT    NOT NULL DEFAULT 'Supplies',
    location       TEXT    NOT NULL DEFAULT 'SD SMP YPJ KK',
    unit_school    TEXT    NOT NULL DEFAULT 'All',
    quantity       INTEGER NOT NULL DEFAULT 0,
    max_quantity   INTEGER NOT NULL DEFAULT 0,
    unit_name      TEXT    NOT NULL DEFAULT 'pcs',
    description    TEXT,
    min_threshold  INTEGER NOT NULL DEFAULT 1,
    condition      TEXT    NOT NULL DEFAULT 'Good',
    po_number      TEXT,
    created_at     TEXT    DEFAULT (datetime('now')),
    updated_at     TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    role           TEXT    NOT NULL DEFAULT 'Teacher'
                   CHECK(role IN ('Manager','Storekeeper','Principal','Teacher','Other')),
    unit_school    TEXT    NOT NULL DEFAULT 'All',
    location       TEXT,
    store_category TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    password_hash  TEXT    NOT NULL,
    telegram_chat_id       TEXT,
    password_reset_token   TEXT,
    password_reset_expires TEXT,
    created_at     TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL REFERENCES items(id),
    requester_name  TEXT    NOT NULL,
    requester_email TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK(type IN ('used-up','borrow')),
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_school     TEXT    NOT NULL DEFAULT 'All',
    purpose         TEXT,
    return_date     TEXT,
    group_id        TEXT,
    category        TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected','returned')),
    approved_at     TEXT,
    returned_at     TEXT,
    notes           TEXT,
    forwarded       INTEGER NOT NULL DEFAULT 0,
    forwarded_note  TEXT,
    approval_notes  TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_name  TEXT,
    action     TEXT NOT NULL,
    target     TEXT,
    detail     TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── First-run seed: create Manager account if no users exist ───────────────
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const bcrypt = require('bcryptjs');
  // Change these defaults before deploying!
  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@ypj.sch.id';
  const adminPassword = process.env.ADMIN_PASSWORD || 'YPJ2025';
  const adminName     = process.env.ADMIN_NAME     || 'Administrator';
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(`
    INSERT INTO users (name, email, role, unit_school, password_hash)
    VALUES (?, ?, 'Manager', 'All', ?)
  `).run(adminName, adminEmail, hash);
  console.log(`[db] First-run seed: Manager account created (${adminEmail}).`);
}

module.exports = db;
```

### Step 6 — Create backend/middleware/auth.js

```javascript
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
};
```

### Step 7 — Create backend/routes/auth.js

```javascript
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const router   = express.Router();

const JWT_SECRET  = process.env.JWT_SECRET  || 'dev-secret-change-in-production';
const IS_PROD     = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: IS_PROD ? 'none' : 'lax',
  maxAge:   8 * 60 * 60 * 1000,   // 8 hours
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password.' });

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, unit_school: user.unit_school };
  const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, COOKIE_OPTS);
  res.json(payload);
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-in-production');
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
});

// GET /api/auth/me/full — returns telegram_chat_id too
router.get('/me/full', require('../middleware/auth'), (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, unit_school, telegram_chat_id FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PATCH /api/auth/me — update own telegram_chat_id
router.patch('/me', require('../middleware/auth'), (req, res) => {
  const { telegram_chat_id } = req.body;
  db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').run(telegram_chat_id || null, req.user.id);
  res.json({ ok: true });
});

// GET /api/auth/verify-reset?token=xxx — validate set-password link
router.get('/verify-reset', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token is required.' });
  const user = db.prepare(`
    SELECT id, name, email, role, unit_school
    FROM users
    WHERE password_reset_token = ? AND password_reset_expires > datetime('now')
  `).get(token);
  if (!user) return res.status(400).json({ error: 'This link is invalid or has expired. Ask your Manager to resend the invitation.' });
  res.json({ name: user.name, email: user.email, role: user.role, unit_school: user.unit_school });
});

// POST /api/auth/set-password — set password using token
router.post('/set-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const user = db.prepare(`
    SELECT id FROM users
    WHERE password_reset_token = ? AND password_reset_expires > datetime('now')
  `).get(token);
  if (!user) return res.status(400).json({ error: 'This link is invalid or has expired.' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL
    WHERE id = ?
  `).run(hash, user.id);
  res.json({ ok: true });
});

module.exports = router;
```

### Step 8 — Create backend/server.js

```javascript
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');
const requireAuth  = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' } });
const apiLimiter   = rateLimit({ windowMs: 60*1000, max: 300,
  message: { error: 'Too many requests. Please slow down.' } });

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/telegram', require('./routes/telegram'));   // public: Telegram webhook
app.use('/api/items',    requireAuth, require('./routes/items'));
app.use('/api/requests', requireAuth, require('./routes/requests'));
app.use('/api/users',    requireAuth, require('./routes/users'));
app.use('/api/activity', requireAuth, require('./routes/activity'));
app.use('/api/backup',   requireAuth, require('./routes/backup').router);

// Serve React frontend in production
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*$/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

// Auto-backup on start + every 24 hours
const { createBackup } = require('./routes/backup');
function runAutoBackup() {
  try { createBackup(); console.log('[backup] Auto-backup saved.'); }
  catch (e) { console.error('[backup] Auto-backup failed:', e.message); }
}
runAutoBackup();
setInterval(runAutoBackup, 24 * 60 * 60 * 1000);

// Register Telegram webhook in production
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL) {
  require('./telegram').registerWebhook(process.env.FRONTEND_URL);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
```

---

## Part 4 — Key Backend Routes

### Items route (`backend/routes/items.js`)

Key concepts:
- **`staffOnly` middleware** — only Manager and Storekeeper can add/edit/delete items
- **Storekeeper location lock** — Storekeepers can only edit items in their assigned store
- **Store Category → Category mapping** — categories are grouped under a parent store category

```javascript
// Adapt these constants for Tembagapura's stores and categories:
const LOCATIONS   = ['PAUD YPJ TPRA', 'SD SMP YPJ TPRA'];
const UNIT_SCHOOLS = ['All', 'PAUD', 'SD', 'SMP'];
// ... keep the rest of categories/units the same
```

> 💡 The full `items.js` file handles: GET list with filters, GET single, POST create, PUT update, DELETE (with guard for active requests), POST import CSV.

### Requests route (`backend/routes/requests.js`)

Key concepts:
- **Cart submission** — one `group_id` (UUID) ties multiple items together as one request
- **`getApproverRecipients(unit_school)`** — routes notifications to the right storekeepers
- **Auto stock deduction** — when approved, `quantity` is decremented atomically
- **Auto stock restore** — when a borrow is returned, `quantity` is incremented back
- **Storekeeper location scoping** — Storekeepers only see requests from their own store location. Use a `storekeepWhere(user)` helper that injects a safe SQL fragment based on `req.user.unit_school`:

```javascript
function storekeepWhere(user) {
  if (!user || user.role !== 'Storekeeper') return '';
  if (user.unit_school === 'PAUD')                             return `AND r.unit_school = 'PAUD'`;
  if (user.unit_school === 'SD' || user.unit_school === 'SMP') return `AND r.unit_school IN ('SD','SMP')`;
  return '';
}
// Apply to GET /, GET /groups, GET /stats queries:
// WHERE ... ${storekeepWhere(req.user)}
```

- **Principal CC notifications** — on submission AND on approve/reject, notify the matching Principal(s). SD and SMP principals are separate (exact `unit_school` match):

```javascript
function getPrincipalRecipients(unit_school) {
  if (['PAUD','SD','SMP'].includes(unit_school)) {
    return db.prepare(`SELECT name, email FROM users WHERE role='Principal' AND unit_school=? AND is_active=1`).all(unit_school);
  }
  return db.prepare(`SELECT name, email FROM users WHERE role='Principal' AND is_active=1`).all();
}
```

### Users route (`backend/routes/users.js`)

Key concepts:
- Manager only can create/edit/delete users
- Password is hashed with `bcryptjs` before storing
- CSV bulk import available
- **Welcome email** — when a new user is created, a `crypto.randomBytes(32)` token is generated with a 72-hour expiry and a "Set My Password" email is sent via Resend
- **Resend invite** — `POST /api/users/:id/resend-invite` regenerates the token and resends the welcome email
- **Valid roles** — `['Manager', 'Storekeeper', 'Principal', 'Teacher', 'Other']`

```javascript
const crypto = require('crypto');
const { sendWelcomeEmail } = require('../mailer');

function createWelcomeToken(userId) {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`UPDATE users SET password_reset_token=?, password_reset_expires=? WHERE id=?`)
    .run(token, expires, userId);
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${appUrl}/set-password?token=${token}`;
}

// After creating a user:
const setPasswordUrl = createWelcomeToken(newUser.id);
sendWelcomeEmail({ name, email, role, unit_school, setPasswordUrl }).catch(() => {});

// POST /api/users/:id/resend-invite
router.post('/:id/resend-invite', requireAuth, managerOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const setPasswordUrl = createWelcomeToken(user.id);
  sendWelcomeEmail({ name: user.name, email: user.email, role: user.role,
    unit_school: user.unit_school, setPasswordUrl }).catch(() => {});
  res.json({ ok: true });
});
```

### Backup route (`backend/routes/backup.js`)

Key concepts:
- `createBackup()` copies the `.sqlite` file into a `/backups/` folder with a timestamp
- Keeps only the last 14 backups (auto-deletes older ones)
- Exposed as `GET /api/backup/list` and `GET /api/backup/download`

### Borrow return reminders (`backend/reminders.js`)

A standalone module that runs on a schedule (every hour) to send email reminders for borrowed items approaching their return date.

**How it works:**
- Queries all `requests` where `type='borrow'`, `status='approved'`, and `DATE(return_date)` equals today + 2 or today + 1
- Sends a reminder email via `sendBorrowReminder()` in mailer.js
- Sets `reminder_2d_sent = 1` or `reminder_1d_sent = 1` after sending — prevents duplicate emails

**DB columns required** (add to `db.js` migrations):
```javascript
const reqCols = db.prepare(`PRAGMA table_info(requests)`).all().map(c => c.name);
if (!reqCols.includes('reminder_2d_sent')) db.exec(`ALTER TABLE requests ADD COLUMN reminder_2d_sent INTEGER NOT NULL DEFAULT 0`);
if (!reqCols.includes('reminder_1d_sent')) db.exec(`ALTER TABLE requests ADD COLUMN reminder_1d_sent INTEGER NOT NULL DEFAULT 0`);
```

**reminders.js:**
```javascript
const db = require('./db');
const { sendBorrowReminder } = require('./mailer');

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];   // "YYYY-MM-DD"
}

async function runBorrowReminders() {
  const targets = [
    { daysLeft: 2, col: 'reminder_2d_sent', targetDate: dateStr(2) },
    { daysLeft: 1, col: 'reminder_1d_sent', targetDate: dateStr(1) },
  ];
  for (const { daysLeft, col, targetDate } of targets) {
    const rows = db.prepare(`
      SELECT r.id, r.requester_name, r.requester_email,
             r.quantity, r.return_date, i.name AS item_name, i.unit_name
      FROM requests r JOIN items i ON r.item_id = i.id
      WHERE r.type = 'borrow' AND r.status = 'approved'
        AND r.${col} = 0 AND DATE(r.return_date) = ?
    `).all(targetDate);

    for (const row of rows) {
      await sendBorrowReminder({ name: row.requester_name, email: row.requester_email,
        itemName: row.item_name, quantity: row.quantity, unitName: row.unit_name || 'pcs',
        returnDate: row.return_date, daysLeft });
      db.prepare(`UPDATE requests SET ${col} = 1 WHERE id = ?`).run(row.id);
    }
  }
}
module.exports = { runBorrowReminders };
```

**Schedule in server.js** (alongside the auto-backup block):
```javascript
const { runBorrowReminders } = require('./reminders');
runBorrowReminders().catch(e => console.error('[reminders] Startup run failed:', e.message));
setInterval(() => {
  runBorrowReminders().catch(e => console.error('[reminders] Hourly run failed:', e.message));
}, 60 * 60 * 1000);
```

> 💡 Running every hour (not once per day) ensures reminders go out within 1 hour of midnight regardless of when the server started.

---

## Part 5 — Email Notifications (Resend)

### Why Resend (not Gmail SMTP)?

Railway uses IPv6 internally. Gmail SMTP only accepts IPv4 connections — so all SMTP libraries fail on Railway. Resend uses HTTPS (not raw TCP), so it always works.

### Setup Steps

1. Go to [resend.com](https://resend.com) and sign up
2. Add your domain (e.g. `ypj.sch.id`) under **Domains**
3. Add the 4 DNS records Resend shows you to your domain registrar:
   - TXT record for DKIM verification
   - MX record
   - SPF record
   - DMARC record
4. Wait for all 4 records to show ✅ Verified in Resend
5. Create an **API Key** under API Keys → copy it
6. Add `RESEND_API_KEY=re_xxxx` to Railway environment variables

### backend/mailer.js

```javascript
require('dotenv').config();
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_DOMAIN    = process.env.MAIL_FROM_DOMAIN || 'ypj.sch.id';
const FROM           = `"YPJ Inventory" <noreply@${FROM_DOMAIN}>`;

async function send({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[mailer] RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

// Export individual email functions:
// sendRequestSubmitted, sendRequestApproved, sendRequestRejected,
// sendLowStockAlert, sendNewRequestAlert, sendRequestForwarded

// ── Welcome email (sent when a new user is created) ───────────────────────
async function sendWelcomeEmail({ name, email, role, unit_school, setPasswordUrl }) {
  const appUrl = process.env.FRONTEND_URL || 'https://kkinventory.ypj.sch.id';
  await send({
    to: email,
    subject: `[YPJ KK Inventory] Welcome, ${name} — Set Your Password`,
    html: wrap(`
      <p>Dear <strong>${name}</strong>,</p>
      <p>Your account for the <strong>YPJ KK Inventory System</strong> has been created.</p>
      ${table([['Name', name], ['Email', email], ['Role', role], ['Unit / School', unit_school || 'All']])}
      <p>Click the button below to set your password (link expires in <strong>72 hours</strong>):</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${setPasswordUrl}" style="...">🔐 Set My Password</a>
      </div>

      <!-- PWA install instructions -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <p style="font-weight:700;color:#1a2f5e">📱 Install the App on Your Phone</p>
        <p>App URL: <a href="${appUrl}">${appUrl}</a></p>

        <p><strong>🤖 Android (Chrome)</strong></p>
        <ol>
          <li>Open the URL above in <strong>Chrome</strong></li>
          <li>Tap ⋮ menu → <strong>"Add to Home Screen"</strong> or <strong>"Install app"</strong></li>
          <li>Tap Add</li>
        </ol>

        <p><strong>🍎 iPhone / iPad (Safari)</strong></p>
        <ol>
          <li>Open the URL above in <strong>Safari</strong> (not Chrome)</li>
          <li>Tap the Share button (□↑) → <strong>"Add to Home Screen"</strong></li>
          <li>Tap Add</li>
        </ol>
      </div>
    `),
  });
}

// ── For TPRA: update appUrl fallback ─────────────────────────────────────
// const appUrl = process.env.FRONTEND_URL || 'https://tprainventory.ypj.sch.id';

// ── Principal CC on request submission ───────────────────────────────────
async function sendPrincipalSubmissionNotice({ principal, requester, items, groupId }) { /* ... */ }

// ── Principal CC on approve/reject ───────────────────────────────────────
async function sendPrincipalDecisionNotice({ principal, requester, items, status, notes }) { /* ... */ }

// ── Borrow return reminder ────────────────────────────────────────────────
async function sendBorrowReminder({ name, email, itemName, quantity, unitName, returnDate, daysLeft }) {
  const urgencyColor = daysLeft === 1 ? '#dc2626' : '#d97706';
  const urgencyLabel = daysLeft === 1 ? '⚠️ Tomorrow!' : '📅 In 2 days';
  // ... branded HTML table with item name, quantity, due date highlighted in urgency colour
  await send({ to: email,
    subject: `[YPJ Inventory] 🔔 Return Reminder — ${itemName} due ${daysLeft === 1 ? 'tomorrow' : 'in 2 days'}`,
    html });
}

module.exports = { send, sendWelcomeEmail, sendPrincipalSubmissionNotice, sendPrincipalDecisionNotice,
  sendBorrowReminder /* ... */ };
```

---

## Part 6 — Telegram Bot Notifications

### Setup Steps

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow prompts → give it a name (e.g. "YPJ Tembagapura Inventory")
3. BotFather gives you a **Bot Token** like `7123456789:ABCdef...`
4. Add `TELEGRAM_BOT_TOKEN=...` to Railway environment variables
5. Users connect by messaging your bot `/start` and pasting their Chat ID into their profile

### backend/telegram.js (key structure)

```javascript
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE  = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text) {
  if (!TOKEN || !chatId) return;
  await fetch(`${BASE}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(e => console.error('[telegram] sendMessage failed:', e.message));
}

async function registerWebhook(appUrl) {
  // Registers Railway app URL as the Telegram webhook so /start etc. work
  const url = `${appUrl}/api/telegram/webhook`;
  await fetch(`${BASE}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

module.exports = { sendMessage, registerWebhook };
```

---

## Part 7 — Frontend Setup

### Step 1 — Create frontend/package.json

```json
{
  "name": "school-inventory-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1",
    "xlsx": "^0.18.5",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.3.1",
    "html5-qrcode": "^2.3.8"
  }
}
```

> ⚠️ `vite` must be in `dependencies` (not `devDependencies`) or Railway's build will fail with `vite: not found`.

### Step 2 — Create frontend/vite.config.js

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

### Step 3 — Create frontend/src/api.js (centralised fetch)

```javascript
const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',         // send cookies
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('inv:logout'));
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  login:    (data)    => request('/auth/login',   { method: 'POST', body: JSON.stringify(data) }),
  logout:   ()        => request('/auth/logout',  { method: 'POST' }),
  me:       ()        => request('/auth/me'),
  getMe:    ()        => request('/auth/me/full'),
  updateMe: (data)    => request('/auth/me',      { method: 'PATCH', body: JSON.stringify(data) }),

  // Auth (additions)
  verifyResetToken: (token) => request(`/auth/verify-reset?token=${encodeURIComponent(token)}`),
  setPassword:      (data)  => request('/auth/set-password', { method: 'POST', body: JSON.stringify(data) }),

  // Items
  getItems:   (params = {}) => request('/items?' + new URLSearchParams(params)),
  getItem:    (id)          => request(`/items/${id}`),
  createItem: (data)        => request('/items',        { method: 'POST',   body: JSON.stringify(data) }),
  updateItem: (id, data)    => request(`/items/${id}`,  { method: 'PUT',    body: JSON.stringify(data) }),
  deleteItem: (id)          => request(`/items/${id}`,  { method: 'DELETE' }),
  importItems:(data)        => request('/items/import', { method: 'POST',   body: JSON.stringify(data) }),
  getItemMeta:()            => request('/items/meta'),

  // Requests
  getRequests:    (p = {})    => request('/requests?'          + new URLSearchParams(p)),
  getGroups:      (p = {})    => request('/requests/groups?'   + new URLSearchParams(p)),  // ← use for badge count
  submitCart:     (data)      => request('/requests/cart',     { method: 'POST',  body: JSON.stringify(data) }),
  approveGroup:   (gid, data) => request(`/requests/groups/${encodeURIComponent(gid)}/approve`, { method: 'PUT', body: JSON.stringify(data) }),
  rejectGroup:    (gid, data) => request(`/requests/groups/${encodeURIComponent(gid)}/reject`,  { method: 'PUT', body: JSON.stringify(data) }),
  forwardGroup:   (gid, data) => request(`/requests/groups/${encodeURIComponent(gid)}/forward`, { method: 'PUT', body: JSON.stringify(data) }),
  approveRequest: (id, data)  => request(`/requests/${id}/approve`, { method: 'PUT', body: JSON.stringify(data) }),
  rejectRequest:  (id, data)  => request(`/requests/${id}/reject`,  { method: 'PUT', body: JSON.stringify(data) }),
  returnRequest:  (id)        => request(`/requests/${id}/return`,  { method: 'PUT' }),
  forwardRequest: (id, data)  => request(`/requests/${id}/forward`, { method: 'PUT', body: JSON.stringify(data) }),

  // Users
  getUsers:      ()         => request('/users'),
  createUser:    (data)     => request('/users',                    { method: 'POST',   body: JSON.stringify(data) }),
  updateUser:    (id, data) => request(`/users/${id}`,              { method: 'PUT',    body: JSON.stringify(data) }),
  deleteUser:    (id)       => request(`/users/${id}`,              { method: 'DELETE' }),
  importUsers:   (data)     => request('/users/import',             { method: 'POST',   body: JSON.stringify(data) }),
  resendInvite:  (id)       => request(`/users/${id}/resend-invite`,{ method: 'POST' }),

  // Other
  getActivity: (p = {}) => request('/activity?' + new URLSearchParams(p)),
  getBackups:  ()        => request('/backup/list'),
};
```

### Step 4 — Role-Based Access in App.jsx

```javascript
const pageProps = { role: user.role, user, showToast, refreshPending };
const isAdmin   = user.role === 'Manager' || user.role === 'Storekeeper';
const adminOnly = (el) => isAdmin ? el : <Navigate to="/" replace />;
const superOnly = (el) => user.role === 'Manager' ? el : <Navigate to="/" replace />;

// Routes:
// adminOnly() → Approvals, Add Item, Reports
// superOnly() → Users, Activity Log, Backup
// All logged-in users → Dashboard, Inventory, My Requests, Help
```

**Important additions in App.jsx:**

1. **Public `/set-password` route** — checked before the auth guard so unauthenticated users can set their password:
```jsx
if (window.location.pathname === '/set-password') {
  return (
    <>
      <SetPasswordPage showToast={showToast} />
      {toast && <Toast ... />}
    </>
  );
}
```

2. **Pending badge counts request groups, not individual items** — use `getGroups` so the badge shows "1 request" not "3 items":
```javascript
const refreshPending = () => {
  api.getGroups({ status: 'pending' })
    .then(data => setPendingCount(data.length))
    .catch(() => {});
};
```

3. **Footer** with copyright and contact (inside the `<main>` element):
```jsx
<footer style={{ marginTop:48, paddingTop:20, borderTop:'1px solid var(--border)',
  display:'flex', flexWrap:'wrap', justifyContent:'space-between',
  fontSize:12, color:'var(--muted)' }}>
  <span>© {new Date().getFullYear()} Yayasan Pendidikan Jayawijaya — Tembagapura Campus. All rights reserved.</span>
  <span>
    📧 <a href="mailto:admin@ypj.sch.id">admin@ypj.sch.id</a>
    {' · '}
    🌐 <a href="https://ypj.sch.id" target="_blank" rel="noreferrer">ypj.sch.id</a>
  </span>
</footer>
```

### Step 5 — SetPasswordPage (new page)

Create `frontend/src/pages/SetPasswordPage.jsx` — a public page (no auth required) for new users to set their password from the welcome email link.

Flow:
1. Reads `?token` from URL
2. On mount: `api.verifyResetToken(token)` — if invalid/expired, shows error screen
3. If valid: shows user's name, email, role; presents password + confirm form
4. On submit: `api.setPassword({ token, password })` → success screen with "Go to Login" button

### Step 6 — BarcodeScanner component (mobile camera)

Install the library:
```bash
cd frontend && npm install html5-qrcode
```

Add to `frontend/package.json` **dependencies** (not devDependencies):
```json
"html5-qrcode": "^2.3.8"
```

Create `frontend/src/components/shared/BarcodeScanner.jsx`:

```jsx
import { useEffect, useRef } from 'react';

export default function BarcodeScanner({ onScan, onClose }) {
  const calledRef = useRef(false);

  useEffect(() => {
    let scanner;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      scanner = new Html5Qrcode('barcode-reader-box');
      try {
        await scanner.start(
          { facingMode: 'environment' },           // back camera
          { fps: 10, qrbox: { width: 260, height: 100 } },
          (decoded) => {
            if (calledRef.current) return;
            calledRef.current = true;
            scanner.stop().catch(() => {});
            onScan(decoded);
          },
          () => {},
        );
      } catch (err) {
        console.error('Camera error:', err);
        onClose();
      }
    })();
    return () => { scanner?.stop().catch(() => {}); };
  }, []);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.8)',
      zIndex:1000, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center' }}>
      <div id="barcode-reader-box" style={{ width:300, borderRadius:12, overflow:'hidden' }} />
      <p style={{ color:'white', marginTop:16 }}>Point camera at barcode</p>
      <button onClick={onClose} style={{ marginTop:12, padding:'8px 24px',
        background:'white', borderRadius:8, border:'none', cursor:'pointer' }}>
        Cancel
      </button>
    </div>
  );
}
```

**Smart barcode flow in AddItemPage:**
1. Scan barcode → check local DB: `api.getItems({ code: barcode })`
2. If found → pre-fill ALL form fields + switch to **update mode** (PUT instead of POST)
3. If not found → look up item name from UPC Item DB / Open Food Facts → auto-fill name field
4. If name not found externally → show "not found" notice, let user type the name manually

---

## Part 8 — PWA (Mobile Home-Screen Shortcut)

Making the app installable as a home-screen shortcut on Android and iOS requires three things: a manifest, a service worker, and meta tags in `index.html`.

### Step 1 — frontend/public/manifest.json

```json
{
  "name": "YPJ Tembagapura Inventory",
  "short_name": "YPJ Inventory",
  "description": "Yayasan Pendidikan Jayawijaya — Tembagapura Campus Inventory Management System",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#f8fafc",
  "theme_color": "#1a2f5e",
  "categories": ["productivity", "business"],
  "icons": [
    { "src": "/icons/icon-72.png",  "sizes": "72x72",   "type": "image/png" },
    { "src": "/icons/icon-96.png",  "sizes": "96x96",   "type": "image/png" },
    { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png" },
    { "src": "/icons/icon-144.png", "sizes": "144x144", "type": "image/png" },
    { "src": "/icons/icon-152.png", "sizes": "152x152", "type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-384.png", "sizes": "384x384", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Step 2 — frontend/public/sw.js (service worker)

```javascript
const CACHE = 'ypj-inv-v1';
const PRECACHE = ['/', '/manifest.json'];

self.addEventListener('install',  e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always network for API calls
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Cache-first for static assets
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
    if (e.request.method === 'GET' && res.status === 200) {
      caches.open(CACHE).then(c => c.put(e.request, res.clone()));
    }
    return res;
  }).catch(() => e.request.mode === 'navigate' ? caches.match('/') : undefined)));
});
```

> ⚠️ **Cache busting:** Every time you deploy a change, increment the cache version (`'ypj-inv-v1'` → `'ypj-inv-v2'`) so users' phones fetch the new files instead of serving the cached old ones.

### Step 3 — Update frontend/index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YPJ Tembagapura Inventory</title>

    <!-- PWA / Home-screen shortcut -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#1a2f5e" />

    <!-- iOS Safari home-screen support -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="YPJ Inventory" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />

    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### Step 4 — Register service worker in frontend/src/main.jsx

```javascript
// Add after ReactDOM.createRoot(...).render(...)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.warn('[SW] Failed:', err));
  });
}
```

### Step 5 — Generate PNG icons

Create `frontend/generate-icons.html` — open it in Chrome, click the button, download all 8 PNG files, and place them in `frontend/public/icons/`.

The icon sizes needed: **72, 96, 128, 144, 152, 192, 384, 512** px.

### How users install the app

| Platform | Steps |
|---|---|
| **Android (Chrome)** | Open app → tap ⋮ menu → **Add to Home Screen** or **Install app** |
| **iOS (Safari)** | Open app → tap Share button (□↑) → **Add to Home Screen** |

The app opens in full-screen standalone mode (no browser address bar).

---

## Part 9 — Customising for Tembagapura

When you replicate the app for YPJ Tembagapura, change these specific values:

> ✅ **TPRA campus structure:** Same as KK — **2 store locations**, each with its own storekeeper. PAUD has one storekeeper; SD and SMP share another storekeeper. Only the location names differ.

| Store | Unit | Storekeeper `unit_school` |
|---|---|---|
| PAUD YPJ TPRA | PAUD | `PAUD` |
| SD SMP YPJ TPRA | SD + SMP | `SD` or `SMP` |

### 1. Store locations (backend/routes/items.js)
```javascript
// Change FROM:
const LOCATIONS = ['PAUD YPJ KK', 'SD SMP YPJ KK'];
// TO:
const LOCATIONS = ['PAUD YPJ TPRA', 'SD SMP YPJ TPRA'];
```

### 2. Storekeeper location mapping (backend/routes/items.js)
```javascript
// Change FROM:
const myLocation = req.user.unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
// TO:
const myLocation = req.user.unit_school === 'PAUD' ? 'PAUD YPJ TPRA' : 'SD SMP YPJ TPRA';
```

### 3. Same mapping in frontend (RequestsPage.jsx, AddItemPage.jsx, ItemForm.jsx)
```javascript
// Change FROM:
const storeLocation = unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
// TO:
const storeLocation = unit_school === 'PAUD' ? 'PAUD YPJ TPRA' : 'SD SMP YPJ TPRA';
```

### 4. App title (frontend/src/components/Layout/Topbar.jsx)
```jsx
// Change:
<div className="logo-text">YPJ KK Inventory</div>
<div className="logo-sub">Campus Management System</div>
// To:
<div className="logo-text">YPJ Tembagapura Inventory</div>
<div className="logo-sub">Campus Management System</div>
```

### 5. First-run Manager account (backend/db.js)
```javascript
// Change the seed to your Tembagapura admin details:
const adminEmail    = process.env.ADMIN_EMAIL    || 'admin.tembagapura@ypj.sch.id';
const adminPassword = process.env.ADMIN_PASSWORD || 'YPJ2025';
const adminName     = process.env.ADMIN_NAME     || 'Administrator Tembagapura';
```

### 6. Footer (frontend/src/App.jsx)
```jsx
// Change:
© Yayasan Pendidikan Jayawijaya — Kuala Kencana Campus
// To:
© Yayasan Pendidikan Jayawijaya — Tembagapura Campus
```

### 7. Help page text (frontend/src/pages/HelpPage.jsx)
```jsx
// Change the subtitle:
<div className="page-subtitle">How to use the YPJ KK Inventory System</div>
// To:
<div className="page-subtitle">How to use the YPJ Tembagapura Inventory System</div>
```

> 💡 The User Guide page covers all roles and is auto-updated with the latest features including: roles overview, set-password flow, request submission, borrow reminders, barcode scanner, PWA install instructions (Android + iOS), Telegram setup, and manager tools.

### 8. Welcome email app URL (backend/mailer.js)
```javascript
// In sendWelcomeEmail(), the appUrl fallback should match the campus:
// KK:
const appUrl = process.env.FRONTEND_URL || 'https://kkinventory.ypj.sch.id';
// TPRA:
const appUrl = process.env.FRONTEND_URL || 'https://tprainventory.ypj.sch.id';
```
> Since `FRONTEND_URL` is set as a Railway env variable in production, the fallback only matters for local dev. In production it always uses the correct domain automatically.

### 8. Telegram Bot
- Create a NEW bot via @BotFather for Tembagapura (e.g. `@ypjtembagapurainventory_bot`)
- Use its new token as `TELEGRAM_BOT_TOKEN` in Railway

### 9. Email domain
- If Tembagapura uses a different subdomain, update `MAIL_FROM_DOMAIN` in Railway
- Add Resend DNS records for that domain

### 10. Principal role — unit_school assignment
- SD and SMP are **separate** principals even though they share a store location
- When creating a Principal user, set `unit_school` to exactly `'SD'` or `'SMP'` (not `'All'`)
- The system routes CC notifications by exact `unit_school` match

### 11. PWA manifest names
```json
// frontend/public/manifest.json
{
  "name": "YPJ Tembagapura Inventory",
  "short_name": "YPJ Inventory",
  "description": "Yayasan Pendidikan Jayawijaya — Tembagapura Campus Inventory Management System"
}
```

### 12. PWA index.html title
```html
<title>YPJ Tembagapura Inventory</title>
<meta name="apple-mobile-web-app-title" content="YPJ Inventory" />
```

---

## Part 10 — Deploying to Railway

### Step 1 — Push code to GitHub

```bash
# In the project root folder:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ypj-tembagapura-inventory.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → New Project
2. Choose **Deploy from GitHub repo** → select your repo
3. Railway auto-detects `railway.json` and starts building

### Step 3 — Add a persistent Volume

> ⚠️ This is critical. Without a volume, the SQLite database is deleted every time Railway redeploys.

1. In your Railway service → **Volumes** tab
2. Click **Add Volume**
3. Mount path: `/data`
4. This gives you a folder at `/data` that survives redeploys

### Step 4 — Add environment variables

In Railway → your service → **Variables** tab, add:

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production mode |
| `JWT_SECRET` | `some-very-long-random-string` | Use a strong random value |
| `ADMIN_PASSWORD` | `YourSecurePassword123` | First login password |
| `ADMIN_EMAIL` | `admin.tembagapura@ypj.sch.id` | First Manager account email |
| `ADMIN_NAME` | `Administrator Tembagapura` | First Manager account name |
| `DB_PATH` | `/data/database.sqlite` | Points to the volume |
| `FRONTEND_URL` | `https://your-domain.ypj.sch.id` | Your custom domain (after Step 6) |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | From resend.com |
| `MAIL_FROM_DOMAIN` | `ypj.sch.id` | Verified domain in Resend |
| `TELEGRAM_BOT_TOKEN` | `7123456789:ABCdef...` | From @BotFather |

Click **Apply Changes** — Railway redeploys automatically.

### Step 5 — Check the build logs

In Railway → your service → **Deployments** → click the latest deployment → **View logs**

A successful build ends with:
```
Deployment successful
```

A failed build usually means:
- Missing dependency → check `package.json`
- `vite: not found` → make sure vite is in `dependencies` not `devDependencies`
- Syntax error in code → read the error line carefully

### Step 6 — Add a custom domain

1. Railway → your service → **Settings** → **Domains**
2. Click **Add Custom Domain** → type `tembagapura-inventory.ypj.sch.id`
3. Railway shows a CNAME target like `xyz.up.railway.app`
4. Go to your DNS provider → add CNAME record:
   - Name: `tembagapura-inventory`
   - Value: `xyz.up.railway.app`
5. Wait ~5 minutes → Railway shows ✅ Active with HTTPS

### Step 7 — Update FRONTEND_URL

After your domain is live, update the `FRONTEND_URL` variable in Railway to your actual domain:
```
FRONTEND_URL=https://tembagapura-inventory.ypj.sch.id
```

Apply changes → one more redeploy → done!

---

## Part 11 — First Login & Setup

1. Open your domain in the browser
2. Log in with the Manager email and password you set in `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Go to **Users** → create Storekeeper accounts for each store
4. Create Teacher/Other accounts for staff
5. Go to **Add Item** → start adding inventory items (or use CSV import)
6. Share the URL and credentials with your staff

---

## Part 12 — Running Locally (for development)

```bash
# Terminal 1 — Backend
cd backend
cp .env.example .env      # create env file, fill in values
node server.js            # runs on http://localhost:3001

# Terminal 2 — Frontend
cd frontend
npm run dev               # runs on http://localhost:5173
```

Create `backend/.env` for local development:
```
JWT_SECRET=local-dev-secret
ADMIN_PASSWORD=admin123
NODE_ENV=development
```

---

## Part 13 — Checklist Before Going Live

- [ ] `JWT_SECRET` is a strong random string (not the default)
- [ ] `ADMIN_PASSWORD` is a strong password (not `YPJ2025`)
- [ ] Volume is mounted at `/data` and `DB_PATH=/data/database.sqlite`
- [ ] `NODE_ENV=production` is set
- [ ] `FRONTEND_URL` matches your actual domain (with `https://`)
- [ ] Resend domain is verified (all 4 DNS records ✅)
- [ ] Custom domain resolves in browser with HTTPS padlock ✅
- [ ] First login works and Manager account is accessible
- [ ] Email notification test works (submit a test request)
- [ ] Welcome email received when adding a new user
- [ ] "Set My Password" link in welcome email works
- [ ] Welcome email contains correct app URL and PWA install instructions
- [ ] Telegram bot `/start` replies with Chat ID
- [ ] Barcode scanner opens camera and auto-fills item name on Add Item page
- [ ] PWA installs correctly on Android (Chrome) and iOS (Safari)
- [ ] Service worker cache version bumped after every deploy (to bust old cache)
- [ ] Borrow reminder: submit a borrow request with return date = tomorrow, verify email arrives within 1 hour

---

## Quick Reference — What to Change Per Campus

| Thing to change | File | What to update |
|---|---|---|
| Store location names | `backend/routes/items.js` | `LOCATIONS` array |
| Location mapping | `backend/routes/items.js`, `backend/routes/requests.js` | `myLocation` ternary |
| Location mapping (frontend) | `RequestsPage.jsx`, `AddItemPage.jsx`, `ItemForm.jsx` | `storeLocation` variable |
| App title | `Topbar.jsx` | `logo-text` and `logo-sub` |
| Help page | `HelpPage.jsx` | Subtitle, bot name |
| First Manager account | `backend/db.js` or Railway variables | `ADMIN_EMAIL`, `ADMIN_NAME` |
| Footer | `App.jsx` | Campus name, email |
| Telegram bot | Railway variables | `TELEGRAM_BOT_TOKEN` |
| Email sender | Railway variables | `MAIL_FROM_DOMAIN` |
| Domain | Railway + DNS | CNAME record, `FRONTEND_URL` |
| PWA app name | `frontend/public/manifest.json` | `name`, `short_name`, `description` |
| PWA title tag | `frontend/index.html` | `<title>` and `apple-mobile-web-app-title` |
| PWA icon | `frontend/public/icons/` | Regenerate PNGs with `generate-icons.html` |
| SW cache version | `frontend/public/sw.js` | Bump `CACHE = 'ypj-inv-vN'` on every deploy |
| Reminder email branding | `backend/mailer.js` → `sendBorrowReminder` | Update campus name in email footer |
| Welcome email app URL | `backend/mailer.js` → `sendWelcomeEmail` | Update `appUrl` fallback to TPRA domain |

---

*Built with Node.js + Express + React + SQLite · Hosted on Railway · Emails via Resend · Notifications via Telegram*

*© Yayasan Pendidikan Jayawijaya — IT Documentation*

---

## Part 14 — Preparing the YPJ Tembagapura (TPRA) Inventory App

This section is the step-by-step checklist for spinning up the Tembagapura campus instance from the KK codebase.

### Step 1 — Clone / copy the repo

```bash
# Option A: clone KK repo into a new folder
git clone https://github.com/nataliusmarani-beep/ypjkk-inventory.git ypjtpra-inventory
cd ypjtpra-inventory

# Remove the KK remote and point to a new TPRA repo
git remote remove origin
# Create a new empty repo on GitHub (e.g. ypjtpra-inventory), then:
git remote add origin https://github.com/nataliusmarani-beep/ypjtpra-inventory.git
git push -u origin main
```

### Step 2 — Understand the TPRA campus structure

> ✅ **TPRA has the same structure as KK** — 2 store locations, 2 storekeepers. The only difference is the location names.

| Campus | Store locations | Storekeepers |
|---|---|---|
| YPJ KK | PAUD YPJ KK · SD SMP YPJ KK | 2 (one per location) |
| YPJ TPRA | PAUD YPJ TPRA · SD SMP YPJ TPRA | 2 (one per location) |

The backend logic (`storekeepWhere`, location mapping, notification routing) is **identical to KK** — just replace the location name strings.

### Step 3 — Find & replace all KK-specific strings

Run these replacements across the whole codebase:

| Find | Replace with |
|---|---|
| `YPJ KK Inventory` | `YPJ TPRA Inventory` |
| `YPJ KK Campus` | `YPJ TPRA Campus` |
| `Kuala Kencana Campus` | `Tembagapura Campus` |
| `PAUD YPJ KK` | `PAUD YPJ TPRA` |
| `SD SMP YPJ KK` | `SD SMP YPJ TPRA` |
| `kkinventory.ypj.sch.id` | `tprainventory.ypj.sch.id` *(or your chosen domain)* |
| `@ypjkkinventory_bot` | `@ypjtprainventory_bot` *(after creating the new Telegram bot)* |

Files most likely to need changes:
- `frontend/src/components/Layout/Topbar.jsx` — logo text
- `frontend/src/App.jsx` — footer campus name
- `frontend/src/pages/HelpPage.jsx` — subtitle
- `frontend/src/pages/DashboardPage.jsx` — campus label
- `frontend/src/pages/AddItemPage.jsx` — location dropdown (simplify to single option)
- `frontend/src/pages/RequestsPage.jsx` — location label
- `frontend/public/manifest.json` — PWA name
- `frontend/index.html` — page title
- `backend/routes/items.js` — `LOCATIONS` array (one entry)
- `backend/routes/requests.js` — location strings
- `backend/mailer.js` — email footer campus name

### Step 4 — Update location name strings (the only real change)

TPRA uses the same two-store, two-storekeeper structure as KK. The `storekeepWhere()` logic, notification routing, and all backend patterns are **identical**. You only need to rename the location strings:

**backend/routes/items.js:**
```javascript
const LOCATIONS = ['PAUD YPJ TPRA', 'SD SMP YPJ TPRA'];
```

**Storekeeper location mapping** (items.js + requests.js):
```javascript
const myLocation = req.user.unit_school === 'PAUD'
  ? 'PAUD YPJ TPRA'
  : 'SD SMP YPJ TPRA';
```

**Frontend location mapping** (AddItemPage.jsx, RequestsPage.jsx):
```javascript
const storeLocation = unit_school === 'PAUD'
  ? 'PAUD YPJ TPRA'
  : 'SD SMP YPJ TPRA';
```

**storekeepWhere()** — no change needed, works as-is.

**Principal notifications** — same logic. Assign each Principal with the correct `unit_school` (`PAUD`, `SD`, or `SMP`) when creating their account.

### Step 5 — Create new Railway project for TPRA

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select the new `ypjtpra-inventory` repo
3. Add a **Volume** → mount path `/data`

### Step 6 — Set Railway environment variables for TPRA

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | *(new strong random string — different from KK)* |
| `ADMIN_EMAIL` | `admin.tpra@ypj.sch.id` |
| `ADMIN_PASSWORD` | *(strong password)* |
| `ADMIN_NAME` | `Administrator Tembagapura` |
| `DB_PATH` | `/data/database.sqlite` |
| `FRONTEND_URL` | `https://tprainventory.ypj.sch.id` |
| `RESEND_API_KEY` | *(same key as KK — same Resend account)* |
| `MAIL_FROM_DOMAIN` | `ypj.sch.id` *(same verified domain)* |
| `TELEGRAM_BOT_TOKEN` | *(new token from @BotFather for TPRA bot)* |

### Step 7 — Create TPRA Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot`
3. Name: `YPJ TPRA Inventory`
4. Username: `ypjtprainventory_bot` (or similar)
5. Copy the token → set as `TELEGRAM_BOT_TOKEN` in Railway

### Step 8 — Add custom domain

1. Railway → TPRA service → **Settings → Domains → Add Custom Domain**
2. Enter `tprainventory.ypj.sch.id`
3. Add the CNAME record to your DNS registrar
4. Wait for ✅ Active, then update `FRONTEND_URL` in Railway variables

### Step 9 — Regenerate PWA icons for TPRA

The icon design can stay the same (same YPJ branding) — just make sure `manifest.json` has the TPRA name:
```json
{
  "name": "YPJ TPRA Inventory",
  "short_name": "YPJ Inventory"
}
```

### Step 10 — First login & user setup

1. Open `https://tprainventory.ypj.sch.id`
2. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Go to **Users** → create **2 Storekeepers**: one with `unit_school = PAUD` (for PAUD store), one with `unit_school = SD` or `SMP` (for SD SMP store)
4. Create Principal accounts — set `unit_school` to the exact unit they oversee (`PAUD`, `SD`, or `SMP`)
5. Create Teacher/Other accounts for Tembagapura staff
6. Go to **Add Item** or use CSV import to seed inventory

### Step 11 — TPRA Go-live checklist

- [ ] GitHub repo created and code pushed
- [ ] All KK strings replaced with TPRA strings
- [ ] Railway project created with Volume at `/data`
- [ ] All environment variables set (especially new `JWT_SECRET`)
- [ ] Custom domain live with HTTPS
- [ ] First login works
- [ ] Welcome email received when adding first user (contains correct TPRA URL + install instructions)
- [ ] Borrow reminder emails working (test with 1-day return date)
- [ ] Telegram bot `/start` replies with Chat ID
- [ ] PWA installs on mobile with correct TPRA name
- [ ] SW cache version starts at `ypj-inv-v1` (fresh for TPRA)

---

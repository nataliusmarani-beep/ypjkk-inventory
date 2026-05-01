# How to Build a School Inventory App — Complete Guide
### Based on YPJ KK Inventory System (for replication at YPJ Tembagapura or any campus)

---

## Overview

This guide walks you through building a full-stack web inventory app from scratch — the same way YPJ KK Inventory was built. By the end you will have a live, production web app hosted at your own domain, with:

- Login system with 4 roles (Manager, Storekeeper, Teacher, Other)
- Inventory management per store location
- Request & approval workflow with auto stock updates
- Email notifications (Resend API)
- Telegram bot notifications
- CSV import/export
- Database backup system
- In-app user guide

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
                   CHECK(role IN ('Manager','Storekeeper','Teacher','Other')),
    unit_school    TEXT    NOT NULL DEFAULT 'All',
    location       TEXT,
    store_category TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    password_hash  TEXT    NOT NULL,
    telegram_chat_id TEXT,
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
const LOCATIONS   = ['Tembagapura Primary Store', 'Tembagapura Secondary Store'];
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

### Users route (`backend/routes/users.js`)

Key concepts:
- Manager only can create/edit/delete users
- Password is hashed with `bcryptjs` before storing
- CSV bulk import available

### Backup route (`backend/routes/backup.js`)

Key concepts:
- `createBackup()` copies the `.sqlite` file into a `/backups/` folder with a timestamp
- Keeps only the last 14 backups (auto-deletes older ones)
- Exposed as `GET /api/backup/list` and `GET /api/backup/download`

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
module.exports = { send, /* ... */ };
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
    "vite": "^5.3.1"
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

  // Items
  getItems:   (params = {}) => request('/items?' + new URLSearchParams(params)),
  getItem:    (id)          => request(`/items/${id}`),
  createItem: (data)        => request('/items',        { method: 'POST',   body: JSON.stringify(data) }),
  updateItem: (id, data)    => request(`/items/${id}`,  { method: 'PUT',    body: JSON.stringify(data) }),
  deleteItem: (id)          => request(`/items/${id}`,  { method: 'DELETE' }),
  importItems:(data)        => request('/items/import', { method: 'POST',   body: JSON.stringify(data) }),
  getItemMeta:()            => request('/items/meta'),

  // Requests
  getRequests:    (p = {})    => request('/requests?'        + new URLSearchParams(p)),
  submitCart:     (data)      => request('/requests/cart',   { method: 'POST',  body: JSON.stringify(data) }),
  approveRequest: (id, data)  => request(`/requests/${id}/approve`, { method: 'PUT', body: JSON.stringify(data) }),
  rejectRequest:  (id, data)  => request(`/requests/${id}/reject`,  { method: 'PUT', body: JSON.stringify(data) }),
  returnRequest:  (id)        => request(`/requests/${id}/return`,  { method: 'PUT' }),
  forwardRequest: (id, data)  => request(`/requests/${id}/forward`, { method: 'PUT', body: JSON.stringify(data) }),

  // Users
  getUsers:    ()         => request('/users'),
  createUser:  (data)     => request('/users',       { method: 'POST',   body: JSON.stringify(data) }),
  updateUser:  (id, data) => request(`/users/${id}`, { method: 'PUT',    body: JSON.stringify(data) }),
  deleteUser:  (id)       => request(`/users/${id}`, { method: 'DELETE' }),
  importUsers: (data)     => request('/users/import',{ method: 'POST',   body: JSON.stringify(data) }),

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

---

## Part 8 — Customising for Tembagapura

When you replicate the app for YPJ Tembagapura, change these specific values:

### 1. Store locations (backend/routes/items.js)
```javascript
// Change FROM:
const LOCATIONS = ['PAUD YPJ KK', 'SD SMP YPJ KK'];
// TO:
const LOCATIONS = ['PAUD YPJ Tembagapura', 'SD SMP YPJ Tembagapura'];
```

### 2. Storekeeper location mapping (backend/routes/items.js)
```javascript
// Wherever this pattern appears:
const myLocation = req.user.unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
// Change to:
const myLocation = req.user.unit_school === 'PAUD' ? 'PAUD YPJ Tembagapura' : 'SD SMP YPJ Tembagapura';
```

### 3. Same mapping in frontend (RequestsPage.jsx, AddItemPage.jsx, ItemForm.jsx)
```javascript
// Wherever storeLocation is computed:
const storeLocation = unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
// Change to:
const storeLocation = unit_school === 'PAUD' ? 'PAUD YPJ Tembagapura' : 'SD SMP YPJ Tembagapura';
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

### 8. Telegram Bot
- Create a NEW bot via @BotFather for Tembagapura (e.g. `@ypjtembagapurainventory_bot`)
- Use its new token as `TELEGRAM_BOT_TOKEN` in Railway

### 9. Email domain
- If Tembagapura uses a different subdomain, update `MAIL_FROM_DOMAIN` in Railway
- Add Resend DNS records for that domain

---

## Part 9 — Deploying to Railway

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

## Part 10 — First Login & Setup

1. Open your domain in the browser
2. Log in with the Manager email and password you set in `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Go to **Users** → create Storekeeper accounts for each store
4. Create Teacher/Other accounts for staff
5. Go to **Add Item** → start adding inventory items (or use CSV import)
6. Share the URL and credentials with your staff

---

## Part 11 — Running Locally (for development)

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

## Part 12 — Checklist Before Going Live

- [ ] `JWT_SECRET` is a strong random string (not the default)
- [ ] `ADMIN_PASSWORD` is a strong password (not `YPJ2025`)
- [ ] Volume is mounted at `/data` and `DB_PATH=/data/database.sqlite`
- [ ] `NODE_ENV=production` is set
- [ ] `FRONTEND_URL` matches your actual domain (with `https://`)
- [ ] Resend domain is verified (all 4 DNS records ✅)
- [ ] Custom domain resolves in browser with HTTPS padlock ✅
- [ ] First login works and Manager account is accessible
- [ ] Email notification test works (submit a test request)
- [ ] Telegram bot `/start` replies with Chat ID

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

---

*Built with Node.js + Express + React + SQLite · Hosted on Railway · Emails via Resend · Notifications via Telegram*

*© Yayasan Pendidikan Jayawijaya — IT Documentation*

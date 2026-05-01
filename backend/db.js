const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// In production (Railway), DB_PATH points to a persistent volume.
// Locally it stays next to this file.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

// Make sure the directory exists (needed when volume is first mounted)
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

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
    role           TEXT    NOT NULL DEFAULT 'Teacher' CHECK(role IN ('Manager','Storekeeper','Teacher','Other')),
    unit_school    TEXT    NOT NULL DEFAULT 'All',
    location       TEXT,
    store_category TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    password_hash  TEXT    NOT NULL,
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
    status          TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','returned')),
    approved_at     TEXT,
    returned_at     TEXT,
    notes           TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Migrate users table if CHECK constraint needs updating ────────────────
// Handles: Admin→Manager rename AND adding Principal role
const userSchema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get();
const needsMigration = userSchema && (
  userSchema.sql.includes("'Admin'") ||
  !userSchema.sql.includes("'Principal'")
);
if (needsMigration) {
  db.exec(`PRAGMA foreign_keys = OFF`);
  db.exec(`
    CREATE TABLE users_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      email            TEXT    NOT NULL UNIQUE,
      role             TEXT    NOT NULL DEFAULT 'Teacher'
                       CHECK(role IN ('Manager','Storekeeper','Principal','Teacher','Other')),
      unit_school      TEXT    NOT NULL DEFAULT 'All',
      location         TEXT,
      store_category   TEXT,
      is_active        INTEGER NOT NULL DEFAULT 1,
      password_hash    TEXT    NOT NULL,
      telegram_chat_id TEXT,
      created_at       TEXT    DEFAULT (datetime('now'))
    );
    INSERT INTO users_new
      SELECT id, name, email,
        CASE WHEN role='Admin' THEN 'Manager' ELSE role END,
        unit_school, location, store_category, is_active, password_hash,
        telegram_chat_id, created_at
      FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
  db.exec(`PRAGMA foreign_keys = ON`);
  console.log('[db] Migration: users table updated (Principal role added).');
}

// Migrations for existing databases
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!userCols.includes('telegram_chat_id'))       db.exec(`ALTER TABLE users ADD COLUMN telegram_chat_id TEXT`);
if (!userCols.includes('password_reset_token'))   db.exec(`ALTER TABLE users ADD COLUMN password_reset_token TEXT`);
if (!userCols.includes('password_reset_expires')) db.exec(`ALTER TABLE users ADD COLUMN password_reset_expires TEXT`);

const reqCols = db.prepare(`PRAGMA table_info(requests)`).all().map(c => c.name);
if (!reqCols.includes('group_id'))        db.exec(`ALTER TABLE requests ADD COLUMN group_id TEXT`);
if (!reqCols.includes('category'))        db.exec(`ALTER TABLE requests ADD COLUMN category TEXT`);
if (!reqCols.includes('forwarded'))       db.exec(`ALTER TABLE requests ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0`);
if (!reqCols.includes('forwarded_note'))  db.exec(`ALTER TABLE requests ADD COLUMN forwarded_note TEXT`);
if (!reqCols.includes('approval_notes'))  db.exec(`ALTER TABLE requests ADD COLUMN approval_notes TEXT`);
if (!reqCols.includes('reminder_2d_sent')) db.exec(`ALTER TABLE requests ADD COLUMN reminder_2d_sent INTEGER NOT NULL DEFAULT 0`);
if (!reqCols.includes('reminder_1d_sent')) db.exec(`ALTER TABLE requests ADD COLUMN reminder_1d_sent INTEGER NOT NULL DEFAULT 0`);

const itemCols = db.prepare(`PRAGMA table_info(items)`).all().map(c => c.name);
const migrations = {
  icon: `ALTER TABLE items ADD COLUMN icon TEXT`,
  code:           `ALTER TABLE items ADD COLUMN code TEXT`,
  store_category: `ALTER TABLE items ADD COLUMN store_category TEXT NOT NULL DEFAULT 'Supplies'`,
  location:       `ALTER TABLE items ADD COLUMN location TEXT NOT NULL DEFAULT 'SD SMP YPJ KK'`,
  unit_school:    `ALTER TABLE items ADD COLUMN unit_school TEXT NOT NULL DEFAULT 'All'`,
  max_quantity:   `ALTER TABLE items ADD COLUMN max_quantity INTEGER NOT NULL DEFAULT 0`,
  unit_name:      `ALTER TABLE items ADD COLUMN unit_name TEXT NOT NULL DEFAULT 'pcs'`,
  condition:      `ALTER TABLE items ADD COLUMN condition TEXT NOT NULL DEFAULT 'Good'`,
  po_number:      `ALTER TABLE items ADD COLUMN po_number TEXT`,
};
for (const [col, sql] of Object.entries(migrations)) {
  if (!itemCols.includes(col)) db.exec(sql);
}

// ── First-run seed ────────────────────────────────────────────────────────
// If no users exist (fresh volume on Railway), create the Manager account
// so there is always at least one login available.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const bcrypt = require('bcryptjs');
  const hash   = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'YPJ2025', 10);
  db.prepare(`
    INSERT INTO users (name, email, role, unit_school, password_hash)
    VALUES ('Natalius Fillep Marani', 'nmarani@fmi.com', 'Manager', 'All', ?)
  `).run(hash);
  console.log('[db] First-run seed: Manager account created (nmarani@fmi.com).');
}

module.exports = db;

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');

const router = express.Router();

const DB_PATH      = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const BACKUPS_DIR  = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), 'backups')
  : path.join(__dirname, '..', 'backups');
const MAX_BACKUPS  = 14;  // keep 2 weeks of daily backups

function managerOnly(req, res, next) {
  if (req.user?.role !== 'Manager') {
    return res.status(403).json({ error: 'Manager access required.' });
  }
  next();
}

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Write a checkpoint + copy to backups/ and return the destination path
function createBackup() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  // Flush WAL into the main file before copying
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore if busy */ }

  const dest = path.join(BACKUPS_DIR, `backup_${stamp()}.sqlite`);
  fs.copyFileSync(DB_PATH, dest);

  // Prune old backups — keep only the newest MAX_BACKUPS
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.sqlite'))
    .sort()          // oldest first (lexicographic timestamp sort)
    .reverse();      // newest first
  for (const old of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUPS_DIR, old));
  }

  return dest;
}

// ── GET /api/backup/download ───────────────────────────────────────────────
// Manager only — creates a fresh backup and sends it as a file download.
router.get('/download', managerOnly, (req, res) => {
  try {
    const dest     = createBackup();
    const filename = path.basename(dest);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(dest);
  } catch (err) {
    console.error('Backup download error:', err.message);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ── GET /api/backup/list ───────────────────────────────────────────────────
// Returns the list of stored backups with size and timestamp.
router.get('/list', managerOnly, (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return res.json([]);
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('backup_') && f.endsWith('.sqlite'))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, f));
        return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, createBackup };

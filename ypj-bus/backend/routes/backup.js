const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { execFileSync } = require('child_process');
const db      = require('../db');
const { UPLOAD_DIR } = require('../lib/files');

const router = express.Router();

const BACKUPS_DIR = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), 'backups')
  : path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 14;  // keep 2 weeks of daily backups

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function pruneOld(prefix, suffix) {
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
    .sort()          // oldest first (lexicographic timestamp sort)
    .reverse();      // newest first
  for (const old of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUPS_DIR, old));
  }
}

// Write a consistent snapshot to backups/ and return the destination path.
//
// VACUUM INTO, not a raw fs.copyFileSync of DB_PATH: a plain file copy reads
// the live file byte-by-byte while the app can still be mid-write on the
// same connection, on a volume whose file locking isn't guaranteed reliable
// — exactly the conditions that produced real index corruption in
// production (see the integrity-check job in server.js). VACUUM INTO is
// SQLite's own atomic, consistent-snapshot mechanism and needs no external
// locking to be correct.
function createBackup() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const dest = path.join(BACKUPS_DIR, `backup_${stamp()}.sqlite`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  pruneOld('backup_', '.sqlite');

  return dest;
}

// Photos and signatures live on disk, not in SQLite (see lib/files.js) — a
// database-only backup silently drops them. This is what a Iwanggin/Sabina-
// style photo-loss incident actually needs to be recoverable from: an
// application_documents row surviving in the DB is useless once the file
// itself is gone and there was never a copy of it anywhere else.
function createUploadsBackup() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) return null;

  const dest = path.join(BACKUPS_DIR, `uploads_${stamp()}.tar.gz`);
  // execFileSync (no shell) — dest and UPLOAD_DIR never touch a shell, so
  // there's nothing here for a crafted filename to inject into.
  execFileSync('tar', [
    '-czf', dest,
    '-C', path.dirname(UPLOAD_DIR), path.basename(UPLOAD_DIR),
  ]);
  pruneOld('uploads_', '.tar.gz');

  return dest;
}

// Mounted in server.js behind requireRole('transport_admin') — super_admin
// passes every role check there, so this is effectively Super Admin +
// Tim Transportasi only.

// GET /api/backup/download — creates a fresh database backup and sends it as a file download.
router.get('/download', (req, res) => {
  try {
    const dest     = createBackup();
    const filename = path.basename(dest);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(dest);
  } catch (err) {
    console.error('Backup download error:', err.message);
    res.status(500).json({ error: 'Backup gagal: ' + err.message });
  }
});

// GET /api/backup/download-uploads — creates a fresh photos/signatures archive
// and sends it as a file download. Separate from /download since it's a
// different file type (tar.gz vs sqlite) and can be considerably larger.
router.get('/download-uploads', (req, res) => {
  try {
    const dest = createUploadsBackup();
    if (!dest) return res.status(404).json({ error: 'Folder uploads tidak ditemukan.' });
    const filename = path.basename(dest);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/gzip');
    res.sendFile(dest);
  } catch (err) {
    console.error('Uploads backup download error:', err.message);
    res.status(500).json({ error: 'Backup gagal: ' + err.message });
  }
});

// GET /api/backup/list — returns the list of stored backups (database +
// uploads) with size and timestamp.
router.get('/list', (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return res.json([]);
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => (f.startsWith('backup_') && f.endsWith('.sqlite'))
                || (f.startsWith('uploads_') && f.endsWith('.tar.gz')))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, f));
        return {
          filename: f, size: stat.size, modified: stat.mtime.toISOString(),
          type: f.startsWith('uploads_') ? 'uploads' : 'database',
        };
      });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, createBackup, createUploadsBackup };

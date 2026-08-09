const express = require('express');
const db      = require('../db');
const { resolveStored } = require('../lib/files');
const { isStaff } = require('../middleware/auth');

const router = express.Router();

// Photos and signatures are children's personal data: every request is
// authenticated and ownership-checked. Nothing here is ever served statically.

// GET /api/files/photos/:name
router.get('/photos/:name', (req, res) => {
  const { name } = req.params;

  const owned = isStaff(req.user) || db.prepare(`
    SELECT 1 FROM students s
    WHERE s.photo_file = ? AND s.parent_id = ?
    UNION
    SELECT 1 FROM bus_id_cards c
    JOIN students s2 ON s2.id = c.student_id
    WHERE c.photo_file = ? AND s2.parent_id = ?
  `).get(name, req.user.id, name, req.user.id);

  if (!owned) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  const full = resolveStored('photos', name);
  if (!full) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
});

// GET /api/files/signatures/:name — the parent may review their own signature;
// staff may view it as part of the consent record.
router.get('/signatures/:name', (req, res) => {
  const { name } = req.params;

  const owned = isStaff(req.user) || db.prepare(`
    SELECT 1 FROM consents WHERE signature_file = ? AND signer_id = ?
  `).get(name, req.user.id);

  if (!owned) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  const full = resolveStored('signatures', name);
  if (!full) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
});

// GET /api/files/documents/:name — event bus request attachments (PDF/image).
// Owner (whoever raised the request) or staff may view it.
router.get('/documents/:name', (req, res) => {
  const { name } = req.params;

  const owned = isStaff(req.user) || db.prepare(`
    SELECT 1 FROM event_bus_requests WHERE attachment_file = ? AND requested_by = ?
  `).get(name, req.user.id);

  if (!owned) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  const full = resolveStored('documents', name);
  if (!full) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
});

module.exports = router;

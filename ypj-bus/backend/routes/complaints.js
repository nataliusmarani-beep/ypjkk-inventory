const express = require('express');
const db      = require('../db');
const { notify, templates } = require('../lib/notify');
const { logActivity, fail } = require('../lib/cards');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 4000;

/**
 * POST /api/complaints — "Laporkan Keluhan" on the parent dashboard.
 *
 * Rules v1.1 §III.A tells parents complaints go to the Penanggung Jawab
 * Transportasi Sekolah YPJ. This is that channel: the complaint is stored (so
 * it survives even if the email bounces) and every transport_admin /
 * super_admin is emailed immediately — the same notify() path used for card
 * approvals, so delivery follows the same Resend configuration.
 */
router.post('/', (req, res, next) => {
  const b = req.body || {};

  try {
    const subject = (b.subject || '').trim();
    const message = (b.message || '').trim();
    if (!subject) throw fail(400, 'Judul keluhan wajib diisi.');
    if (!message) throw fail(400, 'Isi keluhan wajib diisi.');
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw fail(400, `Isi keluhan maksimal ${MAX_MESSAGE_LENGTH} karakter.`);
    }

    let studentId = null;
    if (b.student_id) {
      const owned = db.prepare(`
        SELECT id FROM students WHERE id = ? AND parent_id = ?
      `).get(b.student_id, req.user.id);
      if (!owned) throw fail(400, 'Siswa tidak ditemukan.');
      studentId = owned.id;
    }

    const info = db.prepare(`
      INSERT INTO complaints (parent_id, student_id, subject, message)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, studentId, subject, message);

    const complaint = db.prepare(`SELECT * FROM complaints WHERE id = ?`)
      .get(info.lastInsertRowid);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
    const student = studentId
      ? db.prepare(`SELECT * FROM students WHERE id = ?`).get(studentId)
      : null;

    // Email + in-app notice to every Transport Team member, not just one.
    const admins = db.prepare(`
      SELECT id, email FROM users
      WHERE role IN ('transport_admin', 'super_admin') AND is_active = 1
    `).all();
    for (const admin of admins) {
      notify({
        userId: admin.id, email: admin.email,
        ...templates.complaintForSchool(complaint, parent, student),
      });
    }

    // Confirmation back to the parent, in-app only — the email already went
    // out above, and a second email just for "we got it" is noise.
    notify({ userId: req.user.id, ...templates.complaintReceipt(complaint) });

    logActivity(req, 'complaint.submitted', 'complaints', complaint.id,
                { subject });

    res.status(201).json({ ok: true, id: complaint.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/complaints — the parent's own complaint history.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.subject, c.message, c.status, c.created_at, c.resolved_at,
           s.full_name AS student_name
    FROM complaints c
    LEFT JOIN students s ON s.id = c.student_id
    WHERE c.parent_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

module.exports = router;

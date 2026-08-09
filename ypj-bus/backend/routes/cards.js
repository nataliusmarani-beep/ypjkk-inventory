const express = require('express');
const db      = require('../db');
const { issuePayload } = require('../lib/qr');
const { isStaff } = require('../middleware/auth');
const { gradeLabel } = require('../lib/notify');

const router = express.Router();

// A parent may only ever reach their own children's cards; staff see all.
function loadCard(id, user) {
  const card = db.prepare(`
    SELECT c.*, s.full_name AS student_name, s.grade, s.parent_id,
           r.code AS route_code, r.name AS route_name,
           b.code AS stop_code, b.name AS stop_name,
           y.code AS academic_year
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN routes r ON r.id = c.route_id
    JOIN bus_stops b ON b.id = c.bus_stop_id
    JOIN academic_years y ON y.id = c.academic_year_id
    WHERE c.id = ?
  `).get(id);

  if (!card) return null;
  if (card.parent_id !== user.id && !isStaff(user)) return null;
  return card;
}

// GET /api/cards — the parent's own cards (one per child).
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.card_no, c.transit_id, c.status, c.status_reason, c.issued_at,
           c.valid_until, c.photo_file,
           s.full_name AS student_name, s.grade,
           r.code AS route_code, r.name AS route_name,
           b.code AS stop_code, b.name AS stop_name
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN routes r ON r.id = c.route_id
    JOIN bus_stops b ON b.id = c.bus_stop_id
    WHERE s.parent_id = ?
    ORDER BY c.issued_at DESC
  `).all(req.user.id);

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

// GET /api/cards/:id
router.get('/:id', (req, res) => {
  const card = loadCard(req.params.id, req.user);
  if (!card) return res.status(404).json({ error: 'Kartu tidak ditemukan.' });
  res.json({ ...card, grade_label: gradeLabel(card.grade) });
});

/**
 * GET /api/cards/:id/qr — mints a fresh QR payload.
 *
 * The front-end calls this every ~90 seconds while the card is on screen. A
 * suspended or revoked card gets no new payload at all: whatever image the family
 * saved earlier will still scan, but the scanner refuses it on status.
 */
router.get('/:id/qr', (req, res) => {
  const card = loadCard(req.params.id, req.user);
  if (!card) return res.status(404).json({ error: 'Kartu tidak ditemukan.' });

  if (card.status !== 'active') {
    return res.status(409).json({
      error: `Kartu ${card.status === 'revoked' ? 'sudah dicabut'
             : card.status === 'suspended' ? 'sedang ditangguhkan' : 'sudah kadaluarsa'}.`,
    });
  }

  res.json(issuePayload(card));
});

module.exports = router;

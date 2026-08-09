const express = require('express');
const db      = require('../db');
const { gradeLabel } = require('../lib/notify');

const router = express.Router();

// Read-only data for the Guru (school_staff) dashboard. There is no
// teacher-to-class mapping anywhere in the schema (users has no grade/class
// column, students only link to parent_id) — so this deliberately shows
// every grade, not "the guru's own class"; the frontend's grade filter is
// the closest substitute until that scoping exists.

// GET /api/guru/stats — same by_grade shape as GET /api/admin/stats, just
// without the operational fields (applications/cards/stops/routes/scans)
// admin.js also returns, which guru doesn't need and shouldn't see.
router.get('/stats', (req, res) => {
  const byGrade = db.prepare(`
    SELECT s.grade, COUNT(*) AS n
    FROM applications a JOIN students s ON s.id = a.student_id
    WHERE a.status NOT IN ('cancelled', 'rejected')
    GROUP BY s.grade
  `).all();

  res.json({ by_grade: byGrade.map((g) => ({ ...g, label: gradeLabel(g.grade) })) });
});

// GET /api/guru/students?grade= — students with an approved bus application
// (i.e. actually riding, not just applied), trimmed to what a teacher needs:
// name, grade, TPS, parent contact, card status. No card = approved but not
// yet issued a physical card.
router.get('/students', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id AS student_id, s.full_name AS student_name, s.grade,
           u.name AS parent_name, u.phone_primary,
           rq.code AS stop_code, rq.name AS stop_name,
           c.status AS card_status
    FROM applications a
    JOIN students  s  ON s.id  = a.student_id
    JOIN users     u  ON u.id  = a.parent_id
    JOIN bus_stops rq ON rq.id = a.requested_stop_id
    LEFT JOIN bus_id_cards c ON c.application_id = a.id
    WHERE a.status = 'approved'
      AND (:grade IS NULL OR s.grade = :grade)
    ORDER BY s.grade, s.full_name
  `).all({ grade: req.query.grade || null });

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

module.exports = router;

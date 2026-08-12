const express = require('express');
const db      = require('../db');
const { logActivity, fail } = require('../lib/cards');
const { CHECKLISTS, checklistDef, itemKeys, itemText } = require('../lib/safetyChecklists');

const router = express.Router();

// Mounted behind requireRole('attendant', 'transport_admin', 'school_staff') —
// the same staff tier as /api/scan, since this is filled in on the bus floor.
// 'contractor' (bus company leadership) is also let in, but view-only — same
// pattern as leader/admin's write-guard in routes/admin.js.
router.use((req, res, next) => {
  if (req.user.role === 'contractor' && req.method !== 'GET') {
    return res.status(403).json({ error: 'Peran Anda hanya dapat melihat data, tidak dapat mengubah.' });
  }
  next();
});

// GET /api/safety/definitions — the two checklist forms, sections and item text,
// so the frontend renders the form without duplicating the SOP wording.
router.get('/definitions', (req, res) => {
  res.json(CHECKLISTS);
});

// GET /api/safety/checklists?date=&bus_id=&checklist_type=&has_issues=&mine=
// Shared by the staff submission screen (has today's checklist for this bus
// already been filled in?), the crew's own "riwayat" list (mine=true — did
// my submission actually go through?), and the Transport Team's review list.
router.get('/checklists', (req, res) => {
  const { date, bus_id, checklist_type, has_issues, mine } = req.query;

  const rows = db.prepare(`
    SELECT c.id, c.bus_id, c.checklist_type, c.checklist_date, c.crew_name,
           c.has_issues, c.notes, c.created_at, c.updated_at,
           b.plate_number, b.label,
           u.name AS submitted_by_name
    FROM safety_checklists c
    JOIN buses b ON b.id = c.bus_id
    LEFT JOIN users u ON u.id = c.submitted_by
    WHERE (:date IS NULL OR c.checklist_date = :date)
      AND (:bus_id IS NULL OR c.bus_id = :bus_id)
      AND (:checklist_type IS NULL OR c.checklist_type = :checklist_type)
      AND (:has_issues IS NULL OR c.has_issues = :has_issues)
      AND (:submitted_by IS NULL OR c.submitted_by = :submitted_by)
    ORDER BY c.checklist_date DESC, c.created_at DESC
    LIMIT 200
  `).all({
    date: date || null,
    bus_id: bus_id || null,
    checklist_type: checklist_type || null,
    has_issues: has_issues === undefined || has_issues === '' ? null : (has_issues === 'true' ? 1 : 0),
    submitted_by: mine === 'true' ? req.user.id : null,
  });

  res.json(rows.map((r) => ({
    ...r,
    type_label: checklistDef(r.checklist_type)?.label || r.checklist_type,
  })));
});

// GET /api/safety/checklists/:id — full detail, including every item's status
// and note, with the SOP text resolved alongside each answer.
router.get('/checklists/:id', (req, res) => {
  const checklist = db.prepare(`
    SELECT c.*, b.plate_number, b.label, u.name AS submitted_by_name
    FROM safety_checklists c
    JOIN buses b ON b.id = c.bus_id
    LEFT JOIN users u ON u.id = c.submitted_by
    WHERE c.id = ?
  `).get(req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist tidak ditemukan.' });

  const items = db.prepare(`
    SELECT item_key, status, note FROM safety_checklist_items WHERE checklist_id = ?
  `).all(checklist.id);

  res.json({
    ...checklist,
    type_label: checklistDef(checklist.checklist_type)?.label || checklist.checklist_type,
    items: items.map((i) => ({ ...i, text: itemText(checklist.checklist_type, i.item_key) })),
  });
});

/**
 * POST /api/safety/checklists
 * Body: { bus_id, checklist_type, checklist_date?, crew_name, notes,
 *         items: [{ item_key, status: 'ok'|'not_ok'|'na', note }] }
 *
 * One submission per bus/type/day — resubmitting the same day replaces it
 * wholesale (a correction, not a second record), same pattern as the weekly
 * schedule editor in admin.js.
 */
router.post('/checklists', (req, res, next) => {
  const { bus_id, checklist_type, crew_name, notes, items } = req.body || {};
  const checklistDate = (req.body?.checklist_date || '').trim() || null;

  try {
    const def = checklistDef(checklist_type);
    if (!def) throw fail(400, 'Jenis checklist tidak dikenal.');

    // Driver and Helper accounts only fill in their own SOP form — the
    // Transport Team, school staff and the (legacy) general attendant role can
    // still submit either, same as before this split.
    if (req.user.role === 'driver' && checklist_type !== 'driver_pre_op') {
      throw fail(403, 'Akun Driver hanya dapat mengisi checklist Pre-Operational Check.');
    }
    if (req.user.role === 'helper' && checklist_type !== 'helper_safety_trip') {
      throw fail(403, 'Akun Helper hanya dapat mengisi checklist Safety Trip Procedure.');
    }

    const bus = db.prepare(`SELECT id FROM buses WHERE id = ? AND is_active = 1`).get(bus_id);
    if (!bus) throw fail(400, 'Unit bis tidak ditemukan.');

    const required = itemKeys(checklist_type);
    const submitted = Array.isArray(items) ? items : [];
    const byKey = new Map(submitted.map((i) => [i.item_key, i]));

    for (const key of required) {
      const entry = byKey.get(key);
      if (!entry || !['ok', 'not_ok', 'na'].includes(entry.status)) {
        throw fail(400, `Poin "${itemText(checklist_type, key)}" belum diisi.`);
      }
      if (entry.status === 'not_ok' && !entry.note?.trim()) {
        throw fail(400, `Keterangan wajib diisi untuk poin "${itemText(checklist_type, key)}" yang berstatus NO.`);
      }
    }

    const hasIssues = submitted.some((i) => i.status === 'not_ok') ? 1 : 0;

    db.exec('BEGIN');

    db.prepare(`
      INSERT INTO safety_checklists
        (bus_id, checklist_type, checklist_date, crew_name, submitted_by, has_issues, notes, updated_at)
      VALUES (?, ?, COALESCE(?, date('now', '+9 hours')), ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (bus_id, checklist_type, checklist_date) DO UPDATE SET
        crew_name = excluded.crew_name,
        submitted_by = excluded.submitted_by,
        has_issues = excluded.has_issues,
        notes = excluded.notes,
        updated_at = datetime('now')
    `).run(bus_id, checklist_type, checklistDate, crew_name?.trim() || null,
           req.user.id, hasIssues, notes?.trim() || null);

    const checklist = db.prepare(`
      SELECT id FROM safety_checklists
      WHERE bus_id = ? AND checklist_type = ? AND checklist_date = COALESCE(?, date('now', '+9 hours'))
    `).get(bus_id, checklist_type, checklistDate);

    db.prepare(`DELETE FROM safety_checklist_items WHERE checklist_id = ?`).run(checklist.id);
    const insertItem = db.prepare(`
      INSERT INTO safety_checklist_items (checklist_id, item_key, status, note)
      VALUES (?, ?, ?, ?)
    `);
    for (const key of required) {
      const entry = byKey.get(key);
      insertItem.run(checklist.id, key, entry.status, entry.note?.trim() || null);
    }

    db.exec('COMMIT');

    logActivity(req, 'safety_checklist.submitted', 'safety_checklists', checklist.id,
                { bus_id, checklist_type, has_issues: !!hasIssues });
    res.json({ ok: true, id: checklist.id, has_issues: !!hasIssues });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    next(err);
  }
});

module.exports = router;

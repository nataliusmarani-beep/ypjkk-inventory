const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { notify, templates, gradeLabel } = require('../lib/notify');
const {
  VIOLATION_CATEGORIES, assertSubmittable, assertCapacity,
  stopLoad, routeLoad, issueCard, logActivity, fail, parentCategoryLabel,
  scheduleByBus, normaliseTime, normaliseDate, formatPeriodLabel, getSetting, setSetting,
  todayWIT, sundayOf, addDays, resolveDutySchedule, writeDutySlotScheduleRows, materializeDutySchedule,
} = require('../lib/cards');

const router = express.Router();

// Everything in this file is Transport Team only; server.js mounts it behind
// requireRole('transport_admin', 'leader', 'admin'). 'leader' and 'admin'
// (Admin Sekolah) are read-only supervisor roles — they see everything below,
// but cannot approve, sanction, broadcast, create accounts, or make any other
// change, so every non-GET request from either role is refused here in one
// place rather than in every handler.
const READ_ONLY_ROLES = ['leader', 'admin'];
router.use((req, res, next) => {
  if (READ_ONLY_ROLES.includes(req.user.role) && req.method !== 'GET') {
    return res.status(403).json({ error: 'Peran Anda hanya dapat melihat data, tidak dapat mengubah.' });
  }
  next();
});

// ── Dashboard ──────────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM applications GROUP BY status
  `).all().reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});

  const cards = db.prepare(`
    SELECT status, COUNT(*) AS n FROM bus_id_cards GROUP BY status
  `).all().reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});

  const byGrade = db.prepare(`
    SELECT s.grade, COUNT(*) AS n
    FROM applications a JOIN students s ON s.id = a.student_id
    WHERE a.status NOT IN ('cancelled','rejected')
    GROUP BY s.grade
  `).all();

  res.json({
    applications: counts,
    cards,
    by_grade: byGrade.map((g) => ({ ...g, label: gradeLabel(g.grade) })),
    stops: stopLoad(),
    routes: routeLoad(),
    scans_today: db.prepare(`
      SELECT COUNT(*) AS n FROM scan_logs WHERE date(scanned_at, '+9 hours') = date('now', '+9 hours')
    `).get().n,
    edit_requests: db.prepare(`
      SELECT COUNT(*) AS n FROM applications WHERE edit_requested_at IS NOT NULL
    `).get().n,
  });
});

// ── Verification queue ─────────────────────────────────────────────────────

// GET /api/admin/applications?status=submitted&stop_id=&grade=&q=
router.get('/applications', (req, res) => {
  const { status, stop_id, grade, q } = req.query;

  const rows = db.prepare(`
    SELECT a.id, a.application_no, a.status, a.submitted_at, a.reviewed_at,
           a.rejection_reason, a.revision_note, a.notes_for_admin,
           s.id AS student_id, s.full_name AS student_name, s.grade, s.photo_file,
           u.name AS parent_name, u.email AS parent_email, u.phone_primary,
           u.employee_id, u.parent_category, u.department, u.home_address,
           rq.id AS requested_stop_id, rq.code AS requested_stop_code,
           rq.name AS requested_stop_name, rq.area,
           r.code AS route_code,
           c.id AS card_id, c.card_no, c.status AS card_status
    FROM applications a
    JOIN students  s  ON s.id  = a.student_id
    JOIN users     u  ON u.id  = a.parent_id
    JOIN bus_stops rq ON rq.id = a.requested_stop_id
    LEFT JOIN routes r ON r.id = a.assigned_route_id
    LEFT JOIN bus_id_cards c ON c.application_id = a.id
    WHERE (:status IS NULL OR a.status = :status)
      AND (:stop_id IS NULL OR a.requested_stop_id = :stop_id)
      AND (:grade IS NULL OR s.grade = :grade)
      AND (:q IS NULL OR s.full_name LIKE :like OR u.name LIKE :like
                      OR u.employee_id LIKE :like OR a.application_no LIKE :like)
    ORDER BY
      CASE a.status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
      a.submitted_at
  `).all({
    status: status || null,
    stop_id: stop_id || null,
    grade: grade || null,
    q: q || null,
    like: q ? `%${q}%` : null,
  });

  // Flags the old spreadsheet could not produce: the same child submitted twice
  // (rows 2 and 3 of the 2024/25 export), and a stop already at capacity.
  // Cancelled/rejected applications are dead ends, not a live second entry —
  // counting them flagged every ordinary "cancelled, then resubmitted and
  // approved" case (e.g. Injil Ibrani Korey) as a false-positive duplicate.
  const load = stopLoad();
  const nameCounts = rows.reduce((acc, r) => {
    if (['cancelled', 'rejected'].includes(r.status)) return acc;
    const key = `${r.student_name.trim().toLowerCase()}|${r.grade}`;
    return { ...acc, [key]: (acc[key] || 0) + 1 };
  }, {});

  res.json(rows.map((r) => {
    const stop = load.find((s) => s.id === r.requested_stop_id);
    return {
      ...r,
      grade_label: gradeLabel(r.grade),
      parent_category_label: parentCategoryLabel(r.parent_category),
      stop_load: stop
        ? { issued: stop.issued_active, capacity: stop.seat_capacity,
            full: stop.seat_capacity > 0 && stop.issued_active >= stop.seat_capacity }
        : null,
      possible_duplicate:
        nameCounts[`${r.student_name.trim().toLowerCase()}|${r.grade}`] > 1,
    };
  }));
});

// GET /api/admin/applications/:id — full detail for the review drawer.
router.get('/applications/:id', (req, res) => {
  const app = db.prepare(`
    SELECT a.*, s.full_name AS student_name, s.grade, s.nis, s.photo_file,
           u.name AS parent_name, u.email AS parent_email, u.phone_primary,
           u.phone_alternate, u.phone_alternate_owner, u.employee_id,
           u.parent_category, u.department, u.home_address,
           rq.code AS requested_stop_code, rq.name AS requested_stop_name
    FROM applications a
    JOIN students s ON s.id = a.student_id
    JOIN users u ON u.id = a.parent_id
    JOIN bus_stops rq ON rq.id = a.requested_stop_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!app) return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });

  const consent = db.prepare(`
    SELECT c.*, r.version AS rules_version, r.title AS rules_title
    FROM consents c JOIN rule_documents r ON r.id = c.rule_document_id
    WHERE c.application_id = ?
  `).get(app.id);

  res.json({
    ...app,
    grade_label: gradeLabel(app.grade),
    parent_category_label: parentCategoryLabel(app.parent_category),
    submitted_snapshot: app.submitted_snapshot ? JSON.parse(app.submitted_snapshot) : null,
    documents: db.prepare(`
      SELECT doc_type, file_name, mime_type, size_bytes, uploaded_at
      FROM application_documents WHERE application_id = ?
    `).all(app.id),
    consent,
    card: db.prepare(`SELECT * FROM bus_id_cards WHERE application_id = ?`).get(app.id) || null,
    stops: stopLoad(),
    routes: routeLoad(),
  });
});

// POST /api/admin/applications/:id/claim — moves it into 'under_review' so two
// admins don't work the same row.
router.post('/applications/:id/claim', (req, res) => {
  const info = db.prepare(`
    UPDATE applications
    SET status = 'under_review', reviewed_by = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'submitted'
  `).run(req.user.id, req.params.id);

  if (!info.changes) {
    return res.status(409).json({ error: 'Pengajuan ini sudah ditinjau oleh admin lain.' });
  }
  logActivity(req, 'application.claimed', 'applications', Number(req.params.id), null);
  res.json({ ok: true });
});

/**
 * POST /api/admin/applications/:id/decision
 * Body: { decision: 'approve'|'reject'|'request_revision',
 *         route_id, stop_id, reason }
 *
 * A child is assigned to a route + TPS only, never to a specific bus unit —
 * units rotate which TPS they cover week to week (see "Jadwal & Rute per
 * Bis"/bus_route_stops), so a fixed per-child bus assignment would just go
 * stale the following week. Approval also issues the Bus ID Card inside the
 * same transaction — an application can never be 'approved' without a card,
 * and a card can never exist without a signed consent record.
 */
router.post('/applications/:id/decision', (req, res, next) => {
  const { decision, route_id, stop_id, reason } = req.body || {};

  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (!['submitted', 'under_review'].includes(app.status)) {
      throw fail(409, `Pengajuan dengan status ${app.status} tidak dapat ditinjau.`);
    }

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(app.parent_id);

    if (decision === 'approve') {
      const routeId = route_id || app.assigned_route_id;
      const stopId  = stop_id  || app.assigned_stop_id || app.requested_stop_id;
      if (!routeId) throw fail(400, 'Rute wajib dipilih sebelum menyetujui.');

      assertSubmittable(app.id);
      assertCapacity(routeId, stopId);

      db.exec('BEGIN');
      db.prepare(`
        UPDATE applications
        SET status = 'approved', assigned_route_id = ?, assigned_stop_id = ?,
            reviewed_by = ?, reviewed_at = datetime('now'),
            rejection_reason = NULL, revision_note = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(routeId, stopId, req.user.id, app.id);

      const approved = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(app.id);
      const card = issueCard(approved);
      db.exec('COMMIT');

      logActivity(req, 'application.approved', 'applications', app.id,
                  { card_no: card.card_no, route_id: routeId, stop_id: stopId });
      notify({
        userId: parent.id, email: parent.email,
        ...templates.approved(approved, student, card),
      });
      return res.json({ ok: true, card });
    }

    if (decision === 'reject') {
      if (!reason?.trim()) throw fail(400, 'Alasan penolakan wajib diisi.');
      db.prepare(`
        UPDATE applications
        SET status = 'rejected', rejection_reason = ?, reviewed_by = ?,
            reviewed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(reason.trim(), req.user.id, app.id);

      logActivity(req, 'application.rejected', 'applications', app.id, { reason });
      notify({
        userId: parent.id, email: parent.email,
        ...templates.rejected(app, student, reason.trim()),
      });
      return res.json({ ok: true });
    }

    if (decision === 'request_revision') {
      if (!reason?.trim()) throw fail(400, 'Catatan perbaikan wajib diisi.');
      db.prepare(`
        UPDATE applications
        SET status = 'revision_requested', revision_note = ?, reviewed_by = ?,
            reviewed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(reason.trim(), req.user.id, app.id);

      logActivity(req, 'application.revision_requested', 'applications', app.id, { reason });
      notify({
        userId: parent.id, email: parent.email,
        ...templates.revision(app, student, reason.trim()),
      });
      return res.json({ ok: true });
    }

    throw fail(400, 'Keputusan tidak dikenal.');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    next(err);
  }
});

/**
 * POST /api/admin/applications/:id/remind — resend the revision-request
 * notification for an application still sitting at 'revision_requested'.
 *
 * A parent who hasn't fixed and resubmitted after the first notice is the
 * day-to-day case this exists for — the note is unchanged, only the nudge
 * (in-app + email) goes out again, so it doesn't touch reviewed_at/status.
 */
router.post('/applications/:id/remind', (req, res, next) => {
  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (app.status !== 'revision_requested') {
      throw fail(409, `Pengajuan dengan status ${app.status} tidak sedang menunggu perbaikan.`);
    }

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(app.parent_id);

    logActivity(req, 'application.revision_reminder_sent', 'applications', app.id, {});
    notify({
      userId: parent.id, email: parent.email,
      ...templates.revision(app, student, app.revision_note),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/applications/:id/undo-revision — reverses a mistaken "Minta
 * Perbaikan", restoring the application to 'submitted' so it re-enters the
 * normal queue for review/approval. Super admin only: a transport_admin
 * mistakenly flagging an application is exactly the case that made this
 * necessary, so the fix isn't left in the hands of the same role.
 */
router.post('/applications/:id/undo-revision', (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      throw fail(403, 'Hanya Super Admin yang dapat membatalkan permintaan perbaikan.');
    }
    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (app.status !== 'revision_requested') {
      throw fail(409, `Pengajuan dengan status ${app.status} tidak sedang menunggu perbaikan.`);
    }

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(app.parent_id);

    db.prepare(`
      UPDATE applications
      SET status = 'submitted', revision_note = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(app.id);

    logActivity(req, 'application.revision_undone', 'applications', app.id,
                { previous_note: app.revision_note });
    notify({
      userId: parent.id, email: parent.email,
      ...templates.revisionCancelled(app, student),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Edit-access requests ──────────────────────────────────────────────────
// A parent on an already-approved application asking to fix data (see
// routes/applications.js POST /:id/request-edit). Separate from the queue
// above: these apps are 'approved', not 'submitted'/'under_review'.

// GET /api/admin/edit-requests
router.get('/edit-requests', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.application_no, a.edit_requested_at, a.edit_request_note,
           s.full_name AS student_name, s.grade,
           u.name AS parent_name, u.phone_primary
    FROM applications a
    JOIN students s ON s.id = a.student_id
    JOIN users u ON u.id = a.parent_id
    WHERE a.edit_requested_at IS NOT NULL
    ORDER BY a.edit_requested_at
  `).all();
  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

/**
 * POST /api/admin/applications/:id/edit-request/approve
 *
 * Reopens the edit form by moving status back to 'revision_requested' — the
 * exact same state an admin-initiated correction leaves an app in, so the
 * parent's edit form (PUT /api/applications/:id) doesn't need to know which
 * path got them there.
 */
router.post('/applications/:id/edit-request/approve', (req, res, next) => {
  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (!app.edit_requested_at) throw fail(409, 'Tidak ada permintaan perubahan data yang menunggu.');

    db.prepare(`
      UPDATE applications
      SET status = 'revision_requested', revision_note = ?, edit_requested_at = NULL,
          edit_request_note = NULL, reviewed_by = ?, reviewed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(app.edit_request_note, req.user.id, app.id);

    logActivity(req, 'application.edit_request_approved', 'applications', app.id, null);

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(app.parent_id);
    notify({
      userId: parent.id, email: parent.email,
      ...templates.editRequestApproved(app, student),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/applications/:id/edit-request/deny
router.post('/applications/:id/edit-request/deny', (req, res, next) => {
  try {
    const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
    if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');
    if (!app.edit_requested_at) throw fail(409, 'Tidak ada permintaan perubahan data yang menunggu.');

    const reason = (req.body?.reason || '').trim();

    db.prepare(`
      UPDATE applications SET edit_requested_at = NULL, edit_request_note = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(app.id);

    logActivity(req, 'application.edit_request_denied', 'applications', app.id, { reason });

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(app.parent_id);
    notify({
      userId: parent.id, email: parent.email,
      ...templates.editRequestDenied(app, student, reason),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/students/:id
 *
 * For duplicate or mistaken submissions — the old spreadsheet had exactly
 * this problem (two rows for one child) with no way to clean it up. Deleting
 * the student cascades to their application(s), card(s), violations and
 * complaints (all declared ON DELETE CASCADE in db.js), so this is a genuine
 * "remove everything about this child" action, not a soft hide.
 */
router.delete('/students/:id', (req, res, next) => {
  try {
    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(req.params.id);
    if (!student) throw fail(404, 'Siswa tidak ditemukan.');

    db.prepare(`DELETE FROM students WHERE id = ?`).run(student.id);

    logActivity(req, 'student.deleted', 'students', student.id, { full_name: student.full_name });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Cards ──────────────────────────────────────────────────────────────────

// GET /api/admin/cards?status=&route_id=
router.get('/cards', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, s.full_name AS student_name, s.grade,
           u.name AS parent_name, u.phone_primary,
           r.code AS route_code, r.name AS route_name,
           b.code AS stop_code, b.name AS stop_name
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN users u ON u.id = s.parent_id
    JOIN routes r ON r.id = c.route_id
    JOIN bus_stops b ON b.id = c.bus_stop_id
    WHERE (:status IS NULL OR c.status = :status)
      AND (:route_id IS NULL OR c.route_id = :route_id)
    ORDER BY r.code, b.sort_order, s.full_name
  `).all({ status: req.query.status || null, route_id: req.query.route_id || null });

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

/**
 * POST /api/admin/cards/:id/sanction
 * Body: { action:'warning'|'suspension'|'revocation', reason, ends_on,
 *         violation:{category, description, severity} }
 *
 * This is the consequence the parent explicitly consented to at registration.
 * A suspension or revocation flips the card status, which the scanner enforces
 * on the next boarding attempt.
 */
router.post('/cards/:id/sanction', (req, res, next) => {
  const { action, reason, ends_on, violation } = req.body || {};

  try {
    const card = db.prepare(`SELECT * FROM bus_id_cards WHERE id = ?`).get(req.params.id);
    if (!card) throw fail(404, 'Kartu tidak ditemukan.');
    if (!['warning', 'suspension', 'revocation'].includes(action)) {
      throw fail(400, 'Jenis sanksi tidak dikenal.');
    }
    if (!reason?.trim()) throw fail(400, 'Alasan sanksi wajib diisi.');
    if (action === 'suspension' && !ends_on) {
      throw fail(400, 'Tanggal berakhir penangguhan wajib diisi.');
    }

    db.exec('BEGIN');

    let violationId = null;
    if (violation?.category) {
      if (!VIOLATION_CATEGORIES.includes(violation.category)) {
        throw fail(400, 'Kategori pelanggaran tidak dikenal.');
      }
      const info = db.prepare(`
        INSERT INTO violations
          (student_id, card_id, category, severity, description, reported_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(card.student_id, card.id, violation.category,
             violation.severity || 1, violation.description?.trim() || null, req.user.id);
      violationId = Number(info.lastInsertRowid);
    }

    db.prepare(`
      INSERT INTO sanctions
        (student_id, violation_id, card_id, action, reason, ends_on, issued_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(card.student_id, violationId, card.id, action, reason.trim(),
           action === 'suspension' ? ends_on : (ends_on || null), req.user.id);

    if (action !== 'warning') {
      db.prepare(`
        UPDATE bus_id_cards
        SET status = ?, status_reason = ?, status_changed_at = datetime('now')
        WHERE id = ?
      `).run(action === 'revocation' ? 'revoked' : 'suspended', reason.trim(), card.id);
    }

    db.exec('COMMIT');

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(card.student_id);
    const parent  = db.prepare(`SELECT * FROM users WHERE id = ?`).get(student.parent_id);
    logActivity(req, `sanction.${action}`, 'bus_id_cards', card.id, { reason });
    if (action !== 'warning') {
      notify({
        userId: parent.id, email: parent.email,
        ...templates.sanction(student, action, reason.trim()),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* no open transaction */ }
    next(err);
  }
});

// POST /api/admin/cards/:id/reinstate — lifts a suspension early.
router.post('/cards/:id/reinstate', (req, res) => {
  const info = db.prepare(`
    UPDATE bus_id_cards
    SET status = 'active', status_reason = NULL, status_changed_at = datetime('now')
    WHERE id = ? AND status = 'suspended' AND valid_until >= date('now')
  `).run(req.params.id);

  if (!info.changes) {
    return res.status(409).json({
      error: 'Hanya kartu yang ditangguhkan dan belum kadaluarsa dapat diaktifkan kembali.',
    });
  }
  db.prepare(`
    UPDATE sanctions SET ends_on = date('now')
    WHERE card_id = ? AND action = 'suspension' AND (ends_on IS NULL OR ends_on > date('now'))
  `).run(req.params.id);

  logActivity(req, 'card.reinstated', 'bus_id_cards', Number(req.params.id), null);
  res.json({ ok: true });
});

// ── Manifests, violations, exports ─────────────────────────────────────────

// GET /api/admin/manifest?route_id= — who should be on which bus today.
router.get('/manifest', (req, res) => {
  const rows = db.prepare(`
    SELECT c.card_no, c.transit_id, c.status, s.full_name AS student_name, s.grade,
           b.code AS stop_code, b.name AS stop_name, b.sort_order,
           u.name AS parent_name, u.phone_primary
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN users u ON u.id = s.parent_id
    JOIN bus_stops b ON b.id = c.bus_stop_id
    WHERE c.status = 'active'
      AND (:route_id IS NULL OR c.route_id = :route_id)
    ORDER BY b.sort_order, s.full_name
  `).all({ route_id: req.query.route_id || null });

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

// GET /api/admin/trip-events — today's recorded departures, newest first. The
// dashboard's substitute for a live map: no GPS in this app (see bus_route_stops
// comment in db.js), so this is the closest real signal to "where are the buses".
router.get('/trip-events', (req, res) => {
  const rows = db.prepare(`
    SELECT te.id, te.direction, te.event, te.created_at, b.id AS bus_id,
           b.plate_number, b.label,
           CASE WHEN b.seat_capacity >= 45 THEN 'besar' ELSE 'kecil' END AS bus_group,
           s.code AS stop_code, s.name AS stop_name,
           u.name AS recorded_by_name
    FROM trip_events te
    JOIN buses b ON b.id = te.bus_id
    LEFT JOIN bus_stops s ON s.id = te.bus_stop_id
    LEFT JOIN users u ON u.id = te.recorded_by
    WHERE date(te.created_at, '+9 hours') = date('now', '+9 hours')
    ORDER BY te.id DESC
    LIMIT 30
  `).all();

  // Nomor tugas (duty_number) per unit for TODAY, so the dashboard feed can
  // tell buses apart at a glance instead of just reading plate numbers —
  // same rotation resolveDutySchedule already computes for the schedule
  // page, just inverted from duty_number->bus_id to bus_id->duty_number.
  const mapping = resolveDutySchedule(todayWIT());
  const dutyByBus = new Map();
  for (const group of ['besar', 'kecil']) {
    for (const { duty_number, bus_id } of mapping[group]) dutyByBus.set(bus_id, duty_number);
  }

  res.json(rows.map((r) => ({ ...r, duty_number: dutyByBus.get(r.bus_id) ?? null })));
});

// GET /api/admin/violations
router.get('/violations', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, s.full_name AS student_name, s.grade,
           u.name AS reported_by_name
    FROM violations v
    JOIN students s ON s.id = v.student_id
    LEFT JOIN users u ON u.id = v.reported_by
    ORDER BY v.occurred_at DESC
    LIMIT 200
  `).all();
  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

// ── Bus service schedule (weekly rolling roster) ───────────────────────────

// GET /api/admin/schedule — the same shape parents see, plus the full TPS list
// so the editor can offer every stop as a choice for each bus.
router.get('/schedule', (req, res) => {
  // "Periode Rotasi Aktif" — Minggu s/d Sabtu covering today, computed fresh
  // on every request rather than read from a manually-set setting. It used
  // to be schedule_period_start/end (PUT /schedule/period below), a value
  // nobody had a UI to update — it just went stale and sat there. Computing
  // it live both fixes that permanently and starts the displayed week on
  // Minggu instead of Senin, so Driver/Helper see it a day earlier (see
  // sundayOf in lib/cards.js).
  const period_start = sundayOf(todayWIT());
  const period_end = addDays(period_start, 6);
  res.json({
    period: formatPeriodLabel(period_start, period_end),
    period_start,
    period_end,
    buses: scheduleByBus(),
    stops: stopLoad().filter((s) => s.is_active).map((s) => ({
      id: s.id, code: s.code, name: s.name, area: s.area,
    })),
    routes: routeLoad(),
  });
});

// PUT /api/admin/schedule/period — retained for compatibility, but no longer
// read anywhere: GET /schedule (above) and GET /meta/schedule now compute
// the displayed period live instead of trusting a value that had no UI to
// keep it current. Kept as a no-op-safe endpoint rather than removed, in
// case anything external still calls it.
router.put('/schedule/period', (req, res) => {
  const start = normaliseDate(req.body?.start_date);
  const end = normaliseDate(req.body?.end_date);
  if (start && end && end < start) {
    throw fail(400, 'Tanggal akhir tidak boleh sebelum tanggal mulai.');
  }
  setSetting('schedule_period_start', start);
  setSetting('schedule_period_end', end);
  logActivity(req, 'schedule.period_updated', 'settings', null, { start_date: start, end_date: end });
  res.json({ ok: true });
});

/**
 * PUT /api/admin/schedule/bus/:id
 * Body: { plate_number, label, seat_capacity, driver_name, helper_name, school_arrival_time }
 *
 * A unit's identity and crew only — plate, label, seat count, driver/helper
 * names, and the pickup-round arrival bookend. TPS/route/trips are no longer
 * edited per-bus: they live on the duty slot this bus currently fills (see
 * the "Rotasi Tugas Bis" endpoints below), which materializes into
 * bus_route_stops/bus_trips automatically. Editing them here too would just
 * get silently overwritten the next time the rotation re-applies — see
 * writeBusScheduleRows/materializeDutySchedule in lib/cards.js.
 */
router.put('/schedule/bus/:id', (req, res, next) => {
  const busId = Number(req.params.id);

  try {
    const bus = db.prepare(`SELECT * FROM buses WHERE id = ? AND is_active = 1`).get(busId);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const plate = (req.body?.plate_number || '').trim();
    if (!plate) throw fail(400, 'No. Bus wajib diisi.');

    const seatCapacity = req.body?.seat_capacity === '' || req.body?.seat_capacity == null
      ? 0 : Number(req.body.seat_capacity);
    if (!Number.isInteger(seatCapacity) || seatCapacity < 0) {
      throw fail(400, 'Jumlah seat tidak valid.');
    }

    const clash = db.prepare(`
      SELECT id FROM buses WHERE lower(plate_number) = lower(?) AND id <> ?
    `).get(plate, busId);
    if (clash) throw fail(409, `No. Bus ${plate} sudah terdaftar pada unit lain.`);

    db.prepare(`
      UPDATE buses SET plate_number = ?, label = ?, seat_capacity = ?, driver_name = ?, helper_name = ?,
                        school_arrival_time = ?
      WHERE id = ?
    `).run(plate,
           (req.body?.label || '').trim() || null,
           seatCapacity,
           (req.body?.driver_name || '').trim() || null,
           (req.body?.helper_name || '').trim() || null,
           normaliseTime(req.body?.school_arrival_time),
           busId);

    logActivity(req, 'schedule.bus_updated', 'buses', busId, { plate });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/schedule/bus — register another unit in the fleet.
router.post('/schedule/bus', (req, res, next) => {
  try {
    const plate = (req.body?.plate_number || '').trim();
    if (!plate) throw fail(400, 'No. Bus wajib diisi.');

    const existing = db.prepare(`
      SELECT id, is_active FROM buses WHERE lower(plate_number) = lower(?)
    `).get(plate);

    if (existing?.is_active) throw fail(409, `No. Bus ${plate} sudah terdaftar.`);
    if (existing) {
      // Previously retired: bring the same vehicle record back rather than
      // inserting a duplicate against the UNIQUE plate.
      db.prepare(`UPDATE buses SET is_active = 1, route_id = ? WHERE id = ?`)
        .run(req.body?.route_id || null, existing.id);
      logActivity(req, 'schedule.bus_added', 'buses', existing.id, { plate });
      return res.status(201).json({ ok: true, bus_id: existing.id });
    }

    const info = db.prepare(`
      INSERT INTO buses (plate_number, route_id) VALUES (?, ?)
    `).run(plate, req.body?.route_id || null);
    logActivity(req, 'schedule.bus_added', 'buses', Number(info.lastInsertRowid), { plate });
    res.status(201).json({ ok: true, bus_id: Number(info.lastInsertRowid) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/schedule/bus/:id — retire a unit. Deactivated, not deleted:
// scan_logs and applications may still reference it.
router.delete('/schedule/bus/:id', (req, res) => {
  const info = db.prepare(`UPDATE buses SET is_active = 0 WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Bis tidak ditemukan.' });
  db.prepare(`DELETE FROM bus_route_stops WHERE bus_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM bus_trips WHERE bus_id = ?`).run(req.params.id);
  logActivity(req, 'schedule.bus_removed', 'buses', Number(req.params.id), null);
  res.json({ ok: true });
});

// ── Nomor tugas: duty-slot rotation ─────────────────────────────────────────
// Authoring layer on top of the per-bus schedule above — see the big comment
// on resolveDutySchedule/materializeDutySchedule in lib/cards.js. Admin fills
// in each duty slot's own TPS list per weekday (exactly the same picker as a
// bus, above — small units in particular split dropoff coverage across days,
// e.g. unit A runs a trip Senin/Rabu, unit B covers the same trip Selasa/
// Kamis/Jumat) + the base bus order once; server.js re-materializes
// automatically every day (WIT), and the /apply endpoint below lets an admin
// trigger it immediately after a change instead of waiting.
const WEEKDAYS = [1, 2, 3, 4, 5]; // 1=Senin .. 5=Jumat

// GET /api/admin/duty-schedule — the 8 slots, each with its TPS list + trips
// PER WEEKDAY (same shape as a bus in GET /schedule — see scheduleByBus, just
// keyed by weekday 1-5), the configured rotation order, and today's resolved
// bus mapping.
router.get('/duty-schedule', (req, res) => {
  const slotStops = db.prepare(`
    SELECT dss.duty_slot_id, dss.weekday, dss.bus_stop_id, dss.sequence,
           dss.pickup_times, dss.pickup_sequences,
           dss.dropoff_times, dss.dropoff_sequences,
           s.code AS stop_code, s.name AS stop_name
    FROM duty_slot_stops dss JOIN bus_stops s ON s.id = dss.bus_stop_id
    ORDER BY dss.duty_slot_id, dss.weekday, dss.sequence
  `).all();
  const stopsBySlotDay = new Map();
  for (const s of slotStops) {
    const key = `${s.duty_slot_id}|${s.weekday}`;
    if (!stopsBySlotDay.has(key)) stopsBySlotDay.set(key, []);
    stopsBySlotDay.get(key).push({
      ...s,
      pickup_times: JSON.parse(s.pickup_times || '[]'),
      pickup_sequences: JSON.parse(s.pickup_sequences || '[]'),
      dropoff_times: JSON.parse(s.dropoff_times || '[]'),
      dropoff_sequences: JSON.parse(s.dropoff_sequences || '[]'),
    });
  }

  // A trip's own stop list isn't stored directly — duty_slot_stops holds the
  // union of stops for the whole day, with {pickup,dropoff}_sequences[i]
  // (parallel to trip_number i+1) saying whether/where a stop falls in that
  // trip. Reconstruct it here so every trip round-trips populated instead of
  // empty — same reconstruction for both directions, just keyed off a
  // different pair of columns.
  function tripsFromStops(rows, tripRows, seqKey, timeKey, timeField) {
    return tripRows.map((t) => {
      const stops = rows
        .filter((s) => s[seqKey][t.trip_number - 1] != null)
        .sort((a, b) => a[seqKey][t.trip_number - 1] - b[seqKey][t.trip_number - 1])
        .map((s) => ({
          bus_stop_id: s.bus_stop_id,
          [timeField]: s[timeKey][t.trip_number - 1],
          stop_code: s.stop_code,
          stop_name: s.stop_name,
        }));
      return { ...t, stops };
    });
  }

  const slotTrips = db.prepare(`
    SELECT duty_slot_id, weekday, trip_number, departure_time FROM duty_slot_trips
    ORDER BY duty_slot_id, weekday, trip_number
  `).all();
  const tripsBySlotDay = new Map();
  for (const t of slotTrips) {
    const key = `${t.duty_slot_id}|${t.weekday}`;
    if (!tripsBySlotDay.has(key)) tripsBySlotDay.set(key, []);
  }
  for (const key of tripsBySlotDay.keys()) {
    const [duty_slot_id, weekday] = key.split('|').map(Number);
    const rows = stopsBySlotDay.get(key) || [];
    const dayTrips = slotTrips.filter((t) => t.duty_slot_id === duty_slot_id && t.weekday === weekday);
    tripsBySlotDay.set(key, tripsFromStops(rows, dayTrips, 'dropoff_sequences', 'dropoff_times', 'dropoff_time'));
  }

  const slotPickupTrips = db.prepare(`
    SELECT duty_slot_id, weekday, trip_number, arrival_time FROM duty_slot_pickup_trips
    ORDER BY duty_slot_id, weekday, trip_number
  `).all();
  const pickupTripsBySlotDay = new Map();
  for (const t of slotPickupTrips) {
    const key = `${t.duty_slot_id}|${t.weekday}`;
    if (!pickupTripsBySlotDay.has(key)) pickupTripsBySlotDay.set(key, []);
  }
  for (const key of pickupTripsBySlotDay.keys()) {
    const [duty_slot_id, weekday] = key.split('|').map(Number);
    const rows = stopsBySlotDay.get(key) || [];
    const dayTrips = slotPickupTrips.filter((t) => t.duty_slot_id === duty_slot_id && t.weekday === weekday);
    pickupTripsBySlotDay.set(key, tripsFromStops(rows, dayTrips, 'pickup_sequences', 'pickup_times', 'pickup_time'));
  }

  const slots = db.prepare(`SELECT id, bus_group, duty_number, fixed_bus_id FROM duty_slots ORDER BY bus_group, duty_number`).all();

  const slotDays = db.prepare(`SELECT duty_slot_id, weekday, school_arrival_time FROM duty_slot_days`).all();
  const arrivalBySlotDay = new Map(slotDays.map((d) => [`${d.duty_slot_id}|${d.weekday}`, d.school_arrival_time]));

  const buses = db.prepare(`
    SELECT id, plate_number, label, seat_capacity,
           CASE WHEN seat_capacity >= 45 THEN 'besar' ELSE 'kecil' END AS bus_group
    FROM buses WHERE is_active = 1 ORDER BY plate_number
  `).all();

  res.json({
    slots: slots.map((s) => ({
      ...s,
      days: Object.fromEntries(WEEKDAYS.map((w) => [w, {
        pickup_trips: pickupTripsBySlotDay.get(`${s.id}|${w}`) || [],
        trips: tripsBySlotDay.get(`${s.id}|${w}`) || [],
        // Read-only now — derived automatically from the last pickup trip's
        // arrival_time by writeDutySlotScheduleRows, kept here only for the
        // legacy read paths that still show a single "Tiba di Sekolah" time.
        school_arrival_time: arrivalBySlotDay.get(`${s.id}|${w}`) || null,
      }])),
    })),
    buses,
    // Full TPS master list, same shape as GET /schedule's — the duty-slot
    // editor uses the identical TPS-picker as the per-bus editor.
    stops: db.prepare(`SELECT id, code, name, area FROM bus_stops WHERE is_active = 1 ORDER BY sort_order`).all(),
    duty_order_besar: JSON.parse(getSetting('duty_order_besar') || 'null'),
    duty_order_kecil: JSON.parse(getSetting('duty_order_kecil') || 'null'),
    duty_reference_monday: getSetting('duty_reference_monday'),
    this_week: resolveDutySchedule(todayWIT()),
  });
});

/**
 * PUT /api/admin/duty-schedule/slot/:id/day/:weekday — replace one duty
 * slot's pickup trips + dropoff trips for ONE weekday (1=Senin .. 5=Jumat)
 * only. Same body shape and semantics as PUT /admin/schedule/bus/:id used to
 * have (see git history) — a duty slot/day is configured with exactly the
 * same trip-picker UI as a bus, just without the plate/crew fields.
 * school_arrival_time is no longer accepted directly — it's derived from the
 * last pickup trip's arrival_time by writeDutySlotScheduleRows.
 * Body: { pickup_trips: [{ arrival_time, stops: [{ bus_stop_id, pickup_time }] }],
 *         trips: [{ departure_time, stops: [{ bus_stop_id, dropoff_time }] }] }
 */
router.put('/duty-schedule/slot/:id/day/:weekday', (req, res, next) => {
  try {
    const slot = db.prepare(`SELECT * FROM duty_slots WHERE id = ?`).get(req.params.id);
    if (!slot) throw fail(404, 'Nomor tugas tidak ditemukan.');

    const weekday = Number(req.params.weekday);
    if (!WEEKDAYS.includes(weekday)) throw fail(400, 'Hari tidak valid.');

    const tripsBody = Array.isArray(req.body?.trips) ? req.body.trips : [];
    const trips = tripsBody.map((t) => ({
      departure_time: normaliseTime(t?.departure_time),
      stops: (Array.isArray(t?.stops) ? t.stops : []).map((s) => ({
        bus_stop_id: Number(s.bus_stop_id),
        dropoff_time: normaliseTime(s.dropoff_time),
      })),
    }));
    for (const t of trips) {
      if (t.stops.some((s) => !Number.isInteger(s.bus_stop_id) || s.bus_stop_id <= 0)) {
        throw fail(400, 'Terdapat TPS yang tidak dikenali pada salah satu trip pengantaran.');
      }
      const seenInTrip = new Set();
      for (const s of t.stops) {
        if (seenInTrip.has(s.bus_stop_id)) throw fail(409, 'TPS yang sama dipilih dua kali pada trip pengantaran yang sama.');
        seenInTrip.add(s.bus_stop_id);
      }
    }

    const pickupTripsBody = Array.isArray(req.body?.pickup_trips) ? req.body.pickup_trips : [];
    const pickupTrips = pickupTripsBody.map((t) => ({
      arrival_time: normaliseTime(t?.arrival_time),
      stops: (Array.isArray(t?.stops) ? t.stops : []).map((s) => ({
        bus_stop_id: Number(s.bus_stop_id),
        pickup_time: normaliseTime(s.pickup_time),
      })),
    }));
    for (const t of pickupTrips) {
      if (t.stops.some((s) => !Number.isInteger(s.bus_stop_id) || s.bus_stop_id <= 0)) {
        throw fail(400, 'Terdapat TPS yang tidak dikenali pada salah satu trip penjemputan.');
      }
      const seenInTrip = new Set();
      for (const s of t.stops) {
        if (seenInTrip.has(s.bus_stop_id)) throw fail(409, 'TPS yang sama dipilih dua kali pada trip penjemputan yang sama.');
        seenInTrip.add(s.bus_stop_id);
      }
    }

    const result = writeDutySlotScheduleRows(slot.id, weekday, pickupTrips, trips);

    logActivity(req, 'duty_schedule.slot_updated', 'duty_slots', slot.id,
                { bus_group: slot.bus_group, duty_number: slot.duty_number, weekday, ...result });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/duty-schedule/order — set/replace the base rotation order.
 * Body: { bus_group: 'besar'|'kecil', order: [bus_id, ...], reference_monday: 'YYYY-MM-DD' }
 *
 * `order[i]` is which bus holds the group's i-th ROTATING duty_number (in
 * ascending duty_number order, skipping any fixed slot — see
 * resolveDutySchedule in lib/cards.js) in the week containing
 * reference_monday — resolveDutySchedule() rotates forward from there. The
 * required length is however many rotating slots the group actually has
 * (besar: 4; kecil: 3 as of Tugas 5 going fixed), not a hardcoded 4.
 * reference_monday is shared across both groups (one rotation calendar), so
 * whichever group is saved second here overwrites it with the same value —
 * harmless as long as both are always set to the same date, which the
 * frontend enforces (one date field for both groups).
 */
router.put('/duty-schedule/order', (req, res, next) => {
  try {
    const group = req.body?.bus_group;
    if (!['besar', 'kecil'].includes(group)) throw fail(400, 'Kelompok bis tidak dikenal.');

    const rotatingCount = db.prepare(`
      SELECT COUNT(*) c FROM duty_slots WHERE bus_group = ? AND fixed_bus_id IS NULL
    `).get(group).c;

    const order = Array.isArray(req.body?.order) ? req.body.order.map(Number) : [];
    if (order.length !== rotatingCount || order.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw fail(400, `Urutan rotasi harus berisi tepat ${rotatingCount} bis.`);
    }
    if (new Set(order).size !== rotatingCount) throw fail(409, 'Setiap bis hanya boleh muncul sekali dalam urutan.');

    const buses = db.prepare(`
      SELECT id, seat_capacity FROM buses WHERE id IN (${order.map(() => '?').join(',')}) AND is_active = 1
    `).all(...order);
    if (buses.length !== rotatingCount) throw fail(400, 'Salah satu bis tidak ditemukan atau tidak aktif.');
    const wantBesar = group === 'besar';
    if (buses.some((b) => (b.seat_capacity >= 45) !== wantBesar)) {
      throw fail(400, `Semua bis pada urutan ${group} harus berkelompok ${group}.`);
    }

    const referenceMonday = normaliseDate(req.body?.reference_monday);
    if (!referenceMonday) throw fail(400, 'Tanggal referensi wajib diisi.');

    setSetting(`duty_order_${group}`, JSON.stringify(order));
    setSetting('duty_reference_monday', referenceMonday);

    logActivity(req, 'duty_schedule.order_updated', 'settings', null, { bus_group: group, order });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/duty-schedule/apply — materialize today's rotation now,
// instead of waiting for server.js's automatic daily check. On a
// non-operating day this still applies (materializeDutySchedule borrows
// Monday's per-weekday template but keeps TODAY'S own week/bus mapping —
// see the comment on that function) rather than jumping ahead to the next
// school day, which would write a bus's data for a different duty_number
// than the one it's still labelled with until the rotation actually turns
// over on Monday.
router.post('/duty-schedule/apply', (req, res, next) => {
  try {
    const applied = materializeDutySchedule(todayWIT());
    logActivity(req, 'duty_schedule.applied', 'duty_slots', null, { count: applied.length });
    res.json({ ok: true, applied });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/stops/:id — adjust one TPS's seat capacity.
 *
 * A TPS filling up (e.g. TPS#17) is the Transport Team's day-to-day signal to
 * either raise its capacity or start steering new applications to a
 * different stop — this is the only thing about a TPS that changes often
 * enough to need an editor; code/name/area are effectively fixed once seeded.
 */
router.put('/stops/:id', (req, res, next) => {
  try {
    const seatCapacity = Number(req.body?.seat_capacity);
    if (!Number.isInteger(seatCapacity) || seatCapacity < 0) {
      throw fail(400, 'Kapasitas kursi tidak valid.');
    }
    const info = db.prepare(`UPDATE bus_stops SET seat_capacity = ? WHERE id = ?`)
      .run(seatCapacity, req.params.id);
    if (!info.changes) throw fail(404, 'TPS tidak ditemukan.');
    logActivity(req, 'stop.capacity_updated', 'bus_stops', Number(req.params.id),
                { seat_capacity: seatCapacity });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/stops/:id/location — set a TPS's map coordinates, so the
 * stop-progress map (see routes/track.js) has something to plot. Optional:
 * either field can be cleared back to null (send an empty string/null) to
 * drop the pin without touching seat_capacity.
 */
router.put('/stops/:id/location', (req, res, next) => {
  try {
    const { latitude, longitude } = req.body || {};
    const lat = latitude === '' || latitude == null ? null : Number(latitude);
    const lng = longitude === '' || longitude == null ? null : Number(longitude);
    if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      throw fail(400, 'Latitude tidak valid.');
    }
    if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      throw fail(400, 'Longitude tidak valid.');
    }
    const info = db.prepare(`UPDATE bus_stops SET latitude = ?, longitude = ? WHERE id = ?`)
      .run(lat, lng, req.params.id);
    if (!info.changes) throw fail(404, 'TPS tidak ditemukan.');
    logActivity(req, 'stop.location_updated', 'bus_stops', Number(req.params.id),
                { latitude: lat, longitude: lng });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/routes — register a new route.
 *
 * Routes are the capacity/eligibility bucket checked when an application is
 * approved (assertCapacity, ReviewDrawer's Rute dropdown) — separate from a
 * bus's own TPS schedule in bus_route_stops. A 27/30-seat unit running
 * several rits a day needs one of these per rit so each leg gets its own
 * seat count rather than sharing a single capacity across all of them.
 */
router.post('/routes', (req, res, next) => {
  try {
    const code = (req.body?.code || '').trim();
    const name = (req.body?.name || '').trim();
    if (!code) throw fail(400, 'Kode rute wajib diisi.');
    if (!name) throw fail(400, 'Nama rute wajib diisi.');

    const seatCapacity = Number(req.body?.seat_capacity);
    if (!Number.isInteger(seatCapacity) || seatCapacity <= 0) {
      throw fail(400, 'Jumlah seat tidak valid.');
    }

    const destination = (req.body?.destination || '').trim() || 'Sekolah YPJ Kuala Kencana';

    const year = db.prepare(`SELECT id FROM academic_years WHERE is_current = 1`).get();
    if (!year) throw fail(500, 'Tahun ajaran aktif tidak ditemukan.');

    const clash = db.prepare(`
      SELECT id FROM routes WHERE academic_year_id = ? AND lower(code) = lower(?)
    `).get(year.id, code);
    if (clash) throw fail(409, `Kode rute ${code} sudah terdaftar.`);

    const info = db.prepare(`
      INSERT INTO routes (academic_year_id, code, name, destination, seat_capacity)
      VALUES (?, ?, ?, ?, ?)
    `).run(year.id, code, name, destination, seatCapacity);

    logActivity(req, 'route.created', 'routes', Number(info.lastInsertRowid), { code, name });
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/routes/:id — adjust one route's seat capacity.
 *
 * Same day-to-day need as stops.capacity_updated above: a route filling up
 * (e.g. SP3-A-SP3 Koridor) is the signal to raise it or steer new approvals
 * to a different rute.
 */
router.put('/routes/:id', (req, res, next) => {
  try {
    const seatCapacity = Number(req.body?.seat_capacity);
    if (!Number.isInteger(seatCapacity) || seatCapacity <= 0) {
      throw fail(400, 'Jumlah seat tidak valid.');
    }
    const info = db.prepare(`UPDATE routes SET seat_capacity = ? WHERE id = ?`)
      .run(seatCapacity, req.params.id);
    if (!info.changes) throw fail(404, 'Rute tidak ditemukan.');
    logActivity(req, 'route.capacity_updated', 'routes', Number(req.params.id),
                { seat_capacity: seatCapacity });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/complaints?status= — "Laporkan Keluhan" submissions. The
// parent's email already went out at submit time; this is so the Transport
// Team can also track and close them out inside the app.
router.get('/complaints', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.subject, c.message, c.status, c.created_at, c.resolved_at,
           u.name AS parent_name, u.email AS parent_email, u.phone_primary,
           s.full_name AS student_name, res.name AS resolved_by_name
    FROM complaints c
    JOIN users u ON u.id = c.parent_id
    LEFT JOIN students s ON s.id = c.student_id
    LEFT JOIN users res ON res.id = c.resolved_by
    WHERE (:status IS NULL OR c.status = :status)
    ORDER BY CASE c.status WHEN 'baru' THEN 0 WHEN 'ditinjau' THEN 1 ELSE 2 END,
             c.created_at DESC
  `).all({ status: req.query.status || null });
  res.json(rows);
});

// PUT /api/admin/complaints/:id/status  { status: 'ditinjau' | 'selesai' | 'baru' }
router.put('/complaints/:id/status', (req, res, next) => {
  const { status } = req.body || {};
  if (!['baru', 'ditinjau', 'selesai'].includes(status)) {
    return next(fail(400, 'Status tidak dikenal.'));
  }
  const resolved = status === 'selesai';
  const info = db.prepare(`
    UPDATE complaints
    SET status = ?,
        resolved_by = ?, resolved_at = ?
    WHERE id = ?
  `).run(status, resolved ? req.user.id : null, resolved ? new Date().toISOString() : null,
         req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Keluhan tidak ditemukan.' });
  logActivity(req, 'complaint.status_changed', 'complaints', Number(req.params.id), { status });
  res.json({ ok: true });
});

// GET /api/admin/scans?result= — includes the offline-verified scans worth review.
router.get('/scans', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, s.full_name AS student_name, b.code AS stop_code,
           u.name AS scanned_by_name
    FROM scan_logs l
    LEFT JOIN bus_id_cards c ON c.id = l.card_id
    LEFT JOIN students s ON s.id = c.student_id
    LEFT JOIN bus_stops b ON b.id = l.bus_stop_id
    LEFT JOIN users u ON u.id = l.scanned_by
    WHERE (:result IS NULL OR l.result = :result)
    ORDER BY l.scanned_at DESC
    LIMIT 300
  `).all({ result: req.query.result || null });
  res.json(rows);
});

// ── Staff accounts ───────────────────────────────────────────────────────────

// Roles creatable from this page. Deliberately excludes 'super_admin' (only
// ever created via the seed-admins.js CLI script — never self-service) and
// 'attendant' (the legacy general "Petugas Bis" role, superseded by the
// Driver/Helper split but left alone for any account already on it).
const STAFF_ROLES = ['transport_admin', 'driver', 'helper', 'school_staff', 'leader', 'admin', 'contractor'];
const STAFF_ROLE_LABELS = {
  transport_admin: 'Tim Transportasi Sekolah',
  driver:          'Driver',
  helper:          'Helper',
  school_staff:    'Guru',
  leader:          'Leader',
  admin:           'Admin Sekolah',
  contractor:      'Kontraktor (Perusahaan Bis)',
  attendant:       'Petugas Bis (lama)',
  super_admin:     'Super Admin',
};

/** 10 characters, unambiguous alphabet — read aloud over the phone without confusion. */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// GET /api/admin/staff — every non-parent account, for the account management page.
router.get('/staff', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, email, role, phone_primary, is_active, created_at
    FROM users
    WHERE role <> 'parent'
    ORDER BY CASE role
      WHEN 'super_admin' THEN 0 WHEN 'transport_admin' THEN 1 WHEN 'leader' THEN 2
      WHEN 'school_staff' THEN 3 WHEN 'driver' THEN 4 WHEN 'helper' THEN 5
      ELSE 6 END, name
  `).all();
  res.json(rows.map((r) => ({ ...r, role_label: STAFF_ROLE_LABELS[r.role] || r.role })));
});

/**
 * POST /api/admin/staff
 * Body: { name, email, role, phone_primary, password? }
 *
 * If no password is given, one is generated and returned once in the response
 * — the admin reads it off to the new hire, same as seed-admins.js printing
 * the starting password to the console.
 */
router.post('/staff', (req, res, next) => {
  const { name, email, role, phone_primary, password } = req.body || {};

  try {
    if (!name?.trim()) throw fail(400, 'Nama wajib diisi.');
    if (!STAFF_ROLES.includes(role)) throw fail(400, 'Peran tidak dikenal.');

    const normalisedEmail = String(email || '').trim().toLowerCase();
    if (!normalisedEmail) throw fail(400, 'Email wajib diisi.');

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalisedEmail);
    if (existing) throw fail(409, 'Email ini sudah terdaftar.');

    const finalPassword = password?.trim() || generatePassword();
    if (finalPassword.length < 6) throw fail(400, 'Password minimal 6 karakter.');

    const info = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, phone_primary)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), normalisedEmail, bcrypt.hashSync(finalPassword, 10), role, phone_primary?.trim() || null);

    logActivity(req, 'staff.created', 'users', Number(info.lastInsertRowid), { role });
    res.status(201).json({
      ok: true,
      id: Number(info.lastInsertRowid),
      // Only echoed back when we generated it — an admin-supplied password is
      // never sent back over the wire.
      generated_password: password?.trim() ? null : finalPassword,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/staff/:id — edit name/email/phone/role, or activate/deactivate.
router.put('/staff/:id', (req, res, next) => {
  const { name, email, phone_primary, role, is_active } = req.body || {};

  try {
    const user = db.prepare(`SELECT * FROM users WHERE id = ? AND role <> 'parent'`).get(req.params.id);
    if (!user) throw fail(404, 'Akun tidak ditemukan.');
    if (user.role === 'super_admin') throw fail(403, 'Akun Super Admin tidak dapat diubah dari sini.');

    if (role !== undefined && !STAFF_ROLES.includes(role)) throw fail(400, 'Peran tidak dikenal.');
    if (name !== undefined && !name?.trim()) throw fail(400, 'Nama wajib diisi.');

    let normalisedEmail;
    if (email !== undefined) {
      normalisedEmail = String(email || '').trim().toLowerCase();
      if (!normalisedEmail) throw fail(400, 'Email wajib diisi.');
      const clash = db.prepare(`SELECT id FROM users WHERE email = ? AND id <> ?`)
        .get(normalisedEmail, user.id);
      if (clash) throw fail(409, 'Email ini sudah terdaftar.');
    }

    const nextPhone = phone_primary !== undefined ? (phone_primary.trim() || null) : user.phone_primary;

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          phone_primary = ?,
          role = COALESCE(?, role),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(name?.trim() || null, normalisedEmail || null, nextPhone, role || null,
           is_active === undefined ? null : (is_active ? 1 : 0), user.id);

    logActivity(req, 'staff.updated', 'users', user.id, { role, is_active });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/staff/:id/reset-password
// Body: { password? } — same generate-if-blank behaviour as creation.
router.post('/staff/:id/reset-password', (req, res, next) => {
  try {
    const user = db.prepare(`SELECT * FROM users WHERE id = ? AND role <> 'parent'`).get(req.params.id);
    if (!user) throw fail(404, 'Akun tidak ditemukan.');
    if (user.role === 'super_admin') throw fail(403, 'Akun Super Admin tidak dapat diubah dari sini.');

    const finalPassword = req.body?.password?.trim() || generatePassword();
    if (finalPassword.length < 6) throw fail(400, 'Password minimal 6 karakter.');

    db.prepare(`
      UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?
    `).run(bcrypt.hashSync(finalPassword, 10), user.id);

    logActivity(req, 'staff.password_reset', 'users', user.id, null);
    res.json({
      ok: true,
      generated_password: req.body?.password?.trim() ? null : finalPassword,
    });
  } catch (err) {
    next(err);
  }
});

// ── Broadcast ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/broadcast
 * Body: { scope: 'bus'|'route'|'all', target_id, subject, message }
 *
 * Delay, route-change and emergency notices for everyone currently riding a
 * given unit or corridor — the ad-hoc counterpart to the automatic per-stop
 * "bus is approaching" notice in lib/notify.js. Only active cards are reached:
 * a suspended or expired card is not riding the bus today. `scope: 'all'` is
 * the exception — general announcements (holiday schedule, policy changes)
 * go to every parent account regardless of card status, since those aren't
 * tied to a specific unit or corridor.
 */
router.post('/broadcast', (req, res, next) => {
  const { scope, target_id, subject, message } = req.body || {};

  try {
    if (!['bus', 'route', 'all'].includes(scope)) throw fail(400, 'Target siaran tidak dikenal.');
    if (scope !== 'all' && !target_id) throw fail(400, 'Bis atau rute tujuan wajib dipilih.');
    if (!subject?.trim()) throw fail(400, 'Judul pesan wajib diisi.');
    if (!message?.trim()) throw fail(400, 'Isi pesan wajib diisi.');

    const recipients = scope === 'all'
      ? db.prepare(`SELECT id, email FROM users WHERE role = 'parent'`).all()
      : scope === 'route'
      ? db.prepare(`
          SELECT DISTINCT u.id, u.email
          FROM bus_id_cards c
          JOIN students s ON s.id = c.student_id
          JOIN users u ON u.id = s.parent_id
          WHERE c.status = 'active' AND c.route_id = ?
        `).all(target_id)
      : db.prepare(`
          SELECT DISTINCT u.id, u.email
          FROM bus_id_cards c
          JOIN students s ON s.id = c.student_id
          JOIN users u ON u.id = s.parent_id
          WHERE c.status = 'active'
            AND c.bus_stop_id IN (SELECT bus_stop_id FROM bus_route_stops WHERE bus_id = ?)
        `).all(target_id);

    if (recipients.length === 0) {
      throw fail(404, 'Tidak ada orang tua dengan kartu aktif pada tujuan ini.');
    }

    for (const r of recipients) {
      notify({
        userId: r.id, email: r.email,
        ...templates.broadcast(subject.trim(), message.trim()),
      });
    }

    // Every other staff role gets the same notice every targeted parent does
    // — in their own 🔔 Pemberitahuan feed, identical to how a parent sees it
    // — regardless of scope: a delay/emergency notice on one bus is still
    // useful for the whole team to know about, not just the parents riding
    // it, and Leader/Admin Sekolah can't send broadcasts at all (view-only)
    // so this is the only way they see them.
    const staff = db.prepare(`
      SELECT id, email FROM users
      WHERE role IN ('transport_admin', 'super_admin', 'leader', 'admin',
                      'driver', 'helper', 'school_staff')
    `).all();
    for (const s of staff) {
      notify({
        userId: s.id, email: s.email,
        ...templates.broadcast(subject.trim(), message.trim()),
      });
    }

    logActivity(req, 'broadcast.sent', scope, Number(target_id),
                { subject: subject.trim(), recipients: recipients.length });
    res.json({ ok: true, recipients: recipients.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/export — flat rows for the Transport Team's spreadsheet.
 * Column headings deliberately match the old Excel export so the team can keep
 * working the way they already do; the front-end turns this into .xlsx.
 */
router.get('/export', (req, res) => {
  const rows = db.prepare(`
    SELECT a.application_no       AS "No Pengajuan",
           a.status               AS "Status",
           a.submitted_at         AS "Waktu Pengajuan",
           u.phone_primary        AS "No HP orang tua",
           u.phone_alternate      AS "No HP Alternatif",
           u.employee_id          AS "Nomor ID",
           u.name                 AS "Name Orang tua",
           u.parent_category      AS "Kategori Orang Tua",
           u.department           AS "Departemen",
           u.home_address         AS "Alamat Rumah",
           u.email                AS "Email",
           s.full_name            AS "Nama Lengkap Anak",
           s.grade                AS "Pilih Kelas",
           rq.code || ' ' || rq.name AS "Titik Penjemputan",
           r.code                 AS "Rute",
           c.card_no              AS "No Kartu",
           c.transit_id           AS "Transit ID",
           c.status               AS "Status Kartu",
           c.valid_until          AS "Berlaku Hingga"
    FROM applications a
    JOIN students s ON s.id = a.student_id
    JOIN users u ON u.id = a.parent_id
    JOIN bus_stops rq ON rq.id = a.requested_stop_id
    LEFT JOIN routes r ON r.id = a.assigned_route_id
    LEFT JOIN bus_id_cards c ON c.application_id = a.id
    ORDER BY a.application_no
  `).all();

  res.json(rows.map((r) => ({
    ...r,
    'Pilih Kelas': gradeLabel(r['Pilih Kelas']),
    'Kategori Orang Tua': parentCategoryLabel(r['Kategori Orang Tua']),
  })));
});

// GET /api/admin/activity
router.get('/activity', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.name AS actor_name
    FROM activity_log l LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.created_at DESC LIMIT 200
  `).all();
  res.json(rows);
});

module.exports = router;

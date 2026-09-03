const express = require('express');
const db      = require('../db');
const { notify } = require('../lib/notify');
const { logActivity, fail, normaliseTime, normaliseDate, resolveDutySchedule, todayWIT } = require('../lib/cards');
const { requireRole } = require('../middleware/auth');
const { saveDataUrl, MAX_ATTACHMENT_BYTES, ATTACHMENT_MIMES } = require('../lib/files');

const router = express.Router();

/**
 * Event bus requests — one-off service for school events (field trips,
 * ceremonies, etc.), separate from the weekly commute rotation.
 *
 * Not mounted under /api/admin: that router blocks every non-GET request
 * from 'leader' (a deliberate read-only rule for the commute/application
 * workflow), but Leader is explicitly allowed to *raise* these requests —
 * only the approval step is Tim Transportasi-only. Role checks live per
 * route here instead of one blanket guard.
 */

// GET /api/event-requests — Tim Transportasi and Leader see every request
// (Leader supervises the same data it can raise); Admin Sekolah (the 'admin'
// role — the one who actually raises these) sees only their own. Driver,
// Helper, Guru ('school_staff' — a *different* role from Admin Sekolah,
// despite the confusing name overlap), and Contractor also see every
// request, read-only (no canRequest/canDecide on the frontend for any of
// them) — they need to know about an upcoming event trip and, once
// approved, which bus was assigned, even though they never raise the
// request themselves.
router.get('/', (req, res) => {
  const seesAll = ['transport_admin', 'leader', 'super_admin', 'driver', 'helper', 'school_staff', 'contractor'].includes(req.user.role);

  // Pending (submitted) requests still float to the top — they need action —
  // but within each status group, the most recently raised request leads,
  // so someone opening the panel sees what just came in first instead of
  // having to scroll past everything already settled.
  const rows = db.prepare(`
    SELECT r.*, u.name AS requested_by_name, u.role AS requested_by_role,
           rev.name AS reviewed_by_name, ed.name AS edited_by_name
    FROM event_bus_requests r
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN users rev ON rev.id = r.reviewed_by
    LEFT JOIN users ed ON ed.id = r.edited_by
    WHERE (:mine IS NULL OR r.requested_by = :mine)
    ORDER BY CASE r.status WHEN 'submitted' THEN 0 ELSE 1 END, r.id DESC
  `).all({ mine: seesAll ? null : req.user.id });

  const busRows = db.prepare(`SELECT id, plate_number, label FROM buses`).all();
  const busById = new Map(busRows.map((b) => [b.id, b]));

  // Nomor tugas per unit for TODAY, so "Unit ditugaskan" can show the same
  // colour-coded badge as the rest of the app instead of a bare plate number.
  const dutyMapping = resolveDutySchedule(todayWIT());
  const dutyByBus = new Map();
  for (const group of ['besar', 'kecil']) {
    for (const { duty_number, bus_id } of dutyMapping[group]) dutyByBus.set(bus_id, duty_number);
  }

  res.json(rows.map((r) => {
    const busIds = JSON.parse(r.assigned_bus_ids || '[]');
    return {
      ...r,
      assigned_buses: busIds.map((id) => busById.get(id)).filter(Boolean)
        .map((b) => ({ ...b, duty_number: dutyByBus.get(b.id) ?? null })),
    };
  }));
});

/**
 * POST /api/event-requests
 * Body: { event_name, event_date, departure_time, return_time, destination,
 *         passenger_count, notes, attachment? }
 * `attachment` is a data URL ("data:application/pdf;base64,..." or an image) —
 * a scanned permission letter or event flyer, PDF or image, entirely optional.
 */
router.post('/', requireRole('admin', 'leader'), (req, res, next) => {
  try {
    const b = req.body || {};
    const eventName = (b.event_name || '').trim();
    const destination = (b.destination || '').trim();
    if (!eventName) throw fail(400, 'Nama acara wajib diisi.');
    if (!destination) throw fail(400, 'Tujuan wajib diisi.');

    const eventDate = normaliseDate(b.event_date);
    if (!eventDate) throw fail(400, 'Tanggal acara wajib diisi.');

    const passengerCount = b.passenger_count === '' || b.passenger_count == null
      ? null : Number(b.passenger_count);
    if (!Number.isInteger(passengerCount) || passengerCount <= 0) {
      throw fail(400, 'Jumlah peserta wajib diisi.');
    }

    const departureTime = normaliseTime(b.departure_time);
    if (!departureTime) throw fail(400, 'Jam berangkat wajib diisi.');

    let attachment = null;
    if (b.attachment) {
      attachment = saveDataUrl(b.attachment, 'documents', 'event', MAX_ATTACHMENT_BYTES, ATTACHMENT_MIMES);
    }

    const info = db.prepare(`
      INSERT INTO event_bus_requests
        (requested_by, event_name, event_date, departure_time, return_time,
         destination, passenger_count, notes, attachment_file, attachment_mime_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, eventName, eventDate,
      departureTime, normaliseTime(b.return_time),
      destination, passengerCount, (b.notes || '').trim() || null,
      attachment?.fileName || null, attachment?.mimeType || null,
    );
    const id = Number(info.lastInsertRowid);

    // Every Transport Team member is notified, same as a parent complaint —
    // this is a new request waiting on their approval, not routine traffic.
    const admins = db.prepare(`
      SELECT id, email FROM users WHERE role IN ('transport_admin', 'super_admin') AND is_active = 1
    `).all();
    for (const admin of admins) {
      notify({
        userId: admin.id, email: admin.email,
        template: 'event_request.submitted',
        title: 'Permintaan bis acara baru',
        body: `${req.user.name} mengajukan permintaan bis untuk "${eventName}" `
            + `pada ${eventDate}, tujuan ${destination}.`,
      });
    }

    logActivity(req, 'event_request.submitted', 'event_bus_requests', id, { event_name: eventName });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/event-requests/:id/decision — Tim Transportasi only.
 * Body: { decision: 'approve'|'reject', reason?, bus_ids? }
 */
router.post('/:id/decision', requireRole('transport_admin'), (req, res, next) => {
  try {
    const request = db.prepare(`SELECT * FROM event_bus_requests WHERE id = ?`).get(req.params.id);
    if (!request) throw fail(404, 'Permintaan tidak ditemukan.');
    if (request.status !== 'submitted') {
      throw fail(409, 'Permintaan ini sudah diputuskan sebelumnya.');
    }

    const decision = req.body?.decision;
    if (!['approve', 'reject'].includes(decision)) throw fail(400, 'Keputusan tidak dikenal.');

    const reason = (req.body?.reason || '').trim();
    if (decision === 'reject' && !reason) {
      throw fail(400, 'Alasan penolakan wajib diisi.');
    }

    // A study tour or grade-wide event can need more than one unit, so this
    // takes a list rather than a single bus_id (kept as an array even for
    // the common one-bus case, rather than adding a second bus_id param).
    // At least one unit is required on approval — a request can't be marked
    // approved without actually committing a bus to it.
    let busIds = [];
    if (decision === 'approve') {
      if (!Array.isArray(req.body?.bus_ids) || !req.body.bus_ids.length) {
        throw fail(400, 'Unit bis ditugaskan wajib dipilih sebelum menyetujui.');
      }
      const placeholders = req.body.bus_ids.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT id FROM buses WHERE is_active = 1 AND id IN (${placeholders})`,
      ).all(...req.body.bus_ids);
      if (found.length !== req.body.bus_ids.length) throw fail(400, 'Salah satu unit bis tidak ditemukan.');
      busIds = found.map((b) => b.id);
    }

    db.prepare(`
      UPDATE event_bus_requests
      SET status = ?, assigned_bus_id = ?, assigned_bus_ids = ?, reviewed_by = ?, reviewed_at = datetime('now'),
          rejection_reason = ?
      WHERE id = ?
    `).run(decision === 'approve' ? 'approved' : 'rejected', busIds[0] || null, JSON.stringify(busIds),
           req.user.id, decision === 'reject' ? reason : null, request.id);

    const requester = db.prepare(`SELECT * FROM users WHERE id = ?`).get(request.requested_by);
    notify({
      userId: requester.id, email: requester.email,
      template: decision === 'approve' ? 'event_request.approved' : 'event_request.rejected',
      title: decision === 'approve' ? 'Permintaan bis acara disetujui' : 'Permintaan bis acara ditolak',
      body: decision === 'approve'
        ? `Permintaan bis untuk "${request.event_name}" pada ${request.event_date} telah DISETUJUI.`
        : `Permintaan bis untuk "${request.event_name}" pada ${request.event_date} belum dapat `
          + `disetujui.\n\nAlasan: ${reason}`,
    });

    logActivity(req, `event_request.${decision}d`, 'event_bus_requests', request.id, { reason });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/event-requests/:id/revise — Tim Transportasi only, on an already
 * *approved* request. Covers the two things a one-shot decision can't fix
 * after the fact: the wrong bus type/unit got assigned, or the request turns
 * out to be a duplicate that was approved before the duplicate was noticed.
 * Body: { action: 'reassign'|'cancel', bus_ids?, note? }
 *  - 'reassign' replaces assigned_bus_ids (same validation as approval).
 *  - 'cancel' moves the request to a terminal 'cancelled' status, distinct
 *    from 'rejected' (which only ever applies to a pending request).
 * `note` is required for 'cancel' (shown to the requester, same as a
 * rejection reason) and optional for 'reassign' (e.g. "unit sebelumnya penuh").
 */
router.post('/:id/revise', requireRole('transport_admin'), (req, res, next) => {
  try {
    const request = db.prepare(`SELECT * FROM event_bus_requests WHERE id = ?`).get(req.params.id);
    if (!request) throw fail(404, 'Permintaan tidak ditemukan.');
    if (request.status !== 'approved') {
      throw fail(409, 'Hanya permintaan yang sudah disetujui yang dapat diubah.');
    }

    const action = req.body?.action;
    if (!['reassign', 'cancel'].includes(action)) throw fail(400, 'Tindakan tidak dikenal.');

    const note = (req.body?.note || '').trim();
    if (action === 'cancel' && !note) throw fail(400, 'Alasan pembatalan wajib diisi.');

    let busIds = JSON.parse(request.assigned_bus_ids || '[]');
    if (action === 'reassign') {
      if (!Array.isArray(req.body?.bus_ids) || !req.body.bus_ids.length) {
        throw fail(400, 'Unit bis ditugaskan wajib dipilih.');
      }
      const placeholders = req.body.bus_ids.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT id FROM buses WHERE is_active = 1 AND id IN (${placeholders})`,
      ).all(...req.body.bus_ids);
      if (found.length !== req.body.bus_ids.length) throw fail(400, 'Salah satu unit bis tidak ditemukan.');
      busIds = found.map((b) => b.id);
    }

    // Cancellation leaves the last-assigned bus(es) on the row untouched —
    // it's still useful context for "what was assigned before this got
    // cancelled" — and only flips status plus the edit trail.
    db.prepare(`
      UPDATE event_bus_requests
      SET status = ?, assigned_bus_id = ?, assigned_bus_ids = ?,
          edited_by = ?, edited_at = datetime('now'), edit_note = ?
      WHERE id = ?
    `).run(
      action === 'cancel' ? 'cancelled' : 'approved',
      action === 'cancel' ? request.assigned_bus_id : busIds[0],
      action === 'cancel' ? request.assigned_bus_ids : JSON.stringify(busIds),
      req.user.id, note || null, request.id,
    );

    // Sopir/Helper need to know their trip changed (reassigned bus or the
    // whole thing cancelled), the requester needs to know their approved
    // request changed under them, and the rest of Tim Transportasi needs to
    // stay in sync since any of them can act on the next request.
    const crew = db.prepare(`
      SELECT id, email FROM users WHERE role IN ('driver', 'helper') AND is_active = 1
    `).all();
    const otherAdmins = db.prepare(`
      SELECT id, email FROM users WHERE role IN ('transport_admin', 'super_admin')
        AND is_active = 1 AND id != ?
    `).all(req.user.id);
    const requester = db.prepare(`SELECT id, email FROM users WHERE id = ?`).get(request.requested_by);

    const title = action === 'cancel' ? 'Permintaan bis acara dibatalkan' : 'Unit bis acara diubah';
    const body = action === 'cancel'
      ? `Permintaan bis untuk "${request.event_name}" pada ${request.event_date} yang sebelumnya `
        + `DISETUJUI telah DIBATALKAN oleh ${req.user.name}.\n\nAlasan: ${note}`
      : `Unit bis untuk "${request.event_name}" pada ${request.event_date} telah diubah oleh ${req.user.name}.`
        + (note ? `\n\nCatatan: ${note}` : '');

    for (const u of [...crew, ...otherAdmins, requester]) {
      notify({
        userId: u.id, email: u.email,
        template: action === 'cancel' ? 'event_request.cancelled' : 'event_request.revised',
        title, body,
      });
    }

    logActivity(req, `event_request.${action}`, 'event_bus_requests', request.id, { note });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

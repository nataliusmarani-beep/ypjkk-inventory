const express = require('express');
const db      = require('../db');
const { verifyPayload, checkEligibility, MESSAGES } = require('../lib/qr');
const { VIOLATION_CATEGORIES, logActivity, fail } = require('../lib/cards');
const { gradeLabel, notify, templates } = require('../lib/notify');
const { tripStopsOrdered, tripState } = require('../lib/trips');

const router = express.Router();

// Mounted behind requireRole('attendant', 'helper', 'transport_admin', 'school_staff').

/**
 * POST /api/scan
 * Body: { payload, bus_id, bus_stop_id, direction }
 *
 * Every scan is logged, including the denied ones — the refusals are the whole
 * point of the audit trail. The response carries the student's name and photo so
 * the attendant can check the face against the card, which is exactly what the
 * old paper process could not support.
 */
router.post('/', (req, res) => {
  const { payload, bus_id, bus_stop_id, direction } = req.body || {};
  if (!payload) return res.status(400).json({ error: 'Kode QR kosong.' });

  const { card, result } = verifyPayload(payload, { busId: bus_id });

  db.prepare(`
    INSERT INTO scan_logs
      (card_id, scanned_by, bus_id, bus_stop_id, direction, result, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    card?.id || null, req.user.id, bus_id || null, bus_stop_id || null,
    direction === 'alighting' ? 'alighting' : 'boarding',
    result, String(payload).slice(0, 300),
  );

  const allowed = result === 'ok' || result === 'ok_offline';

  if (!card) {
    return res.json({ allowed: false, result, message: MESSAGES[result] });
  }

  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(card.student_id);
  const stop = db.prepare(`SELECT code, name FROM bus_stops WHERE id = ?`).get(card.bus_stop_id);

  res.json({
    allowed,
    result,
    message: MESSAGES[result],
    card: {
      id: card.id,
      card_no: card.card_no,
      transit_id: card.transit_id,
      status: card.status,
      status_reason: card.status_reason,
      valid_until: card.valid_until,
      photo_file: card.photo_file,
    },
    student: {
      id: student.id,
      full_name: student.full_name,
      grade: student.grade,
      grade_label: gradeLabel(student.grade),
    },
    stop,
  });
});

/**
 * GET /api/scan/search?q=&bus_id= — find a student by name when they forgot
 * their card, so a Helper/attendant has something to check against besides
 * their own memory. Scoped to the unit's own stops when bus_id is given, the
 * same "does this unit actually serve that TPS" rule POST / and /manual use,
 * so the list only ever shows children who could plausibly be standing there.
 */
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const rows = db.prepare(`
    SELECT c.id AS card_id, c.status AS card_status, c.status_reason, c.photo_file,
           s.id AS student_id, s.full_name, s.grade,
           bs.code AS stop_code, bs.name AS stop_name
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN bus_stops bs ON bs.id = c.bus_stop_id
    WHERE c.status = 'active'
      AND s.full_name LIKE :like
      AND (:bus_id IS NULL OR EXISTS (
        SELECT 1 FROM bus_route_stops brs
        WHERE brs.bus_id = :bus_id AND brs.bus_stop_id = c.bus_stop_id
      ))
    ORDER BY s.full_name
    LIMIT 10
  `).all({ like: `%${q}%`, bus_id: req.query.bus_id || null });

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

/**
 * POST /api/scan/manual — confirm a boarding without a card, by picking the
 * student from /search instead of scanning a QR. Same eligibility rules as a
 * real scan (status + route), logged the same way in scan_logs, marked with
 * a MANUAL: prefix in raw_payload so it's distinguishable from an offline QR
 * scan in the Transport Team's review.
 * Body: { card_id, bus_id, bus_stop_id, direction }
 */
router.post('/manual', (req, res, next) => {
  try {
    const { card_id, bus_id, bus_stop_id, direction } = req.body || {};
    const card = db.prepare(`SELECT * FROM bus_id_cards WHERE id = ?`).get(card_id);
    if (!card) throw fail(404, 'Kartu tidak ditemukan.');

    const denied = checkEligibility(card, { busId: bus_id });
    const result = denied || 'ok_offline';
    const allowed = !denied;

    db.prepare(`
      INSERT INTO scan_logs
        (card_id, scanned_by, bus_id, bus_stop_id, direction, result, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      card.id, req.user.id, bus_id || null, bus_stop_id || null,
      direction === 'alighting' ? 'alighting' : 'boarding',
      result, `MANUAL:${req.user.id}`,
    );

    const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(card.student_id);
    const stop = db.prepare(`SELECT code, name FROM bus_stops WHERE id = ?`).get(card.bus_stop_id);

    res.json({
      allowed,
      result,
      manual: true,
      message: allowed ? 'Izinkan naik (konfirmasi manual — tanpa kartu).' : MESSAGES[result],
      card: {
        id: card.id,
        card_no: card.card_no,
        transit_id: card.transit_id,
        status: card.status,
        status_reason: card.status_reason,
        valid_until: card.valid_until,
        photo_file: card.photo_file,
      },
      student: {
        id: student.id,
        full_name: student.full_name,
        grade: student.grade,
        grade_label: gradeLabel(student.grade),
      },
      stop,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scan/violation — the attendant reports on the spot.
 * Body: { student_id, category, description, severity, bus_id }
 *
 * Attendants report; only the Transport Team can turn a report into a suspension
 * or revocation (see POST /api/admin/cards/:id/sanction).
 */
router.post('/violation', (req, res) => {
  const { student_id, category, description, severity, bus_id } = req.body || {};

  if (!student_id) return res.status(400).json({ error: 'Siswa wajib dipilih.' });
  if (!VIOLATION_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Kategori pelanggaran tidak dikenal.' });
  }

  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(student_id);
  if (!student) return res.status(404).json({ error: 'Siswa tidak ditemukan.' });

  const card = db.prepare(`
    SELECT id FROM bus_id_cards WHERE student_id = ? ORDER BY issued_at DESC LIMIT 1
  `).get(student_id);

  const info = db.prepare(`
    INSERT INTO violations
      (student_id, card_id, category, severity, description, bus_id, reported_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(student_id, card?.id || null, category,
         Math.min(Math.max(Number(severity) || 1, 1), 3),
         description?.trim() || null, bus_id || null, req.user.id);

  logActivity(req, 'violation.reported', 'violations', Number(info.lastInsertRowid),
              { student_id, category });

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

/**
 * GET /api/scan/route?bus_id= — the attendant's run: every TPS this unit covers
 * in order, with the scheduled time and whether it has already been marked
 * departed today.
 */
router.get('/route', (req, res, next) => {
  try {
    const busId = Number(req.query.bus_id);
    if (!busId) throw fail(400, 'Pilih unit bis terlebih dahulu.');
    const direction = req.query.direction === 'dropoff' ? 'dropoff' : 'pickup';

    const bus = db.prepare(`
      SELECT id, plate_number, label, driver_name, helper_name,
             school_arrival_time, school_departure_time
      FROM buses WHERE id = ? AND is_active = 1
    `).get(busId);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    // Both directions can now shuttle back and forth several times — pickup
    // TPS#1 twice in one morning at different times for different units
    // (regular vs PAUD) is exactly why this exists. Each round is its own
    // leg, tracked as a 'started'/'finished' pair of school events. The crew
    // decides when a leg is done (see "Kembali ke Sekolah"/"Selesai Trip"
    // below) rather than the app requiring every configured TPS to be
    // visited first — a stop skipped on this leg simply carries over and
    // stays offered on the next one. Once a stop has actually been marked
    // departed on any earlier leg today, it drops out of the list for good.
    const { trips, tripsTotal, tripInProgress, tripNumber, tripIndex0, currentStart, starts }
      = tripState(busId, direction);
    const timeField = direction === 'pickup' ? 'pickup_time_current' : 'dropoff_time_current';
    const previewTimeField = direction === 'pickup' ? 'pickup_time' : 'dropoff_time';
    const legacyTime = direction === 'pickup' ? bus.school_arrival_time : bus.school_departure_time;
    // Falls back to the bus's legacy school_arrival_time/school_departure_time
    // only for Trip 1 on a unit that hasn't been resaved since
    // bus_pickup_trips/bus_trips were introduced (see the backfill migrations
    // in db.js) — every other case comes straight from the scheduled trip list.
    const tripScheduledTime = trips[tripIndex0]?.scheduled_time ?? (tripIndex0 === 0 ? legacyTime : null);

    // Ordered by the admin's explicit per-trip TPS sequence (see
    // tripStopsOrdered above) rather than always following fixed TPS
    // numbering — a trip's route is whatever order it was built in on the
    // schedule page.
    const stops = tripStopsOrdered(busId, tripIndex0, direction)
      .map((s) => {
        const departures = db.prepare(`
          SELECT created_at FROM trip_events
          WHERE bus_id = ? AND bus_stop_id = ? AND direction = ? AND event = 'departed'
            AND date(created_at, '+9 hours') = date('now', '+9 hours')
          ORDER BY id ASC
        `).all(busId, s.bus_stop_id, direction);
        const servedOnEarlierLeg = currentStart
          ? departures.some((d) => d.created_at < currentStart.created_at)
          : departures.length > 0;
        if (servedOnEarlierLeg) return null;
        const inCurrentLeg = currentStart
          ? [...departures].reverse().find((d) => d.created_at >= currentStart.created_at)
          : null;
        // "Tiba di TPS Terakhir" — see POST /arrival. Only meaningful on the
        // last stop of a dropoff leg in practice, but read for every stop the
        // same way departed_at is, rather than special-casing which index is
        // "last" here too.
        const arrival = db.prepare(`
          SELECT created_at FROM trip_events
          WHERE bus_id = ? AND bus_stop_id = ? AND direction = ? AND event = 'arrived'
            AND date(created_at, '+9 hours') = date('now', '+9 hours')
          ORDER BY id DESC
        `).all(busId, s.bus_stop_id, direction)
          .find((a) => !currentStart || a.created_at >= currentStart.created_at);
        return {
          ...s,
          stop_code: s.code,
          stop_name: s.name,
          [timeField]: s.times[tripIndex0] ?? null,
          departed_at: inCurrentLeg?.created_at || null,
          arrived_at: arrival?.created_at || null,
        };
      })
      .filter(Boolean);

    // A read-only preview of every scheduled trip (not just the one
    // currently running) — so the crew can see the whole plan (e.g. Trip 2's
    // route) while Trip 1 is still in progress, instead of it only appearing
    // once Trip 1 is closed out.
    const allTrips = Array.from({ length: tripsTotal }, (_, i) => ({
      trip_number: i + 1,
      [previewTimeField]: trips[i]?.scheduled_time ?? (i === 0 ? legacyTime : null),
      is_current: i === tripIndex0,
      stops: tripStopsOrdered(busId, i, direction).map((s) => ({
        bus_stop_id: s.bus_stop_id,
        stop_code: s.code,
        stop_name: s.name,
        [previewTimeField]: s.times[i] ?? null,
      })),
    }));

    res.json({
      bus, direction, stops,
      school_event: currentStart ? { event: 'started', created_at: currentStart.created_at } : null,
      trips_total: tripsTotal,
      trip_number: tripNumber,
      trip_scheduled_time: tripScheduledTime,
      trip_in_progress: tripInProgress,
      all_departed_this_leg: stops.every((s) => s.departed_at),
      all_trips_done: !tripInProgress && stops.length === 0 && starts.length > 0,
      all_trips: allTrips,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scan/departure
 * Body: { bus_id, bus_stop_id, direction }
 *
 * The attendant taps this as the bus pulls away from a stop. Parents waiting at
 * the NEXT stop on this unit's run are notified — that is the moment the
 * information is actionable, and it lines up with the five-minute rule in the
 * conduct guidelines.
 *
 * Only the next stop is notified, not every remaining one: a five-stop run
 * would otherwise send a family four notices for a single trip.
 */
router.post('/departure', (req, res, next) => {
  const { bus_id, bus_stop_id } = req.body || {};
  const direction = req.body?.direction === 'dropoff' ? 'dropoff' : 'pickup';

  try {
    const bus = db.prepare(`SELECT * FROM buses WHERE id = ? AND is_active = 1`).get(bus_id);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const from = db.prepare(`
      SELECT brs.sequence, s.id, s.code, s.name, s.sort_order
      FROM bus_route_stops brs JOIN bus_stops s ON s.id = brs.bus_stop_id
      WHERE brs.bus_id = ? AND brs.bus_stop_id = ?
    `).get(bus_id, bus_stop_id);
    if (!from) throw fail(400, 'TPS ini tidak dilayani unit tersebut.');

    db.prepare(`
      INSERT INTO trip_events (bus_id, bus_stop_id, direction, event, recorded_by)
      VALUES (?, ?, ?, 'departed', ?)
    `).run(bus_id, bus_stop_id, direction, req.user.id);

    // Which trip leg is currently running, and how many are scheduled — needed
    // to know which TPS actually belong to this leg (see the same filter in
    // GET /route) rather than treating every stop the bus ever serves as
    // relevant to every trip.
    const { tripIndex0 } = tripState(bus_id, direction);

    // The stop immediately after this one on the same run/leg (see
    // tripStopsOrdered above — dropoff follows the admin's per-trip TPS
    // order, pickup follows its own). A stop already departed today (on this
    // leg or an earlier one) is skipped: it's either already done or the
    // crew is deliberately leaving it for a later leg, neither of which is
    // "next". On a bus with more than one scheduled trip, a stop with no time
    // set for THIS trip isn't part of this leg at all (admin picks TPS per
    // trip on the schedule page) — but on a single-trip bus a blank time just
    // means "not filled in yet", so every assigned stop is still in play
    // (see the same distinction in GET /route).
    const next = (() => {
      const ordered = tripStopsOrdered(bus_id, tripIndex0, direction);
      const fromPos = ordered.findIndex((s) => s.bus_stop_id === from.id);
      if (fromPos === -1) return null;
      const departedToday = new Set(db.prepare(`
        SELECT bus_stop_id FROM trip_events
        WHERE bus_id = ? AND direction = ? AND event = 'departed'
          AND date(created_at, '+9 hours') = date('now', '+9 hours')
      `).all(bus_id, direction).map((r) => r.bus_stop_id));
      for (let i = fromPos + 1; i < ordered.length; i++) {
        if (!departedToday.has(ordered[i].bus_stop_id)) return ordered[i];
      }
      return null;
    })();

    let notified = 0;
    if (next) {
      // next.times is already parsed (see tripStopsOrdered) — the scheduled
      // time at THIS trip's index, not just the first trip's, now that the
      // caller knows which trip is actually running.
      const eta = next.times[tripIndex0] ?? null;
      const waiting = db.prepare(`
        SELECT s.id AS student_id, s.full_name, u.id AS parent_id, u.email
        FROM bus_id_cards c
        JOIN students s ON s.id = c.student_id
        JOIN users u ON u.id = s.parent_id
        WHERE c.bus_stop_id = ? AND c.status = 'active' AND u.is_active = 1
      `).all(next.bus_stop_id);

      for (const w of waiting) {
        // In-app only: a per-stop email on every run would be two messages a
        // day per family, and would burn the mail quota within a week.
        notify({
          userId: w.parent_id,
          ...templates.busApproaching(
            bus, from, { code: next.code, name: next.name },
            { full_name: w.full_name }, eta),
        });
        notified += 1;
      }
    }

    // No auto-finish here on purpose: whether the leg is a single trip (bis
    // besar) or one of several (bis kecil), "departed the last TPS" and
    // "arrived back at school" are different moments — a besar unit still
    // has the drive back ahead of it. The crew closes the leg themselves via
    // POST /trip/return ("Tiba di Sekolah"/"Kembali ke Sekolah"), same as a
    // kecil unit always has, so the timestamp on that event is a real
    // arrival time instead of a copy of this departure's.
    logActivity(req, 'trip.departed', 'buses', Number(bus_id), { stop: from.code, direction, notified });

    res.json({
      ok: true,
      from: { code: from.code, name: from.name },
      next: next ? { code: next.code, name: next.name } : null,
      notified,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scan/arrival
 * Body: { bus_id, bus_stop_id, direction }
 *
 * "Tiba di TPS Terakhir" — the crew taps this on reaching (not leaving) the
 * last stop of a dropoff leg, so parents/Guru get an honest arrival time
 * instead of the app guessing from "nothing left undeparted". Separate from
 * 'departed': the crew still taps Berangkat afterward as usual to close the
 * stop out and eventually the leg. Not restricted to the last stop
 * server-side — the button is what scopes it in practice — so this stays
 * useful even if the crew taps it a stop early or the route changes shape.
 */
router.post('/arrival', (req, res, next) => {
  const { bus_id, bus_stop_id } = req.body || {};
  const direction = req.body?.direction === 'pickup' ? 'pickup' : 'dropoff';

  try {
    const bus = db.prepare(`SELECT id FROM buses WHERE id = ? AND is_active = 1`).get(bus_id);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const stop = db.prepare(`
      SELECT s.code, s.name FROM bus_route_stops brs JOIN bus_stops s ON s.id = brs.bus_stop_id
      WHERE brs.bus_id = ? AND brs.bus_stop_id = ?
    `).get(bus_id, bus_stop_id);
    if (!stop) throw fail(400, 'TPS ini tidak dilayani unit tersebut.');

    db.prepare(`
      INSERT INTO trip_events (bus_id, bus_stop_id, direction, event, recorded_by)
      VALUES (?, ?, ?, 'arrived', ?)
    `).run(bus_id, bus_stop_id, direction, req.user.id);

    logActivity(req, 'trip.arrived', 'buses', Number(bus_id), { stop: stop.code, direction });
    res.json({ ok: true, stop: { code: stop.code, name: stop.name } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scan/trip/start
 * Body: { bus_id, direction }
 *
 * "Start Pengantaran"/"Mulai Trip" — a leg leaving school (dropoff) or the
 * crew about to head out for a pickup round. School isn't a TPS row (see GET
 * /route), so this is its own event rather than a /departure call with a
 * fake bus_stop_id. Notifies parents at the first stop on this leg.
 *
 * A unit can run this more than once a day, in either direction — the crew
 * decides when to close a leg (POST /trip/return) rather than the app
 * requiring every TPS to be visited first, so the only thing that blocks
 * starting another leg is having nothing left to serve.
 */
router.post('/trip/start', (req, res, next) => {
  const { bus_id } = req.body || {};
  const direction = req.body?.direction === 'pickup' ? 'pickup' : 'dropoff';

  try {
    const bus = db.prepare(`SELECT * FROM buses WHERE id = ? AND is_active = 1`).get(bus_id);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const events = db.prepare(`
      SELECT event FROM trip_events
      WHERE bus_id = ? AND bus_stop_id IS NULL AND direction = ?
        AND date(created_at, '+9 hours') = date('now', '+9 hours')
    `).all(bus_id, direction);
    const startCount = events.filter((e) => e.event === 'started').length;
    const finishCount = events.filter((e) => e.event === 'finished').length;
    if (startCount > finishCount) {
      throw fail(409, direction === 'pickup'
        ? 'Trip penjemputan sebelumnya belum ditandai "Selesai Trip".'
        : 'Trip pengantaran sebelumnya belum ditandai "Kembali ke Sekolah".');
    }
    const tripIndex0 = startCount;

    // First stop on this trip's route, in the admin's chosen order (see
    // tripStopsOrdered) — not necessarily every configured TPS, since
    // earlier legs today may have already served some.
    const departedToday = new Set(db.prepare(`
      SELECT bus_stop_id FROM trip_events
      WHERE bus_id = ? AND direction = ? AND event = 'departed'
        AND date(created_at, '+9 hours') = date('now', '+9 hours')
    `).all(bus_id, direction).map((r) => r.bus_stop_id));
    const first = tripStopsOrdered(bus_id, tripIndex0, direction)
      .find((s) => !departedToday.has(s.bus_stop_id));
    if (!first) {
      throw fail(409, direction === 'pickup'
        ? 'Semua TPS sudah selesai dijemput hari ini.'
        : 'Semua TPS sudah selesai diantar hari ini.');
    }

    db.prepare(`
      INSERT INTO trip_events (bus_id, bus_stop_id, direction, event, recorded_by)
      VALUES (?, NULL, ?, 'started', ?)
    `).run(bus_id, direction, req.user.id);

    let notified = 0;
    if (first) {
      const eta = first.times[tripIndex0] ?? null;
      const waiting = db.prepare(`
        SELECT s.id AS student_id, s.full_name, u.id AS parent_id, u.email
        FROM bus_id_cards c
        JOIN students s ON s.id = c.student_id
        JOIN users u ON u.id = s.parent_id
        WHERE c.bus_stop_id = ? AND c.status = 'active' AND u.is_active = 1
      `).all(first.bus_stop_id);

      for (const w of waiting) {
        notify({
          userId: w.parent_id,
          ...templates.busApproaching(
            bus, { code: 'SEKOLAH', name: 'Sekolah' }, { code: first.code, name: first.name },
            { full_name: w.full_name }, eta),
        });
        notified += 1;
      }
    }

    logActivity(req, 'trip.started', 'buses', Number(bus_id),
                { direction, trip_number: tripIndex0 + 1, notified });
    res.json({ ok: true, next: first ? { code: first.code, name: first.name } : null, notified });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/scan/trip/return
 * Body: { bus_id, direction }
 *
 * "Kembali ke Sekolah"/"Selesai Trip" — the crew's own call that this leg is
 * done, whether or not every TPS on it got visited. Anything still
 * un-departed just stays offered on the next leg (see GET /route) rather
 * than blocking the return. No one to notify; it's the record GET /route
 * uses to know the next "Start"/"Mulai Trip" is a new leg rather than a
 * duplicate of this one, and (combined with there being nothing left to
 * serve) is also what makes all_trips_done true — there's no separate
 * "whole day finished" marker beyond that derived state.
 */
router.post('/trip/return', (req, res, next) => {
  const { bus_id } = req.body || {};
  const direction = req.body?.direction === 'pickup' ? 'pickup' : 'dropoff';

  try {
    const bus = db.prepare(`SELECT id FROM buses WHERE id = ? AND is_active = 1`).get(bus_id);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const events = db.prepare(`
      SELECT event FROM trip_events
      WHERE bus_id = ? AND bus_stop_id IS NULL AND direction = ?
        AND date(created_at, '+9 hours') = date('now', '+9 hours')
    `).all(bus_id, direction);
    const startCount = events.filter((e) => e.event === 'started').length;
    const finishCount = events.filter((e) => e.event === 'finished').length;
    if (startCount <= finishCount) {
      throw fail(409, direction === 'pickup'
        ? 'Tidak ada trip penjemputan yang sedang berjalan.'
        : 'Tidak ada trip pengantaran yang sedang berjalan.');
    }

    db.prepare(`
      INSERT INTO trip_events (bus_id, bus_stop_id, direction, event, recorded_by)
      VALUES (?, NULL, ?, 'finished', ?)
    `).run(bus_id, direction, req.user.id);

    logActivity(req, 'trip.returned', 'buses', Number(bus_id), { direction, trip_number: startCount });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/scan/manifest?route_id= — the attendant's list for this run. */
router.get('/manifest', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id AS card_id, c.transit_id, s.id AS student_id, s.full_name, s.grade,
           b.code AS stop_code, b.name AS stop_name, b.sort_order
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN bus_stops b ON b.id = c.bus_stop_id
    WHERE c.status = 'active' AND (:route_id IS NULL OR c.route_id = :route_id)
    ORDER BY b.sort_order, s.full_name
  `).all({ route_id: req.query.route_id || null });

  res.json(rows.map((r) => ({ ...r, grade_label: gradeLabel(r.grade) })));
});

module.exports = router;

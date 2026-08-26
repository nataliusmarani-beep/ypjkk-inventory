const crypto = require('crypto');
const db     = require('../db');

// ── Business rules that must hold no matter which route calls them ──────────

/** Grade values allowed by the form (Q8) — YPJ Kuala Kencana runs Toddler through Kelas 9. */
const GRADES = [
  'toddler', 'playgroup', 'tk_a', 'tk_b',
  ...Array.from({ length: 9 }, (_, i) => `kelas_${i + 1}`),
];

/**
 * Parent/guardian eligibility category — replaces the old free-text
 * "Perusahaan/Instansi" field. The 2024/25 form let parents type an employer
 * name and the export ended up with 87 distinct spellings of ~6 real employers;
 * this fixed list is the HR-defined eligibility category itself, closed by
 * design, so there is nothing left to normalise.
 */
const PARENT_CATEGORIES = [
  { key: 'ptfi',             label: 'PT Freeport Indonesia' },
  { key: 'ptfi_privatisasi', label: 'PTFI Privatisasi' },
  { key: 'ptfi_contractor',  label: 'PTFI Contractor' },
  { key: 'other',            label: 'Other (Bukan TNI/Polri & Government Official)' },
];
const PARENT_CATEGORY_KEYS = PARENT_CATEGORIES.map((c) => c.key);
const parentCategoryLabel = (key) =>
  PARENT_CATEGORIES.find((c) => c.key === key)?.label || key || '—';

/** The ten dangerous behaviours from section II of the rules document. */
const VIOLATION_CATEGORIES = [
  'standing_or_walking_while_moving',
  'shouting_or_disturbance',
  'pushing_or_fighting',
  'throwing_objects',
  'bullying_or_abusive_language',
  'eating_or_drinking_onboard',
  'distracting_the_driver',
  'disobeying_attendant_instructions',
  'vandalising_bus_facilities',
  'boarding_without_valid_card',
  'other',
];

function currentAcademicYear() {
  const year = db.prepare(`SELECT * FROM academic_years WHERE is_current = 1`).get();
  if (!year) throw fail(500, 'Tahun ajaran aktif belum diatur.');
  return year;
}

/** 'YPJ-BUS-2526-00001' — per-year running number. */
function nextApplicationNo(year) {
  // MAX, not COUNT: a deleted row (a duplicate cleaned up by hand, say) makes
  // COUNT(*) fall behind the highest number actually assigned, so COUNT+1
  // collides with a still-existing row and every submission from then on
  // fails its UNIQUE constraint. MAX+1 always continues past whatever was
  // really used, deletions or not.
  const row = db.prepare(`
    SELECT MAX(CAST(substr(application_no, -5) AS INTEGER)) AS maxN FROM applications
    WHERE academic_year_id = ? AND application_no IS NOT NULL
  `).get(year.id);
  return `YPJ-BUS-${year.short_code}-${String((row.maxN || 0) + 1).padStart(5, '0')}`;
}

// Base32 without vowels: a transit id can never spell a word and cannot be
// misheard when read out over the bus radio.
const ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXZ';
function generateTransitId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let id = '';
    for (let i = 0; i < 8; i++) {
      id += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    const taken = db.prepare(`SELECT 1 FROM bus_id_cards WHERE transit_id = ?`).get(id);
    if (!taken) return id;
  }
  throw fail(500, 'Gagal membuat Transit ID unik. Coba lagi.');
}

/**
 * Module 1's hard rule: "Form cannot be submitted without an e-signature and
 * photo upload." Checked here so both the parent submit route and the admin
 * approve route go through the same gate.
 */
function assertSubmittable(applicationId) {
  const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(applicationId);
  if (!app) throw fail(404, 'Pengajuan tidak ditemukan.');

  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);
  const photo = db.prepare(`
    SELECT 1 FROM application_documents
    WHERE application_id = ? AND doc_type = 'student_photo'
  `).get(applicationId);

  if (!photo && !student?.photo_file) {
    throw fail(400, 'Foto siswa wajib diunggah sebelum pengajuan dikirim.');
  }

  const consent = db.prepare(`SELECT * FROM consents WHERE application_id = ?`).get(applicationId);
  if (!consent) throw fail(400, 'Persetujuan peraturan dan tanda tangan wajib diisi.');
  if (!consent.signature_file) throw fail(400, 'Tanda tangan elektronik wajib diisi.');
  if (!consent.acknowledged_revocation) {
    throw fail(400, 'Orang tua wajib menyetujui pencabutan hak pengguna bis apabila terjadi pelanggaran.');
  }
  return app;
}

/** Live load per stop — the number the old form never showed anyone. */
function stopLoad() {
  return db.prepare(`
    SELECT s.id, s.code, s.name, s.area, s.seat_capacity, s.is_active,
           s.latitude, s.longitude,
           (SELECT COUNT(*) FROM bus_id_cards c
             WHERE c.bus_stop_id = s.id AND c.status = 'active')        AS issued_active,
           (SELECT COUNT(*) FROM applications a
             WHERE a.requested_stop_id = s.id
               AND a.status IN ('submitted','under_review'))            AS pending_requests
    FROM bus_stops s
    ORDER BY s.sort_order
  `).all();
}

function routeLoad() {
  return db.prepare(`
    SELECT r.id, r.code, r.name, r.destination, r.seat_capacity,
           (SELECT COUNT(*) FROM bus_id_cards c
             WHERE c.route_id = r.id AND c.status = 'active') AS issued_active
    FROM routes r
    JOIN academic_years y ON y.id = r.academic_year_id AND y.is_current = 1
    WHERE r.is_active = 1
    ORDER BY r.code
  `).all();
}

/**
 * Published bus service schedule, grouped by BUS.
 *
 * Each of the units has its own stop list because the Transport Team runs a
 * weekly rolling roster — the same bus covers different TPS from week to week.
 * That is why this reads bus_route_stops rather than route_stops: a route says
 * which corridor a student belongs to (stable), this says which stops a given
 * unit is covering right now (rotates).
 *
 * Shared by the parent-facing read endpoint and the admin editor so both always
 * agree on shape and ordering.
 */
function scheduleByBus() {
  const buses = db.prepare(`
    SELECT b.id AS bus_id, b.plate_number, b.label, b.seat_capacity, b.driver_name, b.helper_name,
           b.school_arrival_time, b.school_departure_time,
           r.code AS route_code, r.name AS route_name
    FROM buses b
    LEFT JOIN routes r ON r.id = b.route_id
    WHERE b.is_active = 1
    ORDER BY b.plate_number
  `).all();

  const stops = db.prepare(`
    SELECT brs.id AS bus_route_stop_id, brs.bus_id, brs.sequence,
           brs.pickup_times, brs.pickup_sequences, brs.dropoff_times, brs.dropoff_sequences,
           s.id AS bus_stop_id, s.code AS stop_code, s.name AS stop_name, s.area, s.sort_order
    FROM bus_route_stops brs
    JOIN bus_stops s ON s.id = brs.bus_stop_id
    WHERE s.is_active = 1
    ORDER BY brs.sequence, s.sort_order
  `).all();

  const stopsForBus = new Map();
  for (const s of stops) {
    if (!stopsForBus.has(s.bus_id)) stopsForBus.set(s.bus_id, []);
    stopsForBus.get(s.bus_id).push({
      ...s,
      pickup_times: JSON.parse(s.pickup_times || '[]'),
      pickup_sequences: JSON.parse(s.pickup_sequences || '[]'),
      dropoff_times: JSON.parse(s.dropoff_times || '[]'),
      dropoff_sequences: JSON.parse(s.dropoff_sequences || '[]'),
    });
  }

  // The explicit dropoff trip list (see bus_trips in db.js) — trip_number 1..N,
  // each with its own departure_time. A stop's dropoff_times[i]/dropoff_sequences[i]
  // line up with trip_number i+1.
  const trips = db.prepare(`
    SELECT bus_id, trip_number, departure_time, label FROM bus_trips ORDER BY bus_id, trip_number
  `).all();
  const tripsForBus = new Map();
  for (const t of trips) {
    if (!tripsForBus.has(t.bus_id)) tripsForBus.set(t.bus_id, []);
    tripsForBus.get(t.bus_id).push({ trip_number: t.trip_number, departure_time: t.departure_time, label: t.label });
  }

  // Same idea for pickup legs (see bus_pickup_trips in db.js) — a stop's
  // pickup_times[i]/pickup_sequences[i] line up with trip_number i+1 here.
  const pickupTrips = db.prepare(`
    SELECT bus_id, trip_number, arrival_time, label FROM bus_pickup_trips ORDER BY bus_id, trip_number
  `).all();
  const pickupTripsForBus = new Map();
  for (const t of pickupTrips) {
    if (!pickupTripsForBus.has(t.bus_id)) pickupTripsForBus.set(t.bus_id, []);
    pickupTripsForBus.get(t.bus_id).push({ trip_number: t.trip_number, arrival_time: t.arrival_time, label: t.label });
  }

  return buses.map((b) => {
    const busStops = stopsForBus.get(b.bus_id) || [];
    const trips = (tripsForBus.get(b.bus_id) || [{ trip_number: 1, departure_time: b.school_departure_time }])
      .map((t) => {
        const idx = t.trip_number - 1;
        // Derived, ordered view for the schedule editor's per-trip TPS list —
        // a stop with no explicit sequence for this trip falls back to
        // descending TPS numbering (see the dropoff_sequences migration in
        // db.js), same as the scanner uses at runtime.
        const tripStops = busStops
          .filter((s) => s.dropoff_times[idx])
          .map((s) => ({
            bus_stop_id: s.bus_stop_id, code: s.stop_code, name: s.stop_name,
            dropoff_time: s.dropoff_times[idx],
            sequence: s.dropoff_sequences[idx] ?? null,
            sort_order: s.sort_order,
          }))
          .sort((a, c) => (a.sequence ?? (100000 - a.sort_order)) - (c.sequence ?? (100000 - c.sort_order)));
        return { ...t, stops: tripStops };
      });
    const busPickupTrips = (pickupTripsForBus.get(b.bus_id) || [{ trip_number: 1, arrival_time: b.school_arrival_time }])
      .map((t) => {
        const idx = t.trip_number - 1;
        const tripStops = busStops
          .filter((s) => s.pickup_times[idx])
          .map((s) => ({
            bus_stop_id: s.bus_stop_id, code: s.stop_code, name: s.stop_name,
            pickup_time: s.pickup_times[idx],
            sequence: s.pickup_sequences[idx] ?? null,
            sort_order: s.sort_order,
          }))
          .sort((a, c) => (a.sequence ?? (100000 - a.sort_order)) - (c.sequence ?? (100000 - c.sort_order)));
        return { ...t, stops: tripStops };
      });
    return { ...b, trips, pickup_trips: busPickupTrips, stops: busStops };
  });
}

/** Reads a settings row, or null. */
function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** 'YYYY-MM-DD' or null. Anything else is rejected rather than stored. */
function normaliseDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(new Date(trimmed).getTime())) {
    throw fail(400, `Format tanggal "${trimmed}" tidak valid. Gunakan format YYYY-MM-DD.`);
  }
  return trimmed;
}

/** 'YYYY-MM-DD' → '27 Juli 2026', for display to parents and staff. */
function formatDateID(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return `${d} ${ID_MONTHS[m - 1]} ${y}`;
}

/** Builds the "27 Juli 2026 – 31 Juli 2026" label shown as the rotation period. */
function formatPeriodLabel(startDate, endDate) {
  if (!startDate && !endDate) return null;
  if (startDate && endDate) return `${formatDateID(startDate)} – ${formatDateID(endDate)}`;
  return formatDateID(startDate || endDate);
}

/** 'HH:MM' (24-hour) or null. Anything else is rejected rather than stored. */
function normaliseTime(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const trimmed = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw fail(400, `Format waktu "${trimmed}" tidak valid. Gunakan format HH:MM.`);
  }
  return trimmed;
}

/** Blocks approving into a stop or route that is already full. */
function assertCapacity(routeId, stopId) {
  const stop = stopLoad().find((s) => s.id === Number(stopId));
  if (!stop) throw fail(400, 'Titik penjemputan tidak ditemukan.');
  if (stop.seat_capacity > 0 && stop.issued_active >= stop.seat_capacity) {
    throw fail(409, `${stop.code} ${stop.name} sudah penuh: `
      + `${stop.issued_active}/${stop.seat_capacity} kursi terpakai.`);
  }

  const route = routeLoad().find((r) => r.id === Number(routeId));
  if (!route) throw fail(400, 'Rute tidak ditemukan.');
  if (route.seat_capacity > 0 && route.issued_active >= route.seat_capacity) {
    throw fail(409, `Rute ${route.code} sudah penuh: `
      + `${route.issued_active}/${route.seat_capacity} kursi terpakai.`);
  }
}

/**
 * Module 3's trigger: approval issues the card. Called inside the approve
 * transaction so an application can never sit in 'approved' without a card.
 */
function issueCard(app) {
  const year = db.prepare(`SELECT * FROM academic_years WHERE id = ?`).get(app.academic_year_id);
  const photo = db.prepare(`
    SELECT file_name FROM application_documents
    WHERE application_id = ? AND doc_type = 'student_photo'
  `).get(app.id);
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(app.student_id);

  const existing = db.prepare(`SELECT * FROM bus_id_cards WHERE application_id = ?`).get(app.id);
  if (existing) {
    // Re-approval after a suspension or a route change: reuse the card number so
    // the family does not have to re-download anything.
    db.prepare(`
      UPDATE bus_id_cards
      SET status = 'active', status_reason = NULL, status_changed_at = datetime('now'),
          route_id = ?, bus_stop_id = ?, photo_file = ?, valid_until = ?
      WHERE id = ?
    `).run(app.assigned_route_id, app.assigned_stop_id,
           photo?.file_name || student?.photo_file || null, year.ends_on, existing.id);
    return db.prepare(`SELECT * FROM bus_id_cards WHERE id = ?`).get(existing.id);
  }

  db.prepare(`
    INSERT INTO bus_id_cards
      (card_no, transit_id, application_id, student_id, academic_year_id,
       route_id, bus_stop_id, photo_file, status, valid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    app.application_no, generateTransitId(), app.id, app.student_id, app.academic_year_id,
    app.assigned_route_id, app.assigned_stop_id,
    photo?.file_name || student?.photo_file || null, year.ends_on,
  );

  return db.prepare(`SELECT * FROM bus_id_cards WHERE application_id = ?`).get(app.id);
}

/** Nightly: expire finished cards, lift suspensions whose end date has passed. */
function reconcileCardStatuses() {
  const expired = db.prepare(`
    UPDATE bus_id_cards
    SET status = 'expired', status_changed_at = datetime('now')
    WHERE status IN ('active','suspended') AND valid_until < date('now')
  `).run();

  const lifted = db.prepare(`
    UPDATE bus_id_cards
    SET status = 'active', status_reason = NULL, status_changed_at = datetime('now')
    WHERE status = 'suspended'
      AND valid_until >= date('now')
      AND NOT EXISTS (
        SELECT 1 FROM sanctions s
        WHERE s.student_id = bus_id_cards.student_id
          AND (s.action = 'revocation'
               OR (s.action = 'suspension'
                   AND s.starts_on <= date('now')
                   AND (s.ends_on IS NULL OR s.ends_on >= date('now'))))
      )
  `).run();

  return { expired: expired.changes, lifted: lifted.changes };
}

function logActivity(req, action, entity, entityId, detail) {
  try {
    db.prepare(`
      INSERT INTO activity_log (actor_id, action, entity, entity_id, detail, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user?.id || null, action, entity, entityId || null,
           detail ? JSON.stringify(detail) : null, req.ip || null);
  } catch (e) {
    console.error('[activity] Could not write log:', e.message);
  }
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── Nomor tugas: duty-slot rotation ─────────────────────────────────────────
//
// The published schedule (bus_route_stops/bus_trips) stays keyed to a
// physical bus_id — routes/scan.js, routes/meta.js and the parent-facing
// SchedulePage all read it exactly as before. What's new is a layer on top:
// 8 fixed "duty slots" (besar×1-4, kecil×1-4, see db.js) each carry a
// standing route; which physical bus currently fills a slot rotates weekly.
// materializeDutySchedule() resolves that rotation for a given week and
// writes the result into bus_route_stops/bus_trips via the same row shape
// the manual per-bus editor uses — see writeBusScheduleRows below.

/** 'YYYY-MM-DD' for "today" in WIT (UTC+9), independent of the server's own
 *  clock/timezone — same approach as frontend/src/api.js's todayWIT(). */
function todayWIT() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Monday ('YYYY-MM-DD') of the week containing the given 'YYYY-MM-DD' date. */
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12)); // noon sidesteps any DST-style edge case
  const daysSinceMonday = (noon.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  noon.setUTCDate(noon.getUTCDate() - daysSinceMonday);
  const pad = (n) => String(n).padStart(2, '0');
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`;
}

/** Sunday ('YYYY-MM-DD') of the week containing the given 'YYYY-MM-DD' date
 *  — the "Periode Rotasi Aktif" label on the schedule page starts here
 *  rather than Monday, so Driver/Helper see the coming week's info a day
 *  earlier and can prepare. This is a DISPLAY-only anchor: the duty
 *  rotation's own week boundary (which physical bus holds which duty
 *  number) is unaffected and still turns over on Monday — see mondayOf and
 *  duty_reference_monday above. */
function sundayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  noon.setUTCDate(noon.getUTCDate() - noon.getUTCDay()); // getUTCDay(): Sun=0
  const pad = (n) => String(n).padStart(2, '0');
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`;
}

/** 'YYYY-MM-DD' n days after the given 'YYYY-MM-DD' date (n may be negative). */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  noon.setUTCDate(noon.getUTCDate() + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`;
}

/** ISO weekday (1=Senin .. 5=Jumat) for a 'YYYY-MM-DD' date, or null for a
 *  weekend (6=Sabtu, 7=Minggu) — duty slots only have a Mon-Fri schedule. */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
  const iso = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  return iso <= 5 ? iso : null;
}

/**
 * Which bus_id holds each duty_number, per group, for the week containing
 * dateStr. Two kinds of slot, per duty_slots.fixed_bus_id:
 *
 * - Fixed (fixed_bus_id set): always that one bus, every week — for a unit
 *   whose route stands on its own rather than swapping identities with a
 *   pool (e.g. kecil Tugas 5).
 * - Rotating (fixed_bus_id NULL): cyclic shift among duty_order_{group}, the
 *   same rotation the Transport Team runs by hand — clockwise: whoever held
 *   rotating position 1 moves to 2, 2 to 3, ..., and the last wraps around
 *   back to 1, week over week. The pool size is however many rotating slots the
 *   group actually has (used to always be 4; kecil is 3 as of Tugas 5) —
 *   duty_order_{group} must have exactly that many entries or it's treated
 *   as not configured.
 *
 * The rotation itself still turns over Monday (buses only actually run
 * Mon-Fri — see weekdayOf/materializeDutySchedule) but WHICH week a given
 * dateStr resolves to flips a day early, on Minggu, not at Monday 00:00 —
 * dateStr is nudged forward a day before finding its Monday, so Minggu
 * already resolves to the UPCOMING week rather than the one that just
 * finished. This is deliberate: Driver/Helper checking the schedule on
 * Minggu (the day before they work) need to see Monday's real assignment,
 * not Friday's stale one, to avoid being misinformed about which route
 * they're on. Tuesday-Saturday are unaffected (nudging them forward a day
 * never crosses a Monday boundary).
 */
function resolveDutySchedule(dateStr) {
  const monday = mondayOf(addDays(dateStr || todayWIT(), 1));
  const referenceMonday = getSetting('duty_reference_monday');
  const result = { besar: [], kecil: [] };

  const weeksElapsed = referenceMonday ? Math.round(
    (Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${referenceMonday}T00:00:00Z`))
    / (7 * 24 * 60 * 60 * 1000),
  ) : null;

  const allSlots = db.prepare(`
    SELECT bus_group, duty_number, fixed_bus_id FROM duty_slots ORDER BY bus_group, duty_number
  `).all();

  for (const group of ['besar', 'kecil']) {
    const groupSlots = allSlots.filter((s) => s.bus_group === group);

    for (const s of groupSlots.filter((s) => s.fixed_bus_id != null)) {
      result[group].push({ duty_number: s.duty_number, bus_id: s.fixed_bus_id });
    }

    const rotatingSlots = groupSlots.filter((s) => s.fixed_bus_id == null);
    if (weeksElapsed == null || !rotatingSlots.length) continue;

    const raw = getSetting(`duty_order_${group}`);
    if (!raw) continue;
    let order;
    try { order = JSON.parse(raw); } catch { continue; }
    if (!Array.isArray(order) || order.length !== rotatingSlots.length) continue;

    const size = order.length;
    rotatingSlots.forEach((s, i) => {
      // Clockwise: the bus at position i in the reference week moves to
      // position i+1 next week, ..., wrapping last back to first — so at
      // duty_number i+1 (this slot), we want whichever position is
      // weeksElapsed BEHIND i (i.e. i - weeksElapsed), not ahead of it.
      const idx = (((i - weeksElapsed) % size) + size) % size; // safe modulo, weeksElapsed can be negative
      result[group].push({ duty_number: s.duty_number, bus_id: order[idx] });
    });
  }
  return result;
}

/**
 * Shared shape-computation for both writeBusScheduleRows and
 * writeDutySlotScheduleRows below: turns a pickup-trip list + a dropoff-trip
 * list into one row per TPS touched at all (union of every pickup trip's and
 * every dropoff trip's stops), each carrying a pickup_times/pickup_sequences
 * pair parallel to the pickup-trip list and a dropoff_times/dropoff_sequences
 * pair parallel to the dropoff-trip list (index i = Trip i+1 on that side).
 * Also guarantees at least one trip always exists on each side, even empty —
 * scan.js counts trip rows to know how many pickup/dropoff legs a unit runs
 * today.
 *
 * pickupTrips:  [{ arrival_time,   stops: [{ bus_stop_id, pickup_time }] }]
 * dropoffTrips: [{ departure_time, stops: [{ bus_stop_id, dropoff_time }] }]
 */
function computeScheduleRows(pickupTrips, dropoffTrips) {
  const pickupTripsFinal = pickupTrips.length ? pickupTrips : [{ arrival_time: null, stops: [] }];
  const dropoffTripsFinal = dropoffTrips.length ? dropoffTrips : [{ departure_time: null, stops: [] }];

  const orderedStopIds = [];
  const stopIdSet = new Set();
  pickupTripsFinal.forEach((t) => t.stops.forEach((s) => {
    if (!stopIdSet.has(s.bus_stop_id)) { stopIdSet.add(s.bus_stop_id); orderedStopIds.push(s.bus_stop_id); }
  }));
  dropoffTripsFinal.forEach((t) => t.stops.forEach((s) => {
    if (!stopIdSet.has(s.bus_stop_id)) { stopIdSet.add(s.bus_stop_id); orderedStopIds.push(s.bus_stop_id); }
  }));

  const cleaned = orderedStopIds.map((stopId) => {
    const pickupTimes = [];
    const pickupSequences = [];
    pickupTripsFinal.forEach((t) => {
      const idx = t.stops.findIndex((s) => s.bus_stop_id === stopId);
      if (idx === -1) { pickupTimes.push(null); pickupSequences.push(null); }
      else { pickupTimes.push(t.stops[idx].pickup_time); pickupSequences.push(idx + 1); }
    });
    const dropoffTimes = [];
    const dropoffSequences = [];
    dropoffTripsFinal.forEach((t) => {
      const idx = t.stops.findIndex((s) => s.bus_stop_id === stopId);
      if (idx === -1) { dropoffTimes.push(null); dropoffSequences.push(null); }
      else { dropoffTimes.push(t.stops[idx].dropoff_time); dropoffSequences.push(idx + 1); }
    });
    return {
      bus_stop_id: stopId,
      pickup_times: pickupTimes,
      pickup_sequences: pickupSequences,
      dropoff_times: dropoffTimes,
      dropoff_sequences: dropoffSequences,
    };
  });

  return { cleaned, pickupTripsFinal, dropoffTripsFinal };
}

/**
 * Replaces one bus's whole pickup-trip list + dropoff-trip list — the same
 * write this bus would get from a manual save on the admin schedule page
 * (routes/admin.js PUT /schedule/bus/:id), factored out so the duty-slot
 * materializer below writes through the identical path rather than a
 * parallel copy that could drift.
 *
 * Does NOT touch the bus's own identity/crew fields (plate_number, label,
 * driver_name, ...) — only the schedule and its two bookend times:
 * school_departure_time (derived from dropoffTrips[0]) and
 * school_arrival_time (derived from the LAST pickup trip — the moment the
 * whole morning routine is actually done, symmetric to how departure is the
 * FIRST dropoff leg's start). Both are legacy single-value mirrors kept for
 * older read paths (see GET /api/scan/route's `bus` object) — the real
 * source of truth for multi-trip pickup is bus_pickup_trips below.
 */
function writeBusScheduleRows(busId, pickupTrips, dropoffTrips) {
  const { cleaned, pickupTripsFinal, dropoffTripsFinal } = computeScheduleRows(pickupTrips, dropoffTrips);
  const schoolArrivalTime = pickupTripsFinal[pickupTripsFinal.length - 1]?.arrival_time || null;

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE buses SET school_departure_time = ?, school_arrival_time = ? WHERE id = ?`)
      .run(dropoffTripsFinal[0]?.departure_time || null, schoolArrivalTime, busId);

    db.prepare(`DELETE FROM bus_trips WHERE bus_id = ?`).run(busId);
    const insertTrip = db.prepare(`
      INSERT INTO bus_trips (bus_id, trip_number, departure_time, label) VALUES (?, ?, ?, ?)
    `);
    dropoffTripsFinal.forEach((t, i) => insertTrip.run(busId, i + 1, t.departure_time, t.label || null));

    db.prepare(`DELETE FROM bus_pickup_trips WHERE bus_id = ?`).run(busId);
    const insertPickupTrip = db.prepare(`
      INSERT INTO bus_pickup_trips (bus_id, trip_number, arrival_time, label) VALUES (?, ?, ?, ?)
    `);
    pickupTripsFinal.forEach((t, i) => insertPickupTrip.run(busId, i + 1, t.arrival_time, t.label || null));

    db.prepare(`DELETE FROM bus_route_stops WHERE bus_id = ?`).run(busId);
    const insert = db.prepare(`
      INSERT INTO bus_route_stops
        (bus_id, bus_stop_id, sequence, pickup_times, pickup_sequences, dropoff_times, dropoff_sequences)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    cleaned.forEach((s, i) => {
      insert.run(busId, s.bus_stop_id, i + 1,
                  JSON.stringify(s.pickup_times), JSON.stringify(s.pickup_sequences),
                  JSON.stringify(s.dropoff_times), JSON.stringify(s.dropoff_sequences));
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { stops: cleaned.length, trips: dropoffTripsFinal.length, pickup_trips: pickupTripsFinal.length };
}

/**
 * Same as writeBusScheduleRows, but for a duty slot's own standing schedule
 * on ONE weekday (duty_slot_stops/duty_slot_trips/duty_slot_pickup_trips/
 * duty_slot_days) — this is what the admin's "Rotasi Tugas Bis" panel edits
 * (one day-tab at a time), using the exact TPS-picker UI as the per-bus
 * editor used to have.
 */
function writeDutySlotScheduleRows(slotId, weekday, pickupTrips, dropoffTrips) {
  const { cleaned, pickupTripsFinal, dropoffTripsFinal } = computeScheduleRows(pickupTrips, dropoffTrips);
  const schoolArrivalTime = pickupTripsFinal[pickupTripsFinal.length - 1]?.arrival_time || null;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO duty_slot_days (duty_slot_id, weekday, school_arrival_time) VALUES (?, ?, ?)
      ON CONFLICT (duty_slot_id, weekday) DO UPDATE SET school_arrival_time = excluded.school_arrival_time
    `).run(slotId, weekday, schoolArrivalTime);

    db.prepare(`DELETE FROM duty_slot_trips WHERE duty_slot_id = ? AND weekday = ?`).run(slotId, weekday);
    const insertTrip = db.prepare(`
      INSERT INTO duty_slot_trips (duty_slot_id, weekday, trip_number, departure_time, label) VALUES (?, ?, ?, ?, ?)
    `);
    dropoffTripsFinal.forEach((t, i) => insertTrip.run(slotId, weekday, i + 1, t.departure_time, t.label || null));

    db.prepare(`DELETE FROM duty_slot_pickup_trips WHERE duty_slot_id = ? AND weekday = ?`).run(slotId, weekday);
    const insertPickupTrip = db.prepare(`
      INSERT INTO duty_slot_pickup_trips (duty_slot_id, weekday, trip_number, arrival_time, label) VALUES (?, ?, ?, ?, ?)
    `);
    pickupTripsFinal.forEach((t, i) => insertPickupTrip.run(slotId, weekday, i + 1, t.arrival_time, t.label || null));

    db.prepare(`DELETE FROM duty_slot_stops WHERE duty_slot_id = ? AND weekday = ?`).run(slotId, weekday);
    const insert = db.prepare(`
      INSERT INTO duty_slot_stops
        (duty_slot_id, weekday, bus_stop_id, sequence, pickup_times, pickup_sequences, dropoff_times, dropoff_sequences)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    cleaned.forEach((s, i) => {
      insert.run(slotId, weekday, s.bus_stop_id, i + 1,
                  JSON.stringify(s.pickup_times), JSON.stringify(s.pickup_sequences),
                  JSON.stringify(s.dropoff_times), JSON.stringify(s.dropoff_sequences));
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { stops: cleaned.length, trips: dropoffTripsFinal.length, pickup_trips: pickupTripsFinal.length };
}

/**
 * Resolves today's duty rotation and copies each configured slot's TODAY'S
 * (weekday-specific) TPS list + trips into its currently-assigned bus
 * (straight row copy — same shape on both sides, see db.js). Called daily
 * (see server.js), not just weekly, since which TPS/trips a slot runs can
 * differ by weekday even though the bus assigned to a duty_number only
 * rotates weekly.
 *
 * duty_slot_stops/trips templates only exist for weekday 1-5 — there's no
 * "Sabtu template" to copy. On a weekend this borrows Monday's template
 * (an arbitrary but stable choice) while still resolving the bus mapping
 * from dateStr's OWN week, not a nudged-forward one: the mapping (which bus
 * is duty_number N) must stay whatever's actually current, or a bus still
 * labelled "Tugas 1" on the schedule page over the weekend would silently
 * start showing a DIFFERENT duty's stops/times — exactly the mismatch this
 * function must not create. (resolveDutySchedule's own Minggu-nudge still
 * applies as usual on top of this — that one's about which WEEK, not which
 * weekday's template.)
 *
 * A slot that has NEVER been configured at all (no rows for any weekday) is
 * skipped entirely — that bus's bus_route_stops/bus_trips are left exactly
 * as they were, so this can be adopted one slot at a time without
 * clobbering the legacy manually-entered schedule still in place for slots
 * nobody has touched yet. But once a slot has been configured for AT LEAST
 * ONE weekday, an empty day is a deliberate signal ("this bus doesn't run
 * this trip today — a different duty slot's bus covers it"), not "not set
 * up yet": that bus gets an explicitly EMPTY schedule for today rather than
 * silently keeping yesterday's stale stops, which is exactly the
 * small-bus day-splitting scenario this feature exists for.
 */
function materializeDutySchedule(dateStr) {
  const resolvedDate = dateStr || todayWIT();
  const weekday = weekdayOf(resolvedDate) || 1; // Sabtu/Minggu borrow Senin's template

  const mapping = resolveDutySchedule(resolvedDate);
  const slots = db.prepare(`SELECT * FROM duty_slots`).all();
  const slotByKey = new Map(slots.map((s) => [`${s.bus_group}|${s.duty_number}`, s]));
  const applied = [];

  const slotEverConfiguredStmt = db.prepare(`SELECT 1 FROM duty_slot_stops WHERE duty_slot_id = ? LIMIT 1`);
  const slotStopsStmt = db.prepare(`
    SELECT bus_stop_id, pickup_times, pickup_sequences, dropoff_times, dropoff_sequences
    FROM duty_slot_stops WHERE duty_slot_id = ? AND weekday = ? ORDER BY sequence
  `);
  const slotTripsStmt = db.prepare(`
    SELECT trip_number, departure_time, label FROM duty_slot_trips
    WHERE duty_slot_id = ? AND weekday = ? ORDER BY trip_number
  `);
  const slotPickupTripsStmt = db.prepare(`
    SELECT trip_number, arrival_time, label FROM duty_slot_pickup_trips
    WHERE duty_slot_id = ? AND weekday = ? ORDER BY trip_number
  `);

  for (const group of ['besar', 'kecil']) {
    for (const { duty_number, bus_id } of mapping[group]) {
      const slot = slotByKey.get(`${group}|${duty_number}`);
      if (!slot || !bus_id) continue;
      if (!slotEverConfiguredStmt.get(slot.id)) continue; // untouched slot — leave legacy schedule alone

      // Reconstruct { stops, trips } from the slot's already-denormalised rows
      // (mirrors what routes/admin.js's PUT /schedule/bus/:id receives from
      // the frontend) so this goes through the same computeScheduleRows path.
      // slotStops is legitimately [] on a day this slot's bus doesn't run —
      // that still writes through (an explicitly empty schedule), see above.
      const slotStops = slotStopsStmt.all(slot.id, weekday).map((s) => ({
        ...s,
        pickup_times: JSON.parse(s.pickup_times || '[]'),
        pickup_sequences: JSON.parse(s.pickup_sequences || '[]'),
        dropoff_times: JSON.parse(s.dropoff_times || '[]'),
        dropoff_sequences: JSON.parse(s.dropoff_sequences || '[]'),
      }));

      const tripRows = slotTripsStmt.all(slot.id, weekday);
      const dropoffTrips = tripRows.map((t, i) => ({
        departure_time: t.departure_time,
        label: t.label,
        stops: slotStops
          .filter((s) => s.dropoff_sequences[i] != null)
          .sort((a, b) => a.dropoff_sequences[i] - b.dropoff_sequences[i])
          .map((s) => ({ bus_stop_id: s.bus_stop_id, dropoff_time: s.dropoff_times[i] })),
      }));

      const pickupTripRows = slotPickupTripsStmt.all(slot.id, weekday);
      const pickupTrips = pickupTripRows.map((t, i) => ({
        arrival_time: t.arrival_time,
        label: t.label,
        stops: slotStops
          .filter((s) => s.pickup_sequences[i] != null)
          .sort((a, b) => a.pickup_sequences[i] - b.pickup_sequences[i])
          .map((s) => ({ bus_stop_id: s.bus_stop_id, pickup_time: s.pickup_times[i] })),
      }));

      const result = writeBusScheduleRows(bus_id, pickupTrips, dropoffTrips);
      applied.push({ bus_group: group, duty_number, bus_id, ...result });
    }
  }
  return applied;
}

/**
 * Read-only counterpart to materializeDutySchedule: for every ROTATING duty
 * slot that's actually been configured, compute its schedule straight from
 * duty_slot_stops/trips for dateStr — same reconstruction, same Sabtu/Minggu
 * Monday-template fallback — but returned in scheduleByBus()'s own
 * trips/pickup_trips shape (stop_code/stop_name included) instead of being
 * written into bus_route_stops/bus_trips.
 *
 * Why this needs to exist separately from materializeDutySchedule: that
 * function only writes the schedule for whichever bus CURRENTLY holds each
 * slot, once, when it runs (server.js's daily check, or Terapkan Sekarang).
 * A physical bus can only hold one materialized snapshot at a time, so
 * previewing a date in a DIFFERENT rotation week than "now" (Jadwal's
 * "Besok" crossing a Monday rotation boundary, or an admin/leader checking
 * further ahead) would show that bus's CURRENT-week content mislabelled
 * with the future week's duty number — the exact mismatch that prompted
 * this function. Computing straight from the templates for the date being
 * viewed, rather than from a bus's last-materialized snapshot, keeps every
 * date's label and content consistent regardless of when materialize last
 * ran. GET /api/meta/schedule uses this to override scheduleByBus()'s
 * per-bus stops for whichever bus a rotating slot resolves to.
 */
function resolvedDutySlotSchedules(dateStr) {
  const resolvedDate = dateStr || todayWIT();
  const weekday = weekdayOf(resolvedDate) || 1;

  const mapping = resolveDutySchedule(resolvedDate);
  const slots = db.prepare(`SELECT * FROM duty_slots WHERE fixed_bus_id IS NULL`).all();
  const slotByKey = new Map(slots.map((s) => [`${s.bus_group}|${s.duty_number}`, s]));

  const slotEverConfiguredStmt = db.prepare(`SELECT 1 FROM duty_slot_stops WHERE duty_slot_id = ? LIMIT 1`);
  const slotStopsStmt = db.prepare(`
    SELECT dss.bus_stop_id, dss.pickup_times, dss.pickup_sequences, dss.dropoff_times, dss.dropoff_sequences,
           s.code AS stop_code, s.name AS stop_name, s.sort_order
    FROM duty_slot_stops dss JOIN bus_stops s ON s.id = dss.bus_stop_id
    WHERE dss.duty_slot_id = ? AND dss.weekday = ? ORDER BY dss.sequence
  `);
  const slotTripsStmt = db.prepare(`
    SELECT trip_number, departure_time, label FROM duty_slot_trips
    WHERE duty_slot_id = ? AND weekday = ? ORDER BY trip_number
  `);
  const slotPickupTripsStmt = db.prepare(`
    SELECT trip_number, arrival_time, label FROM duty_slot_pickup_trips
    WHERE duty_slot_id = ? AND weekday = ? ORDER BY trip_number
  `);

  const byBusId = new Map();
  for (const group of ['besar', 'kecil']) {
    for (const { duty_number, bus_id } of mapping[group]) {
      const slot = slotByKey.get(`${group}|${duty_number}`);
      if (!slot || !bus_id) continue;
      if (!slotEverConfiguredStmt.get(slot.id)) continue; // untouched slot — leave the bus's own schedule alone

      const stops = slotStopsStmt.all(slot.id, weekday).map((s) => ({
        ...s,
        pickup_times: JSON.parse(s.pickup_times || '[]'),
        pickup_sequences: JSON.parse(s.pickup_sequences || '[]'),
        dropoff_times: JSON.parse(s.dropoff_times || '[]'),
        dropoff_sequences: JSON.parse(s.dropoff_sequences || '[]'),
      }));

      const trips = slotTripsStmt.all(slot.id, weekday).map((t) => {
        const idx = t.trip_number - 1;
        return {
          trip_number: t.trip_number,
          departure_time: t.departure_time,
          label: t.label,
          stops: stops
            .filter((s) => s.dropoff_sequences[idx] != null)
            .sort((a, b) => a.dropoff_sequences[idx] - b.dropoff_sequences[idx])
            .map((s) => ({
              bus_stop_id: s.bus_stop_id, code: s.stop_code, name: s.stop_name,
              dropoff_time: s.dropoff_times[idx], sequence: s.dropoff_sequences[idx], sort_order: s.sort_order,
            })),
        };
      });

      const pickupTrips = slotPickupTripsStmt.all(slot.id, weekday).map((t) => {
        const idx = t.trip_number - 1;
        return {
          trip_number: t.trip_number,
          arrival_time: t.arrival_time,
          label: t.label,
          stops: stops
            .filter((s) => s.pickup_sequences[idx] != null)
            .sort((a, b) => a.pickup_sequences[idx] - b.pickup_sequences[idx])
            .map((s) => ({
              bus_stop_id: s.bus_stop_id, code: s.stop_code, name: s.stop_name,
              pickup_time: s.pickup_times[idx], sequence: s.pickup_sequences[idx], sort_order: s.sort_order,
            })),
        };
      });

      byBusId.set(bus_id, { trips, pickup_trips: pickupTrips, stops });
    }
  }
  return byBusId;
}

module.exports = {
  GRADES, VIOLATION_CATEGORIES,
  PARENT_CATEGORIES, PARENT_CATEGORY_KEYS, parentCategoryLabel,
  currentAcademicYear, nextApplicationNo, generateTransitId,
  assertSubmittable, assertCapacity, stopLoad, routeLoad,
  scheduleByBus, normaliseTime, normaliseDate, formatPeriodLabel, getSetting, setSetting,
  issueCard, reconcileCardStatuses, logActivity, fail,
  todayWIT, mondayOf, sundayOf, addDays, weekdayOf, resolveDutySchedule,
  writeBusScheduleRows, writeDutySlotScheduleRows, materializeDutySchedule, resolvedDutySlotSchedules,
};

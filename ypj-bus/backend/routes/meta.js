const express = require('express');
const db      = require('../db');
const {
  GRADES, VIOLATION_CATEGORIES, PARENT_CATEGORIES,
  stopLoad, routeLoad, currentAcademicYear, scheduleByBus, formatPeriodLabel,
  todayWIT, sundayOf, addDays, resolveDutySchedule, resolvedDutySlotSchedules,
} = require('../lib/cards');

const router = express.Router();

// GET /api/meta — everything the parent form needs in one round trip.
// Stops carry their live load so the picker can warn before a parent commits to
// an over-subscribed TPS.
router.get('/', (req, res) => {
  const stops = stopLoad()
    .filter((s) => s.is_active)
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      area: s.area,
      seat_capacity: s.seat_capacity,
      issued_active: s.issued_active,
      pending_requests: s.pending_requests,
      seats_remaining: Math.max(s.seat_capacity - s.issued_active, 0),
    }));

  const rules = db.prepare(`
    SELECT id, version, title, body_md
    FROM rule_documents
    WHERE published_at IS NOT NULL AND effective_from <= date('now')
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
  `).get();

  // Active units, so the attendant scanner can offer them; nothing sensitive,
  // and it saves that screen an admin-only round trip.
  const buses = db.prepare(`
    SELECT id, plate_number, label, driver_name, helper_name
    FROM buses WHERE is_active = 1 ORDER BY plate_number
  `).all();

  res.json({
    academic_year: currentAcademicYear(),
    grades: GRADES,
    stops,
    buses,
    parent_categories: PARENT_CATEGORIES,
    rules,
    routes: routeLoad(),
    violation_categories: VIOLATION_CATEGORIES,
  });
});

// GET /api/meta/schedule — bus service times per TPS, read-only for parents
// (and Driver/Helper — same page). Times are maintained by the Transport
// Team via the admin schedule/duty-rotation panels.
// ?day=besok resolves the duty rotation for tomorrow instead of today — the
// only thing that can actually differ day-to-day is which bus holds which
// duty_number, at a week boundary (e.g. checking on Minggu for Senin's real
// assignment, or Sabtu for the week that just closed). Route/stop times
// themselves (scheduleByBus) are period-wide, not per-weekday.
router.get('/schedule', (req, res) => {
  const dateStr = req.query.day === 'besok' ? addDays(todayWIT(), 1) : todayWIT();

  // Minggu s/d Sabtu covering dateStr — see the matching comment on
  // GET /api/admin/schedule for why this is computed live rather than read
  // from a setting, and why it starts on Minggu.
  const period_start = sundayOf(dateStr);
  const period_end = addDays(period_start, 6);

  // Which duty_number (and besar/kecil group) each bus holds this week, so
  // the schedule page can group/order buses the same way the Transport Team
  // thinks about the rotation (Tugas 1-4 besar, then Tugas 1-3 kecil, then
  // any fixed slot like kecil Tugas 5) instead of alphabetically by plate.
  const mapping = resolveDutySchedule(dateStr);
  const dutyByBus = new Map();
  for (const group of ['besar', 'kecil']) {
    for (const { duty_number, bus_id } of mapping[group]) {
      dutyByBus.set(bus_id, { bus_group: group, duty_number });
    }
  }

  // Content for a rotating slot is computed straight from its templates for
  // dateStr, not read from the bus's last-materialized bus_route_stops —
  // a bus can only hold one materialized snapshot at a time, so previewing
  // a date in a DIFFERENT rotation week than whenever materialize last ran
  // (e.g. "Besok" crossing a Monday boundary) would otherwise show that
  // bus's stale current-week stops mislabelled with the future duty number.
  // See resolvedDutySlotSchedules in lib/cards.js.
  const dutySchedules = resolvedDutySlotSchedules(dateStr);

  res.json({
    academic_year: currentAcademicYear(),
    date: dateStr,
    period: formatPeriodLabel(period_start, period_end),
    buses: scheduleByBus().map((b) => ({
      ...b,
      ...(dutyByBus.get(b.bus_id) || {}),
      ...(dutySchedules.get(b.bus_id) || {}),
    })),
  });
});

/**
 * GET /api/meta/trip-status — "has the bus left yet?" for this parent's stops.
 *
 * The no-GPS substitute for a live map: for each active card, the most recent
 * departure logged today by a bus serving that child's TPS, and how many stops
 * away it is. Returns an empty list when nothing has departed, so the dashboard
 * simply shows nothing rather than a stale position.
 */
router.get('/trip-status', (req, res) => {
  const cards = db.prepare(`
    SELECT c.bus_stop_id, s.full_name AS student_name,
           st.code AS stop_code, st.name AS stop_name
    FROM bus_id_cards c
    JOIN students s ON s.id = c.student_id
    JOIN bus_stops st ON st.id = c.bus_stop_id
    WHERE s.parent_id = ? AND c.status = 'active'
  `).all(req.user.id);

  const latestForStop = db.prepare(`
    SELECT te.created_at, te.direction,
           b.plate_number, b.label,
           fs.code AS from_code, fs.name AS from_name,
           mine.sequence AS my_sequence, moved.sequence AS from_sequence,
           mine_stop.sort_order AS my_sort, moved_stop.sort_order AS from_sort,
           mine.pickup_times, mine.dropoff_times
    FROM trip_events te
    JOIN buses b ON b.id = te.bus_id
    JOIN bus_stops fs ON fs.id = te.bus_stop_id
    JOIN bus_route_stops mine  ON mine.bus_id = te.bus_id AND mine.bus_stop_id = :stop_id
    JOIN bus_route_stops moved ON moved.bus_id = te.bus_id AND moved.bus_stop_id = te.bus_stop_id
    JOIN bus_stops mine_stop  ON mine_stop.id = :stop_id
    JOIN bus_stops moved_stop ON moved_stop.id = te.bus_stop_id
    WHERE te.event = 'departed'
      AND date(te.created_at, '+9 hours') = date('now', '+9 hours')
      -- Pickup climbs this unit's own sequence 1→N. Dropoff instead follows
      -- fixed TPS numbering outward from school regardless of that sequence
      -- (see GET /scan/route), so "already passed, still coming to us" is
      -- compared on sort_order there instead.
      AND (CASE WHEN te.direction = 'dropoff'
             THEN moved_stop.sort_order > mine_stop.sort_order
             ELSE moved.sequence < mine.sequence END)
      -- ...and has not yet reached us. Without this the banner keeps showing
      -- "1 TPS lagi" after the bus has long gone past, which would send a
      -- parent out to an empty shelter.
      AND NOT EXISTS (
        SELECT 1 FROM trip_events done
        JOIN bus_route_stops ds
          ON ds.bus_id = done.bus_id AND ds.bus_stop_id = done.bus_stop_id
        JOIN bus_stops ds_stop ON ds_stop.id = done.bus_stop_id
        WHERE done.bus_id = te.bus_id
          AND done.event = 'departed'
          AND done.direction = te.direction
          AND date(done.created_at, '+9 hours') = date('now', '+9 hours')
          AND (CASE WHEN done.direction = 'dropoff'
                 THEN ds_stop.sort_order <= mine_stop.sort_order
                 ELSE ds.sequence >= mine.sequence END)
      )
    ORDER BY te.id DESC
    LIMIT 1
  `);

  const trips = [];
  for (const card of cards) {
    const t = latestForStop.get({ stop_id: card.bus_stop_id });
    if (!t) continue;
    trips.push({
      student_name: card.student_name,
      stop_code: card.stop_code,
      stop_name: card.stop_name,
      plate_number: t.plate_number,
      label: t.label,
      direction: t.direction,
      departed_from: `${t.from_code} ${t.from_name}`,
      departed_at: t.created_at,
      // Dropoff is compared on TPS sort_order, pickup on this unit's own
      // sequence (see the query above) — pick whichever pair applies.
      stops_away: t.direction === 'dropoff'
        ? Math.abs(t.my_sort - t.from_sort)
        : Math.abs(t.my_sequence - t.from_sequence),
      // A stop can now have more than one pickup trip — this banner doesn't
      // know which one is currently running, so it shows the earliest
      // scheduled time as a reasonable estimate rather than picking a trip.
      eta: t.direction === 'dropoff'
        ? JSON.parse(t.dropoff_times || '[]')[0] || null
        : JSON.parse(t.pickup_times || '[]').filter(Boolean).sort()[0] || null,
    });
  }

  res.json(trips);
});

// GET /api/meta/notifications — parent's own inbox.
router.get('/notifications', (req, res) => {
  const rows = db.prepare(`
    SELECT id, template, title, body, read_at, created_at
    FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(rows);
});

router.put('/notifications/:id/read', (req, res) => {
  db.prepare(`
    UPDATE notifications SET read_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;

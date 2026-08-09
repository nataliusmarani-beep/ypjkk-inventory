const express = require('express');
const db      = require('../db');
const { fail } = require('../lib/cards');
const { tripStopsOrdered, tripState } = require('../lib/trips');

const router = express.Router();

// Mounted behind requireRole('parent', 'helper', 'school_staff', 'leader', 'admin', 'transport_admin').

/**
 * GET /api/track/:busId?direction=pickup|dropoff — the stop-progress map.
 *
 * Deliberately NOT a GPS position: this app has no tracker hardware (see the
 * trip_events comment in db.js) because a live map would just stall on the
 * SP2/SP3 signal exactly when a parent needs it most. Instead this plots the
 * unit's TPS on a map and marks how far along the "departed from stop X"
 * trail (trip_events) has gotten — the same source ScannerPage and the
 * parent "sudah berangkat?" banner already use, just drawn on a map instead
 * of a list.
 */
router.get('/:busId', (req, res, next) => {
  try {
    const busId = Number(req.params.busId);
    if (!busId) throw fail(400, 'Pilih unit bis terlebih dahulu.');
    const direction = req.query.direction === 'dropoff' ? 'dropoff' : 'pickup';

    const bus = db.prepare(`
      SELECT id, plate_number, label, driver_name, helper_name
      FROM buses WHERE id = ? AND is_active = 1
    `).get(busId);
    if (!bus) throw fail(404, 'Bis tidak ditemukan.');

    const { trips, tripsTotal, tripInProgress, tripNumber, tripIndex0, currentStart, finishes }
      = tripState(busId, direction);
    const timeField = direction === 'pickup' ? 'pickup_time' : 'dropoff_time';
    const legacyTime = null;
    const tripScheduledTime = trips[tripIndex0]?.scheduled_time ?? legacyTime;

    // Same ordering/filtering as GET /api/scan/route: only stops not yet
    // served on an EARLIER leg today stay in the list, in visiting order.
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
        return {
          bus_stop_id: s.bus_stop_id,
          stop_code: s.code,
          stop_name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          students: s.students,
          [timeField]: s.times[tripIndex0] ?? null,
          departed_at: inCurrentLeg?.created_at || null,
        };
      })
      .filter(Boolean);

    // The bus is presumed to be heading toward (or waiting at) the first
    // stop with no departure yet — the same "1 TPS lagi" logic the parent
    // banner uses, just applied to every stop on the run instead of one.
    // If every remaining stop has already departed, the leg is effectively
    // done and the unit is presumed en route back to school.
    const currentIndex = stops.findIndex((s) => !s.departed_at);
    const resolvedIndex = currentIndex === -1 ? (stops.length ? stops.length : null) : currentIndex;

    // Arrival status — the two moments a helper/parent/guru actually asks
    // "is it there yet?": back at school after a pickup round, or at the
    // last TPS on a dropoff round. Neither is a GPS fact, just the same
    // trip_events trail read from its other end:
    //  - Pickup: a 'finished' school-level event ("Selesai Trip") IS the
    //    crew's own confirmation the unit is back at school. No leg
    //    currently running (currentStart null) is required so this doesn't
    //    fire mid-way through a second trip that reuses the same direction.
    //  - Dropoff: no equivalent "arrived" event exists — the last stop on
    //    the leg simply hasn't been marked departed yet, same signal the map
    //    marker itself uses (resolvedIndex sitting on the final stop).
    let arrival = null;
    if (direction === 'pickup' && !tripInProgress && finishes.length > 0) {
      arrival = { type: 'at_school', at: finishes[finishes.length - 1].created_at, stop: null };
    } else if (direction === 'dropoff' && stops.length > 0 && resolvedIndex === stops.length - 1) {
      const last = stops[stops.length - 1];
      arrival = { type: 'at_final_stop', at: null, stop: { code: last.stop_code, name: last.stop_name } };
    }

    res.json({
      bus,
      direction,
      trips_total: tripsTotal,
      trip_number: tripNumber,
      trip_scheduled_time: tripScheduledTime,
      trip_in_progress: tripInProgress,
      stops,
      current_index: resolvedIndex,
      all_departed_this_leg: stops.length > 0 && stops.every((s) => s.departed_at),
      arrival,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

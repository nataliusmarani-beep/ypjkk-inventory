const express = require('express');
const db      = require('../db');
const { fail } = require('../lib/cards');
const { tripStopsOrdered, tripState } = require('../lib/trips');

const router = express.Router();

// Mounted behind requireRole('parent', 'helper', 'school_staff', 'leader', 'admin', 'transport_admin').

/**
 * GET /api/track/:busId?direction=pickup|dropoff — the stop-progress map,
 * as a list of every leg (rit) run today for that direction, oldest first.
 *
 * Deliberately NOT a GPS position: this app has no tracker hardware (see the
 * trip_events comment in db.js) because a live map would just stall on the
 * SP2/SP3 signal exactly when a parent needs it most. Instead this plots
 * each leg's TPS on a map and marks how far along the "departed from stop X"
 * trail (trip_events) has gotten — the same source ScannerPage and the
 * parent "sudah berangkat?" banner already use, just drawn on a map instead
 * of a list.
 *
 * A finished leg is kept in the response (not dropped once the crew taps
 * "Selesai"/"Kembali ke Sekolah") so the whole day's rits stay reviewable —
 * route and timing per stop — instead of the view going blank the moment a
 * leg closes out.
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

    const { trips, tripsTotal, tripInProgress, starts, finishes } = tripState(busId, direction);
    const timeField = direction === 'pickup' ? 'pickup_time' : 'dropoff_time';

    // starts[i] and finishes[i] belong to the same leg: POST /trip/start
    // refuses to open a new leg while the previous one is still open (see
    // the 409 checks there and in /trip/return), so the two arrays always
    // stay in lockstep — finishes[i] is either that leg's close-out or,
    // for the very last leg while it's still running, simply absent.
    const buildLeg = (tripIndex0, legStart, legEnd, inProgress) => {
      const stops = tripStopsOrdered(busId, tripIndex0, direction).map((s) => {
        const inWindow = (rows) => [...rows].reverse().find((r) =>
          (!legStart || r.created_at >= legStart.created_at) &&
          (!legEnd || r.created_at <= legEnd.created_at));
        const departures = db.prepare(`
          SELECT created_at FROM trip_events
          WHERE bus_id = ? AND bus_stop_id = ? AND direction = ? AND event = 'departed'
            AND date(created_at, '+9 hours') = date('now', '+9 hours')
          ORDER BY id ASC
        `).all(busId, s.bus_stop_id, direction);
        // "Tiba di TPS Terakhir" — see POST /api/scan/arrival. Read the same
        // way as departed_at; only the last stop's value actually gets used
        // below, but every stop carries it for the map/list to show.
        const arrivals = db.prepare(`
          SELECT created_at FROM trip_events
          WHERE bus_id = ? AND bus_stop_id = ? AND direction = ? AND event = 'arrived'
            AND date(created_at, '+9 hours') = date('now', '+9 hours')
          ORDER BY id ASC
        `).all(busId, s.bus_stop_id, direction);
        return {
          bus_stop_id: s.bus_stop_id,
          stop_code: s.code,
          stop_name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          students: s.students,
          [timeField]: s.times[tripIndex0] ?? null,
          departed_at: inWindow(departures)?.created_at || null,
          arrived_at: inWindow(arrivals)?.created_at || null,
        };
      });

      // The bus is presumed to be heading toward (or waiting at) the first
      // stop with no departure yet on this leg. If every stop has already
      // departed, the leg is effectively done and the unit is presumed en
      // route back to school.
      const currentIdx = stops.findIndex((s) => !s.departed_at);
      const resolvedIndex = currentIdx === -1 ? (stops.length ? stops.length : null) : currentIdx;

      // Status keterangan — the crew's own taps, not a guess, each with a
      // real timestamp. Two can apply at once for a completed dropoff leg
      // (arrived at the final TPS first, then returned minutes later), so
      // each is its own field rather than one slot that can only hold one:
      //  - Pickup: 'finished' school event → "Tiba di Sekolah".
      //  - Dropoff: 'finished' school event → "Kembali ke Sekolah" (same
      //    underlying event, POST /api/scan/trip/return, just the crew's
      //    other button label for the dropoff direction).
      //  - Dropoff: 'arrived' event on the LAST stop of the leg → "Tiba di
      //    Titik Pengantaran Akhir" (see POST /api/scan/arrival). Doesn't
      //    show until the crew actually taps it.
      const atSchool = direction === 'pickup' && !inProgress ? { at: legEnd.created_at } : null;
      const returnedToSchool = direction === 'dropoff' && !inProgress ? { at: legEnd.created_at } : null;
      const lastStop = stops[stops.length - 1];
      const atFinalStop = direction === 'dropoff' && lastStop?.arrived_at
        ? { at: lastStop.arrived_at, stop: { code: lastStop.stop_code, name: lastStop.stop_name } }
        : null;

      return {
        trip_number: tripIndex0 + 1,
        trip_scheduled_time: trips[tripIndex0]?.scheduled_time ?? null,
        status: inProgress ? 'in_progress' : 'completed',
        started_at: legStart?.created_at ?? null,
        finished_at: legEnd?.created_at ?? null,
        stops,
        current_index: resolvedIndex,
        all_departed: stops.length > 0 && stops.every((s) => s.departed_at),
        at_school: atSchool,
        returned_to_school: returnedToSchool,
        at_final_stop: atFinalStop,
      };
    };

    const legs = starts.map((s, i) =>
      buildLeg(i, s, finishes[i] || null, tripInProgress && i === starts.length - 1));

    res.json({
      bus,
      direction,
      trips_total: tripsTotal,
      trip_in_progress: tripInProgress,
      legs,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

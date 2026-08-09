const db = require('../db');

/**
 * A trip's TPS, in the order the bus actually visits them: the admin's
 * explicit per-trip sequence (see {pickup,dropoff}_sequences in db.js, set by
 * adding a TPS to a trip on the schedule page). A stop belongs to a trip iff
 * it has a sequence at that trip's index — NOT whether it has a time there;
 * a stop can be added to a trip with its time still blank ("TBD") without
 * falling out of the list, but a stop never added to this trip at all (e.g.
 * dropoff-only, or only added to a different trip) correctly stays off it.
 * Works for either direction — pickup and dropoff each have their own
 * times/sequences JSON-array columns on bus_route_stops, same shape.
 */
function tripStopsOrdered(busId, tripIndex0, direction = 'dropoff') {
  const timesCol = direction === 'pickup' ? 'pickup_times' : 'dropoff_times';
  const seqCol = direction === 'pickup' ? 'pickup_sequences' : 'dropoff_sequences';
  return db.prepare(`
    SELECT brs.bus_stop_id, brs.${timesCol} AS times, brs.${seqCol} AS sequences,
           s.code, s.name, s.sort_order, s.latitude, s.longitude,
           (SELECT COUNT(*) FROM bus_id_cards c
             WHERE c.bus_stop_id = brs.bus_stop_id AND c.status = 'active') AS students
    FROM bus_route_stops brs
    JOIN bus_stops s ON s.id = brs.bus_stop_id
    WHERE brs.bus_id = ?
  `).all(busId)
    .map((r) => ({
      ...r,
      times: JSON.parse(r.times || '[]'),
      sequences: JSON.parse(r.sequences || '[]'),
    }))
    .filter((r) => r.sequences[tripIndex0] != null)
    .sort((a, b) => a.sequences[tripIndex0] - b.sequences[tripIndex0]);
}

/**
 * Which leg (started/finished pair from trip_events) is currently running for
 * a bus+direction, today (WIT). Both directions can now shuttle back and
 * forth several times — a bus_trips/bus_pickup_trips row per leg is the
 * source of truth for how many legs there are and each one's scheduled time,
 * not however many times happen to be filled in across the stop list.
 */
function tripState(busId, direction) {
  const tripsTable = direction === 'pickup' ? 'bus_pickup_trips' : 'bus_trips';
  const trips = db.prepare(`
    SELECT trip_number, ${direction === 'pickup' ? 'arrival_time' : 'departure_time'} AS scheduled_time
    FROM ${tripsTable} WHERE bus_id = ? ORDER BY trip_number
  `).all(busId);
  const tripsTotal = Math.max(1, trips.length);
  const schoolEvents = db.prepare(`
    SELECT event, created_at FROM trip_events
    WHERE bus_id = ? AND bus_stop_id IS NULL AND direction = ?
      AND date(created_at, '+9 hours') = date('now', '+9 hours')
    ORDER BY id ASC
  `).all(busId, direction);
  const starts = schoolEvents.filter((e) => e.event === 'started');
  const finishes = schoolEvents.filter((e) => e.event === 'finished');
  const tripInProgress = starts.length > finishes.length;
  const tripNumber = tripInProgress ? starts.length : finishes.length + 1;
  const tripIndex0 = tripNumber - 1;
  const currentStart = tripInProgress ? starts[starts.length - 1] : null;
  return { trips, tripsTotal, tripInProgress, tripNumber, tripIndex0, currentStart, starts, finishes };
}

module.exports = { tripStopsOrdered, tripState };

import { useCallback, useEffect, useState } from 'react';
import { api, formatWIT } from '../api';
import BusTrackMap from '../components/BusTrackMap.jsx';

const POLL_MS = 8000;

/**
 * The accordion header label for a leg — what a helper/parent/guru actually
 * asks about, not just "Rit N": for pickup that's arrival back at school;
 * for dropoff it's the final TPS (arriving there is the moment that matters
 * to a waiting parent, ahead of the crew's own drive back to school).
 */
function legLabel(direction, leg) {
  if (leg.status === 'in_progress') return `Rit ${leg.trip_number} sedang berjalan`;
  if (direction === 'pickup') {
    return leg.at_school ? 'Tiba di Sekolah' : `Rit ${leg.trip_number} selesai`;
  }
  if (leg.at_final_stop) return `TPS Terakhir: ${leg.at_final_stop.stop.code} ${leg.at_final_stop.stop.name}`;
  if (leg.returned_to_school) return 'Kembali ke Sekolah';
  return `Rit ${leg.trip_number} selesai`;
}

function legTime(leg) {
  if (leg.status === 'in_progress') return null;
  if (leg.at_final_stop) return leg.at_final_stop.at;
  if (leg.at_school) return leg.at_school.at;
  if (leg.returned_to_school) return leg.returned_to_school.at;
  return leg.finished_at;
}

/**
 * Lacak Bus — stop-progress history for Helper, Guru, and Parent.
 *
 * Not GPS: this app has no tracker hardware (see the trip_events comment in
 * backend/db.js). What's plotted is the same "departed from stop X" trail
 * ScannerPage already records, just drawn on a map instead of a list — a
 * live position would just go stale in the SP2/SP3 dead zones exactly when
 * a parent needs it most.
 *
 * Every leg (rit) run today stays listed as its own accordion item, even
 * after the bus arrives — so the whole day's route and timing can be
 * reviewed, not just whatever leg is currently running.
 */
export default function TrackBusPage({ user }) {
  const [meta, setMeta] = useState(null);
  const [busId, setBusId] = useState('');
  const [direction, setDirection] = useState('pickup');
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  // Same convenience as ScannerPage: a Helper/Guru scheduled on a unit today
  // lands straight on it instead of hunting through the plate-number list.
  useEffect(() => {
    if (!meta || busId || !user?.name) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const mine = meta.buses.find((b) =>
      norm(b.helper_name) === norm(user.name) || norm(b.driver_name) === norm(user.name));
    if (mine) setBusId(String(mine.id));
  }, [meta, user, busId]);

  const load = useCallback(() => {
    if (!busId) { setRun(null); return; }
    api.track(busId, direction)
      .then((data) => { setRun(data); setError(null); })
      .catch((e) => setError(e.message));
  }, [busId, direction]);

  useEffect(() => {
    load();
    if (!busId) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, busId]);

  const bus = meta?.buses?.find((b) => String(b.id) === String(busId));
  const legs = run?.legs || [];
  const lastTripNumber = legs.length ? legs[legs.length - 1].trip_number : null;

  return (
    <div className="page">
      <h1>Lacak Bus</h1>
      <p className="muted">
        Riwayat rit hari ini, berdasarkan catatan keberangkatan tiap TPS — tetap tampil
        setelah bis tiba, supaya rute dan waktunya bisa direview.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="card">
        <div className="field">
          <label>Unit Bis</label>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}>
            <option value="">— Pilih unit —</option>
            {meta?.buses?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.duty_number != null ? `Tugas ${b.duty_number} — ` : ''}
                {b.plate_number}{b.label ? ` (${b.label})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Rit</label>
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={direction === 'pickup' ? 'on' : ''}
                    onClick={() => setDirection('pickup')}>Penjemputan (pagi)</button>
            <button className={direction === 'dropoff' ? 'on' : ''}
                    onClick={() => setDirection('dropoff')}>Pengantaran (siang)</button>
          </div>
        </div>
      </div>

      {busId && !run && !error && <div className="card muted center">Memuat…</div>}

      {run && (
        <>
          <div className="card">
            <div className="row" style={{ gap: 8 }}>
              {bus?.duty_number != null && <span className="chip ok">Tugas {bus.duty_number}</span>}
              <strong>{bus?.plate_number}{bus?.label ? ` — ${bus.label}` : ''}</strong>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {bus?.driver_name && `Sopir: ${bus.driver_name}`}
              {bus?.driver_name && bus?.helper_name && ' · '}
              {bus?.helper_name && `Helper: ${bus.helper_name}`}
            </div>
          </div>

          {legs.length === 0 && (
            <div className="card muted center">
              Belum ada rit {direction === 'pickup' ? 'penjemputan' : 'pengantaran'} hari ini.
            </div>
          )}

          <div className="col" style={{ gap: 10 }}>
            {[...legs].reverse().map((leg) => (
              <details key={leg.trip_number} className="card" open={leg.trip_number === lastTripNumber}
                        style={{ padding: 0 }}>
                <summary style={{ padding: 14, cursor: 'pointer', listStyle: 'none' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong>Rit {leg.trip_number}</strong>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {legLabel(direction, leg)}
                        {legTime(leg) && ` · ${formatWIT(legTime(leg))} WIT`}
                      </div>
                    </div>
                    <span className={`chip ${leg.status === 'in_progress' ? 'ok' : 'neutral'}`}>
                      {leg.status === 'in_progress' ? 'Berjalan' : 'Selesai'}
                    </span>
                  </div>
                </summary>

                <div style={{ padding: '0 14px 14px' }}>
                  {leg.trip_scheduled_time && (
                    <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                      Jadwal: {leg.trip_scheduled_time} WIT
                    </div>
                  )}

                  {/* Status keterangan — the moments people actually check
                      for. at_final_stop and returned_to_school can both be
                      true at once for a dropoff leg (arrived at the last
                      TPS, then back at school minutes later), so both
                      render. See the matching comment in
                      backend/routes/track.js. */}
                  {leg.at_school && (
                    <div className="banner success">
                      <span>🏫</span>
                      <div>
                        <strong>Bis sudah tiba di sekolah</strong>
                        {leg.at_school.at && ` pukul ${formatWIT(leg.at_school.at)} WIT.`}
                      </div>
                    </div>
                  )}
                  {leg.at_final_stop && (
                    <div className="banner success">
                      <span>📍</span>
                      <div>
                        <strong>
                          Bis sudah tiba di titik pengantaran akhir: {leg.at_final_stop.stop.code} {leg.at_final_stop.stop.name}
                        </strong>
                        {leg.at_final_stop.at && ` pukul ${formatWIT(leg.at_final_stop.at)} WIT.`}
                      </div>
                    </div>
                  )}
                  {leg.returned_to_school && (
                    <div className="banner success">
                      <span>🏫</span>
                      <div>
                        <strong>Bis sudah kembali ke sekolah</strong>
                        {leg.returned_to_school.at && ` pukul ${formatWIT(leg.returned_to_school.at)} WIT.`}
                      </div>
                    </div>
                  )}

                  <BusTrackMap stops={leg.stops} currentIndex={leg.current_index} />

                  <div className="col" style={{ gap: 0, marginTop: 12 }}>
                    {leg.stops.map((s, i) => (
                      <div key={s.bus_stop_id} className="row"
                           style={{ padding: '8px 0', borderBottom: '1px solid var(--outline)' }}>
                        <span className={`chip ${s.departed_at ? 'ok' : 'neutral'}`} style={{ minWidth: 26, textAlign: 'center' }}>
                          {s.departed_at ? '✓' : i + 1}
                        </span>
                        <div className="grow">
                          <strong>{s.stop_code} {s.stop_name}</strong>
                          <div className="muted" style={{ fontSize: 12.5 }}>
                            {s.students} siswa
                            {s.pickup_time ? ` · jadwal ${s.pickup_time} WIT` : ''}
                            {s.dropoff_time ? ` · jadwal ${s.dropoff_time} WIT` : ''}
                            {s.departed_at && ` · berangkat ${formatWIT(s.departed_at)} WIT`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

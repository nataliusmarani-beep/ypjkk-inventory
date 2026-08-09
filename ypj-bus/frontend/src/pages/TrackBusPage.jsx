import { useCallback, useEffect, useState } from 'react';
import { api, formatWIT } from '../api';
import BusTrackMap from '../components/BusTrackMap.jsx';

const POLL_MS = 8000;

/**
 * Lacak Bus — stop-progress map for Helper, Guru, and Parent.
 *
 * Not GPS: this app has no tracker hardware (see the trip_events comment in
 * backend/db.js). What's plotted is the same "departed from stop X" trail
 * ScannerPage already records, just drawn on a map instead of a list — a
 * live position would just go stale in the SP2/SP3 dead zones exactly when
 * a parent needs it most.
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

  return (
    <div className="page">
      <h1>Lacak Bus</h1>
      <p className="muted">
        Progres bis di sepanjang rute hari ini, berdasarkan catatan keberangkatan tiap TPS.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="card">
        <div className="field">
          <label>Unit Bis</label>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}>
            <option value="">— Pilih unit —</option>
            {meta?.buses?.map((b) => (
              <option key={b.id} value={b.id}>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{bus?.plate_number}{bus?.label ? ` — ${bus.label}` : ''}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {bus?.driver_name && `Sopir: ${bus.driver_name}`}
                  {bus?.driver_name && bus?.helper_name && ' · '}
                  {bus?.helper_name && `Helper: ${bus.helper_name}`}
                </div>
              </div>
              <span className={`chip ${run.trip_in_progress || run.arrival ? 'ok' : 'neutral'}`}>
                {run.arrival?.type === 'at_school' ? 'Tiba di sekolah'
                  : run.trip_in_progress ? `Rit ${run.trip_number} berjalan`
                  : 'Belum berangkat'}
              </span>
            </div>
            {run.trip_scheduled_time && (
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Jadwal: {run.trip_scheduled_time} WIT
              </div>
            )}
          </div>

          {/* Arrival status — the two moments people actually check for:
              back at school after pickup, or at the last TPS on dropoff.
              See the matching comment in backend/routes/track.js. */}
          {run.arrival?.type === 'at_school' && (
            <div className="banner success">
              <span>🏫</span>
              <div>
                <strong>Bis sudah tiba di sekolah</strong>
                {run.arrival.at && ` pukul ${formatWIT(run.arrival.at)} WIT.`}
              </div>
            </div>
          )}
          {run.arrival?.type === 'at_final_stop' && (
            <div className="banner success">
              <span>📍</span>
              <div>
                <strong>
                  Bis sudah tiba di TPS akhir: {run.arrival.stop.code} {run.arrival.stop.name}
                </strong>
              </div>
            </div>
          )}

          <BusTrackMap stops={run.stops} currentIndex={run.current_index} />

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 10 }}>TPS Rit Ini</h3>
            {run.stops.length === 0 && (
              <p className="muted">
                {run.arrival?.type === 'at_school'
                  ? 'Rit ini sudah selesai — bis sudah kembali ke sekolah.'
                  : 'Tidak ada TPS tersisa pada rit ini.'}
              </p>
            )}
            <div className="col" style={{ gap: 0 }}>
              {run.stops.map((s, i) => (
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
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Jadwal Pelayanan Bis — read-only view of the current rotation, grouped by bus.
 *
 * Each unit has its own TPS list because the Transport Team runs a weekly
 * rolling roster, so this page answers "which bus covers my stop this week, and
 * at what time". A parent's own stop is flagged: with 8 units across 19 TPS the
 * row that matters to them would otherwise be buried.
 *
 * A blank time shows as "belum diatur" rather than a placeholder, because a
 * guessed time is worse than an obviously missing one when a parent is deciding
 * when to have their child at the shelter.
 */
export default function SchedulePage() {
  const navigate = useNavigate();
  const [day, setDay] = useState('hari_ini');
  const [buses, setBuses] = useState(null);
  const [period, setPeriod] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(null);
  const [myStops, setMyStops] = useState(new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setBuses(null);
        setError(null);
        const [schedule, cards] = await Promise.all([
          api.schedule(day === 'besok' ? 'besok' : undefined),
          // Optional: used only to highlight the parent's own stop.
          api.myCards().catch(() => []),
        ]);
        setBuses(schedule.buses);
        setPeriod(schedule.period);
        setScheduleDate(schedule.date);
        setMyStops(new Set(cards.filter((c) => c.status === 'active').map((c) => c.stop_code)));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [day]);

  // scheduleDate ('YYYY-MM-DD') comes back from the server so the label
  // always matches the rotation actually resolved (WIT), not the browser's
  // own clock/timezone.
  const scheduleDateObj = scheduleDate ? new Date(`${scheduleDate}T12:00:00Z`) : null;
  const dayLabel = scheduleDateObj
    ? scheduleDateObj.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';
  // Sabtu (6) / Minggu (0) — bis reguler tidak beroperasi hari libur sekolah.
  // The trip times below are still Senin-Jumat's (scheduleByBus is
  // period-wide, not per-weekday — see backend/routes/meta.js), so on a
  // weekend they'd otherwise read as if service ran normally that day.
  const isWeekend = scheduleDateObj && [0, 6].includes(scheduleDateObj.getUTCDay());

  // Which units serve this parent's stops — highlighted (not reordered
  // across categories, see the grouping below) so they don't have to scan
  // every unit to find theirs.
  const servesMyStop = (bus) => bus.stops.some((s) => myStops.has(s.stop_code));

  // Grouped the way the Transport Team thinks about the rotation — besar
  // Tugas 1-4, then kecil's rotating Tugas 1-3, then any fixed slot (kecil
  // Tugas 5) — rather than alphabetically by plate. A bus the current
  // rotation doesn't resolve (rotation not configured yet) still shows, in
  // its own group at the end, so nothing silently disappears.
  const CATEGORIES = [
    { key: 'besar', label: 'Bis Besar', color: '#13407a', match: (b) => b.bus_group === 'besar' },
    { key: 'kecil', label: 'Bis Kecil', color: '#1a7a4c', match: (b) => b.bus_group === 'kecil' && b.duty_number !== 5 },
    { key: 'tugas5', label: 'Bis Kecil — Tugas 5 (Tetap)', color: '#b5790a', match: (b) => b.bus_group === 'kecil' && b.duty_number === 5 },
    { key: 'lainnya', label: 'Belum Masuk Rotasi', color: '#6b7280', match: (b) => !b.bus_group },
  ];
  const grouped = buses
    ? CATEGORIES.map((cat) => ({
        ...cat,
        buses: buses
          .filter(cat.match)
          .sort((a, b) => (a.duty_number ?? 99) - (b.duty_number ?? 99)
            || (servesMyStop(b) ? 1 : 0) - (servesMyStop(a) ? 1 : 0)),
      })).filter((cat) => cat.buses.length > 0)
    : null;

  return (
    <div className="page">
      <h1>Jadwal Pelayanan Bis</h1>
      <p className="muted">
        Rute dan jam layanan setiap unit bis. Jadwal ini dirotasi setiap minggu,
        sehingga unit yang melayani TPS Anda dapat berbeda dari minggu sebelumnya.
      </p>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={day === 'hari_ini' ? 'on' : ''} onClick={() => setDay('hari_ini')}>Hari Ini</button>
        <button className={day === 'besok' ? 'on' : ''} onClick={() => setDay('besok')}>Lihat Jadwal Besok</button>
      </div>

      <div className="banner info" style={{ fontSize: 16 }}>
        <span style={{ fontSize: 22 }}>📅</span>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' }}>
          <div><strong>{day === 'besok' ? 'Besok' : 'Hari ini'}</strong>{dayLabel}</div>
          {period && <div style={{ textAlign: 'right' }}><strong>Periode rotasi</strong>{period}</div>}
        </div>
      </div>

      {isWeekend && (
        <div className="banner warn">
          <span>🚫</span>
          <div>
            <strong>Libur — tidak ada penjemputan/pengantaran</strong>
            {scheduleDateObj?.getUTCDay() === 6 ? 'Sabtu' : 'Minggu'} adalah hari libur sekolah, bis reguler
            tidak beroperasi. Jadwal di bawah adalah rute hari sekolah (Senin–Jumat) untuk periode rotasi ini.
          </div>
        </div>
      )}

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}
      {!buses && !error && <p className="muted">Memuat…</p>}

      {buses?.length === 0 && (
        <div className="card center">
          <p className="muted">Jadwal belum tersedia. Hubungi Tim Transportasi YPJ.</p>
        </div>
      )}

      {grouped?.map((cat) => (
        <div key={cat.key} style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', margin: '14px 0 8px' }}>
            <span aria-hidden="true" style={{
              width: 12, height: 12, borderRadius: cat.key === 'tugas5' ? '3px' : '50%',
              background: cat.color, display: 'inline-block', flexShrink: 0,
            }} />
            <h2 style={{ margin: 0, fontSize: 15 }}>{cat.label}</h2>
          </div>
          {cat.buses.map((b) => {
            const mine = servesMyStop(b);
            return (
              <div className="card" key={b.bus_id} style={{ borderLeft: `4px solid ${cat.color}` }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                  <span style={{ fontSize: 17 }} aria-hidden="true">🚌</span>
                  <h3 style={{ margin: 0 }}>{b.plate_number}</h3>
                  {b.duty_number && (
                    <span className={`chip chip-duty chip-duty-${
                      b.bus_group === 'kecil' && b.duty_number === 5 ? 'tugas5' : b.bus_group === 'besar' ? 'besar' : 'kecil'
                    }`}>
                      Tugas {b.duty_number}
                    </span>
                  )}
                  {b.label && <span className="chip neutral">{b.label}</span>}
                  {mine && <span className="chip ok">Melayani TPS Anda</span>}
                </div>

            <div className="bus-crew" style={{ paddingLeft: 0, marginBottom: 12 }}>
              <span>
                <span className="k">Driver</span>
                <span className="v">{b.driver_name || <em className="muted">belum diatur</em>}</span>
              </span>
              <span>
                <span className="k">Helper</span>
                <span className="v">{b.helper_name || <em className="muted">belum diatur</em>}</span>
              </span>
            </div>

            {b.stops.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Rute unit ini belum diatur untuk periode ini.
              </p>
            ) : (
              <>
                {/* Trip penjemputan — a 27/30-seat unit can run more than one
                    pickup round (e.g. a second, later round for a different
                    unit like PAUD); each round is its own numbered trip
                    ending back at school. */}
                <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  TRIP PENJEMPUTAN (TPS → SEKOLAH)
                </div>
                {b.pickup_trips.every((t) => t.stops.length === 0) ? (
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>Belum diatur.</p>
                ) : b.pickup_trips.map((t) => (
                  <div key={`pickup-${t.trip_number}`} style={{ marginBottom: 10 }}>
                    {b.pickup_trips.length > 1 && (
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}><strong>Trip {t.trip_number}</strong></div>
                    )}
                    {t.stops.map((s, i) => {
                      const isMine = myStops.has(s.code);
                      return (
                        <SchedRow key={s.bus_stop_id} n={i + 1} isMine={isMine}
                                  label={<><strong>{s.code}</strong> {s.name}</>}
                                  time={s.pickup_time} />
                      );
                    })}
                    <SchedRow school label="🏫 Tiba di Sekolah" time={t.arrival_time} />
                  </div>
                ))}

                {/* Trip pengantaran — each leaving-school round is its own
                    numbered trip; "Kembali ke Sekolah" marks the bus closing
                    one leg before the next one starts. The last leg just
                    says "Trip terakhir hari itu" rather than "Completed" —
                    this page shows the PLANNED schedule with no trip_events
                    check, so a real completion badge here would claim a run
                    already happened before the crew ever opened the app
                    (live progress belongs on the admin dashboard's trip
                    timeline / the crew's own Scan page instead). */}
                <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, marginTop: 10 }}>
                  TRIP PENGANTARAN (SEKOLAH → TPS)
                </div>
                {b.trips.every((t) => t.stops.length === 0) ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>Belum diatur.</p>
                ) : b.trips.map((t, ti) => (
                  <div key={`dropoff-${t.trip_number}`} style={{ marginBottom: 10 }}>
                    {b.trips.length > 1 && (
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}><strong>Trip {t.trip_number}</strong></div>
                    )}
                    <SchedRow school label="🏫 Berangkat dari Sekolah" time={t.departure_time} />
                    {t.stops.map((s, i) => {
                      const isMine = myStops.has(s.code);
                      return (
                        <SchedRow key={s.bus_stop_id} n={i + 1} isMine={isMine}
                                  label={<><strong>{s.code}</strong> {s.name}</>}
                                  time={s.dropoff_time} />
                      );
                    })}
                    {ti < b.trips.length - 1 ? (
                      <div className="muted" style={{ fontSize: 12.5, paddingLeft: 30, marginTop: 2 }}>
                        🏫 Kembali ke Sekolah
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: 12.5, paddingLeft: 30, marginTop: 2 }}>
                        🏫 Trip terakhir hari itu
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="banner info">
        <span>ℹ</span>
        <div>
          <strong>Catatan</strong>
          Batas toleransi penjemputan adalah 5 menit. Jika penjemput belum tiba
          melebihi batas waktu tersebut, bus melanjutkan perjalanan dan siswa
          dibawa kembali ke sekolah. Bis hanya berhenti di halte/TPS yang telah
          ditetapkan.
        </div>
      </div>

      <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
    </div>
  );
}

const TimeCell = ({ value }) => (value
  ? <strong>{value} WIT</strong>
  : <span className="muted" style={{ fontSize: 13 }}>belum diatur</span>);

/** One row of a trip: an ordered TPS stop, or the school bookend at either
 *  end. Mirrors the row shape the admin schedule editor and the crew's own
 *  scanner app already use, so the same route reads the same way everywhere. */
const SchedRow = ({ n, school, isMine, label, time }) => (
  <div className="row" style={{ gap: 8, alignItems: 'center', padding: '4px 4px',
                                background: isMine ? 'rgba(19, 64, 122, .06)' : undefined,
                                borderRadius: 6 }}>
    <span className="muted" style={{ minWidth: 18, textAlign: 'left', fontSize: 11.5 }}>
      {school ? '' : n}
    </span>
    <span style={{ fontSize: 13, flex: 1 }}>
      {label}
      {isMine && <span className="chip ok" style={{ marginLeft: 6 }}>TPS Anda</span>}
    </span>
    <span style={{ fontSize: 13 }}><TimeCell value={time} /></span>
  </div>
);

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api, photoUrl, formatWIT } from '../api';
import TodayBanner from '../components/TodayBanner.jsx';

// Temporary: scan hardware isn't deployed on the buses yet, so camera QR
// scanning is switched off and helpers check the card visually instead.
// Flip back to true once scanners are available — nothing else here changes.
const CAMERA_SCANNING_ENABLED = false;

/**
 * Attendant / driver scanner. Same app, different role — no separate install.
 *
 * The verdict shows the child's photo and name so the attendant can check the
 * face against the card, which is the whole reason the photo became mandatory.
 * Denied boardings are logged just as carefully as allowed ones.
 */
export default function ScannerPage({ user }) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [busId, setBusId] = useState('');
  const [direction, setDirection] = useState('pickup');
  const [run, setRun] = useState(null);        // this unit's stops + departure state
  const [stopId, setStopId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [departing, setDeparting] = useState(null);
  const [lastDeparture, setLastDeparture] = useState(null);
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState(null);
  const [manualConfirming, setManualConfirming] = useState(null);

  const scannerRef = useRef(null);
  const lastPayload = useRef({ value: null, at: 0 });
  const lastRunKey = useRef(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(e.message));
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-pick the unit this crew member is scheduled on today, so a helper
  // doesn't have to hunt through 8 plate numbers (and risk scanning the wrong
  // bus's cards). Matches the logged-in name against the schedule's crew text
  // fields — the same names shown on Jadwal & Rute — falling back to manual
  // selection if nothing matches.
  useEffect(() => {
    if (!meta || busId || !user?.name) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const mine = meta.buses.find((b) =>
      norm(b.helper_name) === norm(user.name) || norm(b.driver_name) === norm(user.name));
    if (mine) setBusId(String(mine.id));
  }, [meta, user, busId]);

  // The attendant's run: which TPS this unit covers, in order, and which have
  // already been marked departed today.
  const loadRun = useCallback(() => {
    if (!busId) { setRun(null); return; }
    api.scanRoute({ bus_id: busId, direction })
      .then((data) => {
        setRun(data);
        // Only jump to the first TPS on a fresh bus/direction pick — not on
        // every reload after "Berangkat", which would yank the attendant back
        // to the start of the run they're already partway through.
        const key = `${busId}|${direction}`;
        if (lastRunKey.current !== key) {
          lastRunKey.current = key;
          setStopId(data.stops[0] ? String(data.stops[0].bus_stop_id) : '');
        }
      })
      .catch((e) => setError(e.message));
  }, [busId, direction]);

  useEffect(() => { loadRun(); }, [loadRun]);

  // A bis besar always runs a single trip (no shuttling back for another
  // round the way a 27/30-seat unit can) — trips_total === 1 is exactly that
  // case, for any unit, not just besar by seat count. Once every stop on
  // that one trip has departed there is no "trip berikutnya" to return for,
  // so close the leg automatically instead of making the crew press
  // "Kembali ke Sekolah" for a return that never happens.
  useEffect(() => {
    if (run?.trips_total === 1 && run.trip_in_progress && run.stops.length > 0
        && run.all_departed_this_leg && !schoolBusy) {
      returnTrip();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  async function startTrip() {
    setSchoolBusy(true);
    setError(null);
    try {
      await api.startTrip(Number(busId), direction);
      loadRun();
    } catch (e) {
      setError(e.message);
    } finally {
      setSchoolBusy(false);
    }
  }

  async function returnTrip() {
    if (!run?.all_departed_this_leg
        && !confirm('Belum semua TPS pada trip ini ditandai berangkat. TPS yang belum berangkat akan '
                   + `ditawarkan lagi pada trip berikutnya. ${direction === 'pickup' ? 'Selesaikan' : 'Kembali ke sekolah'} sekarang?`)) return;
    setSchoolBusy(true);
    setError(null);
    try {
      await api.returnTrip(Number(busId), direction);
      loadRun();
    } catch (e) {
      setError(e.message);
    } finally {
      setSchoolBusy(false);
    }
  }

  async function markDeparture(stop) {
    setDeparting(stop.bus_stop_id);
    setError(null);
    try {
      const res = await api.markDeparture({
        bus_id: Number(busId),
        bus_stop_id: stop.bus_stop_id,
        direction,
      });
      setLastDeparture(res);
      setStopId(String(stop.bus_stop_id));
      loadRun();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeparting(null);
    }
  }

  async function start() {
    setError(null);
    setVerdict(null);
    try {
      const scanner = new Html5Qrcode('reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        onDecoded,
        () => {},   // per-frame decode misses are normal; ignore them
      );
      setScanning(true);
    } catch {
      setError('Kamera tidak dapat diakses. Izinkan akses kamera di browser, '
             + 'lalu muat ulang halaman.');
    }
  }

  async function stop() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (scanner) {
      try { await scanner.stop(); scanner.clear(); } catch { /* already stopped */ }
    }
  }

  async function onDecoded(payload) {
    // The camera fires continuously — ignore the same code within 3 seconds so one
    // child does not generate five scan rows.
    const now = Date.now();
    if (lastPayload.current.value === payload && now - lastPayload.current.at < 3000) return;
    lastPayload.current = { value: payload, at: now };

    try {
      const result = await api.scan({
        payload,
        bus_stop_id: stopId ? Number(stopId) : null,
        direction: 'boarding',
      });
      setVerdict(result);
      // Short vibration on refusal so the attendant notices in a noisy bus.
      if (!result.allowed && navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (err) {
      setError(err.message);
    }
  }

  // Debounced name search — for the "siswa lupa kartu" case, where there's no
  // QR to scan at all. Scoped to the selected bus so the results are only
  // children this unit could plausibly be picking up.
  useEffect(() => {
    const q = manualQuery.trim();
    if (q.length < 2) { setManualResults(null); return; }
    const timer = setTimeout(() => {
      api.scanSearch({ q, bus_id: busId || undefined })
        .then(setManualResults)
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [manualQuery, busId]);

  async function confirmManual(result) {
    setManualConfirming(result.card_id);
    setError(null);
    try {
      const res = await api.scanManual({
        card_id: result.card_id,
        bus_id: busId ? Number(busId) : null,
        bus_stop_id: stopId ? Number(stopId) : null,
        direction: 'boarding',
      });
      setVerdict(res);
      setManualQuery('');
      setManualResults(null);
      if (!res.allowed && navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (err) {
      setError(err.message);
    } finally {
      setManualConfirming(null);
    }
  }

  async function report(category) {
    if (!verdict?.student) return;
    setReporting(true);
    try {
      await api.reportViolation({
        student_id: verdict.student.id,
        category,
        description: `Dilaporkan petugas saat pemindaian di ${verdict.stop?.code || 'bus'}.`,
      });
      alert('Laporan pelanggaran terkirim ke Tim Transportasi.');
      setVerdict(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setReporting(false);
    }
  }

  const tone = verdict
    ? (verdict.allowed ? (verdict.result === 'ok' ? 'success' : 'warn') : 'danger')
    : null;

  const departedCount = run?.stops.filter((s) => s.departed_at).length ?? 0;

  return (
    <div className="page">
      <section className="hero">
        <img className="hero-bus" src="/bus-icon.png" alt="" aria-hidden="true" />
        <div className="hero-greet">SELAMAT BERTUGAS</div>
        <div className="hero-name">{user?.name?.split(' ')[0] || 'Petugas'}</div>
        <div className="hero-sub">
          Pindai Kartu Akses Bis dan catat keberangkatan setiap TPS di satu tempat.
        </div>
        <TodayBanner />
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="n">{meta?.buses?.length ?? 0}</div>
            <div className="k">Unit Aktif</div>
          </div>
          <div className="hero-stat">
            <div className="n">{run?.stops.length ?? 0}</div>
            <div className="k">TPS Rit Ini</div>
          </div>
          <div className="hero-stat">
            <div className="n">{departedCount}</div>
            <div className="k">Sudah Berangkat</div>
          </div>
        </div>
      </section>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button onClick={() => navigate('/checklist')}>Checklist Keselamatan</button>
        <button className="on">Pindai</button>
        <button onClick={() => navigate('/jadwal')}>📅 Jadwal</button>
        <button onClick={() => navigate('/lacak')}>🗺️ Lacak Bus</button>
        {['driver', 'helper'].includes(user?.role) && (
          <button onClick={() => navigate('/event-request')}>🎉 Acara</button>
        )}
      </div>

      <h1>Pemindaian Kartu Bis</h1>
      <p className="muted">
        Pindai kode QR pada Kartu Akses Bis setiap siswa sebelum naik.
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
        <div className="field">
          <label>Rit</label>
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={direction === 'pickup' ? 'on' : ''}
                    onClick={() => setDirection('pickup')}>Penjemputan (pagi)</button>
            <button className={direction === 'dropoff' ? 'on' : ''}
                    onClick={() => setDirection('dropoff')}>Pengantaran (siang)</button>
          </div>
        </div>
        <div className="field">
          <label>TPS saat ini</label>
          <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">— Belum dipilih —</option>
            {(run?.stops || meta?.stops || []).map((s) => (
              <option key={s.bus_stop_id ?? s.id} value={s.bus_stop_id ?? s.id}>
                {s.stop_code ?? s.code} {s.stop_name ?? s.name}
              </option>
            ))}
          </select>
          <div className="hint">Dicatat pada setiap pemindaian untuk laporan harian.</div>
        </div>

        {CAMERA_SCANNING_ENABLED ? (
          <>
            <div id="reader" style={{ width: '100%', borderRadius: 12, overflow: 'hidden' }} />
            <button className="block" style={{ marginTop: 12 }}
                    onClick={scanning ? stop : start}>
              {scanning ? 'Hentikan Kamera' : 'Mulai Pindai'}
            </button>
          </>
        ) : (
          <div className="banner info" style={{ marginTop: 12 }}>
            <span>ℹ️</span>
            <div>
              Pemindaian kamera nonaktif sementara — alat pemindai belum tersedia.
              Periksa Kartu Akses Bis siswa secara langsung sebelum naik.
            </div>
          </div>
        )}
      </div>

      {/* Manual lookup — for when a child forgot their card entirely, so
          there is nothing to scan or check by eye. Searches only this bus's
          own roster; picking a result runs the same eligibility check and
          logging a real scan does, just without a QR code. */}
      <div className="card">
        <h3 style={{ marginBottom: 2 }}>Konfirmasi Manual</h3>
        <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          Siswa lupa membawa Kartu Akses Bis? Cari namanya di sini untuk konfirmasi naik.
        </p>
        <input placeholder="Ketik nama siswa…" value={manualQuery}
               onChange={(e) => setManualQuery(e.target.value)} />
        {!busId && (
          <div className="hint" style={{ marginTop: 6 }}>
            Pilih Unit Bis di atas dahulu agar pencarian hanya menampilkan siswa pada unit ini.
          </div>
        )}
        {manualResults && (
          <div className="col" style={{ marginTop: 10, gap: 8 }}>
            {manualResults.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>Tidak ada siswa dengan nama itu di unit ini.</p>
            )}
            {manualResults.map((r) => (
              <div className="row" key={r.card_id}
                   style={{ alignItems: 'center', gap: 10, border: '1px solid var(--outline)',
                            borderRadius: 10, padding: 8 }}>
                <div className="photo-box" style={{ width: 40, height: 50, flexShrink: 0 }}>
                  {r.photo_file
                    ? <img src={photoUrl(r.photo_file)} alt="" />
                    : <span className="muted" style={{ fontSize: 16 }}>👤</span>}
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {r.grade_label} · {r.stop_code} {r.stop_name}
                  </div>
                </div>
                <button className="ghost" disabled={manualConfirming === r.card_id}
                        onClick={() => confirmManual(r)}>
                  {manualConfirming === r.card_id ? '…' : 'Konfirmasi Naik'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Departure checklist — the no-GPS substitute for live tracking. Tapping
          "Berangkat" as the bus pulls away tells the parents waiting at the next
          TPS that it is on its way. */}
      {run && (
        <div className="card">
          <h3 style={{ marginBottom: 2 }}>Rute {run.bus.plate_number}</h3>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Tekan <strong>Berangkat</strong> saat bis meninggalkan setiap TPS.
            Orang tua di TPS berikutnya akan langsung diberi tahu.
          </p>

          {lastDeparture && (
            <div className="banner success">
              <span>✅</span>
              <div>
                <strong>Berangkat dari {lastDeparture.from.code}</strong>
                {lastDeparture.next
                  ? `${lastDeparture.notified} orang tua di ${lastDeparture.next.code} diberi tahu.`
                  : 'Ini TPS terakhir pada rit ini.'}
              </div>
            </div>
          )}

          {/* stops.length === 0 on a dropoff run just means nothing is left
              to serve today (see all_trips_done below) — not that the unit
              has no route at all, which is the only thing this message
              should mean. */}
          {run.stops.length === 0 && !run.all_trips_done && (
            <p className="muted" style={{ fontSize: 13 }}>
              Unit ini belum punya TPS pada rotasi ini.
            </p>
          )}

          {/* Both directions can now run more than one leg a day (pickup:
              e.g. a nearby TPS served again later, or a separate round for a
              different unit like PAUD; dropoff: a 27/30-seat unit shuttling
              back and forth) — the run list itself is already in the right
              order for whichever leg is current (see GET /scan/route). This
              bookend is the actual start of each leg: pressing "Mulai
              Trip"/"Start Pengantaran" logs it and notifies parents at the
              first stop. A unit running several legs a day reuses this same
              button for trip 2, 3, ... once the previous leg is closed out
              below, and it's gone entirely once nothing is left to serve
              (all_trips_done). */}
          {!run.all_trips_done && (run.stops.length > 0 || run.trip_in_progress) && (
            <div className="run-stop run-stop-school">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>🏫 Sekolah</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {direction === 'dropoff' ? 'Titik awal pengantaran' : 'Titik awal penjemputan'}
                  {run.trip_number > 1 && ` · Trip ${run.trip_number}`}
                  {run.trip_scheduled_time && ` · dijadwalkan ${run.trip_scheduled_time}`}
                  {run.school_event && ` · dimulai ${formatWIT(run.school_event.created_at)}`}
                </div>
              </div>
              {run.trip_in_progress
                ? <span className="chip ok">dimulai</span>
                : (
                  <button className="ghost" disabled={schoolBusy} onClick={startTrip}>
                    {schoolBusy ? '…' : run.trip_number > 1 ? `Mulai Trip ${run.trip_number}`
                      : (direction === 'dropoff' ? 'Start Pengantaran' : 'Mulai Penjemputan')}
                  </button>
                )}
            </div>
          )}

          {/* The Berangkat buttons below stay locked until the trip above is
              started — without this reminder that's easy to miss when the
              school bookend above has scrolled out of view, and it looks
              like the buttons just aren't working. */}
          {run.stops.length > 0 && !run.trip_in_progress && !run.all_trips_done && (
            <div className="banner warn">
              <span>⚠</span>
              <div>
                Tekan <strong>{run.trip_number > 1 ? `Mulai Trip ${run.trip_number}`
                  : (direction === 'dropoff' ? 'Start Pengantaran' : 'Mulai Penjemputan')}</strong> di
                atas dahulu — tombol Berangkat di bawah baru aktif setelah itu.
              </div>
            </div>
          )}

          {run.stops.map((s) => (
            <div className="run-stop" key={s.bus_stop_id}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {s.stop_code} <span style={{ fontWeight: 400 }}>{s.stop_name}</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {(direction === 'dropoff' ? s.dropoff_time_current : s.pickup_time_current) || 'jam belum diatur'}
                  {' · '}{s.students} siswa
                  {s.departed_at && ` · berangkat ${formatWIT(s.departed_at)}`}
                </div>
              </div>
              {s.departed_at
                ? <span className="chip ok">berangkat</span>
                : (
                  <button className="ghost" disabled={departing === s.bus_stop_id || !run.trip_in_progress}
                          onClick={() => markDeparture(s)}>
                    {departing === s.bus_stop_id ? '…' : 'Berangkat'}
                  </button>
                )}
            </div>
          ))}

          {/* "Kembali ke Sekolah"/"Selesai Trip" sits at the bottom of the
              current leg and is available the whole time the leg is running
              — not gated on every TPS being departed, so the crew can close
              it out (and start the next leg) whenever they actually do, and
              anything skipped is simply offered again next leg (see GET
              /route). A single-trip unit (bis besar) has no next leg to
              offer a skipped stop on, and once every stop has departed the
              effect above closes it automatically — so once that's underway
              this just shows "Menyelesaikan…" instead of a button that
              would otherwise flash then vanish. */}
          {run.trip_in_progress && !(run.trips_total === 1 && run.all_departed_this_leg) && (
            <div className="run-stop run-stop-school">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>🏫 Sekolah</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {run.all_departed_this_leg
                    ? 'Semua TPS trip ini sudah berangkat'
                    : run.trips_total === 1
                      ? `TPS yang belum berangkat tidak akan dilayani lagi hari ini bila rit ${direction === 'dropoff' ? 'diakhiri' : 'diselesaikan'} sekarang`
                      : `${direction === 'dropoff' ? 'Kembali' : 'Selesai'} kapan saja — TPS yang belum berangkat ditawarkan lagi di trip berikutnya`}
                </div>
              </div>
              <button className="ghost" disabled={schoolBusy} onClick={returnTrip}>
                {schoolBusy ? '…' : (direction === 'dropoff' ? 'Kembali ke Sekolah' : 'Selesai Trip')}
              </button>
            </div>
          )}

          {run.trip_in_progress && run.trips_total === 1 && run.all_departed_this_leg && (
            <div className="run-stop run-stop-school">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>🏫 Sekolah</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Semua TPS sudah berangkat — menutup rit hari ini</div>
              </div>
              <span className="chip ok">Menyelesaikan…</span>
            </div>
          )}

          {run.all_trips_done && (
            <div className="run-stop run-stop-school">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>🏫 Sekolah</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {direction === 'dropoff' ? 'Semua TPS sudah selesai diantar hari ini' : 'Semua TPS sudah selesai dijemput hari ini'}
                </div>
              </div>
              <span className="chip ok">Completed</span>
            </div>
          )}
        </div>
      )}

      {/* Read-only preview of every other scheduled trip today (e.g. Trip 2's
          route while Trip 1 is still running) — the crew only interacts with
          the current trip above, but seeing the rest of the plan ahead of
          time is exactly why this got asked for. */}
      {run && run.all_trips?.filter((t) => !t.is_current).map((t) => (
        <div className="card" key={t.trip_number}>
          <h3 style={{ marginBottom: 2 }}>
            Trip {t.trip_number}
            {(direction === 'dropoff' ? t.dropoff_time : t.pickup_time) && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                {' '}· dijadwalkan {direction === 'dropoff' ? t.dropoff_time : t.pickup_time}
              </span>
            )}
          </h3>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            {t.trip_number < run.trip_number ? 'Sudah selesai hari ini.' : 'Rute terjadwal — belum dimulai.'}
          </p>
          {t.stops.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Trip ini belum punya TPS.</p>
          ) : (
            t.stops.map((s) => (
              <div className="run-stop" key={s.bus_stop_id}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {s.stop_code} <span style={{ fontWeight: 400 }}>{s.stop_name}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {(direction === 'dropoff' ? s.dropoff_time : s.pickup_time) || 'jam belum diatur'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ))}

      {verdict && (
        <div className={`card`} style={{
          borderColor: `var(--${tone === 'success' ? 'success' : tone === 'warn' ? 'warning' : 'danger'})`,
          borderWidth: 2,
        }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="photo-box" style={{ width: 88, height: 108 }}>
              {verdict.card?.photo_file
                ? <img src={photoUrl(verdict.card.photo_file)} alt="" />
                : <span className="muted" style={{ fontSize: 26 }}>👤</span>}
            </div>
            <div className="grow">
              <h2 style={{
                color: `var(--${tone === 'success' ? 'success' : tone === 'warn' ? 'warning' : 'danger'})`,
              }}>
                {verdict.allowed ? 'IZINKAN' : 'TOLAK'}
                {verdict.manual && <span className="chip neutral" style={{ marginLeft: 8 }}>Manual</span>}
              </h2>
              <div>{verdict.message}</div>
              {verdict.student && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>{verdict.student.full_name}</div>
                  <div className="muted">
                    {verdict.student.grade_label}
                    {verdict.stop && ` · ${verdict.stop.code} ${verdict.stop.name}`}
                  </div>
                  <div className="muted">{verdict.card.transit_id} · {verdict.card.card_no}</div>
                  <a className="link" href={`/kartu/${verdict.card.id}`} target="_blank" rel="noopener noreferrer">
                    🎫 Lihat Kartu Lengkap
                  </a>
                </div>
              )}
              {verdict.card?.status_reason && (
                <div className="muted" style={{ marginTop: 6 }}>
                  Catatan: {verdict.card.status_reason}
                </div>
              )}
            </div>
          </div>

          {verdict.student && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                ⚠ Laporkan pelanggaran
              </summary>
              <p className="muted" style={{ marginTop: 8 }}>
                Laporan dikirim ke Tim Transportasi. Penangguhan atau pencabutan
                hak hanya dapat diputuskan oleh Tim Transportasi.
              </p>
              <div className="col">
                {(meta?.violation_categories || []).map((c) => (
                  <button key={c} className="ghost" disabled={reporting}
                          onClick={() => report(c)}>
                    {VIOLATION_LABELS[c] || c}
                  </button>
                ))}
              </div>
            </details>
          )}

          <button className="ghost block" style={{ marginTop: 12 }}
                  onClick={() => setVerdict(null)}>
            Pindai berikutnya
          </button>
        </div>
      )}
    </div>
  );
}

// The ten dangerous behaviours from section II of the rules document.
const VIOLATION_LABELS = {
  standing_or_walking_while_moving: 'Berdiri/berjalan saat bus berjalan',
  shouting_or_disturbance:          'Berteriak atau membuat keributan',
  pushing_or_fighting:              'Mendorong atau berkelahi',
  throwing_objects:                 'Melempar barang di dalam bus',
  bullying_or_abusive_language:     'Bullying / berbicara kasar / provokasi',
  eating_or_drinking_onboard:       'Makan dan minum di dalam bus',
  distracting_the_driver:           'Mengganggu sopir saat mengemudi',
  disobeying_attendant_instructions:'Tidak mematuhi instruksi petugas',
  vandalising_bus_facilities:       'Sengaja merusak fasilitas bus',
  boarding_without_valid_card:      'Naik tanpa kartu yang berlaku',
  other:                            'Lainnya',
};

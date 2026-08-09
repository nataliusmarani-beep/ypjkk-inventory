import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api, photoUrl, signatureUrl, formatWIT, todayWIT } from '../api';
import { gradeLabel } from './ParentHomePage.jsx';
import EventRequestsSection from '../components/EventRequests.jsx';
import { GRADES, StudentsByGradeCard, SchoolCategoryCard } from '../components/GradeCharts.jsx';

/**
 * Module 2 — Transport Team verification portal.
 *
 * The queue carries the two signals the old spreadsheet could not produce: which
 * TPS is already at capacity, and which submissions look like the same child sent
 * twice (rows 2 and 3 of the 2024/25 export were exactly that).
 */
// The "Semua" tab lists every status together, including dead ends like
// 'cancelled' — without a visible label, a cancelled-then-resubmitted child
// (e.g. Injil Ibrani Korey) looks like two copies of the same live entry.
const APP_STATUS_CHIP = {
  submitted:          { label: 'Menunggu',        chip: 'warn' },
  under_review:       { label: 'Ditinjau',        chip: 'warn' },
  revision_requested: { label: 'Perlu Perbaikan', chip: 'danger' },
  approved:           { label: 'Disetujui',       chip: 'ok' },
  rejected:           { label: 'Ditolak',         chip: 'danger' },
  cancelled:          { label: 'Dibatalkan',      chip: 'neutral' },
};

export default function AdminQueuePage({ user }) {
  const navigate = useNavigate();
  const canManage = !['leader', 'admin'].includes(user?.role);
  const [tab, setTab] = useState('submitted');
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ stop_id: '', grade: '', q: '' });
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([
        api.adminApplications({ status: tab === 'all' ? '' : tab, ...filters }),
        api.adminStats(),
      ]);
      setRows(list);
      setStats(s);
    } catch (err) {
      setError(err.message);
    }
  }, [tab, filters]);

  useEffect(() => { load(); }, [load]);

  async function exportXlsx() {
    try {
      const data = await api.adminExport();
      const sheet = XLSX.utils.json_to_sheet(data);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Pengguna Bis');
      XLSX.writeFile(book, `Pengguna Bis YPJ KK ${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      alert(err.message);
    }
  }

  const a = stats?.applications || {};

  return (
    <div className="page wide">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className="on">Dashboard</button>
        <button onClick={() => navigate('/admin/akun')}>Akun</button>
        {canManage && <button onClick={() => navigate('/admin/backup')}>Backup</button>}
      </div>

      <section className="admin-hero">
        <img className="hero-bus" src="/bus-icon.png" alt="" aria-hidden="true" />
        <div className="admin-hero-top">
          <div className="grow">
            <h1>Verifikasi Pengguna Bis</h1>
            <div className="sub">
              Tim Transportasi YPJ Kuala Kencana
              {stats?.routes?.length ? ` · ${stats.routes.length} rute aktif` : ''}
            </div>
          </div>
          <button className="ghost" onClick={exportXlsx}>Export XLSX</button>
        </div>
      </section>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <TodayCard />

      <div className="stat-row">
        {/* Labels kept to one word where possible: six tiles on one row means a
            two-line label makes the whole strip look ragged. */}
        <Stat n={a.submitted || 0}          k="Menunggu"    tone="warn"   ico="⏳" />
        <Stat n={a.under_review || 0}       k="Ditinjau"    tone="purple" ico="🔍" />
        <Stat n={a.approved || 0}           k="Disetujui"   tone="ok"     ico="✅" />
        <Stat n={a.rejected || 0}           k="Ditolak"     tone="danger" ico="⛔" />
        <Stat n={stats?.cards?.active || 0} k="Kartu Aktif" tone="info"   ico="🎫" />
        <Stat n={stats?.scans_today ?? 0}   k="Scan Hari Ini" tone="cyan" ico="📷" />
      </div>

      {/* Reference-style widget row: today's departures split by fleet size
          (this app's no-GPS substitute for a live map — see trip_events in
          db.js), and the busiest TPS at a glance. */}
      <div className="dash-grid">
        <TripTimelineCard />
        <TopStopsCard stops={stats?.stops} />
        <ApplicationStatusDonut applications={a} />
      </div>

      {stats && (
        <div className="dash-grid grade-charts-grid">
          <StudentsByGradeCard byGrade={stats.by_grade} />
          <SchoolCategoryCard byGrade={stats.by_grade} />
        </div>
      )}

      {/* Stop load: makes the TPS#17 / TPS#3 / TPS#1 concentration obvious at a
          glance, next to the stops that drew a single request all year. */}
      {stats && <StopCapacityPanel stops={stats.stops} onChanged={load} canManage={canManage} />}

      <SchedulePanel canManage={canManage} />

      <DutyRotationPanel canManage={canManage} />

      <RoutesPanel routes={stats?.routes} onChanged={load} canManage={canManage} />

      <EventRequestsSection user={user} />

      {canManage && <BroadcastPanel />}

      <ChatHubPanel user={user} />

      <GroupChatPanel user={user} />

      {canManage && <EditRequestsPanel />}

      <ComplaintsPanel />

      <SafetyChecklistPanel stats={stats} />

      <div className="seg">
        {[
          ['submitted', 'Menunggu'],
          ['under_review', 'Ditinjau'],
          ['approved', 'Disetujui'],
          ['rejected', 'Ditolak'],
          ['revision_requested', 'Perlu Perbaikan'],
          ['all', 'Semua'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Cari nama siswa / orang tua / Nomor ID / no. pengajuan"
               value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
               style={{ maxWidth: 380 }} />
        <select value={filters.stop_id} style={{ maxWidth: 240 }}
                onChange={(e) => setFilters({ ...filters, stop_id: e.target.value })}>
          <option value="">Semua TPS</option>
          {stats?.stops.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
        </select>
        <select value={filters.grade} style={{ maxWidth: 160 }}
                onChange={(e) => setFilters({ ...filters, grade: e.target.value })}>
          <option value="">Semua kelas</option>
          {(stats ? Object.keys(GRADES) : []).map((g) => (
            <option key={g} value={g}>{gradeLabel(g)}</option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Siswa</th><th>Kelas</th><th>Orang Tua</th><th>Kategori Orang Tua</th>
                <th>TPS diminta</th><th>Diajukan</th><th />
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="muted">Memuat…</td></tr>}
              {rows?.length === 0 && (
                <tr><td colSpan={7} className="muted">Tidak ada pengajuan pada tampilan ini.</td></tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="photo-box" style={{ width: 34, height: 42 }}>
                        {r.photo_file && <img src={photoUrl(r.photo_file)} alt="" />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.student_name}</div>
                        <div className="muted">{r.application_no}</div>
                        {tab === 'all' && APP_STATUS_CHIP[r.status] && (
                          <span className={`chip ${APP_STATUS_CHIP[r.status].chip}`}>
                            {APP_STATUS_CHIP[r.status].label}
                          </span>
                        )}
                        {r.possible_duplicate && <span className="chip warn">⚠ kemungkinan duplikat</span>}
                      </div>
                    </div>
                  </td>
                  <td>{r.grade_label}</td>
                  <td>
                    {r.parent_name}
                    <div className="muted">{r.employee_id} · {r.phone_primary}</div>
                  </td>
                  <td>{r.parent_category_label}</td>
                  <td>
                    {r.requested_stop_code}
                    <div className="muted">
                      {r.stop_load
                        ? `${r.stop_load.issued}/${r.stop_load.capacity}${r.stop_load.full ? ' ⚠ penuh' : ''}`
                        : ''}
                    </div>
                  </td>
                  <td className="muted">{shortDate(r.submitted_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="ghost" onClick={() => setOpenId(r.id)}>Buka</button>
                      {waLink(r.phone_primary) && (
                        <a className="wa-btn"
                           href={waLink(r.phone_primary, `Halo ${r.parent_name}, terkait pengajuan bis sekolah ${r.student_name} (${r.application_no})...`)}
                           target="_blank" rel="noreferrer" title="Kirim WhatsApp ke orang tua">
                          💬
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <ReviewDrawer id={openId} canManage={canManage} isSuperAdmin={user?.role === 'super_admin'}
                      onClose={() => setOpenId(null)}
                      onDone={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
}

/** Right-hand review panel: photo, signature, eligibility, assignment, decision. */
function ReviewDrawer({ id, canManage, isSuperAdmin, onClose, onDone }) {
  const [app, setApp] = useState(null);
  const [assign, setAssign] = useState({ route_id: '', stop_id: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reminded, setReminded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await api.adminApplication(id);
        setApp(detail);
        setAssign({
          route_id: detail.assigned_route_id || suggestRoute(detail) || '',
          stop_id:  detail.assigned_stop_id || detail.requested_stop_id || '',
        });
        if (detail.status === 'submitted') api.claimApplication(id).catch(() => {});
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [id]);

  async function decide(decision) {
    if ((decision === 'reject' || decision === 'request_revision') && !reason.trim()) {
      setError(decision === 'reject'
        ? 'Alasan penolakan wajib diisi — alasan ini dikirim ke orang tua.'
        : 'Catatan perbaikan wajib diisi.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decideApplication(id, {
        decision,
        route_id: assign.route_id ? Number(assign.route_id) : null,
        stop_id:  assign.stop_id ? Number(assign.stop_id) : null,
        reason,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remind() {
    setBusy(true);
    setError(null);
    try {
      await api.remindApplication(id);
      setReminded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function undoRevision() {
    if (!confirm(
      'Batalkan permintaan perbaikan ini? Pengajuan akan kembali ke antrean '
      + '"Menunggu" untuk ditinjau ulang, dan orang tua akan diberi tahu tidak perlu berbuat apa-apa.'
    )) return;
    setBusy(true);
    setError(null);
    try {
      await api.undoRevision(id);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function deleteStudent() {
    if (!app) return;
    if (!confirm(
      `Hapus ${app.student_name} beserta seluruh pengajuan dan kartu yang terkait? `
      + 'Tindakan ini tidak dapat dibatalkan.'
    )) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteStudent(app.student_id);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const stopLoad = app?.stops.find((s) => s.id === Number(assign.stop_id));
  const routeLoad = app?.routes.find((r) => r.id === Number(assign.route_id));

  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        {!app && <p className="muted">Memuat…</p>}
        {app && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="grow">
                <h2>{app.student_name}</h2>
                <div className="muted">{app.application_no} · {app.grade_label}</div>
              </div>
              {app.card && (
                <a className="ghost" href={`/kartu/${app.card.id}`} target="_blank" rel="noopener noreferrer">
                  🎫 Lihat Kartu
                </a>
              )}
              {canManage && (
                <button className="ghost" style={{ color: 'var(--danger)' }}
                        disabled={busy} onClick={deleteStudent}>
                  Hapus Siswa
                </button>
              )}
              <button className="ghost" onClick={onClose}>Tutup</button>
            </div>

            {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

            <div className="card">
              <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <div className="micro">FOTO SISWA</div>
                  <div className="photo-box" style={{ width: 140, height: 172, marginTop: 4 }}>
                    {app.photo_file
                      ? <img src={photoUrl(app.photo_file)} alt="Foto siswa" />
                      : <span className="muted">tidak ada</span>}
                  </div>
                </div>
                <div className="grow">
                  <div className="micro">TANDA TANGAN ORANG TUA</div>
                  <div style={{
                    border: '1px solid var(--outline)', borderRadius: 12,
                    background: '#fff', height: 110, marginTop: 4, overflow: 'hidden',
                  }}>
                    {app.consent?.signature_file && (
                      <img src={signatureUrl(app.consent.signature_file)} alt="Tanda tangan"
                           style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    )}
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {app.consent
                      ? <>
                          {app.consent.signer_name} · {app.consent.signed_at} WIT<br />
                          Peraturan v{app.consent.rules_version} · IP {app.consent.ip_address || '—'}<br />
                          <span className="chip ok">☑ menyetujui pencabutan hak</span>
                        </>
                      : <span className="chip danger">tidak ada catatan persetujuan</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Kelayakan</h3>
              {/* 'Other' is the catch-all bucket (explicitly not TNI/Polri or a
                  government official) and needs a closer manual look; the five
                  named categories are self-explanatory. */}
              <Check ok={app.parent_category !== 'other'}
                     text={`Kategori Orang Tua: ${app.parent_category_label}`
                           + `${app.department ? ` · ${app.department}` : ''}`} />
              <Check ok={!!app.employee_id} text={`Nomor ID: ${app.employee_id || '—'}`} />
              <Check ok={!!app.photo_file} text="Foto siswa terlampir" />
              <Check ok={!!app.consent} text="Persetujuan peraturan & tanda tangan lengkap" />
              <Check ok={!stopLoad || stopLoad.issued_active < stopLoad.seat_capacity}
                     text={stopLoad
                       ? `${stopLoad.code}: ${stopLoad.issued_active}/${stopLoad.seat_capacity} kursi`
                       : 'Kapasitas TPS'} />
              <div className="muted" style={{ marginTop: 10 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span>
                    {app.parent_name} · {app.phone_primary}
                    {app.phone_alternate && ` / ${app.phone_alternate}`}
                    {app.phone_alternate_owner && ` (${app.phone_alternate_owner})`}
                  </span>
                  {waLink(app.phone_primary) && (
                    <a className="wa-btn" style={{ width: 40, height: 40 }}
                       href={waLink(app.phone_primary, `Halo ${app.parent_name}, terkait pengajuan bis sekolah ${app.student_name} (${app.application_no})...`)}
                       target="_blank" rel="noreferrer" title="Kirim WhatsApp ke orang tua">
                      💬
                    </a>
                  )}
                </div>
                {app.parent_email}<br />
                {app.home_address}
              </div>
              {app.notes_for_admin && (
                <div className="banner info" style={{ marginTop: 12, marginBottom: 0 }}>
                  <span>✎</span><div><strong>Catatan orang tua</strong>{app.notes_for_admin}</div>
                </div>
              )}
            </div>

            <div className="card">
              <h3>Penugasan</h3>
              <div className="field">
                <label>Rute</label>
                <select value={assign.route_id}
                        onChange={(e) => setAssign({ ...assign, route_id: e.target.value })}>
                  <option value="">— Pilih rute —</option>
                  {app.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name} ({r.issued_active}/{r.seat_capacity})
                    </option>
                  ))}
                </select>
                {routeLoad && routeLoad.issued_active >= routeLoad.seat_capacity && (
                  <div className="error">Rute ini sudah penuh.</div>
                )}
              </div>
              <div className="field">
                <label>Titik Penjemputan</label>
                <select value={assign.stop_id}
                        onChange={(e) => setAssign({ ...assign, stop_id: e.target.value })}>
                  {app.stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} {s.name} ({s.issued_active}/{s.seat_capacity})
                    </option>
                  ))}
                </select>
                <div className="hint">
                  Diminta orang tua: {app.requested_stop_code} {app.requested_stop_name}
                </div>
              </div>
            </div>

            {app.status === 'revision_requested' && (
              <div className="card">
                <h3>Perlu Perbaikan</h3>
                <p className="muted">
                  Menunggu orang tua memperbaiki dan mengirim ulang pengajuan ini.
                  Catatan yang sudah dikirim: <em>{app.revision_note}</em>
                </p>
                {reminded && <div className="banner success"><span>✓</span><div>Pengingat terkirim.</div></div>}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="ghost" disabled={busy} onClick={remind}>
                    {busy ? 'Mengirim…' : 'Kirim Pengingat ke Orang Tua'}
                  </button>
                  {isSuperAdmin && (
                    <button className="ghost" style={{ color: 'var(--danger)' }}
                            disabled={busy} onClick={undoRevision}>
                      Batalkan Permintaan Perbaikan
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <h3>Keputusan</h3>
              <div className="field">
                <label>Alasan / catatan</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)}
                          placeholder="Wajib untuk penolakan dan permintaan perbaikan — teks ini dikirim ke orang tua." />
              </div>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <button className="success grow" disabled={busy || !assign.route_id}
                        onClick={() => decide('approve')}>
                  Setujui &amp; Terbitkan Kartu
                </button>
                <button className="ghost" disabled={busy}
                        onClick={() => decide('request_revision')}>
                  Minta Perbaikan
                </button>
                <button className="danger" disabled={busy} onClick={() => decide('reject')}>
                  Tolak
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Jadwal & Rute per Bis — the weekly rolling roster.
 *
 * Each unit gets its own TPS list because the Transport Team rotates coverage
 * every week: the admin ticks the stops a bus covers this rotation and sets the
 * pickup/dropoff time at each. Saving replaces that unit's whole list, which is
 * what a roll actually is.
 */
/**
 * Bus fleet identity/crew only — plate, label, seat count, driver/helper,
 * and the pickup-round arrival bookend. TPS/route/trips used to be edited
 * per-bus here too, but that overlapped with (and got silently overwritten
 * by) the "Rotasi Tugas Bis" panel below, which is now the single place
 * that owns a unit's actual schedule — see DutyRotationPanel.
 */
function SchedulePanel({ canManage }) {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [edits, setEdits] = useState({});      // bus_id -> draft
  const [busy, setBusy] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.adminSchedule()
      .then((d) => {
        setData(d);
        setEdits({});
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Driver/Helper dropdown options — same accounts created on the Akun page.
  useEffect(() => {
    api.adminStaff().then(setStaff).catch(() => {});
  }, []);

  const drivers = staff.filter((s) => s.role === 'driver' && s.is_active);
  const helpers = staff.filter((s) => s.role === 'helper' && s.is_active);

  /** Working copy of one unit: local draft if touched, else server state. */
  const draftFor = (bus) => edits[bus.bus_id] ?? {
    plate_number: bus.plate_number || '',
    label: bus.label || '',
    seat_capacity: bus.seat_capacity ? String(bus.seat_capacity) : '',
    driver_name: bus.driver_name || '',
    helper_name: bus.helper_name || '',
  };

  function update(bus, patch) {
    setSaved(null);
    setEdits((prev) => ({ ...prev, [bus.bus_id]: { ...draftFor(bus), ...patch } }));
  }

  async function saveBus(bus) {
    setBusy(bus.bus_id);
    setError(null);
    try {
      const d = draftFor(bus);
      await api.saveBusSchedule(bus.bus_id, {
        plate_number: d.plate_number,
        label: d.label,
        seat_capacity: d.seat_capacity || 0,
        driver_name: d.driver_name,
        helper_name: d.helper_name,
      });
      setSaved(bus.bus_id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function addUnit() {
    const plate = prompt('No. Bus unit baru (contoh: PA 7250 XY)');
    if (!plate?.trim()) return;
    try {
      await api.addBus({ plate_number: plate.trim() });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeUnit(bus) {
    if (!confirm(`Hapus unit ${bus.plate_number} dari armada?`)) return;
    try {
      await api.removeBus(bus.bus_id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !data) {
    return <div className="banner danger"><span>⚠</span><div>{error}</div></div>;
  }
  if (!data) return null;

  return (
    <details className="card" open={false}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🚌</span>
        <span className="grow">
          Unit Bis
          <div className="sub">{data.buses.length} unit</div>
        </span>
      </summary>

      {error && (
        <div className="banner danger" style={{ marginTop: 12 }}>
          <span>⚠</span><div>{error}</div>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        Data identitas dan kru tiap unit — plat, nama panggilan, jumlah seat,
        driver/helper. TPS dan rute diatur per nomor tugas di panel "Rotasi
        Tugas Bis" di bawah, bukan di sini.
        {!canManage && ' Peran Leader hanya dapat melihat data ini.'}
      </p>

      {/* `disabled` on a fieldset cascades to every input/select/button inside
          it — the one-line way to make this whole editor read-only for
          Leader without threading `canManage` through every handler below. */}
      <fieldset disabled={!canManage} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
        {canManage && <button className="ghost" onClick={addUnit}>+ Tambah Unit</button>}
      </div>

      {data.buses.length === 0 && (
        <p className="muted">Belum ada unit bis. Tekan "+ Tambah Unit".</p>
      )}

      {data.buses.map((bus) => {
        const d = draftFor(bus);
        const dirty = !!edits[bus.bus_id];
        return (
          <div className="bus-editor" key={bus.bus_id}>
            <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong className="grow">{bus.plate_number}</strong>
              {saved === bus.bus_id && !dirty && <span className="chip ok">tersimpan</span>}
              <button className={dirty ? '' : 'ghost'} disabled={busy === bus.bus_id || !dirty}
                      onClick={() => saveBus(bus)}>
                {busy === bus.bus_id ? 'Menyimpan…' : 'Simpan Unit Ini'}
              </button>
              <button className="ghost fleet-del" title="Hapus unit"
                      onClick={() => removeUnit(bus)}>✕</button>
            </div>

            <div className="fleet-row" style={{ marginBottom: 12 }}>
              <label>
                <span className="lbl">No. Bus</span>
                <input type="text" value={d.plate_number}
                       onChange={(e) => update(bus, { plate_number: e.target.value })} />
              </label>
              <label>
                <span className="lbl">Keterangan</span>
                <input type="text" placeholder="Rit 1"
                       value={d.label}
                       onChange={(e) => update(bus, { label: e.target.value })} />
              </label>
              <label>
                <span className="lbl">Jumlah Seat</span>
                <select value={d.seat_capacity}
                        onChange={(e) => update(bus, { seat_capacity: e.target.value })}>
                  <option value="">— Pilih Jumlah Seat —</option>
                  {d.seat_capacity && !SEAT_OPTIONS.includes(Number(d.seat_capacity)) && (
                    <option value={d.seat_capacity}>{d.seat_capacity} seat</option>
                  )}
                  {SEAT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n} seat</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="lbl">Nama Driver</span>
                <select value={d.driver_name}
                        onChange={(e) => update(bus, { driver_name: e.target.value })}>
                  <option value="">— Pilih Driver —</option>
                  {d.driver_name && !drivers.some((s) => s.name === d.driver_name) && (
                    <option value={d.driver_name}>{d.driver_name}</option>
                  )}
                  {drivers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </label>
              <label>
                <span className="lbl">Nama Helper</span>
                <select value={d.helper_name}
                        onChange={(e) => update(bus, { helper_name: e.target.value })}>
                  <option value="">— Pilih Helper —</option>
                  {d.helper_name && !helpers.some((s) => s.name === d.helper_name) && (
                    <option value={d.helper_name}>{d.helper_name}</option>
                  )}
                  {helpers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      </fieldset>
    </details>
  );
}

/**
 * Parent ↔ Transport Team chat, staff side.
 *
 * Conversations with unanswered parent messages float to the top, so a busy
 * morning does not bury someone who asked a question an hour ago. Polled while
 * the panel is open.
 */
/** Today's date/weekday plus the currently published rotation label. */
function TodayCard() {
  const [period, setPeriod] = useState(null);

  useEffect(() => {
    api.adminSchedule().then((d) => setPeriod(d.period)).catch(() => {});
  }, []);

  const now = new Date();
  const dayName = now.toLocaleDateString('id-ID', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="today-bar">
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="today-bar-ico" aria-hidden="true">📆</span>
        <span>
          <div className="today-bar-day">{dayName}</div>
          <div className="today-bar-date">{dateStr}</div>
        </span>
      </div>
      <div className="today-bar-period">
        {period ? (
          <>
            <div className="today-bar-period-label">Periode rotasi aktif</div>
            <div className="today-bar-period-value">{period}</div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Periode rotasi belum diatur.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Today's recorded departures — the dashboard's substitute for a live map.
 * This app deliberately has no GPS (see the bus_route_stops comment in
 * backend/db.js): a rotating list of "bus left this TPS at this time" is the
 * closest real signal to "where are the buses" that the data actually supports.
 */
/** A trip_events row's school-level events (started/finished) have no
 *  bus_stop_id — they need their own wording instead of the blank
 *  "berangkat dari" a per-stop departure gets. */
function tripEventLabel(e) {
  if (e.event === 'departed') return `berangkat dari ${e.stop_code} ${e.stop_name}`;
  if (e.event === 'started') return e.direction === 'dropoff' ? 'mulai pengantaran dari sekolah' : 'mulai penjemputan';
  if (e.event === 'finished') {
    return e.direction === 'dropoff' ? 'kembali ke sekolah' : 'tiba di sekolah — penjemputan selesai';
  }
  return e.event;
}

function TripTimelineCard() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [busGroup, setBusGroup] = useState('besar');

  useEffect(() => {
    const load = () => api.adminTripEvents().then(setEvents).catch((e) => setError(e.message));
    load();
    // Same substitute-for-a-live-map role as the rest of this card — stale
    // until someone reloads the whole dashboard isn't good enough while a
    // run is actually happening, so this polls like the chat panels do.
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, []);

  const filtered = (events || []).filter((e) => (e.bus_group || 'besar') === busGroup);

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="ico" aria-hidden="true">🚌</span>
        <span className="grow">
          <div className="dash-card-title">Perjalanan Hari Ini</div>
          <div className="muted" style={{ fontSize: 12 }}>Keberangkatan yang tercatat petugas</div>
        </span>
      </div>
      <div className="seg trip-bus-seg">
        <button className={busGroup === 'besar' ? 'on' : ''} onClick={() => setBusGroup('besar')}>Bis Besar</button>
        <button className={busGroup === 'kecil' ? 'on' : ''} onClick={() => setBusGroup('kecil')}>Bis Kecil</button>
      </div>
      <div className="dash-card-body">
        {error && <p className="muted" style={{ fontSize: 13 }}>{error}</p>}
        {!events && !error && <p className="muted" style={{ fontSize: 13 }}>Memuat…</p>}
        {events && filtered.length === 0 && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Belum ada keberangkatan {busGroup === 'besar' ? 'bis besar' : 'bis kecil'} tercatat hari ini.
          </p>
        )}
        {filtered.length > 0 && (
          <ul className="trip-timeline">
            {filtered.map((e) => (
              <li key={e.id}>
                <span className="dot" aria-hidden="true" />
                <div>
                  <strong>{e.plate_number}</strong>{e.label ? ` (${e.label})` : ''}
                  {' '}{tripEventLabel(e)}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {e.direction === 'dropoff' ? 'Pengantaran' : 'Penjemputan'} · {timeOnly(e.created_at)} WIT
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The busiest TPS by total passengers (not by capacity %), so the
 * concentration is visible without opening the full 19-row capacity table
 * below. */
function TopStopsCard({ stops }) {
  const top = [...(stops || [])]
    .filter((s) => s.seat_capacity > 0)
    .map((s) => ({ ...s, pct: Math.min(100, (s.issued_active / s.seat_capacity) * 100) }))
    .sort((a, b) => b.issued_active - a.issued_active)
    .slice(0, 7);

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="ico" aria-hidden="true">📍</span>
        <span className="grow">
          <div className="dash-card-title">TPS Terpadat</div>
          <div className="muted" style={{ fontSize: 12 }}>Berdasarkan kapasitas terpakai</div>
        </span>
      </div>
      <div className="dash-card-body" style={{ display: 'grid', gap: 10 }}>
        {top.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Belum ada data.</p>}
        {top.map((s) => (
          <div key={s.id}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>{s.code} {s.name}</span>
              <span className="muted">{s.issued_active}/{s.seat_capacity}</span>
            </div>
            <div className="load-bar">
              <span className={s.pct >= 100 ? 'danger' : s.pct >= 85 ? 'warn' : ''}
                    style={{ width: `${s.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Application pipeline as a donut, so the submitted→approved shape is
 * visible at a glance instead of read off four separate number tiles. Pure
 * CSS conic-gradient — no charting library for one ring. */
function ApplicationStatusDonut({ applications }) {
  const segments = [
    { key: 'approved',     label: 'Disetujui', color: 'var(--success)' },
    { key: 'submitted',    label: 'Menunggu',  color: 'var(--warning)' },
    { key: 'under_review', label: 'Ditinjau',  color: '#7c4fe0' },
    { key: 'rejected',     label: 'Ditolak',   color: 'var(--danger)' },
  ];
  const total = segments.reduce((sum, s) => sum + (applications?.[s.key] || 0), 0);

  let acc = 0;
  const stops = segments.map((s) => {
    const val = applications?.[s.key] || 0;
    const pct = total ? (val / total) * 100 : 0;
    const from = acc;
    acc += pct;
    return `${s.color} ${from}% ${acc}%`;
  });

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="ico" aria-hidden="true">📊</span>
        <span className="grow">
          <div className="dash-card-title">Status Pengajuan</div>
          <div className="muted" style={{ fontSize: 12 }}>{total} pengajuan total</div>
        </span>
      </div>
      <div className="dash-card-body row" style={{ gap: 14 }}>
        <div
          className="donut-ring"
          style={{ background: total ? `conic-gradient(${stops.join(', ')})` : 'var(--outline)' }}
        >
          <div className="donut-ring-hole">
            <span style={{ fontSize: 16, fontWeight: 800 }}>{total}</span>
            <span className="muted" style={{ fontSize: 10 }}>total</span>
          </div>
        </div>
        <div className="donut-legend">
          {segments.map((s) => {
            const val = applications?.[s.key] || 0;
            const pct = total ? Math.round((val / total) * 100) : 0;
            return (
              <div key={s.key} className="donut-legend-row">
                <span className="donut-legend-dot" style={{ background: s.color }} />
                <span className="donut-legend-label">{s.label}</span>
                <span className="donut-legend-value">{val} · {pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// StudentsByGradeCard / SchoolCategoryCard now live in
// ../components/GradeCharts.jsx, shared with the Guru dashboard.

/**
 * Bus routes — the capacity/eligibility bucket checked when an application is
 * approved, separate from a bus's own TPS schedule in "Jadwal & Rute per Bis"
 * above. A 27/30-seat unit running several rits a day needs one route per
 * rit, each with its own seat count, rather than sharing a single capacity
 * across every trip it makes that day.
 */
/**
 * Kapasitas per TPS — capacity is the one thing about a TPS that changes
 * often enough to need editing from here (a stop filling up, like TPS#17, is
 * the day-to-day signal to raise it or start steering new applications
 * elsewhere). Code/name/area are effectively fixed once seeded, so this only
 * exposes the capacity field.
 */
function StopCapacityPanel({ stops, onChanged, canManage }) {
  const [edits, setEdits] = useState({});   // stop_id -> draft string
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // stop_id -> { lat, lng } draft strings, for the stop-progress map (see
  // routes/track.js) — separate from `edits` above since it saves to a
  // different endpoint and shouldn't block on a dirty capacity edit.
  const [locEdits, setLocEdits] = useState({});
  const [locBusy, setLocBusy] = useState(null);

  async function save(stop) {
    const value = Number(edits[stop.id]);
    if (!Number.isInteger(value) || value < 0) {
      setError(`Kapasitas ${stop.code} harus berupa angka 0 atau lebih.`);
      return;
    }
    setBusy(stop.id);
    setError(null);
    try {
      await api.updateStopCapacity(stop.id, value);
      setEdits((prev) => { const next = { ...prev }; delete next[stop.id]; return next; });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function locDraft(stop) {
    return locEdits[stop.id] ?? {
      lat: stop.latitude != null ? String(stop.latitude) : '',
      lng: stop.longitude != null ? String(stop.longitude) : '',
    };
  }

  function setLocDraft(stop, patch) {
    setLocEdits((prev) => ({ ...prev, [stop.id]: { ...locDraft(stop), ...patch } }));
  }

  function useMyLocation(stop) {
    if (!navigator.geolocation) {
      setError('Perangkat ini tidak mendukung deteksi lokasi.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocDraft(stop, {
        lat: String(pos.coords.latitude.toFixed(6)),
        lng: String(pos.coords.longitude.toFixed(6)),
      }),
      () => setError('Gagal mengambil lokasi perangkat. Izinkan akses lokasi di browser.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function saveLocation(stop) {
    const draft = locDraft(stop);
    const lat = draft.lat === '' ? null : Number(draft.lat);
    const lng = draft.lng === '' ? null : Number(draft.lng);
    if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      setError(`Latitude ${stop.code} tidak valid.`);
      return;
    }
    if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      setError(`Longitude ${stop.code} tidak valid.`);
      return;
    }
    setLocBusy(stop.id);
    setError(null);
    try {
      await api.updateStopLocation(stop.id, { latitude: lat, longitude: lng });
      setLocEdits((prev) => { const next = { ...prev }; delete next[stop.id]; return next; });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setLocBusy(null);
    }
  }

  return (
    <details className="card">
      {/* Collapsed by default: the daily job is the queue, not the 19-row
          capacity table. Open it when deciding where to reassign someone. */}
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">📍</span>
        <span className="grow">
          Kapasitas per TPS
          <div className="sub">
            {stops.filter((s) => s.seat_capacity > 0 && s.issued_active >= s.seat_capacity).length} penuh ·{' '}
            {stops.reduce((n, s) => n + s.pending_requests, 0)} permintaan menunggu
          </div>
        </span>
      </summary>

      {error && <div className="banner danger" style={{ marginTop: 12 }}><span>⚠</span><div>{error}</div></div>}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>TPS</th><th>Area</th><th>Terpakai</th><th style={{ width: 100 }}>Kapasitas</th>
              <th>Menunggu</th><th style={{ width: 160 }}>Beban</th>
              {/* Coordinates feed the stop-progress map (Lacak Bus) — see
                  routes/track.js. Optional per stop: one left blank just
                  stays off the map. */}
              <th style={{ width: 220 }}>Lokasi (untuk Lacak Bus)</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {stops.map((s) => {
              const pct = s.seat_capacity ? Math.min(100, (s.issued_active / s.seat_capacity) * 100) : 0;
              const cls = pct >= 100 ? 'danger' : pct >= 85 ? 'warn' : '';
              const dirty = edits[s.id] !== undefined && Number(edits[s.id]) !== s.seat_capacity;
              const draft = locDraft(s);
              const locDirty = (draft.lat || '') !== (s.latitude != null ? String(s.latitude) : '')
                || (draft.lng || '') !== (s.longitude != null ? String(s.longitude) : '');
              return (
                <tr key={s.id}>
                  <td>{s.code} {s.name}</td>
                  <td>{s.area}</td>
                  <td>{s.issued_active}</td>
                  <td>
                    {canManage ? (
                      <input type="number" min={0} style={{ width: 72 }}
                             value={edits[s.id] ?? s.seat_capacity}
                             onChange={(e) => setEdits((prev) => ({ ...prev, [s.id]: e.target.value }))} />
                    ) : s.seat_capacity}
                  </td>
                  <td>{s.pending_requests}</td>
                  <td><div className="load-bar"><span className={cls} style={{ width: `${pct}%` }} /></div></td>
                  <td>
                    {canManage ? (
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        <input type="number" step="any" placeholder="lat" style={{ width: 82 }}
                               value={draft.lat}
                               onChange={(e) => setLocDraft(s, { lat: e.target.value })} />
                        <input type="number" step="any" placeholder="lng" style={{ width: 82 }}
                               value={draft.lng}
                               onChange={(e) => setLocDraft(s, { lng: e.target.value })} />
                        <button type="button" className="ghost" title="Gunakan lokasi perangkat ini"
                                style={{ minHeight: 0, padding: '4px 8px', fontSize: 12 }}
                                onClick={() => useMyLocation(s)}>📍</button>
                      </div>
                    ) : (s.latitude != null ? `${s.latitude}, ${s.longitude}` : '—')}
                  </td>
                  {canManage && (
                    <td>
                      <div className="col" style={{ gap: 4 }}>
                        <button className={dirty ? '' : 'ghost'} disabled={!dirty || busy === s.id}
                                style={{ minHeight: 0, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => save(s)}>
                          {busy === s.id ? '…' : 'Simpan'}
                        </button>
                        <button className={locDirty ? '' : 'ghost'} disabled={!locDirty || locBusy === s.id}
                                style={{ minHeight: 0, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => saveLocation(s)}>
                          {locBusy === s.id ? '…' : 'Simpan lokasi'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const BUS_GROUP_LABEL = { besar: 'Bis Besar (60 seat)', kecil: 'Bis Kecil (27/30 seat)' };
const WEEKDAY_LABEL = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat' };
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * "Nomor Tugas" — authoring layer over the bus fleet in SchedulePanel above.
 * Admin fills in each duty slot's own TPS list PER WEEKDAY (Senin–Jumat,
 * exactly the same picker as a bus used to have: TPS → sekolah for pickup,
 * sekolah → TPS per trip for dropoff) — small units in particular split
 * dropoff coverage across days (unit A runs a trip Senin/Rabu, unit B covers
 * the same trip Selasa/Kamis/Jumat), so each day is configured and saved
 * independently. Which physical bus currently fills a slot rotates
 * automatically every WIT week (see resolveDutySchedule in
 * backend/lib/cards.js); which TPS/trips that bus actually runs re-applies
 * every WIT day (materializeDutySchedule) since that can differ by weekday.
 */
function DutyRotationPanel({ canManage }) {
  const [data, setData] = useState(null);
  const [orderDrafts, setOrderDrafts] = useState({ besar: [], kecil: [] });
  const [referenceMonday, setReferenceMonday] = useState('');
  const [activeDay, setActiveDay] = useState({});   // slot_id -> weekday (default 1)
  const [slotEdits, setSlotEdits] = useState({});   // "slotId|weekday" -> { stops, trips }
  const [orderBusy, setOrderBusy] = useState(null);  // group being saved, or null
  const [slotBusy, setSlotBusy] = useState(null);    // "slotId|weekday" being saved, or null
  const [copyOpenFor, setCopyOpenFor] = useState(null);  // slot.id whose "Salin ke hari lain" panel is open, or null
  const [copyTargets, setCopyTargets] = useState({});    // weekday -> bool, for the open panel
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.dutySchedule()
      .then((d) => {
        setData(d);
        // A slot with fixed_bus_id set (e.g. kecil Tugas 5) never appears in
        // the rotation order — only rotating slots do, so the draft array's
        // length must match however many of those the group actually has,
        // not a fixed 4. A stale saved order of the wrong length (e.g. from
        // before a slot became fixed) is treated as blank rather than shown
        // half-filled against the new slot count.
        const rotatingCount = (group) =>
          d.slots.filter((s) => s.bus_group === group && s.fixed_bus_id == null).length;
        const blank = (n) => Array.from({ length: n }, () => '');
        setOrderDrafts({
          besar: d.duty_order_besar?.length === rotatingCount('besar') ? d.duty_order_besar : blank(rotatingCount('besar')),
          kecil: d.duty_order_kecil?.length === rotatingCount('kecil') ? d.duty_order_kecil : blank(rotatingCount('kecil')),
        });
        setReferenceMonday(d.duty_reference_monday || '');
        setSlotEdits({});
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return error
    ? <div className="banner danger"><span>⚠</span><div>{error}</div></div>
    : null;

  const busesByGroup = {
    besar: data.buses.filter((b) => b.bus_group === 'besar'),
    kecil: data.buses.filter((b) => b.bus_group === 'kecil'),
  };
  const busPlate = (id) => data.buses.find((b) => b.id === id)?.plate_number || `#${id}`;
  const dayOf = (slot) => activeDay[slot.id] || 1;
  const editKey = (slot, weekday) => `${slot.id}|${weekday}`;

  /** Working copy of one slot's ONE weekday: local draft if touched, else
   *  server state — identical shape/logic to the old per-bus draftFor(bus). */
  function draftFor(slot, weekday) {
    const key = editKey(slot, weekday);
    if (slotEdits[key]) return slotEdits[key];
    const day = slot.days[weekday] || { pickup_trips: [], trips: [], school_arrival_time: null };
    return {
      pickup_trips: (day.pickup_trips.length ? day.pickup_trips : [{ trip_number: 1, arrival_time: '', stops: [] }])
        .map((t) => ({
          arrival_time: t.arrival_time || '',
          stops: (t.stops || []).map((s) => ({ bus_stop_id: s.bus_stop_id, pickup_time: s.pickup_time || '' })),
        })),
      trips: (day.trips.length ? day.trips : [{ trip_number: 1, departure_time: '', stops: [] }])
        .map((t) => ({
          departure_time: t.departure_time || '',
          stops: (t.stops || []).map((s) => ({ bus_stop_id: s.bus_stop_id, dropoff_time: s.dropoff_time || '' })),
        })),
    };
  }

  function updateSlot(slot, weekday, patch) {
    const key = editKey(slot, weekday);
    setSlotEdits((prev) => ({ ...prev, [key]: { ...draftFor(slot, weekday), ...patch } }));
  }

  function addPickupTrip(slot, weekday) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, { pickup_trips: [...d.pickup_trips, { arrival_time: '', stops: [] }] });
  }

  function setPickupTripTime(slot, weekday, tripIdx, value) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, { pickup_trips: d.pickup_trips.map((t, i) => (i === tripIdx ? { ...t, arrival_time: value } : t)) });
  }

  function removePickupTrip(slot, weekday, tripIdx) {
    const d = draftFor(slot, weekday);
    if (d.pickup_trips.length <= 1) return;
    updateSlot(slot, weekday, { pickup_trips: d.pickup_trips.filter((_, i) => i !== tripIdx) });
  }

  function addPickupTripStop(slot, weekday, tripIdx, stopId) {
    if (!stopId) return;
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      pickup_trips: d.pickup_trips.map((t, i) => (i === tripIdx && !t.stops.some((s) => s.bus_stop_id === stopId)
        ? { ...t, stops: [...t.stops, { bus_stop_id: stopId, pickup_time: '' }] }
        : t)),
    });
  }

  function removePickupTripStop(slot, weekday, tripIdx, stopId) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      pickup_trips: d.pickup_trips.map((t, i) => (i === tripIdx ? { ...t, stops: t.stops.filter((s) => s.bus_stop_id !== stopId) } : t)),
    });
  }

  function setPickupTripStopTime(slot, weekday, tripIdx, stopId, value) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      pickup_trips: d.pickup_trips.map((t, i) => (i === tripIdx
        ? { ...t, stops: t.stops.map((s) => (s.bus_stop_id === stopId ? { ...s, pickup_time: value } : s)) }
        : t)),
    });
  }

  function movePickupTripStop(slot, weekday, tripIdx, stopIdx, dir) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      pickup_trips: d.pickup_trips.map((t, i) => {
        if (i !== tripIdx) return t;
        const target = stopIdx + dir;
        if (target < 0 || target >= t.stops.length) return t;
        const stops = [...t.stops];
        [stops[stopIdx], stops[target]] = [stops[target], stops[stopIdx]];
        return { ...t, stops };
      }),
    });
  }

  function addTrip(slot, weekday) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, { trips: [...d.trips, { departure_time: '', stops: [] }] });
  }

  function setTripTime(slot, weekday, tripIdx, value) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, { trips: d.trips.map((t, i) => (i === tripIdx ? { ...t, departure_time: value } : t)) });
  }

  function removeTrip(slot, weekday, tripIdx) {
    const d = draftFor(slot, weekday);
    if (d.trips.length <= 1) return;
    updateSlot(slot, weekday, { trips: d.trips.filter((_, i) => i !== tripIdx) });
  }

  function addTripStop(slot, weekday, tripIdx, stopId) {
    if (!stopId) return;
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      trips: d.trips.map((t, i) => (i === tripIdx && !t.stops.some((s) => s.bus_stop_id === stopId)
        ? { ...t, stops: [...t.stops, { bus_stop_id: stopId, dropoff_time: '' }] }
        : t)),
    });
  }

  function removeTripStop(slot, weekday, tripIdx, stopId) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      trips: d.trips.map((t, i) => (i === tripIdx ? { ...t, stops: t.stops.filter((s) => s.bus_stop_id !== stopId) } : t)),
    });
  }

  function setTripStopTime(slot, weekday, tripIdx, stopId, value) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      trips: d.trips.map((t, i) => (i === tripIdx
        ? { ...t, stops: t.stops.map((s) => (s.bus_stop_id === stopId ? { ...s, dropoff_time: value } : s)) }
        : t)),
    });
  }

  function moveTripStop(slot, weekday, tripIdx, stopIdx, dir) {
    const d = draftFor(slot, weekday);
    updateSlot(slot, weekday, {
      trips: d.trips.map((t, i) => {
        if (i !== tripIdx) return t;
        const target = stopIdx + dir;
        if (target < 0 || target >= t.stops.length) return t;
        const stops = [...t.stops];
        [stops[stopIdx], stops[target]] = [stops[target], stops[stopIdx]];
        return { ...t, stops };
      }),
    });
  }

  async function saveOrder(group) {
    const order = orderDrafts[group].map(Number);
    if (order.some((id) => !id) || !referenceMonday) {
      setError(`Lengkapi ${order.length} bis dan tanggal referensi untuk kelompok ${group}.`);
      return;
    }
    setOrderBusy(group);
    setError(null);
    try {
      await api.saveDutyOrder({ bus_group: group, order, reference_monday: referenceMonday });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setOrderBusy(null);
    }
  }

  async function saveSlot(slot, weekday) {
    const d = draftFor(slot, weekday);
    const key = editKey(slot, weekday);
    setSlotBusy(key);
    setError(null);
    try {
      await api.saveDutySlotDay(slot.id, weekday, {
        pickup_trips: d.pickup_trips.map((t) => ({
          arrival_time: t.arrival_time || null,
          stops: t.stops.map((s) => ({ bus_stop_id: s.bus_stop_id, pickup_time: s.pickup_time || null })),
        })),
        trips: d.trips.map((t) => ({
          departure_time: t.departure_time || null,
          stops: t.stops.map((s) => ({ bus_stop_id: s.bus_stop_id, dropoff_time: s.dropoff_time || null })),
        })),
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(null);
    }
  }

  /** Copies the CURRENT day's draft (TPS/trip picks) into one or more other
   *  days' local drafts — a starting point to tweak, not an immediate save.
   *  Each target day still needs its own "Simpan Hari X" click (same rule as
   *  any other edit), so nothing reaches the server until the admin reviews
   *  and confirms each day, even though the heavy lifting (re-picking TPS one
   *  by one) is done in one go. Deep-cloned so editing one day's copy can
   *  never mutate another day's stops/trips arrays by reference. */
  function copyDayTo(slot, fromWeekday, toWeekdays) {
    const source = draftFor(slot, fromWeekday);
    const clone = JSON.parse(JSON.stringify({
      pickup_trips: source.pickup_trips,
      trips: source.trips,
    }));
    setSlotEdits((prev) => {
      const next = { ...prev };
      for (const w of toWeekdays) {
        next[editKey(slot, w)] = JSON.parse(JSON.stringify(clone));
      }
      return next;
    });
    setCopyOpenFor(null);
    setCopyTargets({});
  }

  async function applyNow() {
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const res = await api.applyDutySchedule();
      setApplyResult(res.applied.length);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const configuredCount = data.slots.reduce(
    (n, s) => n + WEEKDAYS.filter((w) => s.days[w]?.pickup_trips.some((t) => t.stops.length > 0)
                                       || s.days[w]?.trips.some((t) => t.stops.length > 0)).length, 0,
  );
  const stopById = new Map(data.stops.map((s) => [s.id, s]));

  return (
    <details className="card">
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🔄</span>
        <span className="grow">
          Rotasi Tugas Bis
          <div className="sub">{configuredCount} / 40 nomor tugas × hari sudah diatur</div>
        </span>
      </summary>

      {error && <div className="banner danger" style={{ marginTop: 12 }}><span>⚠</span><div>{error}</div></div>}

      <p className="muted" style={{ marginTop: 12 }}>
        Atur TPS penjemputan dan trip pengantaran per nomor tugas (1–4,
        terpisah untuk bis besar dan bis kecil) — dan per hari Senin s/d
        Jumat, karena bis kecil sering saling melengkapi (unit A jalan
        Senin/Rabu, unit B menutupi Selasa/Kamis/Jumat untuk trip yang sama).
        Bis fisik yang memegang nomor tugas ini bergilir otomatis setiap
        minggu (Senin, WIT); TPS/trip yang dijalankannya diterapkan ulang
        setiap hari sesuai jadwal hari itu.
        {!canManage && ' Peran Leader hanya dapat melihat pengaturan ini.'}
      </p>

      <fieldset disabled={!canManage} style={{ border: 'none', margin: 0, padding: 0 }}>

      {/* Minggu ini — hasil hitungan, bukan input */}
      <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        BIS YANG BERTUGAS MINGGU INI
      </div>
      <div className="row" style={{ gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
        {['besar', 'kecil'].map((group) => (
          <div key={group}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>{BUS_GROUP_LABEL[group]}</div>
            {data.this_week[group]?.length ? (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {data.this_week[group].map((x) => (
                  <span className="chip neutral" key={x.duty_number}>
                    Tugas {x.duty_number}: {busPlate(x.bus_id)}
                  </span>
                ))}
              </div>
            ) : <span className="muted" style={{ fontSize: 12.5 }}>Belum diatur.</span>}
          </div>
        ))}
      </div>

      {/* Urutan dasar + tanggal referensi */}
      <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        URUTAN DASAR ROTASI
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 12.5 }}>
        Bis mana memegang tiap nomor tugas yang berotasi pada minggu tanggal referensi
        di bawah — rotasi dihitung maju dari sana setiap minggu berikutnya. Nomor tugas
        tetap (misalnya Tugas 5) tidak muncul di sini karena tidak ikut berotasi.
      </p>
      <label style={{ maxWidth: 220, display: 'block', marginBottom: 12 }}>
        <span className="lbl">Tanggal Referensi (Senin)</span>
        <input type="date" value={referenceMonday} onChange={(e) => setReferenceMonday(e.target.value)} />
      </label>
      {['besar', 'kecil'].map((group) => {
        const rotatingSlots = data.slots.filter((s) => s.bus_group === group && s.fixed_bus_id == null);
        const fixedBusIds = new Set(data.slots.filter((s) => s.bus_group === group && s.fixed_bus_id != null)
          .map((s) => s.fixed_bus_id));
        const pickableBuses = busesByGroup[group].filter((b) => !fixedBusIds.has(b.id));
        return (
        <div key={group} style={{ marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{BUS_GROUP_LABEL[group]}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {rotatingSlots.map((slot, i) => (
              <label key={slot.id} style={{ minWidth: 160 }}>
                <span className="lbl">Nomor Tugas {slot.duty_number}</span>
                <select value={orderDrafts[group][i] || ''}
                        onChange={(e) => setOrderDrafts((prev) => ({
                          ...prev, [group]: prev[group].map((v, vi) => (vi === i ? e.target.value : v)),
                        }))}>
                  <option value="">— Pilih Bis —</option>
                  {pickableBuses.map((b) => (
                    <option key={b.id} value={b.id}>{b.plate_number}</option>
                  ))}
                </select>
              </label>
            ))}
            <button className="ghost" disabled={orderBusy === group} onClick={() => saveOrder(group)}>
              {orderBusy === group ? 'Menyimpan…' : 'Simpan Urutan'}
            </button>
          </div>
        </div>
        );
      })}

      {/* Per nomor tugas: TPS penjemputan + trip pengantaran, per hari */}
      <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)',
                                    marginBottom: 6, marginTop: 8 }}>
        TPS PER NOMOR TUGAS
      </div>
      {['besar', 'kecil'].map((group) => (
        <div key={group} style={{ marginBottom: 18 }}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{BUS_GROUP_LABEL[group]}</div>
          {data.slots.filter((s) => s.bus_group === group).map((slot) => {
            const weekday = dayOf(slot);
            const d = draftFor(slot, weekday);
            const dirty = !!slotEdits[editKey(slot, weekday)];
            const busyKey = slotBusy === editKey(slot, weekday);
            const pickupStopCount = new Set(d.pickup_trips.flatMap((t) => t.stops.map((s) => s.bus_stop_id))).size;
            return (
              <div className="bus-editor" key={slot.id} style={{ marginBottom: 14 }}>
                <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span className={`chip chip-duty chip-duty-${
                    slot.bus_group === 'kecil' && slot.duty_number === 5 ? 'tugas5' : slot.bus_group === 'besar' ? 'besar' : 'kecil'
                  }`} style={{ minWidth: 70, textAlign: 'center' }}>
                    Tugas {slot.duty_number}
                  </span>
                  {slot.fixed_bus_id != null && (
                    <span className="chip" style={{ fontSize: 11 }} title="Nomor tugas tetap — tidak ikut rotasi mingguan">
                      Tetap · {busPlate(slot.fixed_bus_id)}
                    </span>
                  )}
                  <span className="grow muted" style={{ fontSize: 12.5 }}>{pickupStopCount} TPS · {WEEKDAY_LABEL[weekday]}</span>
                  <button className="ghost" type="button"
                          onClick={() => {
                            if (copyOpenFor === slot.id) { setCopyOpenFor(null); setCopyTargets({}); }
                            else { setCopyOpenFor(slot.id); setCopyTargets({}); }
                          }}>
                    📋 Salin ke hari lain…
                  </button>
                  <button className={dirty ? '' : 'ghost'} disabled={busyKey || !dirty}
                          onClick={() => saveSlot(slot, weekday)}>
                    {busyKey ? 'Menyimpan…' : `Simpan Hari ${WEEKDAY_LABEL[weekday]}`}
                  </button>
                </div>

                {copyOpenFor === slot.id && (
                  <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap',
                                                marginBottom: 12, padding: 10, background: 'var(--bg-subtle, #f4f5f7)',
                                                borderRadius: 8 }}>
                    <span style={{ fontSize: 12.5 }}>
                      Salin isi <strong>{WEEKDAY_LABEL[weekday]}</strong> ke:
                    </span>
                    {WEEKDAYS.filter((w) => w !== weekday).map((w) => (
                      <label key={w} className="row" style={{ gap: 4, alignItems: 'center', fontSize: 12.5 }}>
                        <input type="checkbox" checked={!!copyTargets[w]}
                               onChange={(e) => setCopyTargets((prev) => ({ ...prev, [w]: e.target.checked }))} />
                        {WEEKDAY_LABEL[w]}
                      </label>
                    ))}
                    <button className="ghost" type="button"
                            disabled={!Object.values(copyTargets).some(Boolean)}
                            onClick={() => copyDayTo(slot, weekday, WEEKDAYS.filter((w) => copyTargets[w]))}>
                      Salin
                    </button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      Belum tersimpan — buka tiap hari tujuan untuk sesuaikan &amp; klik Simpan.
                    </span>
                  </div>
                )}

                {/* Day tabs — each day's TPS/trips are independent and saved separately.
                    Switching tabs with unsaved edits discards them (nothing is sent to
                    the server until "Simpan Hari X" is clicked for THAT tab), so warn
                    before letting that happen instead of losing work silently. */}
                <div className="seg" style={{ marginBottom: 12 }}>
                  {WEEKDAYS.map((w) => {
                    const serverDay = slot.days[w];
                    const localDay = slotEdits[editKey(slot, w)];
                    const configured = serverDay?.pickup_trips.some((t) => t.stops.length > 0)
                      || serverDay?.trips.some((t) => t.stops.length > 0)
                      || localDay?.pickup_trips.some((t) => t.stops.length > 0)
                      || localDay?.trips.some((t) => t.stops.length > 0);
                    return (
                      <button type="button" key={w} className={w === weekday ? 'on' : ''}
                              onClick={() => {
                                if (w !== weekday && dirty
                                    && !window.confirm(`Perubahan pada hari ${WEEKDAY_LABEL[weekday]} belum disimpan dan akan hilang jika pindah tab. Lanjutkan tanpa menyimpan?`)) {
                                  return;
                                }
                                setActiveDay((prev) => ({ ...prev, [slot.id]: w }));
                              }}>
                        {WEEKDAY_LABEL[w]}{configured ? ' ●' : ''}
                      </button>
                    );
                  })}
                </div>

                {/* TPS PENJEMPUTAN is trip-based, same pattern as TRIP PENGANTARAN
                    below — a duty slot can run more than one pickup round in a
                    morning (e.g. a nearby TPS served again after the main run, or a
                    separate later round for a different unit like PAUD), each with
                    its own arrival-at-school time and TPS list. "Tiba di Sekolah" is
                    no longer a single field here — it's each trip's own arrival time. */}
                <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  TRIP PENJEMPUTAN (TPS → SEKOLAH) — {WEEKDAY_LABEL[weekday].toUpperCase()}
                </div>
                <div className="col" style={{ gap: 14, marginBottom: 12 }}>
                  {d.pickup_trips.map((t, ti) => {
                    const availableStops = data.stops.filter((s) => !t.stops.some((x) => x.bus_stop_id === s.id));
                    return (
                      <div className="trip-block" key={ti}>
                        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                          <span className="chip neutral" style={{ minWidth: 56, textAlign: 'center' }}>
                            Trip {ti + 1}
                          </span>
                          <input type="time" title={`Trip ${ti + 1} — tiba di sekolah`}
                                 value={t.arrival_time}
                                 onChange={(e) => setPickupTripTime(slot, weekday, ti, e.target.value)} />
                          {d.pickup_trips.length > 1 && (
                            <button type="button" className="ghost"
                                    style={{ minHeight: 0, padding: '4px 8px', fontSize: 12 }}
                                    title="Hapus trip ini"
                                    onClick={() => removePickupTrip(slot, weekday, ti)}>✕</button>
                          )}
                        </div>

                        <div className="col" style={{ gap: 4, marginLeft: 62, marginBottom: 8 }}>
                          {t.stops.map((s, si) => {
                            const meta = stopById.get(s.bus_stop_id);
                            if (!meta) return null;
                            return (
                              <div className="row" key={s.bus_stop_id} style={{ gap: 6 }}>
                                <span className="muted" style={{ minWidth: 18, textAlign: 'center', fontSize: 11.5 }}>
                                  {si + 1}
                                </span>
                                <input type="time" title={`${meta.code} — Trip ${ti + 1}`}
                                       style={{ width: 100 }}
                                       value={s.pickup_time}
                                       onChange={(e) => setPickupTripStopTime(slot, weekday, ti, s.bus_stop_id, e.target.value)} />
                                <span style={{ fontSize: 12.5, flex: 1 }}>
                                  <strong>{meta.code}</strong> {meta.name}
                                </span>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Naikkan urutan" disabled={si === 0}
                                        onClick={() => movePickupTripStop(slot, weekday, ti, si, -1)}>↑</button>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Turunkan urutan" disabled={si === t.stops.length - 1}
                                        onClick={() => movePickupTripStop(slot, weekday, ti, si, 1)}>↓</button>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Hapus dari trip ini"
                                        onClick={() => removePickupTripStop(slot, weekday, ti, s.bus_stop_id)}>✕</button>
                              </div>
                            );
                          })}
                          <div className="muted" style={{ fontSize: 12 }}>🏫 Sekolah — titik akhir</div>
                        </div>

                        <div style={{ marginLeft: 62 }}>
                          <select value="" style={{ maxWidth: 280 }}
                                  onChange={(e) => { addPickupTripStop(slot, weekday, ti, Number(e.target.value)); e.target.value = ''; }}>
                            <option value="">+ Tambah TPS ke Trip {ti + 1}…</option>
                            {availableStops.map((s) => (
                              <option key={s.id} value={s.id}>{s.code} {s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" className="ghost"
                          style={{ minHeight: 0, padding: '4px 8px', fontSize: 11.5, alignSelf: 'flex-start' }}
                          onClick={() => addPickupTrip(slot, weekday)}>
                    + Tambah Trip
                  </button>
                </div>

                <div className="lbl" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)',
                                              marginBottom: 6, marginTop: 12 }}>
                  TRIP PENGANTARAN (SEKOLAH → TPS) — {WEEKDAY_LABEL[weekday].toUpperCase()}
                </div>
                <div className="col" style={{ gap: 14 }}>
                  {d.trips.map((t, ti) => {
                    const availableStops = data.stops.filter((s) => !t.stops.some((x) => x.bus_stop_id === s.id));
                    return (
                      <div className="trip-block" key={ti}>
                        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                          <span className="chip neutral" style={{ minWidth: 56, textAlign: 'center' }}>
                            Trip {ti + 1}
                          </span>
                          <input type="time" title={`Trip ${ti + 1} — berangkat sekolah`}
                                 value={t.departure_time}
                                 onChange={(e) => setTripTime(slot, weekday, ti, e.target.value)} />
                          {d.trips.length > 1 && (
                            <button type="button" className="ghost"
                                    style={{ minHeight: 0, padding: '4px 8px', fontSize: 12 }}
                                    title="Hapus trip ini"
                                    onClick={() => removeTrip(slot, weekday, ti)}>✕</button>
                          )}
                        </div>

                        <div className="col" style={{ gap: 4, marginLeft: 62, marginBottom: 8 }}>
                          <div className="muted" style={{ fontSize: 12 }}>🏫 Sekolah — titik awal</div>
                          {t.stops.map((s, si) => {
                            const meta = stopById.get(s.bus_stop_id);
                            if (!meta) return null;
                            return (
                              <div className="row" key={s.bus_stop_id} style={{ gap: 6 }}>
                                <span className="muted" style={{ minWidth: 18, textAlign: 'center', fontSize: 11.5 }}>
                                  {si + 1}
                                </span>
                                <input type="time" title={`${meta.code} — Trip ${ti + 1}`}
                                       style={{ width: 100 }}
                                       value={s.dropoff_time}
                                       onChange={(e) => setTripStopTime(slot, weekday, ti, s.bus_stop_id, e.target.value)} />
                                <span style={{ fontSize: 12.5, flex: 1 }}>
                                  <strong>{meta.code}</strong> {meta.name}
                                </span>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Naikkan urutan" disabled={si === 0}
                                        onClick={() => moveTripStop(slot, weekday, ti, si, -1)}>↑</button>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Turunkan urutan" disabled={si === t.stops.length - 1}
                                        onClick={() => moveTripStop(slot, weekday, ti, si, 1)}>↓</button>
                                <button type="button" className="ghost"
                                        style={{ minHeight: 0, padding: '2px 7px', fontSize: 11 }}
                                        title="Hapus dari trip ini"
                                        onClick={() => removeTripStop(slot, weekday, ti, s.bus_stop_id)}>✕</button>
                              </div>
                            );
                          })}
                          <div className="muted" style={{ fontSize: 12 }}>🏫 Sekolah — kembali ke sekolah</div>
                        </div>

                        <div style={{ marginLeft: 62 }}>
                          <select value="" style={{ maxWidth: 280 }}
                                  onChange={(e) => { addTripStop(slot, weekday, ti, Number(e.target.value)); e.target.value = ''; }}>
                            <option value="">+ Tambah TPS ke Trip {ti + 1}…</option>
                            {availableStops.map((s) => (
                              <option key={s.id} value={s.id}>{s.code} {s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" className="ghost"
                          style={{ minHeight: 0, padding: '4px 8px', fontSize: 11.5, alignSelf: 'flex-start' }}
                          onClick={() => addTrip(slot, weekday)}>
                    + Tambah Trip
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 6 }}>
        <button disabled={applying} onClick={applyNow}>
          {applying ? 'Menerapkan…' : 'Terapkan Sekarang'}
        </button>
        {applyResult !== null && (
          <span className="chip ok">{applyResult} bis diperbarui</span>
        )}
      </div>
      </fieldset>
    </details>
  );
}

function RoutesPanel({ routes, onChanged, canManage }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    code: '', name: '', destination: 'Sekolah YPJ Kuala Kencana', seat_capacity: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [edits, setEdits] = useState({});   // route_id -> draft string
  const [savingId, setSavingId] = useState(null);

  async function saveCapacity(route) {
    const value = Number(edits[route.id]);
    if (!Number.isInteger(value) || value <= 0) {
      setError(`Kapasitas ${route.code} harus berupa angka lebih dari 0.`);
      return;
    }
    setSavingId(route.id);
    setError(null);
    try {
      await api.updateRouteCapacity(route.id, value);
      setEdits((prev) => { const next = { ...prev }; delete next[route.id]; return next; });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addRoute({
        code: form.code,
        name: form.name,
        destination: form.destination,
        seat_capacity: Number(form.seat_capacity),
      });
      setForm({ code: '', name: '', destination: 'Sekolah YPJ Kuala Kencana', seat_capacity: '' });
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!routes) return null;

  return (
    <details className="card">
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🛣️</span>
        <span className="grow">
          Rute Bus
          <div className="sub">{routes.length} rute aktif</div>
        </span>
      </summary>

      <p className="muted" style={{ marginTop: 12 }}>
        Setiap rute punya kapasitas kursi sendiri dan dipilih Tim Transportasi
        saat menyetujui pengajuan. Unit dengan beberapa rit dalam sehari (mis.
        bis 27/30 kursi) dapat memiliki satu rute untuk setiap rit.
      </p>

      {routes.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th><th>Nama</th><th>Titik Akhir</th>
                <th style={{ width: 100 }}>Kapasitas</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const dirty = edits[r.id] !== undefined && Number(edits[r.id]) !== r.seat_capacity;
                return (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="muted">{r.destination || 'Sekolah YPJ Kuala Kencana'}</td>
                    <td>
                      {canManage ? (
                        <>
                          {r.issued_active}/{' '}
                          <input type="number" min={1} style={{ width: 64 }}
                                 value={edits[r.id] ?? r.seat_capacity}
                                 onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: e.target.value }))} />
                        </>
                      ) : `${r.issued_active}/${r.seat_capacity}`}
                    </td>
                    {canManage && (
                      <td>
                        <button className={dirty ? '' : 'ghost'} disabled={!dirty || savingId === r.id}
                                style={{ minHeight: 0, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => saveCapacity(r)}>
                          {savingId === r.id ? '…' : 'Simpan'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {canManage && (!adding ? (
        <button className="ghost" onClick={() => setAdding(true)}>+ Tambah Rute Baru</button>
      ) : (
        <form onSubmit={submit} className="col" style={{ gap: 10, maxWidth: 420 }}>
          <label>
            <span className="lbl">Kode Rute</span>
            <input type="text" placeholder="Contoh: KK-B" required
                   value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
          <label>
            <span className="lbl">Nama Rute</span>
            <input type="text" placeholder="Contoh: Kuala Kencana — Rit 2" required
                   value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span className="lbl">Titik Akhir</span>
            <input type="text" required
                   value={form.destination}
                   onChange={(e) => setForm({ ...form, destination: e.target.value })} />
          </label>
          <label>
            <span className="lbl">Jumlah Seat</span>
            <select required value={form.seat_capacity}
                    onChange={(e) => setForm({ ...form, seat_capacity: e.target.value })}>
              <option value="">— Pilih Jumlah Seat —</option>
              {SEAT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} seat</option>
              ))}
            </select>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan Rute'}</button>
            <button type="button" className="ghost" disabled={busy}
                    onClick={() => { setAdding(false); setError(null); }}>Batal</button>
          </div>
        </form>
      ))}
    </details>
  );
}

/**
 * Ad-hoc delay / route-change / emergency notice to every parent currently
 * riding a given bus or route — the manual counterpart to the automatic
 * per-stop "bus is approaching" notice. Sent as in-app notification + email.
 */
function BroadcastPanel() {
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('bus');
  const [targetId, setTargetId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.adminSchedule().then(setData).catch((err) => setError(err.message));
  }, []);

  async function send(e) {
    e.preventDefault();
    if ((scope !== 'all' && !targetId) || !subject.trim() || !message.trim()) return;

    const targetLabel = scope === 'bus'
      ? data?.buses?.find((b) => String(b.bus_id) === targetId)?.plate_number
      : scope === 'route'
      ? data?.routes?.find((r) => String(r.id) === targetId)?.code
      : 'SEMUA orang tua';
    if (!confirm(`Kirim pesan ini ke seluruh orang tua pada ${targetLabel || 'tujuan ini'}?`)) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.sendBroadcast({
        scope, target_id: scope === 'all' ? undefined : Number(targetId),
        subject: subject.trim(), message: message.trim(),
      });
      setResult(res);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">📢</span>
        <span className="grow">
          Broadcast ke Orang Tua
          <div className="sub">Info keterlambatan, perubahan rute, atau kondisi darurat</div>
        </span>
      </summary>

      <form onSubmit={send} style={{ marginTop: 12, display: 'grid', gap: 10, maxWidth: 480 }}>
        {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}
        {result && (
          <div className="banner ok">
            <span>✓</span>
            <div>Terkirim ke {result.recipients} orang tua.</div>
          </div>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={scope}
                  onChange={(e) => { setScope(e.target.value); setTargetId(''); }}
                  style={{ maxWidth: 140 }}>
            <option value="bus">Per Bis</option>
            <option value="route">Per Rute</option>
            <option value="all">Semua Pengguna</option>
          </select>
          {scope !== 'all' && (
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                    style={{ maxWidth: 280 }} required>
              <option value="">{scope === 'bus' ? 'Pilih bis…' : 'Pilih rute…'}</option>
              {scope === 'bus'
                ? data?.buses?.map((b) => (
                    <option key={b.bus_id} value={b.bus_id}>
                      {b.plate_number}{b.label ? ` (${b.label})` : ''}
                    </option>
                  ))
                : data?.routes?.map((r) => (
                    <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
                  ))}
            </select>
          )}
        </div>
        {scope === 'all' && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Terkirim ke semua akun orang tua, bukan hanya yang memiliki kartu aktif —
            ditampilkan sebagai sorotan di beranda mereka.
          </p>
        )}

        <input placeholder="Judul pesan" value={subject}
               onChange={(e) => setSubject(e.target.value)} required />
        <textarea placeholder="Isi pesan…" rows={3} value={message}
                  onChange={(e) => setMessage(e.target.value)} required />

        <button className="block" disabled={busy || (scope !== 'all' && !targetId)}>
          {busy ? 'Mengirim…' : 'Kirim Broadcast'}
        </button>
      </form>
    </details>
  );
}

const ROOM_ROLE_LABEL = {
  parent: 'Orang Tua', transport_admin: 'Tim Transportasi', super_admin: 'Tim Transportasi',
  leader: 'Leader', admin: 'Admin Sekolah',
};

/**
 * Chat, merged into one card with two tabs — "Ruang Chat" (the one public
 * room every role can read, see ChatPage.jsx's RoomThread) and "Chat Orang
 * Tua" (private per-parent threads). These used to be two separate top-level
 * dashboard cards, which read as duplicate chat features; they're different
 * audiences (broadcast vs. one-to-one), not different products, so one card
 * with a tab switcher is what that difference actually looks like.
 */
function ChatHubPanel({ user }) {
  const [tab, setTab] = useState('room');   // 'room' | 'personal'

  // — Ruang Chat (public room) —
  const [roomMessages, setRoomMessages] = useState(null);
  const [roomCanPost, setRoomCanPost] = useState(true);
  const [roomBody, setRoomBody] = useState('');
  const [roomSending, setRoomSending] = useState(false);
  const [roomError, setRoomError] = useState(null);
  const roomBoxRef = useRef(null);

  // Scrolls only the message list itself, not the surrounding dashboard page
  // — `scrollIntoView()` used to bubble up to the nearest scrollable ancestor
  // (the whole page), yanking the admin back down to this panel every time
  // they sent a reply or opened a thread while reading something else above.
  function scrollToBottom(ref) {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  const loadRoom = useCallback(({ scroll = false } = {}) => {
    api.roomChat()
      .then((d) => {
        setRoomMessages(d.messages);
        setRoomCanPost(d.can_post !== false);
        if (scroll) setTimeout(() => scrollToBottom(roomBoxRef), 50);
      })
      .catch((e) => setRoomError(e.message));
  }, []);

  useEffect(() => {
    loadRoom();
    const timer = setInterval(() => loadRoom(), 20000);
    return () => clearInterval(timer);
  }, [loadRoom]);

  async function sendRoom(e) {
    e.preventDefault();
    const text = roomBody.trim();
    if (!text) return;
    setRoomSending(true);
    setRoomError(null);
    try {
      await api.sendRoomChat(text);
      setRoomBody('');
      loadRoom({ scroll: true });
    } catch (err) {
      setRoomError(err.message);
    } finally {
      setRoomSending(false);
    }
  }

  // — Chat Orang Tua (personal threads) —
  const [threads, setThreads] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  const loadThreads = useCallback(() => {
    api.chatThreads().then(setThreads).catch((e) => setError(e.message));
  }, []);

  const loadThread = useCallback((id, { scroll = false } = {}) => {
    if (!id) { setThread(null); return; }
    api.chatThread(id)
      .then((d) => {
        setThread(d);
        if (scroll) setTimeout(() => scrollToBottom(boxRef), 50);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadThreads();
    const timer = setInterval(loadThreads, 20000);
    return () => clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => { loadThread(openId, { scroll: true }); }, [openId, loadThread]);

  async function reply(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !openId) return;
    setSending(true);
    setError(null);
    try {
      await api.replyChat(openId, text);
      setBody('');
      loadThread(openId, { scroll: true });
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!roomMessages || !threads) return null;
  const waiting = threads.filter((t) => t.unread > 0).length;

  return (
    <details className="card" open={waiting > 0}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">💬</span>
        <span className="grow">
          Chat
          <div className="sub">
            Ruang Chat · {roomMessages.length} pesan · Chat Orang Tua · {threads.length} percakapan
            {waiting > 0 ? ` · ${waiting} menunggu balasan` : ''}
          </div>
        </span>
      </summary>

      <div className="seg" style={{ marginTop: 12, marginBottom: 12 }}>
        <button className={tab === 'room' ? 'on' : ''} onClick={() => setTab('room')}>
          📣 Ruang Chat
        </button>
        <button className={tab === 'personal' ? 'on' : ''} onClick={() => setTab('personal')}>
          👤 Chat Orang Tua{waiting > 0 ? ` (${waiting})` : ''}
        </button>
      </div>

      {tab === 'room' && (
        <>
          {roomError && (
            <div className="banner danger" style={{ marginBottom: 10 }}>
              <span>⚠</span><div>{roomError}</div>
            </div>
          )}
          <div className="chat-box" ref={roomBoxRef} style={{ maxHeight: '42vh', marginBottom: 10 }}>
            {roomMessages.length === 0 && <p className="muted">Belum ada pesan di ruang chat ini.</p>}
            {roomMessages.map((m) => {
              const mine = m.sender_id === user?.id;
              const roleLabel = ROOM_ROLE_LABEL[m.sender_role] || '';
              return (
                <div key={m.id} className={`bubble-row ${mine ? 'staff' : 'parent'}`}>
                  <div className={`bubble ${mine ? 'staff' : 'parent'}`}>
                    {!mine && (
                      <div className="who">{m.sender_name}{roleLabel ? ` · ${roleLabel}` : ''}</div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    <div className="when">{m.created_at ? `${shortDate(m.created_at)} ${timeOnly(m.created_at)}` : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {roomCanPost ? (
            <form className="chat-compose" onSubmit={sendRoom}>
              <textarea rows={2} value={roomBody} maxLength={2000}
                        placeholder="Tulis pesan ke ruang chat…"
                        onChange={(e) => setRoomBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRoom(e); }
                        }} />
              <button type="submit" disabled={roomSending || !roomBody.trim()}>
                {roomSending ? '…' : 'Kirim'}
              </button>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>Peran Anda hanya dapat membaca ruang chat ini.</p>
          )}
        </>
      )}

      {tab === 'personal' && (
        <>
          {error && (
            <div className="banner danger" style={{ marginBottom: 10 }}>
              <span>⚠</span><div>{error}</div>
            </div>
          )}

          {threads.length === 0 && <p className="muted">Belum ada percakapan.</p>}

          <div className="chat-admin">
            <div className="thread-list">
              {threads.map((t) => (
                <button key={t.thread_id}
                        className={`thread-row${openId === t.thread_id ? ' on' : ''}`}
                        onClick={() => setOpenId(openId === t.thread_id ? null : t.thread_id)}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{t.parent_name}</span>
                    <span className="preview">
                      {t.last_side === 'staff' ? 'Anda: ' : ''}{t.last_body || '—'}
                    </span>
                  </span>
                  {t.unread > 0 && <span className="chip danger">{t.unread}</span>}
                </button>
              ))}
            </div>

            {thread && (
              <div className="thread-open">
                <div className="row" style={{ marginBottom: 8 }}>
                  <div className="grow">
                    <strong>{thread.thread.parent_name}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {thread.thread.parent_email}
                      {thread.thread.phone_primary ? ` · ${thread.thread.phone_primary}` : ''}
                    </div>
                  </div>
                  <button className="ghost" onClick={() => setOpenId(null)}>Tutup</button>
                </div>

                <div className="chat-box" ref={boxRef} style={{ maxHeight: '42vh', marginBottom: 10 }}>
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`bubble-row ${m.sender_side === 'staff' ? 'parent' : 'staff'}`}>
                      <div className={`bubble ${m.sender_side === 'staff' ? 'parent' : 'staff'}`}>
                        {m.sender_side === 'parent' && <div className="who">{m.sender_name}</div>}
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                        <div className="when">{m.created_at ? `${shortDate(m.created_at)} ${timeOnly(m.created_at)}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <form className="chat-compose" onSubmit={reply}>
                  <textarea rows={2} value={body} maxLength={2000}
                            placeholder="Balas pesan…"
                            onChange={(e) => setBody(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(e); }
                            }} />
                  <button type="submit" disabled={sending || !body.trim()}>
                    {sending ? '…' : 'Balas'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </>
      )}
    </details>
  );
}

/** Internal room shared with Driver/Helper — see ChatPage.jsx's GroupThread
 * for the same room from their side. Separate from ChatHubPanel above: that
 * one is parents (room + personal threads), this is one flat room for the
 * ops team only. */
function GroupChatPanel({ user }) {
  const [messages, setMessages] = useState(null);
  const [canPost, setCanPost] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const load = useCallback(({ scroll = false } = {}) => {
    api.groupChat()
      .then((d) => {
        setMessages(d.messages);
        setCanPost(d.can_post !== false);
        if (scroll) setTimeout(() => endRef.current?.scrollIntoView(), 50);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 20000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await api.sendGroupChat(text);
      setBody('');
      load({ scroll: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!messages) return null;

  return (
    <details className="card">
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">👥</span>
        <span className="grow">
          Group Tim Transportasi
          <div className="sub">Bersama Driver &amp; Helper · {messages.length} pesan</div>
        </span>
      </summary>

      {error && (
        <div className="banner danger" style={{ marginTop: 12 }}>
          <span>⚠</span><div>{error}</div>
        </div>
      )}

      <div className="chat-box" style={{ maxHeight: '42vh', marginTop: 12, marginBottom: 10 }}>
        {messages.length === 0 && <p className="muted">Belum ada pesan di group ini.</p>}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'staff' : 'parent'}`}>
              <div className={`bubble ${mine ? 'staff' : 'parent'}`}>
                {!mine && <div className="who">{m.sender_name}</div>}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                <div className="when">{m.created_at ? `${shortDate(m.created_at)} ${timeOnly(m.created_at)}` : ''}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <form className="chat-compose" onSubmit={send}>
          <textarea rows={2} value={body} maxLength={2000}
                    placeholder="Tulis pesan ke group…"
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                    }} />
          <button type="submit" disabled={sending || !body.trim()}>
            {sending ? '…' : 'Kirim'}
          </button>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>Peran Anda hanya dapat membaca group ini.</p>
      )}
    </details>
  );
}

/**
 * "Laporkan Keluhan" submissions from the parent dashboard. The parent's email
 * already went out at submit time (backend/routes/complaints.js); this panel
 * exists so a complaint doesn't only live in an inbox someone has to remember
 * to check, and so the Transport Team can mark one handled.
 */
/** Parent-initiated requests to edit data on an already-approved application
 * (see ParentHomePage.jsx's "Ajukan Perubahan Data"). Approving flips the
 * application back to 'revision_requested', reusing the same edit form an
 * admin-initiated correction uses. */
function EditRequestsPanel() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.adminEditRequests().then(setRows).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(id) {
    setBusyId(id);
    try {
      await api.approveEditRequest(id);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deny(id) {
    const reason = prompt('Alasan menolak permintaan ini (opsional):') ?? '';
    setBusyId(id);
    try {
      await api.denyEditRequest(id, reason);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="banner danger"><span>⚠</span><div>{error}</div></div>;
  if (!rows) return null;

  return (
    <details className="card" open={rows.length > 0}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">✎</span>
        <span className="grow">
          Permintaan Edit Data
          <div className="sub">
            {rows.length === 0 ? 'Tidak ada permintaan menunggu' : `${rows.length} menunggu persetujuan`}
          </div>
        </span>
      </summary>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Siswa</th><th>Orang Tua</th><th>Alasan</th><th>Diajukan</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">Belum ada permintaan.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.student_name}</div>
                  <div className="muted">{r.application_no} · {r.grade_label}</div>
                </td>
                <td>
                  {r.parent_name}
                  <div className="muted">{r.phone_primary || '—'}</div>
                </td>
                <td className="muted" style={{ maxWidth: 280, whiteSpace: 'pre-line' }}>
                  {r.edit_request_note}
                </td>
                <td className="muted">{shortDate(r.edit_requested_at)}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button disabled={busyId === r.id} onClick={() => approve(r.id)}>
                      Setujui
                    </button>
                    <button className="ghost" disabled={busyId === r.id} onClick={() => deny(r.id)}>
                      Tolak
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ComplaintsPanel() {
  const [complaints, setComplaints] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.adminComplaints().then(setComplaints).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCount = complaints?.filter((c) => c.status !== 'selesai').length ?? 0;

  async function setStatus(id, status) {
    setBusyId(id);
    try {
      await api.setComplaintStatus(id, status);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="banner danger"><span>⚠</span><div>{error}</div></div>;
  if (!complaints) return null;

  return (
    // Open by default only when something still needs attention — an empty or
    // fully-resolved list collapses out of the way like the capacity table.
    <details className="card" open={openCount > 0}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">✉️</span>
        <span className="grow">
          Keluhan Orang Tua
          <div className="sub">
            {openCount === 0 ? 'Tidak ada keluhan yang menunggu' : `${openCount} belum selesai`}
          </div>
        </span>
      </summary>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Judul</th><th>Orang Tua</th><th>Siswa</th><th>Diajukan</th>
              <th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {complaints.length === 0 && (
              <tr><td colSpan={6} className="muted">Belum ada keluhan.</td></tr>
            )}
            {complaints.map((c) => (
              <tr key={c.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{c.subject}</div>
                  <div className="muted" style={{ maxWidth: 320, whiteSpace: 'pre-line' }}>
                    {c.message}
                  </div>
                </td>
                <td>
                  {c.parent_name}
                  <div className="muted">{c.parent_email}{c.phone_primary ? ` · ${c.phone_primary}` : ''}</div>
                </td>
                <td>{c.student_name || '—'}</td>
                <td className="muted">{shortDate(c.created_at)}</td>
                <td>
                  <span className={`chip ${c.status === 'selesai' ? 'ok' : c.status === 'ditinjau' ? 'warn' : 'danger'}`}>
                    {{ baru: 'BARU', ditinjau: 'DITINJAU', selesai: 'SELESAI' }[c.status]}
                  </span>
                </td>
                <td>
                  {c.status !== 'ditinjau' && c.status !== 'selesai' && (
                    <button className="ghost" disabled={busyId === c.id}
                            onClick={() => setStatus(c.id, 'ditinjau')}>
                      Tandai Ditinjau
                    </button>
                  )}
                  {c.status !== 'selesai' && (
                    <button className="ghost" disabled={busyId === c.id}
                            onClick={() => setStatus(c.id, 'selesai')}>
                      Tandai Selesai
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Transport Team's view of the daily driver/helper safety checklists — flags
 * anything marked NO so a bus-floor issue doesn't sit unseen until someone
 * happens to ask. Read-only here: the checklist itself is filled in by staff
 * on the bus floor (SafetyChecklistPage), not corrected from the admin side.
 */
function SafetyChecklistPanel() {
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);

  useEffect(() => {
    api.safetyChecklists().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api.safetyChecklist(openId).then(setDetail).catch((e) => setError(e.message));
  }, [openId]);

  const issueCount = rows?.filter((r) => r.has_issues).length ?? 0;
  const todayCount = rows?.filter((r) => r.checklist_date === todayWIT()).length ?? 0;

  // One page per calendar day — rows already come back ordered by
  // checklist_date DESC, so the distinct dates in that order are the pages;
  // dayIndex 0 is the most recent day with a checklist filled in.
  const days = [...new Set((rows || []).map((r) => r.checklist_date))];
  const clampedIndex = Math.min(dayIndex, Math.max(days.length - 1, 0));
  const currentDate = days[clampedIndex];
  const dayRows = (rows || []).filter((r) => r.checklist_date === currentDate);

  if (error) return <div className="banner danger"><span>⚠</span><div>{error}</div></div>;
  if (!rows) return null;

  return (
    <details className="card" open={issueCount > 0}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🦺</span>
        <span className="grow">
          Checklist Keselamatan Harian
          <div className="sub">
            {todayCount} diisi hari ini
            {issueCount > 0 ? ` · ${issueCount} ada poin NO` : ' · tidak ada masalah'}
          </div>
        </span>
      </summary>

      {days.length > 0 && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8 }}>
          <button className="ghost" disabled={clampedIndex >= days.length - 1}
                  onClick={() => setDayIndex(clampedIndex + 1)}>‹ Hari sebelumnya</button>
          <strong style={{ fontSize: 13.5 }}>
            {shortDate(currentDate)} · hari {clampedIndex + 1}/{days.length}
          </strong>
          <button className="ghost" disabled={clampedIndex <= 0}
                  onClick={() => setDayIndex(clampedIndex - 1)}>Hari berikutnya ›</button>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Tanggal</th><th>Waktu</th><th>Unit</th><th>Jenis</th><th>Petugas</th>
              <th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {dayRows.length === 0 && (
              <tr><td colSpan={7} className="muted">Belum ada checklist yang diisi.</td></tr>
            )}
            {dayRows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{shortDate(r.checklist_date)}</td>
                <td className="muted">{formatWIT(r.updated_at || r.created_at) || '—'}</td>
                <td>{r.plate_number}{r.label ? ` (${r.label})` : ''}</td>
                <td>{r.type_label}</td>
                <td>{r.crew_name || '—'}</td>
                <td>
                  {r.has_issues
                    ? <span className="chip danger">NO</span>
                    : <span className="chip ok">YES</span>}
                </td>
                <td><button className="ghost" onClick={() => setOpenId(r.id)}>Lihat</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && (
        <div className="banner info" style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <span>🦺</span>
          <div style={{ width: '100%' }}>
            {!detail && <p className="muted">Memuat…</p>}
            {detail && (
              <>
                <strong>
                  {detail.plate_number}{detail.label ? ` (${detail.label})` : ''} ·{' '}
                  {detail.type_label} · {shortDate(detail.checklist_date)}
                  {formatWIT(detail.updated_at || detail.created_at)
                    ? ` ${formatWIT(detail.updated_at || detail.created_at)} WIT` : ''}
                </strong>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Petugas: {detail.crew_name || '—'} · Diisi oleh: {detail.submitted_by_name || '—'}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  {detail.items.filter((i) => i.status === 'not_ok').length === 0 ? (
                    <div>Tidak ada poin NO.</div>
                  ) : detail.items.filter((i) => i.status === 'not_ok').map((i) => (
                    <div key={i.item_key} style={{ fontSize: 13 }}>
                      <span className="chip danger" style={{ marginRight: 6 }}>NO</span>
                      {i.text}
                      {i.note && <div className="muted" style={{ marginLeft: 2 }}>Catatan: {i.note}</div>}
                    </div>
                  ))}
                </div>
                {detail.notes && (
                  <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                    Catatan umum: {detail.notes}
                  </div>
                )}
                <button className="ghost" style={{ marginTop: 10 }} onClick={() => setOpenId(null)}>Tutup</button>
              </>
            )}
          </div>
        </div>
      )}
    </details>
  );
}

const Stat = ({ n, k, tone = '', ico = '•' }) => (
  <div className={`stat ${tone}`}>
    <span className="badge" aria-hidden="true">{ico}</span>
    <span>
      <div className="n">{n}</div>
      <div className="k">{k}</div>
    </span>
  </div>
);

const Check = ({ ok, text }) => (
  <div className="row" style={{ padding: '3px 0' }}>
    <span style={{ color: ok ? 'var(--success)' : 'var(--warning)' }}>{ok ? '✓' : '⚠'}</span>
    <span style={{ fontSize: 14 }}>{text}</span>
  </div>
);

/** Suggests the route that already serves the requested stop. */
function suggestRoute(detail) {
  const stop = detail.stops.find((s) => s.id === detail.requested_stop_id);
  if (!stop) return null;
  const byArea = { KK: 'KK-A', TIMIKA: 'TMK-A', SP2: 'SP2-A', SP3: 'SP3-A' };
  return detail.routes.find((r) => r.code === byArea[stop.area])?.id || null;
}

// Seat counts used across the fleet.
const SEAT_OPTIONS = [27, 30, 60];

// GRADES/SCHOOL_CATEGORIES/categoryOfGrade now live in
// ../components/GradeCharts.jsx (imported above), shared with the Guru
// dashboard — keep GRADES in sync with backend/lib/cards.js.

// v is a SQLite UTC timestamp with no offset ('YYYY-MM-DD HH:MM:SS') — reading
// it without a 'Z' and without an explicit timeZone (the old code here) just
// prints the UTC clock/date back unconverted. WIT is UTC+9, so a UTC time
// past 15:00 is already the next WIT day — worth converting properly rather
// than only fixing the hour/minute (see formatWIT in api.js).
const shortDate = (v) => (v
  ? new Date(`${v.replace(' ', 'T')}Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jayapura' })
  : '—');

const timeOnly = (v) => formatWIT(v) || '—';

/** wa.me deep link for a parent's phone_primary — opens WhatsApp (web or
 * app) with the number and message pre-filled; the staff member still has
 * to press send themselves, so this is just a shortcut, not an auto-sender.
 * Indonesian numbers are stored in varied local formats (0812…, 62812…,
 * +62812…, with spaces/dashes), so normalise to bare 62-prefixed digits,
 * which is what wa.me requires. */
function waLink(phone, message) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (!digits.startsWith('62')) digits = `62${digits}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

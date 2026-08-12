import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, todayWIT, formatWIT } from '../api';

// v is a SQLite UTC timestamp with no offset — read as UTC explicitly and
// re-render in WIT, same approach as formatWIT (see api.js).
const shortDateWIT = (v) => (v
  ? new Date(`${v.replace(' ', 'T')}Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jayapura' })
  : '—');

import TodayBanner from '../components/TodayBanner.jsx';

/**
 * Daily driver/helper safety checklist — "Form Checklist & SOP Operasional Bus
 * Sekolah". Same staff tier as the scanner (no separate driver/helper login,
 * see the crew-name comment in backend/db.js): whoever is on shift picks the
 * unit, picks which of the two SOP forms they're filling in, and names the
 * driver/helper actually being checked.
 *
 * One submission per bus/type/day — reopening today's already-filled form
 * loads the existing answers so a correction overwrites rather than duplicates.
 */
export default function SafetyChecklistPage({ user }) {
  const navigate = useNavigate();
  // Contractor (bus company leadership) reaches this page for the fleet-wide
  // history only — see App.jsx's canViewChecklistHistory — never the
  // submission form, so every crew-only section below is skipped for them.
  const isContractor = user?.role === 'contractor';
  const [defs, setDefs] = useState(null);
  const [buses, setBuses] = useState(null);
  // Default to the form matching the logged-in role, so a helper doesn't land
  // on "Driver (Pre-Op)" first and have to switch before the unit auto-fills.
  const [checklistType, setChecklistType] = useState(
    user?.role === 'helper' ? 'helper_safety_trip' : 'driver_pre_op',
  );
  const [busId, setBusId] = useState('');
  const [crewName, setCrewName] = useState('');
  const [notes, setNotes] = useState('');
  const [answers, setAnswers] = useState({});     // item_key -> { status, note }
  const [existingId, setExistingId] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  // Every crew member's submissions, not just this user's own — a shared
  // reminder/control board so driver and helper can see at a glance whether
  // the other has filled in theirs today, same table shape as Tim
  // Transportasi's dashboard panel (see SafetyChecklistPanel in
  // AdminQueuePage.jsx), just placed below the form instead of in an
  // admin-only page.
  const [history, setHistory] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);

  const loadHistory = useCallback(() => {
    api.safetyChecklists().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    api.safetyDefinitions().then(setDefs).catch((e) => setError(e.message));
    api.meta().then((m) => setBuses(m.buses)).catch((e) => setError(e.message));
    loadHistory();
  }, [loadHistory]);

  // Auto-pick the unit this crew member is scheduled on today — same match
  // against the schedule's crew text fields as the scanner page, so a driver
  // or helper doesn't have to hunt through every plate number and risk
  // filling in the wrong unit's checklist.
  useEffect(() => {
    if (!buses || busId || !user?.name) return;
    const norm = (s) => (s || '').trim().toLowerCase();
    const mine = buses.find((b) => norm(
      checklistType === 'driver_pre_op' ? b.driver_name : b.helper_name,
    ) === norm(user.name));
    if (mine) setBusId(String(mine.id));
  }, [buses, user, checklistType, busId]);

  const def = defs?.[checklistType];
  const bus = buses?.find((b) => String(b.id) === busId);

  // Prefill the crew name from the schedule's driver/helper text — just a
  // starting point, still editable, since the person on shift can differ.
  useEffect(() => {
    if (!bus) return;
    setCrewName((checklistType === 'driver_pre_op' ? bus.driver_name : bus.helper_name) || '');
  }, [bus, checklistType]);

  // Load today's checklist for this bus/type, if one already exists, so a
  // resubmission is an edit rather than a blind overwrite.
  const loadExisting = useCallback(async () => {
    if (!busId || !checklistType) { setExistingId(null); setAnswers({}); setNotes(''); return; }
    setLoadingExisting(true);
    setDone(null);
    try {
      const list = await api.safetyChecklists({ bus_id: busId, checklist_type: checklistType });
      const today = list.find((c) => c.checklist_date === todayWIT());
      if (!today) { setExistingId(null); setAnswers({}); setNotes(''); return; }

      const full = await api.safetyChecklist(today.id);
      setExistingId(full.id);
      setNotes(full.notes || '');
      if (full.crew_name) setCrewName(full.crew_name);
      const next = {};
      full.items.forEach((i) => { next[i.item_key] = { status: i.status, note: i.note || '' }; });
      setAnswers(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingExisting(false);
    }
  }, [busId, checklistType]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  function setStatus(key, status) {
    setAnswers((a) => ({ ...a, [key]: { status, note: a[key]?.note || '' } }));
  }
  function setNote(key, note) {
    setAnswers((a) => ({ ...a, [key]: { status: a[key]?.status || null, note } }));
  }

  const allKeys = def ? def.sections.flatMap((s) => s.items.map((i) => i.key)) : [];
  const answeredCount = allKeys.filter((k) => answers[k]?.status).length;
  const missingNotes = allKeys.filter((k) => answers[k]?.status === 'not_ok' && !answers[k]?.note?.trim());
  const canSubmit = busId && answeredCount === allKeys.length && missingNotes.length === 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitSafetyChecklist({
        bus_id: Number(busId),
        checklist_type: checklistType,
        checklist_date: todayWIT(),
        crew_name: crewName,
        notes,
        items: allKeys.map((key) => ({
          item_key: key, status: answers[key].status, note: answers[key].note,
        })),
      });
      setDone(res);
      loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {isContractor ? (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className="on">Riwayat Checklist</button>
          <button onClick={() => navigate('/jadwal')}>📅 Jadwal</button>
          <button onClick={() => navigate('/lacak')}>🗺️ Lacak Bus</button>
          <button onClick={() => navigate('/kontraktor')}>Dashboard</button>
        </div>
      ) : (
        <>
          <section className="hero">
            <img className="hero-bus" src="/bus-icon.png" alt="" aria-hidden="true" />
            <div className="hero-greet">SELAMAT BERTUGAS</div>
            <div className="hero-name">{user?.name?.split(' ')[0] || 'Petugas'}</div>
            <div className="hero-sub">
              Isi checklist keselamatan harian sebelum unit beroperasi.
            </div>
            <TodayBanner />
            <div className="hero-stats">
              <div className="hero-stat">
                <div className="n">{buses?.length ?? 0}</div>
                <div className="k">Unit Aktif</div>
              </div>
              <div className="hero-stat">
                <div className="n">{answeredCount}</div>
                <div className="k">Poin Terisi</div>
              </div>
              <div className="hero-stat">
                <div className="n">{allKeys.length}</div>
                <div className="k">Total Item</div>
              </div>
            </div>
          </section>

          <div className="seg" style={{ marginBottom: 12 }}>
            <button className="on">Checklist Keselamatan</button>
            <button onClick={() => navigate('/scan')}>Pindai</button>
            <button onClick={() => navigate('/jadwal')}>📅 Jadwal</button>
            {['driver', 'helper'].includes(user?.role) && (
              <button onClick={() => navigate('/lacak')}>🗺️ Lacak Bus</button>
            )}
            {['driver', 'helper'].includes(user?.role) && (
              <button onClick={() => navigate('/event-request')}>🎉 Acara</button>
            )}
          </div>
        </>
      )}

      <h1>{isContractor ? 'Riwayat Checklist Keselamatan' : 'Checklist Keselamatan Harian'}</h1>
      <p className="muted">
        {isContractor
          ? 'Pengisian checklist keselamatan harian setiap unit bis, oleh Driver dan Helper.'
          : 'Form Checklist & SOP Operasional Bus Sekolah — diisi setiap hari sebelum beroperasi.'}
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {!isContractor && (
      <>
      <div className="card">
        <div className="field">
          <label>Jenis Checklist</label>
          <div className="seg" style={{ marginBottom: 0 }}>
            <button className={checklistType === 'driver_pre_op' ? 'on' : ''}
                    onClick={() => setChecklistType('driver_pre_op')}>Driver (Pre-Op)</button>
            <button className={checklistType === 'helper_safety_trip' ? 'on' : ''}
                    onClick={() => setChecklistType('helper_safety_trip')}>Helper (Safety Trip)</button>
          </div>
        </div>

        <div className="field">
          <label>Unit Bis</label>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}>
            <option value="">— Pilih unit —</option>
            {buses?.map((b) => (
              <option key={b.id} value={b.id}>{b.plate_number}{b.label ? ` (${b.label})` : ''}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Nama {def?.role_label || 'Petugas'}</label>
          <input value={crewName} onChange={(e) => setCrewName(e.target.value)}
                 placeholder="Nama yang diperiksa" />
        </div>

        {existingId && (
          <div className="banner warn">
            <span>ℹ</span>
            <div>Checklist hari ini untuk unit ini sudah pernah diisi. Perubahan akan menimpa isian sebelumnya.</div>
          </div>
        )}
      </div>

      {def && busId && (
        <>
          {def.intro && (
            <div className="banner warn"><span>ℹ</span><div>{def.intro}</div></div>
          )}

          {loadingExisting && <p className="muted">Memuat isian sebelumnya…</p>}

          {def.sections.map((section) => (
            <div className="card" key={section.key}>
              <h3 style={{ marginTop: 0 }}>{section.key}. {section.title}</h3>
              <div className="col" style={{ gap: 16 }}>
                {section.items.map((item) => {
                  const a = answers[item.key];
                  return (
                    <div key={item.key}>
                      <div style={{ fontSize: 14, marginBottom: 8 }}>{item.text}</div>
                      <div className="seg" style={{ marginBottom: a?.status === 'not_ok' ? 8 : 0 }}>
                        <button className={a?.status === 'ok' ? 'on' : ''}
                                onClick={() => setStatus(item.key, 'ok')}>YES</button>
                        <button className={a?.status === 'not_ok' ? 'on' : ''}
                                style={a?.status === 'not_ok' ? { background: 'var(--danger)' } : undefined}
                                onClick={() => setStatus(item.key, 'not_ok')}>NO</button>
                        <button className={a?.status === 'na' ? 'on' : ''}
                                onClick={() => setStatus(item.key, 'na')}>N/A</button>
                      </div>
                      {a?.status === 'not_ok' && (
                        <input placeholder="Keterangan (wajib)" value={a.note || ''}
                               onChange={(e) => setNote(item.key, e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="card">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Catatan Umum (opsional)</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                        placeholder="Catatan tambahan untuk Tim Transportasi…" />
            </div>
          </div>

          {done ? (
            <div className="banner success">
              <span>✅</span>
              <div>
                Checklist tersimpan.
                {done.has_issues && ' Ada poin NO — Tim Transportasi akan meninjau catatan Anda.'}
              </div>
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                {answeredCount}/{allKeys.length} poin terisi
                {missingNotes.length > 0 ? ` · ${missingNotes.length} keterangan NO belum diisi` : ''}
              </p>
              <button className="block" disabled={!canSubmit} onClick={submit}>
                {busy ? 'Menyimpan…' : 'Simpan Checklist'}
              </button>
            </>
          )}
        </>
      )}
      </>
      )}

      {history && <ChecklistHistoryPanel rows={history} dayIndex={dayIndex} setDayIndex={setDayIndex} />}
    </div>
  );
}

/** All crew's submissions, paginated one calendar day at a time — same
 * shape as Tim Transportasi's SafetyChecklistPanel (AdminQueuePage.jsx), so
 * driver and helper can check each other's checklist without needing the
 * admin dashboard: "did the other person on my unit fill theirs in today?" */
function ChecklistHistoryPanel({ rows, dayIndex, setDayIndex }) {
  const todayCount = rows.filter((r) => r.checklist_date === todayWIT()).length;
  const issueCount = rows.filter((r) => r.has_issues).length;

  const days = [...new Set(rows.map((r) => r.checklist_date))];
  const clampedIndex = Math.min(dayIndex, Math.max(days.length - 1, 0));
  const currentDate = days[clampedIndex];
  const dayRows = rows.filter((r) => r.checklist_date === currentDate);

  return (
    <details className="card" style={{ marginTop: 16 }} open>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🦺</span>
        <span className="grow">
          Riwayat Checklist Semua Unit
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
            {shortDateWIT(currentDate)} · hari {clampedIndex + 1}/{days.length}
          </strong>
          <button className="ghost" disabled={clampedIndex <= 0}
                  onClick={() => setDayIndex(clampedIndex - 1)}>Hari berikutnya ›</button>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>Tanggal</th><th>Waktu</th><th>Unit</th><th>Jenis</th><th>Petugas</th><th>Status</th></tr>
          </thead>
          <tbody>
            {dayRows.length === 0 && (
              <tr><td colSpan={6} className="muted">Belum ada checklist yang diisi.</td></tr>
            )}
            {dayRows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{shortDateWIT(r.checklist_date)}</td>
                <td className="muted">{formatWIT(r.updated_at || r.created_at) || '—'}</td>
                <td>{r.plate_number}{r.label ? ` (${r.label})` : ''}</td>
                <td>{r.type_label}</td>
                <td>{r.crew_name || '—'}</td>
                <td>
                  {r.has_issues
                    ? <span className="chip danger">NO</span>
                    : <span className="chip ok">YES</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

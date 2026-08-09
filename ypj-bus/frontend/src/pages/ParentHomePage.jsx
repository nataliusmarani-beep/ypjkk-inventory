import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, photoUrl, formatWIT } from '../api';

const STATUS = {
  draft:              { label: 'Draf',                 chip: 'neutral' },
  submitted:          { label: 'Menunggu Verifikasi',  chip: 'warn' },
  under_review:       { label: 'Sedang Ditinjau',      chip: 'warn' },
  revision_requested: { label: 'Perlu Perbaikan',      chip: 'danger' },
  approved:           { label: 'Disetujui',            chip: 'ok' },
  rejected:           { label: 'Ditolak',              chip: 'danger' },
  cancelled:          { label: 'Dibatalkan',           chip: 'neutral' },
};

const CARD_STATUS = {
  active:    { label: 'AKTIF',         chip: 'ok' },
  suspended: { label: 'DITANGGUHKAN',  chip: 'warn' },
  revoked:   { label: 'DICABUT',       chip: 'danger' },
  expired:   { label: 'KADALUARSA',    chip: 'neutral' },
};

const PENDING_STATUSES = ['submitted', 'under_review', 'revision_requested'];

/**
 * Parent dashboard. One card per child — "Ketentuan 1 form 1 siswa" was only a
 * sentence on the old form and people ignored it; here it is the shape of the
 * screen.
 *
 * The hero and tile layout follow a modern transport-app pattern, but the
 * functional bits are unchanged: status is still stated in words as well as
 * colour, and the child's stop and times are on the dashboard so a parent
 * doesn't have to open the card to know when to be at the shelter.
 */
export default function ParentHomePage({ user }) {
  const [apps, setApps] = useState(null);
  const [notes, setNotes] = useState([]);
  const [spotlights, setSpotlights] = useState([]);
  const [times, setTimes] = useState({});   // stop_code -> { pickup, dropoff }
  const [trips, setTrips] = useState([]);   // live "bus has departed" notices
  const [chatUnread, setChatUnread] = useState(0);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  async function load() {
    try {
      const [a, n] = await Promise.all([api.myApplications(), api.notifications()]);
      setApps(a);
      setNotes(n.filter((x) => !x.read_at && x.template !== 'admin.broadcast'));
      setSpotlights(n.filter((x) => !x.read_at && x.template === 'admin.broadcast'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  // "Has the bus left yet?" — the no-GPS trip status. Polled while the page is
  // open, because a parent checking this is usually about to walk to the shelter.
  useEffect(() => {
    let alive = true;
    const pull = () => api.tripStatus()
      .then((t) => { if (alive) setTrips(t); })
      .catch(() => {});
    pull();
    const timer = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Unread replies from the Transport Team, for the badge on the chat tile.
  useEffect(() => {
    let alive = true;
    const pull = () => api.chatUnread()
      .then((d) => { if (alive) setChatUnread(d.unread); })
      .catch(() => {});
    pull();
    const timer = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Schedule is a separate, optional fetch: if it fails the dashboard still
  // works, it just won't show pickup times.
  useEffect(() => {
    api.schedule()
      .then((d) => {
        // Schedule is keyed by bus now, not route. Several units can serve the
        // same TPS, so keep the earliest pickup for a stop — that is the time a
        // parent has to be ready by.
        const map = {};
        for (const bus of d.buses) {
          for (const s of bus.stops) {
            // A stop can now have more than one pickup trip (e.g. served
            // again later for a different unit) — the earliest of THIS
            // stop's own times is still what matters to a parent.
            const earliest = (s.pickup_times || []).filter(Boolean).sort()[0] || null;
            const seen = map[s.stop_code];
            if (!seen || (earliest && earliest < seen.pickup)) {
              map[s.stop_code] = { pickup: earliest, dropoff: s.dropoff_times?.join(', ') || null };
            }
          }
        }
        setTimes(map);
      })
      .catch(() => {});
  }, []);

  async function cancel(id) {
    if (!confirm('Batalkan pengajuan ini?')) return;
    try {
      await api.cancelApplication(id);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function requestEdit(id, note) {
    await api.requestEdit(id, note);
    load();
  }

  const activeCards = apps?.filter((a) => a.card_status === 'active').length ?? 0;
  const pending     = apps?.filter((a) => PENDING_STATUSES.includes(a.status)).length ?? 0;
  const children    = new Set(apps?.map((a) => a.student_id)).size;

  return (
    <div className="page">
      {/* Admin announcements ("Semua Pengguna" broadcasts) get their own
          spotlighted slot above the hero — a schedule change or emergency
          notice shouldn't blend in with routine per-child banners further
          down the page. */}
      {spotlights.map((n) => (
        <div className="spotlight" key={n.id}>
          <span className="spotlight-ico">📢</span>
          <div className="grow">
            <div className="spotlight-title">{n.title}</div>
            <div className="spotlight-body">{n.body}</div>
            <button className="link spotlight-dismiss" onClick={() => {
              api.markNotification(n.id).then(load).catch(() => {});
            }}>Tandai sudah dibaca</button>
          </div>
        </div>
      ))}

      <section className="hero">
        <img className="hero-bus" src="/bus-icon.png" alt="" aria-hidden="true" />
        <div className="hero-greet">SELAMAT DATANG</div>
        <div className="hero-name">{user.name.split(' ')[0]}</div>
        <div className="hero-sub">
          Kelola pengajuan dan Kartu Akses Bis anak Anda di satu tempat.
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="n">{children}</div>
            <div className="k">Anak Terdaftar</div>
          </div>
          <div className="hero-stat">
            <div className="n">{activeCards}</div>
            <div className="k">Kartu Aktif</div>
          </div>
          <div className="hero-stat">
            <div className="n">{pending}</div>
            <div className="k">Menunggu</div>
          </div>
        </div>
      </section>

      <div className="quick-grid">
        <button className="quick-tile" onClick={() => navigate('/peraturan')}>
          <span className="ico">📋</span>
          <span className="lbl">Peraturan &amp; Kebijakan</span>
        </button>
        <button className="quick-tile" onClick={() => navigate('/keluhan')}>
          <span className="ico">✉️</span>
          <span className="lbl">Laporkan Keluhan</span>
        </button>
        <button className="quick-tile" onClick={() => navigate('/jadwal')}>
          <span className="ico">🕒</span>
          <span className="lbl">Jadwal Pelayanan</span>
        </button>
        <button className="quick-tile" onClick={() => navigate('/lacak')}>
          <span className="ico">🗺️</span>
          <span className="lbl">Lacak Bus</span>
        </button>
        <button className="quick-tile" onClick={() => navigate('/chat')}>
          <span className="ico">
            💬
            {chatUnread > 0 && <span className="tile-badge">{chatUnread}</span>}
          </span>
          <span className="lbl">Chat Tim Transportasi</span>
        </button>
      </div>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {/* Live trip notice. Shown only while a bus is actually en route to this
          family's stop, so an empty dashboard means nothing is moving rather
          than a stale position. */}
      {trips.map((t, i) => (
        <div className="banner success" key={i}>
          <span>🚌</span>
          <div>
            <strong>
              Bis {t.plate_number} menuju {t.stop_code}
              {t.stops_away === 1 ? ' — TPS Anda berikutnya' : ` — ${t.stops_away} TPS lagi`}
            </strong>
            Berangkat dari {t.departed_from} pukul {formatWIT(t.departed_at)} WIT
            {t.eta && ` · perkiraan tiba ${t.eta} WIT`}
            {t.stops_away === 1 && ' · mohon sudah berada di titik penjemputan.'}
          </div>
        </div>
      ))}

      {/* Only the two newest notices are expanded: what a parent opens the app
          for is their child's card, and a backlog of unread notices used to push
          it several screens down. */}
      {notes.slice(0, showAllNotes ? undefined : 2).map((n) => (
        <div key={n.id} className="banner info">
          <span>🔔</span>
          <div>
            <strong>{n.title}</strong>
            <div style={{ whiteSpace: 'pre-line' }}>{n.body}</div>
            <button className="link" onClick={() => {
              api.markNotification(n.id).then(load).catch(() => {});
            }}>Tandai sudah dibaca</button>
          </div>
        </div>
      ))}
      {notes.length > 2 && !showAllNotes && (
        <button className="link" style={{ marginBottom: 12 }}
                onClick={() => setShowAllNotes(true)}>
          Lihat {notes.length - 2} pemberitahuan lainnya
        </button>
      )}

      {apps === null && <p className="muted">Memuat…</p>}

      {apps?.length === 0 && (
        <div className="card center">
          <div style={{ fontSize: 38, marginBottom: 6 }}>🚌</div>
          <h3>Belum ada pengajuan</h3>
          <p className="muted">
            Tekan tombol di bawah untuk mendaftarkan anak Anda sebagai pengguna
            bis sekolah.
          </p>
        </div>
      )}

      {apps?.length > 0 && <div className="section-title">ANAK TERDAFTAR</div>}

      {apps?.map((a) => {
        const status = STATUS[a.status] || STATUS.draft;
        const card = a.card_id ? CARD_STATUS[a.card_status] : null;
        const stopCode = a.assigned_stop_code || a.requested_stop_code;
        const stopName = a.assigned_stop_name || a.requested_stop_name;
        const t = times[stopCode];

        return (
          <div className="card kid-card" key={a.id}>
            <div className="kid-head">
              <div className="kid-photo">
                {a.photo_file
                  ? <img src={photoUrl(a.photo_file)} alt="" />
                  : <span className="muted" style={{ fontSize: 22 }}>👤</span>}
              </div>
              <div className="grow">
                <div className="kid-name">{a.student_name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{gradeLabel(a.grade)}</div>
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span className={`chip ${status.chip}`}>{status.label}</span>
                  {card && <span className={`chip ${card.chip}`}>KARTU {card.label}</span>}
                </div>
              </div>
            </div>

            <div className="kid-facts">
              <div className="kid-fact">
                <span className="ico">📍</span>
                <span>
                  <span className="val">{stopCode}</span> {stopName}
                  {!a.assigned_stop_code && <span className="muted"> (diminta)</span>}
                </span>
              </div>
              {a.route_code && (
                <div className="kid-fact">
                  <span className="ico">🚌</span>
                  <span>Rute <span className="val">{a.route_code}</span></span>
                </div>
              )}
              {t?.pickup && (
                <div className="kid-fact">
                  <span className="ico">🕒</span>
                  <span>
                    Penjemputan <span className="val">{t.pickup}</span>
                    {t.dropoff && <> · Pengantaran <span className="val">{t.dropoff}</span></>}
                  </span>
                </div>
              )}
              {a.application_no && (
                <div className="kid-fact">
                  <span className="ico">#</span>
                  <span className="muted">{a.application_no}</span>
                </div>
              )}
            </div>

            {a.status === 'rejected' && (
              <div className="banner danger" style={{ marginTop: 12, marginBottom: 0 }}>
                <span>⚠</span>
                <div><strong>Alasan penolakan</strong>{a.rejection_reason}</div>
              </div>
            )}
            {a.status === 'revision_requested' && (
              <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
                <span>✎</span>
                <div><strong>Perlu perbaikan</strong>{a.revision_note}</div>
              </div>
            )}
            {a.status === 'approved' && a.edit_requested_at && (
              <div className="banner info" style={{ marginTop: 12, marginBottom: 0 }}>
                <span>⏳</span>
                <div>Menunggu persetujuan Tim Transportasi untuk mengedit data.</div>
              </div>
            )}

            <div className="row" style={{ marginTop: 14, gap: 10 }}>
              {a.card_id && a.card_status === 'active' && (
                <Link to={`/kartu/${a.card_id}`} className="grow">
                  <button className="block">Lihat Kartu Akses →</button>
                </Link>
              )}
              {a.card_id && a.card_status !== 'active' && (
                <Link to={`/kartu/${a.card_id}`} className="grow">
                  <button className="ghost block">Lihat Status Kartu</button>
                </Link>
              )}
              {a.status === 'revision_requested' && (
                <Link to={`/ajukan/${a.id}/perbaiki`} className="grow">
                  <button className="block">✎ Perbaiki &amp; Kirim Ulang</button>
                </Link>
              )}
              {PENDING_STATUSES.includes(a.status) && (
                <button className="ghost" onClick={() => cancel(a.id)}>Batalkan</button>
              )}
            </div>

            {a.status === 'approved' && (
              <EditRequestControl app={a} onSubmit={requestEdit} />
            )}
          </div>
        );
      })}

      <div className="actions">
        <button className="grow" onClick={() => navigate('/ajukan')}>
          + Ajukan Siswa Baru
        </button>
      </div>
    </div>
  );
}

/**
 * "Data sudah disetujui tapi ada yang perlu diperbaiki" — a blurry photo
 * caught after the fact, a typo in the address, etc. Unlike a fresh
 * application, write access to an approved one is gated on Tim Transportasi
 * signing off first (see backend routes/applications.js's request-edit and
 * admin.js's approve/deny), so this only ever files the request — the actual
 * edit form only unlocks once approved.
 */
function EditRequestControl({ app, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (app.edit_requested_at) return null;

  if (!open) {
    return (
      <button className="link" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        Ajukan Perubahan Data
      </button>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!note.trim()) { setError('Jelaskan data apa yang perlu diperbaiki.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(app.id, note.trim());
      setOpen(false);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 10 }}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
        Contoh: foto siswa kurang jelas, alamat berubah, dsb. Tim Transportasi akan
        meninjau permintaan ini sebelum Anda dapat mengubah datanya.
      </p>
      {error && <div className="error" style={{ marginBottom: 6 }}>{error}</div>}
      <textarea rows={2} value={note} disabled={busy}
                placeholder="Data apa yang perlu diperbaiki?"
                onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button type="submit" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim Permintaan'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setOpen(false)}>Batal</button>
      </div>
    </form>
  );
}

const GRADE_LABELS = { toddler: 'Toddler', playgroup: 'Playgroup', tk_a: 'TK A', tk_b: 'TK B' };
export const gradeLabel = (g) => GRADE_LABELS[g] || `Kelas ${String(g).replace('kelas_', '')}`;

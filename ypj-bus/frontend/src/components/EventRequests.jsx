import { useCallback, useEffect, useState } from 'react';
import { api, documentUrl, formatWIT } from '../api';
import { dutyColor } from '../lib/dutyColor.js';

// v is a SQLite UTC timestamp with no offset ('YYYY-MM-DD HH:MM:SS') — read
// it as UTC explicitly and re-render in WIT, same approach as formatWIT.
const fullWIT = (v) => (v
  ? `${new Date(`${v.replace(' ', 'T')}Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jayapura' })} ${formatWIT(v)} WIT`
  : null);

const STATUS = {
  submitted: { label: 'Menunggu Persetujuan', chip: 'warn' },
  approved:  { label: 'Disetujui',            chip: 'ok' },
  rejected:  { label: 'Ditolak',               chip: 'danger' },
};

const PAGE_SIZE = 5;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Event bus requests — one-off service for school events (field trips,
 * ceremonies, etc.), separate from the weekly commute rotation managed in
 * "Jadwal & Rute per Bis".
 *
 * Shared between AdminQueuePage (Tim Transportasi / Leader, who see every
 * request) and EventRequestPage (Admin Sekolah, who sees only their own).
 * Who can submit vs. who can approve is decided by role, not by which page
 * embeds it — see backend/routes/eventRequests.js for the matching guard.
 */
export default function EventRequestsSection({ user }) {
  const [rows, setRows] = useState(null);
  const [buses, setBuses] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const canRequest = ['admin', 'leader'].includes(user?.role);
  const canDecide = user?.role === 'transport_admin' || user?.role === 'super_admin';

  const load = useCallback(() => {
    api.eventRequests().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (canDecide) api.meta().then((m) => setBuses(m.buses || [])).catch(() => {});
  }, [canDecide]);

  function handleAttachment(file) {
    if (!file) return;
    setError(null);
    if (!ATTACHMENT_TYPES.includes(file.type)) {
      setError('Lampiran harus berupa PDF, JPG, PNG atau WEBP.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`Ukuran lampiran ${(file.size / (1024 * 1024)).toFixed(1)} MB melebihi batas 5 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, attachment: reader.result, attachment_name: file.name }));
    reader.onerror = () => setError('Gagal membaca berkas lampiran.');
    reader.readAsDataURL(file);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy('new');
    setError(null);
    try {
      await api.createEventRequest({
        ...form,
        passenger_count: form.passenger_count || null,
      });
      setForm(emptyForm());
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(row, decision, extra = {}) {
    setBusy(row.id);
    setError(null);
    try {
      await api.decideEventRequest(row.id, { decision, ...extra });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!rows) return null;

  const pending = rows.filter((r) => r.status === 'submitted').length;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = rows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <details className="card" open={pending > 0}>
      <summary className="panel-summary">
        <span className="ico" aria-hidden="true">🎉</span>
        <span className="grow">
          Permintaan Bis untuk Acara Sekolah
          <div className="sub">
            {rows.length === 0 ? 'Belum ada permintaan'
              : pending > 0 ? `${pending} menunggu persetujuan` : 'Semua sudah diputuskan'}
          </div>
        </span>
      </summary>

      <p className="muted" style={{ marginTop: 12 }}>
        Untuk kebutuhan bis di luar rotasi mingguan biasa — study tour, upacara,
        lomba, dan acara sekolah lainnya. Setiap permintaan perlu persetujuan
        Tim Transportasi sebelum bis benar-benar ditugaskan.
      </p>

      {error && <div className="banner danger" style={{ marginBottom: 12 }}><span>⚠</span><div>{error}</div></div>}

      {canRequest && (
        !adding ? (
          <button className="ghost" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>
            + Ajukan Permintaan Baru
          </button>
        ) : (
          <form onSubmit={submit} className="col" style={{ gap: 10, maxWidth: 460, marginBottom: 16 }}>
            <label>
              <span className="lbl">Nama Acara</span>
              <input type="text" required value={form.event_name}
                     onChange={(e) => setForm({ ...form, event_name: e.target.value })} />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <label className="grow">
                <span className="lbl">Tanggal Acara</span>
                <input type="date" required value={form.event_date}
                       onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
              </label>
              <label className="grow">
                <span className="lbl">Jumlah Peserta</span>
                <input type="number" min="1" value={form.passenger_count}
                       onChange={(e) => setForm({ ...form, passenger_count: e.target.value })} />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <label className="grow">
                <span className="lbl">Jam Berangkat</span>
                <input type="time" value={form.departure_time}
                       onChange={(e) => setForm({ ...form, departure_time: e.target.value })} />
              </label>
              <label className="grow">
                <span className="lbl">Jam Kembali (opsional)</span>
                <input type="time" value={form.return_time}
                       onChange={(e) => setForm({ ...form, return_time: e.target.value })} />
              </label>
            </div>
            <label>
              <span className="lbl">Tujuan</span>
              <input type="text" required placeholder="Contoh: Museum Timika"
                     value={form.destination}
                     onChange={(e) => setForm({ ...form, destination: e.target.value })} />
            </label>
            <label>
              <span className="lbl">Catatan (opsional)</span>
              <textarea rows={2} value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <label>
              <span className="lbl">Lampiran — surat/flyer acara (opsional)</span>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                     onChange={(e) => handleAttachment(e.target.files?.[0])} />
              {form.attachment_name && (
                <div className="hint">✓ {form.attachment_name}</div>
              )}
              <div className="hint">PDF, JPG, PNG atau WEBP — maksimal 5 MB.</div>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button disabled={busy === 'new'}>{busy === 'new' ? 'Mengirim…' : 'Kirim Permintaan'}</button>
              <button type="button" className="ghost" disabled={busy === 'new'}
                      onClick={() => { setAdding(false); setError(null); }}>Batal</button>
            </div>
          </form>
        )
      )}

      {rows.length === 0 && <p className="muted">Belum ada permintaan bis untuk acara.</p>}

      {pageRows.map((r) => (
        <EventRequestRow key={r.id} row={r} buses={buses} canDecide={canDecide}
                          busy={busy === r.id} onDecide={decide} />
      ))}

      {rows.length > PAGE_SIZE && (
        <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
          <button className="ghost" disabled={clampedPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Sebelumnya</button>
          <span className="muted" style={{ fontSize: 13 }}>Halaman {clampedPage}/{pageCount}</span>
          <button className="ghost" disabled={clampedPage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Berikutnya ›</button>
        </div>
      )}
    </details>
  );
}

function EventRequestRow({ row, buses, canDecide, busy, onDecide }) {
  const [busIds, setBusIds] = useState([]);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const status = STATUS[row.status];

  function toggleBus(id) {
    setBusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <strong className="grow">{row.event_name}</strong>
        <span className={`chip ${status.chip}`}>{status.label}</span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
        {row.event_date}
        {row.departure_time && ` · Berangkat ${row.departure_time}`}
        {row.return_time && ` · Kembali ${row.return_time}`}
        {' · '}Tujuan: {row.destination}
        {row.passenger_count && ` · ${row.passenger_count} peserta`}
      </div>
      <div style={{ fontSize: 13, marginBottom: 4, color: '#3b6fe0', fontWeight: 600 }}>
        Diajukan oleh {row.requested_by_name}
      </div>
      {row.notes && <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Catatan: {row.notes}</div>}
      {row.attachment_file && (
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          <a href={documentUrl(row.attachment_file)} target="_blank" rel="noreferrer">
            📎 Lihat lampiran
          </a>
        </div>
      )}

      {row.status === 'approved' && row.assigned_buses?.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, marginBottom: 4 }}>
          <span className="muted">Unit ditugaskan:</span>
          {row.assigned_buses.map((b) => (
            <span key={b.id} style={{
              background: dutyColor(b.duty_number), color: '#fff',
              fontWeight: 600, borderRadius: 4, padding: '2px 8px',
            }}>
              {b.plate_number}{b.label ? ` (${b.label})` : ''}
            </span>
          ))}
        </div>
      )}
      {(row.status === 'approved' || row.status === 'rejected') && row.reviewed_by_name && (
        <div style={{ fontSize: 13, fontWeight: 600, color: row.status === 'approved' ? 'var(--success)' : 'var(--danger)' }}>
          {row.status === 'approved' ? 'Disetujui' : 'Ditolak'} oleh {row.reviewed_by_name}
          {fullWIT(row.reviewed_at) && ` · ${fullWIT(row.reviewed_at)}`}
        </div>
      )}
      {row.status === 'rejected' && row.rejection_reason && (
        <div className="banner danger" style={{ marginTop: 8, marginBottom: 0 }}>
          <span>⚠</span><div>{row.rejection_reason}</div>
        </div>
      )}

      {canDecide && row.status === 'submitted' && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--outline)', paddingTop: 10 }}>
          {!rejecting ? (
            <div className="col" style={{ gap: 8 }}>
              <div>
                <span className="lbl">Unit bis ditugaskan (wajib, bisa pilih lebih dari satu)</span>
                <div className="col" style={{ gap: 4, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                  {buses.map((b) => (
                    <label key={b.id} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 400 }}>
                      <input type="checkbox" checked={busIds.includes(b.id)}
                             onChange={() => toggleBus(b.id)} />
                      <span style={{
                        background: dutyColor(b.duty_number), color: '#fff',
                        borderRadius: 4, padding: '1px 8px',
                      }}>
                        {b.plate_number}{b.label ? ` (${b.label})` : ''}
                      </span>
                    </label>
                  ))}
                </div>
                {busIds.length === 0 && (
                  <div className="hint">Pilih minimal satu unit sebelum menyetujui.</div>
                )}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="success" disabled={busy || busIds.length === 0}
                        onClick={() => onDecide(row, 'approve', { bus_ids: busIds })}>
                  {busy ? 'Menyimpan…' : 'Setujui'}
                </button>
                <button className="ghost" disabled={busy} onClick={() => setRejecting(true)}>Tolak</button>
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <textarea rows={2} placeholder="Alasan penolakan (wajib)" value={reason}
                        onChange={(e) => setReason(e.target.value)} />
              <div className="row" style={{ gap: 8 }}>
                <button className="danger" disabled={busy || !reason.trim()}
                        onClick={() => onDecide(row, 'reject', { reason })}>
                  {busy ? 'Menyimpan…' : 'Kirim Penolakan'}
                </button>
                <button className="ghost" disabled={busy} onClick={() => setRejecting(false)}>Batal</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function emptyForm() {
  return {
    event_name: '', event_date: '', departure_time: '', return_time: '',
    destination: '', passenger_count: '', notes: '',
    attachment: null, attachment_name: '',
  };
}

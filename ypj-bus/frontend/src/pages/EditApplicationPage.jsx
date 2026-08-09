import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, photoUrl } from '../api';
import PhotoCapture from '../components/PhotoCapture.jsx';
import StopPicker from '../components/StopPicker.jsx';
import { gradeLabel } from './ParentHomePage.jsx';

/**
 * Parent's correction form — reachable only while an application sits in
 * 'revision_requested', whether an admin flagged it directly or a parent's
 * own "Ajukan Perubahan Data" request on an already-approved application was
 * approved (see ParentHomePage). Deliberately narrower than the 4-step intake
 * wizard in ApplicationFormPage: consent and signature already exist and
 * aren't re-asked, this only touches the fields that can actually go wrong —
 * student data, the requested stop, and the parent's own contact details.
 */
export default function EditApplicationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [app, setApp] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    Promise.all([api.meta(), api.myApplication(id)])
      .then(([m, a]) => {
        setMeta(m);
        setApp(a);
        setForm({
          name: a.parent.name || '', email: a.parent.email || '',
          phone_primary: a.parent.phone_primary || '',
          phone_alternate: a.parent.phone_alternate || '',
          phone_alternate_owner: a.parent.phone_alternate_owner || '',
          employee_id: a.parent.employee_id || '', parent_category: a.parent.parent_category || '',
          department: a.parent.department || '', home_address: a.parent.home_address || '',
          student_name: a.student_name || '', grade: a.grade || '', nis: a.nis || '',
          photo: a.photo_file ? photoUrl(a.photo_file) : null,
          requested_stop_id: String(a.requested_stop_id || ''),
          notes_for_admin: a.notes_for_admin || '',
        });
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.student_name.trim() || !form.grade || !form.requested_stop_id) {
      setError('Nama anak, kelas, dan titik penjemputan wajib diisi.');
      return;
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Email orang tua wajib diisi dengan format yang benar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateApplication(id, {
        parent: {
          name: form.name, email: form.email, phone_primary: form.phone_primary,
          phone_alternate: form.phone_alternate, phone_alternate_owner: form.phone_alternate_owner,
          employee_id: form.employee_id, parent_category: form.parent_category,
          department: form.department, home_address: form.home_address,
        },
        student: {
          full_name: form.student_name, grade: form.grade, nis: form.nis,
          // Only send a replacement when a new one was actually picked — the
          // prefilled value is a plain photoUrl(), not a data: URL.
          photo: form.photo?.startsWith('data:') ? form.photo : undefined,
        },
        requested_stop_id: form.requested_stop_id,
        notes_for_admin: form.notes_for_admin,
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !form) {
    return (
      <div className="page">
        <div className="banner danger"><span>⚠</span><div>{error}</div></div>
        <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
      </div>
    );
  }

  if (!meta || !app || !form) {
    return <div className="page center muted" style={{ paddingTop: 60 }}>Memuat…</div>;
  }

  if (app.status !== 'revision_requested') {
    return (
      <div className="page">
        <div className="banner info">
          <span>ℹ</span>
          <div>Pengajuan ini tidak sedang dapat diedit.</div>
        </div>
        <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page center" style={{ paddingTop: 40 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <h2>Perbaikan terkirim</h2>
          <p className="muted">
            Data {form.student_name} telah diperbarui dan dikirim ulang ke Tim Transportasi untuk ditinjau.
          </p>
          <button className="block" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Perbaiki Data Pengajuan</h1>
      <p className="muted">{app.application_no} · {gradeLabel(app.grade)}</p>

      {app.revision_note && (
        <div className="banner warn">
          <span>✎</span>
          <div><strong>Catatan Tim Transportasi</strong>{app.revision_note}</div>
        </div>
      )}

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <form onSubmit={submit}>
        <div className="card">
          <h2>Data Orang Tua / Wali</h2>
          <TextField label="Nama Orang Tua" value={form.name} onChange={set('name')} />
          <TextField label="Email Orang Tua" type="email" required value={form.email} onChange={set('email')}
                     hint="Digunakan untuk masuk ke aplikasi ini — pastikan ejaannya benar." />
          <TextField label="No. HP Orang Tua" type="tel" value={form.phone_primary} onChange={set('phone_primary')} />
          <TextField label="No. HP Alternatif" type="tel" value={form.phone_alternate} onChange={set('phone_alternate')} />
          <TextField label="Pemilik No. Alternatif" value={form.phone_alternate_owner} onChange={set('phone_alternate_owner')} />
          <TextField label="Nomor ID Karyawan" value={form.employee_id} onChange={set('employee_id')} />
          <div className="field">
            <label htmlFor="parent_category">Kategori Orang Tua</label>
            <select id="parent_category" value={form.parent_category} onChange={set('parent_category')}>
              <option value="">— Pilih kategori —</option>
              {meta.parent_categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <TextField label="Departemen" value={form.department} onChange={set('department')} />
          <TextField label="Alamat Rumah" textarea value={form.home_address} onChange={set('home_address')} />
        </div>

        <div className="card">
          <h2>Data Siswa</h2>
          <TextField label="Nama Lengkap Anak" required value={form.student_name} onChange={set('student_name')} />
          <div className="field">
            <label htmlFor="grade">Kelas <span className="req">*</span></label>
            <select id="grade" value={form.grade} onChange={set('grade')}>
              <option value="">— Pilih kelas —</option>
              {meta.grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </select>
          </div>
          <TextField label="NIS" value={form.nis} onChange={set('nis')} hint="Opsional, jika diketahui" />

          <PhotoCapture value={form.photo} onChange={(v) => setForm((f) => ({ ...f, photo: v }))} />
        </div>

        <div className="card">
          <StopPicker stops={meta.stops} value={form.requested_stop_id}
                      onChange={(v) => setForm((f) => ({ ...f, requested_stop_id: v }))} />
        </div>

        <div className="card">
          <TextField label="Catatan untuk Tim Transportasi" textarea value={form.notes_for_admin}
                     onChange={set('notes_for_admin')} hint="Opsional" />
        </div>

        <div className="actions" style={{ gap: 8 }}>
          <button type="button" className="ghost" onClick={() => navigate('/')} disabled={busy}>
            Batal
          </button>
          <button type="submit" className="grow" disabled={busy}>
            {busy ? 'Mengirim…' : 'Kirim Perbaikan'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TextField({ label, required, hint, textarea, ...props }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="field">
      <label htmlFor={id}>{label} {required && <span className="req">*</span>}</label>
      {textarea
        ? <textarea id={id} {...props} />
        : <input id={id} type={props.type || 'text'} {...props} />}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

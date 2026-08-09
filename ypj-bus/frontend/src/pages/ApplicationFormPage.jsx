import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PhotoCapture from '../components/PhotoCapture.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import StopPicker from '../components/StopPicker.jsx';
import RulesPanel from '../components/RulesPanel.jsx';
import { gradeLabel } from './ParentHomePage.jsx';

/**
 * Module 1 — Parent Registration & Consent Form.
 *
 * Four steps, mapped question-by-question to the 2024/25 Microsoft Form:
 *   1. Data Orang Tua        Q1 No HP · Q2 Nomor ID · Q3 Nama · Q4 Kategori Orang Tua
 *                            Q5 Alamat Rumah · Q6 Email
 *   2. Data Siswa            Q7 Nama Anak · Q8 Kelas · Q9 Titik Penjemputan
 *                            + the newly mandatory student photo
 *   3. Peraturan & Ketentuan the rules document, two consent checkboxes
 *   4. Tanda Tangan & Kirim  drawn signature, completeness checklist, submit
 *
 * Hard rule: no photo, no signature, or either acknowledgement missing means no
 * submit. The button is disabled here and the server re-checks all of it.
 */

const STEPS = ['Data Orang Tua', 'Data Siswa', 'Peraturan', 'Tanda Tangan'];

// Draft survives an accidental tab close or a lost connection.
const DRAFT_KEY = 'ypj-bus-draft-v1';

export default function ApplicationFormPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);
  const [rulesRead, setRulesRead] = useState(false);
  const [done, setDone] = useState(null);

  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    return saved ? JSON.parse(saved) : {
      name: '', phone_primary: '', phone_alternate: '', phone_alternate_owner: '',
      employee_id: '', parent_category: '', department: '',
      home_address: '', email: '',
      student_name: '', grade: '', nis: '', photo: null, requested_stop_id: '',
      agreed_to_rules: false, acknowledged_revocation: false,
      signer_name: '', signature: null, notes_for_admin: '',
    };
  });

  const set = (k) => (e) => update(k, e?.target
    ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value)
    : e);

  function update(k, v) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      // The photo and signature data URLs are deliberately left out of the draft:
      // localStorage would blow past its quota on a two-child family.
      const { photo, signature, ...persistable } = next;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(persistable));
      return next;
    });
  }

  // Pre-fill from the parent's account so returning families do not retype Q1–Q6.
  useEffect(() => {
    (async () => {
      try {
        const [m, me] = await Promise.all([api.meta(), api.me()]);
        setMeta(m);
        setForm((prev) => ({
          ...prev,
          name: prev.name || me.name || '',
          email: prev.email || me.email || '',
          phone_primary: prev.phone_primary || me.phone_primary || '',
          phone_alternate: prev.phone_alternate || me.phone_alternate || '',
          phone_alternate_owner: prev.phone_alternate_owner || me.phone_alternate_owner || '',
          employee_id: prev.employee_id || me.employee_id || '',
          parent_category: prev.parent_category || me.parent_category || '',
          department: prev.department || me.department || '',
          home_address: prev.home_address || me.home_address || '',
          signer_name: prev.signer_name || me.name || '',
        }));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  // ── Completeness: shown to the parent, never a silent failure ───────────
  const checklist = useMemo(() => ({
    'Data orang tua lengkap':
      !!(form.name.trim() && form.phone_primary.trim() && form.employee_id.trim()
         && form.home_address.trim() && form.email.trim() && form.parent_category),
    'Data siswa & kelas terisi': !!(form.student_name.trim() && form.grade),
    'Foto siswa terunggah': !!form.photo,
    'Titik penjemputan dipilih': !!form.requested_stop_id,
    'Peraturan bis telah dibaca & disetujui': form.agreed_to_rules,
    'Menyetujui pencabutan hak jika melanggar': form.acknowledged_revocation,
    'Tanda tangan elektronik dibuat': !!form.signature,
    'Nama penanda tangan diisi': !!form.signer_name.trim(),
  }), [form]);

  const canSubmit = Object.values(checklist).every(Boolean) && !busy;

  function next() {
    setTouched(true);
    if (step === 0 && !checklist['Data orang tua lengkap']) return;
    if (step === 1 && !(checklist['Data siswa & kelas terisi']
      && checklist['Foto siswa terunggah'] && checklist['Titik penjemputan dipilih'])) return;
    if (step === 2 && !(form.agreed_to_rules && form.acknowledged_revocation)) return;
    setTouched(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo(0, 0);
  }

  function back() {
    if (step === 0) return navigate('/');
    setStep((s) => s - 1);
    window.scrollTo(0, 0);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitApplication({
        parent: {
          name: form.name, phone_primary: form.phone_primary,
          phone_alternate: form.phone_alternate,
          phone_alternate_owner: form.phone_alternate_owner,
          employee_id: form.employee_id,
          parent_category: form.parent_category, department: form.department,
          home_address: form.home_address,
        },
        student: {
          full_name: form.student_name, grade: form.grade,
          nis: form.nis, photo: form.photo,
        },
        requested_stop_id: Number(form.requested_stop_id),
        consent: {
          rule_document_id: meta.rules?.id,
          signer_name: form.signer_name,
          signature: form.signature,
          agreed_to_rules: form.agreed_to_rules,
          acknowledged_revocation: form.acknowledged_revocation,
        },
        notes_for_admin: form.notes_for_admin,
      });
      localStorage.removeItem(DRAFT_KEY);
      setDone(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="page">
        <div className="card center">
          <div style={{ fontSize: 44 }}>✅</div>
          <h1>Pengajuan terkirim</h1>
          <p>Nomor pengajuan Anda: <strong>{done.application_no}</strong></p>
          <p className="muted">
            Tim Transportasi YPJ akan memverifikasi data dan kapasitas rute. Kartu
            Akses Bis diterbitkan otomatis di aplikasi ini setelah pengajuan
            disetujui, dan pemberitahuan dikirim ke email Anda.
          </p>
          <button className="block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
        </div>
      </div>
    );
  }

  if (!meta) {
    return <div className="page muted center" style={{ paddingTop: 60 }}>Memuat formulir…</div>;
  }

  return (
    <div className="page">
      <div className="stepper">
        {STEPS.map((s, i) => <span key={s} className={i <= step ? 'done' : ''} />)}
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Langkah {step + 1} dari {STEPS.length} — {STEPS[step]}
      </div>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {/* ── Step 1: parent (Q1–Q6) ─────────────────────────────────────── */}
      {step === 0 && (
        <>
          <div className="banner info">
            <span>ℹ</span>
            <div>
              <strong>Ketentuan: 1 form untuk 1 siswa.</strong>
              Untuk kakak/adik, kirim pengajuan terpisah dari beranda.
            </div>
          </div>

          <div className="card">
            <h2>Data Orang Tua / Wali</h2>
            <p className="muted">Digunakan untuk verifikasi kelayakan dan kontak darurat.</p>

            <Field label="Nama Orang Tua" required value={form.name} onChange={set('name')}
                   invalid={touched && !form.name.trim()} />

            <Field label="No. HP Orang Tua" required type="tel" value={form.phone_primary}
                   onChange={set('phone_primary')} placeholder="08xxxxxxxxxx"
                   invalid={touched && !form.phone_primary.trim()} />

            {/* The old form crammed "081… / 082… (ibu)" into one box. */}
            <Field label="No. HP Alternatif" type="tel" value={form.phone_alternate}
                   onChange={set('phone_alternate')} hint="Opsional" />
            <Field label="Pemilik No. Alternatif" value={form.phone_alternate_owner}
                   onChange={set('phone_alternate_owner')} placeholder="Contoh: Ibu / Ayah" />

            <Field label="Nomor ID Karyawan" required value={form.employee_id}
                   onChange={set('employee_id')} hint="Nomor ID perusahaan, contoh: 910439."
                   invalid={touched && !form.employee_id.trim()} />

            <div className="field">
              <label htmlFor="parent_category">
                Kategori Orang Tua <span className="req">*</span>
              </label>
              <select id="parent_category" value={form.parent_category}
                      onChange={set('parent_category')}>
                <option value="">— Pilih kategori —</option>
                {meta.parent_categories.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              {touched && !form.parent_category && (
                <div className="error">Kategori Orang Tua wajib dipilih.</div>
              )}
            </div>

            <Field label="Departemen" value={form.department} onChange={set('department')}
                   placeholder="Contoh: HR-IR, PGT, SCM (opsional)" />

            <Field label="Alamat Rumah" required textarea value={form.home_address}
                   onChange={set('home_address')} placeholder="Perumahan, jalan, blok/nomor"
                   invalid={touched && !form.home_address.trim()} />

            <Field label="Email" required type="email" value={form.email}
                   onChange={set('email')} invalid={touched && !form.email.trim()} />
          </div>
        </>
      )}

      {/* ── Step 2: student (Q7–Q9 + photo) ────────────────────────────── */}
      {step === 1 && (
        <>
          <div className="card">
            <h2>Data Siswa</h2>
            <p className="muted">Satu pengajuan hanya untuk satu siswa.</p>

            <Field label="Nama Lengkap Anak" required value={form.student_name}
                   onChange={set('student_name')} hint="Nama sesuai data sekolah"
                   invalid={touched && !form.student_name.trim()} />

            <div className="field">
              <label htmlFor="grade">Kelas <span className="req">*</span></label>
              <select id="grade" value={form.grade} onChange={set('grade')}>
                <option value="">— Pilih kelas —</option>
                {meta.grades.map((g) => (
                  <option key={g} value={g}>{gradeLabel(g)}</option>
                ))}
              </select>
              {touched && !form.grade && <div className="error">Kelas wajib dipilih.</div>}
            </div>

            <Field label="NIS" value={form.nis} onChange={set('nis')}
                   hint="Opsional, jika diketahui" />

            <PhotoCapture value={form.photo} onChange={(v) => update('photo', v)}
                          error={touched && !form.photo ? 'Foto siswa wajib diunggah.' : null} />
          </div>

          <div className="card">
            <StopPicker stops={meta.stops} value={form.requested_stop_id}
                        onChange={(v) => update('requested_stop_id', v)}
                        error={touched && !form.requested_stop_id
                          ? 'Titik penjemputan wajib dipilih.' : null} />
            <Field label="Catatan untuk Tim Transportasi" textarea
                   value={form.notes_for_admin} onChange={set('notes_for_admin')}
                   hint="Opsional — misalnya kebutuhan khusus anak." />
          </div>
        </>
      )}

      {/* ── Step 3: rules + the two acknowledgements ───────────────────── */}
      {step === 2 && (
        <>
          <div className="card">
            <h2>{meta.rules?.title || 'Peraturan dan Ketentuan Bis Sekolah YPJ'}</h2>
            <p className="muted">
              Versi {meta.rules?.version} — wajib dibaca sampai selesai.
            </p>
            <RulesPanel rules={meta.rules} reachedEnd={rulesRead}
                        onReachedEnd={() => setRulesRead(true)} />
          </div>

          <div className="card">
            <h2>Pernyataan Persetujuan</h2>

            <div className="checkline">
              <input id="agree" type="checkbox" disabled={!rulesRead}
                     checked={form.agreed_to_rules} onChange={set('agreed_to_rules')} />
              <label htmlFor="agree">
                Saya telah membaca dengan seksama dan setuju dengan ketentuan ini.
              </label>
            </div>

            {/* The clause that makes enforcement possible — kept visually distinct
                so nobody can later claim they missed it. */}
            <div className="banner danger" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="checkline" style={{ padding: 0 }}>
                <input id="revoke" type="checkbox" disabled={!rulesRead}
                       checked={form.acknowledged_revocation}
                       onChange={set('acknowledged_revocation')} />
                <label htmlFor="revoke">
                  Saya memahami dan menyetujui bahwa apabila anak saya melakukan
                  pelanggaran aturan Bis Sekolah YPJ, hak istimewa pengguna Bis
                  Sekolah dapat <strong>DITANGGUHKAN atau DICABUT</strong> secara
                  permanen, serta dilakukan peninjauan kelayakan pendaftaran sekolah
                  sesuai kebijakan HR.EDUC.01.
                </label>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 4: signature + submit ─────────────────────────────────── */}
      {step === 3 && (
        <>
          <div className="card">
            <h2>Konfirmasi Orang Tua</h2>
            <p>
              Demikian form pengajuan penggunaan bus sekolah dan pernyataan ini
              disampaikan dengan sebenarnya. Jika dikemudian hari ditemukan
              ketidaksesuaian atas informasi di atas atau terjadi pelanggaran, saya
              bersedia menerima pencabutan akses tanggungan saya serta peninjauan
              kelayakan pendaftaran masuk sekolah, sebagaimana ditetapkan dalam
              kebijakan HR.EDUC.01.
            </p>

            <SignaturePad onChange={(v) => update('signature', v)}
                          error={touched && !form.signature ? 'Tanda tangan wajib diisi.' : null} />

            <Field label="Nama Penanda Tangan" required value={form.signer_name}
                   onChange={set('signer_name')}
                   invalid={touched && !form.signer_name.trim()} />

            <p className="muted">
              Tanda tangan, waktu pengiriman dan versi peraturan
              ({meta.rules?.version}) disimpan sebagai bukti persetujuan.
            </p>
          </div>

          <div className="card">
            <h3>Kelengkapan pengajuan</h3>
            {Object.entries(checklist).map(([label, ok]) => (
              <div className="row" key={label} style={{ padding: '4px 0' }}>
                <span style={{ color: ok ? 'var(--success)' : 'var(--text-muted)' }}>
                  {ok ? '✓' : '○'}
                </span>
                <span style={{ color: ok ? 'var(--text)' : 'var(--text-muted)', fontSize: 14 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="actions">
        <button className="ghost" onClick={back} disabled={busy}>
          {step === 0 ? 'Batal' : 'Kembali'}
        </button>
        {step < STEPS.length - 1 ? (
          <button className="grow" onClick={next}
                  disabled={step === 2 && !(form.agreed_to_rules && form.acknowledged_revocation)}>
            Lanjut
          </button>
        ) : (
          <button className="grow" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Mengirim…' : 'Kirim Pengajuan'}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, hint, invalid, textarea, ...props }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div className="field">
      <label htmlFor={id}>{label} {required && <span className="req">*</span>}</label>
      {textarea
        ? <textarea id={id} {...props} />
        : <input id={id} type={props.type || 'text'} {...props} />}
      {invalid && <div className="error">{label} wajib diisi.</div>}
      {hint && !invalid && <div className="hint">{hint}</div>}
    </div>
  );
}

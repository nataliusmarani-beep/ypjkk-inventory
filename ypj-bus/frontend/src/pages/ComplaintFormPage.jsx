import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const MAX_MESSAGE_LENGTH = 4000;

/**
 * "Laporkan Keluhan" — the escalation path rules v1.1 §III.A promises parents:
 * complaints, feedback and suggestions reach the Penanggung Jawab Transportasi
 * Sekolah YPJ. Submitting here emails every Transport Team account immediately
 * (see backend/routes/complaints.js) and also stores the complaint, so a
 * bounced or filtered email doesn't mean it's lost.
 */
export default function ComplaintFormPage() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [subject, setSubject] = useState('');
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.myApplications()
      .then((apps) => {
        // One entry per child, in case a parent has more than one application
        // for the same student (e.g. a resubmission after rejection).
        const seen = new Map();
        for (const a of apps) seen.set(a.student_id, a.student_name);
        setStudents([...seen].map(([id, name]) => ({ id, name })));
      })
      .catch(() => {}); // optional field — a failed lookup shouldn't block the form
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitComplaint({
        subject: subject.trim(),
        message: message.trim(),
        student_id: studentId ? Number(studentId) : null,
      });
      setDone(true);
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
          <h1>Keluhan terkirim</h1>
          <p>
            Keluhan Anda telah dikirim melalui email kepada Tim Transportasi YPJ
            dan akan ditindaklanjuti.
          </p>
          <button className="block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Laporkan Keluhan</h1>
      <p className="muted">
        Keluhan, masukan, atau saran terkait layanan bis sekolah akan dikirim
        langsung melalui email kepada Tim Transportasi YPJ.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="subject">Judul Keluhan <span className="req">*</span></label>
          <input id="subject" type="text" value={subject}
                 onChange={(e) => setSubject(e.target.value)}
                 placeholder="Contoh: Bus terlambat di TPS#3" required />
        </div>

        {students.length > 0 && (
          <div className="field">
            <label htmlFor="student">Terkait Siswa</label>
            <select id="student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">— Tidak spesifik / umum —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="message">Isi Keluhan <span className="req">*</span></label>
          <textarea id="message" value={message} rows={6}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Jelaskan keluhan, masukan, atau saran Anda secara rinci."
                    required />
          <div className="hint">{message.length}/{MAX_MESSAGE_LENGTH} karakter</div>
        </div>

        <button className="block" type="submit" disabled={busy}>
          {busy ? 'Mengirim…' : 'Kirim Keluhan'}
        </button>
      </form>

      <button className="ghost block" onClick={() => navigate('/')}>Batal</button>
    </div>
  );
}

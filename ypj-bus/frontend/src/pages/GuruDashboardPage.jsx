import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { gradeLabel } from './ParentHomePage.jsx';
import { GRADES, StudentsByGradeCard, SchoolCategoryCard } from '../components/GradeCharts.jsx';
import EventRequestsSection from '../components/EventRequests.jsx';

/**
 * Guru (school_staff) home page. There is no teacher-to-class mapping
 * anywhere in the schema — users has no grade/class column, and students
 * only link to a parent — so this shows every grade, not "the guru's own
 * class"; the grade filter below the roster is the closest substitute until
 * that scoping exists.
 */
export default function GuruDashboardPage({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [students, setStudents] = useState(null);
  const [grade, setGrade] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.guruStats().then(setStats).catch((e) => setError(e.message));
    api.notifications().then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    api.guruStudents(grade ? { grade } : {}).then(setStudents).catch((e) => setError(e.message));
  }, [grade]);

  const broadcasts = (notifications || []).filter((n) => n.template === 'admin.broadcast').slice(0, 5);

  return (
    <div className="page wide">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className="on">Dashboard</button>
        <button onClick={() => navigate('/jadwal')}>📅 Jadwal</button>
        <button onClick={() => navigate('/lacak')}>🗺️ Lacak Bus</button>
        <button onClick={() => navigate('/event-request')}>🎉 Acara</button>
      </div>

      <h1>Dashboard Guru</h1>
      <p className="muted">
        Ringkasan siswa pengguna bis, permintaan bis acara sekolah, dan pemberitahuan Tim Transportasi.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="dash-grid grade-charts-grid">
        <StudentsByGradeCard byGrade={stats?.by_grade} />
        <SchoolCategoryCard byGrade={stats?.by_grade} />
      </div>

      <details className="card" open={broadcasts.length > 0}>
        <summary className="panel-summary">
          <span className="ico" aria-hidden="true">📢</span>
          <span className="grow">
            Broadcast Tim Transportasi
            <div className="sub">
              {broadcasts.length === 0 ? 'Belum ada pemberitahuan' : `${broadcasts.length} terbaru`}
            </div>
          </span>
        </summary>
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {broadcasts.length === 0 && <p className="muted" style={{ margin: 0 }}>Belum ada broadcast.</p>}
          {broadcasts.map((n) => (
            <div key={n.id} className="banner info" style={{ marginBottom: 0 }}>
              <span>📢</span>
              <div>
                <strong>{n.title}</strong>{n.body}
              </div>
            </div>
          ))}
          <button className="ghost" onClick={() => navigate('/notifications')}>Lihat Semua Pemberitahuan</button>
        </div>
      </details>

      <EventRequestsSection user={user} />

      <details className="card" open>
        <summary className="panel-summary">
          <span className="ico" aria-hidden="true">🚌</span>
          <span className="grow">
            Siswa Pengguna Bis
            <div className="sub">
              {students?.length ?? 0} siswa (pengajuan disetujui)
              — semua jenjang, filter di bawah untuk kelas tertentu
            </div>
          </span>
        </summary>

        <div className="field" style={{ marginTop: 12, marginBottom: 12, maxWidth: 260 }}>
          <label>Kelas</label>
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">Semua Kelas</option>
            {Object.keys(GRADES).map((g) => (
              <option key={g} value={g}>{gradeLabel(g)}</option>
            ))}
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Siswa</th><th>Kelas</th><th>TPS</th><th>Orang Tua</th><th>Kartu</th>
              </tr>
            </thead>
            <tbody>
              {students === null && <tr><td colSpan={5} className="muted">Memuat…</td></tr>}
              {students?.length === 0 && (
                <tr><td colSpan={5} className="muted">Belum ada siswa pengguna bis pada kelas ini.</td></tr>
              )}
              {students?.map((s) => (
                <tr key={s.student_id}>
                  <td>{s.student_name}</td>
                  <td className="muted">{s.grade_label}</td>
                  <td className="muted">{s.stop_code} {s.stop_name}</td>
                  <td className="muted">{s.parent_name}{s.phone_primary ? ` · ${s.phone_primary}` : ''}</td>
                  <td>
                    {s.card_status === 'active'
                      ? <span className="chip ok">Aktif</span>
                      : <span className="chip neutral">Belum dicetak</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

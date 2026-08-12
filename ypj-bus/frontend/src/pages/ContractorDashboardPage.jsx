import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatWIT } from '../api';
import EventRequestsSection from '../components/EventRequests.jsx';

/**
 * Contractor (bus company leadership) home page — entirely view-only, for
 * the three bus companies' own management to check on their units without
 * touching anything operational. See backend/routes/contractor.js and the
 * requireRole('contractor', ...) additions in server.js for what this role
 * can and can't reach.
 */
export default function ContractorDashboardPage({ user }) {
  const navigate = useNavigate();
  const [broadcasts, setBroadcasts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.contractorBroadcasts().then(setBroadcasts).catch((e) => setError(e.message));
  }, []);

  const recent = (broadcasts || []).slice(0, 3);

  return (
    <div className="page wide">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className="on">Dashboard</button>
        <button onClick={() => navigate('/jadwal')}>📅 Jadwal</button>
        <button onClick={() => navigate('/lacak')}>🗺️ Lacak Bus</button>
        <button onClick={() => navigate('/checklist')}>🦺 Checklist</button>
        <button onClick={() => navigate('/peraturan')}>📋 Kebijakan</button>
      </div>

      <h1>Dashboard Kontraktor</h1>
      <p className="muted">
        {user?.name ? `Selamat datang, ${user.name}. ` : ''}
        Akses lihat-saja: jadwal bis, riwayat checklist keselamatan, Lacak Bus, riwayat broadcast
        ke orang tua, permintaan bis acara sekolah, dan peraturan &amp; kebijakan.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="dash-grid">
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/jadwal')}>
          <div style={{ fontSize: 28 }}>📅</div>
          <strong>Jadwal Bis</strong>
          <div className="muted" style={{ fontSize: 13 }}>Rute dan waktu tiap unit hari ini &amp; besok.</div>
        </button>
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/lacak')}>
          <div style={{ fontSize: 28 }}>🗺️</div>
          <strong>Lacak Bus</strong>
          <div className="muted" style={{ fontSize: 13 }}>Progres rit penjemputan/pengantaran per TPS.</div>
        </button>
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/checklist')}>
          <div style={{ fontSize: 28 }}>🦺</div>
          <strong>Riwayat Checklist Keselamatan</strong>
          <div className="muted" style={{ fontSize: 13 }}>Pengisian checklist harian setiap unit.</div>
        </button>
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/peraturan')}>
          <div style={{ fontSize: 28 }}>📋</div>
          <strong>Peraturan &amp; Kebijakan</strong>
          <div className="muted" style={{ fontSize: 13 }}>Ketentuan bis sekolah YPJ Kuala Kencana.</div>
        </button>
      </div>

      <details className="card" open={recent.length > 0}>
        <summary className="panel-summary">
          <span className="ico" aria-hidden="true">📢</span>
          <span className="grow">
            Broadcast ke Orang Tua
            <div className="sub">
              {broadcasts === null ? 'Memuat…'
                : broadcasts.length === 0 ? 'Belum ada broadcast' : `${broadcasts.length} total`}
            </div>
          </span>
        </summary>
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {broadcasts?.length === 0 && <p className="muted" style={{ margin: 0 }}>Belum ada broadcast.</p>}
          {recent.map((b, i) => (
            <div key={i} className="banner info" style={{ marginBottom: 0 }}>
              <span>📢</span>
              <div>
                <strong>{b.subject}</strong> — {b.message}
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatWIT(b.sent_at)} WIT · {b.recipients} penerima
                </div>
              </div>
            </div>
          ))}
          {broadcasts?.length > 0 && (
            <button className="ghost" onClick={() => navigate('/riwayat-broadcast')}>
              Lihat Semua Riwayat Broadcast
            </button>
          )}
        </div>
      </details>

      <EventRequestsSection user={user} />
    </div>
  );
}

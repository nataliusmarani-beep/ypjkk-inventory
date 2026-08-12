import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatWIT } from '../api';

/**
 * Full "Broadcast ke Orang Tua" history — Contractor-only for now (see
 * backend/routes/contractor.js). ContractorDashboardPage shows the 3 most
 * recent inline; this is the complete list.
 */
export default function BroadcastHistoryPage() {
  const navigate = useNavigate();
  const [broadcasts, setBroadcasts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.contractorBroadcasts().then(setBroadcasts).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <h1>Riwayat Broadcast ke Orang Tua</h1>
      <p className="muted">Setiap pemberitahuan yang dikirim Tim Transportasi ke orang tua, terbaru dahulu.</p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {broadcasts === null && !error && <div className="card muted center">Memuat…</div>}
      {broadcasts?.length === 0 && <div className="card muted center">Belum ada broadcast.</div>}

      <div className="col" style={{ gap: 10 }}>
        {broadcasts?.map((b, i) => (
          <div key={i} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <strong>{b.subject}</strong>
              <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                {formatWIT(b.sent_at)} WIT
              </span>
            </div>
            <p style={{ margin: '6px 0' }}>{b.message}</p>
            <span className="chip neutral">{b.recipients} penerima</span>
          </div>
        ))}
      </div>

      <button className="ghost block" style={{ marginTop: 12 }}
              onClick={() => navigate('/kontraktor')}>Kembali ke Dashboard</button>
    </div>
  );
}

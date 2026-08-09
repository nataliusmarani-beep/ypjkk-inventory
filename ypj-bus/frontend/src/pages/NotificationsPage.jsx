import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Full notification history — every role gets here from the 🔔 in the header
 * (see App.jsx). ParentHomePage still shows the newest couple inline on the
 * dashboard for convenience; this page is the complete list plus history,
 * for every role including the ones with no dashboard of their own.
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [marking, setMarking] = useState(null);

  const load = useCallback(() => {
    api.notifications().then(setNotes).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(id) {
    setMarking(id);
    try {
      await api.markNotification(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarking(null);
    }
  }

  async function markAllRead() {
    const unread = (notes || []).filter((n) => !n.read_at);
    setMarking('all');
    try {
      await Promise.all(unread.map((n) => api.markNotification(n.id)));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarking(null);
    }
  }

  const unreadCount = notes?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 className="grow">Pemberitahuan</h1>
        {unreadCount > 0 && (
          <button className="ghost" disabled={marking === 'all'} onClick={markAllRead}>
            {marking === 'all' ? 'Menandai…' : 'Tandai Semua Dibaca'}
          </button>
        )}
      </div>
      <p className="muted">Riwayat pemberitahuan untuk akun Anda.</p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {notes === null && <p className="muted">Memuat…</p>}

      {notes?.length === 0 && (
        <div className="card center">
          <div style={{ fontSize: 38, marginBottom: 6 }}>🔔</div>
          <h3>Belum ada pemberitahuan</h3>
          <p className="muted">Pemberitahuan baru akan muncul di sini.</p>
        </div>
      )}

      {notes?.map((n) => (
        <div key={n.id} className={`banner ${n.read_at ? '' : 'info'}`}
             style={n.read_at ? { background: 'var(--surface)', borderColor: 'var(--outline)' } : undefined}>
          <span>{n.read_at ? '✓' : '🔔'}</span>
          <div>
            <strong>{n.title}</strong>
            <div style={{ whiteSpace: 'pre-line' }}>{n.body}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {n.created_at?.slice(0, 16).replace('T', ' ')} WIT
            </div>
            {!n.read_at && (
              <button className="link" disabled={marking === n.id} onClick={() => markRead(n.id)}>
                {marking === n.id ? 'Menandai…' : 'Tandai sudah dibaca'}
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="actions">
        <button className="ghost grow" onClick={() => navigate('/')}>Kembali ke Beranda</button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const PAGE_SIZE = 10;

/**
 * Full notification history — every role gets here from the 🔔 in the header
 * (see App.jsx). ParentHomePage still shows the newest couple inline on the
 * dashboard for convenience; this page is the complete list plus history,
 * for every role including the ones with no dashboard of their own.
 *
 * A compact list, not a stack of full-height banners: a chatty account (a
 * bus-approaching notice per TPS, per unit, every single trip) used to mean
 * scrolling past a page of expanded card text just to find one older
 * notification. Each row shows a one-line preview and expands on click
 * (native <details>, same accordion pattern as Lacak Bus's rit history);
 * paginated PAGE_SIZE at a time so the page itself never grows past what
 * fits a screen or two, no matter how much history there is.
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [marking, setMarking] = useState(null);
  const [page, setPage] = useState(0);

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
  const pageCount = notes ? Math.max(1, Math.ceil(notes.length / PAGE_SIZE)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const pageNotes = notes?.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE) ?? [];

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

      {notes?.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {pageNotes.map((n, i) => (
            <details key={n.id}
                     style={{ borderBottom: i === pageNotes.length - 1 ? 'none' : '1px solid var(--outline)' }}>
              <summary style={{ padding: '12px 14px', cursor: 'pointer', listStyle: 'none' }}>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{n.read_at ? '✓' : '🔔'}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</strong>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {n.created_at?.slice(0, 16).replace('T', ' ')} WIT
                      </span>
                    </div>
                    <div className="muted" style={{
                      fontSize: 13, marginTop: 2, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {n.body}
                    </div>
                  </div>
                  {!n.read_at && <span className="chip ok" style={{ flexShrink: 0 }}>Baru</span>}
                </div>
              </summary>

              <div style={{ padding: '0 14px 12px 40px' }}>
                <div style={{ whiteSpace: 'pre-line', fontSize: 14 }}>{n.body}</div>
                {!n.read_at && (
                  <button className="link" style={{ marginTop: 6 }}
                          disabled={marking === n.id} onClick={() => markRead(n.id)}>
                    {marking === n.id ? 'Menandai…' : 'Tandai sudah dibaca'}
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {notes?.length > PAGE_SIZE && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button className="ghost" disabled={clampedPage <= 0}
                  onClick={() => setPage(clampedPage - 1)}>‹ Sebelumnya</button>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Halaman {clampedPage + 1}/{pageCount}
          </span>
          <button className="ghost" disabled={clampedPage >= pageCount - 1}
                  onClick={() => setPage(clampedPage + 1)}>Berikutnya ›</button>
        </div>
      )}

      <div className="actions">
        <button className="ghost grow" onClick={() => navigate('/')}>Kembali ke Beranda</button>
      </div>
    </div>
  );
}

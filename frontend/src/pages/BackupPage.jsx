import { useState, useEffect } from 'react';
import { api } from '../api.js';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function BackupPage({ showToast }) {
  const [backups,     setBackups]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = () => {
    setLoading(true);
    api.getBackupList()
      .then(d => { setBackups(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Trigger file download via a hidden anchor — works with HttpOnly cookie auth
      const a = document.createElement('a');
      a.href = '/api/backup/download';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('✅ Backup download started!', 'success');
      // Refresh list after a moment so the new backup file appears
      setTimeout(load, 2000);
    } catch (err) {
      showToast('❌ Download failed: ' + err.message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">🗄️ Database Backup</div>
          <div className="page-subtitle">Download and manage database backups</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? 'Preparing…' : '⬇️ Download Latest Backup'}
        </button>
      </div>

      {/* Info card */}
      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        💡 A backup is automatically created on every server restart and every <strong>24 hours</strong>.
        Up to <strong>14 backups</strong> (2 weeks) are kept. Clicking Download also creates a fresh backup immediately.
      </div>

      {/* Backup list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--navy)' }}>
            📂 Stored Backups
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {backups.length} / 14 backup{backups.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <p className="loading">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p className="empty-state">No backups found. Click <strong>Download Latest Backup</strong> to create one.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Filename</th>
                  <th>Created</th>
                  <th>Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b, i) => (
                  <tr key={b.filename}>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                    <td>
                      <span className="mono" style={{ fontSize: 12 }}>{b.filename}</span>
                      {i === 0 && (
                        <span className="badge badge-green" style={{ marginLeft: 8, fontSize: 10 }}>Latest</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>{formatDate(b.modified)}</td>
                    <td style={{ fontSize: 13 }}>{formatBytes(b.size)}</td>
                    <td>
                      <a
                        href="/api/backup/download"
                        download
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11 }}
                        title="Download latest backup"
                      >
                        ⬇️
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

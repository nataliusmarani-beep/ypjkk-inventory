import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * Database backup — Super Admin + Tim Transportasi only (backend/server.js
 * mounts /api/backup behind requireRole('transport_admin'); super_admin
 * passes every role check). A daily automatic backup already runs on the
 * server (see runAutoBackup in backend/server.js) — this page is for
 * on-demand downloads and to see what's stored.
 */
export default function BackupPage() {
  const navigate = useNavigate();
  const [backups, setBackups] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null); // 'database' | 'uploads' | null

  const load = () => {
    api.backupList().then(setBackups).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  function handleDownload(kind) {
    setDownloading(kind);
    // Hidden-anchor download — HttpOnly cookie auth rides along automatically.
    const a = document.createElement('a');
    a.href = kind === 'uploads' ? '/api/backup/download-uploads' : '/api/backup/download';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { load(); setDownloading(null); }, 1500);
  }

  const dbBackups = backups?.filter((b) => b.type !== 'uploads') ?? [];
  const uploadsBackups = backups?.filter((b) => b.type === 'uploads') ?? [];

  return (
    <div className="page wide">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button onClick={() => navigate('/admin')}>Dashboard</button>
        <button onClick={() => navigate('/admin/akun')}>Akun</button>
        <button className="on">Backup</button>
      </div>

      <h1>Backup</h1>
      <p className="muted">
        Unduh dan kelola backup database serta foto/tanda tangan. Backup otomatis dibuat setiap
        server dimulai ulang dan setiap <strong>24 jam</strong>; hingga <strong>14 backup</strong>
        {' '}(2 minggu) disimpan untuk masing-masing jenis.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="grow" onClick={() => handleDownload('database')} disabled={!!downloading}>
          {downloading === 'database' ? 'Menyiapkan…' : '⬇ Unduh Database Terbaru'}
        </button>
        <button className="grow" onClick={() => handleDownload('uploads')} disabled={!!downloading}>
          {downloading === 'uploads' ? 'Menyiapkan…' : '⬇ Unduh Foto/TTD Terbaru'}
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Database</h2>
      <BackupTable rows={dbBackups} downloadHref="/api/backup/download" />

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Foto & Tanda Tangan</h2>
      <BackupTable rows={uploadsBackups} downloadHref="/api/backup/download-uploads" />
    </div>
  );
}

function BackupTable({ rows, downloadHref }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Nama Berkas</th><th>Dibuat</th><th>Ukuran</th><th /></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="muted">Memuat…</td></tr>}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">Belum ada backup.</td></tr>
            )}
            {rows.map((b, i) => (
              <tr key={b.filename}>
                <td className="muted">{i + 1}</td>
                <td>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.filename}</span>
                  {i === 0 && <span className="chip ok" style={{ marginLeft: 8 }}>Terbaru</span>}
                </td>
                <td>{formatDate(b.modified)}</td>
                <td>{formatBytes(b.size)}</td>
                <td>
                  <a href={downloadHref} download className="ghost" title="Unduh backup terbaru">⬇</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

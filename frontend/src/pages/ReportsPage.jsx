import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { downloadCSV, downloadExcel } from '../utils/download.js';

const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};

const STATUS_LABEL = { pending:'Pending', approved:'Approved', rejected:'Rejected', returned:'Returned' };

function datestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function inventoryRows(items) {
  return items.map(i => ({
    'Code':          i.code || '',
    'Name':          i.name,
    'Category':      i.category,
    'Store Category':i.store_category,
    'Location':      i.location,
    'Unit School':   i.unit_school,
    'Quantity':      i.quantity,
    'Max Quantity':  i.max_quantity,
    'Unit':          i.unit_name,
    'Min Threshold': i.min_threshold,
    'Condition':     i.condition,
    'Status':        i.status === 'out_of_stock' ? 'Out of Stock' : i.status === 'low_stock' ? 'Low Stock' : 'OK',
    'Description':   i.description || '',
  }));
}

function requestRows(requests) {
  return requests.map(r => ({
    'Date':           (r.created_at || '').slice(0, 10),
    'Requester':      r.requester_name,
    'Email':          r.requester_email,
    'Item':           r.item_name,
    'Category':       r.category || '',
    'Type':           r.type,
    'Quantity':       r.quantity,
    'Unit':           r.unit_name,
    'Unit School':    r.unit_school,
    'Purpose':        r.purpose || '',
    'Return Date':    r.return_date || '',
    'Status':         STATUS_LABEL[r.status] || r.status,
    'Approved At':    (r.approved_at || '').slice(0, 10),
    'Returned At':    (r.returned_at || '').slice(0, 10),
    'Notes':          r.notes || '',
  }));
}

export default function ReportsPage({ role, showToast }) {
  const [items,    setItems]    = useState([]);
  const [requests, setRequests] = useState([]);
  const [stats,    setStats]    = useState({ totalItems:0, lowStock:0, pending:0, thisMonth:0 });
  const [loading,  setLoading]  = useState(true);
  const [backups,  setBackups]  = useState([]);
  const [dlLoading, setDlLoading] = useState(false);

  const isManager = role === 'Manager';

  useEffect(() => {
    Promise.all([api.getItems(), api.getRequests(), api.getStats()])
      .then(([itms, reqs, st]) => { setItems(itms); setRequests(reqs); setStats(st); setLoading(false); })
      .catch(() => setLoading(false));
    if (isManager) {
      api.getBackupList().then(setBackups).catch(() => {});
    }
  }, []);

  const byCat = items.reduce((acc, i) => { acc[i.category] = (acc[i.category]||0)+1; return acc; }, {});
  const byLoc = items.reduce((acc, i) => {
    if (!acc[i.location]) acc[i.location] = { total:0, lowStock:0 };
    acc[i.location].total++;
    if (i.quantity < i.min_threshold) acc[i.location].lowStock++;
    return acc;
  }, {});
  const approved     = requests.filter(r => r.status === 'approved' || r.status === 'returned').length;
  const approvalRate = requests.length > 0 ? Math.round(approved / requests.length * 100) : 0;

  const handleDownload = (type, format) => {
    const stamp = datestamp();
    if (type === 'inventory') {
      const rows = inventoryRows(items);
      if (!rows.length) { showToast('No inventory data to export.', 'info'); return; }
      if (format === 'csv') {
        downloadCSV(rows, `inventory_${stamp}.csv`);
      } else {
        downloadExcel([{ name: 'Inventory', rows }], `inventory_${stamp}.xlsx`);
      }
    } else {
      const rows = requestRows(requests);
      if (!rows.length) { showToast('No request data to export.', 'info'); return; }
      if (format === 'csv') {
        downloadCSV(rows, `requests_${stamp}.csv`);
      } else {
        downloadExcel(
          [
            { name: 'All Requests', rows },
            { name: 'Approved',  rows: rows.filter(r => r.Status === 'Approved') },
            { name: 'Pending',   rows: rows.filter(r => r.Status === 'Pending') },
            { name: 'Rejected',  rows: rows.filter(r => r.Status === 'Rejected') },
            { name: 'Returned',  rows: rows.filter(r => r.Status === 'Returned') },
          ].filter(s => s.rows.length > 0),
          `requests_${stamp}.xlsx`
        );
      }
    }
  };

  const handleBackupDownload = async () => {
    setDlLoading(true);
    try {
      const res = await fetch('/api/backup/download', { credentials: 'include' });
      if (!res.ok) { showToast('Backup failed.', 'error'); return; }
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const name = cd.match(/filename="([^"]+)"/)?.[1] || `backup_${datestamp()}.sqlite`;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      api.getBackupList().then(setBackups).catch(() => {});
      showToast('✅ Backup downloaded.', 'success');
    } catch { showToast('Backup download failed.', 'error'); }
    finally { setDlLoading(false); }
  };

  if (loading) return <p className="loading">Loading reports...</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">📊 Reports</div>
          <div className="page-subtitle">Inventory summary and analytics</div>
        </div>
      </div>

      {/* Download cards */}
      <div className="two-col" style={{ marginBottom: 8 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontWeight:800, fontSize:14 }}>📦 Inventory Report</div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{items.length} items · all locations</div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDownload('inventory','csv')}>
                ⬇ CSV
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => handleDownload('inventory','excel')}>
                ⬇ Excel
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontWeight:800, fontSize:14 }}>📋 Requests Report</div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{requests.length} requests · Excel has per-status sheets</div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDownload('requests','csv')}>
                ⬇ CSV
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => handleDownload('requests','excel')}>
                ⬇ Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-label">Total Items</div>
          <div className="stat-value" style={{ color:'var(--navy)' }}>{stats.totalItems}</div>
          <div className="stat-meta">Across all stores</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-label">Requests This Month</div>
          <div className="stat-value" style={{ color:'var(--teal)' }}>{stats.thisMonth}</div>
          <div className="stat-meta">Total submitted</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-label">Approved</div>
          <div className="stat-value" style={{ color:'var(--green)' }}>{approved}</div>
          <div className="stat-meta">{approvalRate}% approval rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔴</div>
          <div className="stat-label">Low Stock</div>
          <div className="stat-value" style={{ color:'var(--red)' }}>{stats.lowStock}</div>
          <div className="stat-meta">Need restocking</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">📦 Stock by Category</div>
          <table>
            <thead><tr><th>Category</th><th>Items</th><th>Requests</th></tr></thead>
            <tbody>
              {Object.entries(byCat).map(([cat, count]) => {
                const reqs = requests.filter(r => r.category === cat).length;
                return (
                  <tr key={cat}>
                    <td>{CAT_EMOJI[cat] || '📦'} {cat}</td>
                    <td>{count}</td>
                    <td>{reqs}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">🏫 Stock by Location</div>
          <table>
            <thead><tr><th>Location</th><th>Items</th><th>Low Stock</th></tr></thead>
            <tbody>
              {Object.entries(byLoc).map(([loc, data]) => (
                <tr key={loc}>
                  <td><strong>{loc}</strong></td>
                  <td>{data.total}</td>
                  <td className={data.lowStock > 0 ? 'qty-warn' : 'qty-ok'}>{data.lowStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">📋 All Requests Summary</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16 }}>
          {['pending','approved','rejected','returned'].map(status => {
            const count  = requests.filter(r => r.status === status).length;
            const colors = { pending:'var(--orange)', approved:'var(--green)', rejected:'var(--red)', returned:'var(--teal)' };
            const icons  = { pending:'⏳', approved:'✅', rejected:'❌', returned:'↩' };
            return (
              <div key={status} style={{ textAlign:'center', padding:16, background:'var(--off)', borderRadius:'var(--radius-sm)' }}>
                <div style={{ fontSize:28 }}>{icons[status]}</div>
                <div style={{ fontSize:28, fontWeight:900, color:colors[status] }}>{count}</div>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--muted)', textTransform:'capitalize' }}>{status}</div>
              </div>
            );
          })}
        </div>
      </div>

      {isManager && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-title">🗄️ Database Backup</div>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
            <div>
              <p style={{ fontSize:13, color:'var(--muted)', margin:'0 0 4px' }}>
                The database is automatically backed up every 24 hours and on every server restart. Up to 14 daily backups are kept.
              </p>
              <p style={{ fontSize:12, color:'var(--muted)', margin:0 }}>
                {backups.length > 0
                  ? `${backups.length} backup(s) stored · latest: ${backups[0]?.filename}`
                  : 'No backups recorded yet.'}
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={dlLoading}
              onClick={handleBackupDownload}
              style={{ flexShrink:0 }}
            >
              {dlLoading ? '⏳ Preparing…' : '⬇ Download Backup Now'}
            </button>
          </div>

          {backups.length > 0 && (
            <div className="table-wrap" style={{ marginTop:16 }}>
              <table>
                <thead>
                  <tr><th>Filename</th><th>Size</th><th>Created</th></tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.filename}>
                      <td className="mono" style={{ fontSize:12 }}>{b.filename}</td>
                      <td>{(b.size / 1024).toFixed(1)} KB</td>
                      <td style={{ fontSize:12, color:'var(--muted)' }}>{new Date(b.modified).toLocaleString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

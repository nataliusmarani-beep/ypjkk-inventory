import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const statusBadge = { pending: 'badge-orange', approved: 'badge-green', rejected: 'badge-red', returned: 'badge-teal' };
const statusLabel = { pending: '⏳ Pending', approved: '✅ Approved', rejected: '❌ Rejected', returned: '↩ Returned' };
const dotColor = { pending: 'var(--orange)', approved: 'var(--green)', rejected: 'var(--red)', returned: 'var(--teal)' };

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  // SQLite returns "YYYY-MM-DD HH:MM:SS" — convert to proper ISO for reliable parsing
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff) || diff < 0) return 'just now';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

export default function DashboardPage({ role, user, showToast }) {
  const navigate = useNavigate();
  const [stats,       setStats]       = useState({ totalItems: 0, lowStock: 0, pending: 0, thisMonth: 0 });
  const [myPending,   setMyPending]   = useState(0);
  const [lowItems,    setLowItems]    = useState([]);
  const [recent,      setRecent]      = useState([]);

  const isAdmin = role === 'Manager' || role === 'Storekeeper';

  // Use explicit location set by admin; fallback to unit_school mapping
  const storeLocation = (() => {
    if (isAdmin) return undefined;
    if (user?.location) return user.location;
    if (!user || user.unit_school === 'All') return undefined;
    return user.unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
  })();

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
    api.getItems({ status: 'low_stock', location: storeLocation })
      .then(d => setLowItems(d.slice(0, 10))).catch(() => {});
    const reqFilter = !isAdmin ? { requester_email: user?.email } : {};
    api.getRequests(reqFilter).then(d => {
      setRecent(d.slice(0, 10));
      if (!isAdmin) setMyPending(d.filter(r => r.status === 'pending').length);
    }).catch(() => {});
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';
  const today = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{greeting}, {user?.name?.split(' ')[0]}! 👋</div>
          <div className="page-subtitle">{today} — YPJ KK Campus</div>
        </div>
        {isAdmin && (
          <button className="btn btn-primary dashboard-add-btn" onClick={() => navigate('/add-item')}>➕ Add Item</button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card" onClick={() => navigate('/inventory')}>
          <div className="stat-icon">📦</div>
          <div className="stat-label">Total Items</div>
          <div className="stat-value" style={{ color: 'var(--navy)' }}>{stats.totalItems}</div>
          <div className="stat-meta">Across 2 locations</div>
        </div>
        {isAdmin ? (
          <div className="stat-card" onClick={() => navigate('/approvals')}>
            <div className="stat-icon">⏳</div>
            <div className="stat-label">Pending Approvals</div>
            <div className="stat-value" style={{ color: 'var(--orange)' }}>{stats.pending}</div>
            <div className="stat-meta">Awaiting storekeeper</div>
          </div>
        ) : (
          <div className="stat-card" onClick={() => navigate('/requests')}>
            <div className="stat-icon">⏳</div>
            <div className="stat-label">My Pending Requests</div>
            <div className="stat-value" style={{ color: 'var(--orange)' }}>{myPending}</div>
            <div className="stat-meta">Awaiting approval</div>
          </div>
        )}
        <div className="stat-card" onClick={() => navigate('/inventory?status=low_stock')}>
          <div className="stat-icon">🔴</div>
          <div className="stat-label">Low Stock Items</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.lowStock}</div>
          <div className="stat-meta">Need restocking soon</div>
        </div>
        <div className="stat-card" onClick={() => navigate('/requests')}>
          <div className="stat-icon">📋</div>
          <div className="stat-label">Requests This Month</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{stats.thisMonth}</div>
          <div className="stat-meta">Total this month</div>
        </div>
      </div>

      {stats.lowStock > 0 && (
        <div className="alert alert-warning" onClick={() => navigate('/inventory?status=low_stock')} style={{ cursor: 'pointer' }}>
          ⚠️ {stats.lowStock} item(s) are running low on stock. <strong>View low stock items →</strong>
        </div>
      )}

      <div className="two-col">
        <div className="card">
          <div className="card-title" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>🔴 Low Stock Alert</span>
            {lowItems.length > 0 && (
              <span onClick={() => navigate('/inventory')} style={{ fontSize:12, fontWeight:600, color:'var(--blue)', cursor:'pointer' }}>View all →</span>
            )}
          </div>
          {lowItems.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>All items are sufficiently stocked. ✅</p>
            : <table>
                <thead><tr><th>Item</th><th>Location</th><th>Qty</th></tr></thead>
                <tbody>
                  {lowItems.map(item => (
                    <tr key={item.id} className="low-stock-row">
                      <td><strong>{item.name}</strong></td>
                      <td>{item.location}</td>
                      <td className={item.quantity === 0 ? 'qty-low' : 'qty-warn'}>
                        {item.quantity} {item.unit_name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>

        <div className="card">
          <div className="card-title" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>📋 Recent Requests</span>
            {recent.length > 0 && (
              <span onClick={() => navigate('/requests')} style={{ fontSize:12, fontWeight:600, color:'var(--blue)', cursor:'pointer' }}>View all →</span>
            )}
          </div>
          {recent.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No requests yet.</p>
            : <div className="timeline">
                {recent.map(r => (
                  <div className="tl-item" key={r.id}>
                    <div className="tl-dot" style={{ background: dotColor[r.status] }}></div>
                    <div className="tl-content">
                      <div className="tl-title">
                        {r.item_name} × {r.quantity} —{' '}
                        <span className={`badge ${statusBadge[r.status]}`}>{statusLabel[r.status]}</span>
                      </div>
                      <div className="tl-meta">{r.requester_name} · {r.type} · {timeAgo(r.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      <div className="card">
        <div className="card-title">⚡ Quick Access</div>
        <div className="quick-grid">
          {isAdmin && (
            <div className="quick-card" onClick={() => navigate('/add-item')}>
              <div className="qicon">➕</div>
              <div className="qlabel">Add New Item</div>
              <div className="qsub">Add to inventory catalog</div>
            </div>
          )}
          <div className="quick-card" onClick={() => navigate('/requests')}>
            <div className="qicon">📋</div>
            <div className="qlabel">Submit Request</div>
            <div className="qsub">Borrow or used-up items</div>
          </div>
          {isAdmin && (
            <div className="quick-card" onClick={() => navigate('/approvals')}>
              <div className="qicon">✅</div>
              <div className="qlabel">Pending Approvals</div>
              <div className="qsub">{stats.pending} requests waiting</div>
            </div>
          )}
          <div className="quick-card" onClick={() => navigate('/inventory')}>
            <div className="qicon">📦</div>
            <div className="qlabel">View Inventory</div>
            <div className="qsub">Browse all items</div>
          </div>
        </div>
      </div>
    </div>
  );
}

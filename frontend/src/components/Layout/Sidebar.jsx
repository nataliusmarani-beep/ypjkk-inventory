import { NavLink } from 'react-router-dom';

const STORES = [
  { label: 'PAUD YPJ KK',   unit: 'PAUD' },
  { label: 'SD SMP YPJ KK', unit: 'SD'   },  // SD and SMP both map here
];

export default function Sidebar({ role, user, pendingCount }) {
  const isAdmin = role === 'Manager' || role === 'Storekeeper';

  // Determine which store(s) to show in the sidebar
  const visibleStores = (() => {
    if (isAdmin) return STORES; // both
    if (!user || user.unit_school === 'All') return STORES;
    if (user.unit_school === 'PAUD') return [STORES[0]];
    return [STORES[1]]; // SD or SMP → SD SMP YPJ KK
  })();

  return (
    <aside className="sidebar">
      <div className="nav-section">Main</div>
      <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="icon">🏠</span> Dashboard
      </NavLink>
      <NavLink to="/inventory" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="icon">📦</span> Inventory Items
      </NavLink>
      <NavLink to="/requests" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="icon">📋</span> My Requests
      </NavLink>

      {isAdmin && (
        <>
          <div className="nav-section">Admin</div>
          <NavLink to="/approvals" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="icon">✅</span> Approvals
            {pendingCount > 0 && <span className="nav-badge red">{pendingCount}</span>}
          </NavLink>
          <NavLink to="/add-item" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="icon">➕</span> Add Item
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="icon">📊</span> Reports
          </NavLink>
          {role === 'Manager' && (
            <>
              <NavLink to="/activity-log" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="icon">📋</span> Activity Log
              </NavLink>
              <NavLink to="/users" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="icon">👥</span> Users
              </NavLink>
              <NavLink to="/backup" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="icon">🗄️</span> Backup
              </NavLink>
            </>
          )}
        </>
      )}

      <div className="nav-section">Help</div>
      <NavLink to="/help" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="icon">📖</span> User Guide
      </NavLink>

      <div className="nav-section">Stores</div>
      {visibleStores.map(s => (
        <button key={s.label} className="nav-item">
          <span className="icon">🏫</span> {s.label}
        </button>
      ))}
    </aside>
  );
}

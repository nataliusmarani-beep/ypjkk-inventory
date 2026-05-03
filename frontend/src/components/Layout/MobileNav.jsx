import { useState } from 'react';
import { NavLink } from 'react-router-dom';

const ROLE_COLOR = {
  Manager: '#2563eb', Storekeeper: '#0d9488', Teacher: '#7c3aed', Other: '#6b7280',
};

export default function MobileNav({ user, pendingCount, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin   = user.role === 'Manager' || user.role === 'Storekeeper';
  const isManager = user.role === 'Manager';
  const color     = ROLE_COLOR[user.role] || '#6b7280';
  const initial   = user.name?.charAt(0)?.toUpperCase() || '?';

  const tabStyle = (isActive) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '6px 0',
    flex: 1,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
    color: isActive ? '#2563eb' : '#94a3b8',
    textDecoration: 'none',
    minWidth: 0,
    position: 'relative',
  });

  const tabLabel = (isActive) => ({
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.02em',
    color: isActive ? '#2563eb' : '#94a3b8',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  });

  const DrawerLink = ({ to, icon, label, badge }) => (
    <NavLink
      to={to}
      onClick={() => setDrawerOpen(false)}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        fontSize: 15,
        fontWeight: isActive ? 700 : 500,
        color: isActive ? '#2563eb' : '#1e293b',
        background: isActive ? '#eff6ff' : 'transparent',
        textDecoration: 'none',
        borderRadius: 12,
        marginBottom: 2,
      })}
    >
      <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge > 0 && (
        <span style={{
          background: '#ef4444', color: '#fff',
          fontSize: 11, fontWeight: 700,
          padding: '1px 7px', borderRadius: 20,
        }}>{badge}</span>
      )}
    </NavLink>
  );

  return (
    <>
      {/* ── Bottom Tab Bar ── */}
      <nav className="mobile-bottom-nav">
        <NavLink to="/" end style={({ isActive }) => tabStyle(isActive)}>
          {({ isActive }) => (
            <>
              <span>🏠</span>
              <span style={tabLabel(isActive)}>Home</span>
            </>
          )}
        </NavLink>

        <NavLink to="/inventory" style={({ isActive }) => tabStyle(isActive)}>
          {({ isActive }) => (
            <>
              <span>📦</span>
              <span style={tabLabel(isActive)}>Items</span>
            </>
          )}
        </NavLink>

        <NavLink to="/requests" style={({ isActive }) => tabStyle(isActive)}>
          {({ isActive }) => (
            <>
              <span>📋</span>
              <span style={tabLabel(isActive)}>Requests</span>
            </>
          )}
        </NavLink>

        <NavLink to="/help" style={({ isActive }) => tabStyle(isActive)}>
          {({ isActive }) => (
            <>
              <span>📖</span>
              <span style={tabLabel(isActive)}>Guide</span>
            </>
          )}
        </NavLink>

        <button onClick={() => setDrawerOpen(true)} style={tabStyle(false)}>
          <span style={{ position: 'relative' }}>
            ☰
            {pendingCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -8,
                background: '#ef4444', color: '#fff',
                fontSize: 9, fontWeight: 700,
                padding: '1px 4px', borderRadius: 20,
                lineHeight: 1.4,
              }}>{pendingCount}</span>
            )}
          </span>
          <span style={tabLabel(false)}>More</span>
        </button>
      </nav>

      {/* ── Slide-up Drawer ── */}
      {drawerOpen && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="mobile-drawer"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, marginBottom: 4 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
            </div>

            {/* User info */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 20px 16px',
              borderBottom: '1px solid #f1f5f9',
              marginBottom: 10,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: color, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 800, fontSize: 18,
              }}>
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.name || user.email}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{user.role} · {user.unit_school}</div>
              </div>
            </div>

            {/* Links */}
            <div style={{ padding: '0 12px', overflowY: 'auto', flex: 1 }}>

              {isAdmin && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px 8px' }}>
                    Admin
                  </div>
                  <DrawerLink to="/approvals" icon="✅" label="Approvals" badge={pendingCount} />
                  <DrawerLink to="/add-item"  icon="➕" label="Add Item" />
                  <DrawerLink to="/reports"   icon="📊" label="Reports" />
                </>
              )}

              {isManager && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '12px 8px 8px' }}>
                    Manager
                  </div>
                  <DrawerLink to="/activity-log" icon="📋" label="Activity Log" />
                  <DrawerLink to="/users"        icon="👥" label="Users" />
                  <DrawerLink to="/backup"       icon="🗄️" label="Backup" />
                </>
              )}

              <div style={{ height: 1, background: '#f1f5f9', margin: '12px 8px' }} />

              <button
                onClick={() => { setDrawerOpen(false); onLogout(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 20px', fontSize: 15, fontWeight: 500,
                  color: '#ef4444', background: 'transparent', border: 'none',
                  cursor: 'pointer', width: '100%', borderRadius: 12,
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>🚪</span>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

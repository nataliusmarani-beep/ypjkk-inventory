const ROLE_STYLE = {
  Admin:       { color: '#2563eb', initial: (n) => 'A' },
  Storekeeper: { color: '#0d9488', initial: (n) => 'S' },
  Teacher:     { color: '#7c3aed', initial: (n) => 'T' },
  Other:       { color: '#6b7280', initial: (n) => 'O' },
};

export default function Topbar({ user, pendingCount, onLogout }) {
  const style   = ROLE_STYLE[user.role] || ROLE_STYLE.Teacher;
  const initial = user.name?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo-icon">📦</div>
        <div>
          <div className="logo-text">YPJ KK Inventory</div>
          <div className="logo-sub">Campus Management System</div>
        </div>
      </div>
      <div className="topbar-right">
        {pendingCount > 0 && (
          <div className="notif-btn">
            🔔<span className="notif-dot"></span>
          </div>
        )}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', lineHeight:1.3 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--navy)' }}>{user.name}</span>
          <span style={{ fontSize:11, color:'var(--muted)' }}>{user.role} · {user.unit_school}</span>
        </div>
        <div className="user-avatar" style={{ background: style.color }}>
          {initial}
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize:12, padding:'6px 12px' }}
          onClick={onLogout}
          title="Sign out"
        >
          🚪 Sign out
        </button>
      </div>
    </div>
  );
}

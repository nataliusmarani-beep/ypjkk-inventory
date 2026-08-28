import { useState, useEffect, useRef } from 'react';
import { api } from '../../api.js';

const APPS = [
  { key: 'kk',   label: 'YPJ KK Inventory',   url: 'https://kkinventory.ypj.sch.id',   icon: '🏫' },
  { key: 'tpra', label: 'YPJ TPRA Inventory',  url: 'https://tprainventory.ypj.sch.id', icon: '🏔️' },
];

const ROLE_COLOR = {
  Manager: '#2563eb', Storekeeper: '#0d9488', Teacher: '#7c3aed', Other: '#6b7280',
};

export default function Topbar({ user, pendingCount, onLogout, onProfileUpdate }) {
  const color   = ROLE_COLOR[user.role] || '#6b7280';
  const initial = user.name?.charAt(0)?.toUpperCase() || '?';

  const [showProfile, setShowProfile] = useState(false);
  const [chatId,      setChatId]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [showSwitch,  setShowSwitch]  = useState(false);
  const switchRef = useRef(null);

  // Close switch dropdown on outside click
  useEffect(() => {
    if (!showSwitch) return;
    const handler = (e) => { if (switchRef.current && !switchRef.current.contains(e.target)) setShowSwitch(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSwitch]);

  // Load current telegram_chat_id when profile opens
  useEffect(() => {
    if (!showProfile) return;
    api.getMe()
      .then(u => setChatId(u.telegram_chat_id || ''))
      .catch(() => {});
  }, [showProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateMe({ telegram_chat_id: chatId.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { /* ignore */ }
    setSaving(false);
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="logo-icon">📦</div>
          <div>
            <div className="logo-text">YPJ KK Inventory</div>
            <div className="logo-sub">Campus Management System</div>
          </div>
        </div>
        <div className="topbar-right">
          {/* ── Switch App (Manager only) ── */}
          {user.role === 'Manager' && (
            <div ref={switchRef} style={{ position:'relative' }}>
              <button
                className="btn btn-ghost"
                title="Switch App"
                onClick={() => setShowSwitch(s => !s)}
                style={{ fontSize:13, display:'flex', alignItems:'center', gap:5, padding:'4px 10px' }}
              >
                🔀 <span className="sign-out-label">Switch</span>
              </button>
              {showSwitch && (
                <div style={{
                  position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:999,
                  background:'white', border:'1px solid var(--border)', borderRadius:10,
                  boxShadow:'0 8px 24px rgba(0,0,0,0.12)', minWidth:220, overflow:'hidden',
                }}>
                  <div style={{ padding:'8px 14px 6px', fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    Switch to
                  </div>
                  {APPS.map(app => {
                    const isCurrent = app.key === 'kk';
                    return (
                      <a
                        key={app.key}
                        href={isCurrent ? undefined : app.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={isCurrent ? e => e.preventDefault() : () => setShowSwitch(false)}
                        style={{
                          display:'flex', alignItems:'center', gap:10,
                          padding:'10px 14px', textDecoration:'none',
                          background: isCurrent ? 'var(--bg)' : 'white',
                          cursor: isCurrent ? 'default' : 'pointer',
                          borderTop:'1px solid var(--border)',
                        }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'white'; }}
                      >
                        <span style={{ fontSize:18 }}>{app.icon}</span>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color: isCurrent ? 'var(--muted)' : 'var(--navy)' }}>{app.label}</div>
                          {isCurrent && <div style={{ fontSize:11, color:'var(--muted)' }}>Current app</div>}
                        </div>
                        {isCurrent && <span style={{ marginLeft:'auto', fontSize:11, background:'var(--blue)', color:'white', borderRadius:20, padding:'2px 8px', fontWeight:700 }}>Here</span>}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {pendingCount > 0 && (
            <div className="notif-btn">🔔<span className="notif-dot"></span></div>
          )}
          <div className="topbar-userinfo">
            <span className="topbar-username">{user.name}</span>
            <span className="topbar-userrole">{user.role} · {user.unit_school}</span>
          </div>
          <div
            className="user-avatar"
            style={{ background: color, cursor:'pointer' }}
            title="My Profile"
            onClick={() => setShowProfile(true)}
          >
            {initial}
          </div>
          <button className="btn btn-ghost sign-out-btn" onClick={onLogout} title="Sign out">
            🚪<span className="sign-out-label"> Sign out</span>
          </button>
        </div>
      </div>

      {/* ── Profile Modal ───────────────────────────────────────────────── */}
      {showProfile && (
        <div className="modal-overlay" onClick={() => setShowProfile(false)}>
          <div className="modal" style={{ width: 460, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">👤 My Profile</h3>
              <button className="modal-close" onClick={() => setShowProfile(false)}>✕</button>
            </div>
            <div className="modal-body">

              {/* Info */}
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'12px 16px', marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div className="user-avatar" style={{ background: color, width:44, height:44, fontSize:18 }}>{initial}</div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:15 }}>{user.name}</div>
                    <div style={{ color:'var(--muted)', fontSize:13 }}>{user.email}</div>
                    <div style={{ marginTop:4 }}>
                      <span className={`badge ${user.role === 'Manager' ? 'badge-blue' : user.role === 'Storekeeper' ? 'badge-teal' : 'badge-purple'}`}>
                        {user.role}
                      </span>
                      <span className="badge badge-grey" style={{ marginLeft:6 }}>{user.unit_school}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Telegram */}
              <div style={{ marginBottom:16 }}>
                <label className="form-label" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span>✈️</span> Telegram Chat ID
                </label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. 123456789"
                  value={chatId}
                  onChange={e => setChatId(e.target.value)}
                />
              </div>

              {/* Instructions */}
              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'12px 16px', fontSize:13, color:'#1e40af', marginBottom:20 }}>
                <strong>How to connect Telegram:</strong>
                <ol style={{ margin:'8px 0 0 16px', padding:0, lineHeight:1.8 }}>
                  <li>Open Telegram and search for <strong>@ypjkkinventory_bot</strong></li>
                  <li>Tap <strong>Start</strong> or send <code>/start</code></li>
                  <li>The bot will reply with your Chat ID — copy it</li>
                  <li>Paste it in the field above and click Save</li>
                </ol>
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowProfile(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : saved ? '✅ Saved!' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

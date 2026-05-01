import { useState, useEffect } from 'react';
import { api } from '../../api.js';

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
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
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

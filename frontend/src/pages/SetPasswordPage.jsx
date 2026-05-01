import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

export default function SetPasswordPage({ showToast }) {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const token      = params.get('token');

  const [userInfo,  setUserInfo]  = useState(null);   // { name, email, role, unit_school }
  const [status,    setStatus]    = useState('loading'); // loading | ready | invalid | done
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    api.verifyResetToken(token)
      .then(info => { setUserInfo(info); setStatus('ready'); })
      .catch(() => setStatus('invalid'));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 4)  { setError('Password must be at least 4 characters.'); return; }
    setSaving(true);
    try {
      await api.setPassword({ token, password });
      setStatus('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Shared card wrapper ────────────────────────────────────────────────────
  const Card = ({ children }) => (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{
        background: 'white', borderRadius: 14, width: '100%', maxWidth: 460,
        boxShadow: '0 4px 32px rgba(0,0,0,0.10)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: 'var(--navy)', padding: '20px 28px' }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 18, marginBottom: 2 }}>
            📦 YPJ KK Inventory
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>
            Campus Management System
          </div>
        </div>
        <div style={{ padding: '28px 28px 32px' }}>
          {children}
        </div>
      </div>
    </div>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <Card>
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: '20px 0' }}>
          Verifying your invitation link…
        </div>
      </Card>
    );
  }

  // ── Invalid / expired ──────────────────────────────────────────────────────
  if (status === 'invalid') {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🔗</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 18, color: 'var(--navy)' }}>Link Invalid or Expired</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 20 }}>
            This invitation link has expired or already been used.<br />
            Please ask your Manager to resend the invitation from the Users page.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Go to Login
          </button>
        </div>
      </Card>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>✅</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 18, color: '#16a34a' }}>Password Set Successfully!</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 24 }}>
            Your account is now active. You can log in with your email and the password you just created.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/')}>
            🔐 Go to Login
          </button>
        </div>
      </Card>
    );
  }

  // ── Set password form ──────────────────────────────────────────────────────
  return (
    <Card>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>
        🔐 Set Your Password
      </h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
        Welcome, <strong>{userInfo?.name}</strong>! Create a password to activate your account.
      </p>

      {/* Account info */}
      <div style={{
        background: 'var(--bg)', borderRadius: 8, padding: '12px 16px', marginBottom: 20,
        fontSize: 13, lineHeight: 1.8,
      }}>
        <div><span style={{ color: 'var(--muted)' }}>Email:</span> <strong>{userInfo?.email}</strong></div>
        <div><span style={{ color: 'var(--muted)' }}>Role:</span> <strong>{userInfo?.role}</strong></div>
        <div><span style={{ color: 'var(--muted)' }}>Unit:</span> <strong>{userInfo?.unit_school}</strong></div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">New Password <span className="req">*</span></label>
          <input
            type="password"
            className="form-input"
            placeholder="Min. 4 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={4}
            autoFocus
          />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Confirm Password <span className="req">*</span></label>
          <input
            type="password"
            className="form-input"
            placeholder="Repeat your password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="alert alert-error" style={{ fontSize: 13, margin: 0 }}>{error}</div>
        )}

        <button type="submit" className="btn btn-primary" style={{ marginTop: 4 }} disabled={saving}>
          {saving ? 'Setting password…' : '✅ Set Password & Activate Account'}
        </button>
      </form>
    </Card>
  );
}

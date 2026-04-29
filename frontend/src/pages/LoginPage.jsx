import { useState } from 'react';
import { api } from '../api.js';

export default function LoginPage({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = await api.login({ email: email.trim().toLowerCase(), password });
      onLogin(user);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--off)', padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 400 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>YPJ KK Inventory</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Campus Management System</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              placeholder="your.email@fmi.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}
          >
            {loading ? 'Signing in…' : '🔐 Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--off)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--muted)' }}>
          Use your school email and the password given by your administrator.
        </div>
      </div>
    </div>
  );
}

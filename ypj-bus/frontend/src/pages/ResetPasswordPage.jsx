import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import Crest from '../components/Crest.jsx';

/**
 * Landing page for the reset link emailed by "Lupa password?" on the login
 * screen. The token lives in the URL query string (?token=...) — this page
 * never sees or needs the email address, the backend already tied the token
 * to one account when it was issued.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Password dan konfirmasi tidak sama.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-bg">
      <img className="login-bg-bus" src="/login_image.png" alt="" aria-hidden="true" />
      <div className="page" style={{ maxWidth: 440, paddingTop: 40, position: 'relative' }}>
        <div className="center" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Crest size={84} />
          </div>
          <h1>Atur Ulang Password</h1>
        </div>

        <div className="card">
          {!token && (
            <div className="banner danger">
              <span>⚠</span>
              <div>Tautan tidak valid. Silakan minta tautan atur ulang password baru dari halaman masuk.</div>
            </div>
          )}

          {token && done && (
            <>
              <div className="banner success">
                <span>✅</span>
                <div>Password berhasil diatur ulang. Silakan masuk dengan password baru Anda.</div>
              </div>
              <button className="block" style={{ marginTop: 14 }} onClick={() => navigate('/login')}>
                Ke Halaman Masuk
              </button>
            </>
          )}

          {token && !done && (
            <form onSubmit={submit}>
              {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

              <div className="field">
                <label htmlFor="password">Password Baru <span className="req">*</span></label>
                <input id="password" type="password" autoComplete="new-password"
                       value={password} onChange={(e) => setPassword(e.target.value)} required />
                <div className="hint">Minimal 6 karakter.</div>
              </div>

              <div className="field">
                <label htmlFor="confirm">Konfirmasi Password <span className="req">*</span></label>
                <input id="confirm" type="password" autoComplete="new-password"
                       value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>

              <button className="block" type="submit" disabled={busy}>
                {busy ? 'Mohon tunggu…' : 'Simpan Password Baru'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

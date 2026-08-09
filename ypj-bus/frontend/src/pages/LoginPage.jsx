import { useState } from 'react';
import { api } from '../api';
import Crest from '../components/Crest.jsx';

/**
 * Parents create their own account; staff accounts are seeded or created by an
 * admin. There is no app to install — the school shares one link over WhatsApp.
 */
export default function LoginPage({ onSignedIn }) {
  const [mode, setMode] = useState('login');   // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await api.register(form);
      } else if (mode === 'forgot') {
        const res = await api.forgotPassword(form.email);
        setSent(res.message);
        return;
      } else {
        await api.login({ email: form.email, password: form.password });
      }
      await onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
    setSent(null);
  }

  return (
    <div className="login-bg">
      <img className="login-bg-bus" src="/login_image.png" alt="" aria-hidden="true" />
      <div className="page" style={{ maxWidth: 440, paddingTop: 40, position: 'relative' }}>
      <div className="center" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Crest size={84} />
        </div>
        <h1>Bis Sekolah YPJ Kuala Kencana</h1>
        <p className="muted">
          Pengajuan pengguna bis sekolah dan Kartu Akses Bis digital.
        </p>
      </div>

      <form className="card" onSubmit={submit}>
        <h2>
          {mode === 'login' ? 'Masuk'
            : mode === 'forgot' ? 'Lupa Password'
            : 'Daftar Akun Orang Tua'}
        </h2>

        {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}
        {sent && <div className="banner success"><span>✅</span><div>{sent}</div></div>}

        {mode === 'register' && (
          <div className="field">
            <label htmlFor="name">Nama Orang Tua / Wali <span className="req">*</span></label>
            <input id="name" type="text" value={form.name} onChange={set('name')} required />
          </div>
        )}

        {mode === 'forgot' && !sent && (
          <p className="muted" style={{ marginTop: -4 }}>
            Masukkan email akun Anda. Kami akan mengirim tautan untuk mengatur ulang password.
          </p>
        )}

        {!sent && (
          <div className="field">
            <label htmlFor="email">Email <span className="req">*</span></label>
            <input id="email" type="email" autoComplete="email"
                   value={form.email} onChange={set('email')} required />
          </div>
        )}

        {mode !== 'forgot' && !sent && (
          <div className="field">
            <label htmlFor="password">Password <span className="req">*</span></label>
            <input id="password" type="password"
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                   value={form.password} onChange={set('password')} required />
            {mode === 'register' && <div className="hint">Minimal 6 karakter.</div>}
          </div>
        )}

        {!sent && (
          <button className="block" type="submit" disabled={busy}>
            {busy ? 'Mohon tunggu…'
              : mode === 'login' ? 'Masuk'
              : mode === 'forgot' ? 'Kirim Tautan'
              : 'Daftar & Lanjut'}
          </button>
        )}

        {mode === 'login' && !sent && (
          <div className="center" style={{ marginTop: 10 }}>
            <button type="button" className="link" onClick={() => switchMode('forgot')}>
              Lupa password?
            </button>
          </div>
        )}

        <div className="center" style={{ marginTop: 14 }}>
          {mode === 'forgot' ? (
            <button type="button" className="link" onClick={() => switchMode('login')}>
              Kembali ke halaman masuk
            </button>
          ) : (
            <button type="button" className="link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login'
                ? 'Belum punya akun? Daftar di sini'
                : 'Sudah punya akun? Masuk'}
            </button>
          )}
        </div>
      </form>

      <p className="muted center">
        © YPJ Transportation 2026
      </p>
      </div>
    </div>
  );
}

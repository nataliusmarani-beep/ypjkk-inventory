import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const ROLES = [
  { key: 'transport_admin', label: 'Tim Transportasi Sekolah' },
  { key: 'driver',          label: 'Driver' },
  { key: 'helper',          label: 'Helper' },
  { key: 'school_staff',    label: 'Guru' },
  { key: 'leader',          label: 'Leader' },
  { key: 'admin',           label: 'Admin Sekolah' },
];

/**
 * Staff account management — Tim Transportasi Sekolah, Driver, Helper, Guru,
 * Leader, Admin Sekolah. Deliberately does not offer Super Admin (CLI-only, seed-admins.js)
 * or the legacy Petugas Bis role (superseded by the Driver/Helper split, but
 * left alone for whoever is already on it).
 *
 * Read-only for the Leader and Admin Sekolah roles — the backend enforces
 * this (routes/admin.js blocks every non-GET request from either role), this
 * page just also hides the controls so they aren't shown buttons that will
 * only 403.
 */
export default function AdminAccountsPage({ user }) {
  const navigate = useNavigate();
  const canManage = !['leader', 'admin'].includes(user?.role);

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState(null); // { name, email, password } shown once
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api.adminStaff().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  // A-Z by name, then filtered by the search box (name or email) — sort
  // happens first so a search that narrows to one letter still reads in
  // the same order the full list does.
  const visibleRows = rows
    ? [...rows]
        .sort((a, b) => a.name.localeCompare(b.name, 'id'))
        .filter((r) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
        })
    : null;

  return (
    <div className="page wide">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button onClick={() => navigate('/admin')}>Dashboard</button>
        <button className="on">Akun</button>
        {canManage && <button onClick={() => navigate('/admin/backup')}>Backup</button>}
      </div>

      <h1>Akun Pengguna</h1>
      <p className="muted">
        Buat dan kelola akun untuk Tim Transportasi Sekolah, Driver, Helper, Guru, Leader, dan Admin Sekolah.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {credential && (
        <div className="banner warn" style={{ alignItems: 'flex-start' }}>
          <span>🔑</span>
          <div>
            <strong>Akun {credential.name} dibuat.</strong> Catat kata sandi ini sekarang —
            hanya ditampilkan sekali.
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 15 }}>
              {credential.email} / {credential.password}
            </div>
            <button className="ghost" style={{ marginTop: 8 }} onClick={() => setCredential(null)}>
              Sudah dicatat
            </button>
          </div>
        </div>
      )}

      {canManage && (
        <CreateAccountForm
          busy={creating}
          onSubmit={async (payload) => {
            setCreating(true);
            setError(null);
            try {
              const res = await api.createStaffAccount(payload);
              if (res.generated_password) {
                setCredential({ name: payload.name, email: payload.email, password: res.generated_password });
              }
              load();
              return true;
            } catch (e) {
              setError(e.message);
              return false;
            } finally {
              setCreating(false);
            }
          }}
        />
      )}

      <input type="text" placeholder="Cari nama atau email…" value={query}
             onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12 }} />

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama</th><th>Email</th><th>Peran</th><th>Telepon</th>
                <th>Status</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {visibleRows === null && <tr><td colSpan={6} className="muted">Memuat…</td></tr>}
              {visibleRows?.length === 0 && (
                <tr><td colSpan={6} className="muted">
                  {query ? 'Tidak ada akun yang cocok.' : 'Belum ada akun staf.'}
                </td></tr>
              )}
              {visibleRows?.map((r) => (
                <StaffRow key={r.id} row={r} canManage={canManage}
                          onChanged={(res) => {
                            if (res?.generated_password) {
                              setCredential({ name: r.name, email: r.email, password: res.generated_password });
                            }
                            load();
                          }}
                          onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CreateAccountForm({ busy, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('driver');
  const [phone, setPhone] = useState('');

  async function submit(e) {
    e.preventDefault();
    const ok = await onSubmit({ name, email, role, phone_primary: phone });
    if (ok) {
      setName(''); setEmail(''); setPhone(''); setRole('driver');
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button className="block" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        + Buat Akun Baru
      </button>
    );
  }

  return (
    <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Nama lengkap" value={name} required style={{ flex: 2, minWidth: 200 }}
               onChange={(e) => setName(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="email" placeholder="Email" value={email} required style={{ flex: 2, minWidth: 200 }}
               onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="No. Telepon (opsional)" value={phone} style={{ flex: 1, minWidth: 180 }}
               onChange={(e) => setPhone(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Kata sandi awal dibuat otomatis dan ditampilkan sekali setelah akun dibuat.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button disabled={busy}>{busy ? 'Membuat…' : 'Buat Akun'}</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Batal</button>
      </div>
    </form>
  );
}

function StaffRow({ row, canManage, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [resettingPw, setResettingPw] = useState(false);
  const [pwDraft, setPwDraft] = useState('');

  function startEdit() {
    setDraft({ name: row.name, email: row.email, phone_primary: row.phone_primary || '' });
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft.name.trim()) { onError('Nama wajib diisi.'); return; }
    if (!draft.email.trim()) { onError('Email wajib diisi.'); return; }
    setBusy(true);
    try {
      await api.updateStaffAccount(row.id, {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone_primary: draft.phone_primary,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api.updateStaffAccount(row.id, { is_active: row.is_active ? 0 : 1 });
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset() {
    setBusy(true);
    try {
      // Blank input: let the server generate one (same as the old one-click
      // reset). Typed input: set that exact password — the "edit" case.
      const res = await api.resetStaffPassword(row.id, pwDraft.trim() ? { password: pwDraft.trim() } : {});
      setResettingPw(false);
      setPwDraft('');
      onChanged(res);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(newRole) {
    if (newRole === row.role) return;
    setBusy(true);
    try {
      await api.updateStaffAccount(row.id, { role: newRole });
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td>
          <input type="text" value={draft.name} disabled={busy}
                 onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </td>
        <td>
          <input type="email" value={draft.email} disabled={busy}
                 onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </td>
        <td>{row.role_label}</td>
        <td>
          <input type="text" placeholder="No. Telepon" value={draft.phone_primary} disabled={busy}
                 onChange={(e) => setDraft({ ...draft, phone_primary: e.target.value })} />
        </td>
        <td>
          {row.is_active
            ? <span className="chip ok">Aktif</span>
            : <span className="chip neutral">Nonaktif</span>}
        </td>
        <td>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={saveEdit}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
            <button className="ghost" disabled={busy} onClick={() => setEditing(false)}>Batal</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td>{row.name}</td>
        <td className="muted">{row.email}</td>
        <td>
          {canManage && row.role !== 'super_admin' && row.role !== 'attendant' ? (
            <select value={row.role} disabled={busy} onChange={(e) => changeRole(e.target.value)}>
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          ) : (
            row.role_label
          )}
        </td>
        <td className="muted">{row.phone_primary || '—'}</td>
        <td>
          {row.is_active
            ? <span className="chip ok">Aktif</span>
            : <span className="chip neutral">Nonaktif</span>}
        </td>
        {canManage && (
          <td>
            {row.role !== 'super_admin' && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="ghost" disabled={busy} onClick={startEdit}>Edit</button>
                <button className="ghost" disabled={busy}
                        onClick={() => setResettingPw((v) => !v)}>
                  {resettingPw ? 'Tutup' : 'Ubah Password'}
                </button>
                <button className="ghost" disabled={busy} onClick={toggleActive}>
                  {row.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </div>
            )}
          </td>
        )}
      </tr>
      {resettingPw && (
        <tr>
          <td colSpan={6}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
              <input type="text" placeholder="Password baru — kosongkan untuk dibuat acak"
                     value={pwDraft} disabled={busy} style={{ maxWidth: 320 }}
                     onChange={(e) => setPwDraft(e.target.value)} />
              <button disabled={busy} onClick={submitPasswordReset}>
                {busy ? 'Menyimpan…' : 'Simpan Password'}
              </button>
              <button className="ghost" disabled={busy}
                      onClick={() => { setResettingPw(false); setPwDraft(''); }}>
                Batal
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

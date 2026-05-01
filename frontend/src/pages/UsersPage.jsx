import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import Modal from '../components/shared/Modal.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import { parseCSV, downloadTemplate } from '../utils/download.js';

const ROLES       = ['Manager','Storekeeper','Principal','Teacher','Other'];
const UNIT_SCHOOLS = ['All','PAUD','SD','SMP'];
const LOCATIONS   = ['','PAUD YPJ KK','SD SMP YPJ KK'];
const STORE_CATS  = ['','Supplies','Teacher Resources','Sport & Uniform'];

const ROLE_COLOR = {
  Manager:'badge-blue', Storekeeper:'badge-teal', Principal:'badge-orange',
  Teacher:'badge-purple', Other:'badge-grey',
};

const BLANK_FORM = {
  name:'', email:'', role:'Teacher', unit_school:'All',
  location:'', store_category:'', password:'', is_active:1,
};

export default function UsersPage({ user: currentUser, showToast }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const importRef = useRef();
  const [importing, setImporting] = useState(false);

  const USER_HEADERS = ['name','email','role','unit_school','location','store_category','password'];
  const USER_SAMPLE  = { name:'Budi Santoso', email:'budi@ypj.sch.id', role:'Teacher', unit_school:'SD', location:'SD SMP YPJ KK', store_category:'', password:'YPJ2025' };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { showToast('CSV is empty or invalid.', 'error'); return; }
    setImporting(true);
    try {
      const res = await api.importUsers(rows);
      const msg = `Imported ${res.imported} user(s), skipped ${res.skipped} duplicate(s).` +
        (res.errors.length ? ` ${res.errors.length} error(s).` : '');
      showToast(msg, res.imported > 0 ? 'success' : 'error');
      if (res.errors.length) console.warn('Import errors:', res.errors);
      load();
    } catch (err) { showToast(err.message, 'error'); }
    setImporting(false);
  };

  const [modal,   setModal]   = useState(null); // 'add' | 'edit' | 'password' | 'delete'
  const [target,  setTarget]  = useState(null); // user being edited/deleted
  const [form,    setForm]    = useState(BLANK_FORM);
  const [pwForm,  setPwForm]  = useState({ password:'', confirm:'' });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getUsers({ search: search || undefined, role: roleFilter || undefined })
      .then(d => { setUsers(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [search, roleFilter]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm(BLANK_FORM);
    setFormErr('');
    setModal('add');
  };

  const openEdit = (u) => {
    setTarget(u);
    setForm({
      name: u.name, email: u.email, role: u.role,
      unit_school: u.unit_school, location: u.location || '',
      store_category: u.store_category || '', password: '', is_active: u.is_active,
    });
    setFormErr('');
    setModal('edit');
  };

  const openPassword = (u) => {
    setTarget(u);
    setPwForm({ password:'', confirm:'' });
    setFormErr('');
    setModal('password');
  };

  const openDelete = (u) => { setTarget(u); setModal('delete'); };
  const closeModal = () => { setModal(null); setTarget(null); setFormErr(''); };

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  /* ── Save new user ────────────────────────────────────────────────────── */
  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true); setFormErr('');
    try {
      await api.createUser(form);
      showToast('✅ User created.', 'success');
      closeModal(); load();
    } catch (err) { setFormErr(err.message); }
    setSaving(false);
  };

  /* ── Save edits ───────────────────────────────────────────────────────── */
  const handleEdit = async (e) => {
    e.preventDefault();
    setSaving(true); setFormErr('');
    try {
      await api.updateUser(target.id, { ...form, is_active: Number(form.is_active) });
      showToast('✅ User updated.', 'success');
      closeModal(); load();
    } catch (err) { setFormErr(err.message); }
    setSaving(false);
  };

  /* ── Reset password ───────────────────────────────────────────────────── */
  const handlePassword = async (e) => {
    e.preventDefault();
    if (pwForm.password !== pwForm.confirm) { setFormErr('Passwords do not match.'); return; }
    setSaving(true); setFormErr('');
    try {
      await api.resetPassword(target.id, { password: pwForm.password });
      showToast(`🔑 Password reset for ${target.name}.`, 'success');
      closeModal();
    } catch (err) { setFormErr(err.message); }
    setSaving(false);
  };

  /* ── Resend invitation email ──────────────────────────────────────────── */
  const handleResendInvite = async (u) => {
    try {
      await api.resendInvite(u.id);
      showToast(`📧 Invitation email resent to ${u.email}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  /* ── Delete user ──────────────────────────────────────────────────────── */
  const handleDelete = async () => {
    try {
      await api.deleteUser(target.id);
      showToast(`🗑️ ${target.name} removed.`, 'info');
      closeModal(); load();
    } catch (err) { showToast(err.message, 'error'); closeModal(); }
  };

  /* ── Counts ───────────────────────────────────────────────────────────── */
  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r).length;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">👥 User Management</div>
          <div className="page-subtitle">{users.length} registered users</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={() => downloadTemplate(USER_HEADERS, USER_SAMPLE, 'users-template.csv')}>⬇ Template</button>
          <button className="btn btn-secondary" onClick={() => importRef.current.click()} disabled={importing}>
            {importing ? 'Importing...' : '📂 Import CSV'}
          </button>
          <input ref={importRef} type="file" accept=".csv" style={{ display:'none' }} onChange={handleImportFile} />
          <button className="btn btn-primary" onClick={openAdd}>➕ Add User</button>
        </div>
      </div>

      {/* role summary chips */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        {ROLES.map(r => (
          <div key={r} className={`badge ${ROLE_COLOR[r]}`} style={{ fontSize:13, padding:'5px 12px' }}>
            {r}: {roleCounts[r] || 0}
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="filter-bar" style={{ marginBottom:16 }}>
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text" placeholder="Search by name or email…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {loading ? <p className="loading">Loading…</p> : users.length === 0
          ? <p className="empty-state">No users found.</p>
          : <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Email</th><th>Role</th>
                    <th>Unit</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                      <td>
                        <div style={{ fontWeight:700 }}>{u.name}</div>
                        {u.store_category && <div style={{ fontSize:11, color:'var(--muted)' }}>{u.store_category}</div>}
                      </td>
                      <td><span className="mono" style={{ fontSize:12 }}>{u.email}</span></td>
                      <td><span className={`badge ${ROLE_COLOR[u.role]}`}>{u.role}</span></td>
                      <td><span className={`badge ${u.unit_school === 'All' ? 'badge-grey' : 'badge-teal'}`}>{u.unit_school}</span></td>
                      <td>
                        <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="td-actions">
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)} title="Edit user">✏️ Edit</button>
                          <button className="btn btn-outline btn-sm" onClick={() => openPassword(u)} title="Reset password">🔑</button>
                          <button className="btn btn-outline btn-sm" onClick={() => handleResendInvite(u)} title="Resend invitation email">📧 Invite</button>
                          {u.id !== currentUser.id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => openDelete(u)} title="Remove user">🗑️</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>

      {/* ── Add User Modal ─────────────────────────────────────────────── */}
      {modal === 'add' && (
        <Modal title="➕ Add New User" onClose={closeModal}>
          <form onSubmit={handleAdd} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <UserFormFields form={form} set={set} setForm={setForm} isAdd />
            {formErr && <div className="alert alert-error" style={{ fontSize:13 }}>{formErr}</div>}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : '✅ Create User'}</button>
              <button className="btn btn-ghost" type="button" onClick={closeModal}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit User Modal ────────────────────────────────────────────── */}
      {modal === 'edit' && target && (
        <Modal title={`✏️ Edit — ${target.name}`} onClose={closeModal}>
          <form onSubmit={handleEdit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <UserFormFields form={form} set={set} setForm={setForm} isSelf={target.id === currentUser.id} />
            {formErr && <div className="alert alert-error" style={{ fontSize:13 }}>{formErr}</div>}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : '✅ Save Changes'}</button>
              <button className="btn btn-ghost" type="button" onClick={closeModal}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Reset Password Modal ───────────────────────────────────────── */}
      {modal === 'password' && target && (
        <Modal title={`🔑 Reset Password — ${target.name}`} onClose={closeModal}>
          <form onSubmit={handlePassword} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password" placeholder="Min. 4 characters" required minLength={4}
                value={pwForm.password} onChange={e => setPwForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password" placeholder="Repeat new password" required
                value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            {formErr && <div className="alert alert-error" style={{ fontSize:13 }}>{formErr}</div>}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : '🔑 Reset Password'}</button>
              <button className="btn btn-ghost" type="button" onClick={closeModal}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
      {modal === 'delete' && target && (
        <ConfirmDialog
          message={`Remove "${target.name}" (${target.email})? This cannot be undone.`}
          onConfirm={handleDelete}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/* ── Shared form fields for Add / Edit ─────────────────────────────────── */
function UserFormFields({ form, set, setForm, isAdd, isSelf }) {
  const isStorekeeper = form.role === 'Storekeeper';
  const isRestricted  = form.role === 'Storekeeper' || form.role === 'Principal' || form.role === 'Teacher';

  return (
    <>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="form-group">
          <label className="form-label">Full Name <span className="req">*</span></label>
          <input type="text" value={form.name} onChange={set('name')} required placeholder="e.g. Budi Santoso" />
        </div>
        <div className="form-group">
          <label className="form-label">Email <span className="req">*</span></label>
          <input type="text" value={form.email} onChange={set('email')} required placeholder="user@fmi.com" />
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="form-group">
          <label className="form-label">Role <span className="req">*</span></label>
          <select
            value={form.role}
            onChange={e => {
              const newRole = e.target.value;
              setForm(f => ({
                ...f,
                role: newRole,
                // Reset unit_school to PAUD if switching to a restricted role and currently All
                unit_school: (newRole === 'Storekeeper' || newRole === 'Principal' || newRole === 'Teacher') && f.unit_school === 'All' ? 'PAUD' : f.unit_school,
              }));
            }}
            disabled={isSelf}
          >
            {['Manager','Storekeeper','Principal','Teacher','Other'].map(r => <option key={r}>{r}</option>)}
          </select>
          {isSelf && <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>Cannot change your own role.</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Unit / School</label>
          <select
            value={form.unit_school}
            onChange={set('unit_school')}
          >
            {(isRestricted ? ['PAUD','SD','SMP'] : ['All','PAUD','SD','SMP']).map(u => <option key={u}>{u}</option>)}
          </select>
          {isRestricted && <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>Must be assigned to a specific unit.</div>}
        </div>
      </div>

      {/* Store Location — shown for ALL roles */}
      <div style={{ display:'grid', gridTemplateColumns: isStorekeeper ? '1fr 1fr' : '1fr', gap:12 }}>
        <div className="form-group">
          <label className="form-label">Store Location</label>
          <select value={form.location} onChange={set('location')}>
            <option value="">Both (All Stores)</option>
            <option value="PAUD YPJ KK">PAUD YPJ KK</option>
            <option value="SD SMP YPJ KK">SD SMP YPJ KK</option>
          </select>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>
            Controls which store items this user can see and request.
          </div>
        </div>
        {isStorekeeper && (
          <div className="form-group">
            <label className="form-label">Store Category</label>
            <select value={form.store_category} onChange={set('store_category')}>
              <option value="">— Select —</option>
              {['Supplies','Teacher Resources','Sport & Uniform'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {isAdd && (
        <div className="form-group">
          <label className="form-label">Initial Password <span className="req">*</span></label>
          <input type="password" value={form.password} onChange={set('password')} required minLength={4} placeholder="Min. 4 characters" />
        </div>
      )}

      {!isAdd && (
        <div className="form-group">
          <label className="form-label">Account Status</label>
          <select
            value={form.is_active}
            onChange={e => setForm(p => ({ ...p, is_active: Number(e.target.value) }))}
            disabled={isSelf}
          >
            <option value={1}>Active</option>
            <option value={0}>Inactive (cannot log in)</option>
          </select>
        </div>
      )}
    </>
  );
}

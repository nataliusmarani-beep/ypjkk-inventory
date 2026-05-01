import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import EmojiPicker from '../components/shared/EmojiPicker.jsx';

const EMPTY = {
  name: '', code: '', icon: '',
  category: 'Stationery', store_category: 'Supplies',
  location: 'SD SMP YPJ KK', unit_school: 'All',
  quantity: 0, max_quantity: 0, unit_name: 'pcs',
  min_threshold: 10, condition: 'Good', description: '',
};

function storekeepLock(user) {
  if (!user || user.role !== 'Storekeeper' || user.unit_school === 'All') return null;
  if (user.unit_school === 'PAUD') return { location: 'PAUD YPJ KK',    unitSchools: ['PAUD'] };
  return                                   { location: 'SD SMP YPJ KK', unitSchools: ['SD', 'SMP'] };
}

export default function AddItemPage({ showToast, user }) {
  const navigate = useNavigate();
  const lock = storekeepLock(user);
  const [form, setForm] = useState(() => lock
    ? { ...EMPTY, location: lock.location, unit_school: lock.unitSchools[0] }
    : EMPTY
  );
  const [meta, setMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getMeta().then(setMeta).catch(() => {}); }, []);

  const set = field => e => setForm(f => ({
    ...f,
    [field]: e.target.type === 'number' ? Number(e.target.value) : e.target.value,
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api.createItem({ ...form, max_quantity: form.max_quantity || form.quantity });
      showToast('✅ Item saved to inventory!', 'success');
      navigate('/inventory');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const M = meta || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">➕ Add New Item</div>
          <div className="page-subtitle">Add an item to the inventory catalog</div>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/inventory')}>← Back to Items</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="form-grid">
            <div className="form-group full">
              <label className="form-label">Item Icon</label>
              <EmojiPicker value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
            </div>

            <div className="form-group full">
              <label className="form-label">Item Name <span className="req">*</span></label>
              <input type="text" value={form.name} onChange={set('name')} placeholder="e.g. Whiteboard Marker" required />
            </div>

            <div className="form-group">
              <label className="form-label">Item Code <span className="req">*</span></label>
              <input type="text" value={form.code} onChange={set('code')} placeholder="e.g. STA-001" />
            </div>

            <div className="form-group">
              <label className="form-label">Category <span className="req">*</span></label>
              <select className="filter-select" value={form.category} onChange={set('category')} style={{ width: '100%' }}>
                {(M.CATEGORIES || ['Stationery']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Store Category <span className="req">*</span></label>
              <select className="filter-select" value={form.store_category} onChange={set('store_category')} style={{ width: '100%' }}>
                {(M.STORE_CATS || ['Supplies']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Location <span className="req">*</span></label>
              <select
                className="filter-select"
                value={form.location}
                onChange={set('location')}
                style={{ width: '100%', opacity: lock ? 0.75 : 1, cursor: lock ? 'not-allowed' : 'pointer' }}
                disabled={!!lock}
              >
                {(M.LOCATIONS || ['SD SMP YPJ KK']).map(l => <option key={l}>{l}</option>)}
              </select>
              {lock && <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>🔒 Assigned store location</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Unit School <span className="req">*</span></label>
              <select
                className="filter-select"
                value={form.unit_school}
                onChange={set('unit_school')}
                style={{ width: '100%', opacity: lock?.unitSchools.length === 1 ? 0.75 : 1, cursor: lock?.unitSchools.length === 1 ? 'not-allowed' : 'pointer' }}
                disabled={lock?.unitSchools.length === 1}
              >
                {(lock ? lock.unitSchools : (M.UNIT_SCHOOLS || ['All'])).map(u => <option key={u}>{u}</option>)}
              </select>
              {lock?.unitSchools.length === 1 && <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>🔒 Assigned to your unit</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Quantity <span className="req">*</span></label>
              <input type="number" min="0" value={form.quantity} onChange={set('quantity')} required />
            </div>

            <div className="form-group">
              <label className="form-label">Unit</label>
              <select className="filter-select" value={form.unit_name} onChange={set('unit_name')} style={{ width: '100%' }}>
                {(M.UNIT_NAMES || ['pcs']).map(u => <option key={u}>{u}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Low Stock Threshold <span className="req">*</span></label>
              <input type="number" min="1" value={form.min_threshold} onChange={set('min_threshold')} required />
            </div>

            <div className="form-group">
              <label className="form-label">Condition</label>
              <select className="filter-select" value={form.condition} onChange={set('condition')} style={{ width: '100%' }}>
                {(M.CONDITIONS || ['Good']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group full">
              <label className="form-label">Description</label>
              <textarea value={form.description} onChange={set('description')} placeholder="Additional notes about this item..." />
            </div>
          </div>

          <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : '💾 Save Item'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/inventory')}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}

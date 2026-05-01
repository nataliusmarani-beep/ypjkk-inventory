import { useState } from 'react';
import EmojiPicker from '../shared/EmojiPicker.jsx';

const CAT_BY_STORE = {
  'Supplies':          ['Stationery','Housekeeping','Groceries','Tools','Medical/First Aid','Electronics'],
  'Teacher Resources': ['Learning Tools','Art & Craft','Lab Tools','Decoration'],
  'Sport & Uniform':   ['Sport Equipment','School Uniform','Event Uniform','Traditional Uniform'],
};

// Derive locked location + allowed unit_school options for a Storekeeper
function storekeepLock(user) {
  if (!user || user.role !== 'Storekeeper' || user.unit_school === 'All') return null;
  if (user.unit_school === 'PAUD') return { location: 'PAUD YPJ KK',    unitSchools: ['PAUD'] };
  return                                   { location: 'SD SMP YPJ KK', unitSchools: ['SD', 'SMP'] };
}

export default function ItemForm({ initial, meta, user, onSubmit, onClose }) {
  const lock = storekeepLock(user);

  const [form, setForm] = useState(() => {
    const base = initial ?? {
      name:'', code:'', icon:'', category:'Stationery', store_category:'Supplies',
      location:'SD SMP YPJ KK', unit_school:'All',
      quantity:0, unit_name:'pcs', description:'', min_threshold:10, condition:'Good',
    };
    // Pre-fill locked fields when adding a new item
    if (lock && !initial) {
      return { ...base, location: lock.location, unit_school: lock.unitSchools[0] };
    }
    return base;
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const M = meta || {};
  const set = field => e => {
    const val = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setForm(f => {
      if (field === 'store_category') {
        const firstCat = (CAT_BY_STORE[val] || [])[0] || f.category;
        return { ...f, store_category: val, category: firstCat };
      }
      return { ...f, [field]: val };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try { await onSubmit(form); }
    catch (err) { setError(err.message); setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="form-grid">
        <div className="form-group full">
          <label className="form-label">Item Icon</label>
          <EmojiPicker value={form.icon || ''} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        </div>
        <div className="form-group full">
          <label className="form-label">Item Name <span className="req">*</span></label>
          <input type="text" value={form.name} onChange={set('name')} required />
        </div>
        <div className="form-group">
          <label className="form-label">Store Category <span className="req">*</span></label>
          <select className="filter-select" style={{ width:'100%' }} value={form.store_category} onChange={set('store_category')}>
            {(M.STORE_CATS||[]).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Category <span className="req">*</span></label>
          <select className="filter-select" style={{ width:'100%' }} value={form.category} onChange={set('category')}>
            {(CAT_BY_STORE[form.store_category] || M.CATEGORIES || []).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Quantity <span className="req">*</span></label>
          <input type="number" min="0" value={form.quantity} onChange={set('quantity')} required />
        </div>
        <div className="form-group">
          <label className="form-label">Min Threshold <span className="req">*</span></label>
          <input type="number" min="1" value={form.min_threshold} onChange={set('min_threshold')} required />
        </div>
        <div className="form-group">
          <label className="form-label">Location</label>
          <select
            className="filter-select"
            style={{ width:'100%', opacity: lock ? 0.75 : 1, cursor: lock ? 'not-allowed' : 'pointer' }}
            value={form.location}
            onChange={set('location')}
            disabled={!!lock}
          >
            {(M.LOCATIONS||[]).map(l => <option key={l}>{l}</option>)}
          </select>
          {lock && <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>🔒 Assigned store</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Unit School</label>
          <select
            className="filter-select"
            style={{ width:'100%', opacity: lock?.unitSchools.length === 1 ? 0.75 : 1, cursor: lock?.unitSchools.length === 1 ? 'not-allowed' : 'pointer' }}
            value={form.unit_school}
            onChange={set('unit_school')}
            disabled={lock?.unitSchools.length === 1}
          >
            {(lock ? lock.unitSchools : (M.UNIT_SCHOOLS||['All','PAUD','SD','SMP'])).map(u => <option key={u}>{u}</option>)}
          </select>
          {lock?.unitSchools.length === 1 && <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>🔒 Assigned to your unit</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Condition</label>
          <select className="filter-select" style={{ width:'100%' }} value={form.condition} onChange={set('condition')}>
            {(M.CONDITIONS||[]).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group full">
          <label className="form-label">PR / PO Number <span className="req">*</span></label>
          <input
            type="text"
            value={form.po_number || ''}
            onChange={set('po_number')}
            placeholder="e.g. PO-2026-001 or PR-2026-042"
            required
          />
        </div>
        <div className="form-group full">
          <label className="form-label">Description</label>
          <textarea
            value={form.description || ''}
            onChange={set('description')}
            rows={3}
            placeholder="Additional notes about this item..."
          />
        </div>
      </div>
      <div className="form-actions" style={{ marginTop: 18 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

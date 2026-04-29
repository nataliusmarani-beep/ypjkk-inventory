import { useState } from 'react';
import EmojiPicker from '../shared/EmojiPicker.jsx';

export default function ItemForm({ initial, meta, onSubmit, onClose }) {
  const [form, setForm] = useState(initial ?? {
    name:'', code:'', icon:'', category:'Stationery', store_category:'Supplies',
    location:'SD SMP YPJ KK', unit_school:'All',
    quantity:0, unit_name:'pcs', description:'', min_threshold:10, condition:'Good',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const M = meta || {};
  const set = field => e => setForm(f => ({
    ...f, [field]: e.target.type === 'number' ? Number(e.target.value) : e.target.value,
  }));

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
          <label className="form-label">Category <span className="req">*</span></label>
          <select className="filter-select" style={{ width:'100%' }} value={form.category} onChange={set('category')}>
            {(M.CATEGORIES||[]).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Store Category</label>
          <select className="filter-select" style={{ width:'100%' }} value={form.store_category} onChange={set('store_category')}>
            {(M.STORE_CATS||[]).map(c => <option key={c}>{c}</option>)}
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
          <select className="filter-select" style={{ width:'100%' }} value={form.location} onChange={set('location')}>
            {(M.LOCATIONS||[]).map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Condition</label>
          <select className="filter-select" style={{ width:'100%' }} value={form.condition} onChange={set('condition')}>
            {(M.CONDITIONS||[]).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="form-actions" style={{ marginTop: 18 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

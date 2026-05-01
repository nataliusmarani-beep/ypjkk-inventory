import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import EmojiPicker from '../components/shared/EmojiPicker.jsx';
import BarcodeScanner from '../components/shared/BarcodeScanner.jsx';

const CAT_BY_STORE = {
  'Supplies':          ['Stationery','Housekeeping','Groceries','Tools','Medical/First Aid','Electronics'],
  'Teacher Resources': ['Learning Tools','Art & Craft','Lab Tools','Decoration'],
  'Sport & Uniform':   ['Sport Equipment','School Uniform','Event Uniform','Traditional Uniform'],
};

const EMPTY = {
  name: '', code: '', icon: '',
  category: 'Stationery', store_category: 'Supplies',
  location: 'SD SMP YPJ KK', unit_school: 'All',
  quantity: 0, max_quantity: 0, unit_name: 'pcs',
  min_threshold: 10, condition: 'Good', po_number: '', description: '',
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
  const [meta,           setMeta]           = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState(null);
  const [showScanner,    setShowScanner]    = useState(false);
  const [nameSuggestion, setNameSuggestion] = useState(null);  // { name, brand }
  const [lookingUp,      setLookingUp]      = useState(false);

  useEffect(() => { api.getMeta().then(setMeta).catch(() => {}); }, []);

  const set = field => e => {
    const val = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setForm(f => {
      if (field === 'store_category') {
        // Auto-reset category to first valid option for the chosen store category
        const firstCat = (CAT_BY_STORE[val] || [])[0] || f.category;
        return { ...f, store_category: val, category: firstCat };
      }
      return { ...f, [field]: val };
    });
  };

  const handleScan = async (barcode) => {
    setShowScanner(false);
    setForm(f => ({ ...f, code: barcode }));
    setNameSuggestion(null);

    // Try to look up the product name from the barcode
    setLookingUp(true);
    try {
      const res  = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
      const data = await res.json();
      if (data.items?.length > 0) {
        const item  = data.items[0];
        const name  = item.title || '';
        const brand = item.brand || '';
        if (name) setNameSuggestion({ name, brand });
      }
    } catch { /* network error — silently skip */ }
    finally { setLookingUp(false); }
  };

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

      {/* ── Name suggestion from barcode lookup ── */}
      {nameSuggestion && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 700, marginBottom: 2 }}>
              💡 Product found from barcode
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>
              {nameSuggestion.name}
            </div>
            {nameSuggestion.brand && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{nameSuggestion.brand}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={() => {
                setForm(f => ({ ...f, name: nameSuggestion.name }));
                setNameSuggestion(null);
              }}
            >✓ Use this name</button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={() => setNameSuggestion(null)}
            >Dismiss</button>
          </div>
        </div>
      )}

      {lookingUp && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          🔍 Looking up product name from barcode…
        </div>
      )}

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
              <label className="form-label">Item Code / Barcode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={form.code}
                  onChange={set('code')}
                  placeholder="e.g. STA-001 or scan barcode"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  title="Scan barcode with camera"
                  onClick={() => { setNameSuggestion(null); setShowScanner(true); }}
                  style={{ whiteSpace: 'nowrap', padding: '0 14px' }}
                >
                  📷 Scan
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Store Category <span className="req">*</span></label>
              <select className="filter-select" value={form.store_category} onChange={set('store_category')} style={{ width: '100%' }}>
                {(M.STORE_CATS || ['Supplies']).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Category <span className="req">*</span></label>
              <select className="filter-select" value={form.category} onChange={set('category')} style={{ width: '100%' }}>
                {(CAT_BY_STORE[form.store_category] || M.CATEGORIES || ['Stationery']).map(c => <option key={c}>{c}</option>)}
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

      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

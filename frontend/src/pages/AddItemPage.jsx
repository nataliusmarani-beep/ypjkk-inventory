import { useState, useEffect, useRef } from 'react';
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
  name: '', code: '', barcode: '', icon: '',
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
  const [nameSuggestion, setNameSuggestion] = useState(null);
  const [lookingUp,      setLookingUp]      = useState(false);
  const [existingItem,   setExistingItem]   = useState(null);

  // ── Item search ────────────────────────────────────────────────────────────
  const [searchQuery,    setSearchQuery]    = useState('');
  const [searchResults,  setSearchResults]  = useState([]);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const [clonedFrom,     setClonedFrom]     = useState(null); // item cloned as template
  const searchTimer = useRef(null);

  useEffect(() => { api.getMeta().then(setMeta).catch(() => {}); }, []);

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchResults([]);
    clearTimeout(searchTimer.current);
    if (q.trim().length < 2) return;
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await api.getItems({ search: q.trim() });
        setSearchResults(results.slice(0, 8));
      } catch { /* ignore */ } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const selectSearchResult = (item) => {
    setClonedFrom(item);
    setSearchQuery('');
    setSearchResults([]);
    setExistingItem(null);
    setForm(f => ({
      ...f,
      name:           item.name           || '',
      code:           item.code           || '',
      icon:           item.icon           || '',
      category:       item.category       || 'Stationery',
      store_category: item.store_category || 'Supplies',
      unit_name:      item.unit_name      || 'pcs',
      min_threshold:  item.min_threshold  ?? 10,
      condition:      item.condition      || 'Good',
      description:    item.description    || '',
      quantity:       0,
      max_quantity:   item.max_quantity   ?? 0,
    }));
  };

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
    setNameSuggestion(null);
    setExistingItem(null);
    setLookingUp(true);

    try {
      // ── Step 1: Check local inventory database first ──────────────────────
      const localMatches = await api.getItems({ barcode });
      if (localMatches.length > 0) {
        const item = localMatches[0];
        setExistingItem(item);
        // Pull ALL fields from existing item into the form
        setForm({
          name:           item.name           || '',
          code:           item.code           || '',
          barcode:        item.barcode        || barcode,
          icon:           item.icon           || '',
          category:       item.category       || 'Stationery',
          store_category: item.store_category || 'Supplies',
          location:       item.location       || 'SD SMP YPJ KK',
          unit_school:    item.unit_school    || 'All',
          quantity:       item.quantity       ?? 0,
          max_quantity:   item.max_quantity   ?? 0,
          unit_name:      item.unit_name      || 'pcs',
          min_threshold:  item.min_threshold  ?? 10,
          condition:      item.condition      || 'Good',
          po_number:      item.po_number      || '',
          description:    item.description    || '',
        });
        return; // skip external lookup — item is already in inventory
      }

      // ── Step 2: Not in local DB — try external product databases ──────────
      setForm(f => ({ ...f, barcode }));
      let name = '';

      // Source 1: UPC Item DB (broad product database)
      try {
        const res  = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
        const data = await res.json();
        if (data.items?.length > 0 && data.items[0].title) {
          name = data.items[0].title.trim();
        }
      } catch { /* ignore */ }

      // Source 2: Open Food Facts (groceries / packaged goods)
      if (!name) {
        try {
          const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
          const data = await res.json();
          if (data.status === 1 && data.product) {
            name = (data.product.product_name_en || data.product.product_name || '').trim();
          }
        } catch { /* ignore */ }
      }

      if (name) {
        setForm(f => ({ ...f, name }));
        showToast('✅ Item name auto-filled from barcode', 'success');
      } else {
        setNameSuggestion({ notFound: true });
      }
    } finally {
      setLookingUp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const payload = { ...form, max_quantity: form.max_quantity || form.quantity };
      if (existingItem) {
        await api.updateItem(existingItem.id, payload);
        showToast('✅ Item updated successfully!', 'success');
      } else {
        await api.createItem(payload);
        showToast('✅ Item saved to inventory!', 'success');
      }
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
          <div className="page-title">{existingItem ? '✏️ Update Item' : '➕ Add New Item'}</div>
          <div className="page-subtitle">{existingItem ? `Updating stock for: ${existingItem.name}` : 'Add an item to the inventory catalog'}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/inventory')}>← Back to Items</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Search existing items ── */}
      <div style={{ marginBottom: 16, position: 'relative' }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 1px 4px rgba(0,0,0,.08)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
            🔍 Search Existing Items
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Find an item already added by another storekeeper and use it as a template for your location.
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Type item name to search…"
              value={searchQuery}
              onChange={handleSearchChange}
              autoComplete="off"
            />
            {searchLoading && (
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--muted)' }}>
                searching…
              </span>
            )}
          </div>
          {searchResults.length > 0 && (
            <div style={{
              marginTop: 6, border: '1px solid var(--border)', borderRadius: 8,
              overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,.08)',
            }}>
              {searchResults.map(item => (
                <div
                  key={item.id}
                  onClick={() => selectSearchResult(item)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', background: '#fff',
                    borderBottom: '1px solid var(--border)', display: 'flex',
                    alignItems: 'center', gap: 10,
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <span style={{ fontSize: 20, flexShrink: 0, width: 24, textAlign: 'center' }}>
                    {item.icon && item.icon.startsWith('data:image')
                      ? <img src={item.icon} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3 }} />
                      : (item.icon || '📦')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--navy)' }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {item.category} · {item.location} · Stock: {item.quantity} {item.unit_name}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, flexShrink: 0 }}>Use as template →</span>
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', padding: '6px 0' }}>
              No matching items found. Fill in the form below to add a new item.
            </div>
          )}
        </div>
      </div>

      {/* ── Cloned from template banner ── */}
      {clonedFrom && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 700, marginBottom: 2 }}>
              📋 Template applied from another location
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>
              {clonedFrom.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              From: {clonedFrom.location} · Set your own quantity below, then save.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => { setClonedFrom(null); setForm(lock ? { ...EMPTY, location: lock.location, unit_school: lock.unitSchools[0] } : EMPTY); }}
          >
            ✕ Clear template
          </button>
        </div>
      )}

      {/* ── Existing item found banner ── */}
      {existingItem && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: '#15803d', fontWeight: 700, marginBottom: 2 }}>
              🔄 Existing item found in inventory
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>
              {existingItem.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Current stock: <strong>{existingItem.quantity} {existingItem.unit_name}</strong>
              {' · '}All fields pre-filled. Adjust quantity or any field, then save.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => { setExistingItem(null); setForm(lock ? { ...EMPTY, location: lock.location, unit_school: lock.unitSchools[0] } : EMPTY); }}
          >
            ✕ Clear & add new item
          </button>
        </div>
      )}

      {/* ── Barcode lookup status ── */}
      {lookingUp && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          🔍 Looking up product name from barcode…
        </div>
      )}

      {nameSuggestion?.notFound && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 13, color: '#92400e',
        }}>
          <span>⚠️ Product not found in database — please enter the item name manually.</span>
          <button
            type="button"
            onClick={() => setNameSuggestion(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#92400e', marginLeft: 8 }}
          >✕</button>
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
              <label className="form-label">Item Code</label>
              <input
                type="text"
                value={form.code}
                onChange={set('code')}
                placeholder="e.g. STA-001"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Barcode Number</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={set('barcode')}
                  placeholder="Scan or type the barcode"
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
              {saving ? 'Saving...' : existingItem ? '💾 Update Item' : '💾 Save Item'}
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

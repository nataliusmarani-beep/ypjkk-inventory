import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/shared/Modal.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import ItemForm from '../components/Inventory/ItemForm.jsx';
import { parseCSV, downloadTemplate } from '../utils/download.js';
import CategoryBadge from '../components/shared/CategoryBadge.jsx';

const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};
const STORE_TABS = ['All','Supplies','Teacher Resources','Sport & Uniform'];

function stockPct(qty, max) { return max > 0 ? Math.min(100, Math.round(qty / max * 100)) : 0; }
function stockColor(qty, threshold) {
  if (qty <= threshold * 0.5) return '#dc2626';
  if (qty <= threshold) return '#d97706';
  return '#16a34a';
}

export default function InventoryPage({ role, user, showToast }) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const initialStatus = new URLSearchParams(routerLocation.search).get('status') || '';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [storeTab, setStoreTab] = useState('All');
  const [modal, setModal] = useState(null);
  const [meta, setMeta] = useState(null);

  const isAdmin = role === 'Manager' || role === 'Storekeeper';

  // Returns true if the current user is allowed to edit/delete a given item.
  // Mirrors the backend restriction in routes/items.js: confined to the
  // storekeeper's assigned location/category when those fields are set.
  const canEdit = (item) => {
    if (role === 'Manager') return true;
    if (role !== 'Storekeeper') return false;
    if (!user) return false;
    const myLocation = user.location
      || (user.unit_school === 'PAUD' ? 'PAUD YPJ KK'
        : (user.unit_school === 'SD' || user.unit_school === 'SMP') ? 'SD SMP YPJ KK'
        : null);
    if (myLocation && item.location !== myLocation) return false;
    if (user.store_category && item.store_category !== user.store_category) return false;
    return true;
  };
  const importRef = useRef();
  const [importing, setImporting] = useState(false);

  const ITEM_HEADERS = ['name','code','barcode','subtitle','category','store_category','item_type','location','unit_school','quantity','max_quantity','unit_name','min_threshold','condition','description'];
  const ITEM_SAMPLE  = { name:'Spidol Whiteboard', code:'STN-001', barcode:'8991234567890', subtitle:'Blue', category:'Stationery', store_category:'Supplies', item_type:'used-up', location:'SD SMP YPJ KK', unit_school:'All', quantity:'20', max_quantity:'50', unit_name:'pcs', min_threshold:'5', condition:'Good', description:'Optional note' };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { showToast('CSV is empty or invalid.', 'error'); return; }
    setImporting(true);
    try {
      const res = await api.importItems(rows);
      const msg = `Imported ${res.imported} item(s), skipped ${res.skipped} duplicate(s).` +
        (res.errors.length ? ` ${res.errors.length} error(s).` : '');
      showToast(msg, res.imported > 0 ? 'success' : 'error');
      if (res.errors.length) console.warn('Import errors:', res.errors);
      load();
    } catch (err) { showToast(err.message, 'error'); }
    setImporting(false);
  };

  // Use explicit location set by admin; fallback to unit_school mapping
  const storeLocation = (() => {
    if (isAdmin) return undefined;
    if (user?.location) return user.location;
    if (!user || user.unit_school === 'All') return undefined;
    return user.unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK';
  })();

  useEffect(() => { api.getMeta().then(setMeta).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.getItems({
      search:         search || undefined,
      category:       category || undefined,
      status:         statusFilter || undefined,
      location:       storeLocation ?? (location || undefined),
      store_category: storeTab !== 'All' ? storeTab : undefined,
    }).then(d => { setItems(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [search, category, statusFilter, location, storeTab, storeLocation]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    try {
      await api.deleteItem(modal.data.id);
      showToast('Item deleted.', 'success');
      load();
    } catch (err) { showToast(err.message, 'error'); }
    setModal(null);
  };

  const handleSave = async (form) => {
    if (modal.type === 'edit') {
      await api.updateItem(modal.data.id, form);
      showToast('Item updated.', 'success');
    }
    load();
    setModal(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">📦 Inventory Items</div>
          <div className="page-subtitle">
            {storeLocation ? `${storeLocation} Store` : 'All items across both locations'}
          </div>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => downloadTemplate(ITEM_HEADERS, ITEM_SAMPLE, 'items-template.csv')}>⬇ Template</button>
            <button className="btn btn-secondary" onClick={() => importRef.current.click()} disabled={importing}>
              {importing ? 'Importing...' : '📂 Import CSV'}
            </button>
            <input ref={importRef} type="file" accept=".csv" style={{ display:'none' }} onChange={handleImportFile} />
            <button className="btn btn-primary" onClick={() => navigate('/add-item')}>➕ Add Item</button>
          </div>
        )}
      </div>

      <div className="tabs">
        {STORE_TABS.map(t => (
          <div key={t} className={`tab${storeTab === t ? ' active' : ''}`} onClick={() => setStoreTab(t)}>
            {t}
          </div>
        ))}
      </div>

      <div className="filter-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input type="text" placeholder="Search items, code, or barcode..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {(meta?.CATEGORIES || []).map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="low_stock">⚠️ Low Stock</option>
          <option value="out_of_stock">🔴 Out of Stock</option>
          <option value="ok">✅ OK</option>
        </select>
        {/* Location dropdown only for Admin/Storekeeper; Teachers are locked to their store */}
        {isAdmin && (
          <select value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">All Locations</option>
            {(meta?.LOCATIONS || []).map(l => <option key={l}>{l}</option>)}
          </select>
        )}
      </div>

      <div className="card inventory-card-wrap" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <p className="loading">Loading...</p> : items.length === 0
          ? <p className="empty-state">No items found.</p>
          : <div className="table-wrap">
              <table className="responsive-table inventory-table">
                <thead>
                  <tr>
                    <th>Item</th><th>Category</th><th>Type</th><th>Location</th>
                    <th>Unit</th><th>Stock</th><th>Condition</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const pct = stockPct(item.quantity, item.max_quantity || item.quantity + 1);
                    const col = stockColor(item.quantity, item.min_threshold);
                    const low = item.quantity <= item.min_threshold;
                    const stockStatus = item.quantity === 0 ? 'out' : low ? 'low' : 'ok';
                    return (
                      <tr key={item.id} data-stock={stockStatus}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <div className={`item-thumb${(item.icon || '').startsWith('data:') ? ' has-photo' : ''}`}>
                                {(item.icon || '').startsWith('data:')
                                  ? <img src={item.icon} alt="" style={{ width:'100%', height:'100%', objectFit:'contain', borderRadius:4 }} />
                                  : (item.icon || CAT_EMOJI[item.category] || '📦')}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                {isAdmin && canEdit(item) ? (
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setModal({ type: 'edit', data: item })}
                                    onKeyDown={e => { if (e.key === 'Enter') setModal({ type: 'edit', data: item }); }}
                                    style={{ fontWeight: 700, color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                                    title="Edit item details & description"
                                  >
                                    {item.name}
                                  </div>
                                ) : (
                                  <div style={{ fontWeight: 700 }}>{item.name}</div>
                                )}
                                {(item.barcode || item.code || item.subtitle) && (
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--muted)' }}>
                                    {(item.barcode || item.code) && <span className="mono">{item.barcode || item.code}</span>}
                                    {(item.barcode || item.code) && item.subtitle && <span className="mono">|</span>}
                                    {item.subtitle && <span className="item-subtitle">{item.subtitle}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                            {stockStatus !== 'ok' && (
                              <span className="badge badge-red" style={{ flexShrink: 0 }}>
                                {stockStatus === 'out' ? '🔴 Out' : '⚠️ Low'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-th="Category"><CategoryBadge category={item.category} /></td>
                        <td data-th="Type">
                          <span className={`badge ${item.item_type === 'borrow' ? 'badge-purple' : 'badge-grey'}`}>
                            {item.item_type === 'borrow' ? '↩️ Borrow' : '🗑️ Used-up'}
                          </span>
                        </td>
                        <td data-th="Location"><span style={{ fontSize: 12, fontWeight: 700 }}>📍 {item.location}</span></td>
                        <td data-th="Unit"><span className={`badge ${item.unit_school === 'All' ? 'badge-grey' : 'badge-teal'}`}>{item.unit_school}</span></td>
                        <td data-th="Stock">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="stock-bar">
                              <span className="stock-fill" style={{ width: `${pct}%`, background: col }}></span>
                            </span>
                            <span className={low ? (item.quantity === 0 ? 'qty-low' : 'qty-warn') : 'qty-ok'}>
                              {item.quantity} {item.unit_name}
                            </span>
                          </div>
                        </td>
                        <td data-th="Condition">
                          {item.quantity === 0
                            ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>N/A</span>
                            : <span className={`badge ${item.condition === 'Good' ? 'badge-green' : item.condition === 'Fair' ? 'badge-orange' : 'badge-red'}`}>{item.condition}</span>
                          }
                        </td>
                        {isAdmin && (
                          <td>
                            <div className="td-actions">
                              {canEdit(item) ? (
                                <>
                                  <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit', data: item })}>✏️ Edit</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'delete', data: item })}>🗑️ Delete</button>
                                </>
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--muted)' }} title="You can only edit items in your assigned store">🔒 Locked</span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        }
      </div>

      {modal?.type === 'edit' && (
        <Modal title="Edit Item" onClose={() => setModal(null)}>
          <ItemForm initial={modal.data} meta={meta} user={user} onSubmit={handleSave} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'delete' && (
        <ConfirmDialog
          message={`Delete "${modal.data.name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

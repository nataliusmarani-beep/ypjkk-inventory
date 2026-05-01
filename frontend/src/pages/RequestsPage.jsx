import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

/* ── constants ─────────────────────────────────────────────────────────── */
const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};
const STATUS_BADGE = { pending:'badge-orange', approved:'badge-green', rejected:'badge-red', returned:'badge-teal' };
const STATUS_LABEL = { pending:'⏳ Pending', approved:'✅ Approved', rejected:'❌ Rejected', returned:'↩ Returned' };
const TYPE_BADGE   = { 'used-up':'badge-orange', borrow:'badge-purple' };

const GRP_ID = (gid, date) => {
  const iso = (date || '').includes('T') ? date : (date || '').replace(' ', 'T') + 'Z';
  const d   = new Date(iso);
  const mm  = isNaN(d) ? '??' : String(d.getMonth()+1).padStart(2,'0');
  const dd  = isNaN(d) ? '??' : String(d.getDate()).padStart(2,'0');
  return `REQ-${mm}${dd}-${String(gid).slice(-4).toUpperCase()}`;
};
const TODAY = () => new Date().toISOString().slice(0,10);

/* ── component ─────────────────────────────────────────────────────────── */
export default function RequestsPage({ role, user, showToast, refreshPending }) {
  const isAdmin = role === 'Manager' || role === 'Storekeeper';

  /* history */
  const [groups, setGroups]   = useState([]);
  const [histLoading, setHL]  = useState(true);

  /* cart mode toggle */
  const [cartMode, setCartMode] = useState(false);

  /* browsing */
  const [allItems, setAllItems] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch]     = useState('');

  /* cart: [{ item, quantity }] — any category mix allowed */
  const [cart, setCart] = useState([]);

  /* requester form — pre-fill from logged-in user */
  const [form, setForm] = useState({
    requester_name:  user?.name  || '',
    requester_email: user?.email || '',
    type: 'used-up',
    unit_school: user?.unit_school || 'All',
    purpose: '', return_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState(null);
  const [detailItem, setDetailItem] = useState(null);

  /* ── loaders ─────────────────────────────────────────────────────────── */
  // Teachers only see their own requests; Admins/Storekeepers see all
  const histFilter = !isAdmin && user?.email ? { requester_email: user.email } : {};

  const loadHistory = useCallback(() => {
    setHL(true);
    api.getGroups(histFilter)
      .then(d => { setGroups(d); setHL(false); })
      .catch(() => setHL(false));
  }, []);

  // Map user's unit_school to a store location filter (non-admins only)
  const storeLocation = (() => {
    if (isAdmin) return undefined;                          // admins see everything
    if (!user || user.unit_school === 'All') return undefined; // All → both stores
    return user.unit_school === 'PAUD' ? 'PAUD YPJ KK' : 'SD SMP YPJ KK'; // PAUD → PAUD store; SD/SMP → SD SMP store
  })();

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    api.getItems({ location: storeLocation }).then(setAllItems).catch(() => {});
  }, []);

  /* ── filtered browse list ────────────────────────────────────────────── */
  const categories   = [...new Set(allItems.map(i => i.category))].sort();
  const browseItems  = allItems.filter(it => {
    if (filterCat && it.category !== filterCat) return false;
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  /* ── cart helpers ────────────────────────────────────────────────────── */
  const cartQtyOf  = id => cart.find(c => c.item.id === id)?.quantity || 0;
  const cartTotal  = cart.reduce((s, c) => s + c.quantity, 0);

  const addToCart = item => {
    setCart(prev => {
      const ex = prev.find(c => c.item.id === item.id);
      if (ex) return prev.map(c => c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { item, quantity: 1 }];
    });
  };

  const setQty = (id, qty) => {
    if (qty < 1) { setCart(prev => prev.filter(c => c.item.id !== id)); return; }
    setCart(prev => prev.map(c => c.item.id === id ? { ...c, quantity: qty } : c));
  };

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  /* ── submit ──────────────────────────────────────────────────────────── */
  const handleSubmit = async e => {
    e.preventDefault();
    if (cart.length === 0) { setFormError('Your cart is empty.'); return; }
    setSubmitting(true); setFormError(null);
    try {
      await api.submitCart({
        ...form,
        category: null,          // mixed categories — no lock
        items: cart.map(c => ({ item_id: c.item.id, quantity: c.quantity })),
      });
      showToast('✅ Request submitted! Storekeeper will be notified.', 'success');
      setCart([]);
      setForm({ requester_name: user?.name || '', requester_email: user?.email || '', type:'used-up', unit_school: user?.unit_school || 'All', purpose:'', return_date:'' });
      setCartMode(false);
      loadHistory(); refreshPending();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">📋 My Requests</div>
          <div className="page-subtitle">Submit and track your item requests</div>
        </div>
        <button
          className={`btn ${cartMode ? 'btn-outline' : 'btn-primary'}`}
          onClick={() => { setCartMode(m => !m); setFormError(null); }}
        >
          {cartMode ? '← Back to History' : `🛒 New Request${cartTotal > 0 ? ` (${cartTotal})` : ''}`}
        </button>
      </div>

      {/* ── CART MODE ─────────────────────────────────────────────────── */}
      {cartMode && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:20, alignItems:'start' }}>

          {/* LEFT: item browser */}
          <div>
            {/* filters */}
            <div className="filter-bar" style={{ marginBottom:14 }}>
              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search items..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            {/* item grid */}
            {browseItems.length === 0
              ? <p className="empty-state">No items found.</p>
              : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:12 }}>
                  {browseItems.map(item => {
                    const inCart     = cartQtyOf(item.id);
                    const outOfStock = item.quantity === 0;
                    const isLow      = item.quantity > 0 && item.quantity <= item.min_threshold;

                    return (
                      <div
                        key={item.id}
                        style={{
                          background: 'white',
                          border: `1.5px solid ${inCart > 0 ? 'var(--blue)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius)',
                          padding: 14,
                          opacity: outOfStock ? .5 : 1,
                          transition: 'border-color .15s',
                        }}
                      >
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:5 }}>
                          <div style={{ fontSize:26, lineHeight:1 }}>
                            {(item.icon || '').startsWith('data:')
                              ? <img src={item.icon} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:6 }} />
                              : (item.icon || CAT_EMOJI[item.category] || '📦')}
                          </div>
                          <button
                            title="View item details"
                            onClick={() => setDetailItem(item)}
                            style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'var(--muted)', padding:0, lineHeight:1 }}
                          >ℹ️</button>
                        </div>
                        <div style={{ fontWeight:800, fontSize:13, marginBottom:2, lineHeight:1.3 }}>{item.name}</div>
                        {item.code && <div className="mono" style={{ color:'var(--muted)', marginBottom:4, fontSize:11 }}>{item.code}</div>}
                        <div style={{ fontSize:11, fontWeight:700, marginBottom:8, color: outOfStock ? 'var(--red)' : isLow ? 'var(--amber)' : 'var(--green)' }}>
                          {outOfStock ? 'Out of stock' : `${item.quantity} ${item.unit_name} available`}
                          {isLow && !outOfStock && ' ⚠️'}
                        </div>
                        <div style={{ marginBottom:8 }}>
                          <span className="badge badge-blue" style={{ fontSize:10 }}>{item.category}</span>
                        </div>

                        {inCart > 0 ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <button className="btn btn-outline btn-sm" style={{ padding:'4px 10px', minWidth:28 }} onClick={() => setQty(item.id, inCart-1)}>−</button>
                            <span style={{ fontWeight:800, minWidth:22, textAlign:'center', fontSize:13 }}>{inCart}</span>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ padding:'4px 10px', minWidth:28 }}
                              onClick={() => inCart < item.quantity && setQty(item.id, inCart+1)}
                              disabled={inCart >= item.quantity}
                            >+</button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ width:'100%' }}
                            disabled={outOfStock}
                            onClick={() => addToCart(item)}
                          >
                            {outOfStock ? 'Out of Stock' : '+ Add to Cart'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
            }
          </div>

          {/* RIGHT: cart + requester form */}
          <div style={{ position:'sticky', top:80 }}>
            <div className="card" style={{ marginBottom:0 }}>
              <div className="card-title" style={{ marginBottom:12 }}>
                🛒 Cart
                <span style={{ marginLeft:'auto', fontSize:12, color:'var(--muted)', fontWeight:600 }}>
                  {cart.length} item type{cart.length !== 1 ? 's' : ''}
                </span>
              </div>

              {cart.length === 0
                ? <p style={{ color:'var(--muted)', fontSize:13, padding:'10px 0' }}>
                    No items added yet.<br />Browse and click <strong>+ Add to Cart</strong>.
                  </p>
                : <>
                    {cart.map(({ item, quantity }) => (
                      <div key={item.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ fontSize:18, flexShrink:0, lineHeight:1 }}>
                          {(item.icon || '').startsWith('data:')
                            ? <img src={item.icon} alt="" style={{ width:22, height:22, objectFit:'contain', borderRadius:3 }} />
                            : (item.icon || CAT_EMOJI[item.category] || '📦')}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize:10.5, color:'var(--muted)' }}>{item.category} · {item.unit_name}</div>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding:'2px 7px' }} onClick={() => setQty(item.id, quantity-1)}>−</button>
                          <span style={{ fontWeight:800, minWidth:18, textAlign:'center', fontSize:13 }}>{quantity}</span>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding:'2px 7px' }}
                            onClick={() => quantity < item.quantity && setQty(item.id, quantity+1)}
                            disabled={quantity >= item.quantity}
                          >+</button>
                        </div>
                        <button className="btn-icon" style={{ color:'var(--red)', flexShrink:0 }} onClick={() => setQty(item.id, 0)}>✕</button>
                      </div>
                    ))}

                    <div style={{ display:'flex', justifyContent:'space-between', padding:'9px 0 2px', fontWeight:800, fontSize:13, color:'var(--navy)' }}>
                      <span>Total units</span>
                      <span>{cartTotal}</span>
                    </div>
                  </>
              }

              {/* requester form */}
              <form onSubmit={handleSubmit} style={{ marginTop:14, display:'flex', flexDirection:'column', gap:11 }}>
                {formError && <div className="alert alert-error" style={{ fontSize:12, padding:'8px 12px' }}>{formError}</div>}

                {/* Name & email are locked to the logged-in user */}
                <div style={{ background:'var(--off)', borderRadius:'var(--radius-sm)', padding:'9px 12px', fontSize:12 }}>
                  <div style={{ fontWeight:800, color:'var(--navy)' }}>{form.requester_name}</div>
                  <div style={{ color:'var(--muted)' }}>{form.requester_email}</div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                    Type <span className="req">*</span>
                    <select className="filter-select" value={form.type} onChange={set('type')} style={{ width:'100%', marginTop:4 }}>
                      <option value="used-up">Used-up</option>
                      <option value="borrow">Borrow</option>
                    </select>
                  </label>
                  <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                    Unit School
                    <select
                      className="filter-select"
                      value={form.unit_school}
                      onChange={set('unit_school')}
                      disabled={!isAdmin}
                      style={{ width:'100%', marginTop:4, opacity: isAdmin ? 1 : 0.75, cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                    >
                      {['All','PAUD','SD','SMP'].map(u => <option key={u}>{u}</option>)}
                    </select>
                    {!isAdmin && (
                      <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>
                        🔒 Assigned to your unit
                      </div>
                    )}
                  </label>
                </div>

                {form.type === 'borrow' && (
                  <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                    Return By
                    <input type="date" min={TODAY()} value={form.return_date} onChange={set('return_date')} style={{ marginTop:4 }} />
                  </label>
                )}

                <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                  Purpose / Notes
                  <textarea value={form.purpose} onChange={set('purpose')} rows={2} placeholder="Reason for request..." style={{ marginTop:4 }} />
                </label>

                <button type="submit" className="btn btn-primary" disabled={submitting || cart.length === 0} style={{ width:'100%' }}>
                  {submitting ? 'Submitting...' : `📤 Submit (${cart.length} item${cart.length !== 1 ? 's' : ''})`}
                </button>

                {cart.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCart([])} style={{ width:'100%' }}>
                    🗑 Clear Cart
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── ITEM DETAIL MODAL ─────────────────────────────────────────── */}
      {detailItem && (
        <div className="modal-overlay" onClick={() => setDetailItem(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📋 Item Details</h3>
              <button className="modal-close" onClick={() => setDetailItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Icon + name */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16 }}>
                <div style={{ fontSize:44, lineHeight:1 }}>
                  {(detailItem.icon || '').startsWith('data:')
                    ? <img src={detailItem.icon} alt="" style={{ width:52, height:52, objectFit:'contain', borderRadius:8 }} />
                    : (detailItem.icon || CAT_EMOJI[detailItem.category] || '📦')}
                </div>
                <div>
                  <div style={{ fontWeight:800, fontSize:16, color:'var(--navy)' }}>{detailItem.name}</div>
                  {detailItem.code && <div className="mono" style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{detailItem.code}</div>}
                  <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' }}>
                    <span className="badge badge-blue" style={{ fontSize:11 }}>{detailItem.category}</span>
                    <span className="badge badge-grey" style={{ fontSize:11 }}>{detailItem.store_category}</span>
                  </div>
                </div>
              </div>

              {/* Details table */}
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
                <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                  <tbody>
                    {[
                      ['📍 Location',  detailItem.location],
                      ['🏫 Unit School', detailItem.unit_school],
                      ['📦 Stock',     `${detailItem.quantity} ${detailItem.unit_name}`],
                      ['⚡ Min Threshold', `${detailItem.min_threshold} ${detailItem.unit_name}`],
                      ['🔧 Condition', detailItem.condition],
                    ].map(([label, value]) => (
                      <tr key={label} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'7px 0', color:'var(--muted)', fontWeight:600, whiteSpace:'nowrap', paddingRight:16 }}>{label}</td>
                        <td style={{ padding:'7px 0', fontWeight:700 }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Description */}
              {detailItem.description && (
                <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#1e40af' }}>
                  <strong>Description:</strong>
                  <p style={{ margin:'6px 0 0', lineHeight:1.6 }}>{detailItem.description}</p>
                </div>
              )}

              {/* Stock status */}
              <div style={{
                marginTop:14,
                padding:'10px 14px',
                borderRadius:8,
                background: detailItem.quantity === 0 ? '#fef2f2' : detailItem.quantity <= detailItem.min_threshold ? '#fffbeb' : '#f0fdf4',
                border: `1px solid ${detailItem.quantity === 0 ? '#fecaca' : detailItem.quantity <= detailItem.min_threshold ? '#fde68a' : '#bbf7d0'}`,
                fontSize:13,
                fontWeight:700,
                color: detailItem.quantity === 0 ? '#dc2626' : detailItem.quantity <= detailItem.min_threshold ? '#d97706' : '#16a34a',
              }}>
                {detailItem.quantity === 0 ? '🔴 Out of Stock — cannot be requested'
                  : detailItem.quantity <= detailItem.min_threshold ? `⚠️ Low Stock — only ${detailItem.quantity} ${detailItem.unit_name} left`
                  : `✅ In Stock — ${detailItem.quantity} ${detailItem.unit_name} available`}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDetailItem(null)}>Close</button>
              {detailItem.quantity > 0 && (
                <button className="btn btn-primary" onClick={() => { addToCart(detailItem); setDetailItem(null); }}>
                  + Add to Cart
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY TABLE ─────────────────────────────────────────────── */}
      {!cartMode && (
        <>
          <div className="alert alert-info">
            💡 You can add items from <strong>any category</strong> into one cart and submit as a single request.
            All requests need storekeeper approval.
          </div>

          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            {histLoading ? <p className="loading">Loading...</p> : groups.length === 0
              ? <p className="empty-state">No requests yet. Click <strong>🛒 New Request</strong> to start!</p>
              : <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Request ID</th><th>Items in Request</th>
                        <th>Type</th><th>Requester</th><th>Status</th><th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => {
                        const gid = g.group_id || `solo-${g.items[0]?.id}`;
                        return (
                          <tr key={gid}>
                            <td><span className="mono">{GRP_ID(gid, g.created_at)}</span></td>
                            <td>
                              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                                {g.items.map(it => (
                                  <div key={it.id} style={{ fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                                    <span>
                                      {(it.item_icon || '').startsWith('data:')
                                        ? <img src={it.item_icon} alt="" style={{ width:16, height:16, objectFit:'contain', borderRadius:2, verticalAlign:'middle' }} />
                                        : (it.item_icon || CAT_EMOJI[it.item_category] || CAT_EMOJI[g.category] || '📦')}
                                    </span>
                                    {it.item_name}
                                    <span style={{ color:'var(--muted)' }}>× {it.quantity} {it.unit_name}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td><span className={`badge ${TYPE_BADGE[g.type]}`}>{g.type}</span></td>
                            <td>
                              {g.requester_name}
                              <br /><span style={{ fontSize:11, color:'var(--muted)' }}>{g.requester_email}</span>
                            </td>
                            <td><span className={`badge ${STATUS_BADGE[g.status]}`}>{STATUS_LABEL[g.status]}</span></td>
                            <td>{g.created_at?.slice(0,10)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        </>
      )}
    </div>
  );
}

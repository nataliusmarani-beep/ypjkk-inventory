import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { api } from '../api.js';
import CategoryBadge from '../components/shared/CategoryBadge.jsx';

/* ── constants ─────────────────────────────────────────────────────────── */
const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};

// Force a line break at the nearest word boundary around `maxFirstLine`
// chars instead of leaving it to CSS text-wrap.
function breakFirstLine(name, maxFirstLine = 20) {
  if (!name || name.length <= maxFirstLine) return [name || '', ''];
  let idx = name.lastIndexOf(' ', maxFirstLine);
  if (idx <= 0) idx = name.indexOf(' ', maxFirstLine);
  if (idx === -1) return [name, ''];
  return [name.slice(0, idx), name.slice(idx + 1)];
}

/* ── browse-grid item card ────────────────────────────────────────────────
   Memoized so bumping one item's qty only re-renders that one card, not the
   whole (potentially 400+ item) grid — on slow mobile devices, re-rendering
   every card on every +/- tap was heavy enough to feel like the page had
   frozen mid-scroll. */
const BrowseItemCard = memo(function BrowseItemCard({ item, inCart, onSetQty, onAddToCart, onShowDetail }) {
  const outOfStock = item.quantity === 0;
  const isLow      = item.quantity > 0 && item.quantity <= item.min_threshold;

  return (
    <div
      style={{
        background: 'white',
        border: `1.5px solid ${inCart > 0 ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: 14,
        opacity: outOfStock ? .5 : 1,
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        contain: 'layout',
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:5, marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          {(() => {
            const [line1, rest] = breakFirstLine(item.name);
            return (
              <div style={{ fontWeight:800, fontSize:13, lineHeight:1.3 }}>
                <div>{line1}</div>
                {rest && <div>{rest}</div>}
              </div>
            );
          })()}
          {[item.barcode || item.code, item.subtitle].filter(Boolean).length > 0 && (
            <div className="mono" style={{ color:'var(--muted)', marginTop:2, fontSize:11 }}>
              {[item.barcode || item.code, item.subtitle].filter(Boolean).join(' | ')}
            </div>
          )}
        </div>
        <div style={{ position:'relative', flexShrink:0 }}>
          <div style={{ fontSize:58, lineHeight:1, width:78, height:78, display:'flex', alignItems:'center', justifyContent:'center' }}>
            {(item.icon || '').startsWith('data:')
              ? <img src={item.icon} alt="" style={{ width:78, height:78, objectFit:'contain', borderRadius:8 }} />
              : (item.icon || CAT_EMOJI[item.category] || '📦')}
          </div>
          <button
            title="View item details"
            onClick={() => onShowDetail(item)}
            style={{
              position:'absolute', top:-6, right:-6, width:20, height:20,
              background:'white', border:'1px solid var(--border)', borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', fontSize:11, padding:0, lineHeight:1,
              touchAction:'manipulation',
            }}
          >ℹ️</button>
        </div>
      </div>
      <div style={{ fontSize:11, fontWeight:700, marginBottom:8, color: outOfStock ? 'var(--red)' : isLow ? 'var(--amber)' : 'var(--green)' }}>
        {outOfStock ? 'Out of stock' : `${item.quantity} ${item.unit_name} available`}
        {isLow && !outOfStock && ' ⚠️'}
      </div>
      <div style={{ marginBottom:8, display:'flex', gap:5, flexWrap:'wrap' }}>
        <CategoryBadge category={item.category} />
        <span className={`badge ${item.item_type === 'borrow' ? 'badge-purple' : 'badge-grey'}`}>
          {item.item_type === 'borrow' ? '↩️ Borrow' : '🗑️ Used-up'}
        </span>
      </div>

      {inCart > 0 ? (
        <div style={{ display:'flex', alignItems:'center', gap:6, maxWidth:'100%' }}>
          <button className="btn btn-outline btn-sm" style={{ padding:'4px 10px', minWidth:28 }} onClick={() => onSetQty(item.id, inCart-1)}>−</button>
          <span style={{ fontWeight:800, minWidth:22, textAlign:'center', fontSize:13 }}>{inCart}</span>
          <button
            className="btn btn-outline btn-sm"
            style={{ padding:'4px 10px', minWidth:28 }}
            onClick={() => inCart < item.quantity && onSetQty(item.id, inCart+1)}
            disabled={inCart >= item.quantity}
          >+</button>
        </div>
      ) : (
        <button
          className="btn btn-primary btn-sm"
          style={{ width:'100%' }}
          disabled={outOfStock}
          onClick={() => onAddToCart(item)}
        >
          {outOfStock ? 'Out of Stock' : '+ Add to Cart'}
        </button>
      )}
    </div>
  );
});
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
  const [groups, setGroups]     = useState([]);
  const [histLoading, setHL]    = useState(true);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 10;

  /* "complete request" inline form (requester supplies info an admin asked for) */
  const [completingGroup, setCompletingGroup] = useState(null); // group_id | null
  const [completeNote,    setCompleteNote]    = useState('');
  const [completeFile,    setCompleteFile]    = useState(null);
  const [completing,      setCompleting]      = useState(false);

  const handleCompleteInfo = async gid => {
    if (!completeNote.trim() && !completeFile) { showToast('Add a note or attachment first.', 'error'); return; }
    setCompleting(true);
    try {
      await api.completeInfo(gid, { purpose: completeNote.trim() || undefined }, completeFile);
      showToast('✅ Sent! The storekeeper/manager will review again.', 'success');
      setCompletingGroup(null); setCompleteNote(''); setCompleteFile(null);
      loadHistory();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setCompleting(false);
  };

  /* cart mode toggle */
  const [cartMode, setCartMode] = useState(false);

  /* browsing */
  const [allItems, setAllItems] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch]     = useState('');

  /* cart: [{ item, quantity }] — any category mix allowed */
  const [cart, setCart] = useState([]);
  const cartPanelRef = useRef(null);
  const scrollToCart = () => cartPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /* requester form — pre-fill from logged-in user */
  const [form, setForm] = useState({
    requester_name:  user?.name  || '',
    requester_email: user?.email || '',
    unit_school: user?.unit_school || 'All',
    purpose: '', return_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [attachment, setAttachment] = useState(null); // File | null

  const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.eml,.msg';
  const ATTACHMENT_MAX_MB = 1;

  const handleAttachmentChange = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_MB * 1024 * 1024) {
      setFormError(`Attachment must be under ${ATTACHMENT_MAX_MB} MB.`);
      return;
    }
    setFormError(null);
    setAttachment(file);
  };

  /* ── loaders ─────────────────────────────────────────────────────────── */
  // Teachers only see their own requests; Admins/Storekeepers see all
  const histFilter = !isAdmin && user?.email ? { requester_email: user.email } : {};

  const loadHistory = useCallback(() => {
    setHL(true);
    api.getGroups(histFilter)
      .then(d => { setGroups(d); setHL(false); setHistoryPage(1); })
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
  const cartHasBorrow = cart.some(c => c.item.item_type === 'borrow');

  const addToCart = useCallback(item => {
    setCart(prev => {
      const ex = prev.find(c => c.item.id === item.id);
      if (ex) return prev.map(c => c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { item, quantity: 1 }];
    });
  }, []);

  const setQty = useCallback((id, qty) => {
    if (qty < 1) { setCart(prev => prev.filter(c => c.item.id !== id)); return; }
    setCart(prev => prev.map(c => c.item.id === id ? { ...c, quantity: qty } : c));
  }, []);

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }));

  /* ── submit ──────────────────────────────────────────────────────────── */
  // Each item's type is locked from its own catalog entry (set by an admin/
  // storekeeper), not chosen by the requester — so a mixed cart is split
  // into up to two requests, one per type, each with its own group_id.
  const handleSubmit = async e => {
    e.preventDefault();
    if (cart.length === 0) { setFormError('Your cart is empty.'); return; }

    const usedUpItems = cart.filter(c => c.item.item_type !== 'borrow');
    const borrowItems = cart.filter(c => c.item.item_type === 'borrow');
    if (borrowItems.length > 0 && !form.return_date) {
      setFormError('Return By date is required for borrowed items.');
      return;
    }

    setSubmitting(true); setFormError(null);
    try {
      if (usedUpItems.length > 0) {
        await api.submitCart({
          ...form,
          type: 'used-up',
          return_date: null,
          category: null,          // mixed categories — no lock
          items: usedUpItems.map(c => ({ item_id: c.item.id, quantity: c.quantity })),
        }, attachment);
      }
      if (borrowItems.length > 0) {
        await api.submitCart({
          ...form,
          type: 'borrow',
          category: null,
          items: borrowItems.map(c => ({ item_id: c.item.id, quantity: c.quantity })),
        }, attachment);
      }
      showToast('✅ Request submitted! Storekeeper will be notified.', 'success');
      setCart([]);
      setForm({ requester_name: user?.name || '', requester_email: user?.email || '', unit_school: user?.unit_school || 'All', purpose:'', return_date:'' });
      setAttachment(null);
      setCartMode(false);
      loadHistory(); refreshPending();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── history pagination ─────────────────────────────────────────────── */
  const historyTotalPages = Math.max(1, Math.ceil(groups.length / HISTORY_PAGE_SIZE));
  const pagedGroups = groups.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);
  const goToHistoryPage = p => {
    setHistoryPage(Math.min(Math.max(1, p), historyTotalPages));
    setExpandedGroup(null);
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
        <>
          {/* Search/filter stays reachable even after scrolling down to the
              cart panel, so the requester can keep adding items without
              scrolling all the way back up to the top of the item grid. */}
          <div className="filter-bar sticky-filter-bar" style={{ marginBottom:14 }}>
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

        <div className="cart-layout">

          {/* LEFT: item browser */}
          <div>
            {/* item grid */}
            {browseItems.length === 0
              ? <p className="empty-state">No items found.</p>
              : <div className="browse-grid">
                  {browseItems.map(item => (
                    <BrowseItemCard
                      key={item.id}
                      item={item}
                      inCart={cartQtyOf(item.id)}
                      onSetQty={setQty}
                      onAddToCart={addToCart}
                      onShowDetail={setDetailItem}
                    />
                  ))}
                </div>
            }
          </div>

          {/* RIGHT: cart + requester form */}
          <div className="cart-panel" ref={cartPanelRef}>
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
                          <div style={{ fontSize:10.5, color:'var(--muted)' }}>
                            {item.category} · {item.unit_name}{item.item_type === 'borrow' ? ' · ↩️ Borrow' : ''}
                          </div>
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

                {cartHasBorrow && (
                  <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                    Return By <span className="req">*</span>
                    <input type="date" min={TODAY()} value={form.return_date} onChange={set('return_date')} required style={{ marginTop:4 }} />
                    <div style={{ fontSize:10, fontWeight:600, color:'var(--muted)', marginTop:3 }}>
                      ↩️ Your cart has item(s) that must be returned by this date.
                    </div>
                  </label>
                )}

                <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                  Purpose / Notes
                  <textarea value={form.purpose} onChange={set('purpose')} rows={2} placeholder="Reason for request..." style={{ marginTop:4 }} />
                </label>

                <label style={{ fontSize:12, fontWeight:800, color:'var(--navy)' }}>
                  Attachment <span style={{ fontWeight:600, color:'var(--muted)' }}>(optional)</span>
                  {attachment
                    ? <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:8, background:'var(--off)', borderRadius:'var(--radius-sm)', padding:'8px 10px', fontSize:12, fontWeight:600 }}>
                        <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📎 {attachment.name}</span>
                        <button type="button" onClick={() => setAttachment(null)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontWeight:700, padding:0 }}>✕</button>
                      </div>
                    : <>
                        <input id="attachment-input" type="file" accept={ATTACHMENT_ACCEPT} onChange={handleAttachmentChange} style={{ display:'none' }} />
                        <label htmlFor="attachment-input" className="btn btn-outline btn-sm" style={{ marginTop:4, width:'100%', textAlign:'center', cursor:'pointer' }}>
                          📎 Attach email, PDF, or image
                        </label>
                      </>
                  }
                  <div style={{ fontSize:10, color:'var(--muted)', marginTop:3, fontWeight:600 }}>Max {ATTACHMENT_MAX_MB} MB — image, PDF, or .eml/.msg</div>
                </label>

                <button type="submit" className="btn btn-primary" disabled={submitting || cart.length === 0} style={{ width:'100%' }}>
                  {submitting ? 'Submitting...' : `📤 Submit (${cart.length} item${cart.length !== 1 ? 's' : ''})`}
                </button>

                {cart.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCart([]); setAttachment(null); }} style={{ width:'100%' }}>
                    🗑 Clear Cart
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
        </>
      )}

      {/* ── Mobile-only floating "go to cart" bar — the cart/submit form sits
           below the (often long) item grid once stacked to one column, so
           give a shortcut straight to it instead of relying on scrolling ── */}
      {cartMode && cart.length > 0 && (
        <button type="button" className="mobile-cart-bar" onClick={scrollToCart}>
          🛒 View Cart · {cartTotal} item{cartTotal !== 1 ? 's' : ''}
          <span style={{ marginLeft:'auto' }}>↓</span>
        </button>
      )}

      {/* ── ITEM DETAIL MODAL ─────────────────────────────────────────── */}
      {detailItem && (
        <div className="modal-overlay" onClick={() => setDetailItem(null)}>
          <div className="modal" style={{ width: 420, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📋 Item Details</h3>
              <button className="modal-close" onClick={() => setDetailItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Icon + name */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:10, marginBottom:16 }}>
                <div style={{
                  width:160, height:160, flexShrink:0, borderRadius:16,
                  border:'1.5px solid var(--border)', background:'var(--bg)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  padding:10, overflow:'hidden', fontSize:88, lineHeight:1,
                }}>
                  {(detailItem.icon || '').startsWith('data:')
                    ? <img src={detailItem.icon} alt="" style={{ width:'100%', height:'100%', objectFit:'contain', borderRadius:10 }} />
                    : (detailItem.icon || CAT_EMOJI[detailItem.category] || '📦')}
                </div>
                <div>
                  <div style={{ fontWeight:800, fontSize:16, color:'var(--navy)' }}>{detailItem.name}</div>
                  {[detailItem.barcode || detailItem.code, detailItem.subtitle].filter(Boolean).length > 0 && (
                    <div className="mono" style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                      {[detailItem.barcode || detailItem.code, detailItem.subtitle].filter(Boolean).join(' | ')}
                    </div>
                  )}
                  <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
                    <CategoryBadge category={detailItem.category} />
                    <span className="badge badge-grey" style={{ fontSize:11 }}>{detailItem.store_category}</span>
                    <span className={`badge ${detailItem.item_type === 'borrow' ? 'badge-purple' : 'badge-grey'}`} style={{ fontSize:11 }}>
                      {detailItem.item_type === 'borrow' ? '↩️ Borrow' : '🗑️ Used-up'}
                    </span>
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
            <span>💡</span>
            <span>
              You can add items from <strong>any category</strong> into one cart and submit as a single request.
              All requests need storekeeper approval.
            </span>
          </div>

          <div className="card history-card-wrap" style={{ padding:0, overflow:'hidden' }}>
            {histLoading ? <p className="loading">Loading...</p> : groups.length === 0
              ? <p className="empty-state">No requests yet. Click <strong>🛒 New Request</strong> to start!</p>
              : <div className="table-wrap">
                  <table className="responsive-table history-table">
                    <thead>
                      <tr>
                        <th>Request</th><th>Items in Request</th>
                        <th>Type</th><th>Requester</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedGroups.map(g => {
                        const gid = g.group_id || `solo-${g.items[0]?.id}`;
                        const isExpanded = expandedGroup === gid;
                        return (
                          <React.Fragment key={gid}>
                            <tr
                              onClick={() => setExpandedGroup(isExpanded ? null : gid)}
                              className={`history-row${isExpanded ? ' is-expanded' : ''}`}
                              data-status={g.status}
                              style={{ cursor:'pointer', background: isExpanded ? 'var(--off)' : undefined }}
                            >
                              <td>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                                    <span style={{ fontSize:10, color:'var(--muted)', transition:'transform .15s', display:'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink:0 }}>▶</span>
                                    <span className="mono" style={{ fontWeight:800 }}>{GRP_ID(gid, g.created_at)}</span>
                                  </div>
                                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                                    <span className={`badge ${STATUS_BADGE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                                    {g.status === 'pending' && g.needs_info === 1 && (
                                      <span className="badge badge-orange" title="Info needed">✏️</span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginTop:4, marginLeft:16 }}>
                                  📅 {g.created_at?.slice(0,10)}
                                </div>
                              </td>
                              <td data-th="Items">
                                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                                  {g.items.map(it => (
                                    <div key={it.id} style={{ fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                      <span style={{ minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                        {it.item_name}
                                        <span style={{ color:'var(--muted)' }}> × {it.quantity} {it.unit_name}</span>
                                      </span>
                                      <span style={{ fontSize:20, lineHeight:1, flexShrink:0 }}>
                                        {(it.item_icon || '').startsWith('data:')
                                          ? <img src={it.item_icon} alt="" style={{ width:24, height:24, objectFit:'contain', borderRadius:4, verticalAlign:'middle' }} />
                                          : (it.item_icon || CAT_EMOJI[it.item_category] || CAT_EMOJI[g.category] || '📦')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td data-th="Type"><span className={`badge ${TYPE_BADGE[g.type]}`}>{g.type}</span></td>
                              <td data-th="Requester">
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                  <div style={{
                                    width:26, height:26, borderRadius:'50%', background:'var(--navy)', color:'white',
                                    display:'flex', alignItems:'center', justifyContent:'center',
                                    fontSize:11, fontWeight:800, flexShrink:0,
                                  }}>
                                    {(g.requester_name || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.requester_name}</div>
                                    <div style={{ fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.requester_email}</div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="history-detail" style={{ background:'var(--off)' }}>
                                <td colSpan={4} style={{ padding:'0 16px 14px 40px' }}>
                                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                                    {g.purpose && (
                                      <div style={{ fontSize:13, color:'var(--text)' }}>
                                        <span style={{ fontWeight:700, color:'var(--navy)' }}>Purpose: </span>{g.purpose}
                                      </div>
                                    )}
                                    {g.type === 'borrow' && g.return_date && (
                                      <div style={{ fontSize:13, color:'var(--text)' }}>
                                        <span style={{ fontWeight:700, color:'var(--navy)' }}>Return By: </span>{g.return_date}
                                      </div>
                                    )}
                                    {g.attachment_path && (
                                      <div style={{ fontSize:13 }}>
                                        <a href={api.attachmentUrl(g.attachment_path)} target="_blank" rel="noreferrer" style={{ color:'var(--primary)', fontWeight:700, textDecoration:'underline' }}>
                                          📎 {g.attachment_name || 'Attachment'}
                                        </a>
                                      </div>
                                    )}
                                    {(g.status === 'approved' || g.status === 'returned') && (
                                      <div style={{
                                        background:'#f0fdf4', border:'1px solid #bbf7d0',
                                        borderRadius:8, padding:'10px 14px', fontSize:13, color:'#15803d',
                                      }}>
                                        <strong>✅ Approved</strong>
                                        {g.approved_at && <span style={{ fontWeight:400, marginLeft:8, color:'#166534', fontSize:12 }}>{g.approved_at?.slice(0,10)}</span>}
                                        {g.approval_notes && <div style={{ marginTop:5, color:'#166534' }}>📝 {g.approval_notes}</div>}
                                        {!g.approval_notes && <div style={{ marginTop:5, color:'#86efac', fontSize:12 }}>No additional notes from storekeeper.</div>}
                                      </div>
                                    )}
                                    {g.status === 'rejected' && (
                                      <div style={{
                                        background:'#fef2f2', border:'1px solid #fecaca',
                                        borderRadius:8, padding:'10px 14px', fontSize:13, color:'#b91c1c',
                                      }}>
                                        <strong>❌ Rejected</strong>
                                        {g.approval_notes && <div style={{ marginTop:5 }}>📝 {g.approval_notes}</div>}
                                        {!g.approval_notes && <div style={{ marginTop:5, color:'#fca5a5', fontSize:12 }}>No reason provided.</div>}
                                      </div>
                                    )}
                                    {g.status === 'pending' && g.needs_info === 1 && (
                                      <div style={{
                                        background:'#fffbeb', border:'1px solid #fde68a',
                                        borderRadius:8, padding:'10px 14px', fontSize:13, color:'#92400e',
                                      }}>
                                        <strong>✏️ More info needed:</strong> {g.info_request_note}

                                        {completingGroup === gid ? (
                                          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:8 }} onClick={e => e.stopPropagation()}>
                                            <textarea
                                              value={completeNote}
                                              onChange={e => setCompleteNote(e.target.value)}
                                              rows={2}
                                              placeholder="Explain or add the missing detail..."
                                              style={{ fontSize:13 }}
                                            />
                                            {completeFile
                                              ? <div style={{ display:'flex', alignItems:'center', gap:8, background:'white', borderRadius:6, padding:'6px 10px', fontSize:12, fontWeight:600 }}>
                                                  <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>📎 {completeFile.name}</span>
                                                  <button type="button" onClick={() => setCompleteFile(null)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontWeight:700, padding:0 }}>✕</button>
                                                </div>
                                              : <>
                                                  <input id={`complete-file-${gid}`} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.eml,.msg" style={{ display:'none' }}
                                                    onChange={e => {
                                                      const f = e.target.files?.[0]; e.target.value = '';
                                                      if (!f) return;
                                                      if (f.size > ATTACHMENT_MAX_MB * 1024 * 1024) { showToast(`Attachment must be under ${ATTACHMENT_MAX_MB} MB.`, 'error'); return; }
                                                      setCompleteFile(f);
                                                    }} />
                                                  <label htmlFor={`complete-file-${gid}`} className="btn btn-outline btn-sm" style={{ cursor:'pointer', textAlign:'center' }}>
                                                    📎 Attach email, PDF, or image
                                                  </label>
                                                </>
                                            }
                                            <div style={{ display:'flex', gap:8 }}>
                                              <button type="button" className="btn btn-primary btn-sm" disabled={completing} onClick={() => handleCompleteInfo(gid)}>
                                                {completing ? 'Sending...' : '📤 Send to Reviewer'}
                                              </button>
                                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCompletingGroup(null); setCompleteNote(''); setCompleteFile(null); }}>Cancel</button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div style={{ marginTop:8 }}>
                                            <button
                                              type="button"
                                              className="btn btn-primary btn-sm"
                                              onClick={e => { e.stopPropagation(); setCompletingGroup(gid); setCompleteNote(''); setCompleteFile(null); }}
                                            >
                                              ✏️ Complete Request
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {g.status === 'pending' && g.needs_info !== 1 && (
                                      <div style={{
                                        background:'#fffbeb', border:'1px solid #fde68a',
                                        borderRadius:8, padding:'10px 14px', fontSize:13, color:'#92400e',
                                      }}>
                                        ⏳ Awaiting storekeeper review.
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </div>

          {!histLoading && groups.length > HISTORY_PAGE_SIZE && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:14 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => goToHistoryPage(historyPage - 1)}
                disabled={historyPage <= 1}
              >
                ← Prev
              </button>
              <span style={{ fontSize:12.5, fontWeight:700, color:'var(--muted)' }}>
                Page {historyPage} of {historyTotalPages}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => goToHistoryPage(historyPage + 1)}
                disabled={historyPage >= historyTotalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

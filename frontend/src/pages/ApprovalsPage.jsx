import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import Modal from '../components/shared/Modal.jsx';

const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};
const TYPE_BADGE = { 'used-up':'badge-orange', borrow:'badge-purple' };

const itemIcon = (icon, category) =>
  (icon || '').startsWith('data:')
    ? <img src={icon} alt="" style={{ width:16, height:16, objectFit:'contain', borderRadius:2, verticalAlign:'middle', marginRight:3 }} />
    : (icon || CAT_EMOJI[category] || '📦');

const GRP_ID = (gid, date) => {
  const iso = (date || '').includes('T') ? date : (date || '').replace(' ', 'T') + 'Z';
  const d   = new Date(iso);
  const mm  = isNaN(d) ? '??' : String(d.getMonth()+1).padStart(2,'0');
  const dd  = isNaN(d) ? '??' : String(d.getDate()).padStart(2,'0');
  return `REQ-${mm}${dd}-${String(gid).slice(-4).toUpperCase()}`;
};

export default function ApprovalsPage({ role, user, showToast, refreshPending }) {
  const [groups,       setGroups]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [acting,       setActing]       = useState(null);

  // Modals
  const [approveModal, setApproveModal] = useState(null); // group object
  const [rejectModal,  setRejectModal]  = useState(null); // group object
  const [forwardModal, setForwardModal] = useState(null); // group object

  const [approveNotes,  setApproveNotes]  = useState('');
  const [rejectNotes,   setRejectNotes]   = useState('');
  const [forwardNotes,  setForwardNotes]  = useState('');

  const isStorekeeper = role === 'Storekeeper';
  const isAdmin       = role === 'Manager';

  const load = useCallback(() => {
    setLoading(true);
    api.getGroups({ status: 'pending' })
      .then(d => { setGroups(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Approve ──────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    const group = approveModal;
    const gid   = group.group_id;
    setActing(gid || `solo-${group.items[0].id}`);
    try {
      if (gid) {
        await api.approveGroup(gid, { notes: approveNotes });
      } else {
        await api.approveRequest(group.items[0].id, { notes: approveNotes });
      }
      showToast('✅ Request approved! Stock updated.', 'success');
      setApproveModal(null); setApproveNotes('');
      load(); refreshPending();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setActing(null);
  };

  // ── Reject ───────────────────────────────────────────────────────────────
  const handleReject = async () => {
    const group = rejectModal;
    const gid   = group.group_id;
    setActing(gid || `solo-${group.items[0].id}`);
    try {
      if (gid) {
        await api.rejectGroup(gid, { notes: rejectNotes });
      } else {
        await api.rejectRequest(group.items[0].id, { notes: rejectNotes });
      }
      showToast('❌ Request rejected.', 'info');
      setRejectModal(null); setRejectNotes('');
      load(); refreshPending();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setActing(null);
  };

  // ── Forward ───────────────────────────────────────────────────────────────
  const handleForward = async () => {
    const group = forwardModal;
    const gid   = group.group_id;
    setActing(gid || `solo-${group.items[0].id}`);
    try {
      if (gid) {
        await api.forwardGroup(gid, { forwarded_note: forwardNotes });
      } else {
        await api.forwardRequest(group.items[0].id, { forwarded_note: forwardNotes });
      }
      showToast('📨 Request forwarded to Admin for review.', 'info');
      setForwardModal(null); setForwardNotes('');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setActing(null);
  };

  // Split groups: forwarded (needs admin) vs regular pending
  const forwardedGroups = groups.filter(g => g.forwarded);
  const regularGroups   = groups.filter(g => !g.forwarded);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">✅ Pending Approvals</div>
          <div className="page-subtitle">Review and action item requests from staff</div>
        </div>
      </div>

      {!loading && groups.length > 0 && (
        <div className="alert alert-warning">
          ⚠️ {groups.length} request group(s) waiting for approval. Approving will deduct stock for all items in the group.
        </div>
      )}

      {/* Forwarded (needs Admin attention) — shown to Admin only */}
      {isAdmin && forwardedGroups.length > 0 && (
        <>
          <div style={{ fontWeight:800, fontSize:13, color:'var(--blue)', marginBottom:10, marginTop:4, display:'flex', alignItems:'center', gap:6 }}>
            <span>📨 Forwarded by Storekeeper</span>
            <span className="badge badge-blue">{forwardedGroups.length}</span>
          </div>
          {forwardedGroups.map(group => renderGroup(group, true))}
          {regularGroups.length > 0 && (
            <div style={{ fontWeight:800, fontSize:13, color:'var(--muted)', marginBottom:10, marginTop:20, display:'flex', alignItems:'center', gap:6 }}>
              <span>⏳ Other Pending</span>
              <span className="badge badge-grey">{regularGroups.length}</span>
            </div>
          )}
        </>
      )}

      {loading
        ? <p className="loading">Loading...</p>
        : groups.length === 0
          ? <p className="empty-state">🎉 All caught up! No pending requests.</p>
          : (isAdmin ? regularGroups : groups).map(group => renderGroup(group, false))
      }

      {/* ── Approve Modal ── */}
      {approveModal && (
        <Modal title="✅ Approve Request" onClose={() => { setApproveModal(null); setApproveNotes(''); }}>
          <p style={{ marginBottom:8, fontSize:14 }}>
            Approving <strong>{approveModal.items.length} item(s)</strong> for <strong>{approveModal.requester_name}</strong>.
            Stock will be deducted immediately.
          </p>
          <ul style={{ fontSize:13, color:'var(--muted)', marginBottom:14, paddingLeft:18 }}>
            {approveModal.items.map(it => (
              <li key={it.id}>{itemIcon(it.item_icon, it.item_category)} {it.item_name} × {it.quantity} {it.unit_name}</li>
            ))}
          </ul>
          <div className="form-group">
            <label className="form-label">Approval note (optional — visible to requester)</label>
            <textarea
              value={approveNotes}
              onChange={e => setApproveNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Please return by end of the week."
            />
          </div>
          <div className="form-actions" style={{ marginTop:16 }}>
            <button className="btn btn-success" onClick={handleApprove} disabled={acting}>
              ✅ Confirm Approve
            </button>
            <button className="btn btn-ghost" onClick={() => { setApproveModal(null); setApproveNotes(''); }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Reject Modal ── */}
      {rejectModal && (
        <Modal title="❌ Reject Request" onClose={() => { setRejectModal(null); setRejectNotes(''); }}>
          <p style={{ marginBottom:8, fontSize:14 }}>
            Rejecting <strong>{rejectModal.items.length} item(s)</strong> from <strong>{rejectModal.requester_name}</strong>.
          </p>
          <ul style={{ fontSize:13, color:'var(--muted)', marginBottom:14, paddingLeft:18 }}>
            {rejectModal.items.map(it => (
              <li key={it.id}>{itemIcon(it.item_icon, it.item_category)} {it.item_name} × {it.quantity}</li>
            ))}
          </ul>
          <div className="form-group">
            <label className="form-label">Reason (optional — sent to requester)</label>
            <textarea
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Out of stock, please try again next week."
            />
          </div>
          <div className="form-actions" style={{ marginTop:16 }}>
            <button className="btn btn-danger" onClick={handleReject} disabled={acting}>❌ Confirm Reject</button>
            <button className="btn btn-ghost" onClick={() => { setRejectModal(null); setRejectNotes(''); }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Forward Modal (Storekeeper only) ── */}
      {forwardModal && (
        <Modal title="📨 Forward to Admin" onClose={() => { setForwardModal(null); setForwardNotes(''); }}>
          <p style={{ marginBottom:8, fontSize:14 }}>
            Forward <strong>{forwardModal.items.length} item(s)</strong> from <strong>{forwardModal.requester_name}</strong> to Admin for final approval.
          </p>
          <ul style={{ fontSize:13, color:'var(--muted)', marginBottom:14, paddingLeft:18 }}>
            {forwardModal.items.map(it => (
              <li key={it.id}>{itemIcon(it.item_icon, it.item_category)} {it.item_name} × {it.quantity}</li>
            ))}
          </ul>
          <div className="form-group">
            <label className="form-label">Note to Admin (optional)</label>
            <textarea
              value={forwardNotes}
              onChange={e => setForwardNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Needs admin approval — unusual quantity requested."
            />
          </div>
          <div className="form-actions" style={{ marginTop:16 }}>
            <button className="btn btn-primary" onClick={handleForward} disabled={acting}>📨 Forward to Admin</button>
            <button className="btn btn-ghost" onClick={() => { setForwardModal(null); setForwardNotes(''); }}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );

  // ── Group card renderer ──────────────────────────────────────────────────
  function renderGroup(group, isForwarded) {
    const gid      = group.group_id || `solo-${group.items[0]?.id}`;
    const isAct    = acting === gid;
    const totalQty = group.items.reduce((s, i) => s + i.quantity, 0);

    return (
      <div key={gid} className="card" style={{ marginBottom:16 }}>
        {/* header */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          <span className="mono" style={{ color:'var(--muted)', fontSize:12 }}>{GRP_ID(gid, group.created_at)}</span>
          {group.category && (
            <span className="badge badge-blue">
              {CAT_EMOJI[group.category] || '📦'} {group.category}
            </span>
          )}
          <span className={`badge ${TYPE_BADGE[group.type]}`}>{group.type}</span>
          <span className="badge badge-grey">{group.unit_school}</span>
          {isForwarded && (
            <span className="badge badge-blue" style={{ background:'#dbeafe', color:'#1d4ed8' }}>
              📨 Forwarded by Storekeeper
            </span>
          )}
          <span style={{ marginLeft:'auto', fontSize:13, color:'var(--muted)', fontWeight:700 }}>
            {group.created_at?.slice(0,10)}
          </span>
        </div>

        {/* requester */}
        <div style={{ background:'var(--off)', borderRadius:'var(--radius-sm)', padding:'10px 14px', marginBottom:14, fontSize:13 }}>
          <strong>{group.requester_name}</strong>
          <span style={{ color:'var(--muted)', marginLeft:8 }}>{group.requester_email}</span>
          {group.purpose && <div style={{ color:'var(--muted)', marginTop:4, fontSize:12 }}>💬 {group.purpose}</div>}
          {group.return_date && <div style={{ color:'var(--muted)', fontSize:12 }}>↩ Return by {group.return_date}</div>}
          {isForwarded && group.forwarded_note && (
            <div style={{ marginTop:6, padding:'6px 10px', background:'#dbeafe', borderRadius:6, fontSize:12, color:'#1d4ed8' }}>
              📨 <strong>Storekeeper note:</strong> {group.forwarded_note}
            </div>
          )}
        </div>

        {/* items table */}
        <div className="table-wrap" style={{ marginBottom:14 }}>
          <table>
            <thead>
              <tr><th>Item</th><th>Code</th><th>Qty Requested</th></tr>
            </thead>
            <tbody>
              {group.items.map(it => (
                <tr key={it.id}>
                  <td>
                    <span style={{ marginRight:6, verticalAlign:'middle' }}>{itemIcon(it.item_icon, it.item_category)}</span>
                    <strong>{it.item_name}</strong>
                  </td>
                  <td><span className="mono" style={{ color:'var(--muted)' }}>{it.code || '—'}</span></td>
                  <td><strong>{it.quantity}</strong> {it.unit_name}</td>
                </tr>
              ))}
              <tr style={{ background:'var(--light)' }}>
                <td colSpan={2} style={{ fontWeight:800, color:'var(--navy)' }}>Total</td>
                <td style={{ fontWeight:800 }}>{totalQty} unit(s)</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* actions */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button
            className="btn btn-success"
            disabled={isAct}
            onClick={() => { setApproveModal(group); setApproveNotes(''); }}
          >
            ✅ Approve ({group.items.length} item{group.items.length !== 1 ? 's' : ''})
          </button>
          <button
            className="btn btn-danger"
            disabled={isAct}
            onClick={() => { setRejectModal(group); setRejectNotes(''); }}
          >
            ❌ Reject
          </button>
          {isStorekeeper && !isForwarded && (
            <button
              className="btn btn-ghost"
              disabled={isAct}
              style={{ color:'var(--blue)', borderColor:'var(--blue)' }}
              onClick={() => { setForwardModal(group); setForwardNotes(''); }}
            >
              📨 Forward to Admin
            </button>
          )}
        </div>
      </div>
    );
  }
}

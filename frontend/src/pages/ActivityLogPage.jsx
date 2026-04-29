import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { downloadCSV, downloadExcel } from '../utils/download.js';

const CAT_EMOJI = {
  'Stationery':'📝','Housekeeping':'🧹','Learning Tools':'📚','Groceries':'🛒',
  'Art & Craft':'🎨','Uniform':'👕','Sport Equipment':'⚽','Tools':'🔧','Medical/First Aid':'🏥',
};

const EVENT_META = {
  request_submitted: { label: 'Request Submitted', color: 'var(--orange)', dot: '🟠', badge: 'badge-orange' },
  request_approved:  { label: 'Request Approved',  color: 'var(--green)',  dot: '🟢', badge: 'badge-green'  },
  request_rejected:  { label: 'Request Rejected',  color: 'var(--red)',    dot: '🔴', badge: 'badge-red'    },
  request_returned:  { label: 'Item Returned',      color: 'var(--teal)',   dot: '🔵', badge: 'badge-teal'   },
  item_added:        { label: 'Item Added',         color: 'var(--blue)',   dot: '🔷', badge: 'badge-blue'   },
  item_updated:      { label: 'Item Updated',       color: 'var(--muted)',  dot: '⬜', badge: 'badge-grey'   },
};

function formatTs(ts) {
  if (!ts) return '—';
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return ts.slice(0, 16);
  return d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function eventDescription(ev) {
  const icon = ev.item_icon || CAT_EMOJI[ev.category] || '📦';
  switch (ev.type) {
    case 'request_submitted':
      return `${ev.actor} submitted a ${ev.req_type} request for ${icon} ${ev.item_name} × ${ev.quantity}`;
    case 'request_approved':
      return `${ev.requester || ev.actor}'s request for ${icon} ${ev.item_name} × ${ev.quantity} was approved`;
    case 'request_rejected':
      return `${ev.requester || ev.actor}'s request for ${icon} ${ev.item_name} × ${ev.quantity} was rejected${ev.notes ? `: "${ev.notes}"` : ''}`;
    case 'request_returned':
      return `${ev.actor} returned ${icon} ${ev.item_name} × ${ev.quantity}`;
    case 'item_added':
      return `${icon} ${ev.item_name} added to inventory${ev.notes ? ` — ${ev.notes}` : ''}`;
    case 'item_updated':
      return `${icon} ${ev.item_name} details updated`;
    default:
      return ev.item_name;
  }
}

function toExportRow(ev) {
  return {
    'Timestamp':   formatTs(ev.ts),
    'Event':       EVENT_META[ev.type]?.label || ev.type,
    'Actor':       ev.actor || '',
    'Email':       ev.actor_email || '',
    'Item':        ev.item_name || '',
    'Category':    ev.category || '',
    'Quantity':    ev.quantity ?? '',
    'Unit':        ev.unit_name || '',
    'Unit School': ev.unit_school || '',
    'Request Type':ev.req_type || '',
    'Notes':       ev.notes || '',
  };
}

function datestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

const TYPE_OPTIONS = [
  { value: 'all',     label: 'All Events' },
  { value: 'request', label: 'Requests only' },
  { value: 'item',    label: 'Item changes only' },
];

export default function ActivityLogPage({ showToast }) {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getActivity({ type: typeFilter !== 'all' ? typeFilter : undefined, from: from || undefined, to: to || undefined, search: search || undefined, limit: 500 })
      .then(d => { setEvents(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [typeFilter, from, to, search]);

  useEffect(() => { load(); }, [load]);

  const handleDownload = (format) => {
    const rows = events.map(toExportRow);
    if (!rows.length) { showToast('No events to export.', 'info'); return; }
    const stamp = datestamp();
    if (format === 'csv') {
      downloadCSV(rows, `activity_log_${stamp}.csv`);
    } else {
      downloadExcel([{ name: 'Activity Log', rows }], `activity_log_${stamp}.xlsx`);
    }
  };

  // Summary counts
  const counts = events.reduce((acc, e) => { acc[e.type] = (acc[e.type]||0)+1; return acc; }, {});

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">📋 Activity Log</div>
          <div className="page-subtitle">Full audit trail of inventory and request events</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDownload('csv')}>⬇ CSV</button>
          <button className="btn btn-primary btn-sm" onClick={() => handleDownload('excel')}>⬇ Excel</button>
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {Object.entries(EVENT_META).map(([key, meta]) => counts[key] > 0 && (
          <span key={key} className={`badge ${meta.badge}`} style={{ fontSize:12 }}>
            {meta.label}: {counts[key]}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding:'14px 18px', marginBottom:16 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div className="form-group" style={{ margin:0, flex:'1 1 180px' }}>
            <label className="form-label" style={{ fontSize:11 }}>Search</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'var(--muted)' }}>🔍</span>
              <input
                type="text"
                style={{ paddingLeft:30 }}
                placeholder="Item, person, category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group" style={{ margin:0, flex:'0 0 160px' }}>
            <label className="form-label" style={{ fontSize:11 }}>Event Type</label>
            <select className="filter-select" style={{ width:'100%' }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin:0, flex:'0 0 140px' }}>
            <label className="form-label" style={{ fontSize:11 }}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin:0, flex:'0 0 140px' }}>
            <label className="form-label" style={{ fontSize:11 }}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          {(search || from || to || typeFilter !== 'all') && (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf:'flex-end' }}
              onClick={() => { setSearch(''); setFrom(''); setTo(''); setTypeFilter('all'); }}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {loading ? (
          <p className="loading" style={{ padding:24 }}>Loading activity…</p>
        ) : events.length === 0 ? (
          <p className="empty-state" style={{ padding:32 }}>No activity found for the selected filters.</p>
        ) : (
          <div style={{ padding:'8px 0' }}>
            {events.map((ev, idx) => {
              const meta = EVENT_META[ev.type] || {};
              const isLast = idx === events.length - 1;
              return (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '12px 20px',
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                    alignItems: 'flex-start',
                  }}
                >
                  {/* dot */}
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: meta.color || 'var(--muted)',
                    marginTop: 5, flexShrink: 0,
                  }} />

                  {/* body */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:2 }}>
                      <span className={`badge ${meta.badge || 'badge-grey'}`} style={{ fontSize:11 }}>
                        {meta.label || ev.type}
                      </span>
                      {ev.unit_school && ev.unit_school !== 'All' && (
                        <span className="badge badge-grey" style={{ fontSize:11 }}>{ev.unit_school}</span>
                      )}
                    </div>
                    <div style={{ fontSize:13.5, fontWeight:600, color:'var(--navy)', lineHeight:1.4 }}>
                      {eventDescription(ev)}
                    </div>
                    {ev.notes && ev.type !== 'request_rejected' && (
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>💬 {ev.notes}</div>
                    )}
                  </div>

                  {/* timestamp */}
                  <div style={{ fontSize:11.5, color:'var(--muted)', whiteSpace:'nowrap', flexShrink:0, marginTop:2 }}>
                    {formatTs(ev.ts)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {events.length >= 500 && (
        <p style={{ textAlign:'center', color:'var(--muted)', fontSize:12, marginTop:10 }}>
          Showing latest 500 events. Use date filters to narrow results.
        </p>
      )}
    </div>
  );
}

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/activity
// Synthesises a chronological activity log from requests + items tables.
// Query params: from, to (YYYY-MM-DD), type (request|item|all), search, limit (default 200)
router.get('/', (req, res) => {
  const { from, to, type, search, limit = 200 } = req.query;

  const events = [];

  // ── Requests ──────────────────────────────────────────────────────────────
  if (!type || type === 'all' || type === 'request') {
    const reqs = db.prepare(`
      SELECT r.id, r.group_id, r.item_id, r.requester_name, r.requester_email,
             r.type, r.quantity, r.unit_school, r.status, r.purpose,
             r.created_at, r.approved_at, r.returned_at, r.notes,
             i.name AS item_name, i.unit_name, i.icon AS item_icon, i.category
      FROM requests r
      JOIN items i ON i.id = r.item_id
      ORDER BY r.created_at DESC
    `).all();

    for (const r of reqs) {
      // submitted
      events.push({
        id:          `req-sub-${r.id}`,
        type:        'request_submitted',
        ts:          r.created_at,
        actor:       r.requester_name,
        actor_email: r.requester_email,
        item_name:   r.item_name,
        item_icon:   r.item_icon || null,
        category:    r.category,
        quantity:    r.quantity,
        unit_name:   r.unit_name,
        unit_school: r.unit_school,
        req_type:    r.type,
        status:      r.status,
        notes:       null,
        group_id:    r.group_id || null,
      });

      // approved
      if (r.approved_at && (r.status === 'approved' || r.status === 'returned')) {
        events.push({
          id:          `req-apr-${r.id}`,
          type:        'request_approved',
          ts:          r.approved_at,
          actor:       'Storekeeper',
          actor_email: null,
          item_name:   r.item_name,
          item_icon:   r.item_icon || null,
          category:    r.category,
          quantity:    r.quantity,
          unit_name:   r.unit_name,
          unit_school: r.unit_school,
          req_type:    r.type,
          status:      'approved',
          notes:       r.notes || null,
          group_id:    r.group_id || null,
          requester:   r.requester_name,
        });
      }

      // rejected
      if (r.status === 'rejected') {
        events.push({
          id:          `req-rej-${r.id}`,
          type:        'request_rejected',
          ts:          r.approved_at || r.created_at,
          actor:       'Storekeeper',
          actor_email: null,
          item_name:   r.item_name,
          item_icon:   r.item_icon || null,
          category:    r.category,
          quantity:    r.quantity,
          unit_name:   r.unit_name,
          unit_school: r.unit_school,
          req_type:    r.type,
          status:      'rejected',
          notes:       r.notes || null,
          group_id:    r.group_id || null,
          requester:   r.requester_name,
        });
      }

      // returned
      if (r.returned_at && r.status === 'returned') {
        events.push({
          id:          `req-ret-${r.id}`,
          type:        'request_returned',
          ts:          r.returned_at,
          actor:       r.requester_name,
          actor_email: r.requester_email,
          item_name:   r.item_name,
          item_icon:   r.item_icon || null,
          category:    r.category,
          quantity:    r.quantity,
          unit_name:   r.unit_name,
          unit_school: r.unit_school,
          req_type:    r.type,
          status:      'returned',
          notes:       null,
          group_id:    r.group_id || null,
        });
      }
    }
  }

  // ── Items ──────────────────────────────────────────────────────────────────
  if (!type || type === 'all' || type === 'item') {
    const its = db.prepare(`
      SELECT id, name, code, category, location, unit_school, quantity, icon,
             created_at, updated_at
      FROM items
      ORDER BY created_at DESC
    `).all();

    for (const it of its) {
      events.push({
        id:          `item-add-${it.id}`,
        type:        'item_added',
        ts:          it.created_at,
        actor:       'Admin / Storekeeper',
        actor_email: null,
        item_name:   it.name,
        item_icon:   it.icon || null,
        category:    it.category,
        quantity:    it.quantity,
        unit_name:   null,
        unit_school: it.unit_school,
        req_type:    null,
        status:      null,
        notes:       `Code: ${it.code || '—'} · Location: ${it.location}`,
        group_id:    null,
      });

      // only show update event if it was meaningfully after creation (>60s diff)
      if (it.updated_at && it.updated_at !== it.created_at) {
        const diff = new Date(it.updated_at.replace(' ','T')+'Z') - new Date(it.created_at.replace(' ','T')+'Z');
        if (diff > 60000) {
          events.push({
            id:          `item-upd-${it.id}-${it.updated_at}`,
            type:        'item_updated',
            ts:          it.updated_at,
            actor:       'Admin / Storekeeper',
            actor_email: null,
            item_name:   it.name,
            item_icon:   it.icon || null,
            category:    it.category,
            quantity:    it.quantity,
            unit_name:   null,
            unit_school: it.unit_school,
            req_type:    null,
            status:      null,
            notes:       null,
            group_id:    null,
          });
        }
      }
    }
  }

  // ── Sort (most recent first) ───────────────────────────────────────────────
  events.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts.replace(' ','T')+'Z').getTime() : 0;
    const tb = b.ts ? new Date(b.ts.replace(' ','T')+'Z').getTime() : 0;
    return tb - ta;
  });

  // ── Filters ────────────────────────────────────────────────────────────────
  let filtered = events;

  if (from) {
    const fromMs = new Date(from + 'T00:00:00Z').getTime();
    filtered = filtered.filter(e => e.ts && new Date(e.ts.replace(' ','T')+'Z').getTime() >= fromMs);
  }
  if (to) {
    const toMs = new Date(to + 'T23:59:59Z').getTime();
    filtered = filtered.filter(e => e.ts && new Date(e.ts.replace(' ','T')+'Z').getTime() <= toMs);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      (e.item_name  || '').toLowerCase().includes(q) ||
      (e.actor      || '').toLowerCase().includes(q) ||
      (e.actor_email|| '').toLowerCase().includes(q) ||
      (e.category   || '').toLowerCase().includes(q)
    );
  }

  res.json(filtered.slice(0, Number(limit)));
});

module.exports = router;

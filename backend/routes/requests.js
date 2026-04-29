const express = require('express');
const db = require('../db');
const { sendRequestSubmitted, sendRequestApproved, sendRequestRejected, sendLowStockAlert } = require('../mailer');

// Fetch active Manager + Storekeeper emails for low-stock alerts
function getStockAlertRecipients() {
  return db.prepare(`SELECT name, email FROM users WHERE role IN ('Manager','Storekeeper') AND is_active = 1`).all();
}

// Fire low-stock alert if item dropped below threshold after a stock deduction
function checkAndAlertLowStock(itemId) {
  const item = db.prepare(`SELECT name, code, category, location, quantity, min_threshold, unit_name FROM items WHERE id = ?`).get(itemId);
  if (!item || item.quantity >= item.min_threshold) return;
  const recipients = getStockAlertRecipients();
  sendLowStockAlert({
    itemName:     item.name,
    itemCode:     item.code,
    category:     item.category,
    location:     item.location,
    quantity:     item.quantity,
    minThreshold: item.min_threshold,
    unitName:     item.unit_name,
    recipients,
  }).catch(e => console.error('Low-stock alert failed:', e.message));
}

const router = express.Router();

const withItem = `SELECT r.*, i.name AS item_name, i.category, i.unit_name, i.location, i.code, i.icon AS item_icon
                  FROM requests r JOIN items i ON i.id = r.item_id`;

// ── GET /api/requests ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status, requester_email } = req.query;
  const rows = db.prepare(`
    ${withItem}
    WHERE (? IS NULL OR r.status = ?)
      AND (? IS NULL OR r.requester_email = ?)
    ORDER BY r.created_at DESC
  `).all(status || null, status || null, requester_email || null, requester_email || null);
  res.json(rows);
});

// ── GET /api/requests/stats ────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const totalItems = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const lowStock   = db.prepare('SELECT COUNT(*) AS n FROM items WHERE quantity < min_threshold').get().n;
  const pending    = db.prepare("SELECT COUNT(DISTINCT COALESCE(group_id, CAST(id AS TEXT))) AS n FROM requests WHERE status='pending'").get().n;
  const thisMonth  = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now')").get().n;
  res.json({ totalItems, lowStock, pending, thisMonth });
});

// ── GET /api/requests/groups ───────────────────────────────────────────────
// Returns requests collapsed into groups (group_id or individual id)
router.get('/groups', (req, res) => {
  const { status, requester_email } = req.query;
  const rows = db.prepare(`
    ${withItem}
    WHERE (? IS NULL OR r.status = ?)
      AND (? IS NULL OR r.requester_email = ?)
    ORDER BY r.created_at DESC
  `).all(status || null, status || null, requester_email || null, requester_email || null);

  // Group by group_id (fall back to string id for legacy single items)
  const map = new Map();
  for (const row of rows) {
    const key = row.group_id || `solo-${row.id}`;
    if (!map.has(key)) {
      map.set(key, {
        group_id:       row.group_id || null,
        status:         row.status,
        forwarded:      row.forwarded || 0,
        forwarded_note: row.forwarded_note || null,
        approval_notes: row.approval_notes || null,
        requester_name: row.requester_name,
        requester_email:row.requester_email,
        type:           row.type,
        unit_school:    row.unit_school,
        category:       row.category || row.item_category,
        purpose:        row.purpose,
        return_date:    row.return_date,
        created_at:     row.created_at,
        approved_at:    row.approved_at,
        items: [],
      });
    }
    map.get(key).items.push({
      id:           row.id,
      item_id:      row.item_id,
      item_name:    row.item_name,
      item_icon:    row.item_icon,
      item_category:row.category,
      code:         row.code,
      unit_name:    row.unit_name,
      quantity:     row.quantity,
    });
  }

  res.json([...map.values()]);
});

// ── POST /api/requests/cart ────────────────────────────────────────────────
// Submit a cart: multiple items from the same category in one request group
router.post('/cart', (req, res) => {
  const { requester_name, requester_email, type, unit_school, category, purpose, return_date, items } = req.body;

  if (!requester_name?.trim())  return res.status(400).json({ error: 'Requester name is required.' });
  if (!requester_email?.trim()) return res.status(400).json({ error: 'Requester email is required.' });
  if (!['used-up', 'borrow'].includes(type)) return res.status(400).json({ error: 'Type must be used-up or borrow.' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty.' });

  const group_id = `GRP-${Date.now()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;

  try {
    db.exec('BEGIN');

    for (const { item_id, quantity } of items) {
      if (!item_id || quantity < 1) throw Object.assign(new Error('Invalid cart item.'), { status: 400 });

      const item = db.prepare('SELECT id, name, quantity FROM items WHERE id = ?').get(item_id);
      if (!item) throw Object.assign(new Error(`Item #${item_id} not found.`), { status: 404 });
      if (item.quantity < quantity) throw Object.assign(new Error(`Not enough stock for "${item.name}" (${item.quantity} available).`), { status: 400 });

      db.prepare(`
        INSERT INTO requests (item_id, requester_name, requester_email, type, quantity, unit_school, category, purpose, return_date, group_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(item_id, requester_name.trim(), requester_email.trim(), type, quantity, unit_school || 'All', category || null, purpose || null, return_date || null, group_id);
    }

    db.exec('COMMIT');

    const created = db.prepare(`${withItem} WHERE r.group_id = ? ORDER BY r.id`).all(group_id);
    res.status(201).json({ group_id, items: created });

    // Notify requester that their submission is pending approval
    sendRequestSubmitted({
      requesterName:  requester_name.trim(),
      requesterEmail: requester_email.trim(),
      items:          created.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name })),
      type,
      purpose:        purpose || null,
      returnDate:     return_date || null,
      groupId:        group_id,
    }).catch(e => console.error('Submission email failed:', e.message));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/requests (single item — kept for backward compat) ───────────
router.post('/', (req, res) => {
  const { item_id, requester_name, requester_email, type, quantity, unit_school, purpose, return_date } = req.body;
  if (!item_id)                 return res.status(400).json({ error: 'item_id is required.' });
  if (!requester_name?.trim())  return res.status(400).json({ error: 'Requester name is required.' });
  if (!requester_email?.trim()) return res.status(400).json({ error: 'Requester email is required.' });
  if (!['used-up', 'borrow'].includes(type)) return res.status(400).json({ error: 'Type must be used-up or borrow.' });
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be >= 1.' });

  const item = db.prepare('SELECT id, quantity FROM items WHERE id = ?').get(item_id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.quantity < quantity) return res.status(400).json({ error: `Only ${item.quantity} unit(s) available.` });

  const result = db.prepare(`
    INSERT INTO requests (item_id, requester_name, requester_email, type, quantity, unit_school, purpose, return_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item_id, requester_name.trim(), requester_email.trim(), type, quantity, unit_school || 'All', purpose || null, return_date || null);

  const row = db.prepare(`${withItem} WHERE r.id = ?`).get(result.lastInsertRowid);
  res.status(201).json(row);

  sendRequestSubmitted({
    requesterName:  requester_name.trim(),
    requesterEmail: requester_email.trim(),
    items:          [{ item_name: row.item_name, quantity, unit_name: row.unit_name }],
    type,
    purpose:        purpose || null,
    returnDate:     return_date || null,
    groupId:        null,
  }).catch(e => console.error('Submission email failed:', e.message));
});

// ── PUT /api/requests/groups/:groupId/approve ──────────────────────────────
router.put('/groups/:groupId/approve', (req, res) => {
  const { notes } = req.body || {};
  const { groupId } = req.params;

  try {
    db.exec('BEGIN');

    const rows = db.prepare(`${withItem} WHERE r.group_id = ? AND r.status = 'pending'`).all(groupId);
    if (rows.length === 0) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'No pending items in this group.' }); }

    for (const row of rows) {
      const stock = db.prepare('SELECT quantity FROM items WHERE id = ?').get(row.item_id);
      if (stock.quantity < row.quantity) throw Object.assign(new Error(`Not enough stock for "${row.item_name}" (${stock.quantity} available).`), { status: 400 });

      db.prepare(`UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`).run(row.quantity, row.item_id);
      db.prepare(`UPDATE requests SET status = 'approved', approved_at = datetime('now'), approval_notes = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(notes || null, notes || null, row.id);
    }

    db.exec('COMMIT');

    // Low-stock alerts for any item that dropped below threshold
    for (const row of rows) checkAndAlertLowStock(row.item_id);

    // Send one email for the whole group
    const first = rows[0];
    const itemList = rows.map(r => `${r.item_name} × ${r.quantity} ${r.unit_name}`).join(', ');
    sendRequestApproved({
      requesterName:  first.requester_name,
      requesterEmail: first.requester_email,
      itemName:       itemList,
      quantity:       rows.reduce((s, r) => s + r.quantity, 0),
      type:           first.type,
      returnDate:     first.return_date,
    }).catch(e => console.error('Approval email failed:', e.message));

    res.json({ group_id: groupId, approved: rows.length });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /api/requests/groups/:groupId/reject ───────────────────────────────
router.put('/groups/:groupId/reject', (req, res) => {
  const { notes } = req.body || {};
  const { groupId } = req.params;

  const rows = db.prepare(`${withItem} WHERE r.group_id = ? AND r.status = 'pending'`).all(groupId);
  if (rows.length === 0) return res.status(404).json({ error: 'No pending items in this group.' });

  db.prepare(`UPDATE requests SET status = 'rejected', notes = COALESCE(?, notes) WHERE group_id = ? AND status = 'pending'`).run(notes || null, groupId);

  const first = rows[0];
  const itemList = rows.map(r => `${r.item_name} × ${r.quantity}`).join(', ');
  sendRequestRejected({
    requesterName:  first.requester_name,
    requesterEmail: first.requester_email,
    itemName:       itemList,
    quantity:       rows.reduce((s, r) => s + r.quantity, 0),
    notes,
  }).catch(e => console.error('Rejection email failed:', e.message));

  res.json({ group_id: groupId, rejected: rows.length });
});

// ── PUT /api/requests/groups/:groupId/forward ──────────────────────────────
router.put('/groups/:groupId/forward', (req, res) => {
  const { forwarded_note } = req.body || {};
  const { groupId } = req.params;

  const rows = db.prepare(`SELECT id FROM requests WHERE group_id = ? AND status = 'pending'`).all(groupId);
  if (rows.length === 0) return res.status(404).json({ error: 'No pending items in this group.' });

  db.prepare(`UPDATE requests SET forwarded = 1, forwarded_note = ? WHERE group_id = ? AND status = 'pending'`)
    .run(forwarded_note || null, groupId);

  res.json({ group_id: groupId, forwarded: rows.length });
});

// ── PUT /api/requests/:id/forward (single) ────────────────────────────────
router.put('/:id/forward', (req, res) => {
  const { forwarded_note } = req.body || {};

  const row = db.prepare(`SELECT id, status FROM requests WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found.' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be forwarded.' });

  db.prepare(`UPDATE requests SET forwarded = 1, forwarded_note = ? WHERE id = ?`)
    .run(forwarded_note || null, req.params.id);

  res.json({ id: req.params.id, forwarded: 1 });
});

// ── PUT /api/requests/:id/approve (single) ─────────────────────────────────
router.put('/:id/approve', (req, res) => {
  const { notes } = req.body || {};

  try {
    db.exec('BEGIN');

    const row = db.prepare(`${withItem} WHERE r.id = ?`).get(req.params.id);
    if (!row) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'Request not found.' }); }
    if (row.status !== 'pending') { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Only pending requests can be approved.' }); }

    const stock = db.prepare('SELECT quantity FROM items WHERE id = ?').get(row.item_id);
    if (stock.quantity < row.quantity) { db.exec('ROLLBACK'); return res.status(400).json({ error: `Only ${stock.quantity} unit(s) in stock.` }); }

    db.prepare(`UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`).run(row.quantity, row.item_id);
    db.prepare(`UPDATE requests SET status = 'approved', approved_at = datetime('now'), approval_notes = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(notes || null, notes || null, row.id);

    db.exec('COMMIT');

    checkAndAlertLowStock(row.item_id);

    sendRequestApproved({ requesterName: row.requester_name, requesterEmail: row.requester_email, itemName: row.item_name, quantity: row.quantity, type: row.type, returnDate: row.return_date, approvalNotes: notes || null })
      .catch(e => console.error(e.message));

    res.json(db.prepare(`${withItem} WHERE r.id = ?`).get(row.id));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/requests/:id/reject (single) ─────────────────────────────────
router.put('/:id/reject', (req, res) => {
  const { notes } = req.body || {};

  const row = db.prepare(`${withItem} WHERE r.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found.' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be rejected.' });

  db.prepare(`UPDATE requests SET status = 'rejected', notes = COALESCE(?, notes) WHERE id = ?`).run(notes || null, row.id);

  sendRequestRejected({ requesterName: row.requester_name, requesterEmail: row.requester_email, itemName: row.item_name, quantity: row.quantity, notes })
    .catch(e => console.error(e.message));

  res.json(db.prepare(`${withItem} WHERE r.id = ?`).get(row.id));
});

// ── PUT /api/requests/:id/return ───────────────────────────────────────────
router.put('/:id/return', (req, res) => {
  try {
    db.exec('BEGIN');
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
    if (!row) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    if (row.type !== 'borrow') { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Only borrow requests can be returned.' }); }
    if (row.status !== 'approved') { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Must be approved first.' }); }

    db.prepare(`UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`).run(row.quantity, row.item_id);
    db.prepare(`UPDATE requests SET status = 'returned', returned_at = datetime('now') WHERE id = ?`).run(row.id);
    db.exec('COMMIT');

    res.json(db.prepare(`${withItem} WHERE r.id = ?`).get(row.id));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

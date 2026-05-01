const express = require('express');
const db = require('../db');
const { sendNewRequestAlert, sendRequestSubmitted, sendRequestApproved, sendRequestRejected, sendLowStockAlert, sendRequestForwarded, sendPrincipalSubmissionNotice, sendPrincipalDecisionNotice } = require('../mailer');
const { sendTelegram, sendTelegramToMany } = require('../telegram');

// Fetch active Manager + Storekeeper records
function getStockAlertRecipients() {
  return db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role IN ('Manager','Storekeeper') AND is_active = 1`).all();
}

// Fetch active Managers only (for forwarding notifications)
function getManagerRecipients() {
  return db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role = 'Manager' AND is_active = 1`).all();
}

// Fetch approvers relevant to a requester's unit_school:
// - Always all active Managers
// - Storekeepers assigned to the matching store location:
//     PAUD requester        → Storekeepers with unit_school = 'PAUD'
//     SD / SMP requester    → Storekeepers with unit_school IN ('SD','SMP')
//     Other / unknown       → all Storekeepers (fallback)
function getApproverRecipients(unit_school) {
  const managers = db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role = 'Manager' AND is_active = 1`).all();
  let storekeepers;
  if (unit_school === 'PAUD') {
    storekeepers = db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role = 'Storekeeper' AND unit_school = 'PAUD' AND is_active = 1`).all();
  } else if (unit_school === 'SD' || unit_school === 'SMP') {
    storekeepers = db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role = 'Storekeeper' AND unit_school IN ('SD','SMP') AND is_active = 1`).all();
  } else {
    storekeepers = db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role = 'Storekeeper' AND is_active = 1`).all();
  }
  return [...managers, ...storekeepers];
}

// Fetch Principals relevant to the requester's unit_school.
// SD and SMP are separate schools (same building, different principals).
function getPrincipalRecipients(unit_school) {
  if (unit_school === 'PAUD' || unit_school === 'SD' || unit_school === 'SMP') {
    return db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role='Principal' AND unit_school=? AND is_active=1`).all(unit_school);
  }
  return db.prepare(`SELECT name, email, telegram_chat_id FROM users WHERE role='Principal' AND is_active=1`).all();
}

// Look up a user's telegram_chat_id by email
function getTelegramId(email) {
  if (!email) return null;
  const u = db.prepare(`SELECT telegram_chat_id FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1`).get(email);
  return u?.telegram_chat_id || null;
}

// Fire low-stock alert if item dropped below threshold after a stock deduction
function checkAndAlertLowStock(itemId) {
  const item = db.prepare(`SELECT name, code, category, location, quantity, min_threshold, unit_name FROM items WHERE id = ?`).get(itemId);
  if (!item || item.quantity >= item.min_threshold) return;
  const recipients = getStockAlertRecipients();

  // Email
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

  // Telegram
  const isOut = item.quantity === 0;
  const tgMsg = `${isOut ? '🔴' : '⚠️'} <b>${isOut ? 'OUT OF STOCK' : 'LOW STOCK ALERT'}</b>\n\n` +
    `<b>${item.name}</b>\n` +
    `📦 Current stock: <b>${item.quantity} ${item.unit_name}</b>\n` +
    `⚡ Minimum: ${item.min_threshold} ${item.unit_name}\n` +
    `📍 Location: ${item.location}\n\n` +
    `Please restock as soon as possible.`;
  sendTelegramToMany(recipients.map(r => r.telegram_chat_id).filter(Boolean), tgMsg)
    .catch(e => console.error('[telegram] low-stock alert failed:', e.message));
}

const router = express.Router();

const withItem = `SELECT r.*, i.name AS item_name, i.category, i.unit_name, i.location, i.code, i.icon AS item_icon
                  FROM requests r JOIN items i ON i.id = r.item_id`;

// ── Storekeeper location SQL fragment ─────────────────────────────────────
// Returns an extra WHERE clause to restrict requests to the storekeeper's store.
// Safe to interpolate — value comes from server-issued JWT, not user input.
function storekeepWhere(user) {
  if (!user || user.role !== 'Storekeeper') return '';
  if (user.unit_school === 'PAUD')                             return `AND r.unit_school = 'PAUD'`;
  if (user.unit_school === 'SD' || user.unit_school === 'SMP') return `AND r.unit_school IN ('SD','SMP')`;
  return '';
}

// ── GET /api/requests ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status, requester_email } = req.query;
  const rows = db.prepare(`
    ${withItem}
    WHERE (? IS NULL OR r.status = ?)
      AND (? IS NULL OR r.requester_email = ?)
      ${storekeepWhere(req.user)}
    ORDER BY r.created_at DESC
  `).all(status || null, status || null, requester_email || null, requester_email || null);
  res.json(rows);
});

// ── GET /api/requests/stats ────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const sw = storekeepWhere(req.user);   // already has leading AND r.unit_school ...
  const totalItems = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const lowStock   = db.prepare('SELECT COUNT(*) AS n FROM items WHERE quantity < min_threshold').get().n;
  const pending    = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(r.group_id, CAST(r.id AS TEXT))) AS n
    FROM requests r
    WHERE r.status = 'pending' ${sw}
  `).get().n;
  const thisMonth  = db.prepare(`
    SELECT COUNT(*) AS n
    FROM requests r
    WHERE strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now') ${sw}
  `).get().n;
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
      ${storekeepWhere(req.user)}
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

    // Email requester
    sendRequestSubmitted({
      requesterName:  requester_name.trim(),
      requesterEmail: requester_email.trim(),
      items:          created.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name })),
      type,
      purpose:        purpose || null,
      returnDate:     return_date || null,
      groupId:        group_id,
    }).catch(e => console.error('Submission email failed:', e.message));

    // Telegram requester
    const reqTgId = getTelegramId(requester_email.trim());
    if (reqTgId) {
      const itemsSummary = created.map(r => `• ${r.item_name} × ${r.quantity} ${r.unit_name}`).join('\n');
      sendTelegram(reqTgId,
        `📋 <b>Request Submitted</b>\n\nYour request is pending approval.\n\n${itemsSummary}\n\n` +
        `Type: ${type === 'borrow' ? 'Borrow' : 'Used-up'}${purpose ? `\nPurpose: ${purpose}` : ''}\n\n` +
        `⏳ You will be notified once it's reviewed.`
      ).catch(() => {});
    }

    // Email + Telegram to relevant Storekeepers + Managers
    const approvers    = getApproverRecipients(unit_school);
    const principals   = getPrincipalRecipients(unit_school);
    const itemsSummary = created.map(r => `• ${r.item_name} × ${r.quantity} ${r.unit_name}`).join('\n');
    const itemsPayload = created.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name }));

    sendNewRequestAlert({
      requesterName: requester_name.trim(),
      requesterUnit: unit_school,
      items:         itemsPayload,
      type,
      purpose:       purpose || null,
      groupId:       group_id,
      recipients:    approvers,
    }).catch(e => console.error('New-request alert email failed:', e.message));

    // CC Principals on submission
    sendPrincipalSubmissionNotice({
      requesterName: requester_name.trim(),
      requesterUnit: unit_school,
      items:         itemsPayload,
      type,
      purpose:       purpose || null,
      groupId:       group_id,
      recipients:    principals,
    }).catch(e => console.error('Principal submission notice failed:', e.message));

    const approverTgIds = approvers.map(r => r.telegram_chat_id).filter(Boolean);
    if (approverTgIds.length) {
      sendTelegramToMany(approverTgIds,
        `🔔 <b>New Request Pending Approval</b>\n\n` +
        `From: <b>${requester_name.trim()}</b> (${unit_school})\n${itemsSummary}\n\n` +
        `Type: ${type === 'borrow' ? 'Borrow' : 'Used-up'}${purpose ? `\nPurpose: ${purpose}` : ''}\n\n` +
        `👉 Open the app to review: kkinventory.ypj.sch.id/approvals`
      ).catch(() => {});
    }
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

  // Email + Telegram to relevant Storekeepers + Managers
  const approvers = getApproverRecipients(unit_school);
  sendNewRequestAlert({
    requesterName: requester_name.trim(),
    requesterUnit: unit_school,
    items:         [{ item_name: row.item_name, quantity, unit_name: row.unit_name }],
    type,
    purpose:       purpose || null,
    groupId:       null,
    recipients:    approvers,
  }).catch(e => console.error('New-request alert email failed:', e.message));

  const approverTgIds = approvers.map(r => r.telegram_chat_id).filter(Boolean);
  if (approverTgIds.length) {
    sendTelegramToMany(approverTgIds,
      `🔔 <b>New Request Pending Approval</b>\n\n` +
      `From: <b>${requester_name.trim()}</b> (${unit_school})\n• ${row.item_name} × ${quantity} ${row.unit_name}\n\n` +
      `Type: ${type === 'borrow' ? 'Borrow' : 'Used-up'}${purpose ? `\nPurpose: ${purpose}` : ''}\n\n` +
      `👉 Open the app to review: kkinventory.ypj.sch.id/approvals`
    ).catch(() => {});
  }
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

    const first    = rows[0];
    const itemList = rows.map(r => `${r.item_name} × ${r.quantity} ${r.unit_name}`).join(', ');
    const itemsBullet = rows.map(r => `• ${r.item_name} × ${r.quantity} ${r.unit_name}`).join('\n');

    const itemsPayload = rows.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name }));

    // Email requester
    sendRequestApproved({
      requesterName:  first.requester_name,
      requesterEmail: first.requester_email,
      itemName:       itemList,
      quantity:       rows.reduce((s, r) => s + r.quantity, 0),
      type:           first.type,
      returnDate:     first.return_date,
      approvalNotes:  notes || null,
    }).catch(e => console.error('Approval email failed:', e.message));

    // CC Principals on decision
    sendPrincipalDecisionNotice({
      requesterName: first.requester_name,
      requesterUnit: first.unit_school,
      items:         itemsPayload,
      type:          first.type,
      status:        'approved',
      notes:         notes || null,
      groupId,
      recipients:    getPrincipalRecipients(first.unit_school),
    }).catch(e => console.error('Principal approval notice failed:', e.message));

    // Telegram
    const tgId = getTelegramId(first.requester_email);
    if (tgId) sendTelegram(tgId,
      `✅ <b>Request Approved!</b>\n\n${itemsBullet}` +
      `${notes ? `\n\n📝 Note: ${notes}` : ''}\n\n` +
      `Please collect your item(s) from the storeroom.` +
      `${first.type === 'borrow' ? ' Remember to return by the due date.' : ''}`
    ).catch(() => {});

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
  const itemsBullet = rows.map(r => `• ${r.item_name} × ${r.quantity}`).join('\n');

  // Email requester
  sendRequestRejected({
    requesterName:  first.requester_name,
    requesterEmail: first.requester_email,
    itemName:       itemList,
    quantity:       rows.reduce((s, r) => s + r.quantity, 0),
    notes,
  }).catch(e => console.error('Rejection email failed:', e.message));

  // CC Principals on decision
  sendPrincipalDecisionNotice({
    requesterName: first.requester_name,
    requesterUnit: first.unit_school,
    items:         rows.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name })),
    type:          first.type,
    status:        'rejected',
    notes:         notes || null,
    groupId,
    recipients:    getPrincipalRecipients(first.unit_school),
  }).catch(e => console.error('Principal rejection notice failed:', e.message));

  // Telegram
  const tgId = getTelegramId(first.requester_email);
  if (tgId) sendTelegram(tgId,
    `❌ <b>Request Not Approved</b>\n\n${itemsBullet}` +
    `${notes ? `\n\n📝 Reason: ${notes}` : ''}\n\n` +
    `Please contact the storekeeper or submit a new request if needed.`
  ).catch(() => {});

  res.json({ group_id: groupId, rejected: rows.length });
});

// ── PUT /api/requests/groups/:groupId/forward ──────────────────────────────
router.put('/groups/:groupId/forward', (req, res) => {
  const { forwarded_note } = req.body || {};
  const { groupId } = req.params;

  const fullRows = db.prepare(`${withItem} WHERE r.group_id = ? AND r.status = 'pending'`).all(groupId);
  if (fullRows.length === 0) return res.status(404).json({ error: 'No pending items in this group.' });

  db.prepare(`UPDATE requests SET forwarded = 1, forwarded_note = ? WHERE group_id = ? AND status = 'pending'`)
    .run(forwarded_note || null, groupId);

  res.json({ group_id: groupId, forwarded: fullRows.length });

  // Notify managers via email + Telegram
  const managers   = getManagerRecipients();
  const first      = fullRows[0];
  const itemsBullet = fullRows.map(r => `• ${r.item_name} × ${r.quantity} ${r.unit_name}`).join('\n');

  sendRequestForwarded({
    storekeepName:  req.user?.name || 'Storekeeper',
    requesterName:  first.requester_name,
    items:          fullRows.map(r => ({ item_name: r.item_name, quantity: r.quantity, unit_name: r.unit_name })),
    purpose:        first.purpose,
    forwardedNote:  forwarded_note || null,
    recipients:     managers,
  }).catch(e => console.error('Forward email failed:', e.message));

  const managerTgIds = managers.map(r => r.telegram_chat_id).filter(Boolean);
  if (managerTgIds.length) sendTelegramToMany(managerTgIds,
    `📨 <b>Request Forwarded to You</b>\n\n` +
    `Forwarded by: <b>${req.user?.name || 'Storekeeper'}</b>\n` +
    `From: ${first.requester_name}\n\n${itemsBullet}` +
    `${forwarded_note ? `\n\n📝 Note: ${forwarded_note}` : ''}\n\n` +
    `👉 Open app to review: kkinventory.ypj.sch.id/approvals`
  ).catch(() => {});
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

    sendPrincipalDecisionNotice({
      requesterName: row.requester_name,
      requesterUnit: row.unit_school,
      items:         [{ item_name: row.item_name, quantity: row.quantity, unit_name: row.unit_name }],
      type:          row.type,
      status:        'approved',
      notes:         notes || null,
      groupId:       row.group_id || null,
      recipients:    getPrincipalRecipients(row.unit_school),
    }).catch(e => console.error('Principal approval notice failed:', e.message));

    const tgId = getTelegramId(row.requester_email);
    if (tgId) sendTelegram(tgId,
      `✅ <b>Request Approved!</b>\n\n• ${row.item_name} × ${row.quantity} ${row.unit_name}` +
      `${notes ? `\n\n📝 Note: ${notes}` : ''}\n\n` +
      `Please collect your item from the storeroom.` +
      `${row.type === 'borrow' ? ' Remember to return by the due date.' : ''}`
    ).catch(() => {});

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

  sendPrincipalDecisionNotice({
    requesterName: row.requester_name,
    requesterUnit: row.unit_school,
    items:         [{ item_name: row.item_name, quantity: row.quantity, unit_name: row.unit_name }],
    type:          row.type,
    status:        'rejected',
    notes:         notes || null,
    groupId:       row.group_id || null,
    recipients:    getPrincipalRecipients(row.unit_school),
  }).catch(e => console.error('Principal rejection notice failed:', e.message));

  const tgId = getTelegramId(row.requester_email);
  if (tgId) sendTelegram(tgId,
    `❌ <b>Request Not Approved</b>\n\n• ${row.item_name} × ${row.quantity} ${row.unit_name}` +
    `${notes ? `\n\n📝 Reason: ${notes}` : ''}\n\n` +
    `Please contact the storekeeper or submit a new request if needed.`
  ).catch(() => {});

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

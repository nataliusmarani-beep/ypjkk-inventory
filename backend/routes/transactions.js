const express = require('express');
const db = require('../db');
const { sendCheckoutConfirmation, sendCheckinConfirmation } = require('../mailer');

const router = express.Router();

// GET /api/transactions
router.get('/', (req, res) => {
  const { item_id, status } = req.query;

  let statusFilter = null;
  if (status === 'open') statusFilter = 'open';
  if (status === 'returned') statusFilter = 'returned';

  const rows = db.prepare(`
    SELECT t.*, i.name AS item_name, i.category
    FROM transactions t
    JOIN items i ON i.id = t.item_id
    WHERE
      (? IS NULL OR t.item_id = ?)
      AND (? IS NULL OR
        (? = 'open' AND t.return_date IS NULL) OR
        (? = 'returned' AND t.return_date IS NOT NULL)
      )
    ORDER BY t.created_at DESC
  `).all(
    item_id || null, item_id || null,
    statusFilter, statusFilter, statusFilter,
  );

  res.json(rows);
});

// POST /api/transactions/checkout
router.post('/checkout', (req, res) => {
  const { item_id, borrower_name, borrower_email, quantity, due_date, notes } = req.body;

  if (!item_id) return res.status(400).json({ error: 'item_id is required.' });
  if (!borrower_name || !borrower_name.trim()) return res.status(400).json({ error: 'Borrower name is required.' });
  if (!borrower_email || !borrower_email.trim()) return res.status(400).json({ error: 'Borrower email is required.' });
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be >= 1.' });

  let tx;
  try {
    db.exec('BEGIN');

    const item = db.prepare('SELECT id, name, quantity FROM items WHERE id = ?').get(item_id);
    if (!item) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'Item not found.' }); }
    if (item.quantity < quantity) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: `Only ${item.quantity} unit(s) available.` });
    }

    db.prepare(
      `UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`
    ).run(quantity, item_id);

    const result = db.prepare(
      `INSERT INTO transactions (item_id, type, borrower_name, borrower_email, quantity, due_date, notes)
       VALUES (?, 'checkout', ?, ?, ?, ?, ?)`
    ).run(item_id, borrower_name.trim(), borrower_email.trim(), quantity, due_date || null, notes || null);

    db.exec('COMMIT');

    tx = db.prepare(
      `SELECT t.*, i.name AS item_name FROM transactions t JOIN items i ON i.id = t.item_id WHERE t.id = ?`
    ).get(result.lastInsertRowid);
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  // Send email in background — don't block the response
  sendCheckoutConfirmation({
    borrowerName: tx.borrower_name,
    borrowerEmail: tx.borrower_email,
    itemName: tx.item_name,
    quantity: tx.quantity,
    dueDate: tx.due_date,
  }).catch((err) => console.error('Checkout email failed:', err.message));

  res.status(201).json(tx);
});

// PUT /api/transactions/:id/checkin
router.put('/:id/checkin', (req, res) => {
  const { return_date, notes } = req.body;

  let updated;
  try {
    db.exec('BEGIN');

    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!tx) { db.exec('ROLLBACK'); return res.status(404).json({ error: 'Transaction not found.' }); }
    if (tx.return_date) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Already checked in.' }); }

    const returnDate = return_date || new Date().toISOString().slice(0, 10);

    db.prepare(
      `UPDATE transactions SET return_date = ?, notes = COALESCE(?, notes) WHERE id = ?`
    ).run(returnDate, notes || null, tx.id);

    db.prepare(
      `UPDATE items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`
    ).run(tx.quantity, tx.item_id);

    db.exec('COMMIT');

    updated = db.prepare(
      `SELECT t.*, i.name AS item_name FROM transactions t JOIN items i ON i.id = t.item_id WHERE t.id = ?`
    ).get(tx.id);
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  // Send email in background — don't block the response
  sendCheckinConfirmation({
    borrowerName: updated.borrower_name,
    borrowerEmail: updated.borrower_email,
    itemName: updated.item_name,
    quantity: updated.quantity,
    returnDate: updated.return_date,
  }).catch((err) => console.error('Checkin email failed:', err.message));

  res.json(updated);
});

module.exports = router;

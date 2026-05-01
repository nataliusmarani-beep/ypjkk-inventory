// ── Borrow return reminders ────────────────────────────────────────────────
// Runs every hour. Sends email to requestors H-2 and H-1 before return date.
// reminder_2d_sent / reminder_1d_sent flags prevent duplicate sends.

const db              = require('./db');
const { sendBorrowReminder } = require('./mailer');

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];   // "YYYY-MM-DD"
}

async function runBorrowReminders() {
  const targets = [
    { daysLeft: 2, col: 'reminder_2d_sent', targetDate: dateStr(2) },
    { daysLeft: 1, col: 'reminder_1d_sent', targetDate: dateStr(1) },
  ];

  for (const { daysLeft, col, targetDate } of targets) {
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT r.id, r.requester_name, r.requester_email,
               r.quantity, r.return_date,
               i.name AS item_name, i.unit_name
        FROM requests r
        JOIN items i ON r.item_id = i.id
        WHERE r.type    = 'borrow'
          AND r.status  = 'approved'
          AND r.${col}  = 0
          AND DATE(r.return_date) = ?
      `).all(targetDate);
    } catch (e) {
      console.error(`[reminders] Query error (${col}):`, e.message);
      continue;
    }

    for (const row of rows) {
      try {
        await sendBorrowReminder({
          name:       row.requester_name,
          email:      row.requester_email,
          itemName:   row.item_name,
          quantity:   row.quantity,
          unitName:   row.unit_name || 'pcs',
          returnDate: row.return_date,
          daysLeft,
        });
        db.prepare(`UPDATE requests SET ${col} = 1 WHERE id = ?`).run(row.id);
        console.log(`[reminders] H-${daysLeft} reminder sent → ${row.requester_email} (request #${row.id})`);
      } catch (e) {
        console.error(`[reminders] Failed to send to ${row.requester_email}:`, e.message);
      }
    }
  }
}

module.exports = { runBorrowReminders };

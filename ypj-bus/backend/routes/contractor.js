const express = require('express');
const db      = require('../db');

const router = express.Router();

// Read-only data for the Contractor (bus company leadership) role. Everything
// else contractor needs — Lacak Bus, safety checklist history, the schedule,
// Ruang Chat, event bus requests — is already served by an existing route
// with 'contractor' added to its role list (see server.js); broadcast
// history is the one thing with no existing read endpoint anywhere, not even
// for Tim Transportasi itself.

/**
 * GET /api/contractor/broadcasts — every "Broadcast ke Orang Tua" Tim
 * Transportasi has sent (POST /api/admin/broadcast), newest first.
 *
 * There is no dedicated broadcasts table — a broadcast fans out into one row
 * per recipient in `notifications` (template 'admin.broadcast', see
 * lib/notify.js's templates.broadcast and the loop in POST /admin/broadcast).
 * Grouping those rows back into distinct sends by (title, body) reconstructs
 * the history without a schema change; recipient count comes along for free
 * as the group size. Two different broadcasts landing on the identical
 * subject *and* message text would merge into one row here — accepted as a
 * vanishingly unlikely coincidence rather than worth a dedicated table.
 */
router.get('/broadcasts', (req, res) => {
  const rows = db.prepare(`
    SELECT title AS subject, body AS message,
           MIN(created_at) AS sent_at,
           COUNT(*) AS recipients
    FROM notifications
    WHERE template = 'admin.broadcast'
    GROUP BY title, body
    ORDER BY sent_at DESC
    LIMIT 200
  `).all();

  res.json(rows);
});

module.exports = router;

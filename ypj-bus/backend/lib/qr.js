const crypto = require('crypto');
const db     = require('../db');

// Rotating this secret invalidates every saved or printed card, so it should only
// change between academic years.
const QR_SECRET = process.env.QR_SECRET || 'ypjkk-bus-qr-dev-secret';

// The QR carries opaque identifiers only — never the child's name, home address
// or the parent's phone number. Anything a scanner needs to display comes back
// from the server after verification.
//
// Payload: YPJB1|transitId|routeId|validUntil|version|signature[|token]
//   * the first six fields are static and signed, so an attendant's phone can
//     validate a card with no signal on the SP2/SP3 runs;
//   * the trailing token is single-use and expires in 90 s, which is what stops
//     a screenshot being passed around the neighbourhood.
const TOKEN_TTL_SECONDS = 90;

function sign(body) {
  return crypto.createHmac('sha256', QR_SECRET).update(body).digest('hex').slice(0, 16);
}

function staticPayload(card) {
  const body = ['YPJB1', card.transit_id, card.route_id, card.valid_until.replace(/-/g, ''), 1].join('|');
  return `${body}|${sign(body)}`;
}

/** Mints a fresh single-use token and returns the full QR string for a card. */
function issuePayload(card) {
  const token   = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

  db.prepare(`
    INSERT INTO card_tokens (card_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(card.id, hashToken(token), sqlDateTime(expires));

  // Housekeeping: tokens older than a day are of no use to anyone.
  db.prepare(`
    DELETE FROM card_tokens
    WHERE card_id = ? AND expires_at < datetime('now', '-1 day')
  `).run(card.id);

  return {
    payload:     `${staticPayload(card)}|${token}`,
    expires_at:  expires.toISOString(),
    ttl_seconds: TOKEN_TTL_SECONDS,
  };
}

/**
 * Status + route eligibility only — shared by the QR path below and by the
 * manual lookup (routes/scan.js's /search + /manual, for when a child forgot
 * their card). Returns a scan_logs result string, or null if eligible.
 */
function checkEligibility(card, opts = {}) {
  if (card.status === 'revoked')   return 'revoked';
  if (card.status === 'suspended') return 'suspended';
  if (card.status === 'expired' || card.valid_until < today()) {
    return 'expired';
  }

  // Is this child's stop on the bus's current run? Checked against the bus's own
  // stop list rather than its home route: under the weekly rolling roster a unit
  // legitimately covers stops outside its usual corridor, and comparing routes
  // would refuse those children at the door.
  if (opts.busId) {
    const assigned = db.prepare(`
      SELECT 1 FROM bus_route_stops WHERE bus_id = ? LIMIT 1
    `).get(opts.busId);

    if (assigned) {
      const serves = db.prepare(`
        SELECT 1 FROM bus_route_stops WHERE bus_id = ? AND bus_stop_id = ?
      `).get(opts.busId, card.bus_stop_id);
      if (!serves) return 'wrong_route';
    } else {
      // No roster set for this unit yet — fall back to the home-route check so
      // the guard still does something rather than silently passing everyone.
      const bus = db.prepare(`SELECT route_id FROM buses WHERE id = ?`).get(opts.busId);
      if (bus?.route_id && bus.route_id !== card.route_id) {
        return 'wrong_route';
      }
    }
  }

  return null;
}

/**
 * Verifies a scanned string. Returns { card, result } where result is one of the
 * scan_logs values. Signature and status are checked here; the caller writes the
 * log row and shapes the response for the attendant.
 */
function verifyPayload(raw, opts = {}) {
  const parts = String(raw || '').split('|');
  if (parts.length < 6 || parts[0] !== 'YPJB1') {
    return { card: null, result: 'unknown_card' };
  }

  const [, transitId, , , , signature, token] = parts;
  const body = parts.slice(0, 5).join('|');

  const card = db.prepare(`SELECT * FROM bus_id_cards WHERE transit_id = ?`).get(transitId);
  if (!card) return { card: null, result: 'unknown_card' };

  // Timing-safe compare: both sides are fixed-length hex.
  const expected = sign(body);
  const ok = signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) return { card, result: 'unknown_card' };

  const denied = checkEligibility(card, opts);
  if (denied) return { card, result: denied };

  // No token: the attendant scanned a saved image, or the parent's phone was
  // offline. Allowed, but flagged so the Transport Team can review it.
  if (!token) return { card, result: 'ok_offline' };

  const row = db.prepare(`
    SELECT * FROM card_tokens WHERE card_id = ? AND token_hash = ?
  `).get(card.id, hashToken(token));

  if (!row)                     return { card, result: 'ok_offline' };
  if (row.expires_at < now())   return { card, result: 'ok_offline' };
  if (row.consumed_at)          return { card, result: 'replay' };

  db.prepare(`UPDATE card_tokens SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);
  return { card, result: 'ok' };
}

const MESSAGES = {
  ok:           'Izinkan naik.',
  ok_offline:   'Izinkan naik (verifikasi offline).',
  suspended:    'Hak pengguna bis sedang DITANGGUHKAN.',
  revoked:      'Hak pengguna bis telah DICABUT.',
  expired:      'Kartu sudah kadaluarsa.',
  wrong_route:  'Siswa tidak terdaftar pada rute bus ini.',
  replay:       'Kode QR sudah dipakai. Minta siswa memuat ulang kartu.',
  unknown_card: 'Kartu tidak dikenali.',
};

const hashToken   = (t) => crypto.createHash('sha256').update(t).digest('hex');
const sqlDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const now         = () => sqlDateTime(new Date());
const today       = () => new Date().toISOString().slice(0, 10);

module.exports = { issuePayload, verifyPayload, staticPayload, checkEligibility, MESSAGES, TOKEN_TTL_SECONDS };

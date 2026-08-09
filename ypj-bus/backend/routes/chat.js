const express = require('express');
const db      = require('../db');
const { logActivity, fail } = require('../lib/cards');
const { isStaff, isAdmin } = require('../middleware/auth');

const router = express.Router();

const MAX_BODY = 2000;

// The internal "run the bus" group room — Tim Transportasi (transport_admin/
// super_admin), Driver, Helper. Leader/Admin Sekolah get the same read-only
// treatment they get everywhere else in the admin surface (see
// routes/admin.js), so they can see the room without posting into it.
const canViewGroup = (user) => isAdmin(user) || ['leader', 'admin', 'driver', 'helper'].includes(user?.role);
const canPostGroup  = (user) => isAdmin(user) || ['driver', 'helper'].includes(user?.role);

// "Ruang Chat" — the public room. Every logged-in account can read it (the
// mount-level requireAuth in server.js already gates that); posting is
// narrower — Tim Transportasi starts topics, parents reply — so the other
// staff roles (driver/helper/school_staff) see it but can't post, same
// read-only shape as canPostGroup above. Leader and Admin Sekolah are the
// deliberate exception here (along with replying to parents in Chat Orang
// Tua, via isStaff below) — everywhere else in the admin surface it's
// view-only for both.
const canPostRoom = (user) => isAdmin(user) || ['parent', 'leader', 'admin'].includes(user?.role);

/** The parent's thread, created on demand so an empty inbox costs nothing. */
function threadForParent(parentId, { create = false } = {}) {
  let thread = db.prepare(`SELECT * FROM chat_threads WHERE parent_id = ?`).get(parentId);
  if (!thread && create) {
    const info = db.prepare(`INSERT INTO chat_threads (parent_id) VALUES (?)`).run(parentId);
    thread = db.prepare(`SELECT * FROM chat_threads WHERE id = ?`).get(info.lastInsertRowid);
  }
  return thread || null;
}

function messagesFor(threadId) {
  return db.prepare(`
    SELECT m.id, m.sender_side, m.body, m.created_at, m.read_at, u.name AS sender_name
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id = ?
    ORDER BY m.id
  `).all(threadId);
}

function postMessage(threadId, user, side, body) {
  db.prepare(`
    INSERT INTO chat_messages (thread_id, sender_id, sender_side, body)
    VALUES (?, ?, ?, ?)
  `).run(threadId, user.id, side, body);
  db.prepare(`
    UPDATE chat_threads SET last_message_at = datetime('now') WHERE id = ?
  `).run(threadId);
}

// ── Parent side ────────────────────────────────────────────────────────────

/**
 * GET /api/chat — the parent's own conversation.
 *
 * Opening the thread marks the staff replies as read, which is what drives the
 * unread badge on the dashboard.
 */
router.get('/', (req, res) => {
  const thread = threadForParent(req.user.id);
  if (!thread) return res.json({ messages: [] });

  db.prepare(`
    UPDATE chat_messages SET read_at = datetime('now')
    WHERE thread_id = ? AND sender_side = 'staff' AND read_at IS NULL
  `).run(thread.id);

  res.json({ thread_id: thread.id, messages: messagesFor(thread.id) });
});

/** GET /api/chat/unread — count only, for the dashboard badge. */
router.get('/unread', (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
    WHERE t.parent_id = ? AND m.sender_side = 'staff' AND m.read_at IS NULL
  `).get(req.user.id);
  res.json({ unread: row.n });
});

// POST /api/chat — parent sends a message.
router.post('/', (req, res, next) => {
  try {
    const body = (req.body?.body || '').trim();
    if (!body) throw fail(400, 'Pesan tidak boleh kosong.');
    if (body.length > MAX_BODY) throw fail(400, `Pesan maksimal ${MAX_BODY} karakter.`);

    const thread = threadForParent(req.user.id, { create: true });
    postMessage(thread.id, req.user, 'parent', body);

    logActivity(req, 'chat.parent_message', 'chat_threads', thread.id, null);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Transport Team side ────────────────────────────────────────────────────

/** GET /api/chat/threads — every conversation, unanswered first. */
router.get('/threads', (req, res, next) => {
  if (!isStaff(req.user)) return next(fail(403, 'Tidak berwenang.'));

  const rows = db.prepare(`
    SELECT t.id AS thread_id, t.last_message_at,
           u.id AS parent_id, u.name AS parent_name, u.email AS parent_email,
           u.phone_primary,
           (SELECT COUNT(*) FROM chat_messages m
             WHERE m.thread_id = t.id AND m.sender_side = 'parent'
               AND m.read_at IS NULL)                                AS unread,
           (SELECT m.body FROM chat_messages m
             WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1)     AS last_body,
           (SELECT m.sender_side FROM chat_messages m
             WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1)     AS last_side
    FROM chat_threads t
    JOIN users u ON u.id = t.parent_id
    ORDER BY unread > 0 DESC, t.last_message_at DESC
  `).all();

  res.json(rows);
});

/** GET /api/chat/threads/:id — one conversation; marks parent messages read. */
router.get('/threads/:id', (req, res, next) => {
  if (!isStaff(req.user)) return next(fail(403, 'Tidak berwenang.'));

  const thread = db.prepare(`
    SELECT t.*, u.name AS parent_name, u.email AS parent_email, u.phone_primary
    FROM chat_threads t JOIN users u ON u.id = t.parent_id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!thread) return next(fail(404, 'Percakapan tidak ditemukan.'));

  db.prepare(`
    UPDATE chat_messages SET read_at = datetime('now')
    WHERE thread_id = ? AND sender_side = 'parent' AND read_at IS NULL
  `).run(thread.id);

  res.json({ thread, messages: messagesFor(thread.id) });
});

/** POST /api/chat/threads/:id — Transport Team replies. */
router.post('/threads/:id', (req, res, next) => {
  try {
    if (!isStaff(req.user)) throw fail(403, 'Tidak berwenang.');

    const body = (req.body?.body || '').trim();
    if (!body) throw fail(400, 'Pesan tidak boleh kosong.');
    if (body.length > MAX_BODY) throw fail(400, `Pesan maksimal ${MAX_BODY} karakter.`);

    const thread = db.prepare(`SELECT * FROM chat_threads WHERE id = ?`).get(req.params.id);
    if (!thread) throw fail(404, 'Percakapan tidak ditemukan.');

    postMessage(thread.id, req.user, 'staff', body);
    logActivity(req, 'chat.staff_reply', 'chat_threads', thread.id, null);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Internal staff group room ────────────────────────────────────────────────

/** GET /api/chat/group — the room's history; also advances the caller's read cursor. */
router.get('/group', (req, res, next) => {
  if (!canViewGroup(req.user)) return next(fail(403, 'Tidak berwenang.'));

  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name, u.role AS sender_role
    FROM staff_group_messages m
    JOIN users u ON u.id = m.sender_id
    ORDER BY m.id
  `).all();

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  db.prepare(`
    INSERT INTO staff_group_reads (user_id, last_read_message_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id
  `).run(req.user.id, lastId);

  res.json({ messages, can_post: canPostGroup(req.user) });
});

/** GET /api/chat/group/unread — count only, for the header badge. */
router.get('/group/unread', (req, res) => {
  if (!canViewGroup(req.user)) return res.json({ unread: 0 });

  const cursor = db.prepare(`
    SELECT last_read_message_id FROM staff_group_reads WHERE user_id = ?
  `).get(req.user.id)?.last_read_message_id || 0;

  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM staff_group_messages WHERE id > ? AND sender_id <> ?
  `).get(cursor, req.user.id);

  res.json({ unread: row.n });
});

// POST /api/chat/group — post to the room. Leader stays read-only, same as
// every mutating admin route.
router.post('/group', (req, res, next) => {
  try {
    if (!canPostGroup(req.user)) throw fail(403, 'Tidak berwenang.');

    const body = (req.body?.body || '').trim();
    if (!body) throw fail(400, 'Pesan tidak boleh kosong.');
    if (body.length > MAX_BODY) throw fail(400, `Pesan maksimal ${MAX_BODY} karakter.`);

    const info = db.prepare(`
      INSERT INTO staff_group_messages (sender_id, body) VALUES (?, ?)
    `).run(req.user.id, body);

    logActivity(req, 'chat.group_message', 'staff_group_messages', Number(info.lastInsertRowid), null);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Ruang Chat (public room) ─────────────────────────────────────────────────

/** GET /api/chat/room — the room's full history; open to every logged-in
 * account. Also advances the caller's read cursor. */
router.get('/room', (req, res) => {
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name, u.role AS sender_role
    FROM public_chat_messages m
    JOIN users u ON u.id = m.sender_id
    ORDER BY m.id
  `).all();

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  db.prepare(`
    INSERT INTO public_chat_reads (user_id, last_read_message_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id
  `).run(req.user.id, lastId);

  res.json({ messages, can_post: canPostRoom(req.user) });
});

/** GET /api/chat/room/unread — count only, for the header badge. */
router.get('/room/unread', (req, res) => {
  const cursor = db.prepare(`
    SELECT last_read_message_id FROM public_chat_reads WHERE user_id = ?
  `).get(req.user.id)?.last_read_message_id || 0;

  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM public_chat_messages WHERE id > ? AND sender_id <> ?
  `).get(cursor, req.user.id);

  res.json({ unread: row.n });
});

// POST /api/chat/room — Tim Transportasi posts, parents reply. Every other
// role can read but not write, same as the internal group room.
router.post('/room', (req, res, next) => {
  try {
    if (!canPostRoom(req.user)) throw fail(403, 'Tidak berwenang.');

    const body = (req.body?.body || '').trim();
    if (!body) throw fail(400, 'Pesan tidak boleh kosong.');
    if (body.length > MAX_BODY) throw fail(400, `Pesan maksimal ${MAX_BODY} karakter.`);

    const info = db.prepare(`
      INSERT INTO public_chat_messages (sender_id, body) VALUES (?, ?)
    `).run(req.user.id, body);

    logActivity(req, 'chat.room_message', 'public_chat_messages', Number(info.lastInsertRowid), null);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

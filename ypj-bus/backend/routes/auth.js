const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const requireAuth = require('../middleware/auth');
const { PARENT_CATEGORY_KEYS } = require('../lib/cards');
const { sendMail, layout } = require('../lib/notify');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const APP_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Only the hash is stored (same idea as a password_hash) so a stolen database
// backup can't be replayed as a working reset link — the raw token only ever
// exists in the email and the URL bar.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'ypjkk-bus-2025-secret-key';
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,                 // JS cannot read this cookie — prevents XSS token theft
  secure:   IS_PROD,
  sameSite: IS_PROD ? 'strict' : 'lax',
  maxAge:   8 * 60 * 60 * 1000,   // 8 hours
  path:     '/',
};

const publicUser = (user) => ({
  id:    user.id,
  name:  user.name,
  email: user.email,
  role:  user.role,
});

function issueCookie(res, user) {
  const payload = publicUser(user);
  res.cookie('bus_token', jwt.sign(payload, SECRET, { expiresIn: '8h' }), COOKIE_OPTS);
  return payload;
}

// POST /api/auth/register — parents create their own account.
// Staff accounts are created by an admin (or seed-admins.js), never here.
router.post('/register', (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email dan password wajib diisi.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }

    const normalised = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = :email').get({ email: normalised });
    if (existing) {
      return res.status(409).json({ error: 'Email ini sudah terdaftar. Silakan masuk.' });
    }

    const info = db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, 'parent')
    `).run(String(name).trim(), normalised, bcrypt.hashSync(password, 10));

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: issueCookie(res, user) });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Pendaftaran akun gagal. Coba lagi.' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    }

    const normalised = String(email).trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = :email').get({ email: normalised });

    if (!user || !user.is_active || !user.password_hash) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    res.json({ user: issueCookie(res, user) });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login gagal. Coba lagi.' });
  }
});

// POST /api/auth/forgot-password
// Body: { email }
//
// Always responds with the same generic message whether or not the email is
// registered — telling the caller "that email isn't registered" would let
// anyone probe which parents/staff have accounts. The actual reset link (if
// any) only ever goes out by email.
router.post('/forgot-password', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email wajib diisi.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = :email AND is_active = 1')
      .get({ email });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
      db.prepare(`
        UPDATE users SET password_reset_token = ?, password_reset_expires = ?
        WHERE id = ?
      `).run(hashToken(token), expires, user.id);

      const link = `${APP_URL}/reset-password?token=${token}`;
      sendMail({
        to: user.email,
        subject: 'Atur ulang password Bis Sekolah YPJ',
        html: resetPasswordEmail(user.name, link),
      }).catch((e) => console.error('[auth] Reset email failed:', e.message));
    }

    res.json({ ok: true, message: 'Jika email terdaftar, tautan atur ulang password telah dikirim.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Permintaan gagal. Coba lagi.' });
  }
});

// POST /api/auth/reset-password
// Body: { token, password }
router.post('/reset-password', (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'Tautan tidak valid dan password wajib diisi.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }

    const user = db.prepare(`
      SELECT * FROM users
      WHERE password_reset_token = ? AND is_active = 1
    `).get(hashToken(token));

    if (!user || !user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
      return res.status(400).json({ error: 'Tautan atur ulang password sudah kedaluwarsa atau tidak valid. Silakan minta tautan baru.' });
    }

    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(bcrypt.hashSync(password, 10), user.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Gagal mengatur ulang password. Coba lagi.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('bus_token', { path: '/' });
  res.json({ ok: true });
});

// GET /api/auth/me — session check plus the parent profile the form pre-fills from.
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.phone_primary, u.phone_alternate,
             u.phone_alternate_owner, u.employee_id, u.parent_category,
             u.department, u.home_address
      FROM users u
      WHERE u.id = :id AND u.is_active = 1
    `).get({ id: req.user.id });

    if (!user) {
      res.clearCookie('bus_token');
      return res.status(401).json({ error: 'Akun tidak ditemukan atau tidak aktif.' });
    }
    res.json(user);
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Tidak dapat memverifikasi sesi.' });
  }
});

// PUT /api/auth/me — parent updates their own contact details (Q1–Q6).
router.put('/me', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    if (b.parent_category && !PARENT_CATEGORY_KEYS.includes(b.parent_category)) {
      return res.status(400).json({ error: 'Kategori Orang Tua tidak dikenali.' });
    }
    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          phone_primary = ?, phone_alternate = ?, phone_alternate_owner = ?,
          employee_id = ?, parent_category = COALESCE(?, parent_category),
          department = ?, home_address = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.name?.trim() || null,
      b.phone_primary?.trim() || null,
      b.phone_alternate?.trim() || null,
      b.phone_alternate_owner?.trim() || null,
      b.employee_id?.trim() || null,
      b.parent_category || null,
      b.department?.trim() || null,
      b.home_address?.trim() || null,
      req.user.id,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: 'Gagal menyimpan data orang tua.' });
  }
});

function resetPasswordEmail(name, link) {
  return layout('Atur Ulang Password', `
    <p>Halo ${escapeHtml(name)},</p>
    <p>Kami menerima permintaan untuk mengatur ulang password akun Bis Sekolah YPJ Anda.
    Tautan ini berlaku selama 1 jam.</p>
    <p>
      <a href="${link}" style="background:#F5B301;color:#13407A;text-decoration:none;
         padding:10px 18px;border-radius:8px;font-weight:700;display:inline-block">
        Atur Ulang Password
      </a>
    </p>
    <p style="color:#5A6376;font-size:12px">
      Jika Anda tidak meminta ini, abaikan email ini — password Anda tidak akan berubah.
    </p>
  `);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = router;

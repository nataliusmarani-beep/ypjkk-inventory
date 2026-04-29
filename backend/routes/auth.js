const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'ypjkk-inventory-2025-secret-key';
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,                 // JS cannot read this cookie — prevents XSS token theft
  secure:   IS_PROD,              // HTTPS only in production
  sameSite: IS_PROD ? 'strict' : 'lax',
  maxAge:   8 * 60 * 60 * 1000,  // 8 hours in ms
  path:     '/',
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalised = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = :email').get({ email: normalised });

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const payload = {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      role:        user.role,
      unit_school: user.unit_school,
      location:    user.location || null,
    };
    const token = jwt.sign(payload, SECRET, { expiresIn: '8h' });

    // Set token as HttpOnly cookie — not accessible by JavaScript
    res.cookie('inv_token', token, COOKIE_OPTS);

    res.json({ user: payload });   // no token in body — it lives in the cookie
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('inv_token', { path: '/' });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, name, email, role, unit_school, location FROM users WHERE id = :id AND is_active = 1'
    ).get({ id: req.user.id });

    if (!user) {
      res.clearCookie('inv_token');
      return res.status(401).json({ error: 'Account not found or deactivated.' });
    }
    res.json(user);
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Could not verify session.' });
  }
});

module.exports = router;

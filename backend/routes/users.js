const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');

const router = express.Router();

function adminOnly(req, res, next) {
  if (req.user?.role !== 'Manager') return res.status(403).json({ error: 'Manager access required.' });
  next();
}
router.use(adminOnly);

const PUBLIC_COLS = 'id, name, email, role, unit_school, location, store_category, is_active, created_at';

// ── GET /api/users ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { search, role } = req.query;
    const rows = db.prepare(`
      SELECT ${PUBLIC_COLS} FROM users
      WHERE (:search IS NULL OR LOWER(name) LIKE '%' || LOWER(:search) || '%'
                             OR LOWER(email) LIKE '%' || LOWER(:search) || '%')
        AND (:role IS NULL OR role = :role)
      ORDER BY name ASC
    `).all({ search: search || null, role: role || null });
    res.json(rows);
  } catch (err) {
    console.error('GET /users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, email, role, unit_school, location, store_category, password } = req.body;

    if (!name?.trim())     return res.status(400).json({ error: 'Name is required.' });
    if (!email?.trim())    return res.status(400).json({ error: 'Email is required.' });
    if (!password?.trim()) return res.status(400).json({ error: 'Password is required.' });

    const validRoles = ['Manager','Storekeeper','Teacher','Other'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    const existing = db.prepare('SELECT id FROM users WHERE email = :email')
      .get({ email: email.trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: 'A user with this email already exists.' });

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, email, role, unit_school, location, store_category, password_hash)
      VALUES (:name, :email, :role, :unit_school, :location, :store_category, :hash)
    `).run({
      name:           name.trim(),
      email:          email.trim().toLowerCase(),
      role,
      unit_school:    unit_school || 'All',
      location:       location    || null,
      store_category: store_category || null,
      hash,
    });

    const user = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = :id`)
      .get({ id: result.lastInsertRowid });
    res.status(201).json(user);
  } catch (err) {
    console.error('POST /users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/users/:id ─────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { name, email, role, unit_school, location, store_category, is_active } = req.body;
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT id FROM users WHERE id = :id').get({ id });
    if (!existing) return res.status(404).json({ error: 'User not found.' });

    if (!name?.trim())  return res.status(400).json({ error: 'Name is required.' });
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });

    const validRoles = ['Manager','Storekeeper','Teacher','Other'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    if (id === req.user.id && is_active === 0) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    const dup = db.prepare('SELECT id FROM users WHERE email = :email AND id != :id')
      .get({ email: email.trim().toLowerCase(), id });
    if (dup) return res.status(409).json({ error: 'Another user with this email already exists.' });

    db.prepare(`
      UPDATE users
      SET name=:name, email=:email, role=:role, unit_school=:unit_school,
          location=:location, store_category=:store_category, is_active=:is_active
      WHERE id=:id
    `).run({
      name:           name.trim(),
      email:          email.trim().toLowerCase(),
      role,
      unit_school:    unit_school || 'All',
      location:       location    || null,
      store_category: store_category || null,
      is_active:      is_active ?? 1,
      id,
    });

    const updated = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = :id`).get({ id });
    res.json(updated);
  } catch (err) {
    console.error('PUT /users/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/users/:id/password ────────────────────────────────────────────
router.put('/:id/password', (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }
    const id = Number(req.params.id);
    const user = db.prepare('SELECT id FROM users WHERE id = :id').get({ id });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = :hash WHERE id = :id').run({ hash, id });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /users/:id/password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users/import ─────────────────────────────────────────────────
router.post('/import', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: 'No rows provided.' });
    if (rows.length > 200)
      return res.status(400).json({ error: 'Maximum 200 users per import.' });

    const validRoles = ['Manager','Storekeeper','Teacher','Other'];
    const validUnits = ['All','PAUD','SD','SMP'];
    const validLocs  = ['','PAUD YPJ KK','SD SMP YPJ KK'];
    const validCats  = ['','Supplies','Teacher Resources','Sport & Uniform'];

    let imported = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      if (!r.name?.trim())     { errors.push(`Row ${rowNum}: name is required.`); continue; }
      if (!r.email?.trim())    { errors.push(`Row ${rowNum}: email is required.`); continue; }
      if (!r.password?.trim()) { errors.push(`Row ${rowNum}: password is required.`); continue; }
      if (!validRoles.includes(r.role)) { errors.push(`Row ${rowNum}: invalid role "${r.role}".`); continue; }

      const email = r.email.trim().toLowerCase();
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) { skipped++; continue; }

      const hash = bcrypt.hashSync(r.password.trim(), 10);
      const unit = validUnits.includes(r.unit_school) ? r.unit_school : 'All';
      const loc  = validLocs.includes(r.location)     ? r.location    : null;
      const cat  = validCats.includes(r.store_category) ? r.store_category : null;

      db.prepare(`
        INSERT INTO users (name, email, role, unit_school, location, store_category, password_hash)
        VALUES (?,?,?,?,?,?,?)
      `).run(r.name.trim(), email, r.role, unit, loc || null, cat || null, hash);
      imported++;
    }

    res.json({ imported, skipped, errors });
  } catch (err) {
    console.error('POST /users/import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = :id').get({ id });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    db.prepare('DELETE FROM users WHERE id = :id').run({ id });
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /users/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

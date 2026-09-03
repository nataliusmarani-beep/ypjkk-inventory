const express = require('express');
const db = require('../db');

const router = express.Router();

const CATEGORIES = [
  // Supplies
  'Stationery','Housekeeping','Groceries','Tools','Medical/First Aid','Electronics',
  // Teacher Resources
  'Learning Tools','Art & Craft','Lab Tools','Decoration',
  // Sport & Uniform
  'Sport Equipment','School Uniform','Event Uniform','Traditional Uniform',
];
const STORE_CATS = ['Supplies','Teacher Resources','Sport & Uniform'];
const LOCATIONS  = ['PAUD YPJ KK','SD SMP YPJ KK'];
const UNIT_SCHOOLS = ['All','PAUD','SD','SMP'];
const UNIT_NAMES = ['pcs','ea','box','pack','set','cm','mtr','roll','carton','bundle','case','dozen','gr','kg','ltr','ml'];
const CONDITIONS = ['Good','Fair','Damaged','Expired'];

// Only Manager and Storekeeper can create/update/delete items
//
// req.user comes from the JWT cookie, which is only reissued at login (up to
// 8h old). If an admin changes a Storekeeper's assigned location/store
// category/role after they've already logged in, that change must take
// effect immediately — not after their session happens to expire — so we
// re-read the authoritative row from the DB here rather than trusting the
// stale token claims for these fields.
function staffOnly(req, res, next) {
  if (!req.user?.id) return res.status(403).json({ error: 'Not authenticated.' });
  const current = db.prepare('SELECT role, unit_school, location, store_category FROM users WHERE id = ? AND is_active = 1').get(req.user.id);
  if (!current || (current.role !== 'Manager' && current.role !== 'Storekeeper')) {
    return res.status(403).json({ error: 'Only Managers and Storekeepers can modify inventory items.' });
  }
  Object.assign(req.user, current);
  next();
}

// Resolves the single store location a Storekeeper is confined to, if any.
// Prefers the user's own `location` field; falls back to the unit_school
// mapping for older accounts that don't have `location` set. Returns null
// when the storekeeper isn't confined to any single location.
function storekeeperLocation(user) {
  if (user.location) return user.location;
  if (user.unit_school === 'PAUD') return 'PAUD YPJ KK';
  if (user.unit_school === 'SD' || user.unit_school === 'SMP') return 'SD SMP YPJ KK';
  return null;
}

// Resolves the single store category a Storekeeper is confined to, if any.
// Returns null when the storekeeper can work across all categories.
function storekeeperCategory(user) {
  return user.store_category || null;
}

function validate(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Name is required.');
  else if (body.name.trim().length > 25) errors.push('Name must be 25 characters or fewer.');
  if (!body.subtitle || !body.subtitle.trim()) errors.push('Subtitle is required.');
  if (!body.category) errors.push('Category is required.');
  if (!['used-up', 'borrow'].includes(body.item_type)) errors.push('Type must be Used-up or Borrow.');
  if (body.quantity === undefined || body.quantity < 0) errors.push('Quantity must be >= 0.');
  if (body.min_threshold === undefined || body.min_threshold < 1) errors.push('Min threshold must be >= 1.');
  return errors;
}

// GET /api/items
router.get('/', (req, res) => {
  const { search, category, store_category, location, unit_school, status, code, barcode } = req.query;

  const rows = db.prepare(`
    WITH enriched AS (
      SELECT *,
        CASE
          WHEN quantity = 0 THEN 'out_of_stock'
          WHEN quantity < min_threshold THEN 'low_stock'
          ELSE 'ok'
        END AS status
      FROM items
    )
    SELECT * FROM enriched
    WHERE
      (? IS NULL OR LOWER(name) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(code,'')) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(barcode,'')) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(subtitle,'')) LIKE '%' || LOWER(?) || '%')
      AND (? IS NULL OR category = ?)
      AND (? IS NULL OR store_category = ?)
      AND (? IS NULL OR location = ?)
      AND (? IS NULL OR unit_school = ? OR unit_school = 'All')
      AND (? IS NULL OR status = ?)
      AND (? IS NULL OR LOWER(COALESCE(code,'')) = LOWER(?))
      AND (? IS NULL OR LOWER(COALESCE(barcode,'')) = LOWER(?) OR LOWER(COALESCE(code,'')) = LOWER(?))
    ORDER BY name ASC
  `).all(
    search||null, search||null, search||null, search||null, search||null,
    category||null, category||null,
    store_category||null, store_category||null,
    location||null, location||null,
    unit_school||null, unit_school||null,
    status||null, status||null,
    code||null, code||null,
    barcode||null, barcode||null, barcode||null,
  );

  res.json(rows);
});

// GET /api/items/meta — return constants for dropdowns
router.get('/meta', (req, res) => {
  res.json({ CATEGORIES, STORE_CATS, LOCATIONS, UNIT_SCHOOLS, UNIT_NAMES, CONDITIONS });
});

// GET /api/items/:id
router.get('/:id', (req, res) => {
  const item = db.prepare(`
    SELECT *,
      CASE WHEN quantity=0 THEN 'out_of_stock' WHEN quantity<min_threshold THEN 'low_stock' ELSE 'ok' END AS status
    FROM items WHERE id=?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json(item);
});

// POST /api/items
router.post('/', staffOnly, (req, res) => {
  if (req.user?.role === 'Storekeeper') {
    const myCategory = storekeeperCategory(req.user);
    if (myCategory && req.body.store_category !== myCategory) {
      return res.status(403).json({ error: 'You can only add items in your assigned store category.' });
    }
  }

  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const { name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon, po_number, barcode, item_type, subtitle } = req.body;
  const result = db.prepare(`
    INSERT INTO items (name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon, po_number, barcode, item_type, subtitle)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    name.trim(), code||null, category, store_category, location, unit_school,
    quantity, max_quantity||quantity, unit_name||'pcs', description||null, min_threshold, condition||'Good', icon||null, po_number||null, barcode||null, item_type, subtitle?.trim()||null
  );

  const item = db.prepare('SELECT * FROM items WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PUT /api/items/:id
router.put('/:id', staffOnly, (req, res) => {
  const item = db.prepare('SELECT id, location, store_category FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  // Storekeeper location + category restriction
  if (req.user?.role === 'Storekeeper') {
    const myLocation = storekeeperLocation(req.user);
    if (myLocation && item.location !== myLocation) {
      return res.status(403).json({ error: 'You can only edit items in your assigned store.' });
    }
    const myCategory = storekeeperCategory(req.user);
    if (myCategory && item.store_category !== myCategory) {
      return res.status(403).json({ error: 'You can only edit items in your assigned store category.' });
    }
  }

  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const { name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon, po_number, barcode, item_type, subtitle } = req.body;
  db.prepare(`
    UPDATE items SET name=?,code=?,category=?,store_category=?,location=?,unit_school=?,quantity=?,max_quantity=?,unit_name=?,description=?,min_threshold=?,condition=?,icon=?,po_number=?,barcode=?,item_type=?,subtitle=?,updated_at=datetime('now')
    WHERE id=?
  `).run(
    name.trim(), code||null, category, store_category, location, unit_school,
    quantity, max_quantity||quantity, unit_name||'pcs', description||null, min_threshold, condition||'Good', icon||null, po_number||null, barcode||null, item_type, subtitle?.trim()||null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT *, CASE WHEN quantity=0 THEN 'out_of_stock' WHEN quantity<min_threshold THEN 'low_stock' ELSE 'ok' END AS status
    FROM items WHERE id=?
  `).get(req.params.id);
  res.json(updated);
});

// POST /api/items/import
router.post('/import', staffOnly, (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No rows provided.' });
  if (rows.length > 500)
    return res.status(400).json({ error: 'Maximum 500 rows per import.' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO items
      (name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, min_threshold, condition, description, barcode, item_type, subtitle)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let imported = 0, skipped = 0;
  const errors = [];

  const myLocation = req.user?.role === 'Storekeeper' ? storekeeperLocation(req.user) : null;
  const myCategory = req.user?.role === 'Storekeeper' ? storekeeperCategory(req.user) : null;

  const run = db.transaction(() => {
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      if (!r.name?.trim())     { errors.push(`Row ${rowNum}: name is required.`); return; }
      if (!CATEGORIES.includes(r.category)) { errors.push(`Row ${rowNum}: invalid category "${r.category}".`); return; }

      const qty    = parseInt(r.quantity)     || 0;
      const maxQty = parseInt(r.max_quantity) || qty;
      const minThr = parseInt(r.min_threshold) || 1;
      const cat    = STORE_CATS.includes(r.store_category) ? r.store_category : 'Supplies';
      const loc    = LOCATIONS.includes(r.location)        ? r.location        : 'SD SMP YPJ KK';
      const unit   = UNIT_SCHOOLS.includes(r.unit_school)  ? r.unit_school     : 'All';
      const uname  = UNIT_NAMES.includes(r.unit_name)      ? r.unit_name       : 'pcs';
      const cond   = CONDITIONS.includes(r.condition)      ? r.condition       : 'Good';
      const itype  = ['used-up','borrow'].includes(r.item_type) ? r.item_type  : 'used-up';

      if (myLocation && loc !== myLocation) { errors.push(`Row ${rowNum}: outside your assigned store location.`); return; }
      if (myCategory && cat !== myCategory) { errors.push(`Row ${rowNum}: outside your assigned store category.`); return; }

      const result = insert.run(
        r.name.trim(), r.code?.trim() || null, r.category,
        cat, loc, unit, qty, maxQty, uname, minThr, cond,
        r.description?.trim() || null, r.barcode?.trim() || null, itype, r.subtitle?.trim() || null
      );
      result.changes ? imported++ : skipped++;
    });
  });

  run();
  res.json({ imported, skipped, errors });
});

// DELETE /api/items/:id
router.delete('/:id', staffOnly, (req, res) => {
  const item = db.prepare('SELECT id, location, store_category FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  // Storekeeper location + category restriction
  if (req.user?.role === 'Storekeeper') {
    const myLocation = storekeeperLocation(req.user);
    if (myLocation && item.location !== myLocation) {
      return res.status(403).json({ error: 'You can only delete items in your assigned store.' });
    }
    const myCategory = storekeeperCategory(req.user);
    if (myCategory && item.store_category !== myCategory) {
      return res.status(403).json({ error: 'You can only delete items in your assigned store category.' });
    }
  }

  const open = db.prepare(`SELECT COUNT(*) AS cnt FROM requests WHERE item_id=? AND status IN ('pending','approved')`).get(req.params.id);
  if (open.cnt > 0) return res.status(409).json({ error: 'This item has pending or active requests. Resolve them first.' });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM requests WHERE item_id=?').run(req.params.id);
    db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.status(204).end();
});

module.exports = router;

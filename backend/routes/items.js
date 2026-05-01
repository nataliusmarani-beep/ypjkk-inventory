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

function validate(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Name is required.');
  if (!body.category) errors.push('Category is required.');
  if (body.quantity === undefined || body.quantity < 0) errors.push('Quantity must be >= 0.');
  if (body.min_threshold === undefined || body.min_threshold < 1) errors.push('Min threshold must be >= 1.');
  return errors;
}

// GET /api/items
router.get('/', (req, res) => {
  const { search, category, store_category, location, unit_school, status } = req.query;

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
      (? IS NULL OR LOWER(name) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(code,'')) LIKE '%' || LOWER(?) || '%')
      AND (? IS NULL OR category = ?)
      AND (? IS NULL OR store_category = ?)
      AND (? IS NULL OR location = ?)
      AND (? IS NULL OR unit_school = ? OR unit_school = 'All')
      AND (? IS NULL OR status = ?)
    ORDER BY name ASC
  `).all(
    search||null, search||null, search||null,
    category||null, category||null,
    store_category||null, store_category||null,
    location||null, location||null,
    unit_school||null, unit_school||null,
    status||null, status||null,
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
router.post('/', (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const { name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon } = req.body;
  const result = db.prepare(`
    INSERT INTO items (name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    name.trim(), code||null, category, store_category, location, unit_school,
    quantity, max_quantity||quantity, unit_name||'pcs', description||null, min_threshold, condition||'Good', icon||null
  );

  const item = db.prepare('SELECT * FROM items WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PUT /api/items/:id
router.put('/:id', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const { name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, description, min_threshold, condition, icon } = req.body;
  db.prepare(`
    UPDATE items SET name=?,code=?,category=?,store_category=?,location=?,unit_school=?,quantity=?,max_quantity=?,unit_name=?,description=?,min_threshold=?,condition=?,icon=?,updated_at=datetime('now')
    WHERE id=?
  `).run(
    name.trim(), code||null, category, store_category, location, unit_school,
    quantity, max_quantity||quantity, unit_name||'pcs', description||null, min_threshold, condition||'Good', icon||null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT *, CASE WHEN quantity=0 THEN 'out_of_stock' WHEN quantity<min_threshold THEN 'low_stock' ELSE 'ok' END AS status
    FROM items WHERE id=?
  `).get(req.params.id);
  res.json(updated);
});

// POST /api/items/import
router.post('/import', (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No rows provided.' });
  if (rows.length > 500)
    return res.status(400).json({ error: 'Maximum 500 rows per import.' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO items
      (name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, min_threshold, condition, description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let imported = 0, skipped = 0;
  const errors = [];

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

      const result = insert.run(
        r.name.trim(), r.code?.trim() || null, r.category,
        cat, loc, unit, qty, maxQty, uname, minThr, cond,
        r.description?.trim() || null
      );
      result.changes ? imported++ : skipped++;
    });
  });

  run();
  res.json({ imported, skipped, errors });
});

// DELETE /api/items/:id
router.delete('/:id', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });

  const open = db.prepare(`SELECT COUNT(*) AS cnt FROM requests WHERE item_id=? AND status IN ('pending','approved')`).get(req.params.id);
  if (open.cnt > 0) return res.status(409).json({ error: 'This item has pending or active requests. Resolve them first.' });

  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;

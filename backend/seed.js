const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'database.sqlite'));
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

const items = [
  // ── Stationery (8 items) ──────────────────────────────────────────────────
  { code:'STN-001', name:'Kertas HVS A4 80gsm', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:120, max_quantity:200, unit_name:'rim',  min_threshold:10, condition:'Good', description:'Kertas print standar' },
  { code:'STN-002', name:'Pulpen Pilot G2 Hitam', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:85,  max_quantity:150, unit_name:'pcs',  min_threshold:15, condition:'Good', description:null },
  { code:'STN-003', name:'Pensil 2B Faber-Castell', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:200, max_quantity:300, unit_name:'pcs',  min_threshold:20, condition:'Good', description:'Untuk ujian siswa' },
  { code:'STN-004', name:'Penggaris Plastik 30cm', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:40,  max_quantity:80,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:null },
  { code:'STN-005', name:'Stapler Besar Joyko', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:8,   max_quantity:20,  unit_name:'pcs',  min_threshold:2,  condition:'Good', description:null },
  { code:'STN-006', name:'Isi Stapler No.10', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:30,  max_quantity:60,  unit_name:'pak',  min_threshold:5,  condition:'Good', description:null },
  { code:'STN-007', name:'Spidol Whiteboard Snowman', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:24,  max_quantity:60,  unit_name:'pcs',  min_threshold:8,  condition:'Good', description:'Hitam, merah, biru' },
  { code:'STN-008', name:'Amplop Cokelat Folio', category:'Stationery', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:5,   max_quantity:20,  unit_name:'pak',  min_threshold:2,  condition:'Good', description:null },

  // ── Housekeeping (6 items) ────────────────────────────────────────────────
  { code:'HK-001',  name:'Sabun Cuci Tangan Dettol', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:18,  max_quantity:40,  unit_name:'botol', min_threshold:4,  condition:'Good', description:'500ml pump bottle' },
  { code:'HK-002',  name:'Cairan Pembersih Lantai', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:10,  max_quantity:24,  unit_name:'botol', min_threshold:3,  condition:'Good', description:'SOS Pine 800ml' },
  { code:'HK-003',  name:'Sapu Ijuk', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:12,  max_quantity:20,  unit_name:'pcs',  min_threshold:3,  condition:'Good', description:null },
  { code:'HK-004',  name:'Kain Pel Microfiber', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:6,   max_quantity:15,  unit_name:'pcs',  min_threshold:2,  condition:'Fair', description:null },
  { code:'HK-005',  name:'Tempat Sampah 60L', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:15,  max_quantity:25,  unit_name:'buah', min_threshold:3,  condition:'Good', description:'Dengan tutup injak' },
  { code:'HK-006',  name:'Tisu Toilet Paseo', category:'Housekeeping', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:8,   max_quantity:30,  unit_name:'pak',  min_threshold:3,  condition:'Good', description:'12 roll per pak' },

  // ── Learning Tools (7 items) ───────────────────────────────────────────────
  { code:'LT-001',  name:'Globe Dunia Plastik 30cm', category:'Learning Tools', store_category:'Teacher Resources', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:4,   max_quantity:10,  unit_name:'pcs',  min_threshold:1,  condition:'Good', description:'Skala 1:40.000.000' },
  { code:'LT-002',  name:'Peta Dinding Indonesia', category:'Learning Tools', store_category:'Teacher Resources', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:6,   max_quantity:12,  unit_name:'buah', min_threshold:2,  condition:'Good', description:'Laminasi 120×80cm' },
  { code:'LT-003',  name:'Papan Tulis Kelas 120×80', category:'Learning Tools', store_category:'Teacher Resources', location:'SD SMP YPJ KK', unit_school:'All',  quantity:14,  max_quantity:20,  unit_name:'buah', min_threshold:3,  condition:'Good', description:'Whiteboard magnetic' },
  { code:'LT-004',  name:'Penghapus Whiteboard', category:'Learning Tools', store_category:'Teacher Resources', location:'SD SMP YPJ KK', unit_school:'All',  quantity:20,  max_quantity:40,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:null },
  { code:'LT-005',  name:'Kalkulator Casio fx-991', category:'Learning Tools', store_category:'Teacher Resources', location:'SD SMP YPJ KK', unit_school:'SMP', quantity:30,  max_quantity:40,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:'Scientific calculator' },
  { code:'LT-006',  name:'Buku Tulis 58 Lembar', category:'Learning Tools', store_category:'Supplies',          location:'SD SMP YPJ KK', unit_school:'All',  quantity:300, max_quantity:500, unit_name:'pcs',  min_threshold:30, condition:'Good', description:null },
  { code:'LT-007',  name:'Flash Card Alfabet PAUD', category:'Learning Tools', store_category:'Teacher Resources', location:'PAUD YPJ KK',  unit_school:'PAUD', quantity:10,  max_quantity:20,  unit_name:'set',  min_threshold:2,  condition:'Good', description:'26 kartu per set' },

  // ── Groceries (5 items) ───────────────────────────────────────────────────
  { code:'GR-001',  name:'Air Mineral Aqua 600ml', category:'Groceries', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:48,  max_quantity:120, unit_name:'botol', min_threshold:12, condition:'Good', description:'Untuk rapat dan tamu' },
  { code:'GR-002',  name:'Teh Celup Sosro 25s', category:'Groceries', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:20,  max_quantity:50,  unit_name:'pak',  min_threshold:4,  condition:'Good', description:null },
  { code:'GR-003',  name:'Gula Pasir 1kg', category:'Groceries', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:15,  max_quantity:30,  unit_name:'kg',   min_threshold:3,  condition:'Good', description:null },
  { code:'GR-004',  name:'Kopi Nescafe Sachet', category:'Groceries', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:5,   max_quantity:20,  unit_name:'pak',  min_threshold:2,  condition:'Good', description:'10 sachet per pak' },
  { code:'GR-005',  name:'Snack Rapat Assorted', category:'Groceries', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:3,   max_quantity:10,  unit_name:'pak',  min_threshold:2,  condition:'Good', description:'Untuk keperluan rapat' },

  // ── Art & Craft (6 items) ─────────────────────────────────────────────────
  { code:'AC-001',  name:'Cat Air Kenko 12 Warna', category:'Art & Craft', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:25,  max_quantity:50,  unit_name:'set',  min_threshold:5,  condition:'Good', description:null },
  { code:'AC-002',  name:'Krayon Faber 24 Warna', category:'Art & Craft', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:30,  max_quantity:60,  unit_name:'set',  min_threshold:6,  condition:'Good', description:null },
  { code:'AC-003',  name:'Gunting Kecil Anak-anak', category:'Art & Craft', store_category:'Supplies', location:'PAUD YPJ KK',  unit_school:'PAUD', quantity:20,  max_quantity:30,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:'Ujung tumpul aman' },
  { code:'AC-004',  name:'Lem Stick UHU 40g', category:'Art & Craft', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:40,  max_quantity:80,  unit_name:'pcs',  min_threshold:8,  condition:'Good', description:null },
  { code:'AC-005',  name:'Kertas Lipat Origami A5', category:'Art & Craft', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:15,  max_quantity:30,  unit_name:'pak',  min_threshold:3,  condition:'Good', description:'100 lembar per pak' },
  { code:'AC-006',  name:'Plastisin / Clay Warna', category:'Art & Craft', store_category:'Supplies', location:'PAUD YPJ KK',  unit_school:'PAUD', quantity:12,  max_quantity:24,  unit_name:'set',  min_threshold:3,  condition:'Good', description:'12 warna per set' },

  // ── Uniform (4 items) ─────────────────────────────────────────────────────
  { code:'UN-001',  name:'Baju Olahraga Sekolah S', category:'Uniform', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:10,  max_quantity:30,  unit_name:'pcs',  min_threshold:2,  condition:'Good', description:'Ukuran S (anak kelas 1-3)' },
  { code:'UN-002',  name:'Baju Olahraga Sekolah M', category:'Uniform', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'SD',  quantity:15,  max_quantity:30,  unit_name:'pcs',  min_threshold:3,  condition:'Good', description:'Ukuran M (anak kelas 4-6)' },
  { code:'UN-003',  name:'Baju Olahraga SMP L', category:'Uniform', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'SMP', quantity:12,  max_quantity:25,  unit_name:'pcs',  min_threshold:3,  condition:'Good', description:'Ukuran L' },
  { code:'UN-004',  name:'Topi Sekolah Putih', category:'Uniform', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'All',  quantity:20,  max_quantity:40,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:null },

  // ── Sport Equipment (6 items) ─────────────────────────────────────────────
  { code:'SP-001',  name:'Bola Sepak No.5', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'All',  quantity:5,   max_quantity:10,  unit_name:'buah', min_threshold:2,  condition:'Good', description:'Bola standar latihan' },
  { code:'SP-002',  name:'Bola Voli Mikasa', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'SMP', quantity:4,   max_quantity:8,   unit_name:'buah', min_threshold:1,  condition:'Good', description:null },
  { code:'SP-003',  name:'Net Voli Standar', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'SMP', quantity:2,   max_quantity:4,   unit_name:'buah', min_threshold:1,  condition:'Fair', description:null },
  { code:'SP-004',  name:'Cone / Marker Olahraga', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'All',  quantity:20,  max_quantity:30,  unit_name:'pcs',  min_threshold:5,  condition:'Good', description:'Tinggi 23cm, warna orange' },
  { code:'SP-005',  name:'Peluit Wasit', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'All',  quantity:6,   max_quantity:10,  unit_name:'pcs',  min_threshold:2,  condition:'Good', description:null },
  { code:'SP-006',  name:'Matras Senam 180×60cm', category:'Sport Equipment', store_category:'Sport & Uniform', location:'SD SMP YPJ KK', unit_school:'All',  quantity:4,   max_quantity:8,   unit_name:'buah', min_threshold:1,  condition:'Good', description:'Ketebalan 5cm' },

  // ── Tools (5 items) ───────────────────────────────────────────────────────
  { code:'TL-001',  name:'Obeng Set Philips + Minus', category:'Tools', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:3,   max_quantity:6,   unit_name:'set',  min_threshold:1,  condition:'Good', description:'12 pcs per set' },
  { code:'TL-002',  name:'Tang Kombinasi 8"', category:'Tools', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:2,   max_quantity:5,   unit_name:'pcs',  min_threshold:1,  condition:'Good', description:null },
  { code:'TL-003',  name:'Pita Ukur / Meteran 5m', category:'Tools', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:4,   max_quantity:8,   unit_name:'pcs',  min_threshold:1,  condition:'Good', description:null },
  { code:'TL-004',  name:'Kunci Pas Set 8-19mm', category:'Tools', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:2,   max_quantity:4,   unit_name:'set',  min_threshold:1,  condition:'Good', description:null },
  { code:'TL-005',  name:'Selotip Isolasi Hitam', category:'Tools', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:10,  max_quantity:20,  unit_name:'roll', min_threshold:2,  condition:'Good', description:'Isolasi listrik' },

  // ── Medical/First Aid (3 items) ───────────────────────────────────────────
  { code:'MD-001',  name:'Kotak P3K Lengkap', category:'Medical/First Aid', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:3,   max_quantity:6,   unit_name:'set',  min_threshold:1,  condition:'Good', description:'Isi lengkap standar' },
  { code:'MD-002',  name:'Plester Hansaplast Kotak', category:'Medical/First Aid', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:10,  max_quantity:20,  unit_name:'kotak',min_threshold:2,  condition:'Good', description:'100 plester per kotak' },
  { code:'MD-003',  name:'Alkohol 70% 100ml', category:'Medical/First Aid', store_category:'Supplies', location:'SD SMP YPJ KK', unit_school:'All',  quantity:8,   max_quantity:15,  unit_name:'botol', min_threshold:2,  condition:'Good', description:'Untuk sterilisasi luka' },
];

const stmt = db.prepare(`
  INSERT INTO items
    (name, code, category, store_category, location, unit_school, quantity, max_quantity, unit_name, min_threshold, condition, description)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Check existing names to avoid duplicates
const existing = new Set(
  db.prepare('SELECT name FROM items').all().map(r => r.name)
);

let inserted = 0;
let skipped  = 0;

db.exec('BEGIN');
try {
  for (const item of items) {
    if (existing.has(item.name)) { skipped++; continue; }
    stmt.run(
      item.name, item.code, item.category, item.store_category,
      item.location, item.unit_school, item.quantity, item.max_quantity,
      item.unit_name, item.min_threshold, item.condition, item.description ?? null
    );
    inserted++;
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Seed failed:', err.message);
  process.exit(1);
}

console.log(`Seed complete — ${inserted} inserted, ${skipped} skipped (already exist).`);

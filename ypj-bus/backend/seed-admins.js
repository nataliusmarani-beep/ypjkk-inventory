require('dotenv').config();
const bcrypt = require('bcryptjs');
const db     = require('./db');

// Creates the Transport Team accounts named in the rules document. Run once:
//   npm run seed:admins
// Optionally pass a starting password: node seed-admins.js "MyTempPass123"
// Each admin should change it after the first sign-in.

const password = process.argv[2] || 'ypjbus2025';

const ADMINS = [
  { name: 'Yoce Pallo',      email: 'ypallo@fmi.com',  role: 'transport_admin', phone: '082344447522' },
  { name: 'Natalius Marani', email: 'nmarani@fmi.com', role: 'super_admin',     phone: '081344337315' },
];

const hash = bcrypt.hashSync(password, 10);

for (const admin of ADMINS) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(admin.email);

  if (existing) {
    db.prepare(`
      UPDATE users SET name = ?, role = ?, is_active = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(admin.name, admin.role, existing.id);
    console.log(`[seed] Updated ${admin.email} (${admin.role}) — password unchanged.`);
  } else {
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role, phone_primary)
      VALUES (?, ?, ?, ?, ?)
    `).run(admin.name, admin.email, hash, admin.role, admin.phone);
    console.log(`[seed] Created ${admin.email} (${admin.role}) with password: ${password}`);
  }
}

console.log('[seed] Done. Change these passwords after the first sign-in.');

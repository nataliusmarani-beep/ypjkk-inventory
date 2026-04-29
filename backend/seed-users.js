require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'database.sqlite'));
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

// Ensure users table exists (in case db.js hasn't run yet)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    role           TEXT    NOT NULL DEFAULT 'Teacher',
    unit_school    TEXT    NOT NULL DEFAULT 'All',
    location       TEXT,
    store_category TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    password_hash  TEXT    NOT NULL,
    created_at     TEXT    DEFAULT (datetime('now'))
  )
`);

const DEFAULT_PASSWORD = 'YPJ2025';
const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

const users = [
  { name:'Abidin Nur Rahmat',                     email:'arahmat@fmi.com',    role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Abraham Stevanus Kakisina',              email:'astefanu@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Agus Riyono',                            email:'ariyono@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Alfian Nurhidayat',                      email:'anurhida1@fmi.com',  role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Ancelina Femi Theophilia Samber',        email:'asamber@fmi.com',    role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Angga Wayong Rumende',                   email:'arumende@fmi.com',   role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Ani Yoslinda Waromi',                    email:'awaromi4@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Anik Kusdaryati',                        email:'akusdary@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Antonius Bari',                          email:'abari@fmi.com',      role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Bayu Rinasmoko',                         email:'brinasmo@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'C.Ana Mukti Rahayu',                     email:'crahayu@fmi.com',    role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Damianus Muyapa',                        email:'dmuyapa@fmi.com',    role:'Storekeeper', unit_school:'All',  location:'SD SMP YPJ KK', store_category:'Supplies' },
  { name:'Denny Roy Paluruan',                     email:'dpalurua@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Devi Arieta Savianada',                  email:'dsaviana@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Dg Veronica Dian Purnamasari',           email:'dpurnama@fmi.com',   role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Dian Novitasari',                        email:'dnovitas@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Dorthi Relasari Simbolon',               email:'dsimbolo4@fmi.com',  role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Eem Dhine Hesrawati',                    email:'ehesrawa@fmi.com',   role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Elia Suwi',                              email:'esuwi@fmi.com',      role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Enik Wijiati',                           email:'ewijiati@fmi.com',   role:'Storekeeper', unit_school:'PAUD', location:'PAUD YPJ KK',  store_category:'Teacher Resources' },
  { name:'Enis Nana Nurdiyah',                     email:'enurdiya@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Evi Saptina',                            email:'esaptina@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Franky Anatoly Tumbol',                  email:'ftumbol@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Fransiskus Xaverius Rian Riantoro',      email:'friantor@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Hera Sombo',                             email:'hsombo@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Imam Taufik Hidayat',                    email:'ihidayat@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Irma Fransiska Dimara',                  email:'idimara1@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:"Is'adiyah Utami",                        email:'iutami@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Jeni Nelce Mansawan',                    email:'jnelcema@fmi.com',   role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Juni Nurhayati Henriany Tambunan',       email:'jtambuna@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Juniche Anggelique Tnunay',              email:'jtnunay@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Karina Ayu Inova',                       email:'kinova@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Kartika Rachma',                         email:'krachma@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Ken Anis Widiastuti',                    email:'kwidiast@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Kiki Patmala',                           email:'kpatmala@fmi.com',   role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Lamtiur Meilinda Sianturi',              email:'lsiantur@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Lany Rohmaniah',                         email:'lrohmani@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Linda Fatahan',                          email:'lfatahan@fmi.com',   role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Luluk Purwati',                          email:'lpurwati@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Lyli Mangande',                          email:'lmangand@fmi.com',   role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Mangapul Ade Saputra Silaen',            email:'msilaen@fmi.com',    role:'Storekeeper', unit_school:'SD',   location:'SD SMP YPJ KK', store_category:'Sport & Uniform' },
  { name:'Marci Pekei',                            email:'mpekei@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Maria Emmaculata E Wirastuti',           email:'mwirastu@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Maria Gabriella Jacadewa',               email:'mjacadew@fmi.com',   role:'Storekeeper', unit_school:'All',  location:'SD SMP YPJ KK', store_category:'Teacher Resources' },
  { name:'Maria Sandra Erari',                     email:'merari3@fmi.com',    role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Maria Tifany Yonasta',                   email:'myonasta@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Marissa Frischiella Sidabutar',          email:'msidabut1@fmi.com',  role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Markus Fluorinco Susanto Adhi',          email:'madhi@fmi.com',      role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Matelda Alfonsina Ibo',                  email:'mibo@fmi.com',       role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Mathelda Ohe',                           email:'mohe@fmi.com',       role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Meiske Jeanete Lydia Kalumata',          email:'mkalumat@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Merpani Nelwan Sisilia Adii',            email:'madii8@fmi.com',     role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Muhammad Nurhadi',                       email:'mnurhadi@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Muhammad Zulpahmi',                      email:'mzulpahm@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Natalius Fillep Marani',                 email:'nmarani@fmi.com',    role:'Manager',       unit_school:'All',  location:null,           store_category:null },
  { name:'Omih Oom Gobay',                         email:'ogobay@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Ora Et Labora Simarmata',                email:'oetlabor@fmi.com',   role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Petrick Richard H',                      email:'psiahaan1@fmi.com',  role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Sri Ajeng Sundawi',                      email:'ssundawi@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Sugeng Santoso',                         email:'ssantoso6@fmi.com',  role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Syane Ratar',                            email:'sratar@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Sylviana Yeblo',                         email:'syeblo@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Theresa Agnes Boki',                     email:'tboki@fmi.com',      role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Theresia Agapa',                         email:'tagapa@fmi.com',     role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Tomas Tresno Sutejo',                    email:'tsutejo@fmi.com',    role:'Storekeeper', unit_school:'All',  location:'PAUD YPJ KK',  store_category:'Supplies' },
  { name:'Vifyan Yenny Agnes Numberi',             email:'vnumberi@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Vini Quamilla',                          email:'vquamill@fmi.com',   role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Wakhida Oktobiana',                      email:'woktobia@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Yafet Tnunay',                           email:'ytnunay@fmi.com',    role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Yoce Pallo',                             email:'ypallo@fmi.com',     role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Yulin Beatrix Suebu',                    email:'ysuebu@fmi.com',     role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Yusak Degei',                            email:'ydegei9@fmi.com',    role:'Other',       unit_school:'All',  location:null,           store_category:null },
  { name:'Astari',                                 email:'aastari@fmi.com',    role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Firdaus',                                email:'firdaus@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Jahrawati',                              email:'jahrawat@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Kartini',                                email:'kkartini@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Maryadi',                                email:'maryadi@fmi.com',    role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Muslimah',                               email:'muslimah@fmi.com',   role:'Teacher',     unit_school:'PAUD', location:null,           store_category:null },
  { name:'Nursalim',                               email:'nursalim@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
  { name:'Yusriadi Adi',                           email:'yusriadi@fmi.com',   role:'Teacher',     unit_school:'SD',   location:null,           store_category:null },
  { name:'Yusriadi Yusriadi',                      email:'yyusriad@fmi.com',   role:'Teacher',     unit_school:'SMP',  location:null,           store_category:null },
];

const stmt = db.prepare(`
  INSERT OR IGNORE INTO users (name, email, role, unit_school, location, store_category, password_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let inserted = 0;
let skipped  = 0;
const existing = new Set(db.prepare('SELECT email FROM users').all().map(r => r.email));

db.exec('BEGIN');
try {
  for (const u of users) {
    if (existing.has(u.email)) { skipped++; continue; }
    stmt.run(u.name, u.email, u.role, u.unit_school, u.location, u.store_category, hash);
    inserted++;
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Seed failed:', err.message);
  process.exit(1);
}

console.log(`Users seeded — ${inserted} inserted, ${skipped} skipped.`);
console.log(`Default password for all accounts: ${DEFAULT_PASSWORD}`);

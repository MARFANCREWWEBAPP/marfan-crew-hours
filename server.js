
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();

// ---------- V55.2 PERSISTENT RECOVERY LOCK ----------
// En Railway, el Volume debe estar montado en /data.
// Esta versión fuerza DB y backups a /data para que las actualizaciones NO borren información.
const V552_DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR || '/data';
const V552_BACKUP_DIR = process.env.BACKUP_DIR || path.join(V552_DATA_DIR, 'backups');
const V552_LEGACY_BACKUP_DIRS = [
  path.join(__dirname, 'data', 'backups'),
  path.join(__dirname, 'backups'),
  '/app/data/backups'
];

function v552EnsurePersistentDirs() {
  try {
    fs.mkdirSync(V552_DATA_DIR, { recursive: true });
    fs.mkdirSync(V552_BACKUP_DIR, { recursive: true });
  } catch(e) {
    console.warn('V55.2 persistent dirs warning:', e.message);
  }
}

function v552IsPersistentMounted() {
  try {
    if (!fs.existsSync(V552_DATA_DIR)) return false;
    const test = path.join(V552_DATA_DIR, '.mch_persistent_test');
    fs.writeFileSync(test, String(Date.now()));
    fs.unlinkSync(test);
    return true;
  } catch(e) {
    return false;
  }
}

function v552MigrateLegacyBackups() {
  v552EnsurePersistentDirs();
  const migrated = [];
  for (const dir of V552_LEGACY_BACKUP_DIRS) {
    try {
      if (!fs.existsSync(dir) || path.resolve(dir) === path.resolve(V552_BACKUP_DIR)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const src = path.join(dir, f);
        const dst = path.join(V552_BACKUP_DIR, f);
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          migrated.push(f);
        }
      }
    } catch(e) {}
  }
  return migrated;
}

v552EnsurePersistentDirs();
v552MigrateLegacyBackups();


// V53_5_PERSISTENT_DATA_DIR
// Railway: conectar un Volume montado en /data para conservar DB y backups entre versiones.
const PERSISTENT_DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR || '/data';
const PERSISTENT_BACKUP_DIR = process.env.BACKUP_DIR || path.join(PERSISTENT_DATA_DIR, 'backups');
try {
  fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
  fs.mkdirSync(PERSISTENT_BACKUP_DIR, { recursive: true });
} catch(e) {
  console.warn('Persistent dirs warning', e.message);
}


const ADMIN_FIXED_EMAIL = 'admin@marfancrew.local';
const ADMIN_FIXED_PASSWORD = 'Admin1234*';

const PORT = process.env.PORT || 8080;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marfancrew.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Marfan2026*';

const HQ_ADDRESS = 'Calle Ciro Alegría 89, Málaga';
const HQ_LAT = 36.70282;
const HQ_LNG = -4.46655;
const KM_FREE_RADIUS = 22;
const KM_PRICE = 0.28;

const dbDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dbDir, 'marfan.db'));


class SimpleSessionStore extends session.Store {
  constructor() {
    super();
    this.sessions = new Map();
  }
  get(sid, callback) {
    const raw = this.sessions.get(sid);
    if (!raw) return callback(null, null);
    try {
      const data = JSON.parse(raw);
      if (data.cookie && data.cookie.expires && new Date(data.cookie.expires) <= new Date()) {
        this.sessions.delete(sid);
        return callback(null, null);
      }
      callback(null, data);
    } catch (err) {
      callback(err);
    }
  }
  set(sid, sessionData, callback) {
    try {
      this.sessions.set(sid, JSON.stringify(sessionData));
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }
  destroy(sid, callback) {
    this.sessions.delete(sid);
    callback && callback(null);
  }
}


app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ extended: true, limit: '80mb' }));
app.use(session({
  store: new SimpleSessionStore(),
  secret: process.env.SESSION_SECRET || 'marfan-v29-clean-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: 0 }));

// ---------- AUTH MIDDLEWARES ----------
function safeUser(user) {
  if (!user) return null;
  const copy = { ...user };
  delete copy.password_hash;
  return copy;
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administrador' });
  }
  next();
}

// ---------- DB HELPERS ----------
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}
function addColumn(table, columnDef) {
  const name = columnDef.split(/\s+/)[0];
  if (!hasColumn(table, name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  if (lat2 === null || lon2 === null || lat2 === undefined || lon2 === undefined || Number.isNaN(Number(lat2)) || Number.isNaN(Number(lon2))) {
    return { distance: 0, billable: 0, amount: 0 };
  }
  lat2 = Number(lat2);
  lon2 = Number(lon2);
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(R * c * 100) / 100;
  const billable = distance > KM_FREE_RADIUS ? Math.round((distance - KM_FREE_RADIUS) * 100) / 100 : 0;
  const amount = Math.round(billable * KM_PRICE * 100) / 100;
  return { distance, billable, amount };
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operario',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      photo TEXT DEFAULT '',
      services TEXT DEFAULT '',
      availability TEXT DEFAULT 'disponible',
      must_change_password INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      hourly_rate REAL DEFAULT 18.50,
      night_rate REAL DEFAULT 23.50,
      diet_price REAL DEFAULT 0,
      transport_price REAL DEFAULT 0,
      has_night INTEGER DEFAULT 1,
      has_diet INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      legal_name TEXT DEFAULT '',
      cif TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      billing_email TEXT DEFAULT '',
      production_email TEXT DEFAULT '',
      payment_terms TEXT DEFAULT '',
      due_days INTEGER DEFAULT 0,
      fixed_hour_discount REAL DEFAULT 0,
      percent_hour_discount REAL DEFAULT 0,
      discount_applies_night INTEGER DEFAULT 1,
      discount_applies_team_lead INTEGER DEFAULT 1,
      custom_km_price REAL DEFAULT NULL,
      custom_vat_percent REAL DEFAULT NULL,
      vip_level TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id INTEGER DEFAULT NULL,
      client TEXT DEFAULT '',
      client_contact TEXT DEFAULT '',
      client_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      google_maps_url TEXT DEFAULT '',
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      distance_km REAL DEFAULT 0,
      billable_km REAL DEFAULT 0,
      km_amount REAL DEFAULT 0,
      event_date TEXT NOT NULL,
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      hourly_rate REAL DEFAULT 18.50,
      night_rate REAL DEFAULT 23.50,
      has_night INTEGER DEFAULT 1,
      transport_price REAL DEFAULT 0,
      diet_price REAL DEFAULT 0,
      special_bonus REAL DEFAULT 0,
      staff_discount_percent REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      internal_notes TEXT DEFAULT '',
      status TEXT DEFAULT 'programado',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      service_role TEXT DEFAULT '',
      is_team_lead INTEGER DEFAULT 0,
      billable_hourly_rate REAL DEFAULT 18.50,
      billable_night_rate REAL DEFAULT 23.50,
      assignment_diet_price REAL DEFAULT 0,
      assignment_transport_price REAL DEFAULT 0,
      apply_night INTEGER DEFAULT 1,
      apply_diet INTEGER DEFAULT 1,
      planned_start TEXT DEFAULT '',
      planned_end TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      latitude TEXT DEFAULT '',
      longitude TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS event_delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      pdf_name TEXT NOT NULL,
      total_normal_hours REAL DEFAULT 0,
      total_night_hours REAL DEFAULT 0,
      staff_total REAL DEFAULT 0,
      transport_total REAL DEFAULT 0,
      diet_total REAL DEFAULT 0,
      km_total REAL DEFAULT 0,
      special_bonus REAL DEFAULT 0,
      staff_discount_percent REAL DEFAULT 0,
      staff_discount_amount REAL DEFAULT 0,
      client_fixed_discount REAL DEFAULT 0,
      client_percent_discount REAL DEFAULT 0,
      client_discount_amount REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      vat_percent REAL DEFAULT 21,
      vat_amount REAL DEFAULT 0,
      grand_total_vat REAL DEFAULT 0,
      client_signed INTEGER DEFAULT 0,
      client_name TEXT DEFAULT '',
      client_dni TEXT DEFAULT '',
      client_signature TEXT DEFAULT '',
      signed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations for existing Railway DB
  addColumn('users', 'services TEXT DEFAULT ""');
  addColumn('users', 'availability TEXT DEFAULT "disponible"');
  addColumn('events', 'client_id INTEGER DEFAULT NULL');
  addColumn('events', 'client_contact TEXT DEFAULT ""');
  addColumn('events', 'client_phone TEXT DEFAULT ""');
  addColumn('events', 'latitude REAL DEFAULT NULL');
  addColumn('events', 'longitude REAL DEFAULT NULL');
  addColumn('events', 'distance_km REAL DEFAULT 0');
  addColumn('events', 'billable_km REAL DEFAULT 0');
  addColumn('events', 'km_amount REAL DEFAULT 0');
  addColumn('events', 'special_bonus REAL DEFAULT 0');
  addColumn('events', 'staff_discount_percent REAL DEFAULT 0');
  addColumn('assignments', 'billable_night_rate REAL DEFAULT 23.50');
  addColumn('assignments', 'assignment_diet_price REAL DEFAULT 0');
  addColumn('assignments', 'assignment_transport_price REAL DEFAULT 0');
  addColumn('assignments', 'apply_night INTEGER DEFAULT 1');
  addColumn('assignments', 'apply_diet INTEGER DEFAULT 1');
  addColumn('event_delivery_notes', 'vat_percent REAL DEFAULT 21');
  addColumn('event_delivery_notes', 'vat_amount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'grand_total_vat REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'staff_discount_percent REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'staff_discount_amount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_fixed_discount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_percent_discount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_discount_amount REAL DEFAULT 0');

  seedRates();
  seedSettings();
  seedClients();
  seedAdmin();
  createDemoDataSafe();
}


function setDefaultSetting(key, value) {
  const exists = db.prepare('SELECT key FROM app_settings WHERE key=?').get(key);
  if (!exists) db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?)').run(key, String(value));
}

function seedSettings() {
  const defaults = {
    company_name: 'MARFAN CREW',
    company_legal_name: 'MARFAN CREW',
    company_cif: '',
    company_address: 'Calle Ciro Alegría 89, Málaga',
    company_email: 'admin@marfancrew.com',
    company_phone: '',
    vat_percent: '21',
    show_vat: '1',
    invoice_prefix: 'ALB-EVT',
    km_origin_address: 'Calle Ciro Alegría 89, Málaga',
    km_origin_lat: '36.70282',
    km_origin_lng: '-4.46655',
    km_free_radius: '22',
    km_price: '0.28',
    geo_check_radius_m: '300',
    night_start: '22:00',
    night_end: '07:00',
    default_hourly_rate: '18.50',
    default_night_rate: '23.50',
    default_diet_price: '15',
    early_clock_grace_minutes: '15',
    minimum_billable_hours: '4',
    pdf_footer: 'Documento generado por Marfan Crew Hours.',
    dashboard_goal_monthly: '0',
    dashboard_goal_annual: '0',
    allow_operator_self_notes: '1',
    require_client_signature: '1',
    theme_mode: 'premium-dark'
  };
  for (const [k,v] of Object.entries(defaults)) setDefaultSetting(k,v);
}

function getSettings() {
  const rows = db.prepare('SELECT key,value FROM app_settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function numberSetting(settings, key, fallback) {
  const n = Number(settings[key]);
  return Number.isFinite(n) ? n : fallback;
}

function boolSetting(settings, key, fallback=true) {
  if (settings[key] === undefined) return fallback;
  return settings[key] === '1' || settings[key] === 'true' || settings[key] === true;
}



function seedClients() {
  const count = db.prepare('SELECT COUNT(*) c FROM clients').get().c;
  if (count > 0) return;
  const demo = [
    ['Málaga Forum S.L.','Málaga Forum S.L.','B00000000','Responsable Demo','600222000','demo@cliente.com','Málaga','Cliente demo'],
    ['Ayuntamiento Demo','Ayuntamiento Demo','P0000000A','Área de Fiestas','600333000','ayto@demo.com','Cártama','Cliente demo']
  ];
  for (const c of demo) {
    db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes) VALUES (?,?,?,?,?,?,?,?)`).run(...c);
  }
}


function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (email, password_hash, role, first_name, last_name, nickname)
      VALUES (?, ?, 'admin', 'Administrador', 'Marfan Crew', 'Admin')
    `).run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  }
}

function seedRates() {
  const rates = [
    ['Carga/Descarga',18.50,23.50,15,0,1,1],
    ['Auxiliar de montaje',18.50,23.50,15,0,1,1],
    ['Stagehand',18.50,23.50,15,0,1,1],
    ['Jefe de equipo',24.00,30.00,15,0,1,1],
    ['Runner',19.50,25.00,15,0,1,1],
    ['Carretillero',22.00,28.00,15,0,1,1],
    ['Operador plataforma elevadora',23.00,29.00,15,0,1,1],
    ['Rigger',26.00,33.00,15,0,1,1],
    ['Técnico sonido',24.00,30.00,15,0,1,1],
    ['Técnico iluminación',24.00,30.00,15,0,1,1],
    ['Técnico vídeo',24.00,30.00,15,0,1,1],
    ['LED technician',25.00,31.00,15,0,1,1],
    ['Backliner',23.00,29.00,15,0,1,1],
    ['Producción',25.00,31.00,15,0,1,1],
    ['Chofer',20.00,26.00,15,0,1,1],
    ['Electricista',25.00,31.00,15,0,1,1],
    ['Hospitality crew',18.50,23.50,15,0,1,1],
    ['Limpieza',18.50,23.50,15,0,1,1],
    ['Auxiliar de limpieza',18.50,23.50,15,0,1,1]
  ];

  for (const r of rates) {
    const existing = db.prepare('SELECT id FROM job_rates WHERE name=?').get(r[0]);
    if (!existing) {
      db.prepare(`
        INSERT INTO job_rates (name,hourly_rate,night_rate,diet_price,transport_price,has_night,has_diet)
        VALUES (?,?,?,?,?,?,?)
      `).run(...r);
    }
  }
}

function isoForShift(date, time, startRef='00:00') {
  const [h, m] = time.split(':').map(Number);
  const [sh, sm] = startRef.split(':').map(Number);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (h < sh || (h === sh && m < sm)) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

function seedDemo() {
  const count = db.prepare('SELECT COUNT(*) c FROM events').get().c;
  if (count > 0) return;

  const demoUsers = [
    ['oscar.demo@marfancrew.com','operario','Óscar','Martín Ruiz','Osky','600111001','Carga/Descarga,Stagehand','disponible'],
    ['omar.demo@marfancrew.com','operario','Omar','Benítez Lara','Omi','600111002','Stagehand,Rigger','disponible'],
    ['sol.demo@marfancrew.com','operario','Sol','García Vega','Sol','600111003','Técnico iluminación,LED technician','disponible'],
    ['jorge.demo@marfancrew.com','jefe','Jorge','Navarro Peña','Jota','600111004','Jefe de equipo,Producción','disponible'],
    ['pablo.demo@marfancrew.com','operario','Pablo','Romero Díaz','Pablete','600111005','Técnico sonido,Backliner','ocupado'],
    ['ivan.demo@marfancrew.com','operario','Iván','Morales Soto','Ivi','600111006','Runner,Chofer','disponible'],
    ['laura.demo@marfancrew.com','operario','Laura','López Mora','Lau','600111007','Limpieza,Auxiliar de limpieza','disponible']
  ];

  const ids = {};
  for (const u of demoUsers) {
    const existingUser = db.prepare('SELECT id FROM users WHERE email=?').get(u[0]);
    if (existingUser) {
      ids[u[4]] = existingUser.id;
      continue;
    }
    const info = db.prepare(`
      INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active)
      VALUES (?,?,?,?,?,?,?,?,?,1)
    `).run(u[0], bcrypt.hashSync('Demo1234*',10), u[1], u[2], u[3], u[4], u[5], u[6], u[7]);
    ids[u[4]] = info.lastInsertRowid;
  }

  const demoEvents = [
    ['Noche Festival Selvatic','Málaga Forum S.L.','Málaga Forum / Selvatic Fest','https://maps.google.com/?q=Málaga+Forum','2026-05-10','22:00','05:00',36.68420,-4.46240,1,'realizado'],
    ['Desmontaje Marbella Arena','Promotor Demo','Marbella Arena','https://maps.google.com/?q=Marbella+Arena','2026-05-15','22:00','05:00',36.50990,-4.88580,1,'realizado'],
    ['Montaje Corporate FYCMA','OPPLUS / FYCMA','FYCMA Málaga','https://maps.google.com/?q=FYCMA+Málaga','2026-05-20','08:00','18:00',36.70430,-4.46010,0,'realizado'],
    ['Evento programado Cártama','Ayuntamiento Demo','Cártama Estación','https://maps.google.com/?q=Cártama+Estación','2026-06-05','18:00','02:00',36.73520,-4.63220,1,'programado']
  ];

  const eventIds = [];
  for (const e of demoEvents) {
    const km = haversine(HQ_LAT, HQ_LNG, e[7], e[8]);
    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(e[0], null, e[1], 'Responsable Demo', '600222000', e[2], e[3], e[7], e[8], km.distance, km.billable, km.amount, e[4], e[5], e[6], 18.50, 23.50, e[9], 0, 15, 0, 0, 'Evento demo V18', 'Demo', e[10]);
    eventIds.push(info.lastInsertRowid);
  }

  function rate(name) {
    return db.prepare('SELECT * FROM job_rates WHERE name=?').get(name) || { hourly_rate:18.5, night_rate:23.5, diet_price:15, transport_price:0, has_night:1, has_diet:1 };
  }

  const assignments = [
    [eventIds[0], ids['Jota'], 'Jefe de equipo', 1, '22:00','05:00'],
    [eventIds[0], ids['Omi'], 'Stagehand', 0, '22:00','05:00'],
    [eventIds[0], ids['Sol'], 'Técnico iluminación', 0, '22:00','05:00'],
    [eventIds[0], ids['Lau'], 'Limpieza', 0, '01:00','05:00'],
    [eventIds[1], ids['Jota'], 'Jefe de equipo', 1, '22:00','05:00'],
    [eventIds[1], ids['Osky'], 'Carga/Descarga', 0, '22:00','05:15'],
    [eventIds[1], ids['Pablete'], 'Técnico sonido', 0, '22:00','05:00'],
    [eventIds[1], ids['Ivi'], 'Runner', 0, '22:30','04:30'],
    [eventIds[2], ids['Jota'], 'Jefe de equipo', 1, '08:00','18:00'],
    [eventIds[2], ids['Osky'], 'Stagehand', 0, '08:00','18:00'],
    [eventIds[2], ids['Omi'], 'Carga/Descarga', 0, '08:30','18:00'],
    [eventIds[2], ids['Lau'], 'Auxiliar de limpieza', 0, '14:00','18:00'],
    [eventIds[3], ids['Jota'], 'Jefe de equipo', 1, '18:00','02:00'],
    [eventIds[3], ids['Osky'], 'Stagehand', 0, '18:00','02:00'],
    [eventIds[3], ids['Sol'], 'Técnico iluminación', 0, '18:00','02:00']
  ];

  for (const a of assignments) {
    const rr = rate(a[2]);
    db.prepare(`
      INSERT INTO assignments
      (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(a[0], a[1], a[2], a[3], rr.hourly_rate, rr.night_rate, rr.diet_price, rr.transport_price, rr.has_night, rr.has_diet, a[4], a[5]);
  }

  function log(eventId, userId, date, start, end, breakStart=null, breakEnd=null) {
    db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'entrada', isoForShift(date,start), '36.7213', '-4.4214');
    if (breakStart && breakEnd) {
      db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'inicio_descanso', isoForShift(date,breakStart,start), '36.7213', '-4.4214');
      db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'fin_descanso', isoForShift(date,breakEnd,start), '36.7213', '-4.4214');
    }
    db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'salida', isoForShift(date,end,start), '36.7213', '-4.4214');
  }

  log(eventIds[0], ids['Jota'], '2026-05-10', '22:00', '05:00');
  log(eventIds[0], ids['Omi'], '2026-05-10', '22:00', '05:00');
  log(eventIds[0], ids['Sol'], '2026-05-10', '22:30', '05:00');
  log(eventIds[0], ids['Lau'], '2026-05-10', '01:00', '05:00');
  log(eventIds[1], ids['Jota'], '2026-05-15', '22:00', '05:00');
  log(eventIds[1], ids['Osky'], '2026-05-15', '22:00', '05:15');
  log(eventIds[1], ids['Pablete'], '2026-05-15', '22:00', '05:00');
  log(eventIds[1], ids['Ivi'], '2026-05-15', '22:30', '04:30');
  log(eventIds[2], ids['Jota'], '2026-05-20', '08:00', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Osky'], '2026-05-20', '08:00', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Omi'], '2026-05-20', '08:30', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Lau'], '2026-05-20', '14:00', '18:00');

  generateEventDeliveryNote(eventIds[0], true);
  generateEventDeliveryNote(eventIds[1], true);
  generateEventDeliveryNote(eventIds[2], true);
}

// ---------- HOURS ----------
function overlapMs(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, end - start);
}

function nightMsBetween(start, end) {
  let total = 0;
  const cursor = new Date(start);
  cursor.setUTCHours(0,0,0,0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  for (let i = 0; i < 5; i++) {
    const nightStart = new Date(cursor);
    nightStart.setUTCHours(22,0,0,0);
    const nightEnd = new Date(cursor);
    nightEnd.setUTCDate(nightEnd.getUTCDate() + 1);
    nightEnd.setUTCHours(7,0,0,0);
    total += overlapMs(start, end, nightStart, nightEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

function calculateHoursDetailed(logs) {
  let totalMs = 0;
  let totalNightMs = 0;
  let current = null;
  let breakStart = null;
  let breaks = [];

  for (const log of logs) {
    const t = new Date(log.timestamp);

    if (log.type === 'entrada') {
      current = t;
      breaks = [];
    } else if (log.type === 'inicio_descanso') {
      breakStart = t;
    } else if (log.type === 'fin_descanso' && breakStart) {
      breaks.push([breakStart, t]);
      breakStart = null;
    } else if (log.type === 'salida' && current) {
      let segMs = t.getTime() - current.getTime();
      let segNight = nightMsBetween(current, t);

      for (const [bs, be] of breaks) {
        segMs -= overlapMs(current, t, bs, be);
        segNight -= nightMsBetween(bs, be);
      }

      totalMs += Math.max(0, segMs);
      totalNightMs += Math.max(0, segNight);
      current = null;
      breaks = [];
    }
  }

  const totalHours = Math.round(totalMs / 3600000 * 100) / 100;
  const nightHours = Math.round(totalNightMs / 3600000 * 100) / 100;
  const normalHours = Math.round(Math.max(0, totalHours - nightHours) * 100) / 100;
  return { totalHours, normalHours, nightHours };
}

function getEventLineItems(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return null;

  const settings = getSettings();
  const earlyGraceMinutes = numberSetting(settings, 'early_clock_grace_minutes', 15);
  const minimumHours = numberSetting(settings, 'minimum_billable_hours', 4);

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.email, u.phone
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(eventId);

  let totalNormal = 0;
  let totalNight = 0;
  let staffTotal = 0;
  let dietTotal = 0;
  let transportTotal = 0;
  const lines = [];

  for (const a of assignments) {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(eventId, a.user_id);

    const plannedStart = a.planned_start || event.start_time || '';
    const plannedEnd = a.planned_end || event.end_time || '';

    const win = calculateBillableWindow({
      logs,
      eventDate: event.event_date,
      plannedStart,
      plannedEnd,
      earlyGraceMinutes,
      minimumHours
    });

    const h = calculateNightNormalHoursFromWindow(win.start, win.end);

    const nightHours = a.apply_night ? h.nightHours : 0;
    const normalHours = a.apply_night ? h.normalHours : h.totalHours;

    const hourlyRate = Number(a.billable_hourly_rate || event.hourly_rate || 18.5);
    const nightRate = Number(a.billable_night_rate || event.night_rate || 23.5);
    const diet = a.apply_diet ? Number(a.assignment_diet_price || event.diet_price || 0) : 0;
    const transport = Number(a.assignment_transport_price || event.transport_price || 0);

    const lineStaffTotal = (normalHours * hourlyRate) + (nightHours * nightRate);
    const lineTotal = Math.round((lineStaffTotal + diet + transport) * 100) / 100;

    totalNormal += normalHours;
    totalNight += nightHours;
    staffTotal += lineStaffTotal;
    dietTotal += diet;
    transportTotal += transport;

    lines.push({
      assignment_id: a.id,
      user_id: a.user_id,
      name: `${a.first_name} ${a.last_name}`.trim(),
      nickname: a.nickname || '',
      service_role: a.service_role,
      planned_start: plannedStart,
      planned_end: plannedEnd,
      billable_start: win.start ? win.start.toISOString() : '',
      billable_end: win.end ? win.end.toISOString() : '',
      early_adjusted: win.earlyAdjusted ? 1 : 0,
      minimum_applied: win.minimumApplied ? 1 : 0,
      normal_hours: Math.round(normalHours * 100) / 100,
      night_hours: Math.round(nightHours * 100) / 100,
      total_hours: Math.round((normalHours + nightHours) * 100) / 100,
      hourly_rate: hourlyRate,
      night_rate: nightRate,
      diet,
      transport,
      line_total: lineTotal
    });
  }

  return {
    event,
    lines,
    totalNormal: Math.round(totalNormal * 100) / 100,
    totalNight: Math.round(totalNight * 100) / 100,
    staffTotal: Math.round(staffTotal * 100) / 100,
    dietTotal: Math.round(dietTotal * 100) / 100,
    transportTotal: Math.round(transportTotal * 100) / 100
  };
}


function minutesFromHHMM(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dateTimeFromLocalParts(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y,m,d] = String(dateStr).slice(0,10).split('-').map(Number);
  const [hh,mm] = String(timeStr).slice(0,5).split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return new Date(y, m-1, d, hh, mm, 0, 0);
}

function plannedEndDateTime(dateStr, startTime, endTime) {
  const start = dateTimeFromLocalParts(dateStr, startTime);
  const end = dateTimeFromLocalParts(dateStr, endTime);
  if (!end) return null;
  if (start && end <= start) end.setDate(end.getDate() + 1);
  return end;
}

function calculateBillableWindow({logs, eventDate, plannedStart, plannedEnd, earlyGraceMinutes, minimumHours}) {
  const entrada = logs.find(l => l.type === 'entrada');
  const salidaLogs = logs.filter(l => l.type === 'salida');
  const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;

  let start = entrada ? new Date(entrada.timestamp) : dateTimeFromLocalParts(eventDate, plannedStart);
  let end = salida ? new Date(salida.timestamp) : plannedEndDateTime(eventDate, plannedStart, plannedEnd);

  const plannedStartDt = dateTimeFromLocalParts(eventDate, plannedStart);
  const plannedEndDt = plannedEndDateTime(eventDate, plannedStart, plannedEnd);

  let adjustedStart = start;
  let adjustedEnd = end;
  let earlyAdjusted = false;
  let minimumApplied = false;

  if (start && plannedStartDt && start < plannedStartDt) {
    const diffMin = (plannedStartDt - start) / 60000;
    if (diffMin > Number(earlyGraceMinutes || 15)) {
      adjustedStart = plannedStartDt;
      earlyAdjusted = true;
    }
  }

  if (!adjustedStart && plannedStartDt) adjustedStart = plannedStartDt;
  if (!adjustedEnd && plannedEndDt) adjustedEnd = plannedEndDt;
  if (adjustedStart && adjustedEnd && adjustedEnd <= adjustedStart) {
    adjustedEnd = new Date(adjustedEnd.getTime());
    adjustedEnd.setDate(adjustedEnd.getDate() + 1);
  }

  let totalHours = 0;
  if (adjustedStart && adjustedEnd) {
    totalHours = Math.max(0, (adjustedEnd - adjustedStart) / 3600000);
  }

  if (totalHours > 0 && totalHours < Number(minimumHours || 4)) {
    adjustedEnd = new Date(adjustedStart.getTime() + Number(minimumHours || 4) * 3600000);
    totalHours = Number(minimumHours || 4);
    minimumApplied = true;
  }

  return { start: adjustedStart, end: adjustedEnd, totalHours, earlyAdjusted, minimumApplied };
}

function calculateNightNormalHoursFromWindow(start, end) {
  if (!start || !end || end <= start) return { normalHours: 0, nightHours: 0, totalHours: 0 };
  let normal = 0;
  let night = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + 15 * 60000, end.getTime()));
    const h = cursor.getHours();
    const isNight = h >= 22 || h < 7;
    const part = (next - cursor) / 3600000;
    if (isNight) night += part; else normal += part;
    cursor = next;
  }
  return {
    normalHours: Math.round(normal * 100) / 100,
    nightHours: Math.round(night * 100) / 100,
    totalHours: Math.round((normal + night) * 100) / 100
  };
}

function generateEventDeliveryNote(eventId, signed=false) {
  const data = getEventLineItems(eventId);
  if (!data) return null;

  const event = data.event;
  const settings = getSettings();
  const vatPercent = numberSetting(settings, 'vat_percent', 21);
  const kmTotal = Number(event.km_amount || 0);
  const special = Number(event.special_bonus || 0);
  const discountPercent = Number(event.staff_discount_percent || 0);
  const discountAmount = Math.round((data.staffTotal * discountPercent / 100) * 100) / 100;

  const client = event.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(event.client_id) : null;
  const clientFixedDiscount = Number(client && client.fixed_hour_discount || 0);
  const clientPercentDiscount = Number(client && client.percent_hour_discount || 0);

  let clientBaseHoursAmount = 0;
  let clientFixedDiscountAmount = 0;
  for (const line of data.lines) {
    const isTeamLead = String(line.service_role || '').toLowerCase().includes('jefe');
    const applyLead = !client || Number(client.discount_applies_team_lead) === 1 || !isTeamLead;
    if (!applyLead) continue;
    const normalPart = Number(line.normal_hours || 0) * Number(line.hourly_rate || 0);
    const nightPart = Number(client && client.discount_applies_night) === 1 ? Number(line.night_hours || 0) * Number(line.night_rate || 0) : 0;
    clientBaseHoursAmount += normalPart + nightPart;
    const fixedHours = Number(line.normal_hours || 0) + (Number(client && client.discount_applies_night) === 1 ? Number(line.night_hours || 0) : 0);
    clientFixedDiscountAmount += fixedHours * clientFixedDiscount;
  }
  const clientPercentDiscountAmount = clientBaseHoursAmount * clientPercentDiscount / 100;
  const clientDiscountAmount = Math.round((clientFixedDiscountAmount + clientPercentDiscountAmount) * 100) / 100;

  const staffAfterDiscount = Math.round((data.staffTotal - discountAmount - clientDiscountAmount) * 100) / 100;
  const grand = Math.round((staffAfterDiscount + data.dietTotal + data.transportTotal + kmTotal + special) * 100) / 100;
  const vatAmount = Math.round((grand * vatPercent / 100) * 100) / 100;
  const grandWithVat = Math.round((grand + vatAmount) * 100) / 100;
  const code = `ALB-EVT-${eventId}-${String(Date.now()).slice(-6)}`;
  const pdfName = `${code}-${event.name}.pdf`.replace(/[^a-z0-9-.]+/gi, '-');

  const existing = db.prepare('SELECT id FROM event_delivery_notes WHERE event_id=?').get(eventId);

  if (existing) {
    db.prepare(`
      UPDATE event_delivery_notes
      SET code=?, pdf_name=?, total_normal_hours=?, total_night_hours=?, staff_total=?, transport_total=?, diet_total=?, km_total=?, special_bonus=?, staff_discount_percent=?, staff_discount_amount=?, client_fixed_discount=?, client_percent_discount=?, client_discount_amount=?, grand_total=?, vat_percent=?, vat_amount=?, grand_total_vat=?, created_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(code, pdfName, data.totalNormal, data.totalNight, data.staffTotal, data.transportTotal, data.dietTotal, kmTotal, special, discountPercent, discountAmount, clientFixedDiscount, clientPercentDiscount, clientDiscountAmount, grand, vatPercent, vatAmount, grandWithVat, existing.id);
  } else {
    db.prepare(`
      INSERT INTO event_delivery_notes
      (event_id,code,pdf_name,total_normal_hours,total_night_hours,staff_total,transport_total,diet_total,km_total,special_bonus,staff_discount_percent,staff_discount_amount,client_fixed_discount,client_percent_discount,client_discount_amount,grand_total,vat_percent,vat_amount,grand_total_vat,client_signed,client_name,client_dni,signed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(eventId, code, pdfName, data.totalNormal, data.totalNight, data.staffTotal, data.transportTotal, data.dietTotal, kmTotal, special, discountPercent, discountAmount, clientFixedDiscount, clientPercentDiscount, clientDiscountAmount, grand, vatPercent, vatAmount, grandWithVat, signed ? 1 : 0, signed ? 'Cliente Demo Autorizado' : '', signed ? '00000000T' : '', signed ? new Date().toISOString() : '');
  }

  return { code, pdfName, grand };
}

function isNowInEventWindow(now, date, start, end) {
  if (!date || !start || !end) return false;
  const s = new Date(`${date}T${start}:00`);
  const e = new Date(`${date}T${end}:00`);
  if (e <= s) e.setDate(e.getDate() + 1);

  const open = new Date(s);
  open.setHours(open.getHours() - 2);
  const close = new Date(e);
  close.setHours(close.getHours() + 2);

  return now >= open && now <= close;
}




function ensureFixedAdminAccess() {
  try {
    if (typeof db === 'undefined') return;

    const bcryptLib = typeof bcrypt !== 'undefined' ? bcrypt : null;
    const fixedHash = bcryptLib ? bcryptLib.hashSync(ADMIN_FIXED_PASSWORD, 10) : ADMIN_FIXED_PASSWORD;

    const existing = db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)").get(ADMIN_FIXED_EMAIL);

    if (existing) {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const updates = [];
      const values = [];

      if (cols.includes('password_hash')) { updates.push('password_hash=?'); values.push(fixedHash); }
      if (cols.includes('password')) { updates.push('password=?'); values.push(ADMIN_FIXED_PASSWORD); }
      if (cols.includes('role')) { updates.push("role='admin'"); }
      if (cols.includes('active')) { updates.push('active=1'); }
      if (cols.includes('first_name')) { updates.push("first_name='Administrador'"); }
      if (cols.includes('last_name')) { updates.push("last_name='Marfan'"); }
      if (cols.includes('nickname')) { updates.push("nickname='ADMIN'"); }
      if (cols.includes('phone')) { updates.push("phone='600000000'"); }

      if (updates.length) {
        values.push(existing.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).run(...values);
      }
    } else {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const data = {};
      if (cols.includes('email')) data.email = ADMIN_FIXED_EMAIL;
      if (cols.includes('password_hash')) data.password_hash = fixedHash;
      if (cols.includes('password')) data.password = ADMIN_FIXED_PASSWORD;
      if (cols.includes('role')) data.role = 'admin';
      if (cols.includes('first_name')) data.first_name = 'Administrador';
      if (cols.includes('last_name')) data.last_name = 'Marfan';
      if (cols.includes('nickname')) data.nickname = 'ADMIN';
      if (cols.includes('phone')) data.phone = '600000000';
      if (cols.includes('active')) data.active = 1;

      const keys = Object.keys(data);
      const qs = keys.map(() => '?').join(',');
      db.prepare(`INSERT INTO users (${keys.join(',')}) VALUES (${qs})`).run(...keys.map(k => data[k]));
    }

    console.log('V52.2 fixed admin ready:', ADMIN_FIXED_EMAIL);
  } catch (e) {
    console.error('ensureFixedAdminAccess error', e);
  }
}


function v53EnsureUploadDir() {
  const dir = path.join(__dirname, 'public', 'uploads', 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function v53SaveBase64File(dataUrl, fileName='documento') {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return '';
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return '';
  const mime = m[1];
  const extMap = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
  };
  const ext = extMap[mime] || (String(fileName).split('.').pop() || 'bin');
  const safe = String(fileName || 'documento').replace(/[^a-z0-9._-]/gi,'_').slice(0,80);
  const finalName = `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`.endsWith('.'+ext) ? `${Date.now()}_${safe}` : `${Date.now()}_${safe}.${ext}`;
  const dir = v53EnsureUploadDir();
  fs.writeFileSync(path.join(dir, finalName), Buffer.from(m[2], 'base64'));
  return `/uploads/documents/${finalName}`;
}

function v53EnsureFinanceColumns() {
  try {
    addColumn('events', 'cost_staff REAL DEFAULT 0');
    addColumn('events', 'cost_social_security REAL DEFAULT 0');
    addColumn('events', 'cost_gestoria REAL DEFAULT 0');
    addColumn('events', 'cost_fixed REAL DEFAULT 0');
    addColumn('events', 'cost_transport REAL DEFAULT 0');
    addColumn('events', 'cost_taxi REAL DEFAULT 0');
    addColumn('events', 'cost_hotel REAL DEFAULT 0');
    addColumn('events', 'cost_extra_hours REAL DEFAULT 0');
    addColumn('events', 'cost_other REAL DEFAULT 0');
  } catch(e) {}
}

v53EnsureFinanceColumns();

function addDaysJS(dateStr, days) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + Number(days || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initAuditModules() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      phase TEXT DEFAULT 'montaje',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'normal',
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER DEFAULT NULL,
      severity TEXT DEFAULT 'media',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'abierta',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS worker_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT DEFAULT 'PRL',
      title TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      issue_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    addColumn('events', 'operational_status TEXT DEFAULT "borrador"');
    addColumn('events', 'required_workers INTEGER DEFAULT 0');
    addColumn('events', 'required_team_leads INTEGER DEFAULT 1');
    addColumn('events', 'payment_status TEXT DEFAULT "pendiente"');
    addColumn('events', 'estimated_external_cost REAL DEFAULT 0');
    addColumn('events', 'estimated_transport_cost REAL DEFAULT 0');
    addColumn('events', 'estimated_other_cost REAL DEFAULT 0');
    addColumn('users', 'availability TEXT DEFAULT "disponible"');
    addColumn('users', 'internal_hour_cost REAL DEFAULT 0');
    addColumn('users', 'internal_night_cost REAL DEFAULT 0');
  } catch(e) {}

  const taskCount = db.prepare('SELECT COUNT(*) c FROM production_tasks').get().c;
  if (!taskCount) {
    const event = db.prepare('SELECT id FROM events ORDER BY event_date DESC LIMIT 1').get();
    if (event) {
      const stmt = db.prepare('INSERT INTO production_tasks (event_id,phase,title,description,priority,completed) VALUES (?,?,?,?,?,?)');
      stmt.run(event.id,'carga','Carga de material','Verificar material, herramientas y EPIs','normal',0);
      stmt.run(event.id,'ruta','Salida hacia evento','Confirmar ruta, acceso y contacto en destino','normal',0);
      stmt.run(event.id,'montaje','Montaje técnico','Montaje según planning técnico','alta',0);
      stmt.run(event.id,'pruebas','Pruebas técnicas','Audio, iluminación, vídeo y comunicación','alta',0);
      stmt.run(event.id,'servicio','Servicio en directo','Equipo operativo durante evento','alta',0);
      stmt.run(event.id,'desmontaje','Desmontaje y carga','Recogida, inventario básico y carga','normal',0);
    }
  }

  const docCount = db.prepare('SELECT COUNT(*) c FROM worker_documents').get().c;
  if (!docCount) {
    const user = db.prepare("SELECT id FROM users WHERE role!='admin' ORDER BY id LIMIT 1").get();
    if (user) {
      db.prepare('INSERT INTO worker_documents (user_id,doc_type,title,issue_date,expiry_date,notes) VALUES (?,?,?,?,?,?)')
        .run(user.id,'PRL','PRL demo operario', localDateStrJS(), addDaysJS(localDateStrJS(), 25), 'Documento demo próximo a caducar');
    }
  }
}

function auditDocStatus(expiry) {
  if (!expiry) return 'sin_caducidad';
  const today = localDateStrJS();
  const diff = Math.ceil((new Date(expiry+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
  if (diff < 0) return 'caducado';
  if (diff <= 30) return 'proximo_caducar';
  return 'vigente';
}

function auditEventFinancial(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return null;

  let note = null;
  try { note = db.prepare('SELECT * FROM event_delivery_notes WHERE event_id=? ORDER BY created_at DESC LIMIT 1').get(eventId); } catch(e) {}

  let revenue = Number(note && note.grand_total || 0);
  if (!revenue) {
    try {
      const data = getEventLineItems(eventId);
      revenue = Number(data.staffTotal||0) + Number(data.dietTotal||0) + Number(data.transportTotal||0) + Number(event.km_amount||0) + Number(event.special_bonus||0);
    } catch(e) {
      revenue = 0;
    }
  }

  const assignments = db.prepare(`
    SELECT a.*, u.internal_hour_cost, u.internal_night_cost
    FROM assignments a
    LEFT JOIN users u ON u.id=a.user_id
    WHERE a.event_id=?
  `).all(eventId);

  let crewCost = 0;
  for (const a of assignments) {
    const start = a.planned_start || event.start_time || '';
    const end = a.planned_end || event.end_time || '';
    const h = Math.max(4, hoursBetween(start, end));
    const cost = Number(a.internal_hour_cost || event.hourly_rate || 18.5) * 0.65;
    crewCost += h * cost;
  }

  const totalCost = crewCost + Number(event.estimated_external_cost||0) + Number(event.estimated_transport_cost||0) + Number(event.estimated_other_cost||0);
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;
  return { event, revenue: round2(revenue), totalCost: round2(totalCost), profit: round2(profit), margin };
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
  let s = sh*60 + (sm||0);
  let e = eh*60 + (em||0);
  if (e <= s) e += 1440;
  return Math.round(((e-s)/60)*100)/100;
}

function round2(n) {
  return Math.round(Number(n||0)*100)/100;
}

initDb();
ensureFixedAdminAccess();
initAuditModules();


function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
function phoneVariants(value) {
  const n = normalizePhone(value);
  const variants = new Set([n]);
  if (n.startsWith('34') && n.length > 9) variants.add(n.slice(2));
  if (n.length === 9) variants.add('34' + n);
  return Array.from(variants).filter(Boolean);
}



function extractCoordsFromText(input) {
  if (!input) return null;
  let s = String(input).trim();
  try { s = decodeURIComponent(s); } catch(e) {}
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/,
    /\/place\/[^@]*@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      if (p.source.includes('!2d')) return { lat: Number(m[2]), lng: Number(m[1]), source: 'maps-url' };
      return { lat: Number(m[1]), lng: Number(m[2]), source: 'maps-url' };
    }
  }
  const loose = s.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if (loose) return { lat: Number(loose[1]), lng: Number(loose[2]), source: 'loose-coords' };
  return null;
}

async function resolveUrlText(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 MarfanCrewHours/33' }
    });
    const finalUrl = res.url || '';
    let text = '';
    try { text = await res.text(); } catch(e) {}
    clearTimeout(timeout);
    return finalUrl + '\n' + text.slice(0, 120000);
  } catch (err) {
    clearTimeout(timeout);
    return '';
  }
}

async function geocodeAddressOSM(address) {
  if (!address) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MarfanCrewHours/33 admin@marfancrew.com' }
    });
    const data = await res.json();
    clearTimeout(timeout);
    if (Array.isArray(data) && data[0]) {
      return { lat: Number(data[0].lat), lng: Number(data[0].lon), source: 'address-search', display_name: data[0].display_name };
    }
  } catch (err) {
    clearTimeout(timeout);
  }
  return null;
}


// ---------- API ROUTES ----------
app.get('/health', (req, res) => res.json({ ok: true, version: '53.3.0' }));


app.post('/api/geocode', requireAdmin, async (req, res) => {
  const mapsUrl = req.body.google_maps_url || req.body.url || '';
  const address = req.body.address || req.body.location || '';

  let coords = extractCoordsFromText(mapsUrl);
  if (coords) return res.json({ ok: true, ...coords });

  if (mapsUrl) {
    const resolved = await resolveUrlText(mapsUrl);
    coords = extractCoordsFromText(resolved);
    if (coords) return res.json({ ok: true, ...coords, resolved: true });
  }

  coords = await geocodeAddressOSM(address);
  if (coords) return res.json({ ok: true, ...coords });

  return res.status(404).json({
    error: 'No he podido detectar coordenadas. Prueba pegando una URL completa de Google Maps o escribe una dirección más concreta.'
  });
});


app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});


// ---------- V52.2 FIXED ADMIN LOGIN ----------
app.post('/api/login-fixed-admin-v52', (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_FIXED_EMAIL && password === ADMIN_FIXED_PASSWORD) {
    req.session.user = {
      id: 'fixed-admin',
      email: ADMIN_FIXED_EMAIL,
      role: 'admin',
      first_name: 'Administrador',
      last_name: 'Marfan',
      phone: '600000000'
    };
    return res.json({ ok: true, user: req.session.user });
  }
  return res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  req.session.user = safeUser(user);
  res.json({ ok: true, user: req.session.user });
});


app.post('/api/login-phone', (req, res) => {
  const phone = req.body.phone || '';
  const variants = phoneVariants(phone);
  if (!variants.length) return res.status(401).json({ error: 'Teléfono no válido' });

  const users = db.prepare("SELECT * FROM users WHERE active=1 AND role IN ('operario','jefe')").all();
  const user = users.find(u => variants.includes(normalizePhone(u.phone)));

  if (!user) {
    return res.status(401).json({ error: 'No hay ningún operario activo con ese teléfono' });
  }

  req.session.user = safeUser(user);
  res.json({ ok: true, user: req.session.user });
});


app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/forgot-password', (req, res) => {
  res.json({ ok: true, message: 'Solicitud registrada. Contacta con administración.' });
});

// Rates
app.get('/api/job-rates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM job_rates ORDER BY name').all());
});

app.post('/api/job-rates', requireAdmin, (req, res) => {
  const r = req.body;
  const info = db.prepare(`
    INSERT INTO job_rates (name,hourly_rate,night_rate,diet_price,transport_price,has_night,has_diet,active)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(r.name, Number(r.hourly_rate || 18.5), Number(r.night_rate || 23.5), Number(r.diet_price || 0), Number(r.transport_price || 0), r.has_night ? 1 : 0, r.has_diet ? 1 : 0, r.active ? 1 : 0);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/job-rates/:id', requireAdmin, (req, res) => {
  const r = req.body;
  db.prepare(`
    UPDATE job_rates SET name=?, hourly_rate=?, night_rate=?, diet_price=?, transport_price=?, has_night=?, has_diet=?, active=?
    WHERE id=?
  `).run(r.name, Number(r.hourly_rate || 18.5), Number(r.night_rate || 23.5), Number(r.diet_price || 0), Number(r.transport_price || 0), r.has_night ? 1 : 0, r.has_diet ? 1 : 0, r.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/job-rates/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE job_rates SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Users
app.get('/api/users', requireAuth, (req, res) => {
  if (req.session.user.role === 'admin') {
    return res.json(db.prepare('SELECT id,email,role,first_name,last_name,nickname,phone,photo,services,availability,must_change_password,active FROM users ORDER BY first_name,last_name').all());
  }
  res.json([req.session.user]);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const u = req.body;
  const info = db.prepare(`
    INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,photo,services,availability,must_change_password,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,1)
  `).run(u.email, bcrypt.hashSync(u.password || 'Marfan1234*', 10), u.role || 'operario', u.first_name || '', u.last_name || '', u.nickname || '', u.phone || '', u.photo || '', u.services || '', u.availability || 'disponible');
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const u = req.body;
  db.prepare(`
    UPDATE users SET email=?, role=?, first_name=?, last_name=?, nickname=?, phone=?, photo=?, services=?, availability=?, active=?
    WHERE id=?
  `).run(u.email, u.role, u.first_name, u.last_name, u.nickname, u.phone, u.photo, u.services || '', u.availability || 'disponible', u.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === Number(req.session.user.id)) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario administrador desde aquí' });
  }
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true, message: 'Usuario desactivado. Ya no podrá entrar en su zona de operario.' });
});

app.post('/api/users/:id/activate', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true, message: 'Usuario reactivado.' });
});

app.post('/api/users/:id/reset-password', requireAdmin, (req, res) => {
  const p = req.body.password || 'Marfan1234*';
  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(bcrypt.hashSync(p, 10), req.params.id);
  res.json({ ok: true, temporaryPassword: p });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(req.body.newPassword, 10), req.session.user.id);
  req.session.user.must_change_password = 0;
  res.json({ ok: true });
});

app.post('/api/upload-photo', requireAdmin, (req, res) => {
  const { dataUrl, filename } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Imagen no válida' });
  const ext = (dataUrl.match(/^data:image\/(\w+);base64,/) || [])[1] || 'png';
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const safe = `${Date.now()}-${(filename || 'foto').replace(/[^a-z0-9-_]/gi, '_')}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, safe), Buffer.from(b64, 'base64'));
  res.json({ ok: true, url: `/uploads/${safe}` });
});

// Events
app.get('/api/events', requireAuth, (req, res) => {
  let sql = 'SELECT * FROM events WHERE 1=1';
  const p = [];
  if (req.query.status) { sql += ' AND status=?'; p.push(req.query.status); }
  if (req.query.date_from) { sql += ' AND event_date>=?'; p.push(req.query.date_from); }
  if (req.query.date_to) { sql += ' AND event_date<=?'; p.push(req.query.date_to); }
  if (req.query.location) { sql += ' AND location LIKE ?'; p.push(`%${req.query.location}%`); }
  if (req.query.q) { sql += ' AND (name LIKE ? OR client LIKE ?)'; p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.session.user.role === 'operario') { sql += ' AND id IN (SELECT event_id FROM assignments WHERE user_id=?)'; p.push(req.session.user.id); }
  sql += ' ORDER BY event_date DESC, id DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/events/:id', requireAuth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(event);
});



app.post('/api/events', requireAdmin, (req, res) => {
  try {
    const e = req.body || {};
    if (!e.name) return res.status(400).json({ error: 'Falta el nombre del evento' });
    if (!e.event_date) return res.status(400).json({ error: 'Falta la fecha del evento' });

    const lat = e.latitude === '' || e.latitude === undefined ? null : Number(e.latitude);
    const lng = e.longitude === '' || e.longitude === undefined ? null : Number(e.longitude);
    const km = haversine(HQ_LAT, HQ_LNG, lat, lng);

    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,staff_discount_percent,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      e.name || '',
      e.client_id || null,
      e.client || '',
      e.client_contact || '',
      e.client_phone || '',
      e.location || '',
      e.google_maps_url || '',
      lat,
      lng,
      km.distance,
      km.billable,
      km.amount,
      e.event_date,
      e.start_time || '',
      e.end_time || '',
      Number(e.hourly_rate || 18.5),
      Number(e.night_rate || 23.5),
      e.has_night ? 1 : 0,
      Number(e.transport_price || 0),
      Number(e.diet_price || 0),
      Number(e.special_bonus || 0),
      Number(e.staff_discount_percent || 0),
      e.notes || '',
      e.internal_notes || '',
      e.status || 'programado'
    );

    const eventId = info.lastInsertRowid;

    if (Array.isArray(e.assignments)) {
      for (const a of e.assignments) {
        if (!a.user_id) continue;
        db.prepare(`
          INSERT INTO assignments
          (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          eventId,
          a.user_id,
          a.service_role || '',
          a.is_team_lead ? 1 : 0,
          Number(a.billable_hourly_rate || 18.5),
          Number(a.billable_night_rate || 23.5),
          Number(a.assignment_diet_price || 0),
          Number(a.assignment_transport_price || 0),
          a.apply_night ? 1 : 0,
          a.apply_diet ? 1 : 0,
          a.planned_start || e.start_time || '',
          a.planned_end || e.end_time || ''
        );
      }
    }

    res.json({ ok: true, id: eventId });
  } catch (err) {
    console.error('CREATE_EVENT_ERROR', err);
    res.status(500).json({ error: 'No se pudo guardar el evento: ' + err.message });
  }
});


app.put('/api/events/:id', requireAdmin, (req, res) => {
  try {
    const e = req.body || {};
    const eventId = req.params.id;
    if (!e.name) return res.status(400).json({ error: 'Falta el nombre del evento' });
    if (!e.event_date) return res.status(400).json({ error: 'Falta la fecha del evento' });

    const lat = e.latitude === '' || e.latitude === undefined ? null : Number(e.latitude);
    const lng = e.longitude === '' || e.longitude === undefined ? null : Number(e.longitude);
    const km = haversine(HQ_LAT, HQ_LNG, lat, lng);

    db.prepare(`
      UPDATE events
      SET name=?,client_id=?,client=?,client_contact=?,client_phone=?,location=?,google_maps_url=?,latitude=?,longitude=?,distance_km=?,billable_km=?,km_amount=?,event_date=?,start_time=?,end_time=?,hourly_rate=?,night_rate=?,has_night=?,transport_price=?,diet_price=?,special_bonus=?,staff_discount_percent=?,notes=?,internal_notes=?,status=?
      WHERE id=?
    `).run(
      e.name || '',
      e.client_id || null,
      e.client || '',
      e.client_contact || '',
      e.client_phone || '',
      e.location || '',
      e.google_maps_url || '',
      lat,
      lng,
      km.distance,
      km.billable,
      km.amount,
      e.event_date,
      e.start_time || '',
      e.end_time || '',
      Number(e.hourly_rate || 18.5),
      Number(e.night_rate || 23.5),
      e.has_night ? 1 : 0,
      Number(e.transport_price || 0),
      Number(e.diet_price || 0),
      Number(e.special_bonus || 0),
      Number(e.staff_discount_percent || 0),
      e.notes || '',
      e.internal_notes || '',
      e.status || 'programado',
      eventId
    );

    if (Array.isArray(e.assignments)) {
      for (const a of e.assignments) {
        if (!a.user_id) continue;
        if (a.assignment_id) {
          db.prepare(`
            UPDATE assignments
            SET user_id=?,service_role=?,is_team_lead=?,billable_hourly_rate=?,billable_night_rate=?,assignment_diet_price=?,assignment_transport_price=?,apply_night=?,apply_diet=?,planned_start=?,planned_end=?
            WHERE id=? AND event_id=?
          `).run(
            a.user_id,
            a.service_role || '',
            a.is_team_lead ? 1 : 0,
            Number(a.billable_hourly_rate || 18.5),
            Number(a.billable_night_rate || 23.5),
            Number(a.assignment_diet_price || 0),
            Number(a.assignment_transport_price || 0),
            a.apply_night ? 1 : 0,
            a.apply_diet ? 1 : 0,
            a.planned_start || e.start_time || '',
            a.planned_end || e.end_time || '',
            a.assignment_id,
            eventId
          );
        } else {
          db.prepare(`
            INSERT INTO assignments
            (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            eventId,
            a.user_id,
            a.service_role || '',
            a.is_team_lead ? 1 : 0,
            Number(a.billable_hourly_rate || 18.5),
            Number(a.billable_night_rate || 23.5),
            Number(a.assignment_diet_price || 0),
            Number(a.assignment_transport_price || 0),
            a.apply_night ? 1 : 0,
            a.apply_diet ? 1 : 0,
            a.planned_start || e.start_time || '',
            a.planned_end || e.end_time || ''
          );
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('UPDATE_EVENT_ERROR', err);
    res.status(500).json({ error: 'No se pudo actualizar el evento: ' + err.message });
  }
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM assignments WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM time_logs WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/events/:id/complete', requireAdmin, (req, res) => {
  db.prepare('UPDATE events SET status="realizado" WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});


app.get('/api/events/:id/my-assignment', requireAuth, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!assignment && req.session.user.role !== 'admin') {
    return res.status(404).json({ error: 'No asignado' });
  }
  res.json({ assignment: assignment || null });
});


app.get('/api/events/:id/assignments', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.email, u.phone, u.photo
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(req.params.id);
  res.json(rows);
});

app.delete('/api/assignments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Operator calendar / clock
app.get('/api/my-calendar', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, a.service_role, a.planned_start, a.planned_end, a.is_team_lead
    FROM events e
    JOIN assignments a ON a.event_id=e.id
    WHERE a.user_id=?
    ORDER BY e.event_date ASC
  `).all(req.session.user.id);
  res.json(rows);
});

app.get('/api/my-current-event', requireAuth, (req, res) => {
  const now = new Date();
  const rows = db.prepare(`
    SELECT e.*, a.service_role, a.planned_start, a.planned_end, a.is_team_lead
    FROM events e
    JOIN assignments a ON a.event_id=e.id
    WHERE a.user_id=? AND e.status!='realizado'
  `).all(req.session.user.id);
  const current = rows.find(e => isNowInEventWindow(now, e.event_date, e.planned_start || e.start_time, e.planned_end || e.end_time));
  res.json({ event: current || null });
});

app.post('/api/time-log', requireAuth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.body.event_id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(event.id, req.session.user.id);

  if (!assignment && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'No estás asignado a este evento' });
  }

  if (req.session.user.role !== 'admin') {
    const okWindow = isNowInEventWindow(new Date(), event.event_date, assignment.planned_start || event.start_time, assignment.planned_end || event.end_time);
    if (!okWindow) return res.status(403).json({ error: 'Solo puedes fichar en el evento activo de tu horario' });
  }

  db.prepare(`
    INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude,notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(event.id, req.session.user.id, req.body.type, new Date().toISOString(), req.body.latitude || '', req.body.longitude || '', req.body.notes || '');

  res.json({ ok: true });
});



app.get('/api/events/:id/client-sign-summary', requireAuth, (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(eventId, req.session.user.id);
  const isTeamLead = assignment && Number(assignment.is_team_lead) === 1;

  if (req.session.user.role !== 'admin' && !isTeamLead) {
    return res.status(403).json({ error: 'Solo administración o jefe de equipo puede ver la conformidad' });
  }

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(eventId);

  const workers = assignments.map(a => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(eventId, a.user_id);
    const entrada = logs.find(l => l.type === 'entrada') || null;
    const salidaLogs = logs.filter(l => l.type === 'salida');
    const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;
    return {
      user_id: a.user_id,
      name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      nickname: a.nickname || '',
      role: a.service_role || '',
      is_team_lead: Number(a.is_team_lead) === 1,
      planned_start: a.planned_start || event.start_time || '',
      planned_end: a.planned_end || event.end_time || '',
      entrada: entrada ? entrada.timestamp : '',
      salida: salida ? salida.timestamp : ''
    };
  });

  const entradas = workers.map(w => w.entrada).filter(Boolean).sort();
  const salidas = workers.map(w => w.salida).filter(Boolean).sort();
  const firstEntrada = entradas[0] || '';
  const lastSalida = salidas.length ? salidas[salidas.length - 1] : '';

  res.json({
    event,
    workers_count: workers.length,
    workers,
    entrada_general: firstEntrada,
    salida_general: lastSalida,
    planned_start: event.start_time || '',
    planned_end: event.end_time || ''
  });
});


app.post('/api/events/:id/client-sign', requireAuth, (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(eventId, req.session.user.id);
  const isTeamLead = assignment && Number(assignment.is_team_lead) === 1;

  if (req.session.user.role !== 'admin' && !isTeamLead) {
    return res.status(403).json({ error: 'Solo el jefe de equipo o administración puede firmar la conformidad del cliente' });
  }

  generateEventDeliveryNote(eventId, false);
  const note = db.prepare('SELECT id FROM event_delivery_notes WHERE event_id=?').get(eventId);
  if (!note) return res.status(500).json({ error: 'No se pudo generar el albarán del evento' });

  db.prepare(`
    UPDATE event_delivery_notes
    SET client_signed=1, client_name=?, client_dni=?, client_signature=?, signed_at=?
    WHERE id=?
  `).run(req.body.client_name || '', req.body.client_cif || req.body.client_dni || '', req.body.client_signature || '', new Date().toISOString(), note.id);

  res.json({ ok: true, note_id: note.id });
});


// Event delivery notes
app.post('/api/event-delivery-notes/generate', requireAuth, (req, res) => {
  const note = generateEventDeliveryNote(req.body.event_id, false);
  if (!note) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ ok: true, note });
});

app.get('/api/event-delivery-notes', requireAuth, (req, res) => {
  let sql = `
    SELECT dn.*, e.name event_name, e.client, e.location, e.event_date, e.distance_km, e.billable_km
    FROM event_delivery_notes dn
    JOIN events e ON e.id = dn.event_id
    WHERE 1=1
  `;
  const p = [];
  if (req.query.event_id) { sql += ' AND e.id=?'; p.push(req.query.event_id); }
  if (req.query.date_from) { sql += ' AND e.event_date>=?'; p.push(req.query.date_from); }
  if (req.query.date_to) { sql += ' AND e.event_date<=?'; p.push(req.query.date_to); }
  if (req.query.location) { sql += ' AND e.location LIKE ?'; p.push(`%${req.query.location}%`); }
  sql += ' ORDER BY e.event_date DESC, dn.created_at DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/event-delivery-notes/:id', requireAuth, (req, res) => {
  const note = db.prepare(`
    SELECT dn.*, e.*
    FROM event_delivery_notes dn
    JOIN events e ON e.id = dn.event_id
    WHERE dn.id=?
  `).get(req.params.id);

  if (!note) return res.status(404).json({ error: 'No encontrado' });

  const data = getEventLineItems(note.event_id);
  const settings = getSettings();
  res.json({
    ...note,
    lines: data ? data.lines : [],
    hq_address: settings.km_origin_address || HQ_ADDRESS,
    km_price: Number(settings.km_price || KM_PRICE),
    km_free_radius: Number(settings.km_free_radius || KM_FREE_RADIUS),
    settings
  });
});

app.post('/api/event-delivery-notes/:id/client-sign', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE event_delivery_notes
    SET client_signed=1, client_name=?, client_dni=?, client_signature=?, signed_at=?
    WHERE id=?
  `).run(req.body.client_name || '', req.body.client_dni || '', req.body.client_signature || '', new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});



// Clients
app.get('/api/clients', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients WHERE active=1 ORDER BY name').all());
});

app.post('/api/clients', requireAdmin, (req, res) => {
  const c = req.body || {};
  const info = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,billing_email,production_email,payment_terms,due_days,fixed_hour_discount,percent_hour_discount,discount_applies_night,discount_applies_team_lead,custom_km_price,custom_vat_percent,vip_level,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.name||'', c.legal_name||'', c.cif||'', c.contact||'', c.phone||'', c.email||'', c.address||'', c.notes||'', c.billing_email||'', c.production_email||'', c.payment_terms||'', Number(c.due_days||0), Number(c.fixed_hour_discount||0), Number(c.percent_hour_discount||0), c.discount_applies_night ? 1 : 0, c.discount_applies_team_lead ? 1 : 0, c.custom_km_price || null, c.custom_vat_percent || null, c.vip_level||'', c.active===0?0:1);
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.put('/api/clients/:id', requireAdmin, (req, res) => {
  const c = req.body || {};
  db.prepare(`UPDATE clients SET name=?,legal_name=?,cif=?,contact=?,phone=?,email=?,address=?,notes=?,billing_email=?,production_email=?,payment_terms=?,due_days=?,fixed_hour_discount=?,percent_hour_discount=?,discount_applies_night=?,discount_applies_team_lead=?,custom_km_price=?,custom_vat_percent=?,vip_level=?,active=? WHERE id=?`)
    .run(c.name||'', c.legal_name||'', c.cif||'', c.contact||'', c.phone||'', c.email||'', c.address||'', c.notes||'', c.billing_email||'', c.production_email||'', c.payment_terms||'', Number(c.due_days||0), Number(c.fixed_hour_discount||0), Number(c.percent_hour_discount||0), c.discount_applies_night ? 1 : 0, c.discount_applies_team_lead ? 1 : 0, c.custom_km_price || null, c.custom_vat_percent || null, c.vip_level||'', c.active===0?0:1, req.params.id);
  res.json({ ok:true });
});


app.get('/api/clients/all', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY active DESC, name').all());
});

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok:true });
});


app.post('/api/import/clients', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let imported = 0;
  const stmt = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,active) VALUES (?,?,?,?,?,?,?,?,1)`);
  for (const r of rows) {
    const name = r.name || r.nombre || r.cliente || r.Cliente || r.Nombre;
    if (!name) continue;
    stmt.run(
      String(name||''),
      String(r.legal_name || r.razon_social || r['razon social'] || r.RazonSocial || ''),
      String(r.cif || r.CIF || r.nif || r.NIF || ''),
      String(r.contact || r.contacto || r.Contacto || ''),
      String(r.phone || r.telefono || r.teléfono || r.Telefono || ''),
      String(r.email || r.mail || r.Email || ''),
      String(r.address || r.direccion || r.dirección || r.Direccion || ''),
      String(r.notes || r.notas || r.Notas || '')
    );
    imported++;
  }
  res.json({ ok:true, imported });
});

app.post('/api/import/users', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let imported = 0;
  const stmt = db.prepare(`INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active) VALUES (?,?,?,?,?,?,?,?,?,1)`);
  for (const r of rows) {
    const phone = String(r.phone || r.telefono || r.teléfono || r.Telefono || '').trim();
    const email = String(r.email || r.mail || r.Email || (phone ? phone+'@marfancrew.local' : '')).trim();
    const first = String(r.first_name || r.nombre || r.Nombre || '').trim();
    const last = String(r.last_name || r.apellidos || r.Apellidos || '').trim();
    if (!phone && !email) continue;
    try {
      stmt.run(
        email,
        bcrypt.hashSync(String(r.password || 'Marfan1234*'), 10),
        String(r.role || r.rol || r.Rol || 'operario').toLowerCase().includes('jefe') ? 'jefe' : 'operario',
        first,
        last,
        String(r.nickname || r.mote || r.Mote || ''),
        phone,
        String(r.services || r.servicios || r.Servicios || ''),
        String(r.availability || r.disponibilidad || r.Disponibilidad || 'disponible')
      );
      imported++;
    } catch(e) {}
  }
  res.json({ ok:true, imported });
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  return headers.join(';') + '\n' + rows.map(r => headers.map(h => csvEscape(r[h])).join(';')).join('\n');
}
function backupData() {
  return {
    generated_at: new Date().toISOString(),
    clients: db.prepare('SELECT * FROM clients ORDER BY name').all(),
    users: db.prepare('SELECT id,email,role,first_name,last_name,nickname,phone,services,availability,active,created_at FROM users ORDER BY first_name').all(),
    pending_events: db.prepare("SELECT * FROM events WHERE status!='realizado' ORDER BY event_date").all(),
    completed_events: db.prepare("SELECT * FROM events WHERE status='realizado' ORDER BY event_date DESC").all(),
    assignments: db.prepare('SELECT * FROM assignments ORDER BY event_id').all(),
    time_logs: db.prepare('SELECT * FROM time_logs ORDER BY timestamp').all(),
    delivery_notes: db.prepare('SELECT * FROM event_delivery_notes ORDER BY created_at DESC').all(),
    job_rates: db.prepare('SELECT * FROM job_rates ORDER BY name').all(),
    settings: getSettings()
  };
}
app.get('/api/backup/all.json', requireAdmin, (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="marfan-backup-global.json"');
  res.send(JSON.stringify(backupData(), null, 2));
});
app.get('/api/backup/:type.csv', requireAdmin, (req, res) => {
  const data = backupData();
  const type = req.params.type;
  const map = {
    clients: data.clients,
    users: data.users,
    pending_events: data.pending_events,
    completed_events: data.completed_events,
    assignments: data.assignments,
    time_logs: data.time_logs,
    delivery_notes: data.delivery_notes,
    job_rates: data.job_rates
  };
  const rows = map[type];
  if (!rows) return res.status(404).send('Tipo no encontrado');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="marfan-${type}.csv"`);
  res.send(toCsv(rows));
});




function createDemoDataSafe() {
  const demoUsers = [
    ['demo.jefe@marfancrew.local','jefe','Carlos','Jefe Equipo','CJ','635371634','Jefe de equipo,Producción','disponible'],
    ['demo.operario1@marfancrew.local','operario','Miguel','Carga','Migue','600100001','Carga/Descarga,Stagehand','disponible'],
    ['demo.operario2@marfancrew.local','operario','Ana','Técnica','Ani','600100002','Técnico iluminación,LED technician','disponible'],
    ['demo.operario3@marfancrew.local','operario','Luis','Runner','Luis','600100003','Runner,Chofer','disponible'],
    ['demo.limpieza@marfancrew.local','operario','Marta','Limpieza','Marta','600100004','Limpieza,Auxiliar de limpieza','disponible']
  ];
  const ids = {};
  for (const u of demoUsers) {
    let existing = db.prepare('SELECT id FROM users WHERE email=?').get(u[0]);
    if (!existing) {
      const info = db.prepare(`
        INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active)
        VALUES (?,?,?,?,?,?,?,?,?,1)
      `).run(u[0], bcrypt.hashSync('Demo1234*',10), u[1], u[2], u[3], u[4], u[5], u[6], u[7]);
      ids[u[4]] = info.lastInsertRowid;
    } else {
      db.prepare('UPDATE users SET active=1, phone=?, role=?, first_name=?, last_name=?, nickname=?, services=?, availability=? WHERE id=?')
        .run(u[5], u[1], u[2], u[3], u[4], u[6], u[7], existing.id);
      ids[u[4]] = existing.id;
    }
  }

  let client = db.prepare('SELECT id FROM clients WHERE name=?').get('Cliente Demo Producción');
  if (!client) {
    const c = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,billing_email,production_email,payment_terms,due_days,fixed_hour_discount,percent_hour_discount,discount_applies_night,discount_applies_team_lead,vip_level,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run('Cliente Demo Producción','Cliente Demo Producción S.L.','B12345678','Responsable Demo','600222000','cliente@demo.com','Málaga','Cliente demo creado desde V35','facturacion@demo.com','produccion@demo.com','Transferencia 30 días',30,1.50,3,1,1,'VIP');
    client = { id: c.lastInsertRowid };
  }

  const today = localDateStrJS();
  const tomorrowDate = localDateStrJS(new Date(Date.now()+86400000));
  const demoEvents = [
    ['Demo Montaje Hoy','Cliente Demo Producción','Palacio de Ferias Málaga','https://www.google.com/maps?q=36.7043,-4.4601',today,'09:00','18:00',36.7043,-4.4601,'programado'],
    ['Demo Noche 22 a 05','Cliente Demo Producción','Málaga Centro','https://www.google.com/maps?q=36.7213,-4.4214',today,'22:00','05:00',36.7213,-4.4214,'programado'],
    ['Demo Evento Realizado','Cliente Demo Producción','Marbella Arena','https://www.google.com/maps?q=36.5099,-4.8858','2026-05-15','22:00','05:00',36.5099,-4.8858,'realizado'],
    ['Demo Evento Cancelado','Cliente Demo Producción','Cártama Estación','https://www.google.com/maps?q=36.7352,-4.6322',tomorrowDate,'18:00','02:00',36.7352,-4.6322,'cancelado']
  ];

  let createdEvents = 0;
  for (const e of demoEvents) {
    let existingEvent = db.prepare('SELECT id FROM events WHERE name=? AND event_date=?').get(e[0], e[4]);
    if (existingEvent) continue;
    const km = haversine(HQ_LAT, HQ_LNG, e[7], e[8]);
    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,staff_discount_percent,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(e[0], client.id, e[1], 'Responsable Demo', '600222000', e[2], e[3], e[7], e[8], km.distance, km.billable, km.amount, e[4], e[5], e[6], 18.5, 23.5, 1, 0, 15, 0, 3, 'Evento demo V33', 'Demo creado manualmente', e[9]);
    const eventId = info.lastInsertRowid;
    createdEvents++;

    const assignments = [
      [ids['CJ'], 'Jefe de equipo', 1, e[5], e[6]],
      [ids['Migue'], 'Carga/Descarga', 0, e[5], e[6]],
      [ids['Ani'], 'Técnico iluminación', 0, e[5], e[6]],
      [ids['Luis'], 'Runner', 0, e[5], e[6]],
      [ids['Marta'], 'Limpieza', 0, e[5], e[6]]
    ];
    for (const a of assignments) {
      const rr = db.prepare('SELECT * FROM job_rates WHERE name=?').get(a[1]) || { hourly_rate:18.5, night_rate:23.5, diet_price:15, transport_price:0, has_night:1, has_diet:1 };
      db.prepare(`
        INSERT INTO assignments (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(eventId, a[0], a[1], a[2], rr.hourly_rate, rr.night_rate, rr.diet_price, rr.transport_price, rr.has_night, rr.has_diet, a[3], a[4]);
    }

    if (e[9] === 'realizado') {
      const users = assignments.map(x=>x[0]);
      for (const uid of users) {
        db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, uid, 'entrada', new Date(`${e[4]}T22:00:00`).toISOString(), e[7], e[8]);
        db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, uid, 'salida', new Date(new Date(`${e[4]}T22:00:00`).getTime()+7*3600000).toISOString(), e[7], e[8]);
      }
      generateEventDeliveryNote(eventId, true);
    }
  }
  return { createdEvents, users: demoUsers.length };
}

app.post('/api/demo/create', requireAdmin, (req, res) => {
  try {
    const result = createDemoDataSafe();
    res.json({ ok:true, ...result });
  } catch (err) {
    console.error('DEMO_CREATE_ERROR', err);
    res.status(500).json({ error: err.message });
  }
});


// Admin daily control
app.get('/api/admin/daily-control', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);

  const rows = db.prepare(`
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.client,
      e.location,
      e.latitude AS event_latitude,
      e.longitude AS event_longitude,
      e.event_date,
      e.start_time,
      e.end_time,
      e.status,
      a.id AS assignment_id,
      a.user_id,
      a.service_role,
      a.is_team_lead,
      a.planned_start,
      a.planned_end,
      u.first_name,
      u.last_name,
      u.nickname,
      u.phone,
      u.email
    FROM assignments a
    JOIN events e ON e.id = a.event_id
    JOIN users u ON u.id = a.user_id
    WHERE e.event_date = ?
    ORDER BY e.start_time, e.name, a.is_team_lead DESC, u.first_name
  `).all(date);

  const out = rows.map(r => {
    const logs = db.prepare(`
      SELECT * FROM time_logs
      WHERE event_id=? AND user_id=?
      ORDER BY timestamp
    `).all(r.event_id, r.user_id);

    const entrada = logs.find(l => l.type === 'entrada') || null;
    const salidaLogs = logs.filter(l => l.type === 'salida');
    const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;
    const lastLog = logs.length ? logs[logs.length - 1] : null;

    const status = salida ? 'salida_fichada' : entrada ? 'en_evento' : 'pendiente';

    return {
      ...r,
      worker_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      logs,
      entrada,
      salida,
      last_log: lastLog,
      control_status: status
    };
  });

  res.json({ date, rows: out });
});



// Reports

function localDateStrJS(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseLocalDateJS(value) {
  if (!value) return new Date();
  const [y,m,d] = String(value).slice(0,10).split('-').map(Number);
  return new Date(y, (m||1)-1, d||1, 12, 0, 0, 0);
}

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = `${y}-${String(m).padStart(2,'0')}-${String(endDate.getUTCDate()).padStart(2,'0')}`;
  return { start, end };
}

app.get('/api/reports/weekly-events', requireAdmin, (req, res) => {
  const start = req.query.start;
  if (!start) return res.status(400).json({ error: 'Falta fecha inicio' });
  const d = parseLocalDateJS(start);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const endStr = localDateStrJS(end);

  const rows = db.prepare(`
    SELECT e.*,
      COUNT(a.id) AS workers_count
    FROM events e
    LEFT JOIN assignments a ON a.event_id=e.id
    WHERE e.event_date BETWEEN ? AND ?
      AND e.status IN ('programado','en_curso')
    GROUP BY e.id
    ORDER BY e.event_date, e.start_time, e.name
  `).all(start, endStr);

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone, e.event_date
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    JOIN events e ON e.id=a.event_id
    WHERE e.event_date BETWEEN ? AND ?
      AND e.status IN ('programado','en_curso')
    ORDER BY e.event_date, a.is_team_lead DESC, u.first_name
  `).all(start, endStr);

  res.json({ start, end: endStr, rows, assignments });
});

app.get('/api/reports/client-history', requireAdmin, (req, res) => {
  const clientId = req.query.client_id;
  const year = req.query.year;
  const month = req.query.month;
  if (!clientId || !year || !month) return res.status(400).json({ error: 'Faltan cliente, mes o año' });
  const range = monthRange(year, month);

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  const events = db.prepare(`
    SELECT e.*,
      dn.grand_total,
      dn.vat_amount,
      dn.grand_total_vat,
      dn.total_normal_hours,
      dn.total_night_hours,
      dn.staff_total,
      dn.client_discount_amount,
      dn.client_signed
    FROM events e
    LEFT JOIN event_delivery_notes dn ON dn.event_id=e.id
    WHERE e.client_id=?
      AND e.event_date BETWEEN ? AND ?
    ORDER BY e.event_date, e.start_time
  `).all(clientId, range.start, range.end);

  const totals = events.reduce((acc,e)=>{
    acc.events += 1;
    acc.base += Number(e.grand_total || 0);
    acc.vat += Number(e.vat_amount || 0);
    acc.total_vat += Number(e.grand_total_vat || 0);
    acc.normal_hours += Number(e.total_normal_hours || 0);
    acc.night_hours += Number(e.total_night_hours || 0);
    acc.discount += Number(e.client_discount_amount || 0);
    return acc;
  }, {events:0, base:0, vat:0, total_vat:0, normal_hours:0, night_hours:0, discount:0});

  res.json({ client, year:Number(year), month:Number(month), start:range.start, end:range.end, events, totals });
});

app.get('/api/reports/worker-hours', requireAdmin, (req, res) => {
  const year = req.query.year;
  const month = req.query.month;
  const userId = req.query.user_id || '';
  if (!year || !month) return res.status(400).json({ error: 'Faltan mes o año' });
  const range = monthRange(year, month);

  let assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone, u.email,
      e.name AS event_name, e.client, e.location, e.event_date, e.start_time, e.end_time, e.status
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    JOIN events e ON e.id=a.event_id
    WHERE e.event_date BETWEEN ? AND ?
      ${userId ? 'AND u.id=?' : ''}
    ORDER BY u.first_name, u.last_name, e.event_date, e.start_time
  `).all(...(userId ? [range.start, range.end, userId] : [range.start, range.end]));

  const rows = assignments.map(a => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(a.event_id, a.user_id);
    const h = calculateHoursDetailed(logs);
    const normalAmount = h.normalHours * Number(a.billable_hourly_rate || 0);
    const nightAmount = h.nightHours * Number(a.billable_night_rate || 0);
    return {
      ...a,
      worker_name: `${a.first_name||''} ${a.last_name||''}`.trim(),
      normal_hours: h.normalHours,
      night_hours: h.nightHours,
      total_hours: h.totalHours,
      normal_amount: Math.round(normalAmount*100)/100,
      night_amount: Math.round(nightAmount*100)/100,
      total_amount: Math.round((normalAmount+nightAmount)*100)/100,
      has_logs: logs.length > 0
    };
  });

  const byWorker = {};
  for (const r of rows) {
    const key = r.user_id;
    if (!byWorker[key]) byWorker[key] = {
      user_id:r.user_id,
      worker_name:r.worker_name,
      nickname:r.nickname,
      phone:r.phone,
      events:0,
      normal_hours:0,
      night_hours:0,
      total_hours:0,
      total_amount:0
    };
    byWorker[key].events += 1;
    byWorker[key].normal_hours += Number(r.normal_hours||0);
    byWorker[key].night_hours += Number(r.night_hours||0);
    byWorker[key].total_hours += Number(r.total_hours||0);
    byWorker[key].total_amount += Number(r.total_amount||0);
  }

  const totals = Object.values(byWorker).reduce((acc,w)=>{
    acc.workers += 1;
    acc.events += w.events;
    acc.normal_hours += w.normal_hours;
    acc.night_hours += w.night_hours;
    acc.total_hours += w.total_hours;
    acc.total_amount += w.total_amount;
    return acc;
  }, {workers:0, events:0, normal_hours:0, night_hours:0, total_hours:0, total_amount:0});

  res.json({ year:Number(year), month:Number(month), start:range.start, end:range.end, rows, byWorker:Object.values(byWorker), totals });
});



// ---------- V52 AUDIT MODULE ROUTES ----------
app.get('/api/operations/summary', requireAdmin, (req, res) => {
  const events = db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date,start_time").all();
  const rows = events.map(e => {
    const count = db.prepare('SELECT COUNT(*) c FROM assignments WHERE event_id=?').get(e.id).c;
    const leads = db.prepare('SELECT COUNT(*) c FROM assignments WHERE event_id=? AND is_team_lead=1').get(e.id).c;
    const required = Number(e.required_workers || 0);
    const requiredLeads = Number(e.required_team_leads || 1);
    let op = e.operational_status || 'borrador';
    if (e.status === 'realizado') op = 'finalizado';
    else if (count === 0 || (required && count < required) || leads < requiredLeads) op = 'crew_parcial';
    else if (required && count >= required && leads >= requiredLeads) op = 'crew_completo';
    return { ...e, workers_count: count, team_leads_count: leads, computed_status: op };
  });
  const alerts = [];
  for (const r of rows) {
    if (r.computed_status === 'crew_parcial') alerts.push({level:'warn', event_id:r.id, event_name:r.name, message:'Crew incompleto o falta jefe de equipo'});
  }
  res.json({ rows, alerts });
});

app.get('/api/gps/live', requireAdmin, (req, res) => {
  const date = req.query.date || localDateStrJS();
  const radius = Number(req.query.radius || getSettings().geo_check_radius_m || 300);
  const rows = db.prepare(`
    SELECT e.id event_id,e.name event_name,e.location,e.latitude event_latitude,e.longitude event_longitude,e.event_date,e.start_time,e.end_time,
           a.user_id,a.service_role,a.is_team_lead,u.first_name,u.last_name,u.nickname,u.phone
    FROM assignments a
    JOIN events e ON e.id=a.event_id
    JOIN users u ON u.id=a.user_id
    WHERE e.event_date=? AND e.status!='cancelado'
    ORDER BY e.start_time,e.name,u.first_name
  `).all(date);

  const live = rows.map(r => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(r.event_id, r.user_id);
    const last = logs.length ? logs[logs.length-1] : null;
    let distance = null;
    if (last && r.event_latitude && r.event_longitude && last.latitude && last.longitude) {
      distance = distanceMeters(Number(r.event_latitude), Number(r.event_longitude), Number(last.latitude), Number(last.longitude));
    }
    let status = 'pendiente_fichaje';
    if (last && distance === null) status = 'sin_gps';
    else if (last && distance <= radius) status = 'en_evento';
    else if (last && distance > radius) status = 'fuera_radio';
    return { ...r, last_log:last, distance_m:distance, gps_status:status };
  });

  res.json({ date, radius, rows: live });
});

app.get('/api/production/events', requireAuth, (req, res) => {
  const events = req.session.user.role === 'admin'
    ? db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date,start_time").all()
    : db.prepare(`SELECT e.* FROM assignments a JOIN events e ON e.id=a.event_id WHERE a.user_id=? ORDER BY e.event_date,e.start_time`).all(req.session.user.id);

  const tasks = db.prepare('SELECT * FROM production_tasks ORDER BY event_id, phase, id').all();
  const incidents = db.prepare('SELECT * FROM production_incidents ORDER BY status, created_at DESC').all();
  res.json({ events, tasks, incidents });
});

app.post('/api/production/tasks', requireAuth, (req, res) => {
  const b = req.body || {};
  if (req.session.user.role !== 'admin') {
    const ass = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=? AND is_team_lead=1').get(b.event_id, req.session.user.id);
    if (!ass) return res.status(403).json({error:'Solo admin o jefe de equipo'});
  }
  const info = db.prepare('INSERT INTO production_tasks (event_id,phase,title,description,priority,completed) VALUES (?,?,?,?,?,?)')
    .run(b.event_id, b.phase||'montaje', b.title||'', b.description||'', b.priority||'normal', b.completed?1:0);
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.put('/api/production/tasks/:id', requireAuth, (req, res) => {
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM production_tasks WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({error:'Tarea no encontrada'});
  if (req.session.user.role !== 'admin') {
    const ass = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=? AND is_team_lead=1').get(t.event_id, req.session.user.id);
    if (!ass) return res.status(403).json({error:'Solo admin o jefe de equipo'});
  }
  db.prepare('UPDATE production_tasks SET completed=?, completed_at=? WHERE id=?')
    .run(b.completed?1:0, b.completed ? new Date().toISOString() : '', req.params.id);
  res.json({ ok:true });
});

app.post('/api/production/incidents', requireAuth, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO production_incidents (event_id,user_id,severity,title,description,status) VALUES (?,?,?,?,?,?)')
    .run(b.event_id, req.session.user.id, b.severity||'media', b.title||'', b.description||'', b.status||'abierta');
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.get('/api/finance/events', requireAdmin, (req, res) => {
  const events = db.prepare('SELECT id FROM events ORDER BY event_date DESC').all();
  const rows = events.map(e => auditEventFinancial(e.id)).filter(Boolean);
  const totals = rows.reduce((a,r)=>{
    a.revenue += r.revenue;
    a.cost += r.totalCost;
    a.profit += r.profit;
    return a;
  }, {revenue:0,cost:0,profit:0});
  totals.margin = totals.revenue ? Math.round((totals.profit/totals.revenue)*10000)/100 : 0;
  res.json({ rows, totals });
});

app.put('/api/finance/events/:id/costs', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE events SET estimated_external_cost=?, estimated_transport_cost=?, estimated_other_cost=?, payment_status=? WHERE id=?')
    .run(Number(b.estimated_external_cost||0), Number(b.estimated_transport_cost||0), Number(b.estimated_other_cost||0), b.payment_status||'pendiente', req.params.id);
  res.json({ ok:true });
});

app.get('/api/documents', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.first_name,u.last_name,u.nickname,u.phone
    FROM worker_documents d
    JOIN users u ON u.id=d.user_id
    ORDER BY d.expiry_date
  `).all().map(d => ({...d, computed_status:auditDocStatus(d.expiry_date)}));
  res.json(rows);
});

app.post('/api/documents', requireAdmin, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO worker_documents (user_id,doc_type,title,file_url,issue_date,expiry_date,notes) VALUES (?,?,?,?,?,?,?)')
    .run(b.user_id, b.doc_type||'PRL', b.title||'', (b.dataUrl ? v53SaveBase64File(b.dataUrl, b.file_name || b.title || 'documento') : (b.file_url||'')), b.issue_date||'', b.expiry_date||'', b.notes||'');
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.delete('/api/documents/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM worker_documents WHERE id=?').run(req.params.id);
  res.json({ ok:true });
});


// ---------- V53 ENTERPRISE ROUTES ----------
app.get('/api/my-documents', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  if (req.session.user.role === 'admin') return res.json([]);
  const rows = db.prepare(`
    SELECT d.*, u.first_name,u.last_name,u.phone
    FROM worker_documents d
    JOIN users u ON u.id=d.user_id
    WHERE d.user_id=?
    ORDER BY d.expiry_date
  `).all(userId).map(d => ({...d, computed_status:auditDocStatus(d.expiry_date)}));
  res.json(rows);
});

app.put('/api/finance/events/:id/detailed-costs', requireAdmin, (req, res) => {
  const b = req.body || {};
  v53EnsureFinanceColumns();
  db.prepare(`
    UPDATE events SET
      cost_staff=?,
      cost_social_security=?,
      cost_gestoria=?,
      cost_fixed=?,
      cost_transport=?,
      cost_taxi=?,
      cost_hotel=?,
      cost_extra_hours=?,
      cost_other=?,
      estimated_external_cost=?,
      estimated_transport_cost=?,
      estimated_other_cost=?,
      payment_status=?
    WHERE id=?
  `).run(
    Number(b.cost_staff||0),
    Number(b.cost_social_security||0),
    Number(b.cost_gestoria||0),
    Number(b.cost_fixed||0),
    Number(b.cost_transport||0),
    Number(b.cost_taxi||0),
    Number(b.cost_hotel||0),
    Number(b.cost_extra_hours||0),
    Number(b.cost_other||0),
    Number(b.estimated_external_cost||0),
    Number(b.estimated_transport_cost||0),
    Number(b.estimated_other_cost||0),
    b.payment_status||'pendiente',
    req.params.id
  );
  res.json({ ok:true });
});

app.get('/api/pdf-template/:type/:id', requireAuth, (req, res) => {
  res.json({
    ok:true,
    type:req.params.type,
    id:req.params.id,
    format:'A4 portrait',
    company:'MARFAN CREW',
    generated_at:new Date().toISOString()
  });
});



// ---------- V53.3 BACKUP CENTER ----------
function v533BackupDir() {
  v552EnsurePersistentDirs();
  return V552_BACKUP_DIR;
}

function v533AllTableNames() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
}

function v533CreateBackupObject() {
  const backup = {
    meta: {
      app: 'Marfan Crew Hours',
      version: '53.3.0',
      exported_at: new Date().toISOString()
    },
    tables: {}
  };
  const tables = v533AllTableNames();
  for (const t of tables) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }
  return backup;
}

function v533SafeFileName() {
  return `marfan-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
}

function v533RestoreBackupObject(backup) {
  if (!backup || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('Archivo de copia no válido');
  }

  const imported = [];
  const skipped = [];

  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }

      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }

      try {
        db.prepare(`DELETE FROM "${table}"`).run();

        if (rows.length) {
          const tableCols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
          const cols = Object.keys(rows[0]).filter(c => tableCols.includes(c));
          if (cols.length) {
            const placeholders = cols.map(() => '?').join(',');
            const stmt = db.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders})`);
            for (const r of rows) stmt.run(...cols.map(c => r[c]));
          }
        }
        imported.push(table);
      } catch(e) {
        console.error('restore table error', table, e);
        skipped.push(table);
      }
    }
  });

  tx();
  return { imported, skipped };
}

// Descarga directa completa
app.get('/api/backup/export-v533', requireAdmin, (req, res) => {
  const backup = v533CreateBackupObject();
  const filename = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  res.status(200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
});

// Guardar backup en servidor
app.post('/api/backup/save-online', requireAdmin, (req, res) => {
  const backup = v533CreateBackupObject();
  const filename = v533SafeFileName();
  const filepath = path.join(v533BackupDir(), filename);
  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
  res.json({ ok:true, filename, created_at: backup.meta.exported_at });
});

// Listar backups guardados en servidor
app.get('/api/backup/list-online', requireAdmin, (req, res) => {
  const dir = v533BackupDir();
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { filename:f, size_bytes:st.size, created_at:st.mtime.toISOString() };
    })
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok:true, backups:files });
});

// Restaurar backup guardado en servidor
app.post('/api/backup/restore-online', requireAdmin, (req, res) => {
  const filename = String((req.body || {}).filename || '');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error:'Nombre de backup inválido' });
  }
  const filepath = path.join(v533BackupDir(), filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error:'Backup no encontrado' });
  const backup = JSON.parse(fs.readFileSync(filepath,'utf8'));
  const result = v533RestoreBackupObject(backup);
  res.json({ ok:true, ...result });
});

// Restaurar backup subido desde archivo JSON
app.post('/api/backup/import-v533', requireAdmin, (req, res) => {
  try {
    const backup = req.body || {};
    const result = v533RestoreBackupObject(backup);
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar el backup' });
  }
});

// ---------- V53.1 DELETE / SUSPEND / BACKUP ROUTES ----------

// Borrado seguro de eventos + datos relacionados
app.delete('/api/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    db.prepare('DELETE FROM assignments WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM time_logs WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM production_tasks WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM production_incidents WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id);
  } catch(e) {}
  const info = db.prepare('DELETE FROM events WHERE id=?').run(id);
  res.json({ ok:true, deleted: info.changes || 0 });
});

// Suspender / reactivar operario
app.put('/api/users/:id/suspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const suspended = req.body && req.body.suspended !== undefined ? Number(req.body.suspended ? 1 : 0) : 1;

  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (cols.includes('active')) {
    db.prepare('UPDATE users SET active=? WHERE id=?').run(suspended ? 0 : 1, id);
  }

  if (cols.includes('availability')) {
    db.prepare('UPDATE users SET availability=? WHERE id=?').run(suspended ? 'suspendido' : 'disponible', id);
  }

  res.json({ ok:true, id, suspended: !!suspended });
});

// Borrar operario + desasignar
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try { db.prepare('DELETE FROM assignments WHERE user_id=?').run(id); } catch(e) {}
  try { db.prepare('DELETE FROM time_logs WHERE user_id=?').run(id); } catch(e) {}
  try { db.prepare('DELETE FROM worker_documents WHERE user_id=?').run(id); } catch(e) {}
  const info = db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok:true, deleted: info.changes || 0 });
});

// Login por teléfono bloquea suspendidos / inactive
app.post('/api/login-phone-v531', (req, res) => {
  try {
    const raw = String((req.body || {}).phone || '');
    const phone = raw.replace(/\D/g, '').slice(-9);
    if (!phone) return res.status(400).json({ error:'Teléfono requerido' });

    const users = db.prepare("SELECT * FROM users WHERE role!='admin'").all();
    const user = users.find(u => String(u.phone || '').replace(/\D/g,'').slice(-9) === phone);

    if (!user) return res.status(401).json({ error:'Teléfono no encontrado' });
    if (Number(user.active) === 0 || String(user.availability || '').toLowerCase() === 'suspendido') {
      return res.status(403).json({ error:'Usuario suspendido. Contacta con oficina.' });
    }

    req.session.user = {
      id:user.id,
      email:user.email,
      role:user.role,
      first_name:user.first_name,
      last_name:user.last_name,
      phone:user.phone
    };
    res.json({ ok:true, user:req.session.user });
  } catch(e) {
    console.error('login-phone-v531', e);
    res.status(500).json({ error:'Error login teléfono' });
  }
});

// Copia de seguridad completa
app.get('/api/backup/export', requireAdmin, (req, res) => {
  const backup = {
    meta: {
      app:'Marfan Crew Hours',
      version:'53.1.0',
      exported_at:new Date().toISOString()
    },
    tables: {}
  };

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => t.name);
  for (const t of tables) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }

  res.setHeader('Content-Disposition', `attachment; filename="marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

// Restaurar copia de seguridad
app.post('/api/backup/import', requireAdmin, (req, res) => {
  const backup = req.body || {};
  if (!backup.tables || typeof backup.tables !== 'object') {
    return res.status(400).json({ error:'Archivo de copia no válido' });
  }

  const imported = [];
  const skipped = [];

  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }

      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }

      try {
        db.prepare(`DELETE FROM ${table}`).run();

        if (rows.length) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(',');
          const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
          for (const r of rows) stmt.run(...cols.map(c => r[c]));
        }

        imported.push(table);
      } catch(e) {
        skipped.push(table);
      }
    }
  });

  tx();
  res.json({ ok:true, imported, skipped });
});


// ---------- V53.2 DASHBOARD GRAPH DATA ----------
app.get('/api/dashboard-graph', requireAdmin, (req, res) => {
  try {
    const events = db.prepare('SELECT * FROM events ORDER BY event_date').all();
    const map = {};
    for (const e of events) {
      const key = String(e.event_date || '').slice(0,7) || 'sin-fecha';
      if (!map[key]) map[key] = { month:key, amount:0, profit:0, cost:0, events:0 };
      let fin = null;
      try { fin = auditEventFinancial(e.id); } catch(err) {}
      const amount = fin ? Number(fin.revenue || 0) : Number(e.total_amount || e.amount || e.km_amount || 0);
      const cost = fin ? Number(fin.totalCost || 0) : Number(e.estimated_external_cost||0)+Number(e.estimated_transport_cost||0)+Number(e.estimated_other_cost||0);
      const profit = fin ? Number(fin.profit || 0) : amount - cost;
      map[key].amount += amount;
      map[key].cost += cost;
      map[key].profit += profit;
      map[key].events += 1;
    }
    const rows = Object.values(map).sort((a,b)=>String(a.month).localeCompare(String(b.month))).map(r=>({
      month:r.month,
      amount:Math.round(r.amount*100)/100,
      cost:Math.round(r.cost*100)/100,
      profit:Math.round(r.profit*100)/100,
      events:r.events
    }));
    res.json({ rows });
  } catch(e) {
    console.error('dashboard-graph', e);
    res.json({ rows: [] });
  }
});


// ---------- V55 GOOGLE CALENDAR SYNC ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://marfan-crew-hours-production-ef76.up.railway.app/auth/google/callback';

const GOOGLE_TARGET_CALENDAR_NAME = process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN';
const GOOGLE_TARGET_CALENDAR_ID = process.env.GOOGLE_TARGET_CALENDAR_ID || '';

async function v551ResolveTargetCalendarId(calendar) {
  if (GOOGLE_TARGET_CALENDAR_ID) return GOOGLE_TARGET_CALENDAR_ID;
  const list = await calendar.calendarList.list();
  const calendars = list.data.items || [];
  const found = calendars.find(c => String(c.summary || '').trim().toLowerCase() === String(GOOGLE_TARGET_CALENDAR_NAME).trim().toLowerCase());
  if (found) return found.id;
  throw new Error(`No encuentro el calendario "${GOOGLE_TARGET_CALENDAR_NAME}" en Google Calendar. Créalo o configura GOOGLE_TARGET_CALENDAR_ID.`);
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

function v55GoogleOAuthClient() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL);
}

function v55EnsureGoogleTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT DEFAULT 'google',
      tokens_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS google_event_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT DEFAULT '',
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function v55GetGoogleTokens() {
  try {
    const row = db.prepare("SELECT * FROM google_tokens WHERE provider='google' ORDER BY id DESC LIMIT 1").get();
    if (!row) return null;
    return JSON.parse(row.tokens_json || '{}');
  } catch(e) { return null; }
}

function v55SaveGoogleTokens(tokens) {
  const row = db.prepare("SELECT * FROM google_tokens WHERE provider='google' ORDER BY id DESC LIMIT 1").get();
  if (row) {
    db.prepare("UPDATE google_tokens SET tokens_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(tokens), row.id);
  } else {
    db.prepare("INSERT INTO google_tokens (provider,tokens_json) VALUES (?,?)").run('google', JSON.stringify(tokens));
  }
}

function v55CalendarStatus() {
  return {
    configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL),
    connected: !!v55GetGoogleTokens(),
    callback_url: GOOGLE_CALLBACK_URL,
    target_calendar_name: GOOGLE_TARGET_CALENDAR_NAME,
    target_calendar_id_configured: !!GOOGLE_TARGET_CALENDAR_ID
  };
}

function v55EventToGoogle(e) {
  const date = e.event_date || new Date().toISOString().slice(0,10);
  const start = e.start_time || '09:00';
  const end = e.end_time || '10:00';
  return {
    summary: e.name || 'Evento Marfan Crew',
    location: e.location || '',
    description: [
      'Creado desde Marfan Crew Hours',
      e.client ? `Cliente: ${e.client}` : '',
      e.notes ? `Notas: ${e.notes}` : ''
    ].filter(Boolean).join('\\n'),
    start: { dateTime: `${date}T${start}:00`, timeZone: 'Europe/Madrid' },
    end: { dateTime: `${date}T${end}:00`, timeZone: 'Europe/Madrid' }
  };
}

async function v55GoogleCalendarClient() {
  const tokens = v55GetGoogleTokens();
  if (!tokens) throw new Error('Google Calendar no conectado');
  const oauth2 = v55GoogleOAuthClient();
  oauth2.setCredentials(tokens);
  return google.calendar({ version:'v3', auth:oauth2 });
}

v55EnsureGoogleTables();


// ---------- V55.4 OAUTH SAFE ROUTES ----------
app.get('/api/google/debug-v554', requireAdmin, (req,res)=>{
  res.json({
    ok:true,
    googleapis_loaded: !!google,
    has_client_id: !!process.env.GOOGLE_CLIENT_ID,
    has_client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
    callback_url: process.env.GOOGLE_CALLBACK_URL || GOOGLE_CALLBACK_URL || '',
    target_calendar_name: process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'
  });
});

// Esta ruta sustituye a /auth/google con validación clara.
// Si ves error aquí, faltan variables o la Redirect URI no coincide.
app.get('/auth/google-safe', requireAdmin, (req,res)=>{
  try{
    const clientId = process.env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET || '';
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || GOOGLE_CALLBACK_URL || '';

    if(!clientId || !clientSecret || !callbackUrl){
      return res.status(400).send(`
        <html><body style="font-family:Arial;padding:40px">
          <h1>Faltan variables Google OAuth</h1>
          <p>Revisa Railway → Variables:</p>
          <ul>
            <li>GOOGLE_CLIENT_ID: ${clientId ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CLIENT_SECRET: ${clientSecret ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CALLBACK_URL: ${callbackUrl ? callbackUrl : 'FALTA'}</li>
            <li>GOOGLE_TARGET_CALENDAR_NAME: ${process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'}</li>
          </ul>
        </body></html>
      `);
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
    const url = oauth2.generateAuthUrl({
      access_type:'offline',
      prompt:'consent',
      scope:[
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    return res.redirect(url);
  }catch(e){
    console.error('auth/google-safe error', e);
    return res.status(500).send(`
      <html><body style="font-family:Arial;padding:40px">
        <h1>Error OAuth Google</h1>
        <pre>${String(e.stack || e.message || e).replace(/[<>&]/g, s=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</pre>
      </body></html>
    `);
  }
});

app.get('/auth/google', requireAdmin, (req,res)=>{
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).send('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Railway Variables.');
  }
  const oauth2 = v55GoogleOAuthClient();
  const url = oauth2.generateAuthUrl({
    access_type:'offline',
    prompt:'consent',
    scope:GOOGLE_SCOPES
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req,res)=>{
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta code OAuth.');
    const oauth2 = v55GoogleOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    v55SaveGoogleTokens(tokens);
    res.send(`
      <html><body style="font-family:Arial;padding:40px">
        <h1>Google Calendar conectado correctamente ✅</h1>
        <p>Ya puedes cerrar esta ventana y volver a Marfan Crew Hours.</p>
        <script>setTimeout(()=>window.close(),2500)</script>
      </body></html>
    `);
  } catch(e) {
    console.error('google callback', e);
    res.status(500).send('Error conectando Google Calendar: '+e.message);
  }
});

app.get('/api/google/status', requireAdmin, (req,res)=>{
  res.json(v55CalendarStatus());
});

app.post('/api/google/disconnect', requireAdmin, (req,res)=>{
  try { db.prepare("DELETE FROM google_tokens WHERE provider='google'").run(); } catch(e) {}
  res.json({ok:true});
});

app.post('/api/google/export-event/:id', requireAdmin, async (req,res)=>{
  try {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!event) return res.status(404).json({error:'Evento no encontrado'});
    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
    const existing = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC LIMIT 1').get(event.id);
    let result;
    if (existing) {
      result = await calendar.events.update({
        calendarId: existing.calendar_id || 'primary',
        eventId: existing.google_event_id,
        requestBody: v55EventToGoogle(event)
      });
    } else {
      result = await calendar.events.insert({
        calendarId:targetCalendarId,
        requestBody: v55EventToGoogle(event)
      });
      db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(event.id, result.data.id, targetCalendarId);
    }
    res.json({ok:true, google_event_id:result.data.id, htmlLink:result.data.htmlLink});
  } catch(e) {
    console.error('export google event', e);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/google/export-all', requireAdmin, async (req,res)=>{
  try {
    const events = db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date").all();
    const out = [];
    for (const e of events) {
      try {
        const calendar = await v55GoogleCalendarClient();
        const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
        const existing = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC LIMIT 1').get(e.id);
        let result;
        if (existing) {
          result = await calendar.events.update({
            calendarId: existing.calendar_id || 'primary',
            eventId: existing.google_event_id,
            requestBody: v55EventToGoogle(e)
          });
        } else {
          result = await calendar.events.insert({ calendarId:targetCalendarId, requestBody:v55EventToGoogle(e) });
          db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(e.id, result.data.id, targetCalendarId);
        }
        out.push({event_id:e.id, ok:true, google_event_id:result.data.id});
      } catch(err) {
        out.push({event_id:e.id, ok:false, error:err.message});
      }
    }
    res.json({ok:true, results:out});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.post('/api/google/import-upcoming', requireAdmin, async (req,res)=>{
  try {
    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
    const now = new Date();
    const max = new Date();
    max.setMonth(max.getMonth()+6);
    const response = await calendar.events.list({
      calendarId:targetCalendarId,
      timeMin:now.toISOString(),
      timeMax:max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:100
    });
    const imported = [];
    const items = response.data.items || [];
    for (const item of items) {
      const googleId = item.id;
      const exists = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(googleId);
      if (exists) continue;
      const startRaw = item.start.dateTime || item.start.date;
      const endRaw = item.end.dateTime || item.end.date;
      const sd = new Date(startRaw);
      const ed = new Date(endRaw);
      const eventDate = item.start.date || sd.toISOString().slice(0,10);
      const startTime = item.start.date ? '09:00' : String(sd.toTimeString().slice(0,5));
      const endTime = item.end.date ? '10:00' : String(ed.toTimeString().slice(0,5));
      const cols = db.prepare("PRAGMA table_info(events)").all().map(c=>c.name);
      const data = {
        name:item.summary || 'Evento Google',
        location:item.location || '',
        event_date:eventDate,
        start_time:startTime,
        end_time:endTime,
        notes:item.description || '',
        status:'programado',
        operational_status:'importado_google'
      };
      const keys = Object.keys(data).filter(k=>cols.includes(k));
      const stmt = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
      const info = stmt.run(...keys.map(k=>data[k]));
      db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, googleId, targetCalendarId);
      imported.push({event_id:info.lastInsertRowid, google_event_id:googleId, summary:item.summary});
    }
    res.json({ok:true, imported});
  } catch(e) {
    console.error('import google', e);
    res.status(500).json({error:e.message});
  }
});


// ---------- V55.2 ROBUST BACKUP CENTER ----------
function v552AllTableNames() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
}

function v552CreateBackupObject() {
  const backup = {
    meta: {
      app: 'Marfan Crew Hours',
      version: '55.4.0',
      exported_at: new Date().toISOString(),
      data_dir: V552_DATA_DIR,
      backup_dir: V552_BACKUP_DIR,
      google_target_calendar_name: process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'
    },
    tables: {}
  };
  for (const t of v552AllTableNames()) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }
  return backup;
}

function v552BackupFilename() {
  return `marfan-crew-hours-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
}

function v552RestoreBackupObject(backup) {
  if (!backup || !backup.tables || typeof backup.tables !== 'object') throw new Error('Backup no válido');
  const imported = [];
  const skipped = [];
  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }
      try {
        db.prepare(`DELETE FROM "${table}"`).run();
        if (rows.length) {
          const tableCols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
          const cols = Object.keys(rows[0]).filter(c => tableCols.includes(c));
          if (cols.length) {
            const stmt = db.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
            for (const r of rows) stmt.run(...cols.map(c => r[c]));
          }
        }
        imported.push(table);
      } catch(e) {
        skipped.push(table);
      }
    }
  });
  tx();
  return { imported, skipped };
}

app.get('/api/backup/status-v552', requireAdmin, (req,res)=>{
  const migrated = v552MigrateLegacyBackups();
  let backups = [];
  try {
    backups = fs.readdirSync(V552_BACKUP_DIR).filter(f=>f.endsWith('.json'));
  } catch(e) {}
  res.json({
    ok:true,
    persistent_mounted:v552IsPersistentMounted(),
    data_dir:V552_DATA_DIR,
    backup_dir:V552_BACKUP_DIR,
    backups_count:backups.length,
    migrated_now:migrated,
    google_target_calendar_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    message: v552IsPersistentMounted()
      ? 'Persistencia OK: backups y datos se conservarán entre versiones.'
      : 'ATENCIÓN: no se detecta /data escribible. Revisa el Volume de Railway.'
  });
});

app.get('/api/backup/list-online-v552', requireAdmin, (req,res)=>{
  v552MigrateLegacyBackups();
  v552EnsurePersistentDirs();
  const files = fs.existsSync(V552_BACKUP_DIR)
    ? fs.readdirSync(V552_BACKUP_DIR).filter(f=>f.endsWith('.json')).map(f=>{
        const p = path.join(V552_BACKUP_DIR, f);
        const st = fs.statSync(p);
        return { filename:f, size_bytes:st.size, created_at:st.mtime.toISOString(), path:V552_BACKUP_DIR };
      }).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    : [];
  res.json({ ok:true, backups:files, backup_dir:V552_BACKUP_DIR, persistent_mounted:v552IsPersistentMounted() });
});

app.post('/api/backup/save-online-v552', requireAdmin, (req,res)=>{
  v552EnsurePersistentDirs();
  const backup = v552CreateBackupObject();
  const filename = v552BackupFilename();
  fs.writeFileSync(path.join(V552_BACKUP_DIR, filename), JSON.stringify(backup, null, 2));
  res.json({ ok:true, filename, backup_dir:V552_BACKUP_DIR });
});

app.get('/api/backup/export-v552', requireAdmin, (req,res)=>{
  const backup = v552CreateBackupObject();
  const filename = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  res.status(200);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/backup/import-v552', requireAdmin, (req,res)=>{
  try {
    const result = v552RestoreBackupObject(req.body || {});
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar backup' });
  }
});

app.post('/api/backup/restore-online-v552', requireAdmin, (req,res)=>{
  try {
    const filename = String((req.body||{}).filename||'');
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error:'Nombre de backup inválido' });
    }
    const filepath = path.join(V552_BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error:'Backup no encontrado en '+V552_BACKUP_DIR });
    const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const result = v552RestoreBackupObject(backup);
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar backup online' });
  }
});


// ---------- V55.3 AUTO MARFAN CALENDAR VIEW ----------
app.get('/api/google/marfan-events', requireAdmin, async (req,res)=>{
  try {
    const status = v55CalendarStatus();
    if (!status.configured || !status.connected) {
      return res.json({ ok:true, connected:false, events:[], message:'Google Calendar no conectado todavía.' });
    }

    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);

    const now = new Date();
    const min = new Date(now.getFullYear(), now.getMonth()-2, 1);
    const max = new Date(now.getFullYear(), now.getMonth()+12, 1);

    const response = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: min.toISOString(),
      timeMax: max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:250
    });

    const googleEvents = (response.data.items || []).map(item=>{
      const startRaw = item.start.dateTime || item.start.date;
      const endRaw = item.end.dateTime || item.end.date;
      const sd = new Date(startRaw);
      const ed = new Date(endRaw);
      return {
        id:'g_'+item.id,
        google_event_id:item.id,
        name:item.summary || 'Evento MARFAN',
        location:item.location || '',
        event_date:item.start.date || sd.toISOString().slice(0,10),
        start_time:item.start.date ? '' : String(sd.toTimeString().slice(0,5)),
        end_time:item.end.date ? '' : String(ed.toTimeString().slice(0,5)),
        status:'google',
        operational_status:'google_marfan',
        source:'google',
        htmlLink:item.htmlLink || ''
      };
    });

    res.json({
      ok:true,
      connected:true,
      calendar_id:targetCalendarId,
      calendar_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
      events:googleEvents
    });
  } catch(e) {
    res.json({ ok:false, connected:false, events:[], error:e.message });
  }
});

// Settings
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const data = req.body || {};
  const stmt = db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const allowed = [
    'company_name','company_legal_name','company_cif','company_address','company_email','company_phone',
    'vat_percent','show_vat','invoice_prefix','km_origin_address','km_origin_lat','km_origin_lng','km_free_radius','km_price',
    'geo_check_radius_m','night_start','night_end','default_hourly_rate','default_night_rate','default_diet_price','early_clock_grace_minutes','minimum_billable_hours','pdf_footer',
    'dashboard_goal_monthly','dashboard_goal_annual','allow_operator_self_notes','require_client_signature','theme_mode'
  ];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, k)) stmt.run(k, String(data[k]));
  }
  res.json({ ok: true, settings: getSettings() });
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Marfan Crew Hours V53.3 Backup Center Calendar listening on port ${PORT}`);
});


// ---------- V53.4 AUTO DELIVERY NOTES ----------
app.post('/api/events/:id/complete', requireAdmin, (req,res)=>{
  const id=Number(req.params.id);
  try{
    db.prepare("UPDATE events SET status='realizado' WHERE id=?").run(id);
  }catch(e){}
  res.json({ok:true});
});


// ---------- V53.5 PERSISTENT BACKUP STATUS ----------
app.get('/api/backup/status', requireAdmin, (req, res) => {
  let backups = [];
  try {
    const dir = v533BackupDir();
    backups = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  } catch(e) {}
  res.json({
    ok:true,
    persistent_data_dir:PERSISTENT_DATA_DIR,
    persistent_backup_dir:PERSISTENT_BACKUP_DIR,
    backups_count:backups.length,
    railway_volume_required:true,
    note:'Para conservar datos entre versiones, Railway debe tener un Volume montado en /data.'
  });
});
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const dbFile = process.env.DATABASE_FILE || process.env.SQLITE_PATH || process.env.DB_PATH || './data/marfan.sqlite';
const absoluteDb = path.resolve(process.cwd(), dbFile);
fs.mkdirSync(path.dirname(absoluteDb), { recursive: true });
const db = new sqlite3.Database(absoluteDb);

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve({ id: this.lastID, changes: this.changes }); }));
}
function get(sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))); }
function all(sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))); }
async function addCol(table, name, type) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === name)) await run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
async function migrate() {
  await run('PRAGMA foreign_keys = ON');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('super_admin','admin','team_lead','operator','client')),
    active INTEGER NOT NULL DEFAULT 1,
    hourly_rate REAL DEFAULT 0,
    position TEXT DEFAULT '',
    dni TEXT DEFAULT '',
    emergency_phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Campos ampliados migrados desde V62.49 para no perder datos reales de operarios
  await addCol('users','first_name','TEXT DEFAULT ""');
  await addCol('users','last_name','TEXT DEFAULT ""');
  await addCol('users','nickname','TEXT DEFAULT ""');
  await addCol('users','iban','TEXT DEFAULT ""');
  await addCol('users','bank_iban','TEXT DEFAULT ""');
  await addCol('users','bank_name','TEXT DEFAULT ""');
  await addCol('users','social_security_number','TEXT DEFAULT ""');
  await addCol('users','full_address','TEXT DEFAULT ""');
  await addCol('users','address','TEXT DEFAULT ""');
  await addCol('users','operator_role_name','TEXT DEFAULT ""');
  await addCol('users','operator_role_id','INTEGER DEFAULT NULL');
  await addCol('users','shirt_size','TEXT DEFAULT ""');
  await addCol('users','pants_size','TEXT DEFAULT ""');
  await addCol('users','shoe_size','TEXT DEFAULT ""');
  await addCol('users','epis_delivered','INTEGER DEFAULT 0');
  await addCol('users','has_prl','INTEGER DEFAULT 0');
  await addCol('users','emergency_contact_name','TEXT DEFAULT ""');
  await addCol('users','emergency_contact_phone','TEXT DEFAULT ""');

  await run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    legal_name TEXT DEFAULT '',
    cif TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    province TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_code TEXT DEFAULT '',
    client_id INTEGER,
    client_name TEXT DEFAULT '',
    location TEXT DEFAULT '',
    address TEXT DEFAULT '',
    google_maps_link TEXT DEFAULT '',
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    load_in_time TEXT DEFAULT '',
    load_out_time TEXT DEFAULT '',
    service_type TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned',
    operational_status TEXT DEFAULT '',
    budget REAL DEFAULT 0,
    external_cost REAL DEFAULT 0,
    transport_cost REAL DEFAULT 0,
    other_cost REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    access_notes TEXT DEFAULT '',
    parking_notes TEXT DEFAULT '',
    material_notes TEXT DEFAULT '',
    crew_notes TEXT DEFAULT '',
    production_notes TEXT DEFAULT '',
    lat REAL,
    lng REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS event_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role_label TEXT DEFAULT '',
    planned_start TEXT DEFAULT '',
    planned_end TEXT DEFAULT '',
    planned_hours REAL DEFAULT 0,
    hourly_rate REAL DEFAULT 0,
    is_team_lead INTEGER DEFAULT 0,
    status TEXT DEFAULT 'asignado',
    UNIQUE(event_id, user_id),
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    check_in TEXT,
    check_out TEXT,
    check_in_lat REAL,
    check_in_lng REAL,
    check_out_lat REAL,
    check_out_lng REAL,
    break_minutes INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    client_signature_name TEXT DEFAULT '',
    client_signature_dni TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    day_rate REAL DEFAULT 0,
    night_rate REAL DEFAULT 0,
    active INTEGER DEFAULT 1
  )`);
  await run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT DEFAULT '',
    owner_type TEXT DEFAULT '',
    owner_id INTEGER,
    expiry_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS operator_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT DEFAULT '',
    filename TEXT DEFAULT '',
    original_name TEXT DEFAULT '',
    path TEXT DEFAULT '',
    url TEXT DEFAULT '',
    mime_type TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS password_vault (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    service TEXT DEFAULT '',
    category TEXT DEFAULT '',
    username TEXT DEFAULT '',
    password TEXT DEFAULT '',
    url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);


  await run(`CREATE TABLE IF NOT EXISTS production_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    title TEXT NOT NULL,
    assigned_to INTEGER,
    status TEXT DEFAULT 'pending',
    due_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS production_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    user_id INTEGER,
    title TEXT NOT NULL,
    severity TEXT DEFAULT 'media',
    status TEXT DEFAULT 'abierta',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS event_role_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    role_label TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    day_rate REAL DEFAULT 0,
    night_rate REAL DEFAULT 0,
    planned_start TEXT DEFAULT '',
    planned_end TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS delivery_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    number TEXT DEFAULT '',
    client_name TEXT DEFAULT '',
    event_date TEXT DEFAULT '',
    normal_hours REAL DEFAULT 0,
    night_hours REAL DEFAULT 0,
    diets REAL DEFAULT 0,
    km REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    grand_total_vat REAL DEFAULT 0,
    client_signed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await addCol('delivery_notes','signature_name','TEXT DEFAULT ""');
  await addCol('delivery_notes','signature_dni','TEXT DEFAULT ""');
  await addCol('delivery_notes','signature_data_url','TEXT DEFAULT ""');
  await addCol('delivery_notes','signed_at','TEXT DEFAULT ""');
  await addCol('delivery_notes','locked','INTEGER DEFAULT 0');
  await addCol('delivery_notes','vat_percent','REAL DEFAULT 21');
  await addCol('delivery_notes','internal_notes','TEXT DEFAULT ""');
  await run(`CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_note_id INTEGER NOT NULL,
    event_id INTEGER,
    user_id INTEGER,
    worker_name TEXT DEFAULT '',
    role_label TEXT DEFAULT '',
    check_in TEXT DEFAULT '',
    check_out TEXT DEFAULT '',
    break_minutes INTEGER DEFAULT 0,
    normal_hours REAL DEFAULT 0,
    night_hours REAL DEFAULT 0,
    day_rate REAL DEFAULT 0,
    night_rate REAL DEFAULT 0,
    diet REAL DEFAULT 0,
    km REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(delivery_note_id) REFERENCES delivery_notes(id) ON DELETE CASCADE
  )`);
  await addCol('time_entries','admin_corrected','INTEGER DEFAULT 0');
  await addCol('time_entries','correction_reason','TEXT DEFAULT ""');
  await addCol('time_entries','corrected_by','INTEGER DEFAULT NULL');
  await addCol('time_entries','corrected_at','TEXT DEFAULT ""');
  await addCol('time_entries','gps_distance_in_m','REAL DEFAULT NULL');
  await addCol('time_entries','gps_distance_out_m','REAL DEFAULT NULL');
  await addCol('documents','filename','TEXT DEFAULT ""');
  await addCol('documents','original_name','TEXT DEFAULT ""');
  await addCol('documents','path','TEXT DEFAULT ""');
  await addCol('documents','url','TEXT DEFAULT ""');
  await addCol('documents','mime_type','TEXT DEFAULT ""');
  await addCol('documents','size','INTEGER DEFAULT 0');
  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    details TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // V2.0.6 Operativa Real: campos de control total de evento
  await addCol('events','required_workers','INTEGER DEFAULT 0');
  await addCol('events','required_team_leads','INTEGER DEFAULT 0');
  await addCol('events','closed_at','TEXT DEFAULT ""');
  await addCol('events','closed_by','INTEGER DEFAULT NULL');
  await addCol('events','close_notes','TEXT DEFAULT ""');
  await addCol('event_assignments','confirmed_by_worker','INTEGER DEFAULT 0');
  await addCol('event_assignments','confirmed_at','TEXT DEFAULT ""');
  await addCol('event_assignments','assignment_notes','TEXT DEFAULT ""');
  await addCol('delivery_notes','public_token','TEXT DEFAULT ""');
  await addCol('delivery_notes','public_token_expires_at','TEXT DEFAULT ""');
  await addCol('delivery_notes','client_observations','TEXT DEFAULT ""');
  await addCol('delivery_notes','emailed_at','TEXT DEFAULT ""');
  await addCol('users','available','INTEGER DEFAULT 1');
  await addCol('users','default_day_rate','REAL DEFAULT 0');
  await addCol('users','default_night_rate','REAL DEFAULT 0');
  await run(`CREATE TABLE IF NOT EXISTS worker_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'available',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id,date),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS payroll_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    normal_hours REAL DEFAULT 0,
    night_hours REAL DEFAULT 0,
    diets REAL DEFAULT 0,
    km REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS event_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    item TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    required INTEGER DEFAULT 1,
    completed_by INTEGER,
    completed_at TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  )`);

  await run(`INSERT OR IGNORE INTO settings(key,value) VALUES
    ('km_rate','0.28'),('diet_amount','15'),('night_start','22:00'),('night_end','07:00'),('vat_percent','21'),('company_name','MARFAN CREW'),('company_legal_name','MARFAN CREW'),('company_cif',''),('company_email',''),('company_phone',''),('hq_address','Calle Ciro Alegría 89, Málaga'),('geofence_radius_m','250'),('invoice_prefix','ALB'),('min_rest_hours','8'),('default_event_radius_m','250'),('close_requires_signed_delivery','1')`);
  const defaults = [['Auxiliar montaje',12,15],['Jefe equipo',16,20],['Runner',12,15],['Carretilla',18,22],['Limpieza',11,14]];
  for (const r of defaults) await run('INSERT OR IGNORE INTO rates(id,role,day_rate,night_rate,active) VALUES((SELECT id FROM rates WHERE role=?),?,?,?,1)', [r[0], r[0], r[1], r[2]]).catch(()=>{});
}
module.exports = { db, run, get, all, migrate };

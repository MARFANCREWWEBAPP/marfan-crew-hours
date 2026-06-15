const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const dbFile = process.env.DATABASE_FILE || './data/marfan.sqlite';
const absoluteDb = path.resolve(process.cwd(), dbFile);
fs.mkdirSync(path.dirname(absoluteDb), { recursive: true });
const db = new sqlite3.Database(absoluteDb);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cif TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    client_id INTEGER,
    location TEXT DEFAULT '',
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    budget REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS event_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role_label TEXT DEFAULT '',
    planned_hours REAL DEFAULT 0,
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
  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  await run(`INSERT OR IGNORE INTO settings(key,value) VALUES
    ('km_rate','0.28'),('diet_amount','15'),('night_start','22:00'),('night_end','07:00'),('company_name','Marfan Crew')`);
}
module.exports = { db, run, get, all, migrate };

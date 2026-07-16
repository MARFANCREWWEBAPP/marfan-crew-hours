const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword, randomId, verifyPassword } = require("./security");

const DEFAULT_DATA_DIR = process.env.NODE_ENV === "production" && fs.existsSync("/data")
  ? "/data"
  : path.join(process.cwd(), "data");
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const DEFAULT_BACKUP_DIR = process.env.NODE_ENV === "production" ? path.join(DATA_DIR, "backups") : path.join(process.cwd(), "backups");
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR);
const DB_PATH = path.resolve(process.env.SQLITE_PATH || path.join(DATA_DIR, "marfan.sqlite"));
const DOCUMENT_UPLOAD_DIR = path.join(DATA_DIR, "uploads", "documents");
const AUTO_BACKUP_ON_START = process.env.AUTO_BACKUP_ON_START !== "false";
const SEED_DEMO_DATA = envFlag("MARFAN_SEED_DEMO_DATA", process.env.NODE_ENV !== "production");
const SEED_REAL_DATA = envFlag("MARFAN_SEED_REAL_DATA", true);
const PRODUCTION_SEED_PATH = path.resolve(
  process.env.MARFAN_REAL_DATA_SEED_PATH || path.join(process.cwd(), "seed", "production-data.json")
);
const PRODUCTION_SUPERADMIN_ID = process.env.MARFAN_SUPERADMIN_ID || "usr_german";
const PRODUCTION_SUPERADMIN_NAME = process.env.MARFAN_SUPERADMIN_NAME || "German";
const PRODUCTION_SUPERADMIN_EMAIL = process.env.MARFAN_SUPERADMIN_EMAIL || "info@marquee.es";
const PRODUCTION_SUPERADMIN_PHONE = process.env.MARFAN_SUPERADMIN_PHONE || null;
const PRODUCTION_SUPERADMIN_PASSWORD = process.env.MARFAN_SUPERADMIN_PASSWORD || "Marquee2026!";

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(String(raw).trim().toLowerCase());
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });

applyPendingRestore();

const wasNewDatabase = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

function exec(sql) {
  db.exec(sql);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyPendingRestore() {
  const markerPath = path.join(DATA_DIR, "restore-request.json");
  if (!fs.existsSync(markerPath)) return;

  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const backupPath = path.resolve(marker.backupPath || "");
  if (!backupPath.startsWith(`${BACKUP_DIR}${path.sep}`) || !fs.existsSync(backupPath)) {
    throw new Error("Restore request rejected: backup path is invalid.");
  }

  if (fs.existsSync(DB_PATH)) {
    const safetyPath = `${DB_PATH}.pre-restore-${Date.now()}`;
    fs.copyFileSync(DB_PATH, safetyPath);
  }

  fs.copyFileSync(backupPath, DB_PATH);
  restoreDocumentFilesFromBackupDatabase();
  fs.rmSync(markerPath);
}

const migrations = [
  {
    version: 1,
    name: "initial-erp-schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'employee')),
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        avatar_url TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tax_id TEXT,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'activo',
        city TEXT,
        lat REAL,
        lng REAL,
        hourly_rate REAL NOT NULL DEFAULT 0,
        km_rate REAL NOT NULL DEFAULT 0.24,
        diet_rate REAL NOT NULL DEFAULT 0,
        skills TEXT NOT NULL DEFAULT '[]',
        photo_url TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('vigente', 'proximo', 'caducado', 'pendiente')),
        expires_at TEXT,
        url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS availability (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('vacaciones', 'no_disponible', 'enfermedad', 'otro')),
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'aprobado',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id),
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        location TEXT NOT NULL,
        address TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        team_leader_id TEXT REFERENCES employees(id),
        required_total INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'falta_personal',
        notes TEXT,
        budget REAL NOT NULL DEFAULT 0,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_requirements (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmado',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, employee_id)
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lat REAL,
        lng REAL,
        distance_m INTEGER,
        within_radius INTEGER NOT NULL DEFAULT 0,
        accepted INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('baja', 'media', 'alta', 'critica')),
        status TEXT NOT NULL DEFAULT 'abierta',
        title TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS allowances (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        km REAL NOT NULL DEFAULT 0,
        diet REAL NOT NULL DEFAULT 0,
        night_hours REAL NOT NULL DEFAULT 0,
        extras REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS delivery_notes (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'borrador',
        signature_name TEXT,
        signature_dni TEXT,
        signed_at TEXT,
        pdf_path TEXT,
        locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('manual', 'auto', 'safety')),
        label TEXT NOT NULL,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
      CREATE INDEX IF NOT EXISTS idx_assignments_event ON assignments(event_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_employee ON assignments(employee_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_event_employee ON time_entries(event_id, employee_id);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, used_at);
    `
  },
  {
    version: 2,
    name: "real-data-documents-and-delivery-notes",
    sql: `
      ALTER TABLE clients ADD COLUMN legal_name TEXT;
      ALTER TABLE clients ADD COLUMN province TEXT;
      ALTER TABLE clients ADD COLUMN source_ref TEXT;

      ALTER TABLE employees ADD COLUMN dni TEXT;
      ALTER TABLE employees ADD COLUMN social_security_number TEXT;
      ALTER TABLE employees ADD COLUMN bank_account TEXT;
      ALTER TABLE employees ADD COLUMN address TEXT;
      ALTER TABLE employees ADD COLUMN province TEXT;
      ALTER TABLE employees ADD COLUMN postal_code TEXT;
      ALTER TABLE employees ADD COLUMN birth_date TEXT;
      ALTER TABLE employees ADD COLUMN shirt_size TEXT;
      ALTER TABLE employees ADD COLUMN pants_size TEXT;
      ALTER TABLE employees ADD COLUMN shoe_size TEXT;
      ALTER TABLE employees ADD COLUMN jacket_size TEXT;
      ALTER TABLE employees ADD COLUMN epi_size TEXT;
      ALTER TABLE employees ADD COLUMN emergency_contact TEXT;
      ALTER TABLE employees ADD COLUMN source_ref TEXT;
      ALTER TABLE employees ADD COLUMN imported_at TEXT;

      ALTER TABLE documents ADD COLUMN file_name TEXT;
      ALTER TABLE documents ADD COLUMN file_mime TEXT;
      ALTER TABLE documents ADD COLUMN file_size INTEGER;
      ALTER TABLE documents ADD COLUMN storage_path TEXT;
      ALTER TABLE documents ADD COLUMN uploaded_at TEXT;
      ALTER TABLE documents ADD COLUMN uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE delivery_notes ADD COLUMN signature_image TEXT;
      ALTER TABLE delivery_notes ADD COLUMN service_price REAL;
      ALTER TABLE delivery_notes ADD COLUMN client_notes TEXT;

      CREATE TABLE IF NOT EXISTS data_imports (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        rows_read INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni);
      CREATE INDEX IF NOT EXISTS idx_clients_tax_id ON clients(tax_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_event ON delivery_notes(event_id);
      CREATE INDEX IF NOT EXISTS idx_data_imports_source ON data_imports(source);
    `
  },
  {
    version: 3,
    name: "pricing-settings-google-location",
    sql: `
      CREATE TABLE IF NOT EXISTS company_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS work_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        base_price REAL NOT NULL DEFAULT 0,
        night_price REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE events ADD COLUMN google_maps_url TEXT;
      ALTER TABLE events ADD COLUMN vehicle_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE events ADD COLUMN base_distance_km REAL NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN billable_km REAL NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN kilometre_price REAL NOT NULL DEFAULT 0.37;
      ALTER TABLE events ADD COLUMN role_price_total REAL NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN night_price_total REAL NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN distance_price_total REAL NOT NULL DEFAULT 0;
      ALTER TABLE events ADD COLUMN service_price REAL NOT NULL DEFAULT 0;

      INSERT OR IGNORE INTO company_settings (key, value) VALUES
        ('base_address', 'Calle Ciro Alegría 89, Málaga'),
        ('base_lat', '36.72130'),
        ('base_lng', '-4.42164'),
        ('included_km', '20'),
        ('vehicle_km_price', '0.37'),
        ('office_phone', '+34910000000'),
        ('office_whatsapp', '34910000000');

      INSERT OR IGNORE INTO work_roles (id, name, base_price, night_price) VALUES
        ('role_montaje', 'Montaje', 18, 24),
        ('role_carga', 'Carga y descarga', 18, 24),
        ('role_tecnico', 'Tecnico', 28, 36),
        ('role_runner', 'Runner', 18, 24),
        ('role_jefe', 'Jefe de equipo', 24, 32),
        ('role_carretillero', 'Carretillero', 24, 32),
        ('role_limpieza', 'Limpieza', 16, 22),
        ('role_auxiliar_produccion', 'Auxiliar produccion', 20, 28),
        ('role_operario', 'Operario', 18, 24);

      CREATE INDEX IF NOT EXISTS idx_work_roles_active ON work_roles(active);
    `
  },
  {
    version: 4,
    name: "password-reset-tokens",
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, used_at);
    `
  },
  {
    version: 5,
    name: "google-calendar-import-links",
    sql: `
      ALTER TABLE events ADD COLUMN google_calendar_uid TEXT;
      ALTER TABLE events ADD COLUMN google_calendar_source TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_google_calendar_uid
        ON events(google_calendar_uid)
        WHERE google_calendar_uid IS NOT NULL;
    `
  },
  {
    version: 6,
    name: "google-calendar-write-sync",
    sql: `
      ALTER TABLE events ADD COLUMN google_calendar_event_id TEXT;
      ALTER TABLE events ADD COLUMN google_calendar_html_link TEXT;
      ALTER TABLE events ADD COLUMN google_sync_status TEXT;
      ALTER TABLE events ADD COLUMN google_sync_error TEXT;
      ALTER TABLE events ADD COLUMN google_synced_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_events_google_calendar_event_id
        ON events(google_calendar_event_id)
        WHERE google_calendar_event_id IS NOT NULL;
    `
  },
  {
    version: 7,
    name: "event-history-snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS event_snapshots (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        payload TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_snapshots_event_created
        ON event_snapshots(event_id, created_at DESC);
    `
  },
  {
    version: 8,
    name: "time-entry-gps-accuracy",
    sql: `
      ALTER TABLE time_entries ADD COLUMN gps_accuracy_m REAL;
    `
  },
  {
    version: 9,
    name: "time-entry-device-evidence",
    sql: `
      ALTER TABLE time_entries ADD COLUMN ip_address TEXT;
      ALTER TABLE time_entries ADD COLUMN user_agent TEXT;
    `
  },
  {
    version: 10,
    name: "admin-module-permissions",
    sql: `
      ALTER TABLE users ADD COLUMN permissions_json TEXT;
    `
  },
  {
    version: 11,
    name: "incident-resolution-note",
    sql: `
      ALTER TABLE incidents ADD COLUMN resolution_note TEXT;
    `
  },
  {
    version: 12,
    name: "time-entry-correction-trace",
    sql: `
      ALTER TABLE time_entries ADD COLUMN corrected_at TEXT;
      ALTER TABLE time_entries ADD COLUMN corrected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE time_entries ADD COLUMN correction_reason TEXT;
    `
  },
  {
    version: 13,
    name: "event-snapshot-integrity-hash",
    sql: `
      ALTER TABLE event_snapshots ADD COLUMN payload_hash TEXT;
      CREATE INDEX IF NOT EXISTS idx_event_snapshots_payload_hash
        ON event_snapshots(payload_hash);
    `
  },
  {
    version: 14,
    name: "delivery-note-drafts-for-events",
    sql: `
      INSERT INTO delivery_notes (id, event_id, status, service_price, locked)
      SELECT 'dn_' || events.id,
             events.id,
             'borrador',
             COALESCE(events.service_price, events.budget, 0),
             0
      FROM events
      WHERE NOT EXISTS (
        SELECT 1 FROM delivery_notes WHERE delivery_notes.event_id = events.id
      );
    `
  },
  {
    version: 15,
    name: "event-location-source",
    sql: `
      ALTER TABLE events ADD COLUMN location_source TEXT;
    `
  },
  {
    version: 16,
    name: "event-documents",
    sql: `
      CREATE TABLE IF NOT EXISTS event_documents (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'Operativo',
        name TEXT NOT NULL,
        notes TEXT,
        visible_to_employee INTEGER NOT NULL DEFAULT 1,
        file_name TEXT,
        file_mime TEXT,
        file_size INTEGER,
        storage_path TEXT,
        uploaded_at TEXT,
        uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_documents_event ON event_documents(event_id);
    `
  },
  {
    version: 17,
    name: "soft-delete-clients-employees",
    sql: `
      ALTER TABLE clients ADD COLUMN archived_at TEXT;
      ALTER TABLE employees ADD COLUMN archived_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_clients_archived_at ON clients(archived_at);
      CREATE INDEX IF NOT EXISTS idx_employees_archived_at ON employees(archived_at);
    `
  },
  {
    version: 18,
    name: "user-security-state",
    sql: `
      ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN locked_until TEXT;
      ALTER TABLE users ADD COLUMN last_failed_login_at TEXT;
      ALTER TABLE users ADD COLUMN password_changed_at TEXT;

      UPDATE users
         SET password_changed_at = COALESCE(password_changed_at, created_at, CURRENT_TIMESTAMP);

      CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);
    `
  },
  {
    version: 19,
    name: "user-temporary-password-state",
    sql: `
      ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_users_must_change_password ON users(must_change_password);
    `
  },
  {
    version: 20,
    name: "session-device-audit",
    sql: `
      ALTER TABLE sessions ADD COLUMN session_id TEXT;
      ALTER TABLE sessions ADD COLUMN ip_address TEXT;
      ALTER TABLE sessions ADD COLUMN user_agent TEXT;
      ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

      UPDATE sessions
         SET session_id = COALESCE(session_id, 'ses_' || lower(hex(randomblob(12)))),
             last_seen_at = COALESCE(last_seen_at, created_at, CURRENT_TIMESTAMP);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
    `
  },
  {
    version: 21,
    name: "user-access-review",
    sql: `
      ALTER TABLE users ADD COLUMN access_reviewed_at TEXT;
      ALTER TABLE users ADD COLUMN access_reviewed_by_user_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_users_access_reviewed_at ON users(access_reviewed_at);
    `
  }
];

function applyMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(all("SELECT version FROM schema_migrations").map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    transaction(() => {
      db.exec(migration.sql);
      run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
        migration.version,
        migration.name
      ]);
    });
  }
}

function addUser({ id, role, name, email, phone, password }) {
  const credentials = hashPassword(password);
  run(
    `INSERT INTO users (id, role, name, email, phone, password_hash, salt, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, role, name, email, phone, credentials.hash, credentials.salt]
  );
}

const PRODUCTION_USER_SEED_COLUMNS = [
  "id",
  "role",
  "name",
  "email",
  "phone",
  "password_hash",
  "salt",
  "avatar_url",
  "active",
  "last_login_at",
  "created_at",
  "permissions_json"
];

const PRODUCTION_CLIENT_SEED_COLUMNS = [
  "id",
  "name",
  "tax_id",
  "contact_name",
  "email",
  "phone",
  "address",
  "notes",
  "created_at",
  "legal_name",
  "province",
  "source_ref"
];

const PRODUCTION_EMPLOYEE_SEED_COLUMNS = [
  "id",
  "user_id",
  "name",
  "role",
  "phone",
  "email",
  "status",
  "city",
  "lat",
  "lng",
  "hourly_rate",
  "km_rate",
  "diet_rate",
  "skills",
  "photo_url",
  "notes",
  "created_at",
  "dni",
  "social_security_number",
  "bank_account",
  "address",
  "province",
  "postal_code",
  "birth_date",
  "shirt_size",
  "pants_size",
  "shoe_size",
  "jacket_size",
  "epi_size",
  "emergency_contact",
  "source_ref",
  "imported_at"
];

const PRODUCTION_SEED_TABLES = [
  { table: "company_settings", conflictColumn: "key", columns: ["key", "value", "updated_at"] },
  { table: "work_roles", columns: ["id", "name", "base_price", "night_price", "active", "created_at"] },
  { table: "users", columns: PRODUCTION_USER_SEED_COLUMNS },
  { table: "clients", columns: PRODUCTION_CLIENT_SEED_COLUMNS },
  { table: "employees", columns: PRODUCTION_EMPLOYEE_SEED_COLUMNS },
  {
    table: "documents",
    columns: [
      "id", "employee_id", "type", "name", "status", "expires_at", "url", "created_at",
      "file_name", "file_mime", "file_size", "storage_path", "uploaded_at", "uploaded_by_user_id"
    ]
  },
  { table: "availability", columns: ["id", "employee_id", "start_date", "end_date", "type", "reason", "status", "created_at"] },
  {
    table: "events",
    columns: [
      "id", "name", "client_id", "date", "start_time", "end_time", "location", "address", "lat", "lng",
      "team_leader_id", "required_total", "status", "notes", "budget", "closed_at", "created_at",
      "google_maps_url", "vehicle_count", "base_distance_km", "billable_km", "kilometre_price",
      "role_price_total", "night_price_total", "distance_price_total", "service_price",
      "google_calendar_uid", "google_calendar_source", "google_calendar_event_id",
      "google_calendar_html_link", "google_sync_status", "google_sync_error", "google_synced_at",
      "location_source"
    ]
  },
  { table: "event_requirements", columns: ["id", "event_id", "role", "count"] },
  { table: "assignments", columns: ["id", "event_id", "employee_id", "role", "status", "created_at"] },
  {
    table: "time_entries",
    columns: [
      "id", "event_id", "employee_id", "type", "timestamp", "lat", "lng", "distance_m", "within_radius",
      "accepted", "notes", "created_at", "gps_accuracy_m", "ip_address", "user_agent", "corrected_at",
      "corrected_by_user_id", "correction_reason"
    ]
  },
  {
    table: "incidents",
    columns: [
      "id", "event_id", "employee_id", "type", "priority", "status", "title", "description",
      "created_at", "resolved_at", "resolution_note"
    ]
  },
  { table: "allowances", columns: ["id", "event_id", "employee_id", "km", "diet", "night_hours", "extras", "created_at"] },
  {
    table: "delivery_notes",
    columns: [
      "id", "event_id", "status", "signature_name", "signature_dni", "signed_at", "pdf_path", "locked",
      "created_at", "signature_image", "service_price", "client_notes"
    ]
  },
  { table: "data_imports", columns: ["id", "source", "rows_read", "inserted", "updated", "skipped", "metadata", "created_at"] },
  { table: "event_snapshots", columns: ["id", "event_id", "action", "actor_user_id", "payload", "metadata", "created_at", "payload_hash"] }
];

function seedProductionInstall() {
  transaction(() => {
    addUser({
      id: PRODUCTION_SUPERADMIN_ID,
      role: "super_admin",
      name: PRODUCTION_SUPERADMIN_NAME,
      email: PRODUCTION_SUPERADMIN_EMAIL,
      phone: PRODUCTION_SUPERADMIN_PHONE,
      password: PRODUCTION_SUPERADMIN_PASSWORD
    });
  });
}

function productionSuperAdminCandidate() {
  return get("SELECT * FROM users WHERE lower(email) = lower(?)", [PRODUCTION_SUPERADMIN_EMAIL])
    || get("SELECT * FROM users WHERE id = ?", [PRODUCTION_SUPERADMIN_ID])
    || get("SELECT * FROM users WHERE id = 'usr_super'");
}

function ensureProductionSuperAdminAccess({ resetPassword = false, clearSessions = false } = {}) {
  return transaction(() => {
    const existing = productionSuperAdminCandidate();
    const userId = existing?.id || PRODUCTION_SUPERADMIN_ID;
    const credentials = resetPassword || !existing ? hashPassword(PRODUCTION_SUPERADMIN_PASSWORD) : null;

    if (existing) {
      run(
        `UPDATE users
         SET role = 'super_admin',
             name = ?,
             email = ?,
             phone = ?,
             password_hash = COALESCE(?, password_hash),
             salt = COALESCE(?, salt),
             password_changed_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE password_changed_at END,
             failed_login_count = CASE WHEN ? IS NOT NULL THEN 0 ELSE failed_login_count END,
             locked_until = CASE WHEN ? IS NOT NULL THEN NULL ELSE locked_until END,
             last_failed_login_at = CASE WHEN ? IS NOT NULL THEN NULL ELSE last_failed_login_at END,
             permissions_json = NULL,
             active = 1
         WHERE id = ?`,
        [
          PRODUCTION_SUPERADMIN_NAME,
          PRODUCTION_SUPERADMIN_EMAIL,
          PRODUCTION_SUPERADMIN_PHONE,
          credentials?.hash || null,
          credentials?.salt || null,
          credentials?.hash || null,
          credentials?.hash || null,
          credentials?.hash || null,
          credentials?.hash || null,
          userId
        ]
      );
    } else {
      run(
        `INSERT INTO users (id, role, name, email, phone, password_hash, salt, permissions_json, active, password_changed_at)
         VALUES (?, 'super_admin', ?, ?, ?, ?, ?, NULL, 1, CURRENT_TIMESTAMP)`,
        [
          userId,
          PRODUCTION_SUPERADMIN_NAME,
          PRODUCTION_SUPERADMIN_EMAIL,
          PRODUCTION_SUPERADMIN_PHONE,
          credentials.hash,
          credentials.salt
        ]
      );
    }

    if (clearSessions) {
      run("DELETE FROM sessions WHERE user_id = ?", [userId]);
      run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [userId]);
    }

    return {
      id: userId,
      name: PRODUCTION_SUPERADMIN_NAME,
      email: PRODUCTION_SUPERADMIN_EMAIL,
      passwordReset: Boolean(credentials)
    };
  });
}

function rowValues(row, columns) {
  return columns.map((column) => Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null);
}

function upsertSeedRows(table, columns, rows = [], conflictColumn = "id") {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== conflictColumn)
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const conflictAction = updates ? `DO UPDATE SET ${updates}` : "DO NOTHING";
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
    ON CONFLICT(${conflictColumn}) ${conflictAction}`;
  for (const row of rows) {
    run(sql, rowValues(row, columns));
  }
  return rows.length;
}

function seedBundledProductionData() {
  if (!SEED_REAL_DATA || !fs.existsSync(PRODUCTION_SEED_PATH)) return;
  const seed = JSON.parse(fs.readFileSync(PRODUCTION_SEED_PATH, "utf8"));
  transaction(() => {
    for (const { table, columns, conflictColumn = "id" } of PRODUCTION_SEED_TABLES) {
      upsertSeedRows(table, columns, seed[table] || [], conflictColumn);
    }
    run("UPDATE users SET password_changed_at = COALESCE(password_changed_at, created_at, CURRENT_TIMESTAMP)");
  });
}

function ensureEventDeliveryNoteDrafts() {
  run(
    `INSERT INTO delivery_notes (id, event_id, status, service_price, locked)
     SELECT 'dn_' || events.id,
            events.id,
            'borrador',
            COALESCE(events.service_price, events.budget, 0),
            0
     FROM events
     WHERE NOT EXISTS (
       SELECT 1 FROM delivery_notes WHERE delivery_notes.event_id = events.id
     )`
  );
}

const EMPLOYEE_PHONE_PORTAL_SYNC_KEY = "employee_phone_portal_sync_v1";

function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function employeePhoneLoginKey(value) {
  const digits = phoneDigits(value);
  if (digits.length < 9) return "";
  const withoutInternationalPrefix = digits.startsWith("0034")
    ? digits.slice(4)
    : digits.startsWith("34") && digits.length > 9
      ? digits.slice(2)
      : digits;
  return withoutInternationalPrefix.length >= 9 ? withoutInternationalPrefix.slice(-9) : "";
}

function cleanEmployeeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email || "";
}

function findUserWithEmail(email, excludeUserId = "") {
  if (!email) return null;
  return get(
    "SELECT * FROM users WHERE lower(email) = lower(?) AND id != ? LIMIT 1",
    [email, excludeUserId]
  );
}

function usersWithPhoneKey(phoneKey, excludeUserId = "") {
  if (!phoneKey) return [];
  return all(
    "SELECT * FROM users WHERE id != ? AND phone IS NOT NULL AND trim(phone) != ''",
    [excludeUserId]
  ).filter((user) => employeePhoneLoginKey(user.phone) === phoneKey);
}

function findEmployeePortalUser(employee, phoneKey) {
  if (employee.user_id) {
    const linked = get("SELECT * FROM users WHERE id = ?", [employee.user_id]);
    if (linked) return linked;
  }
  const email = cleanEmployeeEmail(employee.email);
  if (email) {
    const byEmail = get("SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1", [email]);
    if (byEmail) return byEmail;
  }
  const matches = usersWithPhoneKey(phoneKey).filter((user) => user.role === "employee");
  return matches.length === 1 ? matches[0] : null;
}

function ensureEmployeePhonePortalAccess() {
  if (get("SELECT value FROM company_settings WHERE key = ?", [EMPLOYEE_PHONE_PORTAL_SYNC_KEY])) {
    return null;
  }

  const employeeCount = get("SELECT COUNT(*) AS count FROM employees").count;
  if (!employeeCount || (SEED_DEMO_DATA && employeeCount < 20)) return null;

  const employees = all("SELECT * FROM employees ORDER BY name");
  const stats = {
    employees: employees.length,
    phonesNormalized: 0,
    usersCreated: 0,
    usersUpdated: 0,
    skipped: []
  };
  const safetyBackup = wasNewDatabase ? null : createBackup("safety", "Backup previo a normalizacion accesos operarios");

  transaction(() => {
    for (const employee of employees) {
      const phoneKey = employeePhoneLoginKey(employee.phone);
      if (!phoneKey) {
        stats.skipped.push({ employeeId: employee.id, name: employee.name, reason: "telefono no valido" });
        continue;
      }

      const currentEmployeePhone = String(employee.phone || "");
      const email = cleanEmployeeEmail(employee.email);
      let portalUser = findEmployeePortalUser(employee, phoneKey);
      if (portalUser && portalUser.role !== "employee") {
        stats.skipped.push({
          employeeId: employee.id,
          name: employee.name,
          reason: "telefono o email pertenece a administrador"
        });
        run("UPDATE employees SET phone = ?, status = 'activo' WHERE id = ?", [phoneKey, employee.id]);
        if (currentEmployeePhone !== phoneKey) stats.phonesNormalized += 1;
        continue;
      }

      const phoneConflicts = usersWithPhoneKey(phoneKey, portalUser?.id || "");
      if (phoneConflicts.length) {
        stats.skipped.push({
          employeeId: employee.id,
          name: employee.name,
          reason: "telefono duplicado"
        });
        run("UPDATE employees SET phone = ?, status = 'activo' WHERE id = ?", [phoneKey, employee.id]);
        if (currentEmployeePhone !== phoneKey) stats.phonesNormalized += 1;
        continue;
      }

      const credentials = hashPassword(phoneKey);
      const safeEmail = email && !findUserWithEmail(email, portalUser?.id || "") ? email : "";
      if (portalUser) {
        run(
          `UPDATE users
           SET role = 'employee',
               name = ?,
               email = COALESCE(NULLIF(?, ''), email),
               phone = ?,
               password_hash = ?,
               salt = ?,
               password_changed_at = CURRENT_TIMESTAMP,
               failed_login_count = 0,
               locked_until = NULL,
               last_failed_login_at = NULL,
               active = 1
           WHERE id = ?`,
          [employee.name, safeEmail, phoneKey, credentials.hash, credentials.salt, portalUser.id]
        );
        run("DELETE FROM sessions WHERE user_id = ?", [portalUser.id]);
        run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [
          portalUser.id
        ]);
        stats.usersUpdated += 1;
      } else {
        const userId = randomId("usr");
        run(
          `INSERT INTO users (id, role, name, email, phone, password_hash, salt, active, password_changed_at)
           VALUES (?, 'employee', ?, NULLIF(?, ''), ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
          [userId, employee.name, safeEmail, phoneKey, credentials.hash, credentials.salt]
        );
        portalUser = { id: userId };
        stats.usersCreated += 1;
      }

      run("UPDATE employees SET user_id = ?, phone = ?, status = 'activo' WHERE id = ?", [
        portalUser.id,
        phoneKey,
        employee.id
      ]);
      if (currentEmployeePhone !== phoneKey) stats.phonesNormalized += 1;
    }

    run(
      `INSERT INTO company_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [EMPLOYEE_PHONE_PORTAL_SYNC_KEY, JSON.stringify(stats)]
    );
  });

  return { ...stats, safetyBackup };
}

function seedIfNewInstall() {
  if (!wasNewDatabase) return;
  if (!SEED_DEMO_DATA) {
    seedProductionInstall();
    seedBundledProductionData();
    ensureProductionSuperAdminAccess({ resetPassword: true, clearSessions: true });
    return;
  }

  const today = new Date();
  const iso = (offsetDays = 0) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().slice(0, 10);
  };

  const superId = "usr_super";
  const adminId = "usr_admin";
  const employeeUserId = "usr_employee_alex";
  const leaderUserId = "usr_leader_carlos";

  transaction(() => {
    addUser({
      id: superId,
      role: "super_admin",
      name: "Super Admin",
      email: "super@marfancrew.test",
      phone: "+34910000001",
      password: "super123"
    });
    addUser({
      id: adminId,
      role: "admin",
      name: "Antonio Ruiz",
      email: "admin@marfancrew.test",
      phone: "+34910000002",
      password: "admin123"
    });
    addUser({
      id: leaderUserId,
      role: "employee",
      name: "Carlos Martin",
      email: "carlos@marfancrew.test",
      phone: "+34600123456",
      password: "empleado123"
    });
    addUser({
      id: employeeUserId,
      role: "employee",
      name: "Alejandro Perez",
      email: "empleado@marfancrew.test",
      phone: "+34600777888",
      password: "empleado123"
    });

    const clients = [
      ["cli_tech", "Tech Events S.L.", "B66900123", "Marta Molina", "ops@techevents.test", "+34931234001", "Barcelona", "Cliente con alta rotacion de montaje."],
      ["cli_aecc", "AECOC", "G08400112", "Laura Serra", "eventos@aecoc.test", "+34931234002", "Barcelona", "Congresos y convenciones."],
      ["cli_bmw", "BMW Group Espana", "A28713642", "Javier Cano", "brand@bmw.test", "+34911234003", "Madrid", "Presentaciones premium."],
      ["cli_live", "Live Nation Espana", "B81234567", "Paula Rios", "produccion@livenation.test", "+34911234004", "Madrid", "Eventos masivos y conciertos."],
      ["cli_heineken", "Heineken Espana", "A28006013", "Ivan Soler", "trade@heineken.test", "+34951234005", "Barcelona", "Activaciones y roadshows."]
    ];
    for (const client of clients) {
      run(
        `INSERT INTO clients (id, name, tax_id, contact_name, email, phone, address, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        client
      );
    }

    const employees = [
      ["emp_carlos", leaderUserId, "Carlos Martin", "Jefe de equipo", "+34600123456", "carlos@marfancrew.test", "Madrid", 40.4222, -3.6703, 22, 20, JSON.stringify(["montaje", "jefe", "prl"])],
      ["emp_alejandro", employeeUserId, "Alejandro Perez", "Montaje", "+34600777888", "empleado@marfancrew.test", "Madrid", 40.4220, -3.6701, 16, 12, JSON.stringify(["montaje", "carga", "runner"])],
      ["emp_lucia", null, "Lucia Ramos", "Runner", "+34600222333", "lucia@marfancrew.test", "Barcelona", 41.3725, 2.1519, 15, 11, JSON.stringify(["runner", "produccion"])],
      ["emp_marta", null, "Marta Soler", "Tecnico", "+34600444555", "marta@marfancrew.test", "Barcelona", 41.3835, 2.1760, 24, 18, JSON.stringify(["tecnico", "sonido", "luces"])],
      ["emp_javier", null, "Javier Rodriguez", "Carga y descarga", "+34600666777", "javier@marfancrew.test", "Barcelona", 41.3548, 2.1291, 17, 13, JSON.stringify(["carga", "carretilla"])],
      ["emp_nerea", null, "Nerea Vidal", "Limpieza", "+34600888999", "nerea@marfancrew.test", "Madrid", 40.4168, -3.7038, 14, 10, JSON.stringify(["limpieza", "office"])],
      ["emp_omar", null, "Omar Benali", "Carretillero", "+34600999000", "omar@marfancrew.test", "Barcelona", 41.3874, 2.1686, 21, 16, JSON.stringify(["carretilla", "carga"])],
      ["emp_ana", null, "Ana Torres", "Auxiliar produccion", "+34600555111", "ana@marfancrew.test", "Madrid", 40.4381, -3.8196, 18, 14, JSON.stringify(["produccion", "runner"])]
    ];
    for (const employee of employees) {
      run(
        `INSERT INTO employees
          (id, user_id, name, role, phone, email, city, lat, lng, hourly_rate, diet_rate, skills)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        employee
      );
    }

    const documents = [
      ["doc_carlos_prl", "emp_carlos", "PRL", "Prevencion de riesgos", "vigente", iso(120)],
      ["doc_carlos_dni", "emp_carlos", "DNI", "Documento identidad", "vigente", iso(700)],
      ["doc_ale_prl", "emp_alejandro", "PRL", "Prevencion de riesgos", "vigente", iso(90)],
      ["doc_ale_epi", "emp_alejandro", "EPI", "Entrega de EPIs", "proximo", iso(12)],
      ["doc_javier_prl", "emp_javier", "PRL", "Prevencion de riesgos", "caducado", iso(-7)],
      ["doc_lucia_contrato", "emp_lucia", "Contrato", "Contrato marco", "pendiente", null]
    ];
    for (const document of documents) {
      run(
        `INSERT INTO documents (id, employee_id, type, name, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        document
      );
    }

    const events = [
      ["evt_tech", "Feria Tech Barcelona", "cli_tech", iso(0), "08:00", "14:00", "Fira Barcelona", "Av. Joan Carles I, Barcelona", 41.3548, 2.1291, "emp_carlos", 8, "completo", "Montaje stands pabellon 4", 9800],
      ["evt_aecoc", "Congreso AECOC 2026", "cli_aecc", iso(0), "09:00", "18:00", "CCIB Barcelona", "Placa de Willy Brandt, Barcelona", 41.4122, 2.2199, "emp_carlos", 9, "falta_personal", "Acreditaciones y apoyo sala", 14200],
      ["evt_bmw", "Presentacion BMW i7", "cli_bmw", iso(0), "10:00", "16:00", "Casa Seat", "Pg. de Gracia, Barcelona", 41.3926, 2.1649, "emp_marta", 6, "completo", "Produccion premium", 11200],
      ["evt_heineken", "Activacion Heineken", "cli_heineken", iso(0), "10:30", "20:00", "Port Olimpic", "Moll de Gregal, Barcelona", 41.3865, 2.2007, null, 7, "sin_jefe", "Sin jefe confirmado", 8600],
      ["evt_live", "Concierto Melendi", "cli_live", iso(0), "16:00", "00:30", "WiZink Center", "Av. Felipe II, s/n, Madrid", 40.4239, -3.6718, "emp_carlos", 11, "falta_personal", "Refuerzo accesos y montaje", 19800],
      ["evt_roadshow", "Roadshow Vodafone", "cli_tech", iso(1), "12:30", "16:30", "Pl. Catalunya", "Barcelona", 41.3869, 2.1700, "emp_lucia", 5, "critico", "Falta documentacion y dos perfiles", 6200],
      ["evt_closed", "Jornada Distribuidores", "cli_bmw", iso(-1), "15:00", "19:00", "IFEMA Madrid", "Av. Partenon, Madrid", 40.4689, -3.6164, "emp_ana", 8, "finalizado", "Evento cerrado", 7200]
    ];
    for (const event of events) {
      run(
        `INSERT INTO events
          (id, name, client_id, date, start_time, end_time, location, address, lat, lng, team_leader_id, required_total, status, notes, budget)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event
      );
    }

    const requirements = [
      ["evt_tech", "Montaje", 5],
      ["evt_tech", "Runner", 1],
      ["evt_tech", "Jefe de equipo", 1],
      ["evt_tech", "Tecnico", 1],
      ["evt_aecoc", "Auxiliar produccion", 3],
      ["evt_aecoc", "Runner", 2],
      ["evt_aecoc", "Montaje", 4],
      ["evt_live", "Montaje", 6],
      ["evt_live", "Jefe de equipo", 1],
      ["evt_live", "Limpieza", 2],
      ["evt_live", "Runner", 2],
      ["evt_heineken", "Montaje", 4],
      ["evt_heineken", "Runner", 2],
      ["evt_heineken", "Jefe de equipo", 1]
    ];
    for (const [eventId, role, count] of requirements) {
      run("INSERT INTO event_requirements (id, event_id, role, count) VALUES (?, ?, ?, ?)", [
        randomId("req"),
        eventId,
        role,
        count
      ]);
    }

    const assignments = [
      ["evt_tech", "emp_carlos", "Jefe de equipo"],
      ["evt_tech", "emp_lucia", "Runner"],
      ["evt_tech", "emp_marta", "Tecnico"],
      ["evt_tech", "emp_javier", "Carga y descarga"],
      ["evt_tech", "emp_omar", "Carretillero"],
      ["evt_aecoc", "emp_carlos", "Jefe de equipo"],
      ["evt_aecoc", "emp_lucia", "Runner"],
      ["evt_aecoc", "emp_javier", "Carga y descarga"],
      ["evt_bmw", "emp_marta", "Tecnico"],
      ["evt_bmw", "emp_ana", "Auxiliar produccion"],
      ["evt_bmw", "emp_nerea", "Limpieza"],
      ["evt_live", "emp_carlos", "Jefe de equipo"],
      ["evt_live", "emp_alejandro", "Montaje"],
      ["evt_live", "emp_nerea", "Limpieza"],
      ["evt_live", "emp_ana", "Auxiliar produccion"],
      ["evt_heineken", "emp_javier", "Carga y descarga"],
      ["evt_heineken", "emp_omar", "Carretillero"],
      ["evt_roadshow", "emp_lucia", "Runner"]
    ];
    for (const [eventId, employeeId, role] of assignments) {
      run("INSERT INTO assignments (id, event_id, employee_id, role) VALUES (?, ?, ?, ?)", [
        randomId("asg"),
        eventId,
        employeeId,
        role
      ]);
    }

    const clocked = [
      ["evt_tech", "emp_carlos", "entrada", 41.3548, 2.1291, 11, 1, 1],
      ["evt_tech", "emp_lucia", "entrada", 41.3547, 2.1294, 28, 1, 1],
      ["evt_bmw", "emp_marta", "entrada", 41.3925, 2.1650, 14, 1, 1],
      ["evt_live", "emp_carlos", "entrada", 40.4237, -3.6717, 20, 1, 1]
    ];
    for (const row of clocked) {
      run(
        `INSERT INTO time_entries
          (id, event_id, employee_id, type, lat, lng, distance_m, within_radius, accepted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomId("clk"), ...row]
      );
    }

    const incidents = [
      ["evt_aecoc", "emp_javier", "retraso", "alta", "Retraso detectado", "Operario con mas de 15 minutos de retraso."],
      ["evt_heineken", null, "documentacion", "critica", "Evento sin jefe", "El evento no tiene jefe de equipo asignado."],
      ["evt_live", "emp_alejandro", "documentacion", "media", "EPI proximo a caducar", "Renovar justificante de entrega EPI."]
    ];
    for (const incident of incidents) {
      run(
        `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomId("inc"), ...incident]
      );
    }

    run(
      `INSERT INTO availability (id, employee_id, start_date, end_date, type, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomId("ava"), "emp_javier", iso(2), iso(3), "no_disponible", "Curso carretilla"]
    );

    for (const [eventId, employeeId, km, diet, nightHours, extras] of [
      ["evt_live", "emp_alejandro", 12, 12, 1.5, 0],
      ["evt_live", "emp_carlos", 16, 12, 1.5, 20],
      ["evt_tech", "emp_lucia", 8, 0, 0, 0]
    ]) {
      run(
        `INSERT INTO allowances (id, event_id, employee_id, km, diet, night_hours, extras)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomId("all"), eventId, employeeId, km, diet, nightHours, extras]
      );
    }
  });
}

function recoverSuperAdminOnStartIfRequested() {
  if (!envFlag("MARFAN_RECOVER_SUPERADMIN_ON_START", false)) return null;
  const existing = productionSuperAdminCandidate();
  const forceReset = envFlag("MARFAN_FORCE_SUPERADMIN_RECOVERY", false);
  const configuredPasswordWorks = existing
    ? verifyPassword(PRODUCTION_SUPERADMIN_PASSWORD, existing.salt, existing.password_hash)
    : false;
  if (existing && !configuredPasswordWorks && !forceReset) {
    return {
      skippedPasswordReset: true,
      reason: "custom_password_preserved",
      superAdmin: ensureProductionSuperAdminAccess({ resetPassword: false, clearSessions: false })
    };
  }

  const recoverySignature = crypto
    .createHash("sha256")
    .update(`${PRODUCTION_SUPERADMIN_EMAIL}\n${PRODUCTION_SUPERADMIN_PASSWORD}`)
    .digest("hex");
  const markerKey = "superadmin_recovery_signature_v1";
  const previousRecovery = get("SELECT value FROM company_settings WHERE key = ?", [markerKey]);
  if (previousRecovery?.value === recoverySignature && !forceReset) {
    return {
      skippedPasswordReset: true,
      reason: "recovery_already_applied",
      superAdmin: ensureProductionSuperAdminAccess({ resetPassword: false, clearSessions: false })
    };
  }

  const safetyBackup = wasNewDatabase ? null : createBackup("safety", "Backup previo a recuperacion de superadmin");
  const superAdmin = ensureProductionSuperAdminAccess({ resetPassword: true, clearSessions: true });
  run(
    `INSERT INTO company_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [markerKey, recoverySignature]
  );
  return {
    safetyBackup,
    superAdmin
  };
}

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function documentUploadPath(storagePath) {
  const resolved = path.resolve(storagePath || "");
  const base = path.resolve(DOCUMENT_UPLOAD_DIR);
  if (!resolved.startsWith(`${base}${path.sep}`)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

function safeBackupAttachmentName(value, fallback = "documento") {
  const cleaned = path.basename(String(value || fallback))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

function embedDocumentFilesInBackup(filePath) {
  const rows = all(
    `SELECT 'employee' AS document_scope, id, storage_path, file_name, file_mime, file_size
     FROM documents
     WHERE storage_path IS NOT NULL AND storage_path != ''`
  );
  const eventDocumentTable = get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_documents'");
  if (eventDocumentTable) {
    rows.push(...all(
      `SELECT 'event' AS document_scope, id, storage_path, file_name, file_mime, file_size
       FROM event_documents
       WHERE storage_path IS NOT NULL AND storage_path != ''`
    ));
  }
  if (!rows.length) return { count: 0, bytes: 0 };

  const backupDb = new DatabaseSync(filePath);
  let count = 0;
  let bytes = 0;
  try {
    backupDb.exec(`
      DROP TABLE IF EXISTS backup_document_files;
      CREATE TABLE IF NOT EXISTS backup_document_files (
        document_id TEXT NOT NULL,
        document_scope TEXT NOT NULL DEFAULT 'employee',
        relative_path TEXT NOT NULL,
        file_name TEXT,
        file_mime TEXT,
        file_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        content BLOB NOT NULL,
        backed_up_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (document_scope, document_id)
      );
    `);
    const insert = backupDb.prepare(
      `INSERT INTO backup_document_files
        (document_id, document_scope, relative_path, file_name, file_mime, file_size, sha256, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    backupDb.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const sourcePath = documentUploadPath(row.storage_path);
        if (!sourcePath) continue;
        const content = fs.readFileSync(sourcePath);
        const fileName = safeBackupAttachmentName(row.file_name || path.basename(sourcePath), `${row.id}.bin`);
        const documentScope = row.document_scope || "employee";
        const relativePath = `${documentScope}-${row.id}-${fileName}`;
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        insert.run(row.id, documentScope, relativePath, fileName, row.file_mime || "", content.length, hash, content);
        count += 1;
        bytes += content.length;
      }
      backupDb.exec("COMMIT");
    } catch (error) {
      backupDb.exec("ROLLBACK");
      throw error;
    }
  } finally {
    backupDb.close();
  }
  return { count, bytes };
}

function backupDocumentFilesSummary(filePath) {
  const summary = {
    attachmentCount: 0,
    attachmentBytes: 0,
    attachmentIntegrity: "not_present",
    attachmentError: ""
  };
  const checkDb = new DatabaseSync(filePath, { readOnly: true });
  try {
    const table = checkDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_document_files'"
    ).get();
    if (!table) return summary;
    const columns = checkDb.prepare("PRAGMA table_info(backup_document_files)").all().map((row) => row.name);
    const scopeExpression = columns.includes("document_scope") ? "document_scope" : "'employee' AS document_scope";
    const rows = checkDb.prepare(
      `SELECT document_id, ${scopeExpression}, relative_path, file_size, sha256, content FROM backup_document_files`
    ).all();
    summary.attachmentIntegrity = "verified";
    for (const row of rows) {
      const content = Buffer.from(row.content || []);
      const expectedSize = Number(row.file_size || 0);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      summary.attachmentCount += 1;
      summary.attachmentBytes += content.length;
      if (content.length !== expectedSize || hash !== row.sha256) {
        summary.attachmentIntegrity = "corrupt";
        summary.attachmentError = `Adjunto no verificable: ${row.document_scope || "employee"}:${row.document_id || row.relative_path}`;
        break;
      }
    }
  } finally {
    checkDb.close();
  }
  return summary;
}

function restoreDocumentFilesFromBackupDatabase() {
  const restoreDb = new DatabaseSync(DB_PATH);
  try {
    const table = restoreDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_document_files'"
    ).get();
    if (!table) return { restored: 0, bytes: 0 };
    const columns = restoreDb.prepare("PRAGMA table_info(backup_document_files)").all().map((row) => row.name);
    const scopeExpression = columns.includes("document_scope") ? "document_scope" : "'employee' AS document_scope";
    const rows = restoreDb.prepare(
      `SELECT document_id, ${scopeExpression}, relative_path, file_name, file_size, sha256, content FROM backup_document_files`
    ).all();
    let restored = 0;
    let bytes = 0;
    fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });
    const updateEmployeeDocument = restoreDb.prepare("UPDATE documents SET storage_path = ? WHERE id = ?");
    const hasEventDocuments = restoreDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_documents'"
    ).get();
    const updateEventDocument = hasEventDocuments
      ? restoreDb.prepare("UPDATE event_documents SET storage_path = ? WHERE id = ?")
      : null;
    restoreDb.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const content = Buffer.from(row.content || []);
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        if (content.length !== Number(row.file_size || 0) || hash !== row.sha256) {
          throw new Error(`Restore rejected: document attachment is corrupt (${row.document_id}).`);
        }
        const relativePath = safeBackupAttachmentName(row.relative_path || row.file_name, `${row.document_id}.bin`);
        const targetPath = path.join(DOCUMENT_UPLOAD_DIR, relativePath);
        fs.writeFileSync(targetPath, content);
        if (row.document_scope === "event" && updateEventDocument) {
          updateEventDocument.run(targetPath, row.document_id);
        } else {
          updateEmployeeDocument.run(targetPath, row.document_id);
        }
        restored += 1;
        bytes += content.length;
      }
      restoreDb.exec("DROP TABLE IF EXISTS backup_document_files");
      restoreDb.exec("COMMIT");
    } catch (error) {
      restoreDb.exec("ROLLBACK");
      throw error;
    }
    return { restored, bytes };
  } finally {
    restoreDb.close();
  }
}

function verifySqliteBackupFile(filePath, expectedSize = 0) {
  const result = {
    ok: false,
    exists: false,
    sizeMatches: false,
    quickCheck: "",
    attachmentCount: 0,
    attachmentBytes: 0,
    attachmentIntegrity: "not_checked",
    error: ""
  };
  try {
    if (!fs.existsSync(filePath)) {
      result.error = "Archivo no disponible";
      return result;
    }
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      result.error = "La ruta no es un archivo";
      return result;
    }
    result.exists = true;
    result.sizeMatches = !expectedSize || Number(expectedSize) === stats.size;
    const checkDb = new DatabaseSync(filePath, { readOnly: true });
    try {
      const row = checkDb.prepare("PRAGMA quick_check").get();
      result.quickCheck = String(Object.values(row || {})[0] || "");
    } finally {
      checkDb.close();
    }
    const attachments = backupDocumentFilesSummary(filePath);
    result.attachmentCount = attachments.attachmentCount;
    result.attachmentBytes = attachments.attachmentBytes;
    result.attachmentIntegrity = attachments.attachmentIntegrity;
    result.ok = result.sizeMatches
      && result.quickCheck.toLowerCase() === "ok"
      && !["corrupt"].includes(result.attachmentIntegrity);
    if (!result.sizeMatches) result.error = "Tamano del archivo no coincide";
    else if (!result.ok) result.error = `SQLite quick_check: ${result.quickCheck || "sin resultado"}`;
    if (attachments.attachmentError) result.error = attachments.attachmentError;
    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

function createBackup(type = "manual", label = "Backup manual") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${type}-${timestamp}.sqlite`;
  const filePath = path.join(BACKUP_DIR, fileName);
  db.exec(`VACUUM INTO '${escapeSqlLiteral(filePath)}'`);
  embedDocumentFilesInBackup(filePath);
  const stats = fs.statSync(filePath);
  const backup = {
    id: randomId("bak"),
    type,
    label,
    file_path: filePath,
    size_bytes: stats.size
  };
  run(
    `INSERT INTO backups (id, type, label, file_path, size_bytes)
     VALUES (?, ?, ?, ?, ?)`,
    [backup.id, backup.type, backup.label, backup.file_path, backup.size_bytes]
  );
  return backup;
}

function ensureDailyBackup() {
  if (!AUTO_BACKUP_ON_START) return null;
  const today = new Date().toISOString().slice(0, 10);
  const existing = get(
    "SELECT id FROM backups WHERE type = 'auto' AND substr(created_at, 1, 10) = ? LIMIT 1",
    [today]
  );
  if (existing) return null;
  return createBackup("auto", "Backup automatico diario");
}

function requestRestore(backupId) {
  const backup = get("SELECT * FROM backups WHERE id = ?", [backupId]);
  if (!backup) {
    const error = new Error("Backup no encontrado");
    error.status = 404;
    throw error;
  }
  const resolved = path.resolve(backup.file_path);
  if (!resolved.startsWith(`${BACKUP_DIR}${path.sep}`) || !fs.existsSync(resolved)) {
    const error = new Error("El archivo de backup no esta disponible");
    error.status = 409;
    throw error;
  }
  const integrity = verifySqliteBackupFile(resolved, backup.size_bytes);
  if (!integrity.ok) {
    const error = new Error(`Backup no restaurable: ${integrity.error || "integridad no verificada"}`);
    error.status = 409;
    throw error;
  }
  const safetyBackup = createBackup("safety", "Backup de seguridad previo a restauracion");
  fs.writeFileSync(
    path.join(DATA_DIR, "restore-request.json"),
    JSON.stringify({
      backupId,
      backupPath: resolved,
      safetyBackupId: safetyBackup.id,
      safetyBackupPath: safetyBackup.file_path,
      requestedAt: new Date().toISOString()
    }, null, 2)
  );
  return { backup, safetyBackup };
}

applyMigrations();
seedIfNewInstall();
ensureEventDeliveryNoteDrafts();
const employeePhonePortalSync = ensureEmployeePhonePortalAccess();
const accessRecovery = recoverSuperAdminOnStartIfRequested();
ensureDailyBackup();

module.exports = {
  BACKUP_DIR,
  DATA_DIR,
  DB_PATH,
  accessRecovery,
  all,
  createBackup,
  db,
  employeePhonePortalSync,
  ensureProductionSuperAdminAccess,
  exec,
  get,
  requestRestore,
  run,
  transaction,
  verifySqliteBackupFile
};

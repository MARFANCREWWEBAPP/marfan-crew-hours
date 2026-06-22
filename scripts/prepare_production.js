#!/usr/bin/env node

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.MARFAN_SEED_DEMO_DATA = process.env.MARFAN_SEED_DEMO_DATA || "false";

const { DB_PATH, createBackup, get, run, transaction } = require("../server/db");
const { hashPassword } = require("../server/security");

const SUPERADMIN_ID = process.env.MARFAN_SUPERADMIN_ID || "usr_german";
const SUPERADMIN_NAME = process.env.MARFAN_SUPERADMIN_NAME || "German";
const SUPERADMIN_EMAIL = (process.env.MARFAN_SUPERADMIN_EMAIL || "info@marquee.es").toLowerCase();
const SUPERADMIN_PHONE = process.env.MARFAN_SUPERADMIN_PHONE || null;
const SUPERADMIN_PASSWORD = process.env.MARFAN_SUPERADMIN_PASSWORD || "Marquee2026!";

function count(table) {
  return get(`SELECT COUNT(*) AS count FROM ${table}`).count;
}

function upsertGermanSuperAdmin() {
  const existing =
    get("SELECT * FROM users WHERE lower(email) = lower(?)", [SUPERADMIN_EMAIL])
    || get("SELECT * FROM users WHERE id = ?", [SUPERADMIN_ID])
    || get("SELECT * FROM users WHERE id = 'usr_super'");
  const userId = existing?.id || SUPERADMIN_ID;
  const credentials = hashPassword(SUPERADMIN_PASSWORD);

  if (existing) {
    run(
      `UPDATE users
       SET role = 'super_admin',
           name = ?,
           email = ?,
           phone = ?,
           password_hash = ?,
           salt = ?,
           permissions_json = NULL,
           active = 1
       WHERE id = ?`,
      [
        SUPERADMIN_NAME,
        SUPERADMIN_EMAIL,
        SUPERADMIN_PHONE,
        credentials.hash,
        credentials.salt,
        userId
      ]
    );
  } else {
    run(
      `INSERT INTO users (id, role, name, email, phone, password_hash, salt, permissions_json, active)
       VALUES (?, 'super_admin', ?, ?, ?, ?, ?, NULL, 1)`,
      [
        userId,
        SUPERADMIN_NAME,
        SUPERADMIN_EMAIL,
        SUPERADMIN_PHONE,
        credentials.hash,
        credentials.salt
      ]
    );
  }

  return userId;
}

const before = {
  users: count("users"),
  employees: count("employees"),
  clients: count("clients"),
  events: count("events"),
  assignments: count("assignments")
};

const safetyBackup = createBackup("safety", "Backup previo a preparacion de produccion");

let summary;
transaction(() => {
  const superAdminId = upsertGermanSuperAdmin();

  run("DELETE FROM sessions");
  run("DELETE FROM password_reset_tokens");

  summary = {
    superAdminId,
    sessionsCleared: true
  };
});

const after = {
  users: count("users"),
  employees: count("employees"),
  clients: count("clients"),
  events: count("events"),
  assignments: count("assignments")
};

for (const key of ["employees", "clients", "events", "assignments"]) {
  if (after[key] < before[key]) {
    throw new Error(`Proteccion de datos: ${key} bajo de ${before[key]} a ${after[key]}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  database: DB_PATH,
  safetyBackup: {
    id: safetyBackup.id,
    filePath: safetyBackup.file_path,
    sizeBytes: safetyBackup.size_bytes
  },
  superAdmin: {
    id: summary.superAdminId,
    name: SUPERADMIN_NAME,
    email: SUPERADMIN_EMAIL
  },
  action: "superadmin_prepared_without_deleting_business_data",
  before,
  after
}, null, 2));

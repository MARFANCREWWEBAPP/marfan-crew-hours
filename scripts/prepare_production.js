#!/usr/bin/env node

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.MARFAN_SEED_DEMO_DATA = process.env.MARFAN_SEED_DEMO_DATA || "false";

const { DB_PATH, createBackup, ensureProductionSuperAdminAccess, get } = require("../server/db");

const SUPERADMIN_NAME = process.env.MARFAN_SUPERADMIN_NAME || "German";
const SUPERADMIN_EMAIL = (process.env.MARFAN_SUPERADMIN_EMAIL || "info@marquee.es").toLowerCase();

function count(table) {
  return get(`SELECT COUNT(*) AS count FROM ${table}`).count;
}

const before = {
  users: count("users"),
  employees: count("employees"),
  clients: count("clients"),
  events: count("events"),
  assignments: count("assignments")
};

const safetyBackup = createBackup("safety", "Backup previo a preparacion de produccion");

const summary = ensureProductionSuperAdminAccess({ resetPassword: true, clearSessions: true });

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
    id: summary.id,
    name: SUPERADMIN_NAME,
    email: SUPERADMIN_EMAIL
  },
  sessionsCleared: true,
  action: "superadmin_prepared_without_deleting_business_data",
  before,
  after
}, null, 2));

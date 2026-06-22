#!/usr/bin/env node

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.MARFAN_SEED_DEMO_DATA = process.env.MARFAN_SEED_DEMO_DATA || "false";

const { DB_PATH, all, get, run, transaction } = require("../server/db");
const { hashPassword } = require("../server/security");

const SUPERADMIN_ID = process.env.MARFAN_SUPERADMIN_ID || "usr_german";
const SUPERADMIN_NAME = process.env.MARFAN_SUPERADMIN_NAME || "German";
const SUPERADMIN_EMAIL = (process.env.MARFAN_SUPERADMIN_EMAIL || "info@marquee.es").toLowerCase();
const SUPERADMIN_PHONE = process.env.MARFAN_SUPERADMIN_PHONE || null;
const SUPERADMIN_PASSWORD = process.env.MARFAN_SUPERADMIN_PASSWORD || "Marquee2026!";

const DEMO_USER_IDS = new Set([
  "usr_super",
  "usr_admin",
  "usr_employee_alex",
  "usr_leader_carlos"
]);

const DEMO_EMPLOYEE_IDS = new Set([
  "emp_carlos",
  "emp_alejandro",
  "emp_lucia",
  "emp_marta",
  "emp_javier",
  "emp_nerea",
  "emp_omar",
  "emp_ana"
]);

const DEMO_CLIENT_IDS = new Set([
  "cli_tech",
  "cli_aecc",
  "cli_bmw",
  "cli_live",
  "cli_heineken"
]);

function isDemoEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value.endsWith(".test") || value.endsWith("@marfancrew.test");
}

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
  events: count("events")
};

let summary;
transaction(() => {
  const superAdminId = upsertGermanSuperAdmin();

  run("DELETE FROM sessions");
  run("DELETE FROM password_reset_tokens");
  run("DELETE FROM incidents WHERE event_id IS NOT NULL");
  run("DELETE FROM events");
  run("DELETE FROM audit_logs");

  const demoUsers = all("SELECT id, email FROM users")
    .filter((user) => user.id !== superAdminId && (DEMO_USER_IDS.has(user.id) || isDemoEmail(user.email)))
    .map((user) => user.id);
  for (const userId of demoUsers) {
    run("UPDATE employees SET user_id = NULL WHERE user_id = ?", [userId]);
    run("DELETE FROM users WHERE id = ?", [userId]);
  }

  const demoEmployees = all("SELECT id, email FROM employees")
    .filter((employee) => DEMO_EMPLOYEE_IDS.has(employee.id) || isDemoEmail(employee.email))
    .map((employee) => employee.id);
  for (const employeeId of demoEmployees) {
    run("DELETE FROM employees WHERE id = ?", [employeeId]);
  }

  const demoClients = all("SELECT id, email FROM clients")
    .filter((client) => DEMO_CLIENT_IDS.has(client.id) || isDemoEmail(client.email))
    .map((client) => client.id);
  for (const clientId of demoClients) {
    run("DELETE FROM clients WHERE id = ?", [clientId]);
  }

  summary = {
    superAdminId,
    removedDemoUsers: demoUsers.length,
    removedDemoEmployees: demoEmployees.length,
    removedDemoClients: demoClients.length
  };
});

const after = {
  users: count("users"),
  employees: count("employees"),
  clients: count("clients"),
  events: count("events")
};

console.log(JSON.stringify({
  ok: true,
  database: DB_PATH,
  superAdmin: {
    id: summary.superAdminId,
    name: SUPERADMIN_NAME,
    email: SUPERADMIN_EMAIL
  },
  removed: {
    demoUsers: summary.removedDemoUsers,
    demoEmployees: summary.removedDemoEmployees,
    demoClients: summary.removedDemoClients,
    events: before.events
  },
  before,
  after
}, null, 2));

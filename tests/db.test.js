const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-db-"));
process.env.DATA_DIR = tmp;
process.env.BACKUP_DIR = path.join(tmp, "backups");
process.env.SQLITE_PATH = path.join(tmp, "marfan-test.sqlite");
process.env.AUTO_BACKUP_ON_START = "false";

const dbModule = require("../server/db");

test.after(() => {
  dbModule.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("new installations create schema and seed data once", () => {
  const users = dbModule.get("SELECT COUNT(*) AS count FROM users").count;
  const events = dbModule.get("SELECT COUNT(*) AS count FROM events").count;
  const migrations = dbModule.get("SELECT COUNT(*) AS count FROM schema_migrations").count;

  assert.equal(users, 4);
  assert.equal(events, 7);
  assert.equal(migrations, 12);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('employees') WHERE name = 'shirt_size'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('documents') WHERE name = 'storage_path'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('delivery_notes') WHERE name = 'signature_image'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_calendar_event_id'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_sync_status'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'event_snapshots'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'gps_accuracy_m'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'ip_address'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'user_agent'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'corrected_at'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'corrected_by_user_id'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'correction_reason'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'permissions_json'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('incidents') WHERE name = 'resolution_note'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM company_settings").count, 7);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM work_roles").count, 9);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'").count, 1);
});

test("manual backups are versioned SQLite files", () => {
  const backup = dbModule.createBackup("manual", "Test backup");
  assert.equal(backup.type, "manual");
  assert.equal(fs.existsSync(backup.file_path), true);
  assert.ok(backup.size_bytes > 0);
  const integrity = dbModule.verifySqliteBackupFile(backup.file_path, backup.size_bytes);
  assert.equal(integrity.ok, true);
  assert.equal(integrity.quickCheck, "ok");

  const row = dbModule.get("SELECT * FROM backups WHERE id = ?", [backup.id]);
  assert.equal(row.label, "Test backup");
});

test("restore requests reject corrupted SQLite backup files", () => {
  const backup = dbModule.createBackup("manual", "Corrupt backup");
  fs.writeFileSync(backup.file_path, "not a sqlite database");
  assert.throws(
    () => dbModule.requestRestore(backup.id),
    /Backup no restaurable/
  );
});

test("production installations seed German and restored operational data", () => {
  const prodTmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-production-seed-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { get, db } = require("./server/db");
          const { verifyPassword } = require("./server/security");
          const sampleEmployeeUser = get("SELECT salt, password_hash FROM users WHERE role = 'employee' ORDER BY name LIMIT 1");
          console.log(JSON.stringify({
            german: get("SELECT role, name, email FROM users WHERE lower(email) = lower('info@marquee.es')"),
            users: get("SELECT COUNT(*) AS count FROM users").count,
            employees: get("SELECT COUNT(*) AS count FROM employees").count,
            clients: get("SELECT COUNT(*) AS count FROM clients").count,
            events: get("SELECT COUNT(*) AS count FROM events").count,
            assignments: get("SELECT COUNT(*) AS count FROM assignments").count,
            timeEntries: get("SELECT COUNT(*) AS count FROM time_entries").count,
            employeePasswordWorks: verifyPassword("Marfan2026!", sampleEmployeeUser.salt, sampleEmployeeUser.password_hash)
          }));
          db.close();
        `
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATA_DIR: prodTmp,
          BACKUP_DIR: path.join(prodTmp, "backups"),
          SQLITE_PATH: path.join(prodTmp, "marfan.sqlite"),
          AUTO_BACKUP_ON_START: "false",
          MARFAN_SEED_DEMO_DATA: "false",
          MARFAN_SEED_REAL_DATA: "true"
        },
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    assert.deepEqual(payload.german, {
      role: "super_admin",
      name: "German",
      email: "info@marquee.es"
    });
    assert.ok(payload.events >= 22);
    assert.ok(payload.assignments >= 28);
    assert.ok(payload.timeEntries >= 10);
    assert.equal(payload.employeePasswordWorks, true);
    assert.ok(payload.users >= 20);
    assert.ok(payload.employees >= 27);
    assert.ok(payload.clients >= 125);
  } finally {
    fs.rmSync(prodTmp, { recursive: true, force: true });
  }
});

test("prepare:production keeps business data and writes a safety backup", () => {
  const prodTmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-prepare-production-"));
  try {
    const script = `
      const { get, db } = require("./server/db");
      console.log(JSON.stringify({
        before: {
          employees: get("SELECT COUNT(*) AS count FROM employees").count,
          clients: get("SELECT COUNT(*) AS count FROM clients").count,
          events: get("SELECT COUNT(*) AS count FROM events").count,
          assignments: get("SELECT COUNT(*) AS count FROM assignments").count
        }
      }));
      db.close();
    `;
    const env = {
      ...process.env,
      NODE_ENV: "production",
      DATA_DIR: prodTmp,
      BACKUP_DIR: path.join(prodTmp, "backups"),
      SQLITE_PATH: path.join(prodTmp, "marfan.sqlite"),
      AUTO_BACKUP_ON_START: "false",
      MARFAN_SEED_DEMO_DATA: "false",
      MARFAN_SEED_REAL_DATA: "true"
    };
    const beforeResult = spawnSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, ".."),
      env,
      encoding: "utf8"
    });
    assert.equal(beforeResult.status, 0, beforeResult.stderr);
    const before = JSON.parse(beforeResult.stdout.trim()).before;

    const prepare = spawnSync(process.execPath, ["scripts/prepare_production.js"], {
      cwd: path.resolve(__dirname, ".."),
      env,
      encoding: "utf8"
    });
    assert.equal(prepare.status, 0, prepare.stderr);
    const payload = JSON.parse(prepare.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(fs.existsSync(payload.safetyBackup.filePath), true);
    assert.deepEqual(
      {
        employees: payload.after.employees,
        clients: payload.after.clients,
        events: payload.after.events,
        assignments: payload.after.assignments
      },
      before
    );
  } finally {
    fs.rmSync(prodTmp, { recursive: true, force: true });
  }
});

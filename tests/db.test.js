const test = require("node:test");
const assert = require("node:assert/strict");
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
  assert.equal(migrations, 6);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('employees') WHERE name = 'shirt_size'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('documents') WHERE name = 'storage_path'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('delivery_notes') WHERE name = 'signature_image'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_calendar_event_id'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_sync_status'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM company_settings").count, 7);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM work_roles").count, 9);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'").count, 1);
});

test("manual backups are versioned SQLite files", () => {
  const backup = dbModule.createBackup("manual", "Test backup");
  assert.equal(backup.type, "manual");
  assert.equal(fs.existsSync(backup.file_path), true);
  assert.ok(backup.size_bytes > 0);

  const row = dbModule.get("SELECT * FROM backups WHERE id = ?", [backup.id]);
  assert.equal(row.label, "Test backup");
});

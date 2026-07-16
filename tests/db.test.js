const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

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
  assert.equal(migrations, 19);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('employees') WHERE name = 'shirt_size'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('documents') WHERE name = 'storage_path'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('delivery_notes') WHERE name = 'signature_image'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_calendar_event_id'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'google_sync_status'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('events') WHERE name = 'location_source'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'event_documents'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'event_snapshots'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('event_snapshots') WHERE name = 'payload_hash'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'gps_accuracy_m'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'ip_address'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'user_agent'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'corrected_at'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'corrected_by_user_id'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('time_entries') WHERE name = 'correction_reason'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'permissions_json'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'failed_login_count'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'locked_until'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'password_changed_at'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'must_change_password'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('incidents') WHERE name = 'resolution_note'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('clients') WHERE name = 'archived_at'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM pragma_table_info('employees') WHERE name = 'archived_at'").count, 1);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM company_settings").count, 7);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM work_roles").count, 9);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM delivery_notes").count, events);
  assert.equal(dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'").count, 1);
});

test("manual backups are versioned SQLite files", () => {
  const uploadDir = path.join(tmp, "uploads", "documents");
  fs.mkdirSync(uploadDir, { recursive: true });
  const documentPath = path.join(uploadDir, "doc_backup_attachment.txt");
  fs.writeFileSync(documentPath, "BACKUP DOC OK");
  dbModule.run(
    `INSERT INTO documents
      (id, employee_id, type, name, status, storage_path, file_name, file_mime, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      "doc_backup_attachment",
      "emp_alejandro",
      "PRL",
      "Documento en backup",
      "vigente",
      documentPath,
      "doc_backup_attachment.txt",
      "text/plain",
      fs.statSync(documentPath).size
    ]
  );
  const eventDocumentPath = path.join(uploadDir, "event_doc_backup_attachment.txt");
  fs.writeFileSync(eventDocumentPath, "EVENT DOC BACKUP OK");
  dbModule.run(
    `INSERT INTO event_documents
      (id, event_id, type, name, visible_to_employee, storage_path, file_name, file_mime, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      "edoc_backup_attachment",
      "evt_live",
      "Recinto",
      "Plano evento en backup",
      1,
      eventDocumentPath,
      "event_doc_backup_attachment.txt",
      "text/plain",
      fs.statSync(eventDocumentPath).size
    ]
  );

  const backup = dbModule.createBackup("manual", "Test backup");
  assert.equal(backup.type, "manual");
  assert.equal(fs.existsSync(backup.file_path), true);
  assert.ok(backup.size_bytes > 0);
  const integrity = dbModule.verifySqliteBackupFile(backup.file_path, backup.size_bytes);
  assert.equal(integrity.ok, true);
  assert.equal(integrity.quickCheck, "ok");
  assert.equal(integrity.attachmentCount, 2);
  assert.equal(integrity.attachmentBytes, Buffer.byteLength("BACKUP DOC OK") + Buffer.byteLength("EVENT DOC BACKUP OK"));

  const backupDb = new DatabaseSync(backup.file_path, { readOnly: true });
  try {
    const embedded = backupDb.prepare(
      "SELECT document_id, file_name, content FROM backup_document_files WHERE document_id = ?"
    ).get("doc_backup_attachment");
    assert.equal(embedded.file_name, "doc_backup_attachment.txt");
    assert.equal(Buffer.from(embedded.content).toString(), "BACKUP DOC OK");
    const embeddedEvent = backupDb.prepare(
      "SELECT document_id, document_scope, file_name, content FROM backup_document_files WHERE document_id = ?"
    ).get("edoc_backup_attachment");
    assert.equal(embeddedEvent.document_scope, "event");
    assert.equal(embeddedEvent.file_name, "event_doc_backup_attachment.txt");
    assert.equal(Buffer.from(embeddedEvent.content).toString(), "EVENT DOC BACKUP OK");
  } finally {
    backupDb.close();
  }

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

test("restore requests register a downloadable safety backup", () => {
  const backup = dbModule.createBackup("manual", "Restore target");
  const restore = dbModule.requestRestore(backup.id);
  assert.equal(restore.backup.id, backup.id);
  assert.equal(restore.safetyBackup.type, "safety");
  assert.equal(fs.existsSync(restore.safetyBackup.file_path), true);
  const marker = JSON.parse(fs.readFileSync(path.join(tmp, "restore-request.json"), "utf8"));
  assert.equal(marker.backupId, backup.id);
  assert.equal(marker.safetyBackupId, restore.safetyBackup.id);
  assert.equal(marker.safetyBackupPath, restore.safetyBackup.file_path);
});

test("restore extracts uploaded document files embedded in backups", () => {
  const restoreTmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-restore-docs-"));
  const env = {
    ...process.env,
    DATA_DIR: restoreTmp,
    BACKUP_DIR: path.join(restoreTmp, "backups"),
    SQLITE_PATH: path.join(restoreTmp, "marfan.sqlite"),
    AUTO_BACKUP_ON_START: "false"
  };
  try {
    const setup = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const dbModule = require("./server/db");
          const uploadDir = path.join(process.env.DATA_DIR, "uploads", "documents");
          fs.mkdirSync(uploadDir, { recursive: true });
          const documentPath = path.join(uploadDir, "doc_restore_attachment.txt");
          fs.writeFileSync(documentPath, "RESTORE DOC OK");
          dbModule.run(
            "INSERT INTO documents (id, employee_id, type, name, status, storage_path, file_name, file_mime, file_size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            ["doc_restore_attachment", "emp_alejandro", "PRL", "Documento restaurable", "vigente", documentPath, "doc_restore_attachment.txt", "text/plain", fs.statSync(documentPath).size]
          );
          const eventDocumentPath = path.join(uploadDir, "event_doc_restore_attachment.txt");
          fs.writeFileSync(eventDocumentPath, "RESTORE EVENT DOC OK");
          dbModule.run(
            "INSERT INTO event_documents (id, event_id, type, name, visible_to_employee, storage_path, file_name, file_mime, file_size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            ["edoc_restore_attachment", "evt_live", "Recinto", "Plano restaurable", 1, eventDocumentPath, "event_doc_restore_attachment.txt", "text/plain", fs.statSync(eventDocumentPath).size]
          );
          const backup = dbModule.createBackup("manual", "Restore documents");
          fs.rmSync(documentPath, { force: true });
          fs.rmSync(eventDocumentPath, { force: true });
          dbModule.requestRestore(backup.id);
          dbModule.db.close();
          console.log(JSON.stringify({ backupId: backup.id }));
        `
      ],
      { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" }
    );
    assert.equal(setup.status, 0, setup.stderr);

    const restored = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          const dbModule = require("./server/db");
          const row = dbModule.get("SELECT storage_path FROM documents WHERE id = ?", ["doc_restore_attachment"]);
          const eventRow = dbModule.get("SELECT storage_path FROM event_documents WHERE id = ?", ["edoc_restore_attachment"]);
          const table = dbModule.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'backup_document_files'");
          console.log(JSON.stringify({
            exists: Boolean(row && fs.existsSync(row.storage_path)),
            content: row && fs.existsSync(row.storage_path) ? fs.readFileSync(row.storage_path, "utf8") : "",
            eventExists: Boolean(eventRow && fs.existsSync(eventRow.storage_path)),
            eventContent: eventRow && fs.existsSync(eventRow.storage_path) ? fs.readFileSync(eventRow.storage_path, "utf8") : "",
            bundleTableCount: table.count
          }));
          dbModule.db.close();
        `
      ],
      { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" }
    );
    assert.equal(restored.status, 0, restored.stderr);
    const payload = JSON.parse(restored.stdout.trim());
    assert.equal(payload.exists, true);
    assert.equal(payload.content, "RESTORE DOC OK");
    assert.equal(payload.eventExists, true);
    assert.equal(payload.eventContent, "RESTORE EVENT DOC OK");
    assert.equal(payload.bundleTableCount, 0);
  } finally {
    fs.rmSync(restoreTmp, { recursive: true, force: true });
  }
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
          function phoneLoginKey(value) {
            const digits = String(value || "").replace(/\\D/g, "");
            if (digits.length < 9) return "";
            const withoutPrefix = digits.startsWith("0034")
              ? digits.slice(4)
              : digits.startsWith("34") && digits.length > 9
                ? digits.slice(2)
                : digits;
            return withoutPrefix.length >= 9 ? withoutPrefix.slice(-9) : "";
          }
          const sampleEmployeeUser = get("SELECT phone, salt, password_hash FROM users WHERE role = 'employee' ORDER BY name LIMIT 1");
          console.log(JSON.stringify({
            german: get("SELECT role, name, email FROM users WHERE lower(email) = lower('info@marquee.es')"),
            users: get("SELECT COUNT(*) AS count FROM users").count,
            employees: get("SELECT COUNT(*) AS count FROM employees").count,
            clients: get("SELECT COUNT(*) AS count FROM clients").count,
            events: get("SELECT COUNT(*) AS count FROM events").count,
            assignments: get("SELECT COUNT(*) AS count FROM assignments").count,
            timeEntries: get("SELECT COUNT(*) AS count FROM time_entries").count,
            employeePasswordWorks: verifyPassword(phoneLoginKey(sampleEmployeeUser.phone), sampleEmployeeUser.salt, sampleEmployeeUser.password_hash)
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
      const { get, run, db } = require("./server/db");
      const { hashPassword, verifyPassword } = require("./server/security");
      const credentials = hashPassword("ClavePropia2026");
      run("UPDATE users SET password_hash = ?, salt = ? WHERE lower(email) = lower('info@marquee.es')", [
        credentials.hash,
        credentials.salt
      ]);
      const german = get("SELECT salt, password_hash FROM users WHERE lower(email) = lower('info@marquee.es')");
      console.log(JSON.stringify({
        before: {
          employees: get("SELECT COUNT(*) AS count FROM employees").count,
          clients: get("SELECT COUNT(*) AS count FROM clients").count,
          events: get("SELECT COUNT(*) AS count FROM events").count,
          assignments: get("SELECT COUNT(*) AS count FROM assignments").count
        },
        customPasswordWorks: verifyPassword("ClavePropia2026", german.salt, german.password_hash)
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
    const beforePayload = JSON.parse(beforeResult.stdout.trim());
    const before = beforePayload.before;
    assert.equal(beforePayload.customPasswordWorks, true);

    const prepare = spawnSync(process.execPath, ["scripts/prepare_production.js"], {
      cwd: path.resolve(__dirname, ".."),
      env,
      encoding: "utf8"
    });
    assert.equal(prepare.status, 0, prepare.stderr);
    const payload = JSON.parse(prepare.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.passwordReset, false);
    assert.equal(payload.sessionsCleared, false);
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
    const afterPasswordResult = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { get, db } = require("./server/db");
          const { verifyPassword } = require("./server/security");
          const german = get("SELECT salt, password_hash FROM users WHERE lower(email) = lower('info@marquee.es')");
          console.log(JSON.stringify({
            customPasswordWorks: verifyPassword("ClavePropia2026", german.salt, german.password_hash),
            defaultPasswordWorks: verifyPassword("Marquee2026!", german.salt, german.password_hash)
          }));
          db.close();
        `
      ],
      { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" }
    );
    assert.equal(afterPasswordResult.status, 0, afterPasswordResult.stderr);
    const afterPassword = JSON.parse(afterPasswordResult.stdout.trim());
    assert.equal(afterPassword.customPasswordWorks, true);
    assert.equal(afterPassword.defaultPasswordWorks, false);
  } finally {
    fs.rmSync(prodTmp, { recursive: true, force: true });
  }
});

test("startup recovery preserves an existing custom German password unless forced", () => {
  const prodTmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-recovery-preserve-"));
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
  try {
    const setCustom = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { run, db } = require("./server/db");
          const { hashPassword } = require("./server/security");
          const credentials = hashPassword("ClaveGermanPersonal2026");
          run("UPDATE users SET password_hash = ?, salt = ? WHERE lower(email) = lower('info@marquee.es')", [
            credentials.hash,
            credentials.salt
          ]);
          db.close();
        `
      ],
      { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" }
    );
    assert.equal(setCustom.status, 0, setCustom.stderr);

    const recoveryRun = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { accessRecovery, get, db } = require("./server/db");
          const { verifyPassword } = require("./server/security");
          const german = get("SELECT salt, password_hash FROM users WHERE lower(email) = lower('info@marquee.es')");
          console.log(JSON.stringify({
            accessRecovery,
            customPasswordWorks: verifyPassword("ClaveGermanPersonal2026", german.salt, german.password_hash),
            defaultPasswordWorks: verifyPassword("Marquee2026!", german.salt, german.password_hash)
          }));
          db.close();
        `
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        env: { ...env, MARFAN_RECOVER_SUPERADMIN_ON_START: "true" },
        encoding: "utf8"
      }
    );
    assert.equal(recoveryRun.status, 0, recoveryRun.stderr);
    const payload = JSON.parse(recoveryRun.stdout.trim());
    assert.equal(payload.accessRecovery.skippedPasswordReset, true);
    assert.equal(payload.accessRecovery.reason, "custom_password_preserved");
    assert.equal(payload.customPasswordWorks, true);
    assert.equal(payload.defaultPasswordWorks, false);
  } finally {
    fs.rmSync(prodTmp, { recursive: true, force: true });
  }
});

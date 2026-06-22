const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Wait until the spawned server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor de prueba no disponible");
}

function todayLocal() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

async function jsonRequest(baseUrl, pathName, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    headers: response.headers,
    json: await response.json().catch(() => ({}))
  };
}

test("admin users, team leaders and performed-event assignment locks work", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-admin-workflows-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tmp,
      BACKUP_DIR: path.join(tmp, "backups"),
      SQLITE_PATH: path.join(tmp, "marfan.sqlite"),
      AUTO_BACKUP_ON_START: "false"
    },
    stdio: "ignore"
  });

  try {
    await waitForHealth(baseUrl);
    const publicConfig = await jsonRequest(baseUrl, "/api/public/config");
    assert.equal(publicConfig.status, 200);
    assert.equal(publicConfig.json.demoMode, false);
    assert.equal(publicConfig.json.demoAccounts, null);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { identifier: "intruso@marfancrew.test", password: "mal", mode: "admin" }
      });
      assert.equal(failedLogin.status, 401);
    }
    const blockedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "intruso@marfancrew.test", password: "mal", mode: "admin" }
    });
    assert.equal(blockedLogin.status, 429);
    assert.match(blockedLogin.json.error, /Demasiados intentos/);
    assert.ok(Number(blockedLogin.headers.get("retry-after")) > 0);

    const login = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "admin@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(login.status, 200);
    const token = login.json.token;
    const fullSessionCookie = String(login.headers.get("set-cookie") || "");
    assert.match(login.headers.get("x-content-type-options") || "", /nosniff/i);
    assert.match(login.headers.get("x-frame-options") || "", /SAMEORIGIN/i);
    assert.match(fullSessionCookie, /HttpOnly/);
    assert.match(fullSessionCookie, /SameSite=Lax/);
    const sessionCookie = fullSessionCookie.split(";")[0];
    assert.match(sessionCookie, /^marfan_session=/);
    const rawSessionToken = decodeURIComponent(sessionCookie.replace(/^marfan_session=/, ""));
    const db = new DatabaseSync(path.join(tmp, "marfan.sqlite"));
    const storedSession = db.prepare("SELECT token FROM sessions LIMIT 1").get();
    db.close();
    assert.notEqual(storedSession.token, rawSessionToken);
    assert.match(storedSession.token, /^[a-f0-9]{64}$/);

    const cookieOnlyWrite = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      headers: { cookie: sessionCookie },
      body: { name: "Cliente solo cookie", legalName: "Cliente solo cookie SL" }
    });
    assert.equal(cookieOnlyWrite.status, 401);

    const users = await jsonRequest(baseUrl, "/api/users", { token });
    assert.equal(users.status, 200);
    assert.equal(users.json.users.some((user) => user.role === "employee"), false);

    const createdAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token,
      body: {
        role: "super_admin",
        name: "Coordinador Admin",
        email: "coordinador@marfancrew.test",
        password: "admin123"
      }
    });
    assert.equal(createdAdmin.status, 201);
    assert.equal(createdAdmin.json.user.role, "admin");

    const superLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "super@marfancrew.test", password: "super123", mode: "admin" }
    });
    assert.equal(superLogin.status, 200);
    const superToken = superLogin.json.token;

    const restrictedAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Eventos Sin Clientes",
        email: "eventos.sin.clientes@marfancrew.test",
        password: "admin123",
        permissions: { events: true, clients: false }
      }
    });
    assert.equal(restrictedAdmin.status, 201);
    assert.equal(restrictedAdmin.json.user.permissions.clients, false);
    assert.equal(restrictedAdmin.json.user.permissions.events, true);

    const restrictedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "eventos.sin.clientes@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(restrictedLogin.status, 200);
    assert.equal(restrictedLogin.json.user.permissions.clients, false);
    const restrictedToken = restrictedLogin.json.token;

    const restrictedClientRead = await jsonRequest(baseUrl, "/api/clients", { token: restrictedToken });
    assert.equal(restrictedClientRead.status, 200);
    const restrictedClientCreate = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token: restrictedToken,
      body: { name: "Cliente bloqueado permisos", legalName: "Cliente bloqueado permisos SL" }
    });
    assert.equal(restrictedClientCreate.status, 403);

    const unrestrictedAdmin = await jsonRequest(baseUrl, `/api/users/${restrictedAdmin.json.user.id}`, {
      method: "PATCH",
      token: superToken,
      body: { permissions: { clients: true, events: true } }
    });
    assert.equal(unrestrictedAdmin.status, 200);
    assert.equal(unrestrictedAdmin.json.user.permissions.clients, true);
    const allowedClientCreate = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token: restrictedToken,
      body: { name: "Cliente permitido permisos", legalName: "Cliente permitido permisos SL" }
    });
    assert.equal(allowedClientCreate.status, 201);

    const leader = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Jefa Nueva",
        phone: "+34600111000",
        email: "jefa.nueva@marfancrew.test",
        role: "Montaje",
        teamLeader: true,
        skills: ["montaje"]
      }
    });
    assert.equal(leader.status, 201);
    assert.equal(leader.json.employee.role, "Jefe de equipo");
    assert.equal(leader.json.employee.skills.includes("jefe"), true);
    assert.ok(leader.json.employee.user_id);
    assert.equal(leader.json.portalAccess.created, true);

    const leaderPortalLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111000", password: "Marfan2026!", mode: "employee" }
    });
    assert.equal(leaderPortalLogin.status, 200);
    assert.equal(leaderPortalLogin.json.user.role, "employee");
    const leaderPortalHome = await jsonRequest(baseUrl, "/api/employee/home", { token: leaderPortalLogin.json.token });
    assert.equal(leaderPortalHome.status, 200);
    assert.equal(leaderPortalHome.json.employee.name, "Jefa Nueva");

    const duplicateLeaderPhone = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Telefono Repetido",
        phone: "600 111 000",
        email: "telefono.repetido@marfancrew.test",
        role: "Montaje",
        portalAccess: true
      }
    });
    assert.equal(duplicateLeaderPhone.status, 409);
    assert.match(duplicateLeaderPhone.json.error, /telefono/i);

    const lockedAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: "evt_closed", employeeId: "emp_javier", role: "Montaje" }
    });
    assert.equal(lockedAssignment.status, 409);
    assert.match(lockedAssignment.json.error, /Evento efectuado/);

    const lockedEventEdit = await jsonRequest(baseUrl, "/api/events/evt_closed", {
      method: "PATCH",
      token,
      body: { date: "2026-07-01", startTime: "09:00", endTime: "12:00" }
    });
    assert.equal(lockedEventEdit.status, 409);
    assert.match(lockedEventEdit.json.error, /Evento efectuado/);

    const lockedEventDuplicate = await jsonRequest(baseUrl, "/api/events/evt_closed/duplicate", {
      method: "POST",
      token,
      body: { date: "2026-07-02" }
    });
    assert.equal(lockedEventDuplicate.status, 409);
    assert.match(lockedEventDuplicate.json.error, /Evento efectuado/);

    const settings = await jsonRequest(baseUrl, "/api/settings", { token });
    assert.equal(settings.status, 200);
    assert.equal(settings.json.settings.google_calendar_id.includes("@group.calendar.google.com"), true);
    assert.ok(settings.json.settings.calendar_feed_token);

    const deniedFeed = await fetch(`${baseUrl}/api/calendar/marfan.ics?token=wrong`);
    assert.equal(deniedFeed.status, 403);

    const feed = await fetch(`${baseUrl}/api/calendar/marfan.ics?token=${encodeURIComponent(settings.json.settings.calendar_feed_token)}`);
    const feedText = await feed.text();
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get("content-type"), /text\/calendar/);
    assert.match(feedText, /BEGIN:VCALENDAR/);
    assert.match(feedText, /MARFAN CREW ERP/);
    assert.match(feedText, /BEGIN:VEVENT/);

    const backupSettings = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: {
        backup_auto_enabled: "true",
        backup_auto_interval_hours: "6",
        backup_auto_retention_days: "15",
        backup_auto_retention_count: "12"
      }
    });
    assert.equal(backupSettings.status, 200);
    assert.equal(backupSettings.json.settings.backup_auto_interval_hours, "6");

    const autoBackup = await jsonRequest(baseUrl, "/api/backups/auto-run", {
      method: "POST",
      token
    });
    assert.equal(autoBackup.status, 201);
    assert.equal(autoBackup.json.backup.type, "auto");
    assert.equal(autoBackup.json.backup.verified, true);
    assert.equal(autoBackup.json.backup.integrity, "verified");
    assert.equal(autoBackup.json.backup.sqlite_quick_check, "ok");
    assert.equal(autoBackup.json.automation.intervalHours, 6);
    assert.equal(fs.existsSync(autoBackup.json.backup.file_path), true);

    const documents = await jsonRequest(baseUrl, "/api/documents", { token });
    assert.equal(documents.status, 200);
    assert.ok(documents.json.compliance.totals.caducado >= 1);
    assert.equal(documents.json.compliance.employees.some((employee) => employee.status === "bloqueado"), true);

    const uploadedDocument = await jsonRequest(baseUrl, "/api/documents", {
      method: "POST",
      token,
      body: {
        employeeId: "emp_alejandro",
        type: "PRL",
        name: "PRL Cliente Test",
        status: "vigente",
        fileName: "prl-cliente-test.txt",
        fileMime: "text/plain",
        fileDataBase64: `data:text/plain;base64,${Buffer.from("PRL OK MARFAN").toString("base64")}`
      }
    });
    assert.equal(uploadedDocument.status, 201);
    assert.equal(uploadedDocument.json.document.has_file, 1);
    const documentFile = await fetch(`${baseUrl}/api/documents/${uploadedDocument.json.document.id}/file`, {
      headers: { cookie: sessionCookie }
    });
    assert.equal(documentFile.status, 200);
    assert.equal(await documentFile.text(), "PRL OK MARFAN");

    const documentAccessAudit = await jsonRequest(
      baseUrl,
      `/api/audit-logs?action=document_file_opened&entity=document`,
      { token: superToken }
    );
    assert.equal(documentAccessAudit.status, 200);
    assert.equal(documentAccessAudit.json.logs.some((log) =>
      log.entity_id === uploadedDocument.json.document.id &&
      log.actor_name === "Antonio Ruiz" &&
      log.metadata.fileName === "prl-cliente-test.txt"
    ), true);

    const rejectedDocumentType = await jsonRequest(baseUrl, "/api/documents", {
      method: "POST",
      token,
      body: {
        employeeId: "emp_alejandro",
        type: "PRL",
        name: "Archivo no permitido",
        status: "vigente",
        fileName: "script.sh",
        fileMime: "application/x-sh",
        fileDataBase64: Buffer.from("no permitido").toString("base64")
      }
    });
    assert.equal(rejectedDocumentType.status, 415);
    assert.match(rejectedDocumentType.json.error, /Tipo de archivo/);

    const rejectedDocumentSize = await jsonRequest(baseUrl, "/api/documents", {
      method: "POST",
      token,
      body: {
        employeeId: "emp_alejandro",
        type: "PRL",
        name: "Archivo demasiado grande",
        status: "vigente",
        fileName: "grande.pdf",
        fileMime: "application/pdf",
        fileSize: 8_000_001
      }
    });
    assert.equal(rejectedDocumentSize.status, 413);
    assert.match(rejectedDocumentSize.json.error, /demasiado grande/i);

    const documentSync = await jsonRequest(baseUrl, "/api/documents/sync-statuses", {
      method: "POST",
      token
    });
    assert.equal(documentSync.status, 200);
    assert.ok(Number.isInteger(documentSync.json.updated));
    assert.ok(documentSync.json.compliance.totals.total >= documents.json.compliance.totals.total);

    const employeeReport = await jsonRequest(baseUrl, "/api/reports/employees?employeeId=emp_javier", { token });
    assert.equal(employeeReport.status, 200);
    assert.equal(employeeReport.json.rows.length, 1);
    assert.equal(employeeReport.json.rows[0].nombre, "Javier Rodriguez");
    assert.equal(employeeReport.json.rows[0].estado_documental, "bloqueado");
    assert.equal(employeeReport.json.rows[0].documentos_caducados >= 1, true);

    const employeeCsv = [
      "NOMBRE;APELLIDOS;TELEFONO;CORREO ELECTRONICO;D.N.I.;CAMISETA;PANTALON;CALZADO;SKILLS",
      "Importada;CSV;+34600900111;importada.csv@marfancrew.test;CSV12345;L;42;43;montaje,runner"
    ].join("\n");
    const employeeImport = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token,
      body: { fileName: "operarios-test.csv", fileText: employeeCsv, defaultPassword: "Marfan2026!" }
    });
    assert.equal(employeeImport.status, 201);
    assert.equal(employeeImport.json.inserted, 1);
    assert.equal(employeeImport.json.usersCreated, 1);

    const employeeImportAgain = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token,
      body: { fileName: "operarios-test.csv", fileText: employeeCsv, defaultPassword: "Marfan2026!" }
    });
    assert.equal(employeeImportAgain.status, 201);
    assert.equal(employeeImportAgain.json.inserted, 0);
    assert.equal(employeeImportAgain.json.updated, 1);

    const importedEmployeeReport = await jsonRequest(baseUrl, "/api/reports/employees?search=CSV12345", { token });
    assert.equal(importedEmployeeReport.status, 200);
    assert.equal(importedEmployeeReport.json.rows.length, 1);
    assert.equal(importedEmployeeReport.json.rows[0].camiseta, "L");

    const clientCsv = [
      "CLIENTE;RAZON SOCIAL;CIF;PERSONA CONTACTO;MAIL;TELEFONO;PROVINCIA",
      "Cliente CSV;Cliente CSV SL;B123CSV;Responsable CSV;csv@cliente.test;+34959900111;Malaga"
    ].join("\n");
    const clientImport = await jsonRequest(baseUrl, "/api/imports/clients", {
      method: "POST",
      token,
      body: { fileName: "clientes-test.csv", fileText: clientCsv }
    });
    assert.equal(clientImport.status, 201);
    assert.equal(clientImport.json.inserted, 1);

    const clientImportAgain = await jsonRequest(baseUrl, "/api/imports/clients", {
      method: "POST",
      token,
      body: { fileName: "clientes-test.csv", fileText: clientCsv }
    });
    assert.equal(clientImportAgain.status, 201);
    assert.equal(clientImportAgain.json.inserted, 0);
    assert.equal(clientImportAgain.json.updated, 1);

    const employeeTemplate = await fetch(`${baseUrl}/api/imports/templates/employees`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const employeeTemplateText = await employeeTemplate.text();
    assert.equal(employeeTemplate.status, 200);
    assert.match(employeeTemplate.headers.get("content-type"), /text\/csv/);
    assert.match(employeeTemplateText, /NOMBRE;APELLIDOS;TELEFONO/);
    assert.match(employeeTemplateText, /CAMISETA;PANTALON;CALZADO/);

    const clientTemplate = await fetch(`${baseUrl}/api/imports/templates/clients`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const clientTemplateText = await clientTemplate.text();
    assert.equal(clientTemplate.status, 200);
    assert.match(clientTemplateText, /CLIENTE;RAZON SOCIAL;CIF/);

    const googleImportBody = {
      id: "google_test_calendar_event",
      googleUid: "google-test-calendar-event@example.com",
      name: "Evento Google editable",
      date: "2026-06-21",
      startTime: "10:00",
      endTime: "12:00",
      location: "Recinto Google",
      address: "Recinto Google, Malaga",
      notes: "Creado desde Google Calendar"
    };
    const importedGoogle = await jsonRequest(baseUrl, "/api/calendar/import-google-event", {
      method: "POST",
      token,
      body: googleImportBody
    });
    assert.equal(importedGoogle.status, 201);
    assert.equal(importedGoogle.json.created, true);
    assert.equal(importedGoogle.json.event.google_calendar_uid, googleImportBody.googleUid);
    assert.equal(importedGoogle.json.event.location, "Recinto Google");

    const duplicateGoogle = await jsonRequest(baseUrl, "/api/calendar/import-google-event", {
      method: "POST",
      token,
      body: googleImportBody
    });
    assert.equal(duplicateGoogle.status, 200);
    assert.equal(duplicateGoogle.json.created, false);
    assert.equal(duplicateGoogle.json.event.id, importedGoogle.json.event.id);

    const bulkGoogle = await jsonRequest(baseUrl, "/api/calendar/import-google-events", {
      method: "POST",
      token,
      body: {
        events: [
          googleImportBody,
          {
            id: "google_bulk_calendar_event",
            googleUid: "google-bulk-calendar-event@example.com",
            name: "Evento Google masivo editable",
            date: "2026-06-21",
            startTime: "13:00",
            endTime: "15:00",
            location: "Recinto Google Masivo",
            address: "Recinto Google Masivo, Malaga",
            notes: "Importado en bloque desde Google Calendar"
          }
        ]
      }
    });
    assert.equal(bulkGoogle.status, 200);
    assert.equal(bulkGoogle.json.processed, 2);
    assert.equal(bulkGoogle.json.created, 1);
    assert.equal(bulkGoogle.json.existing, 1);
    assert.equal(bulkGoogle.json.events.some((event) => event.google_calendar_uid === "google-bulk-calendar-event@example.com"), true);

    const createdEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio pendiente Google",
        clientId: "cli_tech",
        date: "2026-06-22",
        startTime: "10:00",
        endTime: "14:00",
        location: "Palacio de Ferias Malaga",
        address: "Palacio de Ferias Malaga",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(createdEvent.status, 201);
    assert.equal(createdEvent.json.googleSync.status, "pending_auth");
    assert.equal(createdEvent.json.event.google_sync_status, "pending_auth");

    const eventRecommendations = await jsonRequest(
      baseUrl,
      `/api/planner/recommendations?eventId=${encodeURIComponent(createdEvent.json.event.id)}`,
      { token }
    );
    assert.equal(eventRecommendations.status, 200);
    const alejandroRecommendation = eventRecommendations.json.recommendations.find((item) => item.employee.id === "emp_alejandro");
    assert.equal(alejandroRecommendation.suggestedRole, "Montaje");
    assert.equal(alejandroRecommendation.roleFit, "rol exacto");
    assert.equal(typeof alejandroRecommendation.recentHours, "number");

    const clockAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: createdEvent.json.event.id, employeeId: "emp_alejandro", role: alejandroRecommendation.suggestedRole }
    });
    assert.equal(clockAssignment.status, 201);
    assert.equal(clockAssignment.json.assignment.role, "Montaje");

    const createdAllowance = await jsonRequest(baseUrl, "/api/allowances", {
      method: "POST",
      token,
      body: {
        eventId: createdEvent.json.event.id,
        employeeId: "emp_alejandro",
        km: 7.5,
        diet: 12,
        nightHours: 1.5,
        extras: 5
      }
    });
    assert.equal(createdAllowance.status, 201);
    assert.equal(createdAllowance.json.allowance.employee_name, "Alejandro Perez");
    assert.equal(createdAllowance.json.allowance.night_hours, 1.5);

    const updatedAllowance = await jsonRequest(baseUrl, `/api/allowances/${createdAllowance.json.allowance.id}`, {
      method: "PATCH",
      token,
      body: {
        km: 8,
        diet: 14,
        nightHours: 2,
        extras: 6.5
      }
    });
    assert.equal(updatedAllowance.status, 200);
    assert.equal(updatedAllowance.json.allowance.km, 8);
    assert.equal(updatedAllowance.json.allowance.diet, 14);
    assert.equal(updatedAllowance.json.allowance.extras, 6.5);

    const allowanceList = await jsonRequest(baseUrl, `/api/allowances?eventId=${createdEvent.json.event.id}`, { token });
    assert.equal(allowanceList.status, 200);
    assert.equal(allowanceList.json.allowances.some((allowance) =>
      allowance.employee_id === "emp_alejandro" &&
      allowance.km === 8 &&
      allowance.night_hours === 2
    ), true);

    const duplicatedEvent = await jsonRequest(baseUrl, `/api/events/${createdEvent.json.event.id}/duplicate`, {
      method: "POST",
      token,
      body: { date: "2026-06-24" }
    });
    assert.equal(duplicatedEvent.status, 201);
    assert.equal(duplicatedEvent.json.copiedAssignments.length, 1);
    assert.equal(duplicatedEvent.json.skippedAssignments.length, 0);
    assert.equal(duplicatedEvent.json.event.date, "2026-06-24");
    assert.equal(duplicatedEvent.json.event.assignments.some((assignment) =>
      assignment.employee_id === "emp_alejandro" &&
      assignment.role === "Montaje"
    ), true);
    assert.equal(duplicatedEvent.json.event.assigned_count, 1);

    const clientDossier = await fetch(`${baseUrl}/api/events/${createdEvent.json.event.id}/client-dossier`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const clientDossierHtml = await clientDossier.text();
    assert.equal(clientDossier.status, 200);
    assert.match(clientDossierHtml, /MARFAN CREW ERP/);
    assert.match(clientDossierHtml, /Abrir archivo/);
    assert.match(clientDossierHtml, new RegExp(`/api/documents/${uploadedDocument.json.document.id}/file`));

    const nightRestEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Montaje nocturno descanso",
        clientId: "cli_tech",
        date: "2026-07-04",
        startTime: "22:00",
        endTime: "02:00",
        location: "Recinto noche",
        address: "Recinto noche",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Limpieza", count: 1 }]
      }
    });
    assert.equal(nightRestEvent.status, 201);
    const nightRestAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: nightRestEvent.json.event.id, employeeId: "emp_nerea", role: "Limpieza" }
    });
    assert.equal(nightRestAssignment.status, 201);
    const morningRestEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Turno temprano descanso",
        clientId: "cli_tech",
        date: "2026-07-05",
        startTime: "08:00",
        endTime: "12:00",
        location: "Recinto manana",
        address: "Recinto manana",
        lat: 36.695,
        lng: -4.461,
        requiredTotal: 1,
        requirements: [{ role: "Limpieza", count: 1 }]
      }
	    });
	    assert.equal(morningRestEvent.status, 201);
	    const pendingAvailability = await jsonRequest(baseUrl, "/api/availability", {
	      method: "POST",
	      token,
	      body: {
	        employeeId: "emp_nerea",
	        startDate: "2026-07-05",
	        endDate: "2026-07-05",
	        type: "no_disponible",
	        status: "solicitado",
	        reason: "Solicitud pendiente del operario"
	      }
	    });
	    assert.equal(pendingAvailability.status, 201);
	    const restRecommendations = await jsonRequest(
	      baseUrl,
	      `/api/planner/recommendations?eventId=${encodeURIComponent(morningRestEvent.json.event.id)}`,
	      { token }
	    );
	    assert.equal(restRecommendations.status, 200);
	    const nereaRest = restRecommendations.json.recommendations.find((item) => item.employee.id === "emp_nerea");
	    assert.equal(nereaRest.suggestedRole, "Limpieza");
	    assert.equal(nereaRest.roleFit, "rol exacto");
	    assert.equal(nereaRest.issues.some((issue) => issue.type === "descanso" && issue.severity === "warning"), true);
	    assert.equal(nereaRest.issues.some((issue) => issue.type === "disponibilidad" && issue.severity === "warning"), true);

    const filteredEventsReport = await jsonRequest(
      baseUrl,
      "/api/reports/events?from=2026-06-22&to=2026-06-22&clientId=cli_tech&employeeId=emp_alejandro",
      { token }
    );
    assert.equal(filteredEventsReport.status, 200);
    assert.equal(filteredEventsReport.json.filters.clientId, "cli_tech");
    assert.equal(filteredEventsReport.json.filters.employeeId, "emp_alejandro");
    assert.equal(filteredEventsReport.json.rows.some((row) => row.id === createdEvent.json.event.id), true);
    assert.equal(filteredEventsReport.json.rows.every((row) => row.fecha === "2026-06-22" && row.cliente === "Tech Events S.L."), true);

    const filteredFinanceReport = await jsonRequest(
      baseUrl,
      "/api/reports/finance?from=2026-06-22&to=2026-06-22&clientId=cli_tech&employeeId=emp_alejandro",
      { token }
    );
    assert.equal(filteredFinanceReport.status, 200);
    assert.equal(filteredFinanceReport.json.filters.employeeId, "emp_alejandro");
    assert.equal(filteredFinanceReport.json.rows.some((row) =>
      row.seccion === "operario" &&
      row.nombre.includes("Alejandro") &&
      row.detalle.includes("8 km") &&
      row.detalle.includes("14 EUR dietas") &&
      row.detalle.includes("2 h noct.")
    ), true);
    assert.equal(filteredFinanceReport.json.rows.some((row) => row.seccion === "evento" && row.nombre === "Servicio pendiente Google"), true);

    const missingGpsClock = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token,
      body: {
        eventId: createdEvent.json.event.id,
        employeeId: "emp_alejandro",
        type: "entrada"
      }
    });
    assert.equal(missingGpsClock.status, 400);
    assert.match(missingGpsClock.json.error, /GPS/);

    const earlyClock = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token,
      headers: { "user-agent": "MARFAN-Test-Mobile" },
      body: {
        eventId: createdEvent.json.event.id,
        employeeId: "emp_alejandro",
        type: "entrada",
        lat: 36.8,
        lng: -4.7,
        accuracy: 8
      }
    });
    assert.equal(earlyClock.status, 409);
    assert.match(earlyClock.json.error, /radio|GPS|Fuera/i);
    assert.equal(earlyClock.json.radius, 150);
    assert.equal(earlyClock.json.entry.gps_accuracy_m, 8);
    assert.ok(earlyClock.json.entry.ip_address);
    assert.equal(earlyClock.json.entry.user_agent, "MARFAN-Test-Mobile");

    const clockIncidents = await jsonRequest(baseUrl, "/api/incidents", { token });
    assert.equal(clockIncidents.status, 200);
    const clockIncident = clockIncidents.json.incidents.find((incident) =>
      incident.event_id === createdEvent.json.event.id &&
      incident.employee_id === "emp_alejandro" &&
      incident.type === "fichaje"
    );
    assert.ok(clockIncident);

    const incidentReport = await jsonRequest(
      baseUrl,
      "/api/reports/incidents?employeeId=emp_alejandro&status=abierta&search=Fichaje",
      { token }
    );
    assert.equal(incidentReport.status, 200);
    assert.equal(incidentReport.json.filters.employeeId, "emp_alejandro");
    assert.equal(incidentReport.json.rows.some((row) =>
      row.evento === "Servicio pendiente Google" &&
      row.operario === "Alejandro Perez" &&
      row.estado === "abierta" &&
      row.titulo === "Fichaje bloqueado"
    ), true);

    const incidentCsv = await fetch(`${baseUrl}/api/reports/incidents?format=csv&employeeId=emp_alejandro`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const incidentCsvText = await incidentCsv.text();
    assert.equal(incidentCsv.status, 200);
    assert.match(incidentCsvText, /titulo/);
    assert.match(incidentCsvText, /Fichaje bloqueado/);

    const correctedClock = await jsonRequest(baseUrl, `/api/time-entries/${earlyClock.json.entry.id}`, {
      method: "PATCH",
      token,
      body: {
        type: "entrada",
        timestamp: "2026-06-22T10:05",
        accepted: true,
        notes: "Entrada aceptada tras llamada de oficina",
        correctionReason: "GPS corregido por oficina tras validar presencia"
      }
    });
    assert.equal(correctedClock.status, 200);
    assert.equal(correctedClock.json.entry.accepted, 1);
    assert.equal(correctedClock.json.entry.type, "entrada");
    assert.equal(correctedClock.json.entry.correction_reason, "GPS corregido por oficina tras validar presencia");
    assert.equal(correctedClock.json.entry.corrected_by_name, "Antonio Ruiz");
    assert.ok(correctedClock.json.entry.corrected_at);

    const correctedEntries = await jsonRequest(baseUrl, `/api/time-entries?eventId=${createdEvent.json.event.id}`, { token });
    assert.equal(correctedEntries.status, 200);
    assert.equal(correctedEntries.json.entries.some((entry) =>
      entry.id === earlyClock.json.entry.id &&
      entry.correction_reason === "GPS corregido por oficina tras validar presencia" &&
      entry.corrected_by_name === "Antonio Ruiz"
    ), true);

    const resolvedIncident = await jsonRequest(baseUrl, `/api/incidents/${clockIncident.id}`, {
      method: "PATCH",
      token,
      body: {
        status: "resuelta",
        resolutionNote: "Operario avisado y fichaje revisado por oficina"
      }
    });
    assert.equal(resolvedIncident.status, 200);
    assert.equal(resolvedIncident.json.incident.status, "resuelta");
    assert.equal(resolvedIncident.json.incident.resolution_note, "Operario avisado y fichaje revisado por oficina");
    assert.ok(resolvedIncident.json.incident.resolved_at);

    const resolvedIncidentReport = await jsonRequest(
      baseUrl,
      `/api/reports/incidents?status=resuelta&search=${encodeURIComponent("fichaje revisado")}`,
      { token }
    );
    assert.equal(resolvedIncidentReport.status, 200);
    assert.equal(resolvedIncidentReport.json.rows.some((row) =>
      row.titulo === "Fichaje bloqueado" &&
      row.resolucion === "Operario avisado y fichaje revisado por oficina"
    ), true);

    const eventSnapshots = await jsonRequest(baseUrl, `/api/events/${createdEvent.json.event.id}/snapshots?limit=10`, { token });
    assert.equal(eventSnapshots.status, 200);
    const snapshotActions = eventSnapshots.json.snapshots.map((snapshot) => snapshot.action);
    assert.equal(snapshotActions.includes("event_created"), true);
    assert.equal(snapshotActions.includes("assignment_created"), true);
    assert.equal(snapshotActions.includes("time_entry_blocked"), true);
    assert.equal(snapshotActions.includes("incident_updated"), true);
    const blockedSnapshot = eventSnapshots.json.snapshots.find((snapshot) => snapshot.action === "time_entry_blocked");
    assert.equal(blockedSnapshot.payload.event.id, createdEvent.json.event.id);
    assert.equal(blockedSnapshot.payload.event.assignments.some((assignment) => assignment.employee_id === "emp_alejandro"), true);
    assert.equal(blockedSnapshot.payload.event.timeEntries.some((entry) => entry.type === "entrada_bloqueada"), true);
    assert.equal(blockedSnapshot.payload.event.incidents.some((incident) => incident.type === "fichaje"), true);

    const today = todayLocal();
    const deliveryEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio con albaran firmado",
        clientId: "cli_tech",
        date: today,
        startTime: "00:00",
        endTime: "23:59",
        location: "Recinto albaran",
        address: "Recinto albaran",
        lat: 36.694,
        lng: -4.4605,
        teamLeaderId: leader.json.employee.id,
        requiredTotal: 1,
        requirements: [{ role: "Jefe de equipo", count: 1 }],
        vehicleCount: 1
      }
    });
    assert.equal(deliveryEvent.status, 201);

    const deliveryAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: deliveryEvent.json.event.id, employeeId: leader.json.employee.id, role: "Jefe de equipo" }
    });
    assert.equal(deliveryAssignment.status, 201);

    const deliveryClockIn = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token,
      body: {
        eventId: deliveryEvent.json.event.id,
        employeeId: leader.json.employee.id,
        type: "entrada",
        lat: 36.694,
        lng: -4.4605
      }
    });
    assert.equal(deliveryClockIn.status, 201);

    const unsignedClockOut = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token,
      body: {
        eventId: deliveryEvent.json.event.id,
        employeeId: leader.json.employee.id,
        type: "salida",
        lat: 36.694,
        lng: -4.4605
      }
    });
    assert.equal(unsignedClockOut.status, 428);
    assert.equal(unsignedClockOut.json.requiresClientSignature, true);

    const signedClockOut = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token,
      body: {
        eventId: deliveryEvent.json.event.id,
        employeeId: leader.json.employee.id,
        type: "salida",
        lat: 36.694,
        lng: -4.4605,
        signatureName: "Cliente Firma",
        signatureDni: "00000000T",
        signatureImage: "data:image/png;base64,iVBORw0KGgo=",
        clientNotes: "Servicio conforme"
      }
    });
    assert.equal(signedClockOut.status, 201);
    assert.equal(signedClockOut.json.deliveryNote.status, "firmado");
    assert.equal(signedClockOut.json.deliveryNote.locked, 1);

    const deliveryPdf = await fetch(`${baseUrl}/api/delivery-notes/${deliveryEvent.json.event.id}?format=pdf`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const deliveryPdfBuffer = Buffer.from(await deliveryPdf.arrayBuffer());
    assert.equal(deliveryPdf.status, 200);
    assert.match(deliveryPdf.headers.get("content-type"), /application\/pdf/);
    assert.equal(deliveryPdfBuffer.subarray(0, 4).toString(), "%PDF");
    assert.ok(deliveryPdfBuffer.length > 2500);

    const lockedAllowance = await jsonRequest(baseUrl, "/api/allowances", {
      method: "POST",
      token,
      body: {
        eventId: deliveryEvent.json.event.id,
        employeeId: leader.json.employee.id,
        km: 1
      }
    });
    assert.equal(lockedAllowance.status, 409);
    assert.match(lockedAllowance.json.error, /efectuado|Albaran/i);

    const attendanceEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Control asistencia automatico",
        clientId: "cli_tech",
        date: today,
        startTime: "00:00",
        endTime: "00:01",
        location: "Recinto asistencia",
        address: "Recinto asistencia",
        lat: 36.7,
        lng: -4.45,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(attendanceEvent.status, 201);
    const attendanceAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: attendanceEvent.json.event.id, employeeId: "emp_alejandro", role: "Montaje" }
    });
    assert.equal(attendanceAssignment.status, 201);

    const detectedAttendance = await jsonRequest(baseUrl, "/api/incidents/detect-attendance", {
      method: "POST",
      token,
      body: { date: today }
    });
    assert.equal(detectedAttendance.status, 200);
    assert.equal(detectedAttendance.json.created >= 1, true);
    assert.equal(detectedAttendance.json.incidents.some((incident) =>
      incident.event_id === attendanceEvent.json.event.id &&
      incident.employee_id === "emp_alejandro" &&
      incident.type === "ausencia"
    ), true);

    const detectedAgain = await jsonRequest(baseUrl, "/api/incidents/detect-attendance", {
      method: "POST",
      token,
      body: { date: today }
    });
    assert.equal(detectedAgain.status, 200);
    assert.equal(detectedAgain.json.created, 0);

    const retryEvent = await jsonRequest(baseUrl, "/api/calendar/google-sync/retry", {
      method: "POST",
      token,
      body: { eventId: createdEvent.json.event.id }
    });
    assert.equal(retryEvent.status, 200);
    assert.equal(retryEvent.json.googleSync.status, "pending_auth");
    assert.equal(retryEvent.json.event.google_sync_status, "pending_auth");

    const retryPending = await jsonRequest(baseUrl, "/api/calendar/google-sync/retry", {
      method: "POST",
      token,
      body: { limit: 1, from: "2026-06-20" }
    });
    assert.equal(retryPending.status, 200);
    assert.equal(retryPending.json.processed, 1);
    assert.equal(retryPending.json.pendingAuth, 1);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("Google Calendar sync writes imported and new events with OAuth credentials", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-google-oauth-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const mockGoogleFetch = path.resolve(__dirname, "mock-google-fetch.cjs");
  const googleLog = path.join(tmp, "google-fetch.jsonl");
  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${mockGoogleFetch}`].filter(Boolean).join(" ");
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      MOCK_GOOGLE_FETCH_LOG: googleLog,
      GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify({
        client_id: "oauth-client.test",
        client_secret: "oauth-secret",
        token_uri: "https://oauth2.test/token"
      }),
      GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-token-test",
      PORT: String(port),
      DATA_DIR: tmp,
      BACKUP_DIR: path.join(tmp, "backups"),
      SQLITE_PATH: path.join(tmp, "marfan.sqlite"),
      AUTO_BACKUP_ON_START: "false"
    },
    stdio: "ignore"
  });

  try {
    await waitForHealth(baseUrl);
    const login = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "admin@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(login.status, 200);
    const token = login.json.token;

    const oauthStart = await jsonRequest(baseUrl, "/api/calendar/google-oauth/start", {
      method: "POST",
      token,
      body: { returnUrl: baseUrl }
    });
    assert.equal(oauthStart.status, 200);
    assert.equal(oauthStart.json.redirectUri, `${baseUrl}/api/calendar/google-oauth/callback`);
    assert.match(decodeURIComponent(oauthStart.json.authUrl), /redirect_uri=http:\/\/127\.0\.0\.1:\d+\/api\/calendar\/google-oauth\/callback/);

    const oauthCalendar = await jsonRequest(baseUrl, "/api/calendar?from=2026-07-01&to=2026-07-05", { token });
    assert.equal(oauthCalendar.status, 200);
    assert.equal(oauthCalendar.json.googleStatus.status, "connected_oauth");
    assert.equal(oauthCalendar.json.googleEvents.some((event) => event.google_event_id === "oauth_api_event"), true);

    const createdEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio OAuth Google",
        clientId: "cli_tech",
        date: "2026-07-01",
        startTime: "10:00",
        endTime: "14:00",
        location: "Recinto OAuth",
        address: "Recinto OAuth, Malaga",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(createdEvent.status, 201);
    assert.equal(createdEvent.json.googleSync.status, "synced");
    assert.equal(createdEvent.json.event.google_sync_status, "synced");
    assert.match(createdEvent.json.event.google_calendar_event_id, /^mock_evt_/);

    const importedGoogle = await jsonRequest(baseUrl, "/api/calendar/import-google-event", {
      method: "POST",
      token,
      body: {
        id: "google_oauth_imported",
        googleUid: "google-oauth-imported@example.com",
        name: "Evento Google por completar",
        date: "2026-07-02",
        startTime: "09:00",
        endTime: "11:00",
        location: "Recinto Google OAuth",
        address: "Recinto Google OAuth, Malaga"
      }
    });
    assert.equal(importedGoogle.status, 201);
    assert.equal(importedGoogle.json.event.google_sync_status, "imported");

    const editedGoogle = await jsonRequest(baseUrl, `/api/events/${importedGoogle.json.event.id}`, {
      method: "PATCH",
      token,
      body: {
        name: "Evento Google editado en MARFAN",
        date: "2026-07-02",
        startTime: "11:30",
        endTime: "14:30",
        location: "Recinto Google OAuth editado",
        address: "Recinto Google OAuth editado, Malaga",
        lat: 36.7,
        lng: -4.45,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(editedGoogle.status, 200);
    assert.equal(editedGoogle.json.googleSync.status, "synced");
    assert.equal(editedGoogle.json.event.google_sync_status, "synced");
    assert.match(editedGoogle.json.event.google_calendar_event_id, /^found_/);

    const googleCalls = fs.readFileSync(googleLog, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(googleCalls.some((call) => call.kind === "token"), true);
    assert.equal(googleCalls.some((call) => call.kind === "calendar" && call.method === "POST" && call.summary === "Servicio OAuth Google"), true);
    assert.equal(googleCalls.some((call) => call.kind === "calendar" && call.method === "GET" && call.url.includes("iCalUID=google-oauth-imported")), true);
    assert.equal(googleCalls.some((call) => call.kind === "calendar" && call.method === "PATCH" && call.summary === "Evento Google editado en MARFAN"), true);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

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
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor de prueba no disponible");
}

function sensitivePaths(value, forbidden, pathName = "$") {
  if (!value || typeof value !== "object") return [];
  const matches = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${pathName}.${key}`;
    if (forbidden.has(key)) matches.push(nextPath);
    matches.push(...sensitivePaths(child, forbidden, nextPath));
  }
  return matches;
}

test("employee portal API never exposes internal economic fields", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marfan-employee-privacy-"));
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
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "empleado@marfancrew.test",
        password: "empleado123",
        mode: "employee"
      })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const phoneLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "600 777 888",
        password: "empleado123",
        mode: "employee"
      })
    });
    assert.equal(phoneLogin.status, 200);

    const home = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(home.status, 200);
    const payload = await home.json();
	    assert.equal(payload.office.phone, "+34910000000");
	    const nextServiceId = payload.nextService.id;
	    assert.ok(payload.nextService.checklist.total >= 5);
	    assert.equal(payload.nextService.checklist.items.some((item) => item.key === "documents"), true);
	    assert.equal(payload.nextService.checklist.items.some((item) => item.key === "location" && item.status === "done"), true);
	    assert.equal(Object.hasOwn(payload.history, "km"), false);
	    assert.equal(Object.hasOwn(payload.history, "dietas"), false);
	    assert.equal(Object.hasOwn(payload.history, "night_hours"), false);
	    assert.equal(Object.hasOwn(payload.history, "entries"), false);
	    assert.equal(typeof payload.history.hours, "number");
	    assert.equal(typeof payload.history.events_done, "number");

	    const employeeDocument = await fetch(`${baseUrl}/api/employee/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        type: "DNI",
        name: "DNI aportado desde portal",
        expiresAt: "2027-12-31",
        fileName: "dni-portal.txt",
        fileMime: "text/plain",
        fileDataBase64: Buffer.from("DNI OK MARFAN").toString("base64")
      })
    });
    assert.equal(employeeDocument.status, 201);
    const employeeDocumentPayload = await employeeDocument.json();
    assert.equal(employeeDocumentPayload.document.employee_id, "emp_alejandro");
    assert.equal(employeeDocumentPayload.document.status, "pendiente");
    assert.equal(employeeDocumentPayload.document.has_file, 1);

    const employeeDocumentFile = await fetch(`${baseUrl}/api/documents/${employeeDocumentPayload.document.id}/file`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(employeeDocumentFile.status, 200);
    assert.match(employeeDocumentFile.headers.get("cache-control") || "", /no-store/);
    assert.equal(employeeDocumentFile.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await employeeDocumentFile.text(), "DNI OK MARFAN");

    const invalidEmployeeDocument = await fetch(`${baseUrl}/api/employee/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        type: "DNI",
        name: "Documento corrupto",
        fileName: "dni.txt",
        fileMime: "text/plain",
        fileDataBase64: "%%%no-base64%%%"
      })
    });
    assert.equal(invalidEmployeeDocument.status, 400);
    const invalidEmployeeDocumentPayload = await invalidEmployeeDocument.json();
    assert.match(invalidEmployeeDocumentPayload.error, /Archivo no valido/);

	    const profileUpdate = await fetch(`${baseUrl}/api/employee/profile`, {
	      method: "PATCH",
	      headers: {
	        "content-type": "application/json",
	        authorization: `Bearer ${token}`
	      },
	      body: JSON.stringify({
	        phone: "+34600999999",
	        email: "empleado.actualizado@marfancrew.test",
	        photoDataBase64: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`,
	        password: "empleado456"
	      })
	    });
	    assert.equal(profileUpdate.status, 200);
	    const profilePayload = await profileUpdate.json();
	    assert.equal(profilePayload.employee.phone, "600999999");
	    assert.equal(profilePayload.employee.email, "empleado.actualizado@marfancrew.test");
	    assert.match(profilePayload.employee.photo_url, /^data:image\/png;base64,/);

    const oldProfileSession = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(oldProfileSession.status, 401);

    const loginUpdated = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "empleado.actualizado@marfancrew.test",
        password: "empleado456",
        mode: "employee"
      })
    });
    assert.equal(loginUpdated.status, 200);
    const { token: profileToken } = await loginUpdated.json();

    const loginUpdatedPhone = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "600999999",
        password: "empleado456",
        mode: "employee"
      })
    });
    assert.equal(loginUpdatedPhone.status, 200);

    const duplicatePhoneProfile = await fetch(`${baseUrl}/api/employee/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profileToken}`
      },
      body: JSON.stringify({
        phone: "910 000 002",
        email: "empleado.actualizado@marfancrew.test"
      })
    });
    assert.equal(duplicatePhoneProfile.status, 409);

    const duplicateProfile = await fetch(`${baseUrl}/api/employee/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profileToken}`
      },
      body: JSON.stringify({
        phone: "+34600999999",
        email: "admin@marfancrew.test"
      })
    });
    assert.equal(duplicateProfile.status, 409);

    const employeeIncident = await fetch(`${baseUrl}/api/employee/incidents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profileToken}`
      },
      body: JSON.stringify({
        eventId: "evt_live",
        type: "retraso",
        description: "Llegare 10 minutos tarde por trafico"
      })
    });
    assert.equal(employeeIncident.status, 201);
    const incidentPayload = await employeeIncident.json();
    assert.equal(incidentPayload.incident.employee_id, "emp_alejandro");
    assert.equal(incidentPayload.incident.event_id, "evt_live");
    assert.equal(incidentPayload.incident.priority, "alta");

    const forbiddenIncident = await fetch(`${baseUrl}/api/employee/incidents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profileToken}`
      },
      body: JSON.stringify({
        eventId: "evt_tech",
        type: "cliente",
        description: "No estoy asignado a este evento"
      })
    });
    assert.equal(forbiddenIncident.status, 404);

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "admin@marfancrew.test",
        password: "admin123",
        mode: "admin"
      })
    });
    assert.equal(adminLogin.status, 200);
    const { token: adminToken } = await adminLogin.json();

    const visibleEventDocument = await fetch(`${baseUrl}/api/events/${nextServiceId}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        type: "Recinto",
        name: "Plano acceso operarios",
        visibleToEmployee: true,
        fileName: "plano-acceso.txt",
        fileMime: "text/plain",
        fileDataBase64: Buffer.from("PLANO ACCESO OK").toString("base64")
      })
    });
    assert.equal(visibleEventDocument.status, 201);
    const visibleEventDocumentPayload = await visibleEventDocument.json();
    assert.equal(visibleEventDocumentPayload.document.event_id, nextServiceId);
    assert.equal(visibleEventDocumentPayload.document.has_file, 1);

    const internalEventDocument = await fetch(`${baseUrl}/api/events/${nextServiceId}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        type: "Cliente",
        name: "Brief interno cliente",
        visibleToEmployee: false,
        fileName: "brief-interno.txt",
        fileMime: "text/plain",
        fileDataBase64: Buffer.from("BRIEF INTERNO").toString("base64")
      })
    });
    assert.equal(internalEventDocument.status, 201);
    const internalEventDocumentPayload = await internalEventDocument.json();

    const assignedEventDocumentFile = await fetch(`${baseUrl}/api/event-documents/${visibleEventDocumentPayload.document.id}/file`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(assignedEventDocumentFile.status, 200);
    assert.equal(await assignedEventDocumentFile.text(), "PLANO ACCESO OK");

    const forbiddenInternalEventDocument = await fetch(`${baseUrl}/api/event-documents/${internalEventDocumentPayload.document.id}/file`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(forbiddenInternalEventDocument.status, 403);

    const homeWithEventDocuments = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(homeWithEventDocuments.status, 200);
    const homeWithEventDocumentsPayload = await homeWithEventDocuments.json();
    assert.equal(homeWithEventDocumentsPayload.eventDocuments.some((document) =>
      document.id === visibleEventDocumentPayload.document.id &&
      document.name === "Plano acceso operarios" &&
      document.has_file === 1
    ), true);
    assert.equal(homeWithEventDocumentsPayload.eventDocuments.some((document) =>
      document.id === internalEventDocumentPayload.document.id
    ), false);

    const coworkerDocument = await fetch(`${baseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        employeeId: "emp_lucia",
        type: "Contrato",
        name: "Contrato Lucia privado",
        status: "vigente",
        fileName: "contrato-lucia.txt",
        fileMime: "text/plain",
        fileDataBase64: Buffer.from("CONTRATO LUCIA CONFIDENCIAL").toString("base64")
      })
    });
    assert.equal(coworkerDocument.status, 201);
    const coworkerDocumentPayload = await coworkerDocument.json();

    const forbiddenCoworkerDocument = await fetch(`${baseUrl}/api/documents/${coworkerDocumentPayload.document.id}/file`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(forbiddenCoworkerDocument.status, 403);

    const adminIncidents = await fetch(`${baseUrl}/api/incidents`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminIncidents.status, 200);
    const adminIncidentPayload = await adminIncidents.json();
    assert.equal(adminIncidentPayload.incidents.some((incident) =>
      incident.id === incidentPayload.incident.id &&
      incident.employee_name === "Alejandro Perez" &&
      incident.status === "abierta"
    ), true);

    const adminDocuments = await fetch(`${baseUrl}/api/documents`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminDocuments.status, 200);
    const adminDocumentsPayload = await adminDocuments.json();
    assert.equal(adminDocumentsPayload.documents.some((document) =>
      document.id === employeeDocumentPayload.document.id &&
      document.employee_name === "Alejandro Perez" &&
      document.status === "pendiente" &&
      document.has_file === 1
    ), true);

    const reviewedDocument = await fetch(`${baseUrl}/api/documents/${employeeDocumentPayload.document.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        type: "DNI",
        name: "DNI validado oficina",
        status: "vigente",
        expiresAt: "2027-12-31"
      })
    });
    assert.equal(reviewedDocument.status, 200);
    const reviewedDocumentPayload = await reviewedDocument.json();
    assert.equal(reviewedDocumentPayload.document.status, "vigente");
    assert.equal(reviewedDocumentPayload.document.name, "DNI validado oficina");

    const updatedHome = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(updatedHome.status, 200);
    const updatedPayload = await updatedHome.json();
    assert.equal(updatedPayload.incidents.some((incident) =>
      incident.id === incidentPayload.incident.id &&
      incident.event_name === "Concierto Melendi" &&
      incident.status === "abierta"
    ), true);
    assert.equal(updatedPayload.documents.some((document) =>
      document.id === employeeDocumentPayload.document.id &&
      document.status === "vigente" &&
      document.name === "DNI validado oficina"
    ), true);

    const forbidden = new Set([
      "budget",
      "service_price",
      "servicePrice",
      "base_distance_km",
      "billable_km",
      "kilometre_price",
      "role_price_total",
      "night_price_total",
      "distance_price_total",
      "vehicle_count",
      "hourly_rate",
      "km_rate",
      "diet_rate",
      "diets",
      "extras",
      "finance",
      "cost",
      "benefit",
      "margin",
      "revenue"
    ]);
    assert.deepEqual(sensitivePaths(payload, forbidden), []);
    assert.deepEqual(sensitivePaths(updatedPayload, forbidden), []);

    const recovery = await fetch(`${baseUrl}/api/auth/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "+34 600 999 999" })
    });
    assert.equal(recovery.status, 200);
    const recoveryPayload = await recovery.json();
    assert.equal(recoveryPayload.recoveryCode, undefined);
    assert.match(recoveryPayload.message, /oficina/i);

    const superLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "super@marfancrew.test",
        password: "super123",
        mode: "admin"
      })
    });
    assert.equal(superLogin.status, 200);
    const { token: superToken } = await superLogin.json();

    const officeResetPassword = await fetch(`${baseUrl}/api/users/usr_employee_alex`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${superToken}`
      },
      body: JSON.stringify({ password: "empleado789" })
    });
    assert.equal(officeResetPassword.status, 200);
    const officeResetPayload = await officeResetPassword.json();
    assert.equal(officeResetPayload.user.id, "usr_employee_alex");

    const oldEmployeeSession = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${profileToken}` }
    });
    assert.equal(oldEmployeeSession.status, 401);

    const recoveredPhoneLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: "600999999",
        password: "empleado789",
        mode: "employee"
      })
    });
    assert.equal(recoveredPhoneLogin.status, 200);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
      // Wait until the spawned server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor de prueba no disponible");
}

async function jsonRequest(baseUrl, pathName, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
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
    const login = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "admin@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(login.status, 200);
    const token = login.json.token;

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

    const lockedAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: "evt_closed", employeeId: "emp_javier", role: "Montaje" }
    });
    assert.equal(lockedAssignment.status, 409);
    assert.match(lockedAssignment.json.error, /Evento efectuado/);

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
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

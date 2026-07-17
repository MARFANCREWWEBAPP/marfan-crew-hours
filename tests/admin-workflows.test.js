const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const zlib = require("node:zlib");
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

function addDaysLocal(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
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

function testSignaturePngDataUrl() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const width = 24;
  const height = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const ink = Math.abs(y - Math.round((x / width) * (height - 1))) <= 1;
      row[offset] = 10;
      row[offset + 1] = 20;
      row[offset + 2] = 30;
      row[offset + 3] = ink ? 255 : 0;
    }
    rows.push(row);
  }
  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function xlsxColumnName(index) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function minimalXlsxBuffer(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const ref = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  };
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(xml);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const fileCount = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(fileCount, 8);
  end.writeUInt16LE(fileCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
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

	    const existingEmployeeProfile = await jsonRequest(baseUrl, "/api/employees", {
	      method: "POST",
	      token: superToken,
	      body: {
	        name: "Operario Ficha Existente",
	        role: "Montaje",
	        email: "ficha.existente@marfancrew.test",
	        phone: "+34 600 111 901",
	        portalAccess: false
	      }
	    });
	    assert.equal(existingEmployeeProfile.status, 201);
	    assert.equal(existingEmployeeProfile.json.employee.user_id, null);
	    const linkedEmployeeUser = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "employee",
	        name: "Operario Ficha Existente",
	        email: "ficha.existente@marfancrew.test",
	        phone: "+34 600 111 901",
	        password: "Vinculo2026",
	        mustChangePassword: true
	      }
	    });
	    assert.equal(linkedEmployeeUser.status, 201);
	    assert.equal(linkedEmployeeUser.json.user.role, "employee");
	    assert.equal(linkedEmployeeUser.json.user.employeeId, existingEmployeeProfile.json.employee.id);
	    const employeesAfterUserLink = await jsonRequest(baseUrl, "/api/employees", { token: superToken });
	    assert.equal(
	      employeesAfterUserLink.json.employees.filter((employee) => employee.email === "ficha.existente@marfancrew.test").length,
	      1
	    );
	    assert.equal(
	      employeesAfterUserLink.json.employees.find((employee) => employee.id === existingEmployeeProfile.json.employee.id).user_id,
	      linkedEmployeeUser.json.user.id
	    );

	    const conversionEmployeeProfile = await jsonRequest(baseUrl, "/api/employees", {
	      method: "POST",
	      token: superToken,
	      body: {
	        name: "Operario Conversion Existente",
	        role: "Runner",
	        email: "conversion.existente@marfancrew.test",
	        phone: "+34 600 111 902",
	        portalAccess: false
	      }
	    });
	    assert.equal(conversionEmployeeProfile.status, 201);
	    const adminToConvert = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Admin A Convertir",
	        email: "admin.convertir@marfancrew.test",
	        password: "Convertir2026"
	      }
	    });
	    assert.equal(adminToConvert.status, 201);
	    const convertedEmployeeUser = await jsonRequest(baseUrl, `/api/users/${adminToConvert.json.user.id}`, {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        role: "employee",
	        name: "Operario Conversion Existente",
	        email: "conversion.existente@marfancrew.test",
	        phone: "+34 600 111 902"
	      }
	    });
	    assert.equal(convertedEmployeeUser.status, 200);
	    assert.equal(convertedEmployeeUser.json.user.role, "employee");
	    assert.equal(convertedEmployeeUser.json.user.employeeId, conversionEmployeeProfile.json.employee.id);
	    const employeesAfterRoleLink = await jsonRequest(baseUrl, "/api/employees", { token: superToken });
	    assert.equal(
	      employeesAfterRoleLink.json.employees.filter((employee) => employee.email === "conversion.existente@marfancrew.test").length,
	      1
	    );
	    assert.equal(
	      employeesAfterRoleLink.json.employees.find((employee) => employee.id === conversionEmployeeProfile.json.employee.id).user_id,
	      adminToConvert.json.user.id
	    );
	    const employeeLinkAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_employee_profile_linked&entity=employee", { token: superToken });
	    assert.equal(employeeLinkAudit.status, 200);
	    assert.equal(employeeLinkAudit.json.logs.some((item) => item.entity_id === existingEmployeeProfile.json.employee.id), true);
	    assert.equal(employeeLinkAudit.json.logs.some((item) => item.entity_id === conversionEmployeeProfile.json.employee.id), true);

	    const lockoutAdmin = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Admin Bloqueo Seguridad",
	        email: "bloqueo.seguridad@marfancrew.test",
	        password: "Lockout2026"
	      }
	    });
	    assert.equal(lockoutAdmin.status, 201);
	    for (let attempt = 0; attempt < 5; attempt += 1) {
	      const failedAccountLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	        method: "POST",
	        body: {
	          identifier: "bloqueo.seguridad@marfancrew.test",
	          password: "NoEsLaClave2026",
	          mode: "admin"
	        }
	      });
	      assert.equal(failedAccountLogin.status, attempt === 4 ? 423 : 401);
	    }
	    const lockedCorrectPassword = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: {
	        identifier: "bloqueo.seguridad@marfancrew.test",
	        password: "Lockout2026",
	        mode: "admin"
	      }
	    });
	    assert.equal(lockedCorrectPassword.status, 423);
	    assert.ok(lockedCorrectPassword.json.lockedUntil);

	    const lockedUsers = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(lockedUsers.status, 200);
	    const lockedUser = lockedUsers.json.users.find((item) => item.id === lockoutAdmin.json.user.id);
	    assert.equal(lockedUser.failedLoginCount, 5);
	    assert.ok(lockedUser.lockedUntil);
	    assert.equal(lockedUser.activeSessionCount, 0);
	    assert.ok(lockedUser.passwordChangedAt);

	    const unlockUser = await jsonRequest(baseUrl, `/api/users/${lockoutAdmin.json.user.id}`, {
	      method: "PATCH",
	      token: superToken,
	      body: { unlock: true }
	    });
	    assert.equal(unlockUser.status, 200);
	    assert.equal(unlockUser.json.user.failedLoginCount, 0);
	    assert.equal(unlockUser.json.user.lockedUntil, "");

	    const unlockedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      headers: {
	        "user-agent": "MARFAN Test Browser",
	        "x-forwarded-for": "203.0.113.10"
	      },
	      body: {
	        identifier: "bloqueo.seguridad@marfancrew.test",
	        password: "Lockout2026",
	        mode: "admin"
	      }
	    });
	    assert.equal(unlockedLogin.status, 200);
	    const usersWithSession = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    const lockoutWithSession = usersWithSession.json.users.find((item) => item.id === lockoutAdmin.json.user.id);
	    assert.equal(lockoutWithSession.activeSessionCount >= 1, true);

	    const listedSessions = await jsonRequest(baseUrl, `/api/users/${lockoutAdmin.json.user.id}/sessions`, {
	      token: superToken
	    });
	    assert.equal(listedSessions.status, 200);
	    assert.equal(listedSessions.json.sessions.length >= 1, true);
	    const lockoutSession = listedSessions.json.sessions[0];
	    assert.ok(lockoutSession.id);
	    assert.equal(lockoutSession.ipAddress, "203.0.113.10");
	    assert.match(lockoutSession.userAgent, /MARFAN Test Browser/);
	    assert.ok(lockoutSession.lastSeenAt);

	    const revokedSession = await jsonRequest(baseUrl, `/api/users/${lockoutAdmin.json.user.id}/sessions/${lockoutSession.id}`, {
	      method: "DELETE",
	      token: superToken
	    });
	    assert.equal(revokedSession.status, 200);
	    assert.equal(revokedSession.json.revoked, 1);
	    const revokedSessionMe = await jsonRequest(baseUrl, "/api/auth/me", { token: unlockedLogin.json.token });
	    assert.equal(revokedSessionMe.status, 401);
	    const lockoutActivity = await jsonRequest(baseUrl, `/api/users/${lockoutAdmin.json.user.id}/activity`, {
	      token: superToken
	    });
	    assert.equal(lockoutActivity.status, 200);
	    assert.equal(lockoutActivity.json.summary.security >= 2, true);
	    assert.equal(lockoutActivity.json.logs.some((log) => log.action === "login_success"), true);
	    assert.equal(lockoutActivity.json.logs.some((log) => log.action === "user_session_revoked"), true);

	    const bulkOne = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Bulk Operaciones Uno",
	        email: "bulk.operaciones.uno@marfancrew.test",
	        password: "Bulk2026A"
	      }
	    });
	    assert.equal(bulkOne.status, 201);
	    const bulkTwo = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Bulk Operaciones Dos",
	        email: "bulk.operaciones.dos@marfancrew.test",
	        password: "Bulk2026B"
	      }
	    });
	    assert.equal(bulkTwo.status, 201);
	    const bulkOneLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.uno@marfancrew.test", password: "Bulk2026A", mode: "admin" }
	    });
	    assert.equal(bulkOneLogin.status, 200);
	    const bulkTwoLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.dos@marfancrew.test", password: "Bulk2026B", mode: "admin" }
	    });
	    assert.equal(bulkTwoLogin.status, 200);
	    const bulkRevoke = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "revoke_sessions",
	        userIds: [bulkOne.json.user.id, bulkTwo.json.user.id]
	      }
	    });
	    assert.equal(bulkRevoke.status, 200);
	    assert.equal(bulkRevoke.json.updated, 2);
	    assert.equal(bulkRevoke.json.skipped, 0);
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: bulkOneLogin.json.token })).status, 401);
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: bulkTwoLogin.json.token })).status, 401);

	    const bulkDeactivate = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "deactivate",
	        userIds: [bulkOne.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(bulkDeactivate.status, 200);
	    assert.equal(bulkDeactivate.json.updated, 1);
	    assert.equal(bulkDeactivate.json.skipped, 1);
	    const afterBulkDeactivate = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(afterBulkDeactivate.json.users.find((item) => item.id === bulkOne.json.user.id).active, false);
	    assert.equal(afterBulkDeactivate.json.users.find((item) => item.id === superLogin.json.user.id).active, true);
	    const bulkActivate = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "activate",
	        userIds: [bulkOne.json.user.id]
	      }
	    });
	    assert.equal(bulkActivate.status, 200);
	    assert.equal(bulkActivate.json.updated, 1);
	    const afterBulkActivate = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(afterBulkActivate.json.users.find((item) => item.id === bulkOne.json.user.id).active, true);
	    const bulkPermissionProfile = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "permission_profile",
	        profile: "people",
	        userIds: [bulkOne.json.user.id, bulkTwo.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(bulkPermissionProfile.status, 200);
	    assert.equal(bulkPermissionProfile.json.updated, 2);
	    assert.equal(bulkPermissionProfile.json.skipped, 1);
	    const afterBulkPermissions = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    const bulkOnePermissions = afterBulkPermissions.json.users.find((item) => item.id === bulkOne.json.user.id).permissions;
	    const bulkTwoPermissions = afterBulkPermissions.json.users.find((item) => item.id === bulkTwo.json.user.id).permissions;
	    assert.equal(bulkOnePermissions.employees, true);
	    assert.equal(bulkOnePermissions.documents, true);
	    assert.equal(bulkOnePermissions.finances, false);
	    assert.deepEqual(bulkOnePermissions, bulkTwoPermissions);
	    const bulkAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=users_bulk_action&entity=user", { token: superToken });
	    assert.equal(bulkAudit.status, 200);
	    assert.equal(bulkAudit.json.logs.some((item) => item.metadata?.action === "permission_profile" && item.metadata?.profile === "people"), true);

	    const accessReview = await jsonRequest(baseUrl, `/api/users/${bulkOne.json.user.id}/access-review`, {
	      method: "POST",
	      token: superToken
	    });
	    assert.equal(accessReview.status, 200);
	    assert.ok(accessReview.json.user.accessReviewedAt);
	    assert.equal(accessReview.json.user.accessReviewedByUserId, superLogin.json.user.id);

	    const bulkOneAccessChangeLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.uno@marfancrew.test", password: "Bulk2026A", mode: "admin" }
	    });
	    assert.equal(bulkOneAccessChangeLogin.status, 200);
	    const permissionChangeInvalidatesReview = await jsonRequest(baseUrl, `/api/users/${bulkOne.json.user.id}`, {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        permissions: {
	          dashboard: true,
	          events: true,
	          clients: true,
	          employees: false,
	          documents: false,
	          finances: true,
	          reports: true
	        }
	      }
	    });
	    assert.equal(permissionChangeInvalidatesReview.status, 200);
	    assert.equal(permissionChangeInvalidatesReview.json.user.accessReviewedAt, null);
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: bulkOneAccessChangeLogin.json.token })).status, 401);

	    const bulkAccessReview = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "mark_reviewed",
	        userIds: [bulkTwo.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(bulkAccessReview.status, 200);
	    assert.equal(bulkAccessReview.json.updated, 2);
	    assert.equal(bulkAccessReview.json.skipped, 0);
	    const reviewedUsers = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.ok(reviewedUsers.json.users.find((item) => item.id === bulkTwo.json.user.id).accessReviewedAt);
	    assert.ok(reviewedUsers.json.users.find((item) => item.id === superLogin.json.user.id).accessReviewedAt);
	    const accessReviewAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_access_reviewed&entity=user", { token: superToken });
	    assert.equal(accessReviewAudit.status, 200);
	    assert.equal(accessReviewAudit.json.logs.some((item) => item.entity_id === bulkOne.json.user.id), true);
	    assert.equal(accessReviewAudit.json.logs.some((item) => item.entity_id === bulkTwo.json.user.id), true);

	    const bulkTwoAccessChangeLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.dos@marfancrew.test", password: "Bulk2026B", mode: "admin" }
	    });
	    assert.equal(bulkTwoAccessChangeLogin.status, 200);
	    const bulkProfileInvalidatesReview = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "permission_profile",
	        profile: "finance",
	        userIds: [bulkTwo.json.user.id]
	      }
	    });
	    assert.equal(bulkProfileInvalidatesReview.status, 200);
	    assert.equal(bulkProfileInvalidatesReview.json.updated, 1);
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: bulkTwoAccessChangeLogin.json.token })).status, 401);
	    const afterReviewInvalidation = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(afterReviewInvalidation.json.users.find((item) => item.id === bulkTwo.json.user.id).accessReviewedAt, null);
	    const reviewInvalidationAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_access_review_invalidated&entity=user", { token: superToken });
	    assert.equal(reviewInvalidationAudit.status, 200);
	    assert.equal(reviewInvalidationAudit.json.logs.some((item) => item.entity_id === bulkOne.json.user.id && item.metadata?.reasons?.includes("permissions_changed")), true);
	    assert.equal(reviewInvalidationAudit.json.logs.some((item) => item.entity_id === bulkTwo.json.user.id && item.metadata?.source === "bulk_permission_profile"), true);
	    const accessSessionAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_access_sessions_revoked&entity=user", { token: superToken });
	    assert.equal(accessSessionAudit.status, 200);
	    assert.equal(accessSessionAudit.json.logs.some((item) => item.entity_id === bulkOne.json.user.id && item.metadata?.revoked >= 1), true);
	    assert.equal(accessSessionAudit.json.logs.some((item) => item.entity_id === bulkTwo.json.user.id && item.metadata?.source === "bulk_permission_profile"), true);

	    const inactiveAdmin = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Admin Inactivo Historico",
	        email: "admin.inactivo@marfancrew.test",
	        password: "Inactive2026"
	      }
	    });
	    assert.equal(inactiveAdmin.status, 201);
	    const inactivityDb = new DatabaseSync(path.join(tmp, "marfan.sqlite"));
	    inactivityDb
	      .prepare("UPDATE users SET last_login_at = datetime('now', '-90 days') WHERE id = ?")
	      .run(inactiveAdmin.json.user.id);
	    inactivityDb.close();
	    const deactivateInactive = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "deactivate_inactive",
	        userIds: [inactiveAdmin.json.user.id, bulkOne.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(deactivateInactive.status, 200);
	    assert.equal(deactivateInactive.json.updated, 1);
	    assert.equal(deactivateInactive.json.skipped, 2);
	    const afterDeactivateInactive = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(afterDeactivateInactive.json.users.find((item) => item.id === inactiveAdmin.json.user.id).active, false);
	    assert.equal(afterDeactivateInactive.json.users.find((item) => item.id === bulkOne.json.user.id).active, true);
	    assert.equal(afterDeactivateInactive.json.users.find((item) => item.id === superLogin.json.user.id).active, true);
	    const deactivateInactiveAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_inactive_deactivated&entity=user", { token: superToken });
	    assert.equal(deactivateInactiveAudit.status, 200);
	    assert.equal(deactivateInactiveAudit.json.logs.some((item) => item.entity_id === inactiveAdmin.json.user.id), true);

	    const passwordRotationLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.uno@marfancrew.test", password: "Bulk2026A", mode: "admin" }
	    });
	    assert.equal(passwordRotationLogin.status, 200);
	    const forcePasswordChange = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "force_password_change",
	        userIds: [bulkOne.json.user.id, inactiveAdmin.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(forcePasswordChange.status, 200);
	    assert.equal(forcePasswordChange.json.updated, 1);
	    assert.equal(forcePasswordChange.json.skipped, 2);
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: passwordRotationLogin.json.token })).status, 401);
	    const afterForcedPasswordChange = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(afterForcedPasswordChange.json.users.find((item) => item.id === bulkOne.json.user.id).mustChangePassword, true);
	    assert.equal(afterForcedPasswordChange.json.users.find((item) => item.id === inactiveAdmin.json.user.id).mustChangePassword, false);
	    const forcedPasswordAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_password_change_forced&entity=user", { token: superToken });
	    assert.equal(forcedPasswordAudit.status, 200);
	    assert.equal(forcedPasswordAudit.json.logs.some((item) => item.entity_id === bulkOne.json.user.id), true);

	    const duplicateContactAdmin = await jsonRequest(baseUrl, "/api/users", {
	      method: "POST",
	      token: superToken,
	      body: {
	        role: "admin",
	        name: "Admin Contacto Duplicado",
	        email: "contacto.duplicado@marfancrew.test",
	        phone: "600111030",
	        password: "Duplicado2026"
	      }
	    });
	    assert.equal(duplicateContactAdmin.status, 201);
	    const duplicateContactEmployee = await jsonRequest(baseUrl, "/api/employees", {
	      method: "POST",
	      token,
	      body: {
	        name: "Operario Contacto Historico",
	        phone: "600111031",
	        email: "operario.contacto.historico@marfancrew.test",
	        role: "Montaje",
	        portalAccess: false
	      }
	    });
	    assert.equal(duplicateContactEmployee.status, 201);
	    const duplicateContactDb = new DatabaseSync(path.join(tmp, "marfan.sqlite"));
	    duplicateContactDb
	      .prepare("UPDATE employees SET phone = ? WHERE id = ?")
	      .run("600111030", duplicateContactEmployee.json.employee.id);
	    duplicateContactDb.close();

	    const securityReport = await jsonRequest(baseUrl, "/api/users/security-report", { token: superToken });
	    assert.equal(securityReport.status, 200);
	    assert.ok(securityReport.json.summary.total >= 1);
	    const forcedPasswordReportRow = securityReport.json.rows.find((item) => item.id_usuario === bulkOne.json.user.id);
	    assert.equal(forcedPasswordReportRow.cambio_clave_obligatorio, "si");
	    assert.match(forcedPasswordReportRow.accion_recomendada, /clave/i);
	    assert.equal(forcedPasswordReportRow.permisos_personalizados, "si");
	    assert.equal(forcedPasswordReportRow.perfil_permisos, "A medida");
	    assert.equal(forcedPasswordReportRow.perfil_sugerido, "Finanzas");
	    const financeProfileReportRow = securityReport.json.rows.find((item) => item.id_usuario === bulkTwo.json.user.id);
	    assert.equal(financeProfileReportRow.perfil_permisos, "Finanzas");
	    assert.equal(financeProfileReportRow.permisos_personalizados, "no");
	    const duplicateContactReportRow = securityReport.json.rows.find((item) => item.id_usuario === duplicateContactAdmin.json.user.id);
	    assert.match(duplicateContactReportRow.senales, /contacto duplicado/i);
	    assert.match(duplicateContactReportRow.contactos_duplicados, /telefono: 600111030/);
	    assert.match(duplicateContactReportRow.accion_recomendada, /contacto duplicado/i);
	    const securityReportCsv = await fetch(`${baseUrl}/api/users/security-report?format=csv`, {
	      headers: { authorization: `Bearer ${superToken}` }
	    });
	    assert.equal(securityReportCsv.status, 200);
	    assert.match(securityReportCsv.headers.get("content-type") || "", /text\/csv/);
	    const securityReportCsvText = await securityReportCsv.text();
	    assert.match(securityReportCsvText, /riesgo;puntuacion;accion_recomendada/);
	    assert.match(securityReportCsvText, /perfil_permisos;permisos_personalizados/);
	    assert.match(securityReportCsvText, /permisos_denegados_7d;ultimo_permiso_denegado/);
	    assert.match(securityReportCsvText, /contactos_duplicados/);
	    assert.match(securityReportCsvText, /bulk\.operaciones\.uno@marfancrew\.test/);
	    const securityReportAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=users_security_report_exported&entity=user", { token: superToken });
	    assert.equal(securityReportAudit.status, 200);
	    assert.equal(securityReportAudit.json.logs.some((item) => item.entity_id === "bulk"), true);

	    const suggestedProfileLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "bulk.operaciones.uno@marfancrew.test", password: "Bulk2026A", mode: "admin" }
	    });
	    assert.equal(suggestedProfileLogin.status, 200);
	    const suggestedProfile = await jsonRequest(baseUrl, "/api/users/bulk", {
	      method: "PATCH",
	      token: superToken,
	      body: {
	        action: "suggested_profile",
	        userIds: [bulkOne.json.user.id, inactiveAdmin.json.user.id, superLogin.json.user.id]
	      }
	    });
	    assert.equal(suggestedProfile.status, 200);
	    assert.equal(suggestedProfile.json.updated, 1);
	    assert.equal(suggestedProfile.json.skipped, 2);
	    const suggestedProfileResult = suggestedProfile.json.results.find((item) => item.id === bulkOne.json.user.id);
	    assert.equal(suggestedProfileResult.profile, "finance");
	    assert.equal(suggestedProfileResult.profileLabel, "Finanzas");
	    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: suggestedProfileLogin.json.token })).status, 401);
	    const afterSuggestedProfile = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    const bulkOneSuggestedPermissions = afterSuggestedProfile.json.users.find((item) => item.id === bulkOne.json.user.id).permissions;
	    assert.equal(bulkOneSuggestedPermissions.finances, true);
	    assert.equal(bulkOneSuggestedPermissions.reports, true);
	    assert.equal(bulkOneSuggestedPermissions.clients, true);
	    assert.equal(bulkOneSuggestedPermissions.employees, false);
	    assert.equal(bulkOneSuggestedPermissions.live, false);
	    const suggestedProfileAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=user_bulk_suggested_permission_profile_applied&entity=user", { token: superToken });
	    assert.equal(suggestedProfileAudit.status, 200);
	    assert.equal(suggestedProfileAudit.json.logs.some((item) => item.entity_id === bulkOne.json.user.id && item.metadata?.profile === "finance"), true);

    const temporaryPasswordAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Clave Temporal",
        email: "clave.temporal@marfancrew.test",
        password: "Temporal2026",
        mustChangePassword: true
      }
    });
    assert.equal(temporaryPasswordAdmin.status, 201);
    assert.equal(temporaryPasswordAdmin.json.user.mustChangePassword, true);
    const temporaryPasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "clave.temporal@marfancrew.test", password: "Temporal2026", mode: "admin" }
    });
    assert.equal(temporaryPasswordLogin.status, 200);
    assert.equal(temporaryPasswordLogin.json.user.mustChangePassword, true);
    const changedOwnPassword = await jsonRequest(baseUrl, "/api/auth/change-password", {
      method: "POST",
      token: temporaryPasswordLogin.json.token,
      body: {
        currentPassword: "Temporal2026",
        password: "Privada2026"
      }
    });
    assert.equal(changedOwnPassword.status, 200);
    assert.equal(changedOwnPassword.json.user.mustChangePassword, false);
    const temporaryPasswordMe = await jsonRequest(baseUrl, "/api/auth/me", { token: temporaryPasswordLogin.json.token });
    assert.equal(temporaryPasswordMe.status, 200);
    assert.equal(temporaryPasswordMe.json.user.mustChangePassword, false);
    const oldTemporaryPasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "clave.temporal@marfancrew.test", password: "Temporal2026", mode: "admin" }
    });
    assert.equal(oldTemporaryPasswordLogin.status, 401);
    const newPrivatePasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "clave.temporal@marfancrew.test", password: "Privada2026", mode: "admin" }
    });
    assert.equal(newPrivatePasswordLogin.status, 200);

    const accessCodeAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Codigo Acceso",
        email: "codigo.acceso@marfancrew.test",
        password: "CodigoBase2026",
        mustChangePassword: true
      }
    });
    assert.equal(accessCodeAdmin.status, 201);
    const accessCode = await jsonRequest(baseUrl, `/api/users/${accessCodeAdmin.json.user.id}/access-code`, {
      method: "POST",
      token: superToken
    });
    assert.equal(accessCode.status, 200);
    assert.match(accessCode.json.recoveryCode, /^[A-Z0-9]{16}$/);
    assert.equal(accessCode.json.expiresInMinutes, 30);
    const usersWithAccessCode = await jsonRequest(baseUrl, "/api/users", { token: superToken });
    assert.equal(usersWithAccessCode.json.users.find((item) => item.id === accessCodeAdmin.json.user.id).recoveryPending, true);
    const accessCodeReset = await jsonRequest(baseUrl, "/api/auth/reset-password", {
      method: "POST",
      body: {
        recoveryCode: accessCode.json.recoveryCode,
        password: "CodigoPrivado2026"
      }
    });
    assert.equal(accessCodeReset.status, 200);
    const accessCodeLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "codigo.acceso@marfancrew.test", password: "CodigoPrivado2026", mode: "admin" }
    });
    assert.equal(accessCodeLogin.status, 200);
    assert.equal(accessCodeLogin.json.user.mustChangePassword, false);
    const accessCodeAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=password_recovery_created_by_admin&entity=user", { token: superToken });
    assert.equal(accessCodeAudit.status, 200);
    assert.equal(accessCodeAudit.json.logs.some((log) => log.entity_id === accessCodeAdmin.json.user.id), true);

	    const recoveryRequest = await jsonRequest(baseUrl, "/api/auth/recover", {
	      method: "POST",
	      body: { identifier: "coordinador@marfancrew.test" }
	    });
	    assert.equal(recoveryRequest.status, 200);
	    assert.equal(recoveryRequest.json.recoveryCode, undefined);

	    const usersWithRecovery = await jsonRequest(baseUrl, "/api/users", { token: superToken });
	    assert.equal(usersWithRecovery.status, 200);
	    const coordinatorRecovery = usersWithRecovery.json.users.find((item) => item.id === createdAdmin.json.user.id);
	    assert.equal(coordinatorRecovery.recoveryPending, true);
	    assert.equal(coordinatorRecovery.recoveryPendingCount, 1);
	    assert.ok(coordinatorRecovery.recoveryRequestedAt);
	    assert.ok(coordinatorRecovery.recoveryExpiresAt);

	    const coordinatorPasswordReset = await jsonRequest(baseUrl, `/api/users/${createdAdmin.json.user.id}`, {
	      method: "PATCH",
	      token: superToken,
	      body: { password: "coordina123" }
	    });
	    assert.equal(coordinatorPasswordReset.status, 200);
	    assert.equal(coordinatorPasswordReset.json.user.recoveryPending, false);

	    const coordinatorLogin = await jsonRequest(baseUrl, "/api/auth/login", {
	      method: "POST",
	      body: { identifier: "coordinador@marfancrew.test", password: "coordina123", mode: "admin" }
	    });
	    assert.equal(coordinatorLogin.status, 200);

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
    const deniedPermissionAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=admin_permission_denied&entity=user", { token: superToken });
    assert.equal(deniedPermissionAudit.status, 200);
    assert.equal(deniedPermissionAudit.json.logs.some((item) =>
      item.entity_id === restrictedAdmin.json.user.id &&
      item.metadata?.path === "/api/clients" &&
      item.metadata?.requiredPermissions?.includes("clients")
    ), true);
    const restrictedActivity = await jsonRequest(baseUrl, `/api/users/${restrictedAdmin.json.user.id}/activity`, {
      token: superToken
    });
    assert.equal(restrictedActivity.status, 200);
    assert.equal(restrictedActivity.json.logs.some((item) => item.action === "admin_permission_denied"), true);
    assert.equal(restrictedActivity.json.summary.security >= 1, true);
    const usersAfterDeniedPermission = await jsonRequest(baseUrl, "/api/users", { token: superToken });
    assert.equal(usersAfterDeniedPermission.status, 200);
    const restrictedAfterDenied = usersAfterDeniedPermission.json.users.find((item) => item.id === restrictedAdmin.json.user.id);
    assert.equal(restrictedAfterDenied.deniedPermissionCount >= 1, true);
    assert.ok(restrictedAfterDenied.deniedPermissionLastAt);
    const deniedSecurityReport = await jsonRequest(baseUrl, "/api/users/security-report", { token: superToken });
    assert.equal(deniedSecurityReport.status, 200);
    const deniedReportRow = deniedSecurityReport.json.rows.find((item) => item.id_usuario === restrictedAdmin.json.user.id);
    assert.equal(deniedReportRow.permisos_denegados_7d >= 1, true);
    assert.ok(deniedReportRow.ultimo_permiso_denegado);
    assert.match(deniedReportRow.senales, /permisos denegados/);
    assert.match(deniedReportRow.accion_recomendada, /permisos denegados/i);

    const employeesNoImportsAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Operarios Sin Importar",
        email: "operarios.sin.importar@marfancrew.test",
        password: "admin123",
        permissions: { employees: true, imports: false }
      }
    });
    assert.equal(employeesNoImportsAdmin.status, 201);
    const employeesNoImportsLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "operarios.sin.importar@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(employeesNoImportsLogin.status, 200);
    const deniedEmployeeImportTemplate = await fetch(`${baseUrl}/api/imports/templates/employees`, {
      headers: { authorization: `Bearer ${employeesNoImportsLogin.json.token}` }
    });
    assert.equal(deniedEmployeeImportTemplate.status, 403);
    const deniedEmployeeImport = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token: employeesNoImportsLogin.json.token,
      body: {
        fileName: "no-import.csv",
        fileText: "NOMBRE;TELEFONO\nSin;600000001"
      }
    });
    assert.equal(deniedEmployeeImport.status, 403);

    const importsNoEmployeesAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Importa Sin Operarios",
        email: "importa.sin.operarios@marfancrew.test",
        password: "admin123",
        permissions: { imports: true, employees: false }
      }
    });
    assert.equal(importsNoEmployeesAdmin.status, 201);
    const importsNoEmployeesLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "importa.sin.operarios@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(importsNoEmployeesLogin.status, 200);
    const deniedEmployeeImportWithoutEmployees = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token: importsNoEmployeesLogin.json.token,
      body: {
        fileName: "no-employees.csv",
        fileText: "NOMBRE;TELEFONO\nSin;600000002"
      }
    });
    assert.equal(deniedEmployeeImportWithoutEmployees.status, 403);

    const calendarNoEventsAdmin = await jsonRequest(baseUrl, "/api/users", {
      method: "POST",
      token: superToken,
      body: {
        role: "admin",
        name: "Admin Calendario Sin Eventos",
        email: "calendario.sin.eventos@marfancrew.test",
        password: "admin123",
        permissions: { calendar: true, events: false }
      }
    });
    assert.equal(calendarNoEventsAdmin.status, 201);
    const calendarNoEventsLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "calendario.sin.eventos@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(calendarNoEventsLogin.status, 200);
    const deniedGoogleImport = await jsonRequest(baseUrl, "/api/calendar/import-google-event", {
      method: "POST",
      token: calendarNoEventsLogin.json.token,
      body: {
        googleUid: "denied-google-import@example.com",
        name: "Google sin permiso eventos",
        date: "2026-07-10",
        startTime: "10:00",
        endTime: "11:00"
      }
    });
    assert.equal(deniedGoogleImport.status, 403);

    const unrestrictedAdmin = await jsonRequest(baseUrl, `/api/users/${restrictedAdmin.json.user.id}`, {
      method: "PATCH",
      token: superToken,
      body: { permissions: { clients: true, events: true } }
    });
    assert.equal(unrestrictedAdmin.status, 200);
    assert.equal(unrestrictedAdmin.json.user.permissions.clients, true);
    assert.equal((await jsonRequest(baseUrl, "/api/auth/me", { token: restrictedToken })).status, 401);
    const unrestrictedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "eventos.sin.clientes@marfancrew.test", password: "admin123", mode: "admin" }
    });
    assert.equal(unrestrictedLogin.status, 200);
    const allowedClientCreate = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token: unrestrictedLogin.json.token,
      body: { name: "Cliente permitido permisos", legalName: "Cliente permitido permisos SL" }
    });
    assert.equal(allowedClientCreate.status, 201);
    const duplicateClientCreate = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token: unrestrictedLogin.json.token,
      body: { name: "Cliente permitido permisos", legalName: "Cliente permitido permisos copia SL" }
    });
    assert.equal(duplicateClientCreate.status, 409);
    assert.match(duplicateClientCreate.json.error, /nombre/i);
    assert.equal(duplicateClientCreate.json.duplicate.id, allowedClientCreate.json.client.id);
    const clientDuplicateBase = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token: unrestrictedLogin.json.token,
      body: { name: "Cliente Control Duplicados", legalName: "Cliente Control Duplicados SL", taxId: "BCTRL001" }
    });
    assert.equal(clientDuplicateBase.status, 201);
    const duplicateClientUpdate = await jsonRequest(baseUrl, `/api/clients/${allowedClientCreate.json.client.id}`, {
      method: "PATCH",
      token: unrestrictedLogin.json.token,
      body: { taxId: "BCTRL001" }
    });
    assert.equal(duplicateClientUpdate.status, 409);
    assert.match(duplicateClientUpdate.json.error, /CIF\/NIF/i);
    assert.equal(duplicateClientUpdate.json.duplicate.id, clientDuplicateBase.json.client.id);

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

    const syncedPortalEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operaria Datos Duplicados",
        phone: "+34 600 111 010",
        email: "datos.duplicados@marfancrew.test",
        role: "Montaje",
        portalAccess: true
      }
    });
    assert.equal(syncedPortalEmployee.status, 201);
    assert.ok(syncedPortalEmployee.json.employee.user_id);
    const syncedUserPatch = await jsonRequest(baseUrl, `/api/users/${syncedPortalEmployee.json.employee.user_id}`, {
      method: "PATCH",
      token: superToken,
      body: {
        name: "Operaria Datos Sincronizados",
        phone: "+34 600 111 011",
        email: "datos.sincronizados@marfancrew.test"
      }
    });
    assert.equal(syncedUserPatch.status, 200);
    assert.equal(syncedUserPatch.json.user.name, "Operaria Datos Sincronizados");
    assert.equal(syncedUserPatch.json.user.email, "datos.sincronizados@marfancrew.test");
    const syncedEmployees = await jsonRequest(baseUrl, "/api/employees", { token });
    const syncedEmployee = syncedEmployees.json.employees.find((item) => item.id === syncedPortalEmployee.json.employee.id);
    assert.equal(syncedEmployee.name, "Operaria Datos Sincronizados");
    assert.equal(syncedEmployee.phone, "600111011");
    assert.equal(syncedEmployee.email, "datos.sincronizados@marfancrew.test");
    const syncedLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: {
        identifier: "datos.sincronizados@marfancrew.test",
        password: "600111010",
        mode: "employee"
      }
    });
    assert.equal(syncedLogin.status, 200);

    const legacyPhonePasswordEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Temporal Antigua",
        phone: "+34 600 111 009",
        role: "Montaje",
        portalAccess: true,
        portalPassword: "Marfan2026!"
      }
    });
    assert.equal(legacyPhonePasswordEmployee.status, 201);
    const legacyPhonePasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111009", password: "600111009", mode: "employee" }
    });
    assert.equal(legacyPhonePasswordLogin.status, 200);

    const portalRepairEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operaria Portal Saneado",
        phone: "+34 600 111 012",
        email: "portal.saneado@marfancrew.test",
        role: "Montaje",
        portalAccess: false
      }
    });
    assert.equal(portalRepairEmployee.status, 201);
    assert.equal(Boolean(portalRepairEmployee.json.employee.user_id), false);
    const portalRepair = await jsonRequest(baseUrl, "/api/users/employee-portals/repair", {
      method: "PATCH",
      token: superToken
    });
    assert.equal(portalRepair.status, 200);
    assert.equal(portalRepair.json.created >= 1, true);
    assert.equal(portalRepair.json.results.some((item) =>
      item.employeeId === portalRepairEmployee.json.employee.id &&
      item.action === "created" &&
      item.userId
    ), true);
    const portalRepairEmployees = await jsonRequest(baseUrl, "/api/employees", { token });
    const repairedEmployee = portalRepairEmployees.json.employees.find((item) => item.id === portalRepairEmployee.json.employee.id);
    assert.ok(repairedEmployee.user_id);
    const repairedPortalLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111012", password: "600111012", mode: "employee" }
    });
    assert.equal(repairedPortalLogin.status, 200);
    const portalRepairAudit = await jsonRequest(baseUrl, "/api/audit-logs?action=employee_portals_repaired&entity=user", {
      token: superToken
    });
    assert.equal(portalRepairAudit.status, 200);
    assert.equal(portalRepairAudit.json.logs.some((log) => log.entity_id === "bulk"), true);

    const leaderPortalLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111000", password: "600111000", mode: "employee" }
    });
    assert.equal(leaderPortalLogin.status, 200);
    assert.equal(leaderPortalLogin.json.user.role, "employee");
    const leaderPortalHome = await jsonRequest(baseUrl, "/api/employee/home", { token: leaderPortalLogin.json.token });
    assert.equal(leaderPortalHome.status, 200);
    assert.equal(leaderPortalHome.json.employee.name, "Jefa Nueva");

    const phonePasswordEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operaria Telefono Portal",
        phone: "+34 600 111 001",
        role: "Montaje",
        portalAccess: true,
        portalPasswordMode: "phone",
        photoDataBase64: testSignaturePngDataUrl()
      }
    });
    assert.equal(phonePasswordEmployee.status, 201);
    assert.match(phonePasswordEmployee.json.employee.photo_url, /^data:image\/png;base64,/);
    const phonePasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111001", password: "600111001", mode: "employee" }
    });
    assert.equal(phonePasswordLogin.status, 200);
    assert.equal(phonePasswordLogin.json.user.role, "employee");

    const manualLeaderPassword = await jsonRequest(baseUrl, `/api/employees/${leader.json.employee.id}`, {
      method: "PATCH",
      token,
      body: {
        portalPasswordMode: "manual",
        portalPassword: "Manual2026",
        photoDataBase64: testSignaturePngDataUrl()
      }
    });
    assert.equal(manualLeaderPassword.status, 200);
    assert.match(manualLeaderPassword.json.employee.photo_url, /^data:image\/png;base64,/);
    const oldLeaderPasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111000", password: "600111000", mode: "employee" }
    });
    assert.equal(oldLeaderPasswordLogin.status, 401);
    const newLeaderPasswordLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111000", password: "Manual2026", mode: "employee" }
    });
    assert.equal(newLeaderPasswordLogin.status, 200);

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
    const employeeDniBase = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario DNI Base",
        phone: "600111020",
        email: "dni.base@marfancrew.test",
        role: "Montaje",
        dni: "DNI-DUP-001",
        portalAccess: false
      }
    });
    assert.equal(employeeDniBase.status, 201);
    const duplicateEmployeeDni = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario DNI Repetido",
        phone: "600111021",
        email: "dni.repetido@marfancrew.test",
        role: "Montaje",
        dni: "DNI DUP 001",
        portalAccess: false
      }
    });
    assert.equal(duplicateEmployeeDni.status, 409);
    assert.match(duplicateEmployeeDni.json.error, /DNI/i);
    assert.equal(duplicateEmployeeDni.json.duplicate.id, employeeDniBase.json.employee.id);
    const duplicateEmployeeDniUpdate = await jsonRequest(baseUrl, `/api/employees/${phonePasswordEmployee.json.employee.id}`, {
      method: "PATCH",
      token,
      body: { dni: "DNI-DUP-001" }
    });
    assert.equal(duplicateEmployeeDniUpdate.status, 409);
    assert.match(duplicateEmployeeDniUpdate.json.error, /DNI/i);

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

    const sensitiveGoogleSettings = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: {
        google_calendar_api_key: "AIzaSensitiveCalendarKey",
        google_calendar_public_ics_url: "https://calendar.google.com/calendar/ical/private-secret/basic.ics"
      }
    });
    assert.equal(sensitiveGoogleSettings.status, 200);
    assert.equal(sensitiveGoogleSettings.json.settings.google_calendar_api_key, "");
    assert.equal(sensitiveGoogleSettings.json.settings.google_calendar_public_ics_url, "");
    assert.equal(sensitiveGoogleSettings.json.settings.google_calendar_api_key_configured, "true");
    assert.equal(sensitiveGoogleSettings.json.settings.google_calendar_public_ics_url_configured, "true");
    assert.doesNotMatch(JSON.stringify(sensitiveGoogleSettings.json), /AIzaSensitiveCalendarKey|private-secret/);

    const sensitiveGoogleSettingsAgain = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: { google_calendar_api_key: "", google_calendar_public_ics_url: "" }
    });
    assert.equal(sensitiveGoogleSettingsAgain.status, 200);
    assert.equal(sensitiveGoogleSettingsAgain.json.settings.google_calendar_api_key_configured, "true");
    assert.equal(sensitiveGoogleSettingsAgain.json.settings.google_calendar_public_ics_url_configured, "true");
    assert.doesNotMatch(JSON.stringify(sensitiveGoogleSettingsAgain.json), /AIzaSensitiveCalendarKey|private-secret/);

    const deniedFeed = await fetch(`${baseUrl}/api/calendar/marfan.ics?token=wrong`);
    assert.equal(deniedFeed.status, 403);

    const feed = await fetch(`${baseUrl}/api/calendar/marfan.ics?token=${encodeURIComponent(settings.json.settings.calendar_feed_token)}`);
    const feedText = await feed.text();
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get("content-type"), /text\/calendar/);
    assert.match(feedText, /BEGIN:VCALENDAR/);
    assert.match(feedText, /MARFAN CREW ERP/);
    assert.match(feedText, /BEGIN:VEVENT/);

    const oauthInstalledSettings = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: {
        google_calendar_oauth_client_json: JSON.stringify({
          installed: {
            client_id: "oauth-installed.test",
            client_secret: "oauth-secret",
            redirect_uris: ["http://localhost"]
          }
        })
      }
    });
    assert.equal(oauthInstalledSettings.status, 200);
    assert.equal(oauthInstalledSettings.json.settings.google_calendar_oauth_client_type, "installed");

    const oauthInstalled = await jsonRequest(baseUrl, "/api/calendar/google-oauth/start", {
      method: "POST",
      token,
      body: { returnUrl: baseUrl }
    });
    assert.equal(oauthInstalled.status, 409);
    assert.equal(oauthInstalled.json.code, "google_oauth_client_type_invalid");
    assert.equal(oauthInstalled.json.redirectUri, `${baseUrl}/api/calendar/google-oauth/callback`);
    assert.deepEqual(oauthInstalled.json.authorizedRedirectUris, ["http://localhost"]);
    assert.equal(oauthInstalled.json.suggestedRedirectUris.includes(`${baseUrl}/api/calendar/google-oauth/callback`), true);

    const oauthMismatchSettings = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: {
        google_calendar_oauth_client_json: JSON.stringify({
          web: {
            client_id: "oauth-mismatch.test",
            client_secret: "oauth-secret",
            redirect_uris: ["http://localhost"]
          }
        })
      }
    });
    assert.equal(oauthMismatchSettings.status, 200);
    assert.equal(oauthMismatchSettings.json.settings.google_calendar_oauth_client_type, "web");
    assert.match(oauthMismatchSettings.json.settings.google_calendar_oauth_redirect_uris, /http:\/\/localhost/);

    const oauthMismatch = await jsonRequest(baseUrl, "/api/calendar/google-oauth/start", {
      method: "POST",
      token,
      body: { returnUrl: baseUrl }
    });
    assert.equal(oauthMismatch.status, 409);
    assert.equal(oauthMismatch.json.code, "google_redirect_uri_mismatch");
    assert.equal(oauthMismatch.json.redirectUri, `${baseUrl}/api/calendar/google-oauth/callback`);
    assert.deepEqual(oauthMismatch.json.authorizedRedirectUris, ["http://localhost"]);
    assert.equal(oauthMismatch.json.suggestedRedirectUris.includes(`${baseUrl}/api/calendar/google-oauth/callback`), true);

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

    const restoreWithoutConfirmation = await jsonRequest(baseUrl, "/api/backups/restore", {
      method: "POST",
      token: superToken,
      body: { backupId: autoBackup.json.backup.id }
    });
    assert.equal(restoreWithoutConfirmation.status, 400);
    assert.match(restoreWithoutConfirmation.json.error, /Confirmacion obligatoria/);

    const restoreWithConfirmation = await jsonRequest(baseUrl, "/api/backups/restore", {
      method: "POST",
      token: superToken,
      body: { backupId: autoBackup.json.backup.id, confirm: "RESTAURAR" }
    });
    assert.equal(restoreWithConfirmation.status, 202);
    assert.match(restoreWithConfirmation.json.message, /Restauracion preparada/);
    assert.equal(restoreWithConfirmation.json.safetyBackup.type, "safety");
    assert.equal(restoreWithConfirmation.json.safetyBackup.verified, true);
    assert.equal(fs.existsSync(restoreWithConfirmation.json.safetyBackup.file_path), true);
    const restoreRequestPath = path.join(tmp, "restore-request.json");
    assert.equal(fs.existsSync(restoreRequestPath), true);
    const restoreRequest = JSON.parse(fs.readFileSync(restoreRequestPath, "utf8"));
    assert.equal(restoreRequest.safetyBackupId, restoreWithConfirmation.json.safetyBackup.id);

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

    const forkliftEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio carretillero certificado",
        clientId: "cli_tech",
        date: "2026-08-01",
        startTime: "09:00",
        endTime: "12:00",
        location: "Recinto carretillero",
        address: "Recinto carretillero",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Carretillero", count: 1 }]
      }
    });
    assert.equal(forkliftEvent.status, 201);

    const forkliftRecommendations = await jsonRequest(
      baseUrl,
      `/api/planner/recommendations?eventId=${encodeURIComponent(forkliftEvent.json.event.id)}`,
      { token }
    );
    assert.equal(forkliftRecommendations.status, 200);
    const alejandroForklift = forkliftRecommendations.json.recommendations.find((item) => item.employee.id === "emp_alejandro");
    assert.equal(alejandroForklift.issues.some((issue) =>
      issue.type === "documentacion" &&
      issue.severity === "block" &&
      issue.message.includes("carretillero")
    ), true);

    const blockedForkliftAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: forkliftEvent.json.event.id, employeeId: "emp_alejandro", role: "Carretillero" }
    });
    assert.equal(blockedForkliftAssignment.status, 409);
    assert.equal(blockedForkliftAssignment.json.issues.some((issue) => issue.message.includes("carretillero")), true);

    const forkliftPatchEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio carretillero por edicion",
        clientId: "cli_tech",
        date: "2026-08-02",
        startTime: "09:00",
        endTime: "12:00",
        location: "Recinto carretillero edicion",
        address: "Recinto carretillero edicion",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Carretillero", count: 1 }]
      }
    });
    assert.equal(forkliftPatchEvent.status, 201);

    const editableForkliftAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: forkliftPatchEvent.json.event.id, employeeId: "emp_alejandro", role: "Montaje" }
    });
    assert.equal(editableForkliftAssignment.status, 201);

    const blockedForkliftRoleChange = await jsonRequest(
      baseUrl,
      `/api/assignments/${editableForkliftAssignment.json.assignment.id}`,
      {
        method: "PATCH",
        token,
        body: { role: "Carretillero" }
      }
    );
    assert.equal(blockedForkliftRoleChange.status, 409);
    assert.equal(blockedForkliftRoleChange.json.issues.some((issue) => issue.message.includes("carretillero")), true);

    const forkliftDocument = await jsonRequest(baseUrl, "/api/documents", {
      method: "POST",
      token,
      body: {
        employeeId: "emp_alejandro",
        type: "Carnet carretillero",
        name: "Carnet carretillero vigente",
        status: "vigente",
        fileName: "carnet-carretillero.txt",
        fileMime: "text/plain",
        fileDataBase64: `data:text/plain;base64,${Buffer.from("CARNET CARRETILLERO OK").toString("base64")}`
      }
    });
    assert.equal(forkliftDocument.status, 201);

    const allowedForkliftRoleChange = await jsonRequest(
      baseUrl,
      `/api/assignments/${editableForkliftAssignment.json.assignment.id}`,
      {
        method: "PATCH",
        token,
        body: { role: "Carretillero" }
      }
    );
    assert.equal(allowedForkliftRoleChange.status, 200);
    assert.equal(allowedForkliftRoleChange.json.assignment.role, "Carretillero");

    const allowedForkliftAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: forkliftEvent.json.event.id, employeeId: "emp_alejandro", role: "Carretillero" }
    });
    assert.equal(allowedForkliftAssignment.status, 201);
    assert.equal(allowedForkliftAssignment.json.assignment.role, "Carretillero");

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

    const employeeXlsx = minimalXlsxBuffer([
      ["NOMBRE", "APELLIDOS", "TELEFONO", "CORREO ELECTRONICO", "D.N.I.", "CAMISETA", "PANTALON", "CALZADO", "SKILLS"],
      ["Importada", "Excel", "+34600900122", "importada.xlsx@marfancrew.test", "XLSX12345", "XL", "44", "45", "montaje|jefe"]
    ]);
    const employeeExcelImport = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token,
      body: {
        fileName: "operarios-test.xlsx",
        fileMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileDataBase64: employeeXlsx.toString("base64"),
        defaultPassword: "Marfan2026!"
      }
    });
    assert.equal(employeeExcelImport.status, 201);
    assert.equal(employeeExcelImport.json.inserted, 1);
    assert.equal(employeeExcelImport.json.usersCreated, 1);
    const importedEmployeeExcelReport = await jsonRequest(baseUrl, "/api/reports/employees?search=XLSX12345", { token });
    assert.equal(importedEmployeeExcelReport.status, 200);
    assert.equal(importedEmployeeExcelReport.json.rows.length, 1);
    assert.equal(importedEmployeeExcelReport.json.rows[0].camiseta, "XL");

    const protectedEmployeeBeforeImport = await jsonRequest(baseUrl, "/api/employees/emp_alejandro", {
      method: "PATCH",
      token,
      body: { kmRate: 7.7 }
    });
    assert.equal(protectedEmployeeBeforeImport.status, 200);
    assert.equal(protectedEmployeeBeforeImport.json.employee.km_rate, 7.7);

    const partialEmployeeImport = await jsonRequest(baseUrl, "/api/imports/employees", {
      method: "POST",
      token,
      body: {
        fileName: "operarios-parcial-test.csv",
        fileText: [
          "NOMBRE;APELLIDOS;TELEFONO;CORREO ELECTRONICO;ROL;KM;SKILLS;CAMISETA",
          "Alejandro;Perez;+34600777888;empleado@marfancrew.test;;;;"
        ].join("\n"),
        defaultPassword: "Marfan2026!"
      }
    });
    assert.equal(partialEmployeeImport.status, 201);
    assert.equal(partialEmployeeImport.json.updated, 1);
    const employeesAfterPartialImport = await jsonRequest(baseUrl, "/api/employees", { token });
    assert.equal(employeesAfterPartialImport.status, 200);
    const alejandroAfterPartialImport = employeesAfterPartialImport.json.employees.find((employee) => employee.id === "emp_alejandro");
    assert.equal(alejandroAfterPartialImport.role, "Montaje");
    assert.equal(alejandroAfterPartialImport.km_rate, 7.7);
    assert.equal(alejandroAfterPartialImport.skills.includes("carga"), true);

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

    const partialClientImport = await jsonRequest(baseUrl, "/api/imports/clients", {
      method: "POST",
      token,
      body: {
        fileName: "clientes-parcial-test.csv",
        fileText: [
          "CLIENTE;RAZON SOCIAL;CIF;PERSONA CONTACTO;MAIL;TELEFONO;PROVINCIA",
          "Cliente CSV;;B123CSV;;;;"
        ].join("\n")
      }
    });
    assert.equal(partialClientImport.status, 201);
    assert.equal(partialClientImport.json.updated, 1);
    const clientsAfterPartialImport = await jsonRequest(baseUrl, "/api/clients", { token });
    assert.equal(clientsAfterPartialImport.status, 200);
    const clientAfterPartialImport = clientsAfterPartialImport.json.clients.find((client) => client.tax_id === "B123CSV");
    assert.equal(clientAfterPartialImport.legal_name, "Cliente CSV SL");
    assert.equal(clientAfterPartialImport.contact_name, "Responsable CSV");
    assert.equal(clientAfterPartialImport.email, "csv@cliente.test");
    assert.equal(clientAfterPartialImport.phone, "+34959900111");

    const clientXlsx = minimalXlsxBuffer([
      ["CLIENTE", "RAZON SOCIAL", "CIF", "PERSONA CONTACTO", "MAIL", "TELEFONO", "PROVINCIA"],
      ["Cliente Excel", "Cliente Excel SL", "B123XLSX", "Responsable Excel", "xlsx@cliente.test", "+34959900122", "Malaga"]
    ]);
    const clientExcelImport = await jsonRequest(baseUrl, "/api/imports/clients", {
      method: "POST",
      token,
      body: {
        fileName: "clientes-test.xlsx",
        fileMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileDataBase64: clientXlsx.toString("base64")
      }
    });
    assert.equal(clientExcelImport.status, 201);
    assert.equal(clientExcelImport.json.inserted, 1);
    const clientExcelImportAgain = await jsonRequest(baseUrl, "/api/imports/clients", {
      method: "POST",
      token,
      body: {
        fileName: "clientes-test.xlsx",
        fileMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileDataBase64: clientXlsx.toString("base64")
      }
    });
    assert.equal(clientExcelImportAgain.status, 201);
    assert.equal(clientExcelImportAgain.json.inserted, 0);
    assert.equal(clientExcelImportAgain.json.updated, 1);

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
    assert.equal(importedGoogle.json.event.deliveryNote.status, "borrador");
    assert.equal(importedGoogle.json.event.deliveryNote.locked, 0);

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

    const planningDate = addDaysLocal(1);
    const createdEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio pendiente Google",
        clientId: "cli_tech",
        date: planningDate,
        startTime: "09:00",
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
    assert.equal(createdEvent.json.event.deliveryNote.status, "borrador");
    assert.equal(createdEvent.json.event.deliveryNote.locked, 0);

    const eventForDeletion = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio para borrar",
        clientId: "cli_tech",
        date: planningDate,
        startTime: "16:00",
        endTime: "18:00",
        location: "Recinto temporal Malaga",
        address: "Recinto temporal Malaga",
        lat: 36.72,
        lng: -4.42,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(eventForDeletion.status, 201);
    const adminDeleteEvent = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(adminDeleteEvent.status, 403);
    const superDeleteEvent = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}`, {
      method: "DELETE",
      token: superToken
    });
    assert.equal(superDeleteEvent.status, 200);
    assert.equal(superDeleteEvent.json.deletedEventId, eventForDeletion.json.event.id);
    assert.equal(superDeleteEvent.json.archived, true);
    assert.equal(superDeleteEvent.json.restorable, true);
    assert.equal(superDeleteEvent.json.counts.deliveryNotes, 1);
    const deletedEventLookup = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}`, { token });
    assert.equal(deletedEventLookup.status, 404);
    const activeEventsAfterDelete = await jsonRequest(baseUrl, "/api/events", { token });
    assert.equal(activeEventsAfterDelete.status, 200);
    assert.equal(activeEventsAfterDelete.json.events.some((item) => item.id === eventForDeletion.json.event.id), false);
    const deletedEventsAsAdmin = await jsonRequest(baseUrl, "/api/events?deleted=only", { token });
    assert.equal(deletedEventsAsAdmin.status, 403);
    const deletedEvents = await jsonRequest(baseUrl, "/api/events?deleted=only", { token: superToken });
    assert.equal(deletedEvents.status, 200);
    const deletedEventRow = deletedEvents.json.events.find((item) => item.id === eventForDeletion.json.event.id);
    assert.ok(deletedEventRow);
    assert.ok(deletedEventRow.deleted_at);
    const deleteAudit = await jsonRequest(baseUrl, `/api/audit-logs?action=event_deleted&entity=event`, { token: superToken });
    assert.equal(deleteAudit.status, 200);
    assert.equal(deleteAudit.json.logs.some((log) => log.entity_id === eventForDeletion.json.event.id), true);
    const adminRestoreEvent = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}/restore`, {
      method: "POST",
      token
    });
    assert.equal(adminRestoreEvent.status, 403);
    const superRestoreEvent = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}/restore`, {
      method: "POST",
      token: superToken
    });
    assert.equal(superRestoreEvent.status, 200);
    assert.equal(superRestoreEvent.json.restoredEventId, eventForDeletion.json.event.id);
    assert.equal(superRestoreEvent.json.event.deliveryNote.status, "borrador");
    const restoredEventLookup = await jsonRequest(baseUrl, `/api/events/${eventForDeletion.json.event.id}`, { token });
    assert.equal(restoredEventLookup.status, 200);
    assert.equal(restoredEventLookup.json.event.id, eventForDeletion.json.event.id);
    const deletedEventsAfterRestore = await jsonRequest(baseUrl, "/api/events?deleted=only", { token: superToken });
    assert.equal(deletedEventsAfterRestore.json.events.some((item) => item.id === eventForDeletion.json.event.id), false);
    const restoreAudit = await jsonRequest(baseUrl, `/api/audit-logs?action=event_restored&entity=event`, { token: superToken });
    assert.equal(restoreAudit.status, 200);
    assert.equal(restoreAudit.json.logs.some((log) => log.entity_id === eventForDeletion.json.event.id), true);

    const throwawayClient = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token,
      body: {
        name: "Cliente sin historico borrar",
        taxId: "BDELETE001",
        contactName: "Contacto borrar",
        email: "delete-client@marfancrew.test"
      }
    });
    assert.equal(throwawayClient.status, 201);
    const hardDeleteClient = await jsonRequest(baseUrl, `/api/clients/${throwawayClient.json.client.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(hardDeleteClient.status, 200);
    assert.equal(hardDeleteClient.json.archived, false);

    const historyClient = await jsonRequest(baseUrl, "/api/clients", {
      method: "POST",
      token,
      body: {
        name: "Cliente con historico borrar",
        taxId: "BDELETE002",
        contactName: "Contacto historico"
      }
    });
    assert.equal(historyClient.status, 201);
    const historyClientEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Evento conserva cliente eliminado",
        clientId: historyClient.json.client.id,
        date: planningDate,
        startTime: "18:00",
        endTime: "20:00",
        location: "Recinto historico",
        address: "Recinto historico",
        lat: 36.72,
        lng: -4.42,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(historyClientEvent.status, 201);
    const archiveClient = await jsonRequest(baseUrl, `/api/clients/${historyClient.json.client.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(archiveClient.status, 200);
    assert.equal(archiveClient.json.archived, true);
    const clientsAfterDelete = await jsonRequest(baseUrl, "/api/clients", { token });
    assert.equal(clientsAfterDelete.status, 200);
    assert.equal(clientsAfterDelete.json.clients.some((client) => client.id === historyClient.json.client.id), false);
    const eventKeepsClient = await jsonRequest(baseUrl, `/api/events/${historyClientEvent.json.event.id}`, { token });
    assert.equal(eventKeepsClient.status, 200);
    assert.equal(eventKeepsClient.json.event.client_name, "Cliente con historico borrar");

    const throwawayEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Sin Historico Borrar",
        role: "Montaje",
        phone: "600333444",
        email: "delete-employee@marfancrew.test",
        portalAccess: true
      }
    });
    assert.equal(throwawayEmployee.status, 201);
    const hardDeleteEmployee = await jsonRequest(baseUrl, `/api/employees/${throwawayEmployee.json.employee.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(hardDeleteEmployee.status, 200);
    assert.equal(hardDeleteEmployee.json.archived, false);
    const deletedEmployeeLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600333444", password: "600333444", mode: "employee" }
    });
    assert.equal(deletedEmployeeLogin.status, 401);

    const historyEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Con Historico Borrar",
        role: "Montaje",
        phone: "600333445",
        email: "archive-employee@marfancrew.test",
        portalAccess: true
      }
    });
    assert.equal(historyEmployee.status, 201);
    const historyEmployeeAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: {
        eventId: historyClientEvent.json.event.id,
        employeeId: historyEmployee.json.employee.id,
        role: "Montaje"
      }
    });
    assert.equal(historyEmployeeAssignment.status, 201);
    const closeHistoryEmployeeEvent = await jsonRequest(baseUrl, `/api/events/${historyClientEvent.json.event.id}/close`, {
      method: "POST",
      token
    });
    assert.equal(closeHistoryEmployeeEvent.status, 200);
    const archiveEmployee = await jsonRequest(baseUrl, `/api/employees/${historyEmployee.json.employee.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(archiveEmployee.status, 200);
    assert.equal(archiveEmployee.json.archived, true);
    const employeesAfterDelete = await jsonRequest(baseUrl, "/api/employees", { token });
    assert.equal(employeesAfterDelete.status, 200);
    assert.equal(employeesAfterDelete.json.employees.some((employee) => employee.id === historyEmployee.json.employee.id), false);
    const archivedEmployeeLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600333445", password: "600333445", mode: "employee" }
    });
    assert.equal(archivedEmployeeLogin.status, 401);
    const employeeDeleteAudit = await jsonRequest(baseUrl, `/api/audit-logs?action=employee_archived&entity=employee`, { token: superToken });
    assert.equal(employeeDeleteAudit.status, 200);
    assert.equal(employeeDeleteAudit.json.logs.some((log) => log.entity_id === historyEmployee.json.employee.id), true);

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

    const duplicateDate = addDaysLocal(2);
    const duplicatedEvent = await jsonRequest(baseUrl, `/api/events/${createdEvent.json.event.id}/duplicate`, {
      method: "POST",
      token,
      body: { date: duplicateDate }
    });
    assert.equal(duplicatedEvent.status, 201);
    assert.equal(duplicatedEvent.json.copiedAssignments.length, 1);
    assert.equal(duplicatedEvent.json.skippedAssignments.length, 0);
    assert.equal(duplicatedEvent.json.event.date, duplicateDate);
    assert.equal(duplicatedEvent.json.event.deliveryNote.status, "borrador");
    assert.equal(duplicatedEvent.json.event.deliveryNote.locked, 0);
    assert.equal(duplicatedEvent.json.event.assignments.some((assignment) =>
      assignment.employee_id === "emp_alejandro" &&
      assignment.role === "Montaje"
    ), true);
    assert.equal(duplicatedEvent.json.event.assigned_count, 1);

    const duplicatedAssignment = duplicatedEvent.json.event.assignments.find((assignment) =>
      assignment.employee_id === "emp_alejandro"
    );
    const traceAllowance = await jsonRequest(baseUrl, "/api/allowances", {
      method: "POST",
      token,
      body: {
        eventId: duplicatedEvent.json.event.id,
        employeeId: "emp_alejandro",
        km: 3.5,
        diet: 9,
        nightHours: 0.5,
        extras: 2
      }
    });
    assert.equal(traceAllowance.status, 201);

    const deletedAllowance = await jsonRequest(baseUrl, `/api/allowances/${traceAllowance.json.allowance.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(deletedAllowance.status, 200);

    const deletedAssignment = await jsonRequest(baseUrl, `/api/assignments/${duplicatedAssignment.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(deletedAssignment.status, 200);

    const traceSnapshots = await jsonRequest(baseUrl, `/api/events/${duplicatedEvent.json.event.id}/snapshots?limit=10`, { token });
    assert.equal(traceSnapshots.status, 200);
    const assignmentDeletedSnapshot = traceSnapshots.json.snapshots.find((snapshot) => snapshot.action === "assignment_deleted");
    assert.equal(assignmentDeletedSnapshot.payload_hash_valid, true);
    assert.equal(assignmentDeletedSnapshot.metadata.deletedAssignment.employee_id, "emp_alejandro");
    assert.equal(assignmentDeletedSnapshot.metadata.deletedAssignment.role, "Montaje");
    assert.equal(assignmentDeletedSnapshot.metadata.deletedAssignment.name, "Alejandro Perez");
    const allowanceDeletedSnapshot = traceSnapshots.json.snapshots.find((snapshot) => snapshot.action === "allowance_deleted");
    assert.equal(allowanceDeletedSnapshot.payload_hash_valid, true);
    assert.equal(allowanceDeletedSnapshot.metadata.deletedAllowance.employee_id, "emp_alejandro");
    assert.equal(allowanceDeletedSnapshot.metadata.deletedAllowance.km, 3.5);
    assert.equal(allowanceDeletedSnapshot.metadata.deletedAllowance.diet, 9);

    const clientDossier = await fetch(`${baseUrl}/api/events/${createdEvent.json.event.id}/client-dossier`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const clientDossierHtml = await clientDossier.text();
    assert.equal(clientDossier.status, 200);
    assert.match(clientDossierHtml, /MARFAN CREW ERP/);
    assert.match(clientDossierHtml, /Abrir archivo/);
    assert.match(clientDossierHtml, new RegExp(`/api/documents/${uploadedDocument.json.document.id}/file`));

    const nightRestDate = addDaysLocal(8);
    const morningRestDate = addDaysLocal(9);
    const nightRestEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Montaje nocturno descanso",
        clientId: "cli_tech",
        date: nightRestDate,
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
    assert.equal(nightRestAssignment.status, 201, JSON.stringify(nightRestAssignment.json));
    const morningRestEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Turno temprano descanso",
        clientId: "cli_tech",
        date: morningRestDate,
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
        startDate: morningRestDate,
        endDate: morningRestDate,
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

    const approvedAvailability = await jsonRequest(
      baseUrl,
      `/api/availability/${pendingAvailability.json.availability.id}`,
      {
        method: "PATCH",
        token,
        body: { status: "aprobado", reason: "Solicitud aprobada por administracion" }
      }
    );
    assert.equal(approvedAvailability.status, 200);
    assert.equal(approvedAvailability.json.availability.status, "aprobado");

    const approvedAvailabilityRecommendations = await jsonRequest(
      baseUrl,
      `/api/planner/recommendations?eventId=${encodeURIComponent(morningRestEvent.json.event.id)}`,
      { token }
    );
    assert.equal(approvedAvailabilityRecommendations.status, 200);
    const nereaUnavailable = approvedAvailabilityRecommendations.json.recommendations.find((item) =>
      item.employee.id === "emp_nerea"
    );
    assert.equal(nereaUnavailable.issues.some((issue) => issue.type === "disponibilidad" && issue.severity === "block"), true);

    const blockedUnavailableAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: { eventId: morningRestEvent.json.event.id, employeeId: "emp_nerea", role: "Limpieza" }
    });
    assert.equal(blockedUnavailableAssignment.status, 409);
    assert.equal(blockedUnavailableAssignment.json.issues.some((issue) =>
      issue.type === "disponibilidad" &&
      issue.severity === "block"
    ), true);

    const filteredEventsReport = await jsonRequest(
      baseUrl,
      `/api/reports/events?from=${planningDate}&to=${planningDate}&clientId=cli_tech&employeeId=emp_alejandro`,
      { token }
    );
    assert.equal(filteredEventsReport.status, 200);
    assert.equal(filteredEventsReport.json.filters.clientId, "cli_tech");
    assert.equal(filteredEventsReport.json.filters.employeeId, "emp_alejandro");
    assert.equal(filteredEventsReport.json.rows.some((row) => row.id === createdEvent.json.event.id), true);
    assert.equal(filteredEventsReport.json.rows.every((row) => row.fecha === planningDate && row.cliente === "Tech Events S.L."), true);

    const eventsPdfReport = await fetch(
      `${baseUrl}/api/reports/events?from=${planningDate}&to=${planningDate}&clientId=cli_tech&employeeId=emp_alejandro&format=pdf`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const eventsPdfBuffer = Buffer.from(await eventsPdfReport.arrayBuffer());
    const eventsPdfText = eventsPdfBuffer.toString("utf8");
    assert.equal(eventsPdfReport.status, 200);
    assert.match(eventsPdfReport.headers.get("content-type"), /application\/pdf/);
    assert.equal(eventsPdfBuffer.subarray(0, 4).toString(), "%PDF");
    assert.ok(eventsPdfBuffer.length > 3000);
    assert.match(eventsPdfText, /MARFAN CREW/);
    assert.match(eventsPdfText, /Informe corporativo de operaciones/);

    const filteredFinanceReport = await jsonRequest(
      baseUrl,
      `/api/reports/finance?from=${planningDate}&to=${planningDate}&clientId=cli_tech&employeeId=emp_alejandro`,
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

    const openClockWindowForGpsTest = await jsonRequest(baseUrl, "/api/settings", {
      method: "PATCH",
      token,
      body: {
        clock_entry_early_minutes: "1440",
        clock_exit_late_minutes: "2880"
      }
    });
    assert.equal(openClockWindowForGpsTest.status, 200);

    const autoConfirmEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Autoconfirma",
        phone: "+34600111999",
        email: "autoconfirma@marfancrew.test",
        role: "Montaje",
        portalAccess: true
      }
    });
    assert.equal(autoConfirmEmployee.status, 201);

    const autoConfirmEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio pendiente que ficha entrada",
        clientId: "cli_tech",
        date: todayLocal(),
        startTime: "00:00",
        endTime: "00:01",
        location: "Recinto autoconfirma",
        address: "Recinto autoconfirma",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(autoConfirmEvent.status, 201);

    const pendingClockAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: {
        eventId: autoConfirmEvent.json.event.id,
        employeeId: autoConfirmEmployee.json.employee.id,
        role: "Montaje",
        status: "pendiente"
      }
    });
    assert.equal(pendingClockAssignment.status, 201);
    assert.equal(pendingClockAssignment.json.assignment.status, "pendiente");

    const autoConfirmLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111999", password: "600111999", mode: "employee" }
    });
    assert.equal(autoConfirmLogin.status, 200);

    const autoConfirmClock = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token: autoConfirmLogin.json.token,
      headers: { "user-agent": "MARFAN-Test-Employee" },
      body: {
        eventId: autoConfirmEvent.json.event.id,
        type: "entrada",
        lat: 36.694,
        lng: -4.4605,
        accuracy: 6
      }
    });
    assert.equal(autoConfirmClock.status, 201);
    assert.equal(autoConfirmClock.json.entry.employee_id, autoConfirmEmployee.json.employee.id);

    const nextEmployeeEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Segundo servicio fichable",
        clientId: "cli_tech",
        date: todayLocal(),
        startTime: "00:02",
        endTime: "23:59",
        location: "Recinto segundo fichaje",
        address: "Recinto segundo fichaje",
        lat: 36.694,
        lng: -4.4605,
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(nextEmployeeEvent.status, 201);
    const nextEmployeeAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: {
        eventId: nextEmployeeEvent.json.event.id,
        employeeId: autoConfirmEmployee.json.employee.id,
        role: "Montaje",
        status: "confirmado"
      }
    });
    assert.equal(nextEmployeeAssignment.status, 201);
    const autoConfirmClockOut = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token: autoConfirmLogin.json.token,
      body: {
        eventId: autoConfirmEvent.json.event.id,
        type: "salida",
        lat: 36.694,
        lng: -4.4605,
        accuracy: 6
      }
    });
    assert.equal(autoConfirmClockOut.status, 201);
    const employeeHomeAfterCompletedService = await jsonRequest(baseUrl, "/api/employee/home", { token: autoConfirmLogin.json.token });
    assert.equal(employeeHomeAfterCompletedService.status, 200);
    assert.equal(employeeHomeAfterCompletedService.json.nextService.id, nextEmployeeEvent.json.event.id);
    assert.equal(employeeHomeAfterCompletedService.json.nextService.can_clock_in, 1);

    const autoConfirmedEvent = await jsonRequest(baseUrl, `/api/events/${autoConfirmEvent.json.event.id}`, { token });
    assert.equal(autoConfirmedEvent.status, 200);
    assert.equal(autoConfirmedEvent.json.event.assignments[0].status, "confirmado");
    const autoConfirmSnapshots = await jsonRequest(baseUrl, `/api/events/${autoConfirmEvent.json.event.id}/snapshots?limit=5`, { token });
    const autoConfirmSnapshot = autoConfirmSnapshots.json.snapshots.find((snapshot) =>
      snapshot.action === "time_entry_created" &&
      snapshot.metadata?.autoConfirmedAssignment === true
    );
    assert.ok(autoConfirmSnapshot);
    assert.equal(autoConfirmSnapshot.payload_hash_valid, true);

    const noGpsEmployee = await jsonRequest(baseUrl, "/api/employees", {
      method: "POST",
      token,
      body: {
        name: "Operario Servicio Sin GPS",
        phone: "+34600111888",
        email: "singps@marfancrew.test",
        role: "Montaje",
        portalAccess: true
      }
    });
    assert.equal(noGpsEmployee.status, 201);

    const noGpsEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio sin coordenadas reales",
        clientId: "cli_tech",
        date: todayLocal(),
        startTime: "00:00",
        endTime: "23:59",
        location: "Recinto sin coordenadas",
        address: "Recinto sin coordenadas",
        requiredTotal: 1,
        requirements: [{ role: "Montaje", count: 1 }]
      }
    });
    assert.equal(noGpsEvent.status, 201);
    assert.equal(noGpsEvent.json.event.location_source, "base_fallback");

    const noGpsAssignment = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: {
        eventId: noGpsEvent.json.event.id,
        employeeId: noGpsEmployee.json.employee.id,
        role: "Montaje",
        status: "confirmado"
      }
    });
    assert.equal(noGpsAssignment.status, 201);

    const noGpsLogin = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { identifier: "600111888", password: "600111888", mode: "employee" }
    });
    assert.equal(noGpsLogin.status, 200);

    const noGpsHome = await jsonRequest(baseUrl, "/api/employee/home", { token: noGpsLogin.json.token });
    assert.equal(noGpsHome.status, 200);
    assert.equal(noGpsHome.json.nextService.can_clock_in, 0);
    assert.match(noGpsHome.json.nextService.clock_block_reason, /ubicacion GPS real/i);
    assert.equal(noGpsHome.json.nextService.checklist.items.some((item) =>
      item.key === "location" &&
      item.status === "pending" &&
      /GPS real/.test(item.detail)
    ), true);

    const noGpsClock = await jsonRequest(baseUrl, "/api/time-entries/clock", {
      method: "POST",
      token: noGpsLogin.json.token,
      body: {
        eventId: noGpsEvent.json.event.id,
        type: "entrada",
        lat: 36.7213,
        lng: -4.42164,
        accuracy: 5
      }
    });
    assert.equal(noGpsClock.status, 409);
    assert.match(noGpsClock.json.error, /ubicacion GPS real/i);
    assert.equal(noGpsClock.json.distance, null);
    assert.equal(noGpsClock.json.entry.type, "entrada_bloqueada");
    assert.match(noGpsClock.json.entry.notes, /ubicacion GPS real/i);

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
        timestamp: `${planningDate}T10:05`,
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
    assert.match(blockedSnapshot.payload_hash, /^[a-f0-9]{64}$/);
    assert.equal(blockedSnapshot.payload_hash_valid, true);
    assert.equal(blockedSnapshot.payload.event.id, createdEvent.json.event.id);
    assert.equal(blockedSnapshot.payload.event.assignments.some((assignment) => assignment.employee_id === "emp_alejandro"), true);
    assert.equal(blockedSnapshot.payload.event.timeEntries.some((entry) => entry.type === "entrada_bloqueada"), true);
    assert.equal(blockedSnapshot.payload.event.incidents.some((incident) => incident.type === "fichaje"), true);

	    const today = todayLocal();
	    const deliverySettings = await jsonRequest(baseUrl, "/api/settings", {
	      method: "PATCH",
	      token,
	      body: {
	        base_address: "Base Operativa Test Malaga",
	        included_km: "12",
	        vehicle_km_price: "0.44"
	      }
	    });
	    assert.equal(deliverySettings.status, 200);
	    assert.equal(deliverySettings.json.settings.base_address, "Base Operativa Test Malaga");

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
        signatureImage: testSignaturePngDataUrl(),
        clientNotes: "Servicio conforme"
      }
    });
    assert.equal(signedClockOut.status, 201);
    assert.equal(signedClockOut.json.deliveryNote.status, "firmado");
    assert.equal(signedClockOut.json.deliveryNote.locked, 1);

    const lockedTimeEntryCorrection = await jsonRequest(baseUrl, `/api/time-entries/${signedClockOut.json.entry.id}`, {
      method: "PATCH",
      token,
      body: {
        timestamp: `${today}T23:30`,
        accepted: true,
        notes: "Intento de correccion posterior a firma",
        correctionReason: "No debe alterar un albaran firmado"
      }
    });
    assert.equal(lockedTimeEntryCorrection.status, 409);
    assert.match(lockedTimeEntryCorrection.json.error, /Albaran firmado/i);

    const signedEventEdit = await jsonRequest(baseUrl, `/api/events/${deliveryEvent.json.event.id}`, {
      method: "PATCH",
      token,
      body: {
        notes: "Intento de editar despues de firma",
        budget: 9999
      }
    });
    assert.equal(signedEventEdit.status, 409);
    assert.match(signedEventEdit.json.error, /Albaran firmado/i);

    const signedAssignmentCreate = await jsonRequest(baseUrl, "/api/assignments", {
      method: "POST",
      token,
      body: {
        eventId: deliveryEvent.json.event.id,
        employeeId: "emp_alejandro",
        role: "Montaje"
      }
    });
    assert.equal(signedAssignmentCreate.status, 409);
    assert.match(signedAssignmentCreate.json.error, /Albaran firmado/i);

    const signedAssignmentUpdate = await jsonRequest(baseUrl, `/api/assignments/${deliveryAssignment.json.assignment.id}`, {
      method: "PATCH",
      token,
      body: {
        status: "bloqueado"
      }
    });
    assert.equal(signedAssignmentUpdate.status, 409);
    assert.match(signedAssignmentUpdate.json.error, /Albaran firmado/i);

    const signedAssignmentDelete = await jsonRequest(baseUrl, `/api/assignments/${deliveryAssignment.json.assignment.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(signedAssignmentDelete.status, 409);
    assert.match(signedAssignmentDelete.json.error, /Albaran firmado/i);

    const deliveryPdf = await fetch(`${baseUrl}/api/delivery-notes/${deliveryEvent.json.event.id}?format=pdf`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const deliveryPdfBuffer = Buffer.from(await deliveryPdf.arrayBuffer());
    assert.equal(deliveryPdf.status, 200);
    assert.match(deliveryPdf.headers.get("content-type"), /application\/pdf/);
	    assert.equal(deliveryPdfBuffer.subarray(0, 4).toString(), "%PDF");
	    assert.ok(deliveryPdfBuffer.length > 2500);
	    assert.match(deliveryPdfBuffer.toString("latin1"), /\/Subtype \/Image/);
	    assert.match(deliveryPdfBuffer.toString("latin1"), /Base Operativa Test Malaga/);
	    assert.match(deliveryPdfBuffer.toString("latin1"), /Km incluidos 12\.0/);

	    const deliveryHtml = await fetch(`${baseUrl}/api/delivery-notes/${deliveryEvent.json.event.id}`, {
	      headers: { authorization: `Bearer ${token}` }
	    });
	    const deliveryHtmlText = await deliveryHtml.text();
	    assert.equal(deliveryHtml.status, 200);
	    assert.match(deliveryHtmlText, /Base Operativa Test Malaga/);
	    assert.match(deliveryHtmlText, /12\.0 km/);
	    assert.match(deliveryHtmlText, /0\.44 EUR\/km/);

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

    const autoDetectedLive = await jsonRequest(baseUrl, `/api/live?date=${today}`, { token });
    assert.equal(autoDetectedLive.status, 200);
    assert.equal(autoDetectedLive.json.attendanceDetection.created >= 1, true);
    assert.equal(autoDetectedLive.json.events.some((event) =>
      event.id === attendanceEvent.json.event.id &&
      event.liveIncidents.some((incident) =>
        incident.employee_id === "emp_alejandro" &&
        incident.type === "ausencia"
      )
    ), true);

    const autoDetectedLiveAgain = await jsonRequest(baseUrl, `/api/live?date=${today}`, { token });
    assert.equal(autoDetectedLiveAgain.status, 200);
    assert.equal(autoDetectedLiveAgain.json.attendanceDetection.created, 0);

    const detectedAttendance = await jsonRequest(baseUrl, "/api/incidents/detect-attendance", {
      method: "POST",
      token,
      body: { date: today }
    });
    assert.equal(detectedAttendance.status, 200);
    assert.equal(detectedAttendance.json.created, 0);
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
  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${JSON.stringify(mockGoogleFetch)}`].filter(Boolean).join(" ");
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      MOCK_GOOGLE_FETCH_LOG: googleLog,
      GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify({
        web: {
          client_id: "oauth-client.test",
          client_secret: "oauth-secret",
          token_uri: "https://oauth2.test/token",
          redirect_uris: [`${baseUrl}/api/calendar/google-oauth/callback`]
        }
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

    const oauthServiceDate = addDaysLocal(10);
    const importedServiceDate = addDaysLocal(11);
    const createdEvent = await jsonRequest(baseUrl, "/api/events", {
      method: "POST",
      token,
      body: {
        name: "Servicio OAuth Google",
        clientId: "cli_tech",
        date: oauthServiceDate,
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

	    const googleSyncedEmployee = await jsonRequest(baseUrl, "/api/employees", {
	      method: "POST",
	      token,
	      body: {
	        name: "Operario Google Sync",
	        phone: "+34600999001",
	        email: "google.sync@marfancrew.test",
	        role: "Montaje",
	        skills: ["montaje"]
	      }
	    });
	    assert.equal(googleSyncedEmployee.status, 201);

	    const googleSyncedAssignment = await jsonRequest(baseUrl, "/api/assignments", {
	      method: "POST",
	      token,
	      body: {
	        eventId: createdEvent.json.event.id,
	        employeeId: googleSyncedEmployee.json.employee.id,
	        role: "Montaje"
	      }
	    });
	    assert.equal(googleSyncedAssignment.status, 201);
	    assert.equal(googleSyncedAssignment.json.googleSync.status, "synced");

	    const importedGoogle = await jsonRequest(baseUrl, "/api/calendar/import-google-event", {
      method: "POST",
      token,
      body: {
	        id: "google_oauth_imported",
	        googleUid: "google-oauth-imported@example.com",
	        name: "Evento Google por completar",
	        date: importedServiceDate,
        startTime: "09:00",
        endTime: "11:00",
        location: "Recinto Google OAuth",
        address: "Recinto Google OAuth, Malaga"
      }
    });
    assert.equal(importedGoogle.status, 201);
    assert.equal(importedGoogle.json.event.google_sync_status, "imported");
    assert.equal(importedGoogle.json.event.deliveryNote.status, "borrador");

    const editedGoogle = await jsonRequest(baseUrl, `/api/events/${importedGoogle.json.event.id}`, {
      method: "PATCH",
      token,
      body: {
	        name: "Evento Google editado en MARFAN",
	        date: importedServiceDate,
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
	    assert.equal(googleCalls.some((call) =>
	      call.kind === "calendar" &&
	      call.method === "PATCH" &&
	      call.summary === "Servicio OAuth Google" &&
	      call.description.includes("Operario Google Sync") &&
	      call.private.marfan_event_id === createdEvent.json.event.id &&
	      call.private.marfan_assignment_count === "1" &&
	      call.private.marfan_assigned_employee_ids.includes(googleSyncedEmployee.json.employee.id) &&
	      call.private.marfan_required_roles === "Montaje x1"
	    ), true);
	    assert.equal(googleCalls.some((call) => call.kind === "calendar" && call.method === "GET" && call.url.includes("iCalUID=google-oauth-imported")), true);
    assert.equal(googleCalls.some((call) => call.kind === "calendar" && call.method === "PATCH" && call.summary === "Evento Google editado en MARFAN"), true);
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

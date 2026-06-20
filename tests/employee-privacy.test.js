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
    const home = await fetch(`${baseUrl}/api/employee/home`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(home.status, 200);
    const payload = await home.json();
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
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  all,
  BACKUP_DIR,
  createBackup,
  DATA_DIR,
  get,
  requestRestore,
  run,
  transaction,
  verifySqliteBackupFile
} = require("./db");
const { distanceMeters, isInsideRadius } = require("./geo");
const { randomId, randomToken, verifyPassword, hashPassword } = require("./security");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_DIR = path.join(process.cwd(), "client");
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)"
};
const DEMO_MODE = process.env.APP_DEMO_MODE === "true";
const DEFAULT_CLOCK_RADIUS_M = 150;
const MAX_BODY_BYTES = 15_000_000;
const MAX_DOCUMENT_FILE_BYTES = 8_000_000;
const MAX_PROFILE_PHOTO_BYTES = 1_000_000;
const MAX_IMPORT_FILE_BYTES = 8_000_000;
const DOCUMENT_UPLOAD_DIR = path.join(DATA_DIR, "uploads", "documents");
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const DOCUMENT_EXTENSION_MIME_TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_GOOGLE_CALENDAR_ID = "21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37@group.calendar.google.com";
const DEFAULT_GOOGLE_CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?src=21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37%40group.calendar.google.com&ctz=Europe%2FMadrid";
const GOOGLE_CALENDAR_TIME_ZONE = "Europe/Madrid";
const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_FAILURES = 5;
let googleAccessTokenCache = null;
const googleOauthStates = new Map();
const authFailureBuckets = new Map();
const backupAutomationState = {
  running: false,
  lastRunAt: "",
  lastResult: null,
  nextRunAt: ""
};
const ADMIN_PERMISSION_DEFS = [
  ["dashboard", "Dashboard"],
  ["users", "Administradores"],
  ["live", "Centro Live"],
  ["calendar", "Calendario"],
  ["events", "Eventos"],
  ["clients", "Clientes"],
  ["employees", "Operarios"],
  ["availability", "Disponibilidad"],
  ["assignments", "Asignaciones"],
  ["clocking", "Fichajes"],
  ["incidents", "Incidencias"],
  ["documents", "Documentacion"],
  ["finances", "Finanzas"],
  ["reports", "Informes"],
  ["settings", "Configuracion"],
  ["backups", "Backups"],
  ["imports", "Importaciones"]
];
const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSION_DEFS.map(([key]) => key);

fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });

function safeBackupPath(filePath) {
  const resolved = path.resolve(filePath || "");
  const base = path.resolve(BACKUP_DIR);
  if (!resolved.startsWith(`${base}${path.sep}`)) return null;
  return resolved;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function backupStatus(backup) {
  const resolved = safeBackupPath(backup.file_path);
  const status = {
    ...backup,
    path_valid: Boolean(resolved),
    exists: false,
    verified: false,
    integrity: resolved ? "missing" : "invalid_path",
    actual_size_bytes: 0,
    sha256: null,
    sqlite_quick_check: "",
    attachment_count: 0,
    attachment_bytes: 0,
    attachment_integrity: "",
    integrity_error: ""
  };

  if (!resolved || !fs.existsSync(resolved)) return status;

  const stats = fs.statSync(resolved);
  if (!stats.isFile()) return status;

  status.exists = true;
  status.actual_size_bytes = stats.size;
  status.sha256 = sha256File(resolved);
  const sqliteIntegrity = verifySqliteBackupFile(resolved, backup.size_bytes);
  status.sqlite_quick_check = sqliteIntegrity.quickCheck || "";
  status.attachment_count = sqliteIntegrity.attachmentCount || 0;
  status.attachment_bytes = sqliteIntegrity.attachmentBytes || 0;
  status.attachment_integrity = sqliteIntegrity.attachmentIntegrity || "";
  status.integrity_error = sqliteIntegrity.error || "";
  if (!sqliteIntegrity.sizeMatches) status.integrity = "size_mismatch";
  else if (!sqliteIntegrity.ok) status.integrity = sqliteIntegrity.quickCheck ? "sqlite_corrupt" : "sqlite_error";
  else status.integrity = "verified";
  status.verified = status.integrity === "verified";
  return status;
}

function secureHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function send(res, status, payload, headers = JSON_HEADERS) {
  res.writeHead(status, secureHeaders(headers));
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return res.end(payload);
  return res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function sendJson(res, status, payload) {
  send(res, status, payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Payload demasiado grande"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(Object.assign(new Error("JSON invalido"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function tokenFromRequest(req, options = {}) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const safeMethod = ["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase());
  if (!safeMethod && !options.allowCookie) return null;
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)marfan_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionStorageToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function sessionTokenCandidates(token) {
  const stored = sessionStorageToken(token);
  return stored === token ? [stored] : [stored, token];
}

function requestIsSecure(req) {
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return Boolean(req?.socket?.encrypted || forwarded.split(",").map((item) => item.trim()).includes("https"));
}

function sessionCookie(token, expiresAt, req) {
  const parts = [
    `marfan_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (requestIsSecure(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(req) {
  return [
    "marfan_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    requestIsSecure(req) ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function currentUser(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const candidates = sessionTokenCandidates(token);
  const session = get(
    `SELECT sessions.token, sessions.expires_at, users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token IN (${candidates.map(() => "?").join(",")}) AND users.active = 1
     ORDER BY CASE WHEN sessions.token = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [...candidates, candidates[0]]
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    run(`DELETE FROM sessions WHERE token IN (${candidates.map(() => "?").join(",")})`, candidates);
    return null;
  }
  if (session.token !== candidates[0]) {
    run("UPDATE sessions SET token = ? WHERE token = ?", [candidates[0], session.token]);
  }
  return publicUser(session);
}

function requestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req?.socket?.remoteAddress || "local";
}

function authIdentifierKey(identifier) {
  const raw = String(identifier || "").trim().toLowerCase();
  return phoneLoginKey(raw) || raw.replace(/\s+/g, "");
}

function authRateLimitKey(req, purpose, identifier) {
  return `${purpose}:${requestIp(req)}:${authIdentifierKey(identifier) || "anon"}`;
}

function authFailureBucket(key, now = Date.now()) {
  const existing = authFailureBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS };
    authFailureBuckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

function assertAuthRateLimit(req, purpose, identifier) {
  const key = authRateLimitKey(req, purpose, identifier);
  const bucket = authFailureBucket(key);
  if (bucket.count < AUTH_RATE_LIMIT_MAX_FAILURES) return key;
  const error = new Error("Demasiados intentos. Espera unos minutos y vuelve a probar.");
  error.status = 429;
  error.retryAfterSeconds = Math.max(Math.ceil((bucket.resetAt - Date.now()) / 1000), 1);
  throw error;
}

function recordAuthFailure(key) {
  const bucket = authFailureBucket(key);
  bucket.count += 1;
}

function clearAuthFailures(req, purpose, identifier) {
  authFailureBuckets.delete(authRateLimitKey(req, purpose, identifier));
}

function requireUser(user) {
  if (!user) {
    const error = new Error("No autorizado");
    error.status = 401;
    throw error;
  }
}

function requireAdmin(user) {
  requireUser(user);
  if (!["admin", "super_admin"].includes(user.role)) {
    const error = new Error("Permiso insuficiente");
    error.status = 403;
    throw error;
  }
}

function requireSuperAdmin(user) {
  requireUser(user);
  if (user.role !== "super_admin") {
    const error = new Error("Solo super admin");
    error.status = 403;
    throw error;
  }
}

function audit(actor, action, entity, entityId, metadata = {}) {
  run(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity, entity_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomId("aud"),
      actor?.id || null,
      action,
      entity,
      entityId,
      JSON.stringify(metadata)
    ]
  );
}

function listAuditLogs(filters = {}) {
  const where = [];
  const params = [];
  if (filters.action) {
    where.push("audit_logs.action = ?");
    params.push(filters.action);
  }
  if (filters.entity) {
    where.push("audit_logs.entity = ?");
    params.push(filters.entity);
  }
  if (filters.actorUserId) {
    where.push("audit_logs.actor_user_id = ?");
    params.push(filters.actorUserId);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 150), 1), 500);
  return all(
    `SELECT audit_logs.*,
            users.name AS actor_name,
            users.email AS actor_email,
            users.role AS actor_role
     FROM audit_logs
     LEFT JOIN users ON users.id = audit_logs.actor_user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY audit_logs.created_at DESC
     LIMIT ?`,
    [...params, limit]
  ).map((row) => ({
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name || "Sistema",
    actor_email: row.actor_email || "",
    actor_role: row.actor_role || "system",
    action: row.action,
    entity: row.entity,
    entity_id: row.entity_id,
    metadata: jsonField(row.metadata, {}),
    created_at: row.created_at
  }));
}

function eventSnapshotPayload(eventId) {
  const event = eventDetail(eventId);
  if (!event) return null;
  return {
    captured_at: new Date().toISOString(),
    event
  };
}

function eventSnapshotPayloadHash(payloadText) {
  return crypto.createHash("sha256").update(String(payloadText || "")).digest("hex");
}

function createEventSnapshot(eventId, action, actor = null, metadata = {}) {
  const payload = eventSnapshotPayload(eventId);
  if (!payload) return null;
  const id = randomId("evs");
  const payloadText = JSON.stringify(payload);
  const metadataText = JSON.stringify(metadata || {});
  const payloadHash = eventSnapshotPayloadHash(payloadText);
  run(
    `INSERT INTO event_snapshots (id, event_id, action, actor_user_id, payload, metadata, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      eventId,
      action,
      actor?.id || null,
      payloadText,
      metadataText,
      payloadHash
    ]
  );
  return {
    id,
    event_id: eventId,
    action,
    actor_user_id: actor?.id || null,
    payload,
    metadata,
    payload_hash: payloadHash,
    payload_hash_valid: true,
    created_at: new Date().toISOString()
  };
}

function listEventSnapshots(eventId, limit = 50) {
  return all(
    `SELECT event_snapshots.*,
            users.name AS actor_name,
            users.email AS actor_email,
            users.role AS actor_role
     FROM event_snapshots
     LEFT JOIN users ON users.id = event_snapshots.actor_user_id
     WHERE event_snapshots.event_id = ?
     ORDER BY event_snapshots.created_at DESC, event_snapshots.id DESC
     LIMIT ?`,
    [eventId, Math.min(Math.max(Number(limit || 50), 1), 200)]
  ).map((row) => {
    const computedHash = eventSnapshotPayloadHash(row.payload || "");
    let payloadHash = row.payload_hash || "";
    if (!payloadHash) {
      payloadHash = computedHash;
      run("UPDATE event_snapshots SET payload_hash = ? WHERE id = ?", [payloadHash, row.id]);
    }
    return {
      id: row.id,
      event_id: row.event_id,
      action: row.action,
      actor_user_id: row.actor_user_id,
      actor_name: row.actor_name || "Sistema",
      actor_email: row.actor_email || "",
      actor_role: row.actor_role || "system",
      payload: jsonField(row.payload, {}),
      metadata: jsonField(row.metadata, {}),
      payload_hash: payloadHash,
      payload_hash_valid: payloadHash === computedHash,
      created_at: row.created_at
    };
  });
}

function normalizeAdminPermissions(value, role = "admin") {
  if (role === "employee") return {};
  const parsed = typeof value === "string" ? jsonField(value, {}) : (value || {});
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, parsed[key] !== false]));
}

function permissionsFromBody(body, role, fallback) {
  if (role === "employee") return {};
  if (!body || body.permissions === undefined) return normalizeAdminPermissions(fallback, role);
  const permissions = body.permissions && typeof body.permissions === "object" ? body.permissions : {};
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, permissions[key] !== false]));
}

function userHasPermission(user, permission) {
  if (!permission) return true;
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (user.role !== "admin") return false;
  return normalizeAdminPermissions(user.permissions, user.role)[permission] !== false;
}

function userHasAnyPermission(user, permissions) {
  return permissions.some((permission) => userHasPermission(user, permission));
}

function userHasAllPermissions(user, permissions) {
  return permissions.every((permission) => userHasPermission(user, permission));
}

function adminPermissionsForRequest(pathname, method) {
  const write = method !== "GET";
  if (pathname === "/api/dashboard") return ["dashboard"];
  if (pathname === "/api/live") return ["live"];
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) return ["users"];
  if (pathname === "/api/settings") return ["settings"];
  if (pathname === "/api/work-roles") return method === "GET" ? ["events", "assignments", "settings"] : ["settings"];
  if (pathname.startsWith("/api/work-roles/") || pathname === "/api/maps/resolve") return ["settings"];
  if (pathname === "/api/calendar/marfan.ics") return [];
  if (pathname === "/api/calendar/import-google-event" || pathname === "/api/calendar/import-google-events") return ["calendar", "events"];
  if (pathname === "/api/calendar/google-oauth/start") return ["settings", "calendar"];
  if (pathname === "/api/calendar" || pathname.startsWith("/api/calendar/")) return ["calendar"];
  if (pathname === "/api/imports") return ["imports"];
  if (pathname === "/api/imports/templates/employees" || pathname === "/api/imports/employees") return ["employees", "imports"];
  if (pathname === "/api/imports/templates/clients" || pathname === "/api/imports/clients") return ["clients", "imports"];
  if (/^\/api\/events\/[^/]+\/client-dossier$/.test(pathname)) return ["reports"];
  if (/^\/api\/events\/[^/]+\/documents$/.test(pathname) || pathname.startsWith("/api/event-documents/")) return ["events", "documents"];
  if (pathname === "/api/events" || pathname.startsWith("/api/events/")) return write ? ["events"] : ["dashboard", "live", "calendar", "events", "assignments", "clocking", "incidents", "finances", "reports"];
  if (pathname === "/api/clients" || pathname.startsWith("/api/clients/")) return write ? ["clients"] : ["clients", "events", "calendar", "assignments", "finances", "reports", "dashboard", "live"];
  if (pathname === "/api/employees" || pathname.startsWith("/api/employees/")) return write ? ["employees"] : ["employees", "events", "assignments", "clocking", "incidents", "documents", "availability", "finances", "reports", "dashboard", "live"];
  if (pathname === "/api/assignments" || pathname.startsWith("/api/assignments/") || pathname === "/api/planner/recommendations") return ["assignments"];
  if (pathname === "/api/time-entries" || pathname.startsWith("/api/time-entries/")) return ["clocking"];
  if (pathname === "/api/incidents/detect-attendance") return ["live", "incidents"];
  if (pathname === "/api/incidents" || pathname.startsWith("/api/incidents/")) return ["incidents"];
  if (pathname === "/api/availability" || pathname.startsWith("/api/availability/")) return ["availability"];
  if (pathname === "/api/documents" || pathname.startsWith("/api/documents/")) return ["documents"];
  if (pathname === "/api/allowances" || pathname.startsWith("/api/allowances/")) return ["finances"];
  if (pathname === "/api/finance/summary") return ["finances"];
  if (pathname.startsWith("/api/reports/") || pathname.startsWith("/api/delivery-notes/")) return ["reports"];
  if (pathname === "/api/backups" || pathname.startsWith("/api/backups/")) return ["backups"];
  return [];
}

function adminPermissionRequiresAll(pathname, method) {
  if (pathname === "/api/imports/templates/employees" || pathname === "/api/imports/employees") return true;
  if (pathname === "/api/imports/templates/clients" || pathname === "/api/imports/clients") return true;
  if (pathname === "/api/calendar/import-google-event" || pathname === "/api/calendar/import-google-events") return true;
  if (pathname === "/api/calendar/google-oauth/start") return true;
  return false;
}

function enforceAdminRoutePermission(user, pathname, method) {
  if (!user || user.role !== "admin") return;
  const allowed = adminPermissionsForRequest(pathname, method);
  const hasPermission = adminPermissionRequiresAll(pathname, method)
    ? userHasAllPermissions(user, allowed)
    : userHasAnyPermission(user, allowed);
  if (!allowed.length || hasPermission) return;
  const error = new Error("Modulo no permitido para este administrador");
  error.status = 403;
  throw error;
}

function publicUser(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    permissions: normalizeAdminPermissions(row.permissions_json, row.role),
    active: Boolean(row.active)
  };
}

function jsonField(value, fallback = []) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function parseEmployee(row) {
  return {
    ...row,
    skills: jsonField(row.skills)
  };
}

function employeePortalProfile(row) {
  const employee = parseEmployee(row);
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    phone: employee.phone,
    email: employee.email,
    city: employee.city,
    lat: employee.lat,
    lng: employee.lng,
    skills: employee.skills,
    photo_url: employee.photo_url,
    dni: employee.dni,
    shirt_size: employee.shirt_size,
    pants_size: employee.pants_size,
    shoe_size: employee.shoe_size,
    epi_size: employee.epi_size,
    status: employee.status
  };
}

function hoursBetween(start, end) {
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
}

function nightHoursBetween(start, end) {
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  let nightMinutes = 0;
  for (let minute = startMinutes; minute < endMinutes; minute += 15) {
    const dayMinute = minute % (24 * 60);
    if (dayMinute >= 22 * 60 || dayMinute < 6 * 60) {
      nightMinutes += Math.min(15, endMinutes - minute);
    }
  }
  return Math.round((nightMinutes / 60) * 100) / 100;
}

function googlePublicIcsUrl(calendarId = DEFAULT_GOOGLE_CALENDAR_ID) {
  const id = String(calendarId || "").trim();
  return id ? `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics` : "";
}

function ensureCalendarSettings() {
  const defaults = {
    google_calendar_id: DEFAULT_GOOGLE_CALENDAR_ID,
    google_calendar_api_key: "",
    google_calendar_public_ics_url: googlePublicIcsUrl(DEFAULT_GOOGLE_CALENDAR_ID),
    google_calendar_embed_url: DEFAULT_GOOGLE_CALENDAR_EMBED_URL,
    google_calendar_sync_enabled: "true",
    google_calendar_service_account_json: "",
    google_calendar_delegated_user: "",
    google_calendar_oauth_client_json: "",
    google_calendar_oauth_refresh_token: "",
    google_calendar_oauth_connected_at: "",
    backup_auto_enabled: "true",
    backup_auto_interval_hours: "24",
    backup_auto_retention_days: "30",
    backup_auto_retention_count: "30",
    clock_radius_m: String(DEFAULT_CLOCK_RADIUS_M),
    clock_entry_early_minutes: "90",
    clock_exit_late_minutes: "240",
    incident_absence_grace_minutes: "15",
    office_phone: "+34910000000",
    office_whatsapp: "34910000000"
  };
  for (const [key, value] of Object.entries(defaults)) {
    run("INSERT OR IGNORE INTO company_settings (key, value) VALUES (?, ?)", [key, value]);
  }
  const token = get("SELECT value FROM company_settings WHERE key = 'calendar_feed_token'");
  if (!token?.value) {
    run("INSERT OR REPLACE INTO company_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [
      "calendar_feed_token",
      randomToken()
    ]);
  }
}

function settingMap() {
  ensureCalendarSettings();
  return Object.fromEntries(all("SELECT key, value FROM company_settings").map((row) => [row.key, row.value]));
}

function settingsForAdmin() {
  const settings = settingMap();
  const serviceAccount = googleServiceAccountCredentials(settings);
  const oauthClient = googleOAuthClientCredentials(settings);
  const syncSummary = googleSyncSummary();
  const googleApiKeyConfigured = Boolean(String(settings.google_calendar_api_key || "").trim());
  const googleIcsUrlConfigured = Boolean(String(settings.google_calendar_public_ics_url || "").trim());
  return {
    ...settings,
    google_calendar_api_key: "",
    google_calendar_api_key_configured: googleApiKeyConfigured ? "true" : "false",
    google_calendar_public_ics_url: "",
    google_calendar_public_ics_url_configured: googleIcsUrlConfigured ? "true" : "false",
    google_calendar_service_account_json: "",
    google_calendar_service_account_email: serviceAccount?.client_email || "",
    google_calendar_service_account_configured: serviceAccount ? "true" : "false",
    google_calendar_oauth_client_json: "",
    google_calendar_oauth_refresh_token: "",
    google_calendar_oauth_client_id: oauthClient?.client_id || "",
    google_calendar_oauth_client_type: oauthClient?.client_type || "",
    google_calendar_oauth_redirect_uris: (oauthClient?.redirect_uris || []).join("\n"),
    google_calendar_oauth_client_configured: oauthClient ? "true" : "false",
    google_calendar_oauth_connected: settings.google_calendar_oauth_refresh_token ? "true" : "false",
    google_sync_total_count: syncSummary.total,
    google_sync_pending_count: syncSummary.pending,
    google_sync_error_count: syncSummary.error,
    google_sync_pending_auth_count: syncSummary.pending_auth,
    google_sync_synced_count: syncSummary.synced
  };
}

function sanitizeSettingsAudit(body) {
  const sanitized = { ...body };
  for (const key of [
    "google_calendar_api_key",
    "google_calendar_public_ics_url",
    "google_calendar_service_account_json",
    "google_calendar_oauth_client_json",
    "google_calendar_oauth_refresh_token"
  ]) {
    if (sanitized[key]) sanitized[key] = "[configurado]";
  }
  return sanitized;
}

function numberSetting(settings, key, fallback) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

function googleSyncSummary() {
  const summary = {
    total: 0,
    pending: 0,
    pending_auth: 0,
    error: 0,
    synced: 0,
    disabled: 0,
    imported: 0
  };
  const rows = all(
    `SELECT COALESCE(google_sync_status, 'pending') AS status, COUNT(*) AS count
     FROM events
     WHERE date >= ?
     GROUP BY COALESCE(google_sync_status, 'pending')`,
    [formatDate()]
  );
  for (const row of rows) {
    const status = row.status || "pending";
    summary[status] = Number(row.count || 0);
    summary.total += Number(row.count || 0);
  }
  return summary;
}

function backupAutomationSettings(settings = settingMap()) {
  return {
    enabled: String(settings.backup_auto_enabled ?? "true") !== "false",
    intervalHours: Math.min(Math.max(numberSetting(settings, "backup_auto_interval_hours", 24), 1), 24 * 14),
    retentionDays: Math.min(Math.max(numberSetting(settings, "backup_auto_retention_days", 30), 1), 365),
    retentionCount: Math.min(Math.max(Math.round(numberSetting(settings, "backup_auto_retention_count", 30)), 1), 500)
  };
}

function clockPolicy(settings = settingMap()) {
  return {
    radiusM: Math.min(Math.max(Math.round(numberSetting(settings, "clock_radius_m", DEFAULT_CLOCK_RADIUS_M)), 25), 5000),
    entryEarlyMinutes: Math.min(Math.max(Math.round(numberSetting(settings, "clock_entry_early_minutes", 90)), 0), 24 * 60),
    exitLateMinutes: Math.min(Math.max(Math.round(numberSetting(settings, "clock_exit_late_minutes", 240)), 0), 48 * 60)
  };
}

function incidentDetectionSettings(settings = settingMap()) {
  return {
    absenceGraceMinutes: Math.min(Math.max(Math.round(numberSetting(settings, "incident_absence_grace_minutes", 15)), 1), 240)
  };
}

function localDateTime(dateValue, timeValue) {
  const [year, month, day] = String(dateValue || formatDate()).split("-").map(Number);
  const [hour, minute] = String(timeValue || "00:00").split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
}

function eventClockRange(event) {
  const start = localDateTime(event.date, event.start_time);
  const end = localDateTime(event.date, event.end_time);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return { start, end };
}

function eventDateSpan(event) {
  return {
    startDate: event.date,
    endDate: toMinutes(event.end_time) <= toMinutes(event.start_time) ? addIsoDays(event.date, 1) : event.date
  };
}

function clockWindowState(event, type, policy = clockPolicy(), now = new Date()) {
  if (!event) return { allowed: false, reason: "Evento no encontrado" };
  if (event.status === "finalizado") return { allowed: false, reason: "Evento finalizado" };
  const { start, end } = eventClockRange(event);
  const openAt = new Date((type === "salida" ? start : start).getTime() - (type === "entrada" ? policy.entryEarlyMinutes : 0) * 60_000);
  const closeAt = new Date(end.getTime() + policy.exitLateMinutes * 60_000);
  if (now.getTime() < openAt.getTime()) {
    return {
      allowed: false,
      reason: type === "entrada" ? "Fichaje de entrada aun no disponible" : "Fichaje de salida aun no disponible",
      openAt,
      closeAt
    };
  }
  if (now.getTime() > closeAt.getTime()) {
    return {
      allowed: false,
      reason: type === "entrada" ? "Ventana de entrada cerrada" : "Ventana de salida cerrada",
      openAt,
      closeAt
    };
  }
  return { allowed: true, reason: "", openAt, closeAt };
}

function attendanceIncidentPayload(row, type, graceMinutes) {
  const critical = type === "ausencia";
  return {
    type,
    priority: critical ? "critica" : "alta",
    title: critical ? "Ausencia detectada" : "Retraso detectado",
    description: critical
      ? `${row.employee_name} no tiene fichaje de entrada aceptado en ${row.event_name}. Servicio finalizado sin entrada registrada.`
      : `${row.employee_name} no tiene fichaje de entrada aceptado en ${row.event_name} tras ${graceMinutes} minutos de margen.`
  };
}

function detectAttendanceIncidents({ date = formatDate(), actor = null, now = new Date() } = {}) {
  const settings = incidentDetectionSettings();
  const rows = all(
    `SELECT assignments.id AS assignment_id,
            assignments.employee_id,
            assignments.role AS assignment_role,
            events.id AS event_id,
            events.name AS event_name,
            events.date,
            events.start_time,
            events.end_time,
            events.status AS event_status,
            employees.name AS employee_name
     FROM assignments
     JOIN events ON events.id = assignments.event_id
     JOIN employees ON employees.id = assignments.employee_id
     WHERE assignments.status != 'bloqueado'
       AND events.date = ?
     ORDER BY events.start_time ASC, employees.name ASC`,
    [date]
  );
  const summary = { date, checked: rows.length, created: 0, updated: 0, skipped: 0, incidents: [] };
  for (const row of rows) {
    const event = {
      id: row.event_id,
      date: row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.event_status
    };
    const { start, end } = eventClockRange(event);
    const dueAt = new Date(start.getTime() + settings.absenceGraceMinutes * 60_000);
    if (now.getTime() < dueAt.getTime()) {
      summary.skipped += 1;
      continue;
    }
    const acceptedIn = get(
      `SELECT id FROM time_entries
       WHERE event_id = ? AND employee_id = ? AND accepted = 1 AND type = 'entrada'
       LIMIT 1`,
      [row.event_id, row.employee_id]
    );
    if (acceptedIn) {
      summary.skipped += 1;
      continue;
    }
    const type = now.getTime() > end.getTime() || event.status === "finalizado" ? "ausencia" : "retraso";
    const payload = attendanceIncidentPayload(row, type, settings.absenceGraceMinutes);
    const existing = get(
      `SELECT * FROM incidents
       WHERE event_id = ? AND employee_id = ? AND status != 'resuelta' AND type IN ('ausencia', 'retraso')
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.event_id, row.employee_id]
    );
    if (existing) {
      if (type === "ausencia" && existing.type !== "ausencia") {
        run(
          `UPDATE incidents
           SET type = ?, priority = ?, title = ?, description = ?
           WHERE id = ?`,
          [payload.type, payload.priority, payload.title, payload.description, existing.id]
        );
        audit(actor, "incident_auto_upgraded", "incident", existing.id, {
          eventId: row.event_id,
          employeeId: row.employee_id,
          from: existing.type,
          to: type
        });
        createEventSnapshot(row.event_id, "incident_auto_upgraded", actor, {
          incidentId: existing.id,
          employeeId: row.employee_id,
          from: existing.type,
          to: type
        });
        summary.updated += 1;
        summary.incidents.push({ id: existing.id, eventId: row.event_id, employeeId: row.employee_id, type, action: "updated" });
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    const id = randomId("inc");
    run(
      `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, row.event_id, row.employee_id, payload.type, payload.priority, payload.title, payload.description]
    );
    audit(actor, "incident_auto_detected", "incident", id, {
      eventId: row.event_id,
      employeeId: row.employee_id,
      type
    });
    createEventSnapshot(row.event_id, "incident_auto_detected", actor, {
      incidentId: id,
      employeeId: row.employee_id,
      type
    });
    summary.created += 1;
    summary.incidents.push({ id, eventId: row.event_id, employeeId: row.employee_id, type, action: "created" });
  }
  return summary;
}

function autoDetectAttendanceIncidents({ date = formatDate(), actor = null, now = new Date() } = {}) {
  const targetDate = String(date || formatDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate > formatDate()) {
    return {
      date: targetDate,
      checked: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      incidents: [],
      automatic: true,
      skippedReason: "future_date"
    };
  }
  return {
    ...detectAttendanceIncidents({ date: targetDate, actor, now }),
    automatic: true
  };
}

function latestAutoBackup() {
  return get("SELECT * FROM backups WHERE type = 'auto' ORDER BY created_at DESC LIMIT 1");
}

function nextAutoBackupAt(settings = settingMap()) {
  const config = backupAutomationSettings(settings);
  if (!config.enabled) return "";
  const latest = latestAutoBackup();
  if (!latest) return new Date().toISOString();
  const latestTime = new Date(latest.created_at).getTime();
  if (!Number.isFinite(latestTime)) return new Date().toISOString();
  return new Date(latestTime + config.intervalHours * 60 * 60 * 1000).toISOString();
}

function pruneAutomaticBackups(settings = settingMap()) {
  const config = backupAutomationSettings(settings);
  const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const byAge = all("SELECT * FROM backups WHERE type = 'auto' AND created_at < ? ORDER BY created_at ASC", [cutoff]);
  const allAuto = all("SELECT * FROM backups WHERE type = 'auto' ORDER BY created_at DESC");
  const keep = new Set(allAuto.slice(0, config.retentionCount).map((backup) => backup.id));
  const byCount = allAuto.filter((backup) => !keep.has(backup.id));
  const candidates = new Map([...byAge, ...byCount].map((backup) => [backup.id, backup]));
  const removed = [];
  for (const backup of candidates.values()) {
    const resolved = safeBackupPath(backup.file_path);
    if (resolved && fs.existsSync(resolved)) fs.rmSync(resolved, { force: true });
    run("DELETE FROM backups WHERE id = ?", [backup.id]);
    removed.push(backup.id);
  }
  if (removed.length) {
    audit(null, "backup_pruned", "backup", "auto", {
      removed: removed.length,
      retentionDays: config.retentionDays,
      retentionCount: config.retentionCount
    });
  }
  return removed.length;
}

function backupRestorePending() {
  const markerPath = path.join(DATA_DIR, "restore-request.json");
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return { invalid: true };
  }
}

function backupOverview() {
  const settings = settingMap();
  const backups = all("SELECT * FROM backups ORDER BY created_at DESC").map(backupStatus);
  const latest = latestAutoBackup();
  return {
    backups,
    automation: {
      ...backupAutomationSettings(settings),
      latestAutoAt: latest?.created_at || "",
      nextAutoAt: nextAutoBackupAt(settings),
      lastRunAt: backupAutomationState.lastRunAt,
      lastResult: backupAutomationState.lastResult,
      running: backupAutomationState.running,
      restorePending: backupRestorePending()
    }
  };
}

function automaticBackupDue(settings = settingMap()) {
  const config = backupAutomationSettings(settings);
  if (!config.enabled) return false;
  const next = nextAutoBackupAt(settings);
  return Boolean(next && new Date(next).getTime() <= Date.now());
}

function runAutomaticBackup(reason = "scheduled") {
  if (backupAutomationState.running) return { skipped: true, reason: "running" };
  const settings = settingMap();
  const config = backupAutomationSettings(settings);
  if (!config.enabled) return { skipped: true, reason: "disabled" };
  backupAutomationState.running = true;
  try {
    const backup = createBackup("auto", reason === "manual" ? "Backup automatico manual" : "Backup automatico programado");
    const pruned = pruneAutomaticBackups(settings);
    backupAutomationState.lastRunAt = new Date().toISOString();
    backupAutomationState.lastResult = { backupId: backup.id, pruned, reason };
    backupAutomationState.nextRunAt = nextAutoBackupAt(settings);
    audit(null, "backup_auto_created", "backup", backup.id, {
      reason,
      sizeBytes: backup.size_bytes,
      pruned
    });
    return { backup, pruned };
  } finally {
    backupAutomationState.running = false;
  }
}

function runAutomaticBackupIfDue() {
  try {
    if (!automaticBackupDue()) {
      backupAutomationState.nextRunAt = nextAutoBackupAt();
      return null;
    }
    return runAutomaticBackup("scheduled");
  } catch (error) {
    backupAutomationState.lastRunAt = new Date().toISOString();
    backupAutomationState.lastResult = { error: error.message };
    console.error("Backup automatico fallido", error);
    return null;
  }
}

function listWorkRoles() {
  return all("SELECT * FROM work_roles ORDER BY active DESC, name ASC");
}

function listAvailability() {
  return all(
    `SELECT availability.*,
            employees.name AS employee_name,
            employees.role AS employee_role,
            employees.phone AS employee_phone,
            employees.email AS employee_email,
            (SELECT COUNT(*)
             FROM events
             WHERE events.date >= availability.start_date
               AND events.date <= availability.end_date
               AND events.status != 'finalizado') AS affected_events
     FROM availability
     JOIN employees ON employees.id = availability.employee_id
     ORDER BY CASE availability.status
       WHEN 'solicitado' THEN 1
       WHEN 'aprobado' THEN 2
       WHEN 'rechazado' THEN 3
       ELSE 4
     END, availability.start_date ASC, availability.created_at DESC`
  );
}

function rolePriceMap() {
  return new Map(listWorkRoles().map((role) => [String(role.name).toLowerCase(), role]));
}

function cleanAvailabilityType(type) {
  return ["vacaciones", "no_disponible", "enfermedad", "otro"].includes(type) ? type : "no_disponible";
}

function cleanAvailabilityStatus(status, fallback = "solicitado") {
  return ["solicitado", "aprobado", "rechazado"].includes(status) ? status : fallback;
}

function cleanAssignmentStatus(status, fallback = "confirmado") {
  return ["confirmado", "pendiente", "bloqueado"].includes(status) ? status : fallback;
}

function cleanContactEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

function cleanContactPhone(value) {
  const phone = String(value ?? "").trim();
  return phone || null;
}

function passwordPolicyMessage(password) {
  const value = String(password || "");
  if (value.length < 8) return "La contrasena debe tener al menos 8 caracteres";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return "La contrasena debe incluir letras y numeros";
  }
  return "";
}

function validateNewPassword(password) {
  const message = passwordPolicyMessage(password);
  if (message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return String(password);
}

function validateEmployeePortalPassword(password) {
  const value = String(password || "");
  if (/^\d{9,}$/.test(value)) return value;
  return validateNewPassword(value);
}

function employeePhonePassword(phone) {
  const key = phoneLoginKey(phone);
  if (!key) {
    const error = new Error("Telefono obligatorio para usarlo como usuario y contrasena del portal");
    error.status = 400;
    throw error;
  }
  return key;
}

function employeePortalPasswordForCreate(body, phone) {
  const password = String(body.portalPassword || "").trim();
  if (body.portalPasswordMode === "manual") {
    if (!password) {
      const error = new Error("Contrasena manual obligatoria");
      error.status = 400;
      throw error;
    }
    return { password: validateEmployeePortalPassword(password), mode: "manual" };
  }
  if (password) {
    return { password: validateEmployeePortalPassword(password), mode: "manual" };
  }
  if (!phoneLoginKey(phone)) {
    const error = new Error("Telefono obligatorio para usarlo como contrasena por defecto");
    error.status = 400;
    throw error;
  }
  return { password: employeePhonePassword(phone), mode: "phone" };
}

function employeePortalPasswordForUpdate(body, phone) {
  if (body.portalPasswordMode === "phone") {
    return { password: employeePhonePassword(phone), mode: "phone" };
  }
  const password = String(body.portalPassword || "").trim();
  if (!password) return null;
  return { password: validateEmployeePortalPassword(password), mode: "manual" };
}

function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function phoneLoginKey(value) {
  const digits = phoneDigits(value);
  if (digits.length < 9) return "";
  const withoutInternationalPrefix = digits.startsWith("0034")
    ? digits.slice(4)
    : digits.startsWith("34") && digits.length > 9
      ? digits.slice(2)
      : digits;
  return withoutInternationalPrefix.length >= 9 ? withoutInternationalPrefix.slice(-9) : "";
}

function phonesMatchForLogin(storedPhone, identifier) {
  const storedKey = phoneLoginKey(storedPhone);
  const identifierKey = phoneLoginKey(identifier);
  return Boolean(storedKey && identifierKey && storedKey === identifierKey);
}

function findActiveLoginAccount(identifier) {
  const rawIdentifier = String(identifier || "").trim();
  const emailIdentifier = rawIdentifier.toLowerCase();
  const accountByEmail = emailIdentifier
    ? get("SELECT * FROM users WHERE active = 1 AND lower(email) = ? LIMIT 1", [emailIdentifier])
    : null;
  if (accountByEmail) return accountByEmail;

  if (!phoneLoginKey(rawIdentifier)) return null;
  const matches = all("SELECT * FROM users WHERE active = 1 AND phone IS NOT NULL AND trim(phone) != ''")
    .filter((account) => phonesMatchForLogin(account.phone, rawIdentifier));
  if (matches.length > 1) {
    const error = new Error("Hay varios usuarios con ese telefono. Usa el email o avisa a oficina.");
    error.status = 409;
    throw error;
  }
  return matches[0] || null;
}

function findDuplicateUserContact({ email, phone, excludeUserId = "" }) {
  const cleanEmail = cleanContactEmail(email);
  if (cleanEmail) {
    const duplicateByEmail = get(
      `SELECT users.*, employees.id AS employee_id
       FROM users
       LEFT JOIN employees ON employees.user_id = users.id
       WHERE lower(users.email) = ? AND users.id != ?
       LIMIT 1`,
      [cleanEmail, excludeUserId]
    );
    if (duplicateByEmail) return duplicateByEmail;
  }
  const phoneKey = phoneLoginKey(phone);
  if (!phoneKey) return null;
  return all(
    `SELECT users.*, employees.id AS employee_id
     FROM users
     LEFT JOIN employees ON employees.user_id = users.id
     WHERE users.id != ? AND users.phone IS NOT NULL AND trim(users.phone) != ''`,
    [excludeUserId]
  ).find((account) => phonesMatchForLogin(account.phone, phone)) || null;
}

function findDuplicateEmployeeContact({ email, phone, excludeEmployeeId = "" }) {
  const cleanEmail = cleanContactEmail(email);
  if (cleanEmail) {
    const duplicateByEmail = get(
      "SELECT * FROM employees WHERE lower(email) = ? AND id != ? LIMIT 1",
      [cleanEmail, excludeEmployeeId]
    );
    if (duplicateByEmail) return duplicateByEmail;
  }
  const phoneKey = phoneLoginKey(phone);
  if (!phoneKey) return null;
  return all(
    "SELECT * FROM employees WHERE id != ? AND phone IS NOT NULL AND trim(phone) != ''",
    [excludeEmployeeId]
  ).find((employee) => phonesMatchForLogin(employee.phone, phone)) || null;
}

function validateUserContact({ userId = "", employeeId = "", email, phone }) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Email no valido");
    error.status = 400;
    throw error;
  }
  if (findDuplicateUserContact({ email, phone, excludeUserId: userId })) {
    const error = new Error("Ese email o telefono ya pertenece a otro usuario");
    error.status = 409;
    throw error;
  }
  if (findDuplicateEmployeeContact({ email, phone, excludeEmployeeId: employeeId })) {
    const error = new Error("Ese email o telefono ya pertenece a otro operario");
    error.status = 409;
    throw error;
  }
}

function validateEmployeeProfileContact({ employeeId, userId, email, phone }) {
  if (!email && !phone) {
    const error = new Error("Email o telefono obligatorio para mantener el acceso");
    error.status = 400;
    throw error;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Email no valido");
    error.status = 400;
    throw error;
  }
  const duplicateUserByEmail = email
    ? get("SELECT id FROM users WHERE lower(email) = ? AND id != ? LIMIT 1", [email, userId])
    : null;
  const duplicateUserByPhone = findDuplicateUserContact({ phone, excludeUserId: userId });
  if (duplicateUserByEmail || duplicateUserByPhone) {
    const error = new Error("Ese email o telefono ya pertenece a otro usuario");
    error.status = 409;
    throw error;
  }
  const duplicateEmployeeByEmail = email
    ? get("SELECT id FROM employees WHERE lower(email) = ? AND id != ? LIMIT 1", [email, employeeId])
    : null;
  const duplicateEmployeeByPhone = findDuplicateEmployeeContact({ phone, excludeEmployeeId: employeeId });
  if (duplicateEmployeeByEmail || duplicateEmployeeByPhone) {
    const error = new Error("Ese email o telefono ya pertenece a otro operario");
    error.status = 409;
    throw error;
  }
}

function validateAdminEmployeeContact({ employeeId = "", userId = "", email, phone, requireContact = false }) {
  if (requireContact && !email && !phone) {
    const error = new Error("Email o telefono obligatorio para crear acceso al portal");
    error.status = 400;
    throw error;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Email no valido");
    error.status = 400;
    throw error;
  }
  if (findDuplicateEmployeeContact({ email, phone, excludeEmployeeId: employeeId })) {
    const error = new Error("Ese email o telefono ya pertenece a otro operario");
    error.status = 409;
    throw error;
  }
  const duplicateUser = findDuplicateUserContact({ email, phone, excludeUserId: userId });
  if (duplicateUser && (duplicateUser.role !== "employee" || duplicateUser.employee_id)) {
    const error = new Error("Ese email o telefono ya pertenece a otro usuario");
    error.status = 409;
    throw error;
  }
}

function cleanIncidentType(type) {
  return ["ausencia", "retraso", "accidente", "cliente", "horas extra", "documentacion", "otro"].includes(type) ? type : "otro";
}

function employeeIncidentPriority(type) {
  if (type === "accidente") return "critica";
  if (["ausencia", "retraso"].includes(type)) return "alta";
  return "media";
}

function isTeamLeaderRole(role) {
  return String(role || "").toLowerCase().includes("jefe");
}

function employeeRoleFromBody(body, fallback = "Montaje") {
  return body.teamLeader === true || body.teamLeader === "on" || body.teamLeader === "true"
    ? "Jefe de equipo"
    : body.role || fallback;
}

function employeeSkillsFromBody(body, fallback = []) {
  const skills = Array.isArray(body.skills) ? body.skills : fallback;
  if (!isTeamLeaderRole(employeeRoleFromBody(body, ""))) return skills;
  return Array.from(new Set([...skills, "jefe"]));
}

function importClean(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "nan") return "";
  if (/^\d+\.0$/.test(text)) return text.slice(0, -2);
  return text;
}

function importHeaderKey(value) {
  return importClean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function detectCsvDelimiter(line) {
  const delimiters = [";", ",", "\t"];
  const counts = delimiters.map((delimiter) => ({
    delimiter,
    count: String(line || "").split(delimiter).length - 1
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter || ";";
}

function parseDelimitedRows(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/).find((line) => line.trim()) || "";
  const delimiter = detectCsvDelimiter(firstLine);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => importClean(item))) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((item) => importClean(item))) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(importHeaderKey);
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = importClean(cells[index]);
    });
    return item;
  });
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function xmlAttr(source, name) {
  const pattern = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}=(?:"([^"]*)"|'([^']*)')`);
  const match = String(source || "").match(pattern);
  return match ? xmlDecode(match[1] ?? match[2] ?? "") : "";
}

function columnIndexFromRef(ref, fallback) {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0] || "";
  if (!letters) return fallback;
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index - 1;
}

function findZipEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const start = Math.max(0, buffer.length - 65_558);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function unzipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    const error = new Error("Excel no valido");
    error.status = 400;
    throw error;
  }
  const eocd = findZipEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    const error = new Error("Excel no valido");
    error.status = 400;
    throw error;
  }
  const entries = new Map();
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/^\/+/, "");
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else {
      const error = new Error("Excel comprimido no soportado");
      error.status = 400;
      throw error;
    }
    entries.set(name, data);
  }
  return entries;
}

function xlsxSharedStrings(xml) {
  const strings = [];
  for (const match of String(xml || "").matchAll(/<si\b[\s\S]*?<\/si>/gi)) {
    const text = Array.from(match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
      .map((item) => xmlDecode(item[1]))
      .join("");
    strings.push(text);
  }
  return strings;
}

function xlsxDateStyles(xml) {
  const dateNumFmtIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  for (const match of String(xml || "").matchAll(/<numFmt\b([^>]*)\/?>/gi)) {
    const id = Number(xmlAttr(match[1], "numFmtId"));
    const format = xmlAttr(match[1], "formatCode").toLowerCase();
    if (Number.isFinite(id) && /[dmyhs]/.test(format) && !/[#0?]/.test(format.replace(/[dmyhs:/\-\s]/g, ""))) {
      dateNumFmtIds.add(id);
    }
  }
  const cellXfs = String(xml || "").match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] || "";
  const styles = new Set();
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)\/?>/gi)) {
    const id = Number(xmlAttr(match[1], "numFmtId"));
    if (dateNumFmtIds.has(id)) styles.add(index);
    index += 1;
  }
  return styles;
}

function excelSerialDateToIso(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return String(value || "");
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function xlsxWorkbookSheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") || "";
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const firstSheet = workbook.match(/<sheet\b[^>]*>/i)?.[0] || "";
  const relationId = xmlAttr(firstSheet, "r:id") || xmlAttr(firstSheet, "id");
  const relation = Array.from(rels.matchAll(/<Relationship\b([^>]*)\/?>/gi))
    .map((match) => ({ id: xmlAttr(match[1], "Id"), target: xmlAttr(match[1], "Target") }))
    .find((item) => item.id === relationId);
  if (!relation?.target) return "xl/worksheets/sheet1.xml";
  if (relation.target.startsWith("/")) return relation.target.replace(/^\/+/, "");
  return path.posix.normalize(`xl/${relation.target}`).replace(/^\/+/, "");
}

function xlsxCellValue(cellXml, attrs, sharedStrings, dateStyles) {
  const type = xmlAttr(attrs, "t");
  const style = Number(xmlAttr(attrs, "s"));
  if (type === "inlineStr") {
    return Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
      .map((item) => xmlDecode(item[1]))
      .join("");
  }
  const raw = xmlDecode(cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || "");
  if (type === "s") return sharedStrings[Number(raw)] || "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (dateStyles.has(style)) return excelSerialDateToIso(raw);
  return raw;
}

function parseXlsxRows(buffer) {
  const entries = unzipEntries(buffer);
  const sheetPath = xlsxWorkbookSheetPath(entries);
  const sheetXml = entries.get(sheetPath)?.toString("utf8");
  if (!sheetXml) {
    const error = new Error("Excel sin hoja de datos");
    error.status = 400;
    throw error;
  }
  const sharedStrings = xlsxSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const dateStyles = xlsxDateStyles(entries.get("xl/styles.xml")?.toString("utf8") || "");
  const tableRows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = [];
    let fallbackColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1];
      const column = columnIndexFromRef(xmlAttr(attrs, "r"), fallbackColumn);
      cells[column] = importClean(xlsxCellValue(cellMatch[2], attrs, sharedStrings, dateStyles));
      fallbackColumn = column + 1;
    }
    if (cells.some((cell) => importClean(cell))) tableRows.push(cells);
  }
  const headerIndex = tableRows.findIndex((row) => row.filter((cell) => importClean(cell)).length >= 2);
  if (headerIndex < 0) return [];
  const headers = tableRows[headerIndex].map(importHeaderKey);
  return tableRows.slice(headerIndex + 1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = importClean(cells[index]);
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => importClean(value)));
}

function importFileBuffer(body) {
  const raw = String(body.fileDataBase64 || body.fileBase64 || "");
  if (!raw) return null;
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const compact = base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    const error = new Error("Archivo no valido");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length || buffer.length > MAX_IMPORT_FILE_BYTES) {
    const error = new Error("Archivo demasiado grande");
    error.status = 413;
    throw error;
  }
  return buffer;
}

function importRowsFromUpload(body) {
  const sourceName = importClean(body.fileName || "");
  const extension = path.extname(sourceName).toLowerCase();
  const mime = String(body.fileMime || "").toLowerCase();
  const isXlsx = extension === ".xlsx" || mime === XLSX_MIME_TYPE;
  if (isXlsx) return parseXlsxRows(importFileBuffer(body));
  if (!String(body.fileText || "").trim()) {
    const error = new Error("Archivo CSV, TSV o Excel obligatorio");
    error.status = 400;
    throw error;
  }
  return parseDelimitedRows(body.fileText);
}

function importValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[importHeaderKey(alias)];
    if (importClean(value)) return importClean(value);
  }
  return "";
}

function importOptionalNumber(row, aliases) {
  const value = importValue(row, aliases);
  if (!value) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function splitImportSkills(value, fallback = []) {
  const raw = importClean(value);
  if (!raw) return fallback;
  return raw.split(/[,;|]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

const EMPLOYEE_IMPORT_HEADERS = [
  "NOMBRE",
  "APELLIDOS",
  "TELEFONO",
  "CORREO ELECTRONICO",
  "D.N.I.",
  "NºSEG.SOCIAL",
  "Nº DE CUENTA BANCARIA",
  "ROL",
  "SKILLS",
  "DIRECCION",
  "PROVINCIA",
  "CP",
  "CIUDAD",
  "CAMISETA",
  "PANTALON",
  "CALZADO",
  "CHAQUETA",
  "EPI",
  "CONTACTO EMERGENCIA",
  "TARIFA HORA",
  "KM",
  "DIETA"
];

const CLIENT_IMPORT_HEADERS = [
  "CLIENTE",
  "RAZON SOCIAL",
  "CIF",
  "PERSONA CONTACTO",
  "MAIL",
  "TELEFONO",
  "DIRECCION",
  "PROVINCIA",
  "OBSERVACIONES"
];

function importTemplateCsv(headers) {
  return `${headers.join(";")}\n`;
}

function findImportedUser(email, phone) {
  const cleanEmail = importClean(email).toLowerCase();
  const cleanPhone = importClean(phone);
  if (cleanEmail) {
    const user = get("SELECT * FROM users WHERE lower(email) = ? LIMIT 1", [cleanEmail]);
    if (user) return user;
  }
  if (cleanPhone) {
    const user = findDuplicateUserContact({ phone: cleanPhone });
    if (user) return get("SELECT * FROM users WHERE id = ?", [user.id]);
  }
  return null;
}

function ensureEmployeePortalUser({ name, email, phone, defaultPassword }) {
  const cleanEmail = importClean(email).toLowerCase();
  const cleanPhone = importClean(phone);
  if (!cleanEmail && !cleanPhone) return { userId: null, created: false };
  const user = findImportedUser(cleanEmail, cleanPhone);
  if (user) {
    if (user.role !== "employee") {
      const error = new Error("El email o telefono ya pertenece a un usuario administrador");
      error.status = 409;
      throw error;
    }
    run(
      `UPDATE users
       SET role = 'employee', name = ?, email = COALESCE(NULLIF(?, ''), email),
           phone = COALESCE(NULLIF(?, ''), phone), active = 1
       WHERE id = ?`,
      [name, cleanEmail, cleanPhone, user.id]
    );
    return { userId: user.id, created: false };
  }
  const credentials = hashPassword(validateEmployeePortalPassword(defaultPassword || "Marfan2026!"));
  const userId = randomId("usr");
  run(
    `INSERT INTO users (id, role, name, email, phone, password_hash, salt, active)
     VALUES (?, 'employee', ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, 1)`,
    [userId, name, cleanEmail, cleanPhone, credentials.hash, credentials.salt]
  );
  return { userId, created: true };
}

function ensureImportedEmployeeUser({ name, email, phone, defaultPassword }) {
  return ensureEmployeePortalUser({ name, email, phone, defaultPassword });
}

function findImportedEmployee({ dni, email, phone }) {
  const cleanDni = importClean(dni);
  const cleanEmail = importClean(email).toLowerCase();
  const cleanPhone = importClean(phone);
  if (cleanDni) {
    const employee = get("SELECT * FROM employees WHERE dni = ? LIMIT 1", [cleanDni]);
    if (employee) return employee;
  }
  if (cleanEmail) {
    const employee = get("SELECT * FROM employees WHERE lower(email) = ? LIMIT 1", [cleanEmail]);
    if (employee) return employee;
  }
  if (cleanPhone) {
    const employee = findDuplicateEmployeeContact({ phone: cleanPhone });
    if (employee) return employee;
  }
  return null;
}

function findImportedClient({ taxId, name }) {
  const cleanTaxId = importClean(taxId);
  const cleanName = importClean(name);
  if (cleanTaxId) {
    const client = get("SELECT * FROM clients WHERE tax_id = ? LIMIT 1", [cleanTaxId]);
    if (client) return client;
  }
  if (cleanName) {
    const client = get("SELECT * FROM clients WHERE lower(name) = ? LIMIT 1", [cleanName.toLowerCase()]);
    if (client) return client;
  }
  return null;
}

function recordDataImport({ source, rowsRead, inserted, updated, skipped, metadata }) {
  const id = randomId("imp");
  run(
    `INSERT INTO data_imports (id, source, rows_read, inserted, updated, skipped, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, source, rowsRead, inserted, updated, skipped, JSON.stringify(metadata || {})]
  );
  return get("SELECT * FROM data_imports WHERE id = ?", [id]);
}

function importEmployeesCsv({ text, source, fileMime, fileDataBase64, defaultPassword, actor }) {
  const sourceName = importClean(source) || "operarios.csv";
  const rows = importRowsFromUpload({ fileText: text, fileName: sourceName, fileMime, fileDataBase64 }).slice(0, 5000);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let usersCreated = 0;
  const now = new Date().toISOString();
  transaction(() => {
    for (const row of rows) {
      const firstName = importValue(row, ["NOMBRE", "nombre"]);
      const lastName = importValue(row, ["APELLIDOS", "apellido", "apellidos"]);
      const fullName = importValue(row, ["NOMBRE COMPLETO", "OPERARIO", "EMPLEADO", "name"]);
      const name = importClean(fullName || [firstName, lastName].filter(Boolean).join(" "));
      if (!name) {
        skipped += 1;
        continue;
      }
      const phone = importValue(row, ["TELEFONO", "TELÉFONO", "MOVIL", "MÓVIL", "phone"]);
      const email = importValue(row, ["CORREO ELECTRONICO", "CORREO ELECTRÓNICO", "EMAIL", "MAIL"]).toLowerCase();
      const dni = importValue(row, ["D.N.I.", "DNI", "NIF"]);
      const existing = findImportedEmployee({ dni, email, phone });
      const roleInput = importValue(row, ["ROL", "PUESTO", "ROLE"]);
      const role = roleInput || existing?.role || "Operario";
      const skillsInput = importValue(row, ["SKILLS", "HABILIDADES", "APTITUDES"]);
      const skills = skillsInput
        ? splitImportSkills(skillsInput, [])
        : existing
          ? jsonField(existing.skills, [role.toLowerCase()])
          : [role.toLowerCase()];
      const { userId, created } = ensureImportedEmployeeUser({ name, email, phone, defaultPassword });
      if (created) usersCreated += 1;
      const values = {
        phone,
        email,
        dni,
        socialSecurityNumber: importValue(row, ["NºSEG.SOCIAL", "NSS", "SEGURIDAD SOCIAL", "NUMERO SEGURIDAD SOCIAL"]),
        bankAccount: importValue(row, ["Nº DE CUENTA BANCARIA", "CUENTA BANCARIA", "IBAN"]),
        address: importValue(row, ["DIRECCION", "DIRECCIÓN", "ADDRESS"]),
        province: importValue(row, ["PROVINCIA", "PROVINCE"]),
        postalCode: importValue(row, ["CP", "CODIGO POSTAL", "CÓDIGO POSTAL"]),
        birthDate: importValue(row, ["FECHA NACIMIENTO", "NACIMIENTO"]),
        shirtSize: importValue(row, ["CAMISETA", "TALLA CAMISETA", "SHIRT"]),
        pantsSize: importValue(row, ["PANTALON", "PANTALÓN", "TALLA PANTALON", "TALLA PANTALÓN"]),
        shoeSize: importValue(row, ["CALZADO", "ZAPATO", "TALLA ZAPATO"]),
        jacketSize: importValue(row, ["CHAQUETA", "TALLA CHAQUETA"]),
        epiSize: importValue(row, ["EPI", "TALLA EPI"]),
        emergencyContact: importValue(row, ["CONTACTO EMERGENCIA", "EMERGENCIA"]),
        city: importValue(row, ["CIUDAD", "LOCALIDAD"]),
        hourlyRate: importOptionalNumber(row, ["TARIFA HORA", "PRECIO HORA", "HORA"]),
        kmRate: importOptionalNumber(row, ["KM", "PRECIO KM"]),
        dietRate: importOptionalNumber(row, ["DIETA", "DIETAS"])
      };
      if (existing) {
        run(
          `UPDATE employees
           SET user_id = COALESCE(user_id, ?), name = ?, role = COALESCE(NULLIF(?, ''), role),
               phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email),
               city = COALESCE(NULLIF(?, ''), city), hourly_rate = COALESCE(?, hourly_rate),
               km_rate = COALESCE(?, km_rate), diet_rate = COALESCE(?, diet_rate),
               skills = ?, dni = COALESCE(NULLIF(?, ''), dni),
               social_security_number = COALESCE(NULLIF(?, ''), social_security_number),
               bank_account = COALESCE(NULLIF(?, ''), bank_account),
               address = COALESCE(NULLIF(?, ''), address), province = COALESCE(NULLIF(?, ''), province),
               postal_code = COALESCE(NULLIF(?, ''), postal_code), birth_date = COALESCE(NULLIF(?, ''), birth_date),
               shirt_size = COALESCE(NULLIF(?, ''), shirt_size), pants_size = COALESCE(NULLIF(?, ''), pants_size),
               shoe_size = COALESCE(NULLIF(?, ''), shoe_size), jacket_size = COALESCE(NULLIF(?, ''), jacket_size),
               epi_size = COALESCE(NULLIF(?, ''), epi_size), emergency_contact = COALESCE(NULLIF(?, ''), emergency_contact),
               status = 'activo', source_ref = ?, imported_at = ?
           WHERE id = ?`,
          [
            userId,
            name,
            role,
            phone,
            email,
            values.city,
            values.hourlyRate,
            values.kmRate,
            values.dietRate,
            JSON.stringify(employeeSkillsFromBody({ role }, skills)),
            dni,
            values.socialSecurityNumber,
            values.bankAccount,
            values.address,
            values.province,
            values.postalCode,
            values.birthDate,
            values.shirtSize,
            values.pantsSize,
            values.shoeSize,
            values.jacketSize,
            values.epiSize,
            values.emergencyContact,
            sourceName,
            now,
            existing.id
          ]
        );
        updated += 1;
      } else {
        run(
          `INSERT INTO employees
            (id, user_id, name, role, phone, email, status, city, hourly_rate, km_rate, diet_rate, skills,
             dni, social_security_number, bank_account, address, province, postal_code, birth_date,
             shirt_size, pants_size, shoe_size, jacket_size, epi_size, emergency_contact, source_ref, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId("emp"),
            userId,
            name,
            role,
            phone,
            email,
            values.city,
            values.hourlyRate ?? 0,
            values.kmRate ?? 0.24,
            values.dietRate ?? 0,
            JSON.stringify(employeeSkillsFromBody({ role }, skills)),
            dni,
            values.socialSecurityNumber,
            values.bankAccount,
            values.address,
            values.province,
            values.postalCode,
            values.birthDate,
            values.shirtSize,
            values.pantsSize,
            values.shoeSize,
            values.jacketSize,
            values.epiSize,
            values.emergencyContact,
            sourceName,
            now
          ]
        );
        inserted += 1;
      }
    }
  });
  const importRow = recordDataImport({
    source: sourceName,
    rowsRead: rows.length,
    inserted,
    updated,
    skipped,
    metadata: { kind: "employees", usersCreated }
  });
  audit(actor, "data_import_completed", "data_import", importRow.id, { kind: "employees", inserted, updated, skipped, usersCreated });
  return { import: importRow, rowsRead: rows.length, inserted, updated, skipped, usersCreated };
}

function importClientsCsv({ text, source, fileMime, fileDataBase64, actor }) {
  const sourceName = importClean(source) || "clientes.csv";
  const rows = importRowsFromUpload({ fileText: text, fileName: sourceName, fileMime, fileDataBase64 }).slice(0, 5000);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  transaction(() => {
    for (const row of rows) {
      const name = importValue(row, ["CLIENTE", "NOMBRE", "RAZON SOCIAL", "RAZÓN SOCIAL"]);
      if (!name) {
        skipped += 1;
        continue;
      }
      const legalName = importValue(row, ["RAZON SOCIAL", "RAZÓN SOCIAL"]);
      const taxId = importValue(row, ["CIF", "NIF", "TAX ID"]);
      const contactName = importValue(row, ["PERSONA CONTACTO", "CONTACTO", "CONTACT NAME"]);
      const email = importValue(row, ["MAIL", "EMAIL", "CORREO"]);
      const phone = importValue(row, ["TELEFONO", "TELÉFONO", "PHONE"]);
      const address = importValue(row, ["DIRECCION", "DIRECCIÓN", "ADDRESS"]);
      const province = importValue(row, ["PROVINCIA", "PROVINCE"]);
      const notes = importValue(row, ["OBSERVACIONES", "NOTAS", "NOTES"]);
      const existing = findImportedClient({ taxId, name });
      if (existing) {
        run(
          `UPDATE clients
           SET name = ?, legal_name = COALESCE(NULLIF(?, ''), legal_name), tax_id = COALESCE(NULLIF(?, ''), tax_id),
               contact_name = COALESCE(NULLIF(?, ''), contact_name),
               email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone),
               address = COALESCE(NULLIF(?, ''), address), province = COALESCE(NULLIF(?, ''), province),
               notes = COALESCE(NULLIF(?, ''), notes), source_ref = ?
           WHERE id = ?`,
          [name, legalName, taxId, contactName, email, phone, address, province, notes, sourceName, existing.id]
        );
        updated += 1;
      } else {
        run(
          `INSERT INTO clients (id, name, legal_name, tax_id, contact_name, email, phone, address, province, notes, source_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomId("cli"), name, legalName || name, taxId, contactName, email, phone, address, province, notes, sourceName]
        );
        inserted += 1;
      }
    }
  });
  const importRow = recordDataImport({
    source: sourceName,
    rowsRead: rows.length,
    inserted,
    updated,
    skipped,
    metadata: { kind: "clients" }
  });
  audit(actor, "data_import_completed", "data_import", importRow.id, { kind: "clients", inserted, updated, skipped });
  return { import: importRow, rowsRead: rows.length, inserted, updated, skipped };
}

function eventPerformed(event, today = formatDate()) {
  return Boolean(event && (event.status === "finalizado" || String(event.date) < today));
}

function eventWithDeliveryState(eventId) {
  return get(
    `SELECT events.*, COALESCE(delivery_notes.locked, 0) AS delivery_note_locked
     FROM events
     LEFT JOIN delivery_notes ON delivery_notes.event_id = events.id
     WHERE events.id = ?`,
    [eventId]
  );
}

function deliveryNoteLocked(event) {
  return Number(event?.delivery_note_locked || 0) === 1;
}

function recoveryCode() {
  return randomToken().replaceAll("-", "").replaceAll("_", "").slice(0, 16).toUpperCase();
}

function findValidRecoveryToken(code) {
  const tokens = all(
    `SELECT password_reset_tokens.*, users.active
     FROM password_reset_tokens
     JOIN users ON users.id = password_reset_tokens.user_id
     WHERE password_reset_tokens.used_at IS NULL
       AND password_reset_tokens.expires_at > ?
       AND users.active = 1
     ORDER BY password_reset_tokens.created_at DESC
     LIMIT 25`,
    [new Date().toISOString()]
  );
  return tokens.find((token) => verifyPassword(code, token.salt, token.token_hash));
}

function extractGoogleMapsCoordinates(value) {
  const text = String(value || "");
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /(?:query|q|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /(^|[^\d-])(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const offset = match.length === 4 ? 1 : 0;
    const lat = Number(match[1 + offset]);
    const lng = Number(match[2 + offset]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function isAllowedMapsUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "goo.gl") return parsed.pathname.startsWith("/maps");
    return (
      host === "maps.app.goo.gl" ||
      host.endsWith(".google.com") ||
      host === "google.com" ||
      host === "www.google.com"
    );
  } catch {
    return false;
  }
}

async function resolveGoogleMapsUrl(rawUrl) {
  const direct = extractGoogleMapsCoordinates(rawUrl);
  if (direct) return { coordinates: direct, finalUrl: rawUrl, resolved: false };

  if (!isAllowedMapsUrl(rawUrl)) {
    const error = new Error("Enlace de Google Maps no valido");
    error.status = 400;
    throw error;
  }

  const response = await fetch(rawUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(5000),
    headers: {
      "user-agent": "MARFAN-CREW-ERP/1.0"
    }
  });
  const finalUrl = response.url || rawUrl;
  const fromFinalUrl = extractGoogleMapsCoordinates(finalUrl);
  if (fromFinalUrl) return { coordinates: fromFinalUrl, finalUrl, resolved: true };

  const html = await response.text().catch(() => "");
  const fromBody = extractGoogleMapsCoordinates(html.slice(0, 300_000));
  if (fromBody) return { coordinates: fromBody, finalUrl, resolved: true };

  const error = new Error("No se encontraron coordenadas en el enlace");
  error.status = 422;
  throw error;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateServicePricing({ startTime, endTime, lat, lng, requirements = [], vehicleCount = 1 }) {
  const settings = settingMap();
  const baseLat = numberSetting(settings, "base_lat", 36.7213);
  const baseLng = numberSetting(settings, "base_lng", -4.42164);
  const includedKm = numberSetting(settings, "included_km", 20);
  const kilometrePrice = numberSetting(settings, "vehicle_km_price", 0.37);
  const roles = rolePriceMap();
  const totalHours = hoursBetween(startTime, endTime);
  const nightHours = nightHoursBetween(startTime, endTime);
  const dayHours = Math.max(totalHours - nightHours, 0);
  const normalizedRequirements = requirements.length ? requirements : [{ role: "Montaje", count: 1 }];
  let roleTotal = 0;
  let nightTotal = 0;

  for (const requirement of normalizedRequirements) {
    const count = Number(requirement.count || 0);
    const role = roles.get(String(requirement.role || "").toLowerCase()) || roles.get("operario") || {
      base_price: 0,
      night_price: 0
    };
    roleTotal += count * dayHours * Number(role.base_price || 0);
    nightTotal += count * nightHours * Number(role.night_price || 0);
  }

  const distanceKm = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    ? Math.round((distanceMeters(baseLat, baseLng, Number(lat), Number(lng)) / 1000) * 10) / 10
    : 0;
  const billableKm = Math.max(distanceKm - includedKm, 0);
  const distanceTotal = billableKm * Math.max(Number(vehicleCount || 1), 0) * kilometrePrice;
  const servicePrice = roleTotal + nightTotal + distanceTotal;

  return {
    baseDistanceKm: distanceKm,
    billableKm: Math.round(billableKm * 10) / 10,
    kilometrePrice,
    rolePriceTotal: roundMoney(roleTotal),
    nightPriceTotal: roundMoney(nightTotal),
    distancePriceTotal: roundMoney(distanceTotal),
    servicePrice: roundMoney(servicePrice)
  };
}

function coordinatePairFromValues(latValue, lngValue) {
  if (latValue === undefined || lngValue === undefined) return null;
  if (String(latValue).trim() === "" || String(lngValue).trim() === "") return null;
  const lat = Number(String(latValue).replace(",", "."));
  const lng = Number(String(lngValue).replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function eventCoordinatesFromBody(body, options = {}) {
  const settings = settingMap();
  const fromMaps = extractGoogleMapsCoordinates(body.googleMapsUrl || body.mapsUrl || "");
  const manual = coordinatePairFromValues(body.lat, body.lng);
  if (fromMaps) return { ...fromMaps, source: "google_maps" };
  if (manual) return { ...manual, source: options.manualSource || "manual" };
  return {
    lat: Number(options.fallbackLat ?? numberSetting(settings, "base_lat", 36.7213)),
    lng: Number(options.fallbackLng ?? numberSetting(settings, "base_lng", -4.42164)),
    source: options.fallbackSource || "base_fallback"
  };
}

function hasUsableEventCoordinates(event) {
  const pair = coordinatePairFromValues(event?.lat, event?.lng);
  if (!pair) return false;
  if (Math.abs(pair.lat) < 0.000001 && Math.abs(pair.lng) < 0.000001) return false;
  const source = String(event?.location_source || "").toLowerCase();
  if (source === "base_fallback") return false;
  const locationText = `${event?.location || ""} ${event?.address || ""}`.toLowerCase();
  if (!source && locationText.includes("ubicacion pendiente")) return false;
  return true;
}

function eventClockLocationBlockReason(event) {
  return hasUsableEventCoordinates(event) ? "" : "Completa la ubicacion GPS real del evento antes de fichar";
}

function normalizeRequirements(input, fallbackTotal = 1) {
  const requirements = (Array.isArray(input) ? input : [])
    .map((requirement) => ({
      role: String(requirement.role || "").trim(),
      count: Number(requirement.count || 0)
    }))
    .filter((requirement) => requirement.role && requirement.count > 0);
  if (requirements.length) return requirements;
  return [{ role: "Operario", count: Number(fallbackTotal || 1) }];
}

function pricingForEvent(eventId, eventOverride = {}) {
  const event = eventOverride.id ? eventOverride : get("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return null;
  const requirements = all("SELECT role, count FROM event_requirements WHERE event_id = ?", [eventId]);
  return calculateServicePricing({
    startTime: event.start_time,
    endTime: event.end_time,
    lat: event.lat,
    lng: event.lng,
    requirements,
    vehicleCount: event.vehicle_count || 1
  });
}

function updateEventPricing(eventId, pricing) {
  if (!pricing) return;
  run(
    `UPDATE events
     SET base_distance_km = ?,
         billable_km = ?,
         kilometre_price = ?,
         role_price_total = ?,
         night_price_total = ?,
         distance_price_total = ?,
         service_price = ?,
         budget = CASE WHEN budget IS NULL OR budget = 0 THEN ? ELSE budget END
     WHERE id = ?`,
    [
      pricing.baseDistanceKm,
      pricing.billableKm,
      pricing.kilometrePrice,
      pricing.rolePriceTotal,
      pricing.nightPriceTotal,
      pricing.distancePriceTotal,
      pricing.servicePrice,
      pricing.servicePrice,
      eventId
    ]
  );
}

function repriceOpenEvents() {
  for (const event of all("SELECT id FROM events WHERE status != 'finalizado'")) {
    updateEventPricing(event.id, pricingForEvent(event.id));
  }
}

function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addIsoDays(dateValue, days) {
  const [year, month, day] = String(dateValue || formatDate()).split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatDate(date);
}

function addTime(time, hours) {
  const [hour, minute] = String(time || "09:00").split(":").map(Number);
  const total = ((hour || 0) * 60) + (minute || 0) + Math.round(Number(hours || 0) * 60);
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function daysUntil(dateValue, today = formatDate()) {
  if (!dateValue) return null;
  const start = new Date(`${today}T12:00:00Z`).getTime();
  const end = new Date(`${dateValue}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.ceil((end - start) / 86_400_000);
}

function effectiveDocumentStatus(document) {
  if (document.status === "pendiente") return "pendiente";
  const days = daysUntil(document.expires_at);
  if (days === null) return document.status || "vigente";
  if (days < 0) return "caducado";
  if (days <= 30) return "proximo";
  return "vigente";
}

function hydrateDocument(document) {
  const days = daysUntil(document.expires_at);
  return {
    ...document,
    stored_status: document.status,
    status: effectiveDocumentStatus(document),
    days_to_expiry: days
  };
}

function documentSeverity(status) {
  return { caducado: 1, pendiente: 2, proximo: 3, vigente: 4 }[status] || 5;
}

function listDocuments({ employeeId } = {}) {
  const params = [];
  const where = [];
  if (employeeId) {
    where.push("documents.employee_id = ?");
    params.push(employeeId);
  }
  return all(
    `SELECT documents.id, documents.employee_id, documents.type, documents.name, documents.status,
            documents.expires_at, documents.url, documents.created_at, documents.file_name,
            documents.file_mime, documents.file_size, documents.uploaded_at,
            CASE WHEN documents.storage_path IS NOT NULL THEN 1 ELSE 0 END AS has_file,
            employees.name AS employee_name, employees.role AS employee_role
     FROM documents
     JOIN employees ON employees.id = documents.employee_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY documents.expires_at ASC, documents.created_at DESC`,
    params
  )
    .map(hydrateDocument)
    .sort((a, b) => documentSeverity(a.status) - documentSeverity(b.status) || String(a.expires_at || "9999").localeCompare(String(b.expires_at || "9999")));
}

function listEventDocuments({ eventId, visibleOnly = false } = {}) {
  const params = [];
  const where = [];
  if (eventId) {
    where.push("event_documents.event_id = ?");
    params.push(eventId);
  }
  if (visibleOnly) where.push("event_documents.visible_to_employee = 1");
  return all(
    `SELECT event_documents.*,
            events.name AS event_name,
            uploaded_by.name AS uploaded_by_name,
            CASE WHEN event_documents.storage_path IS NOT NULL THEN 1 ELSE 0 END AS has_file
     FROM event_documents
     JOIN events ON events.id = event_documents.event_id
     LEFT JOIN users uploaded_by ON uploaded_by.id = event_documents.uploaded_by_user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY event_documents.created_at DESC`,
    params
  );
}

function documentComplianceSummary(documents = listDocuments()) {
  const byEmployee = new Map();
  const totals = {
    total: documents.length,
    vigente: 0,
    proximo: 0,
    caducado: 0,
    pendiente: 0,
    employeesBlocked: 0,
    employeesWarning: 0,
    employeesOk: 0
  };
  for (const document of documents) {
    if (totals[document.status] !== undefined) totals[document.status] += 1;
    if (!byEmployee.has(document.employee_id)) {
      byEmployee.set(document.employee_id, {
        employee_id: document.employee_id,
        employee_name: document.employee_name,
        employee_role: document.employee_role,
        total: 0,
        vigente: 0,
        proximo: 0,
        caducado: 0,
        pendiente: 0,
        blockers: [],
        warnings: [],
        status: "vigente"
      });
    }
    const row = byEmployee.get(document.employee_id);
    row.total += 1;
    if (row[document.status] !== undefined) row[document.status] += 1;
    if (["caducado", "pendiente"].includes(document.status)) row.blockers.push(document);
    if (document.status === "proximo") row.warnings.push(document);
  }
  const employees = Array.from(byEmployee.values()).map((row) => {
    row.status = row.blockers.length ? "bloqueado" : row.warnings.length ? "aviso" : "vigente";
    if (row.status === "bloqueado") totals.employeesBlocked += 1;
    else if (row.status === "aviso") totals.employeesWarning += 1;
    else totals.employeesOk += 1;
    return row;
  }).sort((a, b) => documentSeverity(a.status === "bloqueado" ? "caducado" : a.status === "aviso" ? "proximo" : "vigente") - documentSeverity(b.status === "bloqueado" ? "caducado" : b.status === "aviso" ? "proximo" : "vigente") || a.employee_name.localeCompare(b.employee_name));
  return { totals, employees };
}

function syncStoredDocumentStatuses(actor = null) {
  const documents = all("SELECT id, status, expires_at FROM documents");
  let updated = 0;
  for (const document of documents) {
    const nextStatus = effectiveDocumentStatus(document);
    if (nextStatus === document.status) continue;
    run("UPDATE documents SET status = ? WHERE id = ?", [nextStatus, document.id]);
    updated += 1;
  }
  audit(actor, "document_statuses_synced", "document", "all", { updated });
  return { updated };
}

function eventFinancials(eventId) {
  const event = get("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return null;
  const hours = hoursBetween(event.start_time, event.end_time);
  const labour = get(
    `SELECT COALESCE(SUM(employees.hourly_rate * ?), 0) AS total
     FROM assignments
     JOIN employees ON employees.id = assignments.employee_id
     WHERE assignments.event_id = ? AND assignments.status != 'bloqueado'`,
    [hours, eventId]
  ).total;
  const allowances = get(
    `SELECT COALESCE(SUM(allowances.km * employees.km_rate + allowances.diet + allowances.night_hours * 3 + allowances.extras), 0) AS total
     FROM allowances
     JOIN employees ON employees.id = allowances.employee_id
     WHERE allowances.event_id = ?`,
    [eventId]
  ).total;
  const cost = Math.round((labour + allowances) * 100) / 100;
  const revenue = Number(event.service_price || event.budget || 0);
  const benefit = Math.round((revenue - cost) * 100) / 100;
  const margin = revenue ? Math.round((benefit / revenue) * 1000) / 10 : 0;
  return { hours, cost, benefit, margin, revenue };
}

function emptyFinanceBucket(name, extra = {}) {
  return {
    name,
    revenue: 0,
    cost: 0,
    benefit: 0,
    margin: 0,
    events: 0,
    hours: 0,
    ...extra
  };
}

function finalizeFinanceBucket(bucket) {
  bucket.revenue = Math.round(Number(bucket.revenue || 0) * 100) / 100;
  bucket.cost = Math.round(Number(bucket.cost || 0) * 100) / 100;
  bucket.benefit = Math.round((bucket.revenue - bucket.cost) * 100) / 100;
  bucket.hours = Math.round(Number(bucket.hours || 0) * 100) / 100;
  bucket.margin = bucket.revenue ? Math.round((bucket.benefit / bucket.revenue) * 1000) / 10 : 0;
  return bucket;
}

function financeSummary(filters = {}) {
  const events = listEvents(filters);
  const totals = emptyFinanceBucket("Total");
  const byClient = new Map();
  const byMonth = new Map();

  for (const event of events) {
    const revenue = Number(event.service_price || event.budget || 0);
    const cost = Number(event.finance?.cost || 0);
    const hours = Number(event.finance?.hours || hoursBetween(event.start_time, event.end_time));
    totals.revenue += revenue;
    totals.cost += cost;
    totals.events += 1;
    totals.hours += hours;

    const client = byClient.get(event.client_id) || emptyFinanceBucket(event.client_name, { id: event.client_id });
    client.revenue += revenue;
    client.cost += cost;
    client.events += 1;
    client.hours += hours;
    byClient.set(event.client_id, client);

    const monthKey = String(event.date || "").slice(0, 7) || "Sin fecha";
    const month = byMonth.get(monthKey) || emptyFinanceBucket(monthKey, { id: monthKey });
    month.revenue += revenue;
    month.cost += cost;
    month.events += 1;
    month.hours += hours;
    byMonth.set(monthKey, month);
  }

  const employeeWhere = ["assignments.status != 'bloqueado'"];
  const employeeParams = [];
  if (filters.from) {
    employeeWhere.push("events.date >= ?");
    employeeParams.push(filters.from);
  }
  if (filters.to) {
    employeeWhere.push("events.date <= ?");
    employeeParams.push(filters.to);
  }
  if (filters.clientId) {
    employeeWhere.push("events.client_id = ?");
    employeeParams.push(filters.clientId);
  }
  if (filters.employeeId) {
    employeeWhere.push("assignments.employee_id = ?");
    employeeParams.push(filters.employeeId);
  }
  if (filters.status) {
    employeeWhere.push("events.status = ?");
    employeeParams.push(filters.status);
  }
  if (filters.search) {
    employeeWhere.push("(events.name LIKE ? OR clients.name LIKE ? OR events.location LIKE ?)");
    employeeParams.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  const employeeRows = all(
    `SELECT assignments.employee_id, employees.name, employees.role, employees.hourly_rate, employees.km_rate,
            events.id AS event_id, events.name AS event_name, events.start_time, events.end_time,
            events.service_price, events.budget,
            COALESCE(active_counts.count, 1) AS active_count,
            COALESCE(allowances.km, 0) AS km,
            COALESCE(allowances.diet, 0) AS diet,
            COALESCE(allowances.night_hours, 0) AS night_hours,
            COALESCE(allowances.extras, 0) AS extras
     FROM assignments
     JOIN employees ON employees.id = assignments.employee_id
     JOIN events ON events.id = assignments.event_id
     JOIN clients ON clients.id = events.client_id
     LEFT JOIN allowances ON allowances.event_id = assignments.event_id AND allowances.employee_id = assignments.employee_id
     LEFT JOIN (
       SELECT event_id, COUNT(*) AS count
       FROM assignments
       WHERE status != 'bloqueado'
       GROUP BY event_id
     ) active_counts ON active_counts.event_id = assignments.event_id
     WHERE ${employeeWhere.join(" AND ")}`,
    employeeParams
  );
  const byEmployee = new Map();
  for (const row of employeeRows) {
    const bucket = byEmployee.get(row.employee_id) || emptyFinanceBucket(row.name, {
      id: row.employee_id,
      role: row.role,
      km: 0,
      diets: 0,
      nightHours: 0,
      extras: 0
    });
    const hours = hoursBetween(row.start_time, row.end_time);
    const employeeCost =
      Number(row.hourly_rate || 0) * hours +
      Number(row.km || 0) * Number(row.km_rate || 0) +
      Number(row.diet || 0) +
      Number(row.night_hours || 0) * 3 +
      Number(row.extras || 0);
    const allocatedRevenue = Number(row.service_price || row.budget || 0) / Math.max(Number(row.active_count || 1), 1);
    bucket.revenue += allocatedRevenue;
    bucket.cost += employeeCost;
    bucket.events += 1;
    bucket.hours += hours;
    bucket.km += Number(row.km || 0);
    bucket.diets += Number(row.diet || 0);
    bucket.nightHours += Number(row.night_hours || 0);
    bucket.extras += Number(row.extras || 0);
    byEmployee.set(row.employee_id, bucket);
  }

  const topEvents = events
    .map((event) => ({
      id: event.id,
      name: event.name,
      client: event.client_name,
      date: event.date,
      revenue: Number(event.service_price || event.budget || 0),
      cost: Number(event.finance?.cost || 0),
      benefit: Number(event.finance?.benefit || 0),
      margin: Number(event.finance?.margin || 0)
    }))
    .sort((a, b) => b.benefit - a.benefit);

  return {
    filters,
    totals: finalizeFinanceBucket(totals),
    byClient: Array.from(byClient.values()).map(finalizeFinanceBucket).sort((a, b) => b.revenue - a.revenue),
    byMonth: Array.from(byMonth.values()).map(finalizeFinanceBucket).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    byEmployee: Array.from(byEmployee.values()).map((bucket) => {
      const finalized = finalizeFinanceBucket(bucket);
      finalized.km = Math.round(Number(finalized.km || 0) * 10) / 10;
      finalized.diets = Math.round(Number(finalized.diets || 0) * 100) / 100;
      finalized.nightHours = Math.round(Number(finalized.nightHours || 0) * 10) / 10;
      finalized.extras = Math.round(Number(finalized.extras || 0) * 100) / 100;
      return finalized;
    }).sort((a, b) => b.benefit - a.benefit),
    topEvents
  };
}

function financeReportRows(filters = {}) {
  const summary = financeSummary(filters);
  const rows = [];
  for (const item of summary.byClient) {
    rows.push({
      seccion: "cliente",
      nombre: item.name,
      eventos: item.events,
      horas: item.hours,
      ingresos: item.revenue,
      costes: item.cost,
      beneficio: item.benefit,
      margen: item.margin,
      detalle: item.id
    });
  }
  for (const item of summary.byMonth) {
    rows.push({
      seccion: "mes",
      nombre: item.name,
      eventos: item.events,
      horas: item.hours,
      ingresos: item.revenue,
      costes: item.cost,
      beneficio: item.benefit,
      margen: item.margin,
      detalle: item.id
    });
  }
  for (const item of summary.byEmployee) {
    rows.push({
      seccion: "operario",
      nombre: item.name,
      eventos: item.events,
      horas: item.hours,
      ingresos: item.revenue,
      costes: item.cost,
      beneficio: item.benefit,
      margen: item.margin,
      detalle: `${item.role || ""} · ${item.km || 0} km · ${item.diets || 0} EUR dietas · ${item.nightHours || 0} h noct.`
    });
  }
  for (const item of summary.topEvents) {
    rows.push({
      seccion: "evento",
      nombre: item.name,
      eventos: 1,
      horas: "",
      ingresos: item.revenue,
      costes: item.cost,
      beneficio: item.benefit,
      margen: item.margin,
      detalle: `${item.client} · ${item.date}`
    });
  }
  return rows;
}

function allowanceNumber(value, fallback = 0) {
  const number = Number(value ?? fallback ?? 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function allowanceValuesFromBody(body = {}, existing = {}) {
  return {
    km: Math.round(allowanceNumber(body.km, existing.km) * 10) / 10,
    diet: roundMoney(body.diet ?? existing.diet),
    nightHours: Math.round(allowanceNumber(body.nightHours ?? body.night_hours, existing.night_hours) * 10) / 10,
    extras: roundMoney(body.extras ?? existing.extras)
  };
}

function listAllowances(filters = {}) {
  const where = [];
  const params = [];
  if (filters.id) {
    where.push("allowances.id = ?");
    params.push(filters.id);
  }
  if (filters.eventId) {
    where.push("allowances.event_id = ?");
    params.push(filters.eventId);
  }
  if (filters.employeeId) {
    where.push("allowances.employee_id = ?");
    params.push(filters.employeeId);
  }
  const sql = `
    SELECT allowances.*,
           events.name AS event_name, events.date AS event_date, events.start_time, events.end_time,
           events.status AS event_status, events.location AS event_location,
           employees.name AS employee_name, employees.role AS employee_role, employees.km_rate,
           assignments.role AS assignment_role,
           COALESCE(delivery_notes.locked, 0) AS delivery_note_locked
    FROM allowances
    JOIN events ON events.id = allowances.event_id
    JOIN employees ON employees.id = allowances.employee_id
    LEFT JOIN assignments ON assignments.event_id = allowances.event_id AND assignments.employee_id = allowances.employee_id
    LEFT JOIN delivery_notes ON delivery_notes.event_id = events.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY events.date DESC, events.start_time DESC, employees.name
  `;
  return all(sql, params).map((row) => ({
    ...row,
    km: Math.round(Number(row.km || 0) * 10) / 10,
    diet: roundMoney(row.diet),
    night_hours: Math.round(Number(row.night_hours || 0) * 10) / 10,
    extras: roundMoney(row.extras),
    locked: eventPerformed({ date: row.event_date, status: row.event_status }) || Number(row.delivery_note_locked || 0) === 1
  }));
}

function allowanceById(id) {
  return listAllowances({ id })[0] || null;
}

function ensureAllowanceEventEditable(eventId) {
  const event = get(
    `SELECT events.*, COALESCE(delivery_notes.locked, 0) AS delivery_note_locked
     FROM events
     LEFT JOIN delivery_notes ON delivery_notes.event_id = events.id
     WHERE events.id = ?`,
    [eventId]
  );
  if (!event) {
    const error = new Error("Evento no encontrado");
    error.status = 404;
    throw error;
  }
  if (eventPerformed(event)) {
    const error = new Error("Evento efectuado: los pluses quedan en modo solo revision");
    error.status = 409;
    throw error;
  }
  if (Number(event.delivery_note_locked || 0) === 1) {
    const error = new Error("Albaran firmado: no se pueden modificar pluses");
    error.status = 409;
    throw error;
  }
  return event;
}

function ensureTimeEntryEventEditable(eventId) {
  const event = get(
    `SELECT events.*, COALESCE(delivery_notes.locked, 0) AS delivery_note_locked
     FROM events
     LEFT JOIN delivery_notes ON delivery_notes.event_id = events.id
     WHERE events.id = ?`,
    [eventId]
  );
  if (!event) {
    const error = new Error("Evento no encontrado");
    error.status = 404;
    throw error;
  }
  if (Number(event.delivery_note_locked || 0) === 1) {
    const error = new Error("Albaran firmado: no se pueden corregir fichajes");
    error.status = 409;
    throw error;
  }
  return event;
}

function assignedAllowanceEmployee(eventId, employeeId) {
  return get(
    `SELECT assignments.*, employees.name AS employee_name
     FROM assignments
     JOIN employees ON employees.id = assignments.employee_id
     WHERE assignments.event_id = ? AND assignments.employee_id = ? AND assignments.status != 'bloqueado'`,
    [eventId, employeeId]
  );
}

function employeeReportRows(filters = {}) {
  const params = [];
  const where = [];
  if (filters.employeeId) {
    where.push("employees.id = ?");
    params.push(filters.employeeId);
  }
  if (filters.search) {
    where.push(`(
      employees.name LIKE ? OR
      employees.role LIKE ? OR
      employees.phone LIKE ? OR
      employees.email LIKE ? OR
      employees.dni LIKE ?
    )`);
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  const employees = all(
    `SELECT * FROM employees
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY employees.name`,
    params
  ).map(parseEmployee);
  const compliance = new Map(documentComplianceSummary(listDocuments()).employees.map((row) => [row.employee_id, row]));
  return employees.map((employee) => {
    const docs = compliance.get(employee.id) || {
      total: 0,
      vigente: 0,
      proximo: 0,
      caducado: 0,
      pendiente: 0,
      blockers: [],
      warnings: [],
      status: "sin_documentos"
    };
    return {
      id: employee.id,
      nombre: employee.name,
      rol: employee.role,
      estado_operario: employee.status,
      telefono: employee.phone || "",
      email: employee.email || "",
      dni: employee.dni || "",
      ciudad: employee.city || employee.province || "",
      camiseta: employee.shirt_size || "",
      pantalon: employee.pants_size || "",
      calzado: employee.shoe_size || "",
      chaqueta: employee.jacket_size || "",
      epi: employee.epi_size || "",
      skills: (employee.skills || []).join(", "),
      estado_documental: docs.status,
      documentos_total: docs.total,
      documentos_vigentes: docs.vigente,
      documentos_proximos: docs.proximo,
      documentos_caducados: docs.caducado,
      documentos_pendientes: docs.pendiente,
      bloqueos: (docs.blockers || []).map((doc) => `${doc.type}: ${doc.name}`).join(" | "),
      avisos: (docs.warnings || []).map((doc) => `${doc.type}: ${doc.name}${doc.expires_at ? ` (${doc.expires_at})` : ""}`).join(" | "),
      origen: employee.source_ref || "",
      importado: employee.imported_at || ""
    };
  });
}

function incidentReportRows(filters = {}) {
  const params = [];
  const where = [];
  const dateExpression = "COALESCE(events.date, substr(incidents.created_at, 1, 10))";
  if (filters.from) {
    where.push(`${dateExpression} >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`${dateExpression} <= ?`);
    params.push(filters.to);
  }
  if (filters.clientId) {
    where.push("events.client_id = ?");
    params.push(filters.clientId);
  }
  if (filters.employeeId) {
    where.push("incidents.employee_id = ?");
    params.push(filters.employeeId);
  }
  if (["abierta", "resuelta"].includes(filters.status)) {
    where.push("incidents.status = ?");
    params.push(filters.status);
  }
  if (filters.search) {
    where.push(`(
      incidents.title LIKE ? OR
      incidents.description LIKE ? OR
      incidents.resolution_note LIKE ? OR
      incidents.type LIKE ? OR
      employees.name LIKE ? OR
      events.name LIKE ? OR
      clients.name LIKE ?
    )`);
    params.push(
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`,
      `%${filters.search}%`
    );
  }
  return all(
    `SELECT incidents.*,
            events.name AS event_name,
            events.date AS event_date,
            events.start_time AS event_start_time,
            events.end_time AS event_end_time,
            events.location AS event_location,
            clients.name AS client_name,
            employees.name AS employee_name
     FROM incidents
     LEFT JOIN events ON events.id = incidents.event_id
     LEFT JOIN clients ON clients.id = events.client_id
     LEFT JOIN employees ON employees.id = incidents.employee_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE incidents.status WHEN 'abierta' THEN 1 ELSE 2 END,
              CASE incidents.priority WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
              incidents.created_at DESC`,
    params
  ).map((row) => ({
    id: row.id,
    fecha_incidencia: String(row.created_at || "").slice(0, 10),
    estado: row.status,
    prioridad: row.priority,
    tipo: row.type,
    titulo: row.title,
    descripcion: row.description || "",
    evento: row.event_name || "",
    fecha_evento: row.event_date || "",
    horario: [row.event_start_time, row.event_end_time].filter(Boolean).join(" - "),
    ubicacion: row.event_location || "",
    cliente: row.client_name || "",
    operario: row.employee_name || "",
    resolucion: row.resolution_note || "",
    resuelta: row.resolved_at || ""
  }));
}

function reportFiltersFromUrl(url) {
  return {
    from: url.searchParams.get("from") || "",
    to: url.searchParams.get("to") || "",
    clientId: url.searchParams.get("clientId") || "",
    employeeId: url.searchParams.get("employeeId") || "",
    status: url.searchParams.get("status") || "",
    search: url.searchParams.get("search") || ""
  };
}

function enrichEvent(row) {
  if (!row) return null;
  const assigned = get("SELECT COUNT(*) AS count FROM assignments WHERE event_id = ? AND status != 'bloqueado'", [row.id]).count;
  const clocked = get(
    "SELECT COUNT(DISTINCT employee_id) AS count FROM time_entries WHERE event_id = ? AND accepted = 1 AND type = 'entrada'",
    [row.id]
  ).count;
  const incidents = get(
    "SELECT COUNT(*) AS count FROM incidents WHERE event_id = ? AND status = 'abierta'",
    [row.id]
  ).count;
  const requirements = all("SELECT role, count FROM event_requirements WHERE event_id = ? ORDER BY role", [
    row.id
  ]);
  const finance = eventFinancials(row.id);
  const assignments = assignmentRowsForEvent(row);
  return {
    ...row,
    assigned_count: assigned,
    clocked_count: clocked,
    incident_count: incidents,
    assignments,
    requirements,
    required_total: Number(row.required_total),
    budget: Number(row.budget),
    service_price: Number(row.service_price || row.budget || 0),
    finance
  };
}

function listEvents({ from, to, search, clientId, employeeId, status } = {}) {
  const params = [];
  const where = [];
  if (from) {
    where.push("events.date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("events.date <= ?");
    params.push(to);
  }
  if (search) {
    where.push("(events.name LIKE ? OR clients.name LIKE ? OR events.location LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (clientId) {
    where.push("events.client_id = ?");
    params.push(clientId);
  }
  if (employeeId) {
    where.push(`EXISTS (
      SELECT 1 FROM assignments
      WHERE assignments.event_id = events.id
        AND assignments.employee_id = ?
        AND assignments.status != 'bloqueado'
    )`);
    params.push(employeeId);
  }
  if (status) {
    where.push("events.status = ?");
    params.push(status);
  }
  const sql = `
    SELECT events.*, clients.name AS client_name, employees.name AS team_leader_name
    FROM events
    JOIN clients ON clients.id = events.client_id
    LEFT JOIN employees ON employees.id = events.team_leader_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY events.date ASC, events.start_time ASC
  `;
  return all(sql, params).map(enrichEvent);
}

function assignmentRowsForEvent(event) {
  if (!event) return [];
  return all(
    `SELECT assignments.*, employees.name, employees.phone, employees.email, employees.role AS employee_role,
            employees.status AS employee_status
     FROM assignments
     JOIN employees ON employees.id = assignments.employee_id
     WHERE assignments.event_id = ?
     ORDER BY CASE assignments.status
       WHEN 'confirmado' THEN 1
       WHEN 'pendiente' THEN 2
       WHEN 'bloqueado' THEN 3
       ELSE 4
     END, employees.name`,
    [event.id]
  ).map((assignment) => ({
    ...assignment,
    issues: validateAssignment(event, assignment)
  }));
}

function updateEventStatus(eventId) {
  const event = get("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event || event.status === "finalizado") return event?.status;
  const assigned = get("SELECT COUNT(*) AS count FROM assignments WHERE event_id = ? AND status != 'bloqueado'", [eventId]).count;
  let status = "completo";
  if (!event.team_leader_id) status = "sin_jefe";
  else if (assigned < Math.ceil(event.required_total * 0.5)) status = "critico";
  else if (assigned < event.required_total) status = "falta_personal";
  run("UPDATE events SET status = ? WHERE id = ?", [status, eventId]);
  return status;
}

function dashboardPayload(attendanceDetection = null) {
  const today = formatDate();
  const todaysEvents = listEvents({ from: today, to: today });
  const assigned = todaysEvents.reduce((sum, event) => sum + event.assigned_count, 0);
  const clocked = todaysEvents.reduce((sum, event) => sum + event.clocked_count, 0);
  const totalCost = todaysEvents.reduce((sum, event) => sum + event.finance.cost, 0);
  const totalBudget = todaysEvents.reduce((sum, event) => sum + event.service_price, 0);
  const totalBenefit = totalBudget - totalCost;
  const openIncidents = get("SELECT COUNT(*) AS count FROM incidents WHERE status = 'abierta'").count;
  const missingStaff = todaysEvents.filter((event) => event.assigned_count < event.required_total).length;
  const missingLeaders = todaysEvents.filter((event) => !event.team_leader_id).length;
  const pendingClock = Math.max(assigned - clocked, 0);

  const cards = [
    { label: "Eventos hoy", value: todaysEvents.length, hint: "Programados", tone: "blue" },
    { label: "Operarios asignados", value: assigned, hint: "En servicios de hoy", tone: "ink" },
    { label: "Operarios fichados", value: clocked, hint: `${assigned ? Math.round((clocked / assigned) * 100) : 0}% del total`, tone: "green" },
    { label: "Pendientes de fichar", value: pendingClock, hint: "Entrada pendiente", tone: "amber" },
    { label: "Eventos sin personal", value: missingStaff, hint: "Requieren asignacion", tone: "red" },
    { label: "Eventos sin jefe", value: missingLeaders, hint: "Jefe de equipo pendiente", tone: "dark" },
    { label: "Incidencias abiertas", value: openIncidents, hint: "Prioridad operativa", tone: "red" },
    { label: "Coste del dia", value: totalCost, hint: "Coste previsto", tone: "ink", money: true },
    { label: "Facturacion prevista", value: totalBudget, hint: "Ingresos estimados", tone: "green", money: true },
    { label: "Beneficio previsto", value: totalBenefit, hint: `${totalBudget ? Math.round((totalBenefit / totalBudget) * 1000) / 10 : 0}% margen`, tone: "green", money: true }
  ];

  return {
    date: today,
    cards,
    live: todaysEvents,
    alerts: buildAlerts(todaysEvents),
    attendanceDetection,
    updatedAt: new Date().toISOString()
  };
}

function buildAlerts(events) {
  const alerts = [];
  for (const event of events) {
    if (event.assigned_count < event.required_total) {
      alerts.push({
        id: `staff-${event.id}`,
        tone: event.status === "critico" ? "red" : "amber",
        title: "Falta personal asignado",
        detail: `${event.name}: ${event.assigned_count}/${event.required_total}`,
        time: event.start_time
      });
    }
    if (!event.team_leader_id) {
      alerts.push({
        id: `leader-${event.id}`,
        tone: "dark",
        title: "Evento sin jefe",
        detail: event.name,
        time: event.start_time
      });
    }
    if (event.clocked_count < event.assigned_count && event.assigned_count > 0) {
      alerts.push({
        id: `clock-${event.id}`,
        tone: "amber",
        title: "Fichajes pendientes",
        detail: `${event.assigned_count - event.clocked_count} operarios pendientes`,
        time: event.start_time
      });
    }
    const blockedAssignments = (event.assignments || []).flatMap((assignment) =>
      (assignment.issues || [])
        .filter((issue) => issue.severity === "block")
        .map((issue) => ({ assignment, issue }))
    );
    if (blockedAssignments.length) {
      alerts.push({
        id: `assignment-${event.id}`,
        tone: "red",
        title: "Asignaciones con bloqueo",
        detail: `${event.name}: ${blockedAssignments[0].assignment.name} · ${blockedAssignments[0].issue.message}`,
        time: event.start_time
      });
    }
  }

  for (const incident of all(
    `SELECT incidents.*, events.name AS event_name, employees.name AS employee_name
     FROM incidents
     LEFT JOIN events ON events.id = incidents.event_id
     LEFT JOIN employees ON employees.id = incidents.employee_id
     WHERE incidents.status = 'abierta'
     ORDER BY CASE priority WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END, incidents.created_at DESC
     LIMIT 8`
  )) {
    alerts.push({
      id: incident.id,
      tone: incident.priority === "critica" ? "red" : incident.priority === "alta" ? "amber" : "blue",
      title: incident.title,
      detail: incident.employee_name ? `${incident.employee_name} · ${incident.event_name || "Sin evento"}` : incident.event_name || incident.description,
      time: incident.created_at.slice(11, 16)
    });
  }

  for (const document of listDocuments().filter((item) => ["caducado", "pendiente", "proximo"].includes(item.status)).slice(0, 5)) {
    alerts.push({
      id: `doc-${document.id}`,
      tone: document.status === "caducado" || document.status === "pendiente" ? "red" : "amber",
      title: document.status === "proximo" ? "Documento proximo a caducar" : "Documento bloqueante",
      detail: `${document.employee_name} · ${document.type} · ${document.status}`,
      time: document.expires_at || "RRHH"
    });
  }

  alerts.push({
    id: "backup-ok",
    tone: "blue",
    title: "Backup protegido",
    detail: "Copia automatica diaria activa",
    time: "auto"
  });

  return alerts.slice(0, 10);
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function liveClockState(event, assignment, entries) {
  if (assignment.status === "bloqueado") return "bloqueado";
  if (event.status === "finalizado") return "finalizado";
  const accepted = entries.filter((entry) => entry.accepted);
  const hasOut = accepted.some((entry) => entry.type === "salida");
  if (hasOut) return "finalizado";
  const hasIn = accepted.some((entry) => entry.type === "entrada");
  if (hasIn) return "en_curso";
  const isToday = event.date === formatDate();
  const late = isToday && currentMinutes() > toMinutes(event.start_time) + 15;
  if (late) return "tarde";
  if (assignment.status === "pendiente") return "pendiente";
  return "sin_fichar";
}

function clockProgress(event, assignment, entries, policy = clockPolicy()) {
  const accepted = entries.filter((entry) => entry.accepted).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const state = liveClockState(event, assignment, entries);
  const lastEntry = accepted[0] || null;
  const entryWindow = clockWindowState(event, "entrada", policy);
  const exitWindow = clockWindowState(event, "salida", policy);
  const locationBlockReason = ["sin_fichar", "pendiente", "tarde", "en_curso"].includes(state)
    ? eventClockLocationBlockReason(event)
    : "";
  const canClockIn = ["sin_fichar", "pendiente", "tarde"].includes(state) && entryWindow.allowed && !locationBlockReason;
  const canClockOut = state === "en_curso" && exitWindow.allowed && !locationBlockReason;
  const blockReason =
    locationBlockReason ||
    (["sin_fichar", "pendiente", "tarde"].includes(state) && !entryWindow.allowed ? entryWindow.reason :
      state === "en_curso" && !exitWindow.allowed ? exitWindow.reason :
      "");
  return {
    state,
    lastEntry,
    nextType: canClockIn ? "entrada" : canClockOut ? "salida" : null,
    canClockIn,
    canClockOut,
    blockReason,
    entryOpenAt: entryWindow.openAt?.toISOString?.() || "",
    exitCloseAt: exitWindow.closeAt?.toISOString?.() || ""
  };
}

function employeeServiceClockData(service, employeeId, policy = clockPolicy()) {
  const entries = all(
    `SELECT * FROM time_entries
     WHERE event_id = ? AND employee_id = ?
     ORDER BY timestamp DESC`,
    [service.id, employeeId]
  );
  const progress = clockProgress(service, { status: service.assignment_status }, entries, policy);
  return {
    ...service,
    clock_state: progress.state,
    next_clock_type: progress.nextType,
    last_clock_type: progress.lastEntry?.type || null,
    last_clock_at: progress.lastEntry?.timestamp || null,
    can_clock_in: progress.canClockIn ? 1 : 0,
    can_clock_out: progress.canClockOut ? 1 : 0,
    clock_block_reason: progress.blockReason,
    clock_entry_open_at: progress.entryOpenAt,
    clock_exit_close_at: progress.exitCloseAt
  };
}

function employeeServiceChecklist(service, documents = []) {
  const docBlockers = documents.filter((document) => ["caducado", "pendiente"].includes(document.status));
  const docWarnings = documents.filter((document) => document.status === "proximo");
  const checkedIn = ["en_curso", "finalizado"].includes(service.clock_state);
  const checkedOut = service.clock_state === "finalizado";
  const locationReady = hasUsableEventCoordinates(service);
  const items = [
    {
      key: "confirmed",
      label: "Asistencia confirmada",
      status: service.assignment_status === "confirmado" ? "done" : "pending",
      detail: service.assignment_status === "confirmado" ? "Servicio confirmado" : "Confirma asistencia antes del servicio"
    },
    {
      key: "documents",
      label: docBlockers.length ? "Documentacion pendiente" : docWarnings.length ? "Documentacion con aviso" : "Documentacion OK",
      status: docBlockers.length ? "pending" : docWarnings.length ? "warning" : "done",
      detail: docBlockers.length
        ? `${docBlockers.length} documento(s) por revisar`
        : docWarnings.length
          ? `${docWarnings.length} documento(s) proximos a caducar`
          : "Sin bloqueos documentales"
    },
    {
      key: "location",
      label: locationReady ? "Ubicacion del recinto lista" : "Ubicacion pendiente",
      status: locationReady ? "done" : "pending",
      detail: locationReady ? service.location : "Falta ubicacion GPS real del evento"
    },
    {
      key: "clock_in",
      label: checkedIn ? "Entrada registrada" : "Entrada pendiente",
      status: checkedIn ? "done" : "pending",
      detail: checkedIn ? "Fichaje de entrada completado" : "Ficha entrada al llegar al recinto"
    },
    {
      key: "clock_out",
      label: checkedOut ? "Salida registrada" : "Salida pendiente",
      status: checkedOut ? "done" : "pending",
      detail: checkedOut ? "Servicio cerrado por tu parte" : "Ficha salida al finalizar"
    }
  ];
  if (Number(service.is_team_leader || 0)) {
    items.push({
      key: "client_signature",
      label: Number(service.delivery_note_locked || 0) ? "Firma cliente completada" : "Firma cliente pendiente",
      status: Number(service.delivery_note_locked || 0) ? "done" : "pending",
      detail: Number(service.delivery_note_locked || 0)
        ? "Albaran firmado y bloqueado"
        : "Recoge firma del cliente al fichar salida"
    });
  }
  const completed = items.filter((item) => item.status === "done").length;
  return {
    completed,
    total: items.length,
    percent: items.length ? Math.round((completed / items.length) * 100) : 0,
    items
  };
}

function clockSequenceError(event, assignment, employeeId, type, policy = clockPolicy()) {
  const entries = all(
    `SELECT * FROM time_entries
     WHERE event_id = ? AND employee_id = ?
     ORDER BY timestamp DESC`,
    [event.id, employeeId]
  );
  const progress = clockProgress(event, assignment, entries, policy);
  if (type === "entrada" && !progress.canClockIn) {
    return progress.state === "en_curso" ? "Entrada ya registrada" : "Servicio ya finalizado para este operario";
  }
  if (type === "salida" && !progress.canClockOut) {
    return progress.state === "finalizado" ? "Salida ya registrada" : "Primero debes fichar entrada";
  }
  return null;
}

function livePayload(date = formatDate(), attendanceDetection = null) {
  const events = listEvents({ from: date, to: date });
  const enrichedEvents = events.map((event) => {
    const incidents = all(
      `SELECT incidents.*, employees.name AS employee_name
       FROM incidents
       LEFT JOIN employees ON employees.id = incidents.employee_id
       WHERE incidents.event_id = ? AND incidents.status = 'abierta'
       ORDER BY CASE priority WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END, incidents.created_at DESC`,
      [event.id]
    );
    const staff = (event.assignments || []).map((assignment) => {
      const entries = all(
        `SELECT * FROM time_entries
         WHERE event_id = ? AND employee_id = ?
         ORDER BY timestamp DESC`,
        [event.id, assignment.employee_id]
      );
      const lastEntry = entries[0] || null;
      const state = liveClockState(event, assignment, entries);
      const employeeIncidents = incidents.filter((incident) => incident.employee_id === assignment.employee_id);
      return {
        id: assignment.id,
        employeeId: assignment.employee_id,
        name: assignment.name,
        role: assignment.role,
        phone: assignment.phone,
        email: assignment.email,
        assignmentStatus: assignment.status,
        clockState: state,
        lastEntry,
        incidents: employeeIncidents,
        issues: assignment.issues || []
      };
    });
    const counts = {
      staff: staff.filter((item) => item.assignmentStatus !== "bloqueado").length,
      inProgress: staff.filter((item) => item.clockState === "en_curso").length,
      finished: staff.filter((item) => item.clockState === "finalizado").length,
      late: staff.filter((item) => item.clockState === "tarde").length,
      blocked: staff.filter((item) => item.assignmentStatus === "bloqueado").length,
      openIncidents: incidents.length,
      missing: Math.max(Number(event.required_total || 0) - staff.filter((item) => item.assignmentStatus !== "bloqueado").length, 0)
    };
    const operationalStatus =
      event.status === "finalizado" ? "finalizado" :
      counts.openIncidents ? "incidencias" :
      counts.late ? "tarde" :
      counts.missing ? "falta_personal" :
      counts.inProgress ? "en_curso" :
      "pendiente";
    return { ...event, staff, liveCounts: counts, liveStatus: operationalStatus, liveIncidents: incidents };
  });

  const cards = [
    { label: "Eventos hoy", value: enrichedEvents.length, hint: date, tone: "blue" },
    { label: "Operarios en curso", value: enrichedEvents.reduce((sum, event) => sum + event.liveCounts.inProgress, 0), hint: "Con entrada aceptada", tone: "green" },
    { label: "Tarde / sin fichar", value: enrichedEvents.reduce((sum, event) => sum + event.liveCounts.late, 0), hint: "Requieren llamada", tone: "red" },
    { label: "Incidencias abiertas", value: enrichedEvents.reduce((sum, event) => sum + event.liveCounts.openIncidents, 0), hint: "En eventos de hoy", tone: "amber" },
    { label: "Falta personal", value: enrichedEvents.reduce((sum, event) => sum + event.liveCounts.missing, 0), hint: "Puestos por cubrir", tone: "dark" }
  ];

  return {
    date,
    cards,
    events: enrichedEvents,
    alerts: buildAlerts(enrichedEvents),
    attendanceDetection,
    updatedAt: new Date().toISOString()
  };
}

function eventDetail(eventId) {
  const event = enrichEvent(
    get(
      `SELECT events.*, clients.name AS client_name, employees.name AS team_leader_name
       FROM events
       JOIN clients ON clients.id = events.client_id
       LEFT JOIN employees ON employees.id = events.team_leader_id
       WHERE events.id = ?`,
      [eventId]
    )
  );
  if (!event) return null;
  event.requirements = all("SELECT role, count FROM event_requirements WHERE event_id = ? ORDER BY role", [
    eventId
  ]);
  event.assignments = assignmentRowsForEvent(event);
  event.timeEntries = all(
    `SELECT time_entries.*, employees.name AS employee_name
     FROM time_entries
     JOIN employees ON employees.id = time_entries.employee_id
     WHERE time_entries.event_id = ?
     ORDER BY time_entries.timestamp DESC`,
    [eventId]
  );
  event.incidents = all("SELECT * FROM incidents WHERE event_id = ? ORDER BY created_at DESC", [eventId]);
  event.deliveryNote = get("SELECT * FROM delivery_notes WHERE event_id = ?", [eventId]) || null;
  event.allowances = listAllowances({ eventId });
  event.documents = listEventDocuments({ eventId });
  return event;
}

function eventDetailByGoogleUid(googleUid) {
  const row = get("SELECT id FROM events WHERE google_calendar_uid = ?", [googleUid]);
  return row ? eventDetail(row.id) : null;
}

const ROLE_DOCUMENT_REQUIREMENTS = [
  {
    roleIncludes: ["carretill"],
    documentIncludes: ["carretill"],
    label: "certificado/carnet de carretillero"
  }
];

function roleDocumentRequirementIssue(targetRole, documents = []) {
  const targetRoleKey = roleKey(targetRole);
  const requirement = ROLE_DOCUMENT_REQUIREMENTS.find((item) =>
    item.roleIncludes.some((fragment) => targetRoleKey.includes(fragment))
  );
  if (!requirement) return null;
  const matches = documents.filter((document) => {
    const haystack = roleKey(`${document.type || ""} ${document.name || ""}`);
    return requirement.documentIncludes.some((fragment) => haystack.includes(fragment));
  });
  const valid = matches.find((document) => ["vigente", "proximo"].includes(document.status));
  if (!valid) {
    return {
      type: "documentacion",
      severity: "block",
      message: `Falta ${requirement.label} vigente para rol ${targetRole}`
    };
  }
  if (valid.status === "proximo") {
    return {
      type: "documentacion",
      severity: "warning",
      message: `${valid.type} vence en ${valid.days_to_expiry} dias`
    };
  }
  return null;
}

function validateAssignment(event, employee, targetRole = null) {
  const employeeId = employee.id || employee.employee_id;
  const assignmentRole = targetRole || employee.role || employee.assignment_role || employee.employee_role || "Operario";
  const issues = [];
  const currentRange = eventClockRange(event);
  const existing = all(
    `SELECT events.*
     FROM assignments
     JOIN events ON events.id = assignments.event_id
     WHERE assignments.employee_id = ? AND assignments.status != 'bloqueado'
       AND events.date BETWEEN ? AND ? AND events.id != ?`,
    [employeeId, addIsoDays(event.date, -1), addIsoDays(event.date, 1), event.id]
  );
  for (const other of existing) {
    const otherRange = eventClockRange(other);
    if (dateRangesOverlap(currentRange, otherRange)) {
      issues.push({ type: "solape", severity: "block", message: `Solape con ${other.name}` });
      continue;
    }
    const rest = restHoursBetweenRanges(currentRange, otherRange);
    if (rest < 10) {
      issues.push({
        type: "descanso",
        severity: "warning",
        message: `Descanso inferior a 10 horas con ${other.name}`
      });
    }
  }

  const dateSpan = eventDateSpan(event);
  const unavailable = get(
    `SELECT * FROM availability
     WHERE employee_id = ?
       AND status != 'rechazado'
       AND start_date <= ?
       AND end_date >= ?
     ORDER BY CASE status WHEN 'aprobado' THEN 1 WHEN 'solicitado' THEN 2 ELSE 3 END
     LIMIT 1`,
    [employeeId, dateSpan.endDate, dateSpan.startDate]
  );
  if (unavailable?.status === "aprobado") {
    issues.push({ type: "disponibilidad", severity: "block", message: `No disponible: ${cleanAvailabilityType(unavailable.type)}` });
  } else if (unavailable?.status === "solicitado") {
    issues.push({ type: "disponibilidad", severity: "warning", message: `Disponibilidad solicitada pendiente: ${cleanAvailabilityType(unavailable.type)}` });
  }

  const documents = listDocuments({ employeeId });
  const roleDocumentIssue = roleDocumentRequirementIssue(assignmentRole, documents);
  if (roleDocumentIssue?.severity === "block") {
    issues.push(roleDocumentIssue);
  }
  const blockingDoc = documents.find((document) => ["caducado", "pendiente"].includes(document.status));
  if (blockingDoc) {
    issues.push({
      type: "documentacion",
      severity: "block",
      message: blockingDoc.status === "pendiente" ? `${blockingDoc.type} pendiente` : `${blockingDoc.type} caducado`
    });
  } else {
    const soonDoc = roleDocumentIssue?.severity === "warning"
      ? null
      : documents.find((document) => document.status === "proximo");
    if (soonDoc) {
      issues.push({
        type: "documentacion",
        severity: "warning",
        message: `${soonDoc.type} vence en ${soonDoc.days_to_expiry} dias`
      });
    }
  }
  if (roleDocumentIssue?.severity === "warning" && !issues.some((issue) => issue.message === roleDocumentIssue.message)) {
    issues.push(roleDocumentIssue);
  }

  return issues;
}

function toMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function dateRangesOverlap(a, b) {
  return Math.max(a.start.getTime(), b.start.getTime()) < Math.min(a.end.getTime(), b.end.getTime());
}

function restHoursBetweenRanges(a, b) {
  const gapMs = a.start.getTime() >= b.end.getTime()
    ? a.start.getTime() - b.end.getTime()
    : b.start.getTime() - a.end.getTime();
  return Math.max(gapMs, 0) / 3_600_000;
}

function roleKey(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleFitForEmployee(employee, targetRoles) {
  const employeeRoleKey = roleKey(employee.role);
  const skillKeys = (employee.skills || []).map(roleKey);
  const exact = targetRoles.find((role) => roleKey(role.role) === employeeRoleKey);
  if (exact) return { role: exact.role, fit: "rol exacto", bonus: 25 };
  const skill = targetRoles.find((role) => skillKeys.some((item) => item && (item === roleKey(role.role) || roleKey(role.role).includes(item) || item.includes(roleKey(role.role)))));
  if (skill) return { role: skill.role, fit: "skill compatible", bonus: 18 };
  return { role: targetRoles[0]?.role || employee.role, fit: "cobertura general", bonus: 0 };
}

function missingEventRoles(eventId) {
  const requirements = all("SELECT role, count FROM event_requirements WHERE event_id = ? ORDER BY role", [eventId]);
  const assignedRows = all(
    "SELECT role, COUNT(*) AS count FROM assignments WHERE event_id = ? AND status != 'bloqueado' GROUP BY role",
    [eventId]
  );
  const assignedByRole = new Map(assignedRows.map((row) => [roleKey(row.role), Number(row.count || 0)]));
  const missing = requirements
    .map((requirement) => ({
      role: requirement.role,
      missing: Math.max(Number(requirement.count || 0) - Number(assignedByRole.get(roleKey(requirement.role)) || 0), 0)
    }))
    .filter((role) => role.missing > 0);
  return missing.length ? missing : requirements.map((requirement) => ({ role: requirement.role, missing: 0 }));
}

function plannerRecommendations(eventId) {
  const event = get("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return [];
  const targetRoles = missingEventRoles(eventId);
  const assigned = new Set(
    all("SELECT employee_id FROM assignments WHERE event_id = ?", [eventId]).map((row) => row.employee_id)
  );
  return all("SELECT * FROM employees WHERE status = 'activo' ORDER BY name").map(parseEmployee).map((employee) => {
    const roleFit = roleFitForEmployee(employee, targetRoles);
    const issues = validateAssignment(event, employee, roleFit.role);
    const distance = isInsideRadius(employee.lat || event.lat, employee.lng || event.lng, event.lat, event.lng, 50_000).distance;
    const hours = get(
      `SELECT COALESCE(SUM(
        CASE WHEN events.end_time > events.start_time
          THEN (strftime('%s', events.date || ' ' || events.end_time) - strftime('%s', events.date || ' ' || events.start_time)) / 3600.0
          ELSE 8
        END
      ), 0) AS total
       FROM assignments
       JOIN events ON events.id = assignments.event_id
      WHERE assignments.employee_id = ? AND events.date >= date('now', '-30 day')`,
      [employee.id]
    ).total;
    const noteMatch = employee.skills.some((skill) => event.notes?.toLowerCase().includes(String(skill).toLowerCase()));
    let score = 80;
    score += roleFit.bonus;
    score += noteMatch ? 5 : 0;
    score -= Math.min(Math.round(distance / 1000), 25);
    score -= Math.min(Math.round(hours / 8), 15);
    score -= issues.some((issue) => issue.severity === "block") ? 80 : 0;
    score -= issues.filter((issue) => issue.severity === "warning").length * 8;
    score -= assigned.has(employee.id) ? 50 : 0;
    return {
      employee,
      score: Math.max(score, 0),
      distance,
      assigned: assigned.has(employee.id),
      suggestedRole: roleFit.role,
      roleFit: roleFit.fit,
      recentHours: Math.round(Number(hours || 0) * 10) / 10,
      issues
    };
  }).sort((a, b) => b.score - a.score);
}

function createCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => escape(row[header])).join(";"))].join("\n");
}

function createExcelXml(rows, sheetName = "Eventos") {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const xmlEscape = (value) => escHtml(value).replaceAll("\n", " ");
  const cell = (value) => {
    const numeric = typeof value === "number" && Number.isFinite(value);
    return `<Cell><Data ss:Type="${numeric ? "Number" : "String"}">${xmlEscape(value ?? "")}</Data></Cell>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${xmlEscape(sheetName)}">
    <Table>
      <Row>${headers.map((header) => cell(header)).join("")}</Row>
      ${rows.map((row) => `<Row>${headers.map((header) => cell(row[header])).join("")}</Row>`).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function foldIcsLine(line) {
  const chunks = [];
  let text = String(line);
  while (text.length > 74) {
    chunks.push(text.slice(0, 74));
    text = ` ${text.slice(74)}`;
  }
  chunks.push(text);
  return chunks.join("\r\n");
}

function icsEscape(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function icsDateTime(date, time) {
  return `${String(date || "").replaceAll("-", "")}T${String(time || "00:00").replace(":", "")}00`;
}

function appOriginFromRequest(req) {
  const firstHeaderValue = (value) => String(value || "").split(",")[0].trim();
  const protocol = firstHeaderValue(req.headers["x-forwarded-proto"]) || "http";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || firstHeaderValue(req.headers.host) || "localhost";
  return `${protocol}://${host}`;
}

function safeBrowserOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || "";
}

function requestUserAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 300);
}

function assignmentSummary(assignments = []) {
  const active = assignments.filter((assignment) => assignment.status !== "bloqueado");
  if (!active.length) return "Sin personal asignado";
  return active.map((assignment) => `${assignment.name} (${assignment.role})`).join(", ");
}

function createMarfanCalendarIcs(events, origin = "https://marfancrew.local") {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MARFAN CREW ERP//Calendario Operativo//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:MARFAN CREW ERP",
    "X-WR-TIMEZONE:Europe/Madrid"
  ];
  for (const event of events) {
    const description = [
      `Cliente: ${event.client_name || ""}`,
      `Estado: ${event.status || ""}`,
      `Jefe de equipo: ${event.team_leader_name || "Pendiente"}`,
      `Personal: ${assignmentSummary(event.assignments)}`,
      `Requerido: ${event.required_total || 0}`,
      `Notas: ${event.notes || ""}`,
      `Ficha interna: ${origin}/#evento-${event.id}`
    ].join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@marfancrew-erp`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Madrid:${icsDateTime(event.date, event.start_time)}`,
      `DTEND;TZID=Europe/Madrid:${icsDateTime(event.date, event.end_time)}`,
      `SUMMARY:${icsEscape(event.name)}`,
      `LOCATION:${icsEscape(event.address || event.location || "")}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `STATUS:${event.status === "finalizado" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function upsertGoogleCalendarClient() {
  const id = "cli_google_calendar";
  run(
    `INSERT OR IGNORE INTO clients (id, name, legal_name, contact_name, email, phone, address, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      "Google Calendar",
      "Google Calendar",
      "Importacion calendario",
      "",
      "",
      "",
      "Cliente tecnico para eventos importados desde Google Calendar."
    ]
  );
  return id;
}

function importGoogleCalendarEvent(body, actor) {
  const googleUid = String(body.googleUid || body.id || "").trim();
  if (!googleUid) {
    const error = new Error("Identificador Google obligatorio");
    error.status = 400;
    throw error;
  }
  const existing = eventDetailByGoogleUid(googleUid);
  if (existing) return { event: existing, created: false };

  const clientId = upsertGoogleCalendarClient();
  const id = randomId("evt");
  const date = body.date || formatDate();
  const startTime = body.startTime || body.start_time || "09:00";
  const endTime = body.endTime || body.end_time || addTime(startTime, 2);
  const location = body.location || "Ubicacion pendiente";
  const coords = eventCoordinatesFromBody(
    { ...body, googleMapsUrl: body.googleMapsUrl || body.google_maps_url || "" },
    { manualSource: "google_calendar" }
  );
  const lat = coords.lat;
  const lng = coords.lng;
  const pricing = calculateServicePricing({
    startTime,
    endTime,
    lat,
    lng,
    requirements: [],
    vehicleCount: 1
  });

  run(
    `INSERT INTO events
      (id, name, client_id, date, start_time, end_time, location, address, lat, lng, team_leader_id,
       required_total, status, notes, budget, google_maps_url, vehicle_count, base_distance_km, billable_km,
       kilometre_price, role_price_total, night_price_total, distance_price_total, service_price,
       google_calendar_uid, google_calendar_source, google_calendar_event_id, google_sync_status, location_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      body.name || "Evento Google",
      clientId,
      date,
      startTime,
      endTime,
      location,
      body.address || location,
      lat,
      lng,
      null,
      0,
      "sin_jefe",
      [body.notes || "", "Importado desde Google Calendar. Completa ubicacion, equipo necesario y personal asignado en MARFAN."].filter(Boolean).join("\n\n"),
      0,
      body.googleMapsUrl || "",
      1,
      pricing.baseDistanceKm,
      pricing.billableKm,
      pricing.kilometrePrice,
      pricing.rolePriceTotal,
      pricing.nightPriceTotal,
      pricing.distancePriceTotal,
      pricing.servicePrice,
      googleUid,
      body.source || "google",
      body.googleEventId || body.google_event_id || null,
      "imported",
      coords.source
    ]
  );
  ensureDraftDeliveryNote({ id, service_price: pricing.servicePrice, budget: 0 });
  audit(actor, "google_event_imported", "event", id, { googleUid, source: body.source || "google" });
  createEventSnapshot(id, "google_event_imported", actor, { googleUid, source: body.source || "google" });
  return { event: eventDetail(id), created: true };
}

function unfoldIcs(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{8}$/.test(raw)) {
    return { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, time: "00:00" };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!match) return null;
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` };
}

function parseIcsEvents(text) {
  const unfolded = unfoldIcs(text);
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks.map((block, index) => {
    const props = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).split(";")[0].toUpperCase();
      const value = line.slice(separator + 1)
        .replaceAll("\\n", "\n")
        .replaceAll("\\,", ",")
        .replaceAll("\\;", ";")
        .replaceAll("\\\\", "\\");
      props[key] = value;
    }
    const start = parseIcsDate(props.DTSTART);
    if (!start) return null;
    const end = parseIcsDate(props.DTEND) || { date: start.date, time: start.time };
    return {
      id: `google_${Buffer.from(props.UID || `${props.SUMMARY || "evento"}_${index}`).toString("base64url").slice(0, 36)}`,
      google_uid: props.UID || "",
      google_event_id: "",
      source: "google",
      external: true,
      name: props.SUMMARY || "Evento Google",
      client_name: "Google Calendar",
      date: start.date,
      start_time: start.time,
      end_time: end.time,
      location: props.LOCATION || "",
      address: props.LOCATION || "",
      notes: props.DESCRIPTION || "",
      status: "google",
      required_total: 0,
      assigned_count: 0,
      clocked_count: 0,
      incident_count: 0,
      service_price: 0,
      budget: 0,
      finance: { cost: 0, benefit: 0, margin: 0 }
    };
  }).filter(Boolean);
}

function googleCalendarIcsUrl(settings) {
  const explicit = String(settings.google_calendar_public_ics_url || "").trim();
  if (explicit.includes("/calendar/ical/")) return explicit;
  const embed = explicit.includes("/calendar/embed") ? explicit : String(settings.google_calendar_embed_url || "").trim();
  if (embed) {
    try {
      const parsed = new URL(embed);
      const src = parsed.searchParams.get("src");
      if (src) return googlePublicIcsUrl(src);
    } catch {}
  }
  return googlePublicIcsUrl(settings.google_calendar_id || DEFAULT_GOOGLE_CALENDAR_ID);
}

function googleDateParts(value, fallbackDate = "") {
  const raw = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, time: "00:00" };
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return { date: fallbackDate, time: "00:00" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function googleApiDateBound(date, endOfDay = false) {
  if (!date) return null;
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}+01:00`;
}

function googleApiEventToCalendarEvent(item, index = 0) {
  const start = googleDateParts(item.start?.dateTime || item.start?.date);
  const end = googleDateParts(item.end?.dateTime || item.end?.date, start.date);
  return {
    id: `google_${Buffer.from(item.id || item.iCalUID || `${item.summary || "evento"}_${index}`).toString("base64url").slice(0, 36)}`,
    google_uid: item.iCalUID || item.id || "",
    google_event_id: item.id || "",
    source: "google",
    external: true,
    name: item.summary || "Evento Google",
    client_name: "Google Calendar",
    date: start.date,
    start_time: start.time,
    end_time: end.time,
    location: item.location || "",
    address: item.location || "",
    notes: item.description || "",
    status: "google",
    required_total: 0,
    assigned_count: 0,
    clocked_count: 0,
    incident_count: 0,
    service_price: 0,
    budget: 0,
    finance: { cost: 0, benefit: 0, margin: 0 }
  };
}

function googleCalendarAuthenticatedApiAvailable(settings) {
  const oauthRefreshToken = String(settings.google_calendar_oauth_refresh_token || process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim();
  const oauthClient = googleOAuthClientCredentials(settings);
  const serviceCredentials = googleServiceAccountCredentials(settings);
  return Boolean((oauthRefreshToken && oauthClient) || serviceCredentials);
}

async function googleCalendarApiEvents(settings, { from, to } = {}) {
  const apiKey = String(settings.google_calendar_api_key || "").trim();
  const calendarId = String(settings.google_calendar_id || DEFAULT_GOOGLE_CALENDAR_ID).trim();
  const useAuthenticatedApi = googleCalendarAuthenticatedApiAvailable(settings);
  if ((!apiKey && !useAuthenticatedApi) || !calendarId) return null;
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
    timeZone: "Europe/Madrid"
  });
  const headers = {};
  if (useAuthenticatedApi) {
    headers.authorization = `Bearer ${await googleCalendarAccessToken(settings)}`;
  } else {
    params.set("key", apiKey);
  }
  const min = googleApiDateBound(from);
  const max = googleApiDateBound(to, true);
  if (min) params.set("timeMin", min);
  if (max) params.set("timeMax", max);
  const sourceUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(`${sourceUrl}?${params}`, { headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Calendar API ${response.status}${detail ? `: ${detail.slice(0, 140)}` : ""}`);
  }
  const payload = await response.json();
  const events = (payload.items || []).map(googleApiEventToCalendarEvent).filter((event) => event.date);
  return { events, status: useAuthenticatedApi ? "connected_oauth" : "connected_api", sourceUrl };
}

async function googleCalendarEvents({ from, to } = {}) {
  const settings = settingMap();
  const enabled = String(settings.google_calendar_enabled ?? "true") !== "false";
  if (!enabled) return { events: [], status: "disabled" };
  try {
    const apiResult = await googleCalendarApiEvents(settings, { from, to });
    if (apiResult) return apiResult;
  } catch (error) {
    return {
      events: [],
      status: "api_error",
      error: error.message,
      sourceUrl: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.google_calendar_id || DEFAULT_GOOGLE_CALENDAR_ID)}/events`
    };
  }
  const url = googleCalendarIcsUrl(settings);
  if (!url) return { events: [], status: "not_configured" };
  try {
    const response = await fetch(url, { headers: { "user-agent": "MARFAN-CREW-ERP/1.0" } });
    if (!response.ok) {
      if (response.status === 404 && settings.google_calendar_embed_url) {
        return {
          events: [],
          status: "embed_only",
          message: "Google permite ver el iframe, pero no expone un iCal publico. Pega una API key o la URL iCal secreta para mostrar eventos como tarjetas.",
          sourceUrl: url
        };
      }
      throw new Error(`Google Calendar ${response.status}`);
    }
    let events = parseIcsEvents(await response.text());
    if (from) events = events.filter((event) => event.date >= from);
    if (to) events = events.filter((event) => event.date <= to);
    return { events, status: "connected", sourceUrl: url };
  } catch (error) {
    return { events: [], status: "error", error: error.message, sourceUrl: url };
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseServiceAccountJson(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const jsonText = raw.startsWith("{") ? raw : fs.existsSync(path.resolve(raw)) ? fs.readFileSync(path.resolve(raw), "utf8") : raw;
  const parsed = JSON.parse(jsonText);
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replaceAll("\\n", "\n");
  return parsed;
}

function googleServiceAccountCredentials(settings = settingMap(), options = {}) {
  try {
    const fromJson = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || settings.google_calendar_service_account_json);
    const credentials = fromJson || {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || settings.google_calendar_service_account_email,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || settings.google_calendar_service_account_private_key,
      private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID || settings.google_calendar_service_account_private_key_id,
      token_uri: process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI || GOOGLE_OAUTH_TOKEN_URL
    };
    if (credentials.private_key) credentials.private_key = String(credentials.private_key).replaceAll("\\n", "\n");
    if (!credentials.client_email || !credentials.private_key) return null;
    return {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
      private_key_id: credentials.private_key_id || "",
      token_uri: credentials.token_uri || GOOGLE_OAUTH_TOKEN_URL
    };
  } catch (error) {
    if (options.throwOnInvalid) throw Object.assign(new Error("Credencial de Google Calendar no valida"), { cause: error });
    return null;
  }
}

function parseGoogleOAuthClientJson(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const jsonText = raw.startsWith("{") ? raw : fs.existsSync(path.resolve(raw)) ? fs.readFileSync(path.resolve(raw), "utf8") : raw;
  const parsed = JSON.parse(jsonText);
  const client = parsed.installed || parsed.web || parsed;
  if (!client.client_id) return null;
  return {
    client_id: client.client_id,
    client_secret: client.client_secret || "",
    auth_uri: client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth",
    token_uri: client.token_uri || GOOGLE_OAUTH_TOKEN_URL,
    redirect_uris: client.redirect_uris || [],
    client_type: parsed.web ? "web" : parsed.installed ? "installed" : "manual"
  };
}

function googleOAuthClientCredentials(settings = settingMap(), options = {}) {
  try {
    const fromJson = parseGoogleOAuthClientJson(process.env.GOOGLE_OAUTH_CLIENT_JSON || settings.google_calendar_oauth_client_json);
    const credentials = fromJson || {
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || settings.google_calendar_oauth_client_id,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || settings.google_calendar_oauth_client_secret,
      auth_uri: "https://accounts.google.com/o/oauth2/v2/auth",
      token_uri: GOOGLE_OAUTH_TOKEN_URL,
      redirect_uris: [],
      client_type: "manual"
    };
    if (!credentials.client_id) return null;
    return credentials;
  } catch (error) {
    if (options.throwOnInvalid) throw Object.assign(new Error("Cliente OAuth de Google no valido"), { cause: error });
    return null;
  }
}

function googleSyncEnabled(settings) {
  return String(settings.google_calendar_enabled ?? "true") !== "false"
    && String(settings.google_calendar_sync_enabled ?? "true") !== "false";
}

async function googleCalendarAccessToken(settings) {
  const oauthRefreshToken = String(settings.google_calendar_oauth_refresh_token || process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim();
  const oauthClient = googleOAuthClientCredentials(settings);
  if (oauthRefreshToken && oauthClient) {
    return googleOAuthAccessToken(settings, oauthClient, oauthRefreshToken);
  }
  const serviceCredentials = googleServiceAccountCredentials(settings);
  if (oauthClient && !oauthRefreshToken && !serviceCredentials) {
    const error = new Error("Google Calendar OAuth pendiente de conectar");
    error.status = "pending_auth";
    throw error;
  }

  const credentials = serviceCredentials || googleServiceAccountCredentials(settings, { throwOnInvalid: true });
  if (!credentials) {
    const error = new Error("Falta conectar Google Calendar o configurar una cuenta de servicio");
    error.status = "pending_auth";
    throw error;
  }
  const delegatedUser = String(settings.google_calendar_delegated_user || process.env.GOOGLE_CALENDAR_DELEGATED_USER || "").trim();
  const cacheKey = `${credentials.client_email}:${credentials.private_key_id}:${delegatedUser}`;
  if (googleAccessTokenCache?.key === cacheKey && googleAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return googleAccessTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || GOOGLE_OAUTH_TOKEN_URL;
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {})
  };
  const payload = {
    iss: credentials.client_email,
    scope: GOOGLE_CALENDAR_EVENTS_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    ...(delegatedUser ? { sub: delegatedUser } : {})
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${body.error_description || body.error || "sin detalle"}`);
  }
  googleAccessTokenCache = {
    key: cacheKey,
    token: body.access_token,
    expiresAt: Date.now() + Math.max(Number(body.expires_in || 3600) - 60, 60) * 1000
  };
  return body.access_token;
}

async function googleOAuthAccessToken(settings, client, refreshToken) {
  const cacheKey = `oauth:${client.client_id}:${crypto.createHash("sha256").update(refreshToken).digest("hex")}`;
  if (googleAccessTokenCache?.key === cacheKey && googleAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return googleAccessTokenCache.token;
  }
  const response = await fetch(client.token_uri || GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${body.error_description || body.error || "sin detalle"}`);
  }
  googleAccessTokenCache = {
    key: cacheKey,
    token: body.access_token,
    expiresAt: Date.now() + Math.max(Number(body.expires_in || 3600) - 60, 60) * 1000
  };
  return body.access_token;
}

async function exchangeGoogleOAuthCode(client, code, codeVerifier, redirectUri) {
  const response = await fetch(client.token_uri || GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${body.error_description || body.error || "sin detalle"}`);
  }
  if (!body.refresh_token) {
    throw new Error("Google no ha devuelto refresh token. Repite la conexion aceptando permisos.");
  }
  return body;
}

function storeGoogleOAuthTokens(tokens) {
  transaction(() => {
    run(
      `INSERT INTO company_settings (key, value, updated_at)
       VALUES ('google_calendar_oauth_refresh_token', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [tokens.refresh_token]
    );
    run(
      `INSERT INTO company_settings (key, value, updated_at)
       VALUES ('google_calendar_oauth_connected_at', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [new Date().toISOString()]
    );
  });
  googleAccessTokenCache = null;
}

function oauthSuccessPage(appUrl) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Google Calendar conectado</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#111827}.box{max-width:520px;background:white;border:1px solid #e5e7eb;border-radius:14px;padding:28px;box-shadow:0 24px 60px rgba(15,23,42,.12)}a{display:inline-block;margin-top:18px;background:#111827;color:white;text-decoration:none;padding:12px 16px;border-radius:10px}</style></head><body><main class="box"><h1>Google Calendar conectado</h1><p>MARFAN ya puede crear y actualizar eventos en Google Calendar cuando guardes cambios.</p><a href="${escHtml(appUrl)}">Volver a MARFAN</a></main></body></html>`;
}

function oauthErrorPage(message, appUrl) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Error Google Calendar</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fff7ed;color:#111827}.box{max-width:560px;background:white;border:1px solid #fed7aa;border-radius:14px;padding:28px;box-shadow:0 24px 60px rgba(154,52,18,.14)}code{display:block;white-space:pre-wrap;background:#fff7ed;padding:12px;border-radius:10px}a{display:inline-block;margin-top:18px;background:#111827;color:white;text-decoration:none;padding:12px 16px;border-radius:10px}</style></head><body><main class="box"><h1>No se pudo conectar Google</h1><code>${escHtml(message)}</code><a href="${escHtml(appUrl)}">Volver a MARFAN</a></main></body></html>`;
}

function createGoogleOAuthAuthorizationUrl({ client, redirectUri, state, codeChallenge }) {
  const authUrl = new URL(client.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_CALENDAR_EVENTS_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  return authUrl.toString();
}

function googleOAuthRedirectUris(client) {
  return (client?.redirect_uris || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function googleOAuthSuggestedRedirectUris(redirectUri) {
  const suggestions = new Set();
  const addOrigin = (origin) => {
    const cleanOrigin = String(origin || "").replace(/\/+$/, "");
    if (cleanOrigin) suggestions.add(`${cleanOrigin}/api/calendar/google-oauth/callback`);
  };
  addOrigin(String(redirectUri || "").replace(/\/api\/calendar\/google-oauth\/callback$/, ""));
  try {
    const parsed = new URL(redirectUri);
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      addOrigin(parsed.origin);
    } else if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      addOrigin(parsed.origin);
    }
  } catch {}
  for (const domain of [
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
    process.env.PUBLIC_URL,
    process.env.APP_URL
  ]) {
    if (!domain) continue;
    const value = String(domain).trim();
    addOrigin(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
  }
  return Array.from(suggestions);
}

function assertGoogleOAuthRedirectAllowed(client, redirectUri) {
  const authorizedRedirectUris = googleOAuthRedirectUris(client);
  const suggestedRedirectUris = googleOAuthSuggestedRedirectUris(redirectUri);
  if (client?.client_type === "installed") {
    const error = new Error(
      "El cliente OAuth cargado es de tipo Desktop/Installed. Para MARFAN crea un cliente OAuth tipo Web application y autoriza la URI de retorno exacta."
    );
    error.status = 409;
    error.code = "google_oauth_client_type_invalid";
    error.redirectUri = redirectUri;
    error.authorizedRedirectUris = authorizedRedirectUris;
    error.suggestedRedirectUris = suggestedRedirectUris;
    error.clientType = client?.client_type || "";
    throw error;
  }
  if (!authorizedRedirectUris.length) {
    const error = new Error(
      "El cliente OAuth no incluye Authorized redirect URIs. Pega en MARFAN el JSON de un cliente OAuth tipo Web application con la URI de retorno autorizada."
    );
    error.status = 409;
    error.code = "google_redirect_uri_missing";
    error.redirectUri = redirectUri;
    error.authorizedRedirectUris = authorizedRedirectUris;
    error.suggestedRedirectUris = suggestedRedirectUris;
    error.clientType = client?.client_type || "";
    throw error;
  }
  if (authorizedRedirectUris.includes(redirectUri)) {
    return { authorizedRedirectUris, ok: true };
  }
  const error = new Error(
    `Google no tiene autorizada esta URI de retorno: ${redirectUri}. En Google Cloud crea un cliente OAuth tipo Web application o anade esa URI exacta en Authorized redirect URIs.`
  );
  error.status = 409;
  error.code = "google_redirect_uri_mismatch";
  error.redirectUri = redirectUri;
  error.authorizedRedirectUris = authorizedRedirectUris;
  error.suggestedRedirectUris = suggestedRedirectUris;
  error.clientType = client?.client_type || "";
  throw error;
}

function startGoogleOAuthWebFlow({ client, actor, appUrl, redirectUri }) {
  const state = randomToken();
  const codeVerifier = randomToken() + randomToken();
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const timeout = setTimeout(() => googleOauthStates.delete(state), 10 * 60 * 1000);
  googleOauthStates.set(state, {
    actorId: actor?.id || null,
    appUrl,
    clientId: client.client_id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
    redirectUri,
    timeout
  });
  const authUrl = createGoogleOAuthAuthorizationUrl({ client, redirectUri, state, codeChallenge });
  return { authUrl, redirectUri };
}

async function handleGoogleOAuthCallback(req, res, url) {
  const state = url.searchParams.get("state") || "";
  const expected = googleOauthStates.get(state);
  const appUrl = expected?.appUrl || appOriginFromRequest(req);
  const actor = expected?.actorId ? { id: expected.actorId } : null;
  try {
    if (!expected || expected.expiresAt < Date.now()) {
      throw new Error("Estado OAuth caducado o no valido");
    }
    if (url.searchParams.get("error")) {
      throw new Error(url.searchParams.get("error_description") || url.searchParams.get("error"));
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google no devolvio codigo de autorizacion");
    const settings = settingMap();
    const client = googleOAuthClientCredentials(settings, { throwOnInvalid: true });
    if (!client || client.client_id !== expected.clientId) {
      throw new Error("Cliente OAuth de Google no coincide con la solicitud inicial");
    }
    const tokens = await exchangeGoogleOAuthCode(client, code, expected.codeVerifier, expected.redirectUri);
    storeGoogleOAuthTokens(tokens);
    audit(actor, "google_calendar_oauth_connected", "company_settings", "google_calendar", {
      clientId: client.client_id,
      redirectUri: expected.redirectUri
    });
    return send(res, 200, oauthSuccessPage(appUrl), { "content-type": "text/html; charset=utf-8" });
  } catch (error) {
    audit(actor, "google_calendar_oauth_failed", "company_settings", "google_calendar", {
      error: error.message
    });
    return send(res, 400, oauthErrorPage(error.message, appUrl), { "content-type": "text/html; charset=utf-8" });
  } finally {
    if (expected?.timeout) clearTimeout(expected.timeout);
    if (state) googleOauthStates.delete(state);
  }
}

async function googleCalendarWriteRequest(settings, method, suffix = "", payload = null, query = {}) {
  const token = await googleCalendarAccessToken(settings);
  const calendarId = String(settings.google_calendar_id || DEFAULT_GOOGLE_CALENDAR_ID).trim();
  if (!calendarId) throw new Error("ID de calendario Google obligatorio");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${suffix}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload ? { "content-type": "application/json; charset=utf-8" } : {})
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const body = await response.json().catch(async () => ({ error: await response.text().catch(() => "") }));
  if (!response.ok) {
    const detail = body.error?.message || body.error_description || body.error || "sin detalle";
    throw new Error(`Google Calendar ${response.status}: ${detail}`);
  }
  return body;
}

async function findGoogleCalendarEventByICalUid(settings, iCalUid) {
  if (!iCalUid) return null;
  const payload = await googleCalendarWriteRequest(settings, "GET", "", null, {
    iCalUID: iCalUid,
    maxResults: 1,
    singleEvents: "false"
  });
  return payload.items?.[0] || null;
}

function googleDateTime(date, time) {
  const normalized = String(time || "00:00").slice(0, 5);
  return `${date}T${normalized}:00`;
}

function googleEventDateRange(event) {
  const startDate = event.date;
  const endDate = toMinutes(event.end_time) <= toMinutes(event.start_time)
    ? addIsoDays(event.date, 1)
    : event.date;
  return {
    start: { dateTime: googleDateTime(startDate, event.start_time), timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    end: { dateTime: googleDateTime(endDate, event.end_time), timeZone: GOOGLE_CALENDAR_TIME_ZONE }
  };
}

function requirementsSummary(requirements = []) {
  if (!requirements.length) return "Sin necesidades definidas";
  return requirements.map((requirement) => `${requirement.role} x${requirement.count}`).join(", ");
}

function googlePrivateValue(value, max = 900) {
  return String(value ?? "").slice(0, max);
}

function googlePrivateEventProperties(event) {
  const activeAssignments = (event.assignments || []).filter((assignment) => assignment.status !== "bloqueado");
  return {
    marfan_event_id: googlePrivateValue(event.id),
    marfan_client_id: googlePrivateValue(event.client_id),
    marfan_client_name: googlePrivateValue(event.client_name || ""),
    marfan_status: googlePrivateValue(event.status || ""),
    marfan_required_total: String(event.required_total || 0),
    marfan_assignment_count: String(activeAssignments.length),
    marfan_assigned_employee_ids: googlePrivateValue(activeAssignments.map((assignment) => assignment.employee_id).join(",")),
    marfan_assigned_roles: googlePrivateValue(activeAssignments.map((assignment) => `${assignment.employee_id}:${assignment.role}`).join("|")),
    marfan_required_roles: googlePrivateValue(requirementsSummary(event.requirements || [])),
    marfan_team_leader_id: googlePrivateValue(event.team_leader_id || ""),
    marfan_service_price: String(Number(event.service_price || event.budget || 0))
  };
}

function googleEventPayloadFromMarfanEvent(event, origin = "https://marfancrew.local") {
  const dateRange = googleEventDateRange(event);
  const description = [
    "MARFAN CREW ERP",
    `Cliente: ${event.client_name || ""}`,
    `Estado: ${event.status || ""}`,
    `Jefe de equipo: ${event.team_leader_name || "Pendiente"}`,
    `Personal asignado: ${assignmentSummary(event.assignments)}`,
    `Personal requerido: ${requirementsSummary(event.requirements)}`,
    `Notas: ${event.notes || ""}`,
    `Ficha interna: ${origin}/#evento-${event.id}`
  ].join("\n");
  return {
    summary: event.name,
    location: event.address || event.location || "",
    description,
    start: dateRange.start,
    end: dateRange.end,
    extendedProperties: {
      private: googlePrivateEventProperties(event)
    },
    reminders: { useDefault: true }
  };
}

function updateGoogleSyncStatus(eventId, status, error = "") {
  run(
    "UPDATE events SET google_sync_status = ?, google_sync_error = ? WHERE id = ?",
    [status, error ? String(error).slice(0, 900) : null, eventId]
  );
}

function updateGoogleSyncSuccess(eventId, googleEvent) {
  run(
    `UPDATE events
     SET google_calendar_event_id = COALESCE(?, google_calendar_event_id),
         google_calendar_uid = COALESCE(?, google_calendar_uid),
         google_calendar_html_link = COALESCE(?, google_calendar_html_link),
         google_sync_status = 'synced',
         google_sync_error = NULL,
         google_synced_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      googleEvent.id || null,
      googleEvent.iCalUID || null,
      googleEvent.htmlLink || null,
      eventId
    ]
  );
}

async function syncEventToGoogleCalendar(eventId, actor, reason = "event_updated", origin = "https://marfancrew.local") {
  const settings = settingMap();
  if (!googleSyncEnabled(settings)) {
    updateGoogleSyncStatus(eventId, "disabled", "");
    return { status: "disabled" };
  }

  const event = eventDetail(eventId);
  if (!event) return { status: "missing" };

  try {
    let googleEventId = event.google_calendar_event_id;
    if (!googleEventId && event.google_calendar_uid) {
      const found = await findGoogleCalendarEventByICalUid(settings, event.google_calendar_uid);
      googleEventId = found?.id || null;
    }
    const payload = googleEventPayloadFromMarfanEvent(event, origin);
    const googleEvent = googleEventId
      ? await googleCalendarWriteRequest(settings, "PATCH", `/${encodeURIComponent(googleEventId)}`, payload)
      : await googleCalendarWriteRequest(settings, "POST", "", payload);
    updateGoogleSyncSuccess(eventId, googleEvent);
    audit(actor, "google_calendar_synced", "event", eventId, {
      reason,
      googleEventId: googleEvent.id,
      iCalUID: googleEvent.iCalUID
    });
    return { status: "synced", googleEvent };
  } catch (error) {
    const status = error.status === "pending_auth" ? "pending_auth" : "error";
    updateGoogleSyncStatus(eventId, status, error.message);
    audit(actor, "google_calendar_sync_failed", "event", eventId, {
      reason,
      status,
      error: error.message
    });
    return { status, error: error.message };
  }
}

function escapePdf(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function pdfSafeText(value, max = 112) {
  const ascii = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
  return escapePdf(ascii.replace(/\s+/g, " ").trim()).slice(0, max);
}

function paethPredictor(left, above, upperLeft) {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? above : upperLeft;
}

function decodePngDataUrlImage(value) {
  try {
    const match = String(value || "").trim().match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const buffer = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) return null;

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks = [];
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) return null;
      const data = buffer.subarray(dataStart, dataEnd);
      if (type === "IHDR") {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === "IDAT") {
        idatChunks.push(data);
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }
    if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || !idatChunks.length) return null;

    const channels = colorType === 6 ? 4 : 3;
    const rowLength = width * channels;
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    if (inflated.length < (rowLength + 1) * height) return null;
    const pixels = Buffer.alloc(rowLength * height);
    let inputOffset = 0;
    let previous = Buffer.alloc(rowLength);
    for (let y = 0; y < height; y += 1) {
      const filter = inflated[inputOffset];
      inputOffset += 1;
      const row = Buffer.alloc(rowLength);
      for (let x = 0; x < rowLength; x += 1) {
        const raw = inflated[inputOffset + x];
        const left = x >= channels ? row[x - channels] : 0;
        const above = previous[x] || 0;
        const upperLeft = x >= channels ? previous[x - channels] || 0 : 0;
        let valueByte = raw;
        if (filter === 1) valueByte = raw + left;
        else if (filter === 2) valueByte = raw + above;
        else if (filter === 3) valueByte = raw + Math.floor((left + above) / 2);
        else if (filter === 4) valueByte = raw + paethPredictor(left, above, upperLeft);
        else if (filter !== 0) return null;
        row[x] = valueByte & 0xff;
      }
      inputOffset += rowLength;
      row.copy(pixels, y * rowLength);
      previous = row;
    }

    if (colorType === 2) {
      return { width, height, colorData: zlib.deflateSync(pixels), alphaData: null };
    }
    const rgb = Buffer.alloc(width * height * 3);
    const alpha = Buffer.alloc(width * height);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const source = pixel * 4;
      const target = pixel * 3;
      rgb[target] = pixels[source];
      rgb[target + 1] = pixels[source + 1];
      rgb[target + 2] = pixels[source + 2];
      alpha[pixel] = pixels[source + 3];
    }
    return { width, height, colorData: zlib.deflateSync(rgb), alphaData: zlib.deflateSync(alpha) };
  } catch {
    return null;
  }
}

function pdfStreamObject(dictionary, stream) {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${stream.length} >>\nstream\n`, "utf8"),
    stream,
    Buffer.from("\nendstream", "utf8")
  ]);
}

function createPdfDocument(ops, images = []) {
  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];
  const xObjects = [];
  images.forEach((image, index) => {
    if (!image?.width || !image?.height || !image.colorData) return;
    let smaskRef = "";
    if (image.alphaData) {
      const objectNumber = objects.length + 1;
      objects.push(pdfStreamObject(
        `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        image.alphaData
      ));
      smaskRef = `/SMask ${objectNumber} 0 R `;
    }
    const imageObjectNumber = objects.length + 1;
    objects.push(pdfStreamObject(
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ${smaskRef}`,
      image.colorData
    ));
    xObjects.push(`/Im${index + 1} ${imageObjectNumber} 0 R`);
  });
  const contentObjectNumber = objects.length + 1;
  const xObjectResources = xObjects.length ? `/XObject << ${xObjects.join(" ")} >> ` : "";
  objects[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xObjectResources}>> /Contents ${contentObjectNumber} 0 R >>`;
  objects.push(pdfStreamObject("", Buffer.from(content, "utf8")));

  const chunks = [Buffer.from("%PDF-1.4\n", "utf8")];
  const offsets = [0];
  objects.forEach((object, index) => {
    const currentOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    offsets.push(currentOffset);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "utf8"));
    chunks.push(Buffer.isBuffer(object) ? object : Buffer.from(object, "utf8"));
    chunks.push(Buffer.from("\nendobj\n", "utf8"));
  });
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, "utf8"));
  return Buffer.concat(chunks);
}

function createPdfLines(title, lines) {
  const ops = [];
  const fill = (r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const stroke = (r, g, b) => ops.push(`${r} ${g} ${b} RG`);
  const rect = (x, y, w, h, mode = "f") => ops.push(`${x} ${y} ${w} ${h} re ${mode}`);
  const text = (value, x, y, size = 9, font = "F1", color = [0.06, 0.09, 0.16]) => {
    fill(...color);
    ops.push("BT", `/${font} ${size} Tf`, `${x} ${y} Td`, `(${pdfSafeText(value, 160)}) Tj`, "ET");
  };

  fill(0.965, 0.976, 0.988);
  rect(0, 0, 595, 842);
  fill(0.024, 0.063, 0.11);
  rect(0, 758, 595, 84);
  fill(0.027, 0.58, 0.33);
  rect(0, 758, 10, 84);
  fill(1, 1, 1);
  rect(40, 784, 34, 34);
  text("M", 51, 794, 18, "F2", [0.024, 0.063, 0.11]);
  text("MARFAN CREW", 84, 806, 11, "F2", [1, 1, 1]);
  text("ERP operativo para eventos", 84, 790, 8, "F1", [0.78, 0.86, 0.94]);
  text(title, 40, 720, 20, "F2", [0.024, 0.063, 0.11]);
  text(`Generado ${new Date().toLocaleString("es-ES")}`, 420, 722, 8, "F1", [0.36, 0.43, 0.53]);
  fill(0.027, 0.58, 0.33);
  rect(40, 704, 515, 3);

  let y = 674;
  let row = 0;
  for (const rawLine of lines.slice(1)) {
    const line = String(rawLine || "");
    if (!line.trim()) {
      y -= 8;
      continue;
    }
    if (y < 62) {
      text("Documento truncado por longitud. Exporta CSV/Excel para ver el detalle completo.", 40, y, 8, "F1", [0.55, 0.29, 0.02]);
      break;
    }
    if (line.includes(" | ")) {
      const isHeader = row === 0 || /operario|evento|cliente|ingresos|coste|beneficio/i.test(line);
      fill(isHeader ? 0.024 : row % 2 ? 1 : 0.985, isHeader ? 0.063 : row % 2 ? 1 : 0.988, isHeader ? 0.11 : row % 2 ? 1 : 0.992);
      rect(40, y - 7, 515, 18);
      const cells = line.split(" | ");
      const widths = [112, 94, 94, 104, 108];
      let x = 48;
      cells.slice(0, 5).forEach((cell, index) => {
        text(cell, x, y - 1, 7.3, isHeader ? "F2" : "F1", isHeader ? [1, 1, 1] : [0.06, 0.09, 0.16]);
        x += widths[index] || 96;
      });
      row += 1;
      y -= 19;
      continue;
    }
    if (/^[A-ZÁÉÍÓÚÑ0-9][^:]{0,42}$/.test(line) && line.length < 48) {
      text(line, 40, y, 11, "F2", [0.024, 0.063, 0.11]);
      y -= 17;
      continue;
    }
    fill(1, 1, 1);
    stroke(0.85, 0.88, 0.92);
    rect(40, y - 8, 515, 20, "B");
    text(line, 50, y - 1, 8, "F1", [0.16, 0.22, 0.31]);
    y -= 23;
  }

  fill(0.024, 0.063, 0.11);
  rect(0, 0, 595, 36);
  text("MARFAN CREW ERP", 40, 14, 9, "F2", [1, 1, 1]);
  text("Documento corporativo generado automaticamente", 374, 14, 7, "F1", [0.78, 0.86, 0.94]);
  return createPdfDocument(ops);
}

function createPdfReport(title, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const titleKey = title.toLowerCase();
  const isKnownReport =
    titleKey.includes("evento") ||
    titleKey.includes("finanza") ||
    titleKey.includes("operario") ||
    titleKey.includes("incidencia");
  const preferredColumns =
    titleKey.includes("evento")
      ? ["evento", "cliente", "fecha", "inicio", "estado", "precio_servicio", "beneficio"]
      : titleKey.includes("finanza")
        ? ["seccion", "nombre", "ingresos", "coste", "beneficio", "margen", "detalle"]
        : titleKey.includes("operario")
          ? ["nombre", "rol", "telefono", "estado_documental", "documentos_caducados", "bloqueos"]
          : titleKey.includes("incidencia")
            ? ["fecha_incidencia", "prioridad", "tipo", "titulo", "evento", "operario", "estado"]
            : headers;
  const columns = [
    ...preferredColumns.filter((header) => headers.includes(header)),
    ...headers.filter((header) => !preferredColumns.includes(header))
  ].slice(0, isKnownReport ? preferredColumns.length : 8);
  const columnWidths = {
    1: [515],
    2: [260, 255],
    3: [205, 155, 155],
    4: [170, 135, 105, 105],
    5: [145, 110, 90, 85, 85],
    6: [128, 92, 78, 75, 72, 70],
    7: [112, 84, 70, 68, 68, 58, 55],
    8: [100, 78, 65, 58, 58, 58, 50, 48]
  }[Math.max(columns.length, 1)] || [515];
  const numberTotal = (names) => rows.reduce((sum, row) => {
    const name = names.find((item) => row[item] !== undefined);
    return sum + Number(row[name] || 0);
  }, 0);
  const moneyText = (value) => `${Number(value || 0).toFixed(2)} EUR`;
  const cardData = (() => {
    const revenue = numberTotal(["ingresos", "precio_servicio", "facturacion"]);
    const cost = numberTotal(["coste"]);
    const benefit = numberTotal(["beneficio"]);
    const expiredDocs = numberTotal(["documentos_caducados"]);
    const critical = rows.filter((row) => String(row.prioridad || "").toLowerCase() === "critica").length;
    const cards = [{ label: "Registros", value: String(rows.length), tone: "dark" }];
    if (revenue) cards.push({ label: "Ingresos", value: moneyText(revenue), tone: "green" });
    if (cost) cards.push({ label: "Coste", value: moneyText(cost), tone: "light" });
    if (benefit || revenue || cost) cards.push({ label: "Beneficio", value: moneyText(benefit), tone: benefit >= 0 ? "green" : "amber" });
    if (expiredDocs) cards.push({ label: "Docs cad.", value: String(expiredDocs), tone: "amber" });
    if (critical) cards.push({ label: "Criticas", value: String(critical), tone: "amber" });
    cards.push({ label: "Generado", value: new Date().toLocaleDateString("es-ES"), tone: "light" });
    return cards.slice(0, 4);
  })();
  const cellText = (header, value) => {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number") {
      if (/precio|ingres|coste|beneficio|kilometraje|dieta|extras/i.test(header)) return moneyText(value);
      if (/margen/i.test(header)) return `${value.toFixed(1)}%`;
      if (/km|distancia|horas|noct/i.test(header)) return value.toFixed(1);
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    return String(value);
  };
  const reportCellMax = (header, width) => {
    if (/evento|cliente|nombre|titulo|detalle|operario|ubicacion|bloqueos/i.test(header)) {
      return Math.max(8, Math.floor(width / 5.8));
    }
    return Math.max(8, Math.floor(width / 4.4));
  };
  const labelText = (header) => String(header || "").replace(/_/g, " ").toUpperCase();
  const ops = [];
  const fill = (r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const stroke = (r, g, b) => ops.push(`${r} ${g} ${b} RG`);
  const rect = (x, y, w, h, mode = "f") => ops.push(`${x} ${y} ${w} ${h} re ${mode}`);
  const text = (value, x, y, size = 9, font = "F1", color = [0.06, 0.09, 0.16], max = 80) => {
    fill(...color);
    ops.push("BT", `/${font} ${size} Tf`, `${x} ${y} Td`, `(${pdfSafeText(value, max)}) Tj`, "ET");
  };
  const drawCard = (card, index) => {
    const x = 40 + index * 132;
    const tone = card.tone || "light";
    const bg = tone === "dark" ? [0.024, 0.063, 0.11] : tone === "green" ? [0.027, 0.58, 0.33] : tone === "amber" ? [1, 0.95, 0.82] : [1, 1, 1];
    const fg = tone === "dark" || tone === "green" ? [1, 1, 1] : [0.06, 0.09, 0.16];
    const muted = tone === "dark" || tone === "green" ? [0.84, 0.91, 0.97] : [0.39, 0.45, 0.55];
    fill(...bg);
    stroke(tone === "light" ? 0.84 : bg[0], tone === "light" ? 0.87 : bg[1], tone === "light" ? 0.91 : bg[2]);
    rect(x, 622, 119, 58, "B");
    text(card.label, x + 12, 660, 7, "F2", muted, 24);
    text(card.value, x + 12, 638, 12, "F2", fg, 28);
  };

  fill(0.965, 0.976, 0.988);
  rect(0, 0, 595, 842);
  fill(0.024, 0.063, 0.11);
  rect(0, 748, 595, 94);
  fill(0.027, 0.58, 0.33);
  rect(0, 748, 12, 94);
  fill(1, 1, 1);
  rect(40, 779, 36, 36);
  text("M", 52, 790, 18, "F2", [0.024, 0.063, 0.11], 2);
  text("MARFAN CREW", 88, 804, 12, "F2", [1, 1, 1], 34);
  text("Informe corporativo de operaciones", 88, 787, 8, "F1", [0.78, 0.86, 0.94], 62);
  text(`Generado ${new Date().toLocaleString("es-ES")}`, 390, 804, 8, "F1", [0.78, 0.86, 0.94], 52);
  text("ERP SaaS eventos", 390, 787, 8, "F2", [1, 1, 1], 35);
  text(title, 40, 714, 20, "F2", [0.024, 0.063, 0.11], 70);
  text(`${rows.length} registros exportados · CSV y Excel disponibles para detalle completo`, 40, 693, 8, "F1", [0.36, 0.43, 0.53], 100);
  cardData.forEach(drawCard);

  text("Detalle del informe", 40, 588, 12, "F2", [0.024, 0.063, 0.11], 38);
  fill(0.024, 0.063, 0.11);
  rect(40, 558, 515, 22);
  let x = 48;
  columns.forEach((header, index) => {
    text(labelText(header), x, 566, 6.5, "F2", [1, 1, 1], Math.max(12, Math.floor(columnWidths[index] / 4.6)));
    x += columnWidths[index];
  });
  let y = 535;
  for (const [rowIndex, row] of rows.slice(0, 20).entries()) {
    fill(rowIndex % 2 ? 1 : 0.985, rowIndex % 2 ? 1 : 0.988, rowIndex % 2 ? 1 : 0.992);
    stroke(0.89, 0.91, 0.94);
    rect(40, y - 6, 515, 22, "B");
    let cellX = 48;
    columns.forEach((header, index) => {
      const max = reportCellMax(header, columnWidths[index]);
      text(cellText(header, row[header]), cellX, y + 1, 6.8, "F1", [0.06, 0.09, 0.16], max);
      cellX += columnWidths[index];
    });
    y -= 22;
  }
  if (!rows.length) {
    fill(1, 1, 1);
    stroke(0.89, 0.91, 0.94);
    rect(40, 500, 515, 38, "B");
    text("No hay datos para los filtros seleccionados.", 56, 518, 9, "F1", [0.39, 0.45, 0.55], 80);
  } else if (rows.length > 20) {
    text(`Informe truncado en PDF: ${rows.length - 20} filas adicionales disponibles en CSV/Excel.`, 40, y - 6, 8, "F2", [0.55, 0.29, 0.02], 88);
  }

  fill(1, 1, 1);
  stroke(0.84, 0.87, 0.91);
  rect(40, 58, 515, 44, "B");
  text("Uso interno MARFAN CREW", 54, 82, 8, "F2", [0.024, 0.063, 0.11], 45);
  text("Documento generado automaticamente desde datos persistentes del ERP. Conserva CSV/Excel para auditoria completa.", 54, 68, 7, "F1", [0.39, 0.45, 0.55], 118);

  fill(0.024, 0.063, 0.11);
  rect(0, 0, 595, 36);
  text("MARFAN CREW ERP", 40, 14, 9, "F2", [1, 1, 1], 36);
  text("Informes · operaciones · finanzas · RRHH", 344, 14, 7, "F1", [0.78, 0.86, 0.94], 58);
  return createPdfDocument(ops);
}

function safeFileName(name) {
  const cleaned = String(name || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "documento";
}

function cleanDocumentMime(value, fileName = "") {
  const declared = String(value || "").split(";")[0].trim().toLowerCase();
  const byExtension = DOCUMENT_EXTENSION_MIME_TYPES[path.extname(fileName || "").toLowerCase()];
  const mime = declared || byExtension || "application/octet-stream";
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(mime)) {
    const error = new Error("Tipo de archivo no permitido. Usa PDF, imagen, Word, Excel, CSV o TXT.");
    error.status = 415;
    throw error;
  }
  return mime;
}

function decodeDocumentBase64(rawValue) {
  const raw = String(rawValue || "");
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  const compact = base64.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    const error = new Error("Archivo no valido");
    error.status = 400;
    throw error;
  }
  return Buffer.from(compact, "base64");
}

function cleanProfilePhotoMime(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(mime)) {
    const error = new Error("Foto no valida. Usa JPG, PNG o WEBP.");
    error.status = 415;
    throw error;
  }
  return mime;
}

function profilePhotoMagicMatches(buffer, mime) {
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function normalizeProfilePhoto(body, existingPhotoUrl = "") {
  if (body.photoDataBase64) {
    const raw = String(body.photoDataBase64 || "");
    const declaredMime = raw.match(/^data:([^;]+);base64,/i)?.[1] || body.photoMime || "";
    const mime = cleanProfilePhotoMime(declaredMime);
    const buffer = decodeDocumentBase64(raw);
    if (!buffer.length) {
      const error = new Error("Foto vacia");
      error.status = 400;
      throw error;
    }
    if (buffer.length > MAX_PROFILE_PHOTO_BYTES) {
      const error = new Error("Foto demasiado grande. Maximo 1 MB.");
      error.status = 413;
      throw error;
    }
    if (!profilePhotoMagicMatches(buffer, mime)) {
      const error = new Error("Foto no valida. El archivo no coincide con el tipo de imagen.");
      error.status = 400;
      throw error;
    }
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  if (body.photoUrl !== undefined) {
    const value = String(body.photoUrl || "").trim();
    if (!value) return "";
    if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) {
      return normalizeProfilePhoto({ photoDataBase64: value }, existingPhotoUrl);
    }
    const error = new Error("Foto no valida. Usa una URL https o sube una imagen.");
    error.status = 400;
    throw error;
  }

  return existingPhotoUrl || "";
}

function saveDocumentFile(documentId, body) {
  const safeName = body.fileName ? safeFileName(body.fileName) : null;
  if (!body.fileDataBase64) {
    const declaredSize = body.fileSize ? Number(body.fileSize) : null;
    if (declaredSize && declaredSize > MAX_DOCUMENT_FILE_BYTES) {
      const error = new Error("Archivo demasiado grande. Maximo 8 MB por documento.");
      error.status = 413;
      throw error;
    }
    return {
      fileName: safeName,
      fileMime: body.fileMime ? cleanDocumentMime(body.fileMime, safeName || "") : null,
      fileSize: declaredSize,
      storagePath: null
    };
  }
  const buffer = decodeDocumentBase64(body.fileDataBase64);
  if (!buffer.length) {
    const error = new Error("Archivo vacio");
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_DOCUMENT_FILE_BYTES) {
    const error = new Error("Archivo demasiado grande. Maximo 8 MB por documento.");
    error.status = 413;
    throw error;
  }
  const fileName = safeName || `${documentId}.pdf`;
  const fileMime = cleanDocumentMime(body.fileMime, fileName);
  const storagePath = path.join(DOCUMENT_UPLOAD_DIR, `${documentId}-${fileName}`);
  fs.writeFileSync(storagePath, buffer);
  return {
    fileName,
    fileMime,
    fileSize: buffer.length,
    storagePath
  };
}

function documentFilePath(document) {
  if (!document?.storage_path) return null;
  const resolved = path.resolve(document.storage_path);
  if (!resolved.startsWith(`${DOCUMENT_UPLOAD_DIR}${path.sep}`)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function removeDocumentStorageFile(filePath) {
  const resolved = path.resolve(filePath || "");
  const base = path.resolve(DOCUMENT_UPLOAD_DIR);
  if (!resolved.startsWith(`${base}${path.sep}`)) return false;
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { force: true });
  return true;
}

function canAccessDocument(user, document) {
  if (!user || !document) return false;
  if (["admin", "super_admin"].includes(user.role)) return true;
  const employee = get("SELECT id FROM employees WHERE user_id = ?", [user.id]);
  return Boolean(employee && employee.id === document.employee_id);
}

function canAccessEventDocument(user, document) {
  if (!user || !document) return false;
  if (["admin", "super_admin"].includes(user.role)) return true;
  if (!Number(document.visible_to_employee || 0)) return false;
  const employee = get("SELECT id FROM employees WHERE user_id = ?", [user.id]);
  if (!employee) return false;
  const assignment = get(
    "SELECT id FROM assignments WHERE event_id = ? AND employee_id = ? AND status != 'bloqueado'",
    [document.event_id, employee.id]
  );
  return Boolean(assignment);
}

function isTeamLeaderForEvent(event, employee, assignment) {
  if (!event || !employee) return false;
  if (event.team_leader_id === employee.id) return true;
  return String(assignment?.role || "").toLowerCase().includes("jefe");
}

function signDeliveryNote(event, body) {
  const signatureName = String(body.signatureName || "").trim();
  const signatureDni = String(body.signatureDni || "").trim();
  if (!signatureName || !signatureDni) {
    const error = new Error("Firma cliente requerida");
    error.status = 428;
    error.requiresClientSignature = true;
    throw error;
  }

  const existing = get("SELECT * FROM delivery_notes WHERE event_id = ?", [event.id]);
  if (existing?.locked) return existing;

  const id = existing?.id || randomId("dn");
  if (existing) {
    run(
      `UPDATE delivery_notes
       SET status = 'firmado',
           signature_name = ?,
           signature_dni = ?,
           signature_image = ?,
           signed_at = CURRENT_TIMESTAMP,
           service_price = ?,
           client_notes = ?,
           locked = 1
       WHERE id = ?`,
      [
        signatureName,
        signatureDni,
        body.signatureImage || null,
        Number(event.service_price || event.budget || 0),
        body.clientNotes || "",
        id
      ]
    );
  } else {
    run(
      `INSERT INTO delivery_notes
        (id, event_id, status, signature_name, signature_dni, signature_image, signed_at, service_price, client_notes, locked)
       VALUES (?, ?, 'firmado', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 1)`,
      [
        id,
        event.id,
        signatureName,
        signatureDni,
        body.signatureImage || null,
        Number(event.service_price || event.budget || 0),
        body.clientNotes || ""
      ]
    );
  }
  run("UPDATE events SET status = 'finalizado', closed_at = CURRENT_TIMESTAMP WHERE id = ?", [event.id]);
  return get("SELECT * FROM delivery_notes WHERE id = ?", [id]);
}

function ensureDraftDeliveryNote(event) {
  if (!event?.id) return null;
  const existing = get("SELECT * FROM delivery_notes WHERE event_id = ?", [event.id]);
  if (existing) return existing;
  const id = randomId("dn");
  run(
    `INSERT INTO delivery_notes (id, event_id, status, service_price, locked)
     VALUES (?, ?, 'borrador', ?, 0)`,
    [id, event.id, Number(event.service_price || event.budget || 0)]
  );
  return get("SELECT * FROM delivery_notes WHERE id = ?", [id]);
}

function listUsers() {
  return all(
    `SELECT users.id, users.role, users.name, users.email, users.phone, users.avatar_url, users.active,
            users.last_login_at, users.created_at, users.permissions_json,
            employees.id AS employee_id, employees.role AS employee_role, employees.status AS employee_status,
            (
              SELECT COUNT(*)
              FROM password_reset_tokens
              WHERE password_reset_tokens.user_id = users.id
                AND password_reset_tokens.used_at IS NULL
                AND datetime(password_reset_tokens.expires_at) > CURRENT_TIMESTAMP
            ) AS pending_recovery_count,
            (
              SELECT MAX(created_at)
              FROM password_reset_tokens
              WHERE password_reset_tokens.user_id = users.id
                AND password_reset_tokens.used_at IS NULL
                AND datetime(password_reset_tokens.expires_at) > CURRENT_TIMESTAMP
            ) AS recovery_requested_at,
            (
              SELECT MAX(expires_at)
              FROM password_reset_tokens
              WHERE password_reset_tokens.user_id = users.id
                AND password_reset_tokens.used_at IS NULL
                AND datetime(password_reset_tokens.expires_at) > CURRENT_TIMESTAMP
            ) AS recovery_expires_at
     FROM users
     LEFT JOIN employees ON employees.user_id = users.id
     ORDER BY CASE users.role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, users.name`
  ).map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    active: Boolean(row.active),
    permissions: normalizeAdminPermissions(row.permissions_json, row.role),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    employeeId: row.employee_id,
    employeeRole: row.employee_role,
    employeeStatus: row.employee_status,
    recoveryPending: Number(row.pending_recovery_count || 0) > 0,
    recoveryPendingCount: Number(row.pending_recovery_count || 0),
    recoveryRequestedAt: row.recovery_requested_at,
    recoveryExpiresAt: row.recovery_expires_at
  }));
}

function ensureCanChangeUser(actor, targetId, nextRole, nextActive) {
  if (actor.id === targetId && nextActive === false) {
    const error = new Error("No puedes desactivar tu propio usuario");
    error.status = 409;
    throw error;
  }

  const target = get("SELECT * FROM users WHERE id = ?", [targetId]);
  if (!target) {
    const error = new Error("Usuario no encontrado");
    error.status = 404;
    throw error;
  }

  const wouldRemoveSuperAdmin =
    target.role === "super_admin" &&
    ((nextRole && nextRole !== "super_admin") || nextActive === false);
  if (wouldRemoveSuperAdmin) {
    const count = get(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND active = 1 AND id != ?",
      [targetId]
    ).count;
    if (count < 1) {
      const error = new Error("Debe quedar al menos un super admin activo");
      error.status = 409;
      throw error;
    }
  }
  return target;
}

function deliveryNoteRows(event) {
  const allowanceRows = all(
    `SELECT allowances.*, employees.name AS employee_name, employees.role
     FROM allowances
     JOIN employees ON employees.id = allowances.employee_id
     WHERE allowances.event_id = ?`,
    [event.id]
  );
  const allowanceByEmployee = new Map(allowanceRows.map((row) => [row.employee_id, row]));
  return event.assignments.map((assignment) => {
    const allowance = allowanceByEmployee.get(assignment.employee_id) || {};
    return { assignment, allowance };
  });
}

function deliveryPricingContext(event) {
  const settings = settingMap();
  const baseAddress = String(settings.base_address || "Calle Ciro Alegria 89, Malaga").trim() || "Calle Ciro Alegria 89, Malaga";
  const includedKm = numberSetting(settings, "included_km", 20);
  const kilometrePrice = Number.isFinite(Number(event.kilometre_price))
    ? Number(event.kilometre_price)
    : numberSetting(settings, "vehicle_km_price", 0.37);
  return { baseAddress, includedKm, kilometrePrice };
}

function deliveryNotePdf(event) {
  const note = event.deliveryNote || {};
  const servicePrice = Number(note.service_price ?? event.service_price ?? event.budget ?? 0);
  const pricingContext = deliveryPricingContext(event);
  const rows = deliveryNoteRows(event);
  const signatureImage = decodePngDataUrlImage(note.signature_image);
  const pdfImages = signatureImage ? [signatureImage] : [];
  const ops = [];
  const fill = (r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const stroke = (r, g, b) => ops.push(`${r} ${g} ${b} RG`);
  const rect = (x, y, w, h, mode = "f") => ops.push(`${x} ${y} ${w} ${h} re ${mode}`);
  const text = (value, x, y, size = 9, font = "F1", color = [0.06, 0.09, 0.16], max = 90) => {
    fill(...color);
    ops.push("BT", `/${font} ${size} Tf`, `${x} ${y} Td`, `(${pdfSafeText(value, max)}) Tj`, "ET");
  };
  const image = (index, x, y, w, h) => ops.push("q", `${w} 0 0 ${h} ${x} ${y} cm`, `/Im${index + 1} Do`, "Q");
  const moneyText = (value) => `${Number(value || 0).toFixed(2)} EUR`;
  const card = (x, y, w, h, label, value, tone = "light") => {
    const bg = tone === "dark" ? [0.024, 0.063, 0.11] : tone === "green" ? [0.027, 0.58, 0.33] : [1, 1, 1];
    const border = tone === "dark" || tone === "green" ? bg : [0.84, 0.87, 0.91];
    fill(...bg);
    stroke(...border);
    rect(x, y, w, h, "B");
    text(label.toUpperCase(), x + 12, y + h - 18, 7, "F2", tone === "light" ? [0.39, 0.45, 0.55] : [0.84, 0.91, 0.97], 40);
    text(value, x + 12, y + 14, tone === "green" ? 18 : 11, "F2", tone === "light" ? [0.06, 0.09, 0.16] : [1, 1, 1], 64);
  };

  fill(0.965, 0.976, 0.988);
  rect(0, 0, 595, 842);
  fill(0.024, 0.063, 0.11);
  rect(0, 748, 595, 94);
  fill(0.027, 0.58, 0.33);
  rect(0, 748, 12, 94);
  fill(1, 1, 1);
  rect(40, 779, 36, 36);
  text("M", 52, 790, 18, "F2", [0.024, 0.063, 0.11], 2);
  text("MARFAN CREW", 88, 804, 12, "F2", [1, 1, 1], 34);
  text("Albaran corporativo de servicio", 88, 787, 8, "F1", [0.78, 0.86, 0.94], 58);
  text(`Generado ${new Date().toLocaleString("es-ES")}`, 390, 804, 8, "F1", [0.78, 0.86, 0.94], 52);
  text(`Ref. ${event.id}`, 390, 787, 8, "F2", [1, 1, 1], 45);

  text("ALBARAN DE SERVICIO", 40, 714, 20, "F2", [0.024, 0.063, 0.11], 46);
  text(event.name, 40, 692, 12, "F2", [0.16, 0.22, 0.31], 74);
  const signed = Boolean(note.locked);
  fill(signed ? 0.86 : 1, signed ? 0.98 : 0.95, signed ? 0.9 : 0.78);
  stroke(signed ? 0.03 : 0.71, signed ? 0.46 : 0.28, signed ? 0.28 : 0.03);
  rect(412, 700, 143, 24, "B");
  text(signed ? "FIRMADO Y BLOQUEADO" : "PENDIENTE DE FIRMA", 425, 708, 8, "F2", signed ? [0.03, 0.46, 0.28] : [0.71, 0.28, 0.03], 34);

  card(40, 618, 330, 58, "Cliente", `${event.client_name} · ${event.location}`, "light");
  card(390, 618, 165, 58, "Precio servicio", moneyText(servicePrice), "green");
  card(40, 546, 120, 54, "Fecha", event.date, "light");
  card(174, 546, 120, 54, "Horario", `${event.start_time}-${event.end_time}`, "light");
  card(308, 546, 120, 54, "Jefe equipo", event.team_leader_name || "Pendiente", "light");
  card(442, 546, 113, 54, "Equipo", `${rows.length} operarios`, "dark");

  text("Datos de facturacion", 40, 514, 12, "F2", [0.024, 0.063, 0.11], 40);
  fill(1, 1, 1);
  stroke(0.84, 0.87, 0.91);
  rect(40, 456, 515, 44, "B");
  text(`Direccion: ${event.address || event.location}`, 54, 482, 8, "F1", [0.16, 0.22, 0.31], 105);
  text(`Base ${pricingContext.baseAddress} -> ${Number(event.base_distance_km || 0).toFixed(1)} km`, 54, 466, 8, "F1", [0.16, 0.22, 0.31], 80);
  text(`Roles ${moneyText(event.role_price_total)} · Nocturnidad ${moneyText(event.night_price_total)} · Km ${moneyText(event.distance_price_total)}`, 300, 466, 8, "F2", [0.06, 0.09, 0.16], 70);
  text(`Km incluidos ${pricingContext.includedKm.toFixed(1)} · Facturables ${Number(event.billable_km || 0).toFixed(1)} · Vehiculos ${Number(event.vehicle_count || 1)} · ${pricingContext.kilometrePrice.toFixed(2)} EUR/km`, 300, 482, 8, "F1", [0.16, 0.22, 0.31], 70);

  text("Equipo, horario y pluses", 40, 424, 12, "F2", [0.024, 0.063, 0.11], 40);
  fill(0.024, 0.063, 0.11);
  rect(40, 399, 515, 20);
  const columns = [
    ["Operario", 50],
    ["Rol", 190],
    ["Horario", 302],
    ["Km", 378],
    ["Dieta", 420],
    ["Noct.", 468],
    ["Extras", 512]
  ];
  for (const [label, x] of columns) text(label, x, 405, 7.5, "F2", [1, 1, 1], 18);
  let y = 379;
  for (const { assignment, allowance } of rows.slice(0, 10)) {
    fill(y % 40 === 19 ? 1 : 0.985, y % 40 === 19 ? 1 : 0.988, y % 40 === 19 ? 1 : 0.992);
    stroke(0.89, 0.91, 0.94);
    rect(40, y - 6, 515, 20, "B");
    text(assignment.name, 50, y, 7.5, "F1", [0.06, 0.09, 0.16], 30);
    text(assignment.role, 190, y, 7.5, "F1", [0.06, 0.09, 0.16], 24);
    text(`${event.start_time}-${event.end_time}`, 302, y, 7.5, "F1", [0.06, 0.09, 0.16], 16);
    text(Number(allowance.km || 0).toFixed(1), 378, y, 7.5, "F1", [0.06, 0.09, 0.16], 8);
    text(Number(allowance.diet || 0).toFixed(2), 420, y, 7.5, "F1", [0.06, 0.09, 0.16], 9);
    text(Number(allowance.night_hours || 0).toFixed(1), 468, y, 7.5, "F1", [0.06, 0.09, 0.16], 8);
    text(Number(allowance.extras || 0).toFixed(2), 512, y, 7.5, "F1", [0.06, 0.09, 0.16], 9);
    y -= 21;
  }
  if (!rows.length) text("Sin operarios asignados", 50, y, 8, "F1", [0.39, 0.45, 0.55], 40);
  if (rows.length > 10) text(`Mas ${rows.length - 10} operarios en el albaran HTML`, 50, y, 8, "F2", [0.55, 0.29, 0.02], 45);

  fill(1, 1, 1);
  stroke(0.84, 0.87, 0.91);
  rect(40, 90, 245, 118, "B");
  rect(310, 90, 245, 118, "B");
  text("Firma cliente", 56, 184, 11, "F2", [0.024, 0.063, 0.11], 28);
  if (signatureImage) {
    const aspect = signatureImage.width / signatureImage.height;
    let signatureWidth = 205;
    let signatureHeight = signatureWidth / aspect;
    if (signatureHeight > 38) {
      signatureHeight = 38;
      signatureWidth = signatureHeight * aspect;
    }
    image(0, 56, 138, signatureWidth, signatureHeight);
    text("Firma grafica capturada digitalmente", 56, 128, 7.5, "F1", [0.39, 0.45, 0.55], 48);
  } else {
    text(note.signature_image ? "Firma guardada, imagen no legible en PDF" : "Firma grafica no capturada", 56, 154, 8, "F1", [0.39, 0.45, 0.55], 52);
  }
  text(`Nombre: ${note.signature_name || ""}`, 56, 114, 8.5, "F1", [0.06, 0.09, 0.16], 52);
  text(`DNI/NIF: ${note.signature_dni || ""}`, 56, 100, 8.5, "F1", [0.06, 0.09, 0.16], 40);
  text("Control MARFAN", 326, 184, 11, "F2", [0.024, 0.063, 0.11], 28);
  text(`Estado: ${signed ? "Firmado y bloqueado" : "Pendiente"}`, 326, 162, 8.5, "F2", signed ? [0.03, 0.46, 0.28] : [0.71, 0.28, 0.03], 42);
  text(`Fecha firma: ${note.signed_at || ""}`, 326, 146, 8, "F1", [0.16, 0.22, 0.31], 44);
  text(`Observaciones: ${note.client_notes || ""}`, 326, 128, 8, "F1", [0.16, 0.22, 0.31], 50);
  text(`Notas servicio: ${event.notes || ""}`, 326, 112, 7.5, "F1", [0.39, 0.45, 0.55], 58);

  fill(0.024, 0.063, 0.11);
  rect(0, 0, 595, 36);
  text("MARFAN CREW ERP", 40, 14, 9, "F2", [1, 1, 1], 36);
  text("Precio, equipo, kilometraje y firma de cliente", 330, 14, 7, "F1", [0.78, 0.86, 0.94], 54);
  return createPdfDocument(ops, pdfImages);
}

function deliveryNoteHtml(event) {
  const note = event.deliveryNote || {};
  const servicePrice = Number(note.service_price ?? event.service_price ?? event.budget ?? 0);
  const pricingContext = deliveryPricingContext(event);
  const rows = deliveryNoteRows(event).map(({ assignment, allowance }) => {
    return `
      <tr>
        <td>${escHtml(assignment.name)}</td>
        <td>${escHtml(assignment.role)}</td>
        <td>${escHtml(event.start_time)} - ${escHtml(event.end_time)}</td>
        <td>${Number(allowance.km || 0).toFixed(1)}</td>
        <td>${Number(allowance.diet || 0).toFixed(2)} EUR</td>
        <td>${Number(allowance.night_hours || 0).toFixed(1)}</td>
        <td>${Number(allowance.extras || 0).toFixed(2)} EUR</td>
      </tr>
    `;
  }).join("");
  return `<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Albaran ${escHtml(event.name)}</title>
        <style>
          @page { size: A4; margin: 18mm; }
          body { font-family: Arial, sans-serif; color: #101828; margin: 0; }
	          header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #101828; padding-bottom: 16px; margin-bottom: 18px; }
	          .brand-block { display: flex; align-items: center; gap: 14px; }
	          .brand-logo { width: 58px; height: 58px; object-fit: contain; }
	          h1 { margin: 0; font-size: 28px; }
          h2 { font-size: 16px; margin: 22px 0 8px; }
          .muted { color: #667085; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #d0d5dd; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f2f4f7; }
          .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 36px; }
          .box { border: 1px solid #98a2b3; min-height: 110px; padding: 12px; }
          .signature-img { max-width: 100%; max-height: 70px; display: block; margin: 10px 0; }
	          .brand { font-weight: 800; letter-spacing: 0; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
	        <button onclick="window.print()">Imprimir / guardar PDF</button>
	        <header>
	          <div class="brand-block"><img class="brand-logo" src="/assets/logo.png" alt="MARFAN CREW" /><div><div class="brand">MARFAN CREW ERP</div><div class="muted">Albaran A4 por evento</div></div></div>
	          <div><strong>${escHtml(event.id)}</strong><br /><span class="muted">${escHtml(event.date)}</span></div>
	        </header>
        <h1>${escHtml(event.name)}</h1>
        <p class="muted">${escHtml(event.client_name)} · ${escHtml(event.location)}</p>
        <section class="grid">
          <div><strong>Fecha</strong><br />${escHtml(event.date)}</div>
          <div><strong>Horario</strong><br />${escHtml(event.start_time)} - ${escHtml(event.end_time)}</div>
          <div><strong>Direccion</strong><br />${escHtml(event.address || event.location)}</div>
          <div><strong>Jefe de equipo</strong><br />${escHtml(event.team_leader_name || "Pendiente")}</div>
          <div><strong>Precio del servicio</strong><br />${servicePrice.toFixed(2)} EUR</div>
          <div><strong>Estado albaran</strong><br />${note.locked ? "Firmado y bloqueado" : "Pendiente de firma"}</div>
          <div><strong>Base de calculo</strong><br />${escHtml(pricingContext.baseAddress)}</div>
          <div><strong>Distancia desde base</strong><br />${Number(event.base_distance_km || 0).toFixed(1)} km</div>
          <div><strong>Km incluidos</strong><br />${pricingContext.includedKm.toFixed(1)} km</div>
          <div><strong>Km facturables</strong><br />${Number(event.billable_km || 0).toFixed(1)} km · ${Number(event.vehicle_count || 1)} veh. · ${pricingContext.kilometrePrice.toFixed(2)} EUR/km</div>
          <div><strong>Roles y nocturnidad</strong><br />${Number(event.role_price_total || 0).toFixed(2)} EUR + ${Number(event.night_price_total || 0).toFixed(2)} EUR</div>
          <div><strong>Kilometraje</strong><br />${Number(event.distance_price_total || 0).toFixed(2)} EUR</div>
        </section>
        <h2>Operarios, horarios y pluses</h2>
        <table>
          <thead><tr><th>Operario</th><th>Rol</th><th>Horario</th><th>Km</th><th>Dieta</th><th>Noct.</th><th>Extras</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='7'>Sin operarios asignados</td></tr>"}</tbody>
        </table>
        <h2>Notas</h2>
        <p>${escHtml(event.notes || "")}</p>
        <section class="signature">
          <div class="box">
            <strong>Firma cliente</strong>
            ${note.signature_image ? `<img class="signature-img" src="${escHtml(note.signature_image)}" alt="Firma cliente" />` : "<br /><br />"}
            Nombre: ${escHtml(note.signature_name || "")}<br />
            DNI: ${escHtml(note.signature_dni || "")}
          </div>
          <div class="box">
            <strong>Bloqueo tras firma</strong><br /><br />
            Estado: ${note.locked ? "Bloqueado" : "Abierto"}<br />
            Fecha: ${escHtml(note.signed_at || "")}<br />
            Observaciones: ${escHtml(note.client_notes || "")}
          </div>
        </section>
      </body>
    </html>`;
}

function documentStatusLabel(status) {
  const labels = {
    vigente: "Vigente",
    proximo: "Proximo a caducar",
    caducado: "Caducado",
    pendiente: "Pendiente"
  };
  return labels[status] || "Pendiente";
}

function clientDossierData(event) {
  const client = get("SELECT * FROM clients WHERE id = ?", [event.client_id]) || {};
  const assignments = (event.assignments || []).filter((assignment) => assignment.status !== "bloqueado");
  const rows = assignments.map((assignment) => {
    const documents = listDocuments({ employeeId: assignment.employee_id });
    const blockers = documents.filter((document) => ["caducado", "pendiente"].includes(document.status));
    const warnings = documents.filter((document) => document.status === "proximo");
    return {
      assignment,
      documents,
      blockers,
      warnings,
      status: blockers.length ? "bloqueado" : warnings.length ? "aviso" : "ok"
    };
  });
  return {
    event,
    client,
    rows,
    totals: {
      staff: rows.length,
      documents: rows.reduce((sum, row) => sum + row.documents.length, 0),
      blockers: rows.reduce((sum, row) => sum + row.blockers.length, 0),
      warnings: rows.reduce((sum, row) => sum + row.warnings.length, 0)
    }
  };
}

function clientDossierPdf(event) {
  const dossier = clientDossierData(event);
  const lines = [
    `Dossier cliente - ${event.name}`,
    `MARFAN CREW ERP · Generado: ${new Date().toLocaleString("es-ES")}`,
    `Evento: ${event.id} · Fecha: ${event.date} · Horario: ${event.start_time}-${event.end_time}`,
    `Cliente: ${dossier.client.name || event.client_name} · CIF/NIF: ${dossier.client.tax_id || ""}`,
    `Ubicacion: ${event.location} · Direccion: ${event.address || event.location}`,
    `Jefe de equipo: ${event.team_leader_name || "Pendiente"}`,
    `Precio servicio: ${Number(event.service_price || event.budget || 0).toFixed(2)} EUR`,
    "",
    `Equipo: ${dossier.totals.staff} operarios · Documentos: ${dossier.totals.documents} · Bloqueos: ${dossier.totals.blockers} · Avisos: ${dossier.totals.warnings}`,
    "",
    "Operario | Rol | Estado docs | Documentacion"
  ];
  for (const row of dossier.rows.slice(0, 24)) {
    const docs = row.documents.length
      ? row.documents.map((document) => {
        const file = document.has_file ? " archivo" : "";
        return `${document.type}:${documentStatusLabel(document.status)}${document.expires_at ? ` ${document.expires_at}` : ""}${file}`;
      }).join(", ")
      : "Sin documentos";
    lines.push([
      row.assignment.name,
      row.assignment.role,
      row.status === "bloqueado" ? "Con bloqueos" : row.status === "aviso" ? "Con avisos" : "OK",
      docs
    ].join(" | "));
  }
  if (dossier.rows.length > 24) lines.push(`... ${dossier.rows.length - 24} operarios adicionales`);
  if (!dossier.rows.length) lines.push("Sin operarios asignados");
  lines.push("", "Nota: este dossier resume estado documental y equipo asignado. Los archivos originales permanecen protegidos en MARFAN CREW ERP.");
  return createPdfLines(`Dossier ${event.name}`, lines);
}

function clientDossierHtml(event) {
  const dossier = clientDossierData(event);
  const rows = dossier.rows.map((row) => `
    <tr>
      <td>
        <strong>${escHtml(row.assignment.name)}</strong><br />
        <span class="muted">${escHtml(row.assignment.phone || row.assignment.email || "")}</span>
      </td>
      <td>${escHtml(row.assignment.role)}</td>
      <td><span class="tag ${row.status}">${row.status === "bloqueado" ? "Con bloqueos" : row.status === "aviso" ? "Con avisos" : "OK"}</span></td>
      <td>
        ${row.documents.length ? row.documents.map((document) => `
          <div class="doc-line">
            <strong>${escHtml(document.type)}</strong>
            <span>${escHtml(documentStatusLabel(document.status))}</span>
            <small>${escHtml(document.expires_at || "Sin caducidad")}</small>
            ${document.has_file ? `<a href="/api/documents/${encodeURIComponent(document.id)}/file" target="_blank" rel="noopener">Abrir archivo</a>` : "<em>Sin archivo</em>"}
          </div>
        `).join("") : "<span class=\"muted\">Sin documentos registrados</span>"}
      </td>
    </tr>
  `).join("");
  return `<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Dossier cliente ${escHtml(event.name)}</title>
        <style>
          @page { size: A4; margin: 16mm; }
          body { font-family: Arial, sans-serif; color: #101828; margin: 0; }
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #101828; padding-bottom: 16px; margin-bottom: 18px; align-items: center; }
          .brand-block { display: flex; align-items: center; gap: 14px; }
          .brand-logo { width: 58px; height: 58px; object-fit: contain; }
          h1 { margin: 0; font-size: 28px; }
          h2 { font-size: 16px; margin: 22px 0 8px; }
          .brand { font-weight: 800; letter-spacing: 0; }
          .muted { color: #667085; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
          .metric { border: 1px solid #d0d5dd; padding: 10px; }
          .metric span { display: block; color: #667085; font-size: 11px; text-transform: uppercase; font-weight: 700; }
          .metric strong { display: block; margin-top: 4px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #d0d5dd; padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
          th { background: #f2f4f7; }
          .tag { display: inline-block; padding: 4px 8px; border-radius: 999px; font-weight: 800; font-size: 11px; }
          .tag.ok { color: #067647; background: #dcfae6; }
          .tag.aviso { color: #b54708; background: #fef0c7; }
          .tag.bloqueado { color: #b42318; background: #fee4e2; }
          .doc-line { display: grid; grid-template-columns: 90px 1fr 90px 86px; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eaecf0; align-items: center; }
          .doc-line a { color: #101828; font-weight: 800; text-decoration: none; border-bottom: 1px solid #101828; }
          .doc-line em { color: #98a2b3; font-style: normal; }
          .note { border: 1px solid #d0d5dd; padding: 12px; margin-top: 18px; background: #f9fafb; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Imprimir / guardar PDF</button>
        <header>
          <div class="brand-block"><img class="brand-logo" src="/assets/logo.png" alt="MARFAN CREW" /><div><div class="brand">MARFAN CREW ERP</div><div class="muted">Dossier operativo para cliente</div></div></div>
          <div><strong>${escHtml(event.id)}</strong><br /><span class="muted">${escHtml(new Date().toLocaleString("es-ES"))}</span></div>
        </header>
        <h1>${escHtml(event.name)}</h1>
        <p class="muted">${escHtml(dossier.client.name || event.client_name)} · ${escHtml(event.location)}</p>
        <section class="grid">
          <div class="metric"><span>Fecha</span><strong>${escHtml(event.date)}</strong></div>
          <div class="metric"><span>Horario</span><strong>${escHtml(event.start_time)}-${escHtml(event.end_time)}</strong></div>
          <div class="metric"><span>Equipo</span><strong>${dossier.totals.staff}</strong></div>
          <div class="metric"><span>Precio</span><strong>${Number(event.service_price || event.budget || 0).toFixed(2)} EUR</strong></div>
          <div class="metric"><span>Documentos</span><strong>${dossier.totals.documents}</strong></div>
          <div class="metric"><span>Bloqueos</span><strong>${dossier.totals.blockers}</strong></div>
          <div class="metric"><span>Avisos</span><strong>${dossier.totals.warnings}</strong></div>
          <div class="metric"><span>Jefe equipo</span><strong>${escHtml(event.team_leader_name || "Pendiente")}</strong></div>
        </section>
        <h2>Datos del cliente y servicio</h2>
        <p>
          Cliente: <strong>${escHtml(dossier.client.legal_name || dossier.client.name || event.client_name)}</strong><br />
          CIF/NIF: ${escHtml(dossier.client.tax_id || "-")}<br />
          Contacto: ${escHtml(dossier.client.contact_name || "-")} · ${escHtml(dossier.client.email || dossier.client.phone || "-")}<br />
          Direccion evento: ${escHtml(event.address || event.location)}
        </p>
        <h2>Equipo asignado y documentacion</h2>
        <table>
          <thead><tr><th>Operario</th><th>Rol</th><th>Estado</th><th>Documentacion</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='4'>Sin operarios asignados</td></tr>"}</tbody>
        </table>
        <div class="note">
          Este dossier resume equipo, roles y estado documental del evento. Los archivos adjuntos se abren desde MARFAN y requieren una sesion autorizada.
        </div>
      </body>
    </html>`;
}

function escHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function handleApi(req, res, url) {
  const user = currentUser(req);
  const method = req.method;
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, name: "MARFAN CREW ERP" });
  }

  if (pathname === "/api/public/config" && method === "GET") {
    return sendJson(res, 200, {
      appName: "MARFAN CREW ERP",
      demoMode: DEMO_MODE,
      demoAccounts: DEMO_MODE
        ? {
            admin: { identifier: "admin@marfancrew.test", password: "admin123" },
            employee: { identifier: "600777888", password: "empleado123" }
          }
        : null
    });
  }

  if (pathname === "/api/calendar/google-oauth/callback" && method === "GET") {
    return handleGoogleOAuthCallback(req, res, url);
  }

  enforceAdminRoutePermission(user, pathname, method);

  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readBody(req);
    const rateKey = assertAuthRateLimit(req, "login", body.identifier);
    const account = findActiveLoginAccount(body.identifier);
    if (!account || !verifyPassword(body.password || "", account.salt, account.password_hash)) {
      recordAuthFailure(rateKey);
      return sendJson(res, 401, { error: "Credenciales incorrectas" });
    }
    if (body.mode === "employee" && account.role !== "employee") {
      recordAuthFailure(rateKey);
      return sendJson(res, 403, { error: "Usa el login de administrador" });
    }
    if (body.mode === "admin" && account.role === "employee") {
      recordAuthFailure(rateKey);
      return sendJson(res, 403, { error: "Usa el login de empleado" });
    }
    clearAuthFailures(req, "login", body.identifier);

    const token = randomToken();
    const days = body.remember ? 30 : 1;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
      sessionStorageToken(token),
      account.id,
      expiresAt
    ]);
    run("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [account.id]);
    audit(account, "login_success", "session", account.id, {
      mode: body.mode || "admin",
      remember: Boolean(body.remember)
    });
    return send(res, 200, { token, user: publicUser(account), expiresAt }, {
      ...JSON_HEADERS,
      "set-cookie": sessionCookie(token, expiresAt, req)
    });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = tokenFromRequest(req, { allowCookie: true });
    if (user) audit(user, "logout", "session", user.id);
    if (token) {
      const candidates = sessionTokenCandidates(token);
      run(`DELETE FROM sessions WHERE token IN (${candidates.map(() => "?").join(",")})`, candidates);
    }
    return send(res, 200, { ok: true }, {
      ...JSON_HEADERS,
      "set-cookie": clearSessionCookie(req)
    });
  }

  if (pathname === "/api/auth/recover" && method === "POST") {
    const body = await readBody(req);
    const rateKey = assertAuthRateLimit(req, "recover", body.identifier);
    const account = findActiveLoginAccount(body.identifier);
    let resetCode = null;
    if (account) {
      clearAuthFailures(req, "recover", body.identifier);
      resetCode = recoveryCode();
      const token = hashPassword(resetCode);
      const resetId = randomId("rst");
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      transaction(() => {
        run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [
          account.id
        ]);
        run(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, salt, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [resetId, account.id, token.hash, token.salt, expiresAt]
        );
        audit(user, "password_recovery_requested", "user", account.id, {
          requestedAt: new Date().toISOString(),
          resetId,
          expiresAt
        });
      });
    } else {
      recordAuthFailure(rateKey);
    }
    return sendJson(res, 200, {
      ok: true,
      message: "Si el usuario existe, oficina recibira una solicitud de recuperacion.",
      recoveryCode: DEMO_MODE ? resetCode : undefined,
      expiresInMinutes: DEMO_MODE && resetCode ? 20 : undefined
    });
  }

  if (pathname === "/api/auth/reset-password" && method === "POST") {
    const body = await readBody(req);
    const code = String(body.recoveryCode || body.code || "").trim().toUpperCase();
    const password = String(body.password || "");
    const rateKey = assertAuthRateLimit(req, "reset", code || "empty");
    if (!code) {
      recordAuthFailure(rateKey);
      return sendJson(res, 400, { error: "Codigo obligatorio" });
    }
    const safePassword = validateNewPassword(password);
    const reset = findValidRecoveryToken(code);
    if (!reset) {
      recordAuthFailure(rateKey);
      return sendJson(res, 400, { error: "Codigo caducado o no valido" });
    }
    clearAuthFailures(req, "reset", code || "empty");
    const credentials = hashPassword(safePassword);
    transaction(() => {
      run(
        `UPDATE users
         SET password_hash = ?, salt = ?
         WHERE id = ?`,
        [credentials.hash, credentials.salt, reset.user_id]
      );
      run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [reset.id]);
      run("DELETE FROM sessions WHERE user_id = ?", [reset.user_id]);
      audit(user, "password_reset_completed", "user", reset.user_id, {
        resetId: reset.id,
        completedAt: new Date().toISOString()
      });
    });
    return sendJson(res, 200, { ok: true, message: "Contrasena actualizada. Ya puedes iniciar sesion." });
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    requireUser(user);
    return sendJson(res, 200, { user });
  }

  if (pathname === "/api/settings" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, {
      settings: settingsForAdmin(),
      roles: listWorkRoles()
    });
  }

  if (pathname === "/api/maps/resolve" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const result = await resolveGoogleMapsUrl(body.url || "");
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/settings" && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const allowed = [
      "base_address",
      "base_lat",
      "base_lng",
      "included_km",
      "vehicle_km_price",
      "office_phone",
      "office_whatsapp",
      "google_calendar_id",
      "google_calendar_api_key",
      "google_calendar_public_ics_url",
      "google_calendar_embed_url",
      "google_calendar_enabled",
      "google_calendar_sync_enabled",
      "google_calendar_service_account_json",
      "google_calendar_delegated_user",
      "google_calendar_oauth_client_json",
      "backup_auto_enabled",
      "backup_auto_interval_hours",
      "backup_auto_retention_days",
      "backup_auto_retention_count",
      "clock_radius_m",
      "clock_entry_early_minutes",
      "clock_exit_late_minutes",
      "incident_absence_grace_minutes"
    ];
    transaction(() => {
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        if ([
          "google_calendar_api_key",
          "google_calendar_public_ics_url",
          "google_calendar_service_account_json",
          "google_calendar_oauth_client_json"
        ].includes(key) && !String(body[key] || "").trim()) continue;
        run(
          `INSERT INTO company_settings (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
          [key, String(body[key] ?? "")]
        );
      }
      audit(user, "settings_updated", "company_settings", "global", sanitizeSettingsAudit(body));
    });
    repriceOpenEvents();
    return sendJson(res, 200, { settings: settingsForAdmin(), roles: listWorkRoles() });
  }

  if (pathname === "/api/calendar/google-oauth/start" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const settings = settingMap();
    const client = googleOAuthClientCredentials(settings, { throwOnInvalid: true });
    if (!client) return sendJson(res, 400, { error: "Falta configurar el cliente OAuth de Google" });
    const appOrigin = safeBrowserOrigin(body.returnUrl) || appOriginFromRequest(req);
    const appUrl = appOrigin;
    const redirectUri = `${appOrigin}/api/calendar/google-oauth/callback`;
    try {
      assertGoogleOAuthRedirectAllowed(client, redirectUri);
    } catch (error) {
      return sendJson(res, error.status || 400, {
        error: error.message,
        code: error.code || "google_oauth_redirect_error",
        redirectUri: error.redirectUri || redirectUri,
        suggestedRedirectUris: error.suggestedRedirectUris || googleOAuthSuggestedRedirectUris(redirectUri),
        authorizedRedirectUris: error.authorizedRedirectUris || [],
        clientType: error.clientType || client.client_type || ""
      });
    }
    const result = startGoogleOAuthWebFlow({ client, actor: user, appUrl, redirectUri });
    return sendJson(res, 200, {
      ...result,
      suggestedRedirectUris: googleOAuthSuggestedRedirectUris(redirectUri),
      authorizedRedirectUris: googleOAuthRedirectUris(client),
      clientType: client.client_type || ""
    });
  }

  if (pathname === "/api/calendar/google-sync/retry" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    if (body.eventId) {
      const event = eventDetail(body.eventId);
      if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
      const googleSync = await syncEventToGoogleCalendar(event.id, user, "manual_retry", appOriginFromRequest(req));
      return sendJson(res, 200, { event: eventDetail(event.id), googleSync, summary: googleSyncSummary() });
    }

    const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
    const from = body.from || formatDate();
    const rows = all(
      `SELECT id
       FROM events
       WHERE date >= ?
         AND (
           google_sync_status IS NULL
           OR google_sync_status IN ('pending', 'pending_auth', 'error', 'imported', 'disabled')
           OR google_calendar_event_id IS NULL
         )
       ORDER BY date ASC, start_time ASC
       LIMIT ?`,
      [from, limit]
    );
    const results = [];
    for (const row of rows) {
      const googleSync = await syncEventToGoogleCalendar(row.id, user, "manual_bulk_retry", appOriginFromRequest(req));
      results.push({ eventId: row.id, status: googleSync.status, error: googleSync.error || "" });
    }
    return sendJson(res, 200, {
      processed: results.length,
      synced: results.filter((item) => item.status === "synced").length,
      pendingAuth: results.filter((item) => item.status === "pending_auth").length,
      failed: results.filter((item) => item.status === "error").length,
      disabled: results.filter((item) => item.status === "disabled").length,
      results,
      summary: googleSyncSummary()
    });
  }

  if (pathname === "/api/work-roles" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { roles: listWorkRoles() });
  }

  if (pathname === "/api/work-roles" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { error: "Nombre de rol obligatorio" });
    const id = randomId("role");
    run(
      `INSERT INTO work_roles (id, name, base_price, night_price, active)
       VALUES (?, ?, ?, ?, ?)`,
      [id, body.name, Number(body.basePrice || 0), Number(body.nightPrice || 0), body.active === false ? 0 : 1]
    );
    audit(user, "work_role_created", "work_role", id, { name: body.name });
    repriceOpenEvents();
    return sendJson(res, 201, { role: get("SELECT * FROM work_roles WHERE id = ?", [id]) });
  }

  const workRoleMatch = pathname.match(/^\/api\/work-roles\/([^/]+)$/);
  if (workRoleMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM work_roles WHERE id = ?", [workRoleMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Rol no encontrado" });
    run(
      `UPDATE work_roles
       SET name = ?, base_price = ?, night_price = ?, active = ?
       WHERE id = ?`,
      [
        body.name ?? existing.name,
        Number(body.basePrice ?? existing.base_price),
        Number(body.nightPrice ?? existing.night_price),
        body.active === undefined ? existing.active : (body.active ? 1 : 0),
        existing.id
      ]
    );
    audit(user, "work_role_updated", "work_role", existing.id, body);
    repriceOpenEvents();
    return sendJson(res, 200, { role: get("SELECT * FROM work_roles WHERE id = ?", [existing.id]) });
  }

  if (pathname === "/api/users" && method === "GET") {
    requireAdmin(user);
    const users = listUsers();
    return sendJson(res, 200, {
      users: user.role === "super_admin" ? users : users.filter((item) => item.role !== "employee")
    });
  }

  if (pathname === "/api/audit-logs" && method === "GET") {
    requireSuperAdmin(user);
    const logs = listAuditLogs({
      action: url.searchParams.get("action"),
      entity: url.searchParams.get("entity"),
      actorUserId: url.searchParams.get("actorId"),
      limit: url.searchParams.get("limit")
    });
    if (url.searchParams.get("format") === "csv") {
      const rows = logs.map((item) => ({
        fecha: item.created_at,
        actor: item.actor_name,
        rol: item.actor_role,
        accion: item.action,
        entidad: item.entity,
        entidad_id: item.entity_id,
        detalle: JSON.stringify(item.metadata)
      }));
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=auditoria.csv"
      });
    }
    return sendJson(res, 200, { logs });
  }

  if (pathname === "/api/users" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const requestedRole = ["super_admin", "admin", "employee"].includes(body.role) ? body.role : "admin";
    const role = user.role === "super_admin" ? requestedRole : "admin";
    const email = cleanContactEmail(body.email);
    const phone = cleanContactPhone(body.phone);
    if (!body.name || !body.password || (!email && !phone)) {
      return sendJson(res, 400, { error: "Nombre, contrasena y email o telefono son obligatorios" });
    }
    const safePassword = validateNewPassword(body.password);
    validateUserContact({ email, phone });
    const credentials = hashPassword(safePassword);
    const id = randomId("usr");
    const permissions = user.role === "super_admin"
      ? permissionsFromBody(body, role)
      : normalizeAdminPermissions(null, role);
    transaction(() => {
      run(
        `INSERT INTO users (id, role, name, email, phone, password_hash, salt, permissions_json, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          role,
          body.name,
          email || null,
          phone || null,
          credentials.hash,
          credentials.salt,
          JSON.stringify(permissions)
        ]
      );

      if (role === "employee") {
        const employeeId = randomId("emp");
        run(
          `INSERT INTO employees
            (id, user_id, name, role, phone, email, city, lat, lng, hourly_rate, diet_rate, skills, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            employeeId,
            id,
            body.name,
            body.employeeRole || "Montaje",
            phone || "",
            email || "",
            body.city || "",
            Number(body.lat || 40.4168),
            Number(body.lng || -3.7038),
            Number(body.hourlyRate || 15),
            Number(body.dietRate || 0),
            JSON.stringify(body.skills || []),
            "Creado desde usuarios Super Admin"
          ]
        );
      }

      audit(user, "user_created", "user", id, { role, permissions });
    });
    return sendJson(res, 201, { user: listUsers().find((item) => item.id === id) });
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "PATCH") {
    requireSuperAdmin(user);
    const targetId = userMatch[1];
    const body = await readBody(req);
    const role = body.role && ["super_admin", "admin", "employee"].includes(body.role) ? body.role : undefined;
    const nextActive = body.active === undefined ? undefined : Boolean(body.active);
    const target = ensureCanChangeUser(user, targetId, role, nextActive);
    const password = body.password ? hashPassword(validateNewPassword(body.password)) : null;
    const finalRole = role || target.role;
    const permissions = permissionsFromBody(body, finalRole, target.permissions_json);
    const linkedEmployee = get("SELECT id FROM employees WHERE user_id = ?", [targetId]);
    const nextEmail = body.email === undefined ? cleanContactEmail(target.email) : cleanContactEmail(body.email);
    const nextPhone = body.phone === undefined ? cleanContactPhone(target.phone) : cleanContactPhone(body.phone);
    if (!nextEmail && !nextPhone) {
      return sendJson(res, 400, { error: "Email o telefono obligatorio" });
    }
    validateUserContact({
      userId: targetId,
      employeeId: linkedEmployee?.id || "",
      email: nextEmail,
      phone: nextPhone
    });
    transaction(() => {
      run(
        `UPDATE users
         SET role = ?, name = ?, email = ?, phone = ?, active = ?,
             password_hash = COALESCE(?, password_hash),
             salt = COALESCE(?, salt),
             permissions_json = ?
         WHERE id = ?`,
        [
          finalRole,
          body.name ?? target.name,
          nextEmail,
          nextPhone,
          nextActive === undefined ? target.active : (nextActive ? 1 : 0),
          password?.hash || null,
          password?.salt || null,
          JSON.stringify(permissions),
          targetId
        ]
      );

      if (finalRole === "employee" && !linkedEmployee) {
        run(
          `INSERT INTO employees
            (id, user_id, name, role, phone, email, city, lat, lng, hourly_rate, diet_rate, skills, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId("emp"),
            targetId,
            body.name ?? target.name,
            body.employeeRole || "Montaje",
            nextPhone || "",
            nextEmail || "",
            body.city || "",
            Number(body.lat || 40.4168),
            Number(body.lng || -3.7038),
            Number(body.hourlyRate || 15),
            Number(body.dietRate || 0),
            JSON.stringify(body.skills || []),
            "Ficha creada al cambiar permisos desde Super Admin"
          ]
        );
      }

      if (nextActive === false || password) run("DELETE FROM sessions WHERE user_id = ?", [targetId]);
      if (password) {
        run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [
          targetId
        ]);
      }
      audit(user, "user_updated", "user", targetId, {
        role: finalRole,
        active: nextActive === undefined ? Boolean(target.active) : nextActive,
        passwordChanged: Boolean(password),
        permissions
      });
    });
    return sendJson(res, 200, { user: listUsers().find((item) => item.id === targetId) });
  }

  if (userMatch && method === "DELETE") {
    requireSuperAdmin(user);
    const targetId = userMatch[1];
    ensureCanChangeUser(user, targetId, undefined, false);
    transaction(() => {
      run("UPDATE users SET active = 0 WHERE id = ?", [targetId]);
      run("DELETE FROM sessions WHERE user_id = ?", [targetId]);
      audit(user, "user_deactivated", "user", targetId);
    });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/dashboard" && method === "GET") {
    requireAdmin(user);
    const attendanceDetection = autoDetectAttendanceIncidents({ date: formatDate(), actor: user });
    return sendJson(res, 200, dashboardPayload(attendanceDetection));
  }

  if (pathname === "/api/live" && method === "GET") {
    requireAdmin(user);
    const date = url.searchParams.get("date") || formatDate();
    const attendanceDetection = autoDetectAttendanceIncidents({ date, actor: user });
    return sendJson(res, 200, livePayload(date, attendanceDetection));
  }

  if (pathname === "/api/calendar" && method === "GET") {
    requireAdmin(user);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const localEvents = listEvents({ from, to }).map((event) => ({ ...event, source: "marfan", external: false }));
    const importedGoogleUids = new Set(localEvents.map((event) => event.google_calendar_uid).filter(Boolean));
    const google = await googleCalendarEvents({ from, to });
    const googleEvents = google.events.filter((event) => {
      const googleUid = event.google_uid || event.id;
      return !importedGoogleUids.has(googleUid) && !importedGoogleUids.has(event.id);
    });
    return sendJson(res, 200, {
      events: [...localEvents, ...googleEvents].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`)),
      localEvents,
      googleEvents,
      googleStatus: { ...google, events: googleEvents }
    });
  }

  if (pathname === "/api/calendar/import-google-event" && method === "POST") {
    requireAdmin(user);
    const result = importGoogleCalendarEvent(await readBody(req), user);
    return sendJson(res, result.created ? 201 : 200, result);
  }

  if (pathname === "/api/calendar/import-google-events" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const incoming = Array.isArray(body.events) ? body.events : [];
    const events = incoming.slice(0, 100).filter((item) => item && typeof item === "object");
    const results = events.map((item) => importGoogleCalendarEvent(item, user));
    const created = results.filter((item) => item.created).length;
    const existing = results.length - created;
    audit(user, "google_events_bulk_imported", "event", "bulk", {
      requested: incoming.length,
      processed: results.length,
      created,
      existing
    });
    return sendJson(res, 200, {
      processed: results.length,
      created,
      existing,
      events: results.map((item) => item.event)
    });
  }

  if (pathname === "/api/calendar/marfan.ics" && method === "GET") {
    const settings = settingMap();
    if (url.searchParams.get("token") !== settings.calendar_feed_token) {
      return sendJson(res, 403, { error: "Token de calendario no valido" });
    }
    const events = listEvents();
    return send(res, 200, createMarfanCalendarIcs(events, appOriginFromRequest(req)), {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "inline; filename=marfan-crew.ics",
      "cache-control": "private, max-age=300"
    });
  }

  if (pathname === "/api/imports" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, {
      imports: all("SELECT * FROM data_imports ORDER BY created_at DESC LIMIT 50").map((item) => ({
        ...item,
        metadata: jsonField(item.metadata, {})
      }))
    });
  }

  if (pathname === "/api/imports/templates/employees" && method === "GET") {
    requireAdmin(user);
    return send(res, 200, importTemplateCsv(EMPLOYEE_IMPORT_HEADERS), {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=plantilla-operarios-marfan.csv"
    });
  }

  if (pathname === "/api/imports/templates/clients" && method === "GET") {
    requireAdmin(user);
    return send(res, 200, importTemplateCsv(CLIENT_IMPORT_HEADERS), {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=plantilla-clientes-marfan.csv"
    });
  }

  if (pathname === "/api/imports/employees" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    if (!String(body.fileText || body.fileDataBase64 || "").trim()) return sendJson(res, 400, { error: "Archivo CSV, TSV o Excel obligatorio" });
    const result = importEmployeesCsv({
      text: body.fileText,
      source: body.fileName || "operarios.csv",
      fileMime: body.fileMime,
      fileDataBase64: body.fileDataBase64,
      defaultPassword: body.defaultPassword || "Marfan2026!",
      actor: user
    });
    return sendJson(res, 201, result);
  }

  if (pathname === "/api/imports/clients" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    if (!String(body.fileText || body.fileDataBase64 || "").trim()) return sendJson(res, 400, { error: "Archivo CSV, TSV o Excel obligatorio" });
    const result = importClientsCsv({
      text: body.fileText,
      source: body.fileName || "clientes.csv",
      fileMime: body.fileMime,
      fileDataBase64: body.fileDataBase64,
      actor: user
    });
    return sendJson(res, 201, result);
  }

  if (pathname === "/api/events" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { events: listEvents({ search: url.searchParams.get("search") }) });
  }

  if (pathname === "/api/events" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const id = randomId("evt");
    const coords = eventCoordinatesFromBody(body);
    const storedRequirements = normalizeRequirements(body.requirements, body.requiredTotal || 1);
    const requiredTotal = storedRequirements.reduce((sum, requirement) => sum + requirement.count, 0);
    const vehicleCount = Math.max(Number(body.vehicleCount || 1), 0);
    const pricing = calculateServicePricing({
      startTime: body.startTime,
      endTime: body.endTime,
      lat: coords.lat,
      lng: coords.lng,
      requirements: storedRequirements,
      vehicleCount
    });
    const budget = body.budget === undefined || body.budget === "" ? pricing.servicePrice : Number(body.budget || pricing.servicePrice);
    transaction(() => {
      run(
        `INSERT INTO events
          (id, name, client_id, date, start_time, end_time, location, address, lat, lng, team_leader_id,
           required_total, status, notes, budget, google_maps_url, vehicle_count, base_distance_km, billable_km,
           kilometre_price, role_price_total, night_price_total, distance_price_total, service_price, location_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          body.name,
          body.clientId,
          body.date,
          body.startTime,
          body.endTime,
          body.location,
          body.address || body.location,
          coords.lat,
          coords.lng,
          body.teamLeaderId || null,
          requiredTotal,
          "falta_personal",
          body.notes || "",
          budget,
          body.googleMapsUrl || "",
          vehicleCount || 1,
          pricing.baseDistanceKm,
          pricing.billableKm,
          pricing.kilometrePrice,
          pricing.rolePriceTotal,
          pricing.nightPriceTotal,
          pricing.distancePriceTotal,
          pricing.servicePrice,
          coords.source
        ]
      );
      for (const requirement of storedRequirements) {
        run("INSERT INTO event_requirements (id, event_id, role, count) VALUES (?, ?, ?, ?)", [
          randomId("req"),
          id,
          requirement.role,
          Number(requirement.count || 1)
        ]);
      }
      ensureDraftDeliveryNote({ id, service_price: pricing.servicePrice, budget });
      updateEventStatus(id);
      audit(user, "event_created", "event", id, {
        name: body.name,
        clientId: body.clientId,
        date: body.date,
        requiredTotal,
        servicePrice: pricing.servicePrice
      });
      createEventSnapshot(id, "event_created", user, {
        name: body.name,
        clientId: body.clientId,
        date: body.date,
        requiredTotal,
        servicePrice: pricing.servicePrice
      });
    });
    const googleSync = await syncEventToGoogleCalendar(id, user, "event_created", appOriginFromRequest(req));
    return sendJson(res, 201, { event: eventDetail(id), googleSync });
  }

  const eventMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === "GET") {
    requireAdmin(user);
    const event = eventDetail(eventMatch[1]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    return sendJson(res, 200, { event });
  }

  if (eventMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const eventId = eventMatch[1];
    const existing = eventWithDeliveryState(eventId);
    if (!existing) return sendJson(res, 404, { error: "Evento no encontrado" });
    if (deliveryNoteLocked(existing)) {
      return sendJson(res, 409, { error: "Albaran firmado: no se puede modificar el evento" });
    }
    if (eventPerformed(existing)) {
      return sendJson(res, 409, { error: "Evento efectuado: solo se permite revisar o crear incidencias" });
    }
    const locationFieldsSubmitted = ["googleMapsUrl", "mapsUrl", "lat", "lng"].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key)
    );
    const coords = locationFieldsSubmitted
      ? eventCoordinatesFromBody(body)
      : { lat: existing.lat, lng: existing.lng, source: existing.location_source || null };
    const nextRequirements = body.requirements
      ? normalizeRequirements(body.requirements, body.requiredTotal || existing.required_total)
      : all("SELECT role, count FROM event_requirements WHERE event_id = ?", [eventId]);
    const requiredTotal = nextRequirements.reduce((sum, requirement) => sum + Number(requirement.count || 0), 0) || Number(body.requiredTotal ?? existing.required_total);
    transaction(() => {
      run(
        `UPDATE events
         SET name = ?, client_id = ?, date = ?, start_time = ?, end_time = ?, location = ?, address = ?, lat = ?, lng = ?,
             team_leader_id = ?, required_total = ?, notes = ?, budget = ?, google_maps_url = ?, vehicle_count = ?,
             location_source = ?
         WHERE id = ?`,
        [
          body.name ?? existing.name,
          body.clientId ?? existing.client_id,
          body.date ?? existing.date,
          body.startTime ?? existing.start_time,
          body.endTime ?? existing.end_time,
          body.location ?? existing.location,
          body.address ?? existing.address,
          coords.lat,
          coords.lng,
          body.teamLeaderId === "" ? null : (body.teamLeaderId ?? existing.team_leader_id),
          requiredTotal,
          body.notes ?? existing.notes,
          body.budget === "" || body.budget === undefined ? existing.budget : Number(body.budget),
          body.googleMapsUrl ?? existing.google_maps_url,
          Number(body.vehicleCount ?? existing.vehicle_count ?? 1),
          coords.source,
          eventId
        ]
      );
      if (body.requirements) {
        run("DELETE FROM event_requirements WHERE event_id = ?", [eventId]);
        for (const requirement of nextRequirements) {
          run("INSERT INTO event_requirements (id, event_id, role, count) VALUES (?, ?, ?, ?)", [
            randomId("req"),
            eventId,
            requirement.role,
            Number(requirement.count || 1)
          ]);
        }
      }
    });
    updateEventPricing(eventId, pricingForEvent(eventId));
    updateEventStatus(eventId);
    audit(user, "event_updated", "event", eventId, {
      requirementsChanged: Boolean(body.requirements),
      requiredTotal
    });
    createEventSnapshot(eventId, "event_updated", user, {
      requirementsChanged: Boolean(body.requirements),
      requiredTotal
    });
    const googleSync = await syncEventToGoogleCalendar(eventId, user, "event_updated", appOriginFromRequest(req));
    return sendJson(res, 200, { event: eventDetail(eventId), googleSync });
  }

  if (eventMatch && method === "DELETE") {
    requireSuperAdmin(user);
    const event = eventDetail(eventMatch[1]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    const documentFiles = listEventDocuments({ eventId: event.id })
      .map((document) => documentFilePath(document))
      .filter(Boolean);
    const counts = {
      assignments: get("SELECT COUNT(*) AS count FROM assignments WHERE event_id = ?", [event.id]).count,
      timeEntries: get("SELECT COUNT(*) AS count FROM time_entries WHERE event_id = ?", [event.id]).count,
      incidents: get("SELECT COUNT(*) AS count FROM incidents WHERE event_id = ?", [event.id]).count,
      documents: get("SELECT COUNT(*) AS count FROM event_documents WHERE event_id = ?", [event.id]).count,
      snapshots: get("SELECT COUNT(*) AS count FROM event_snapshots WHERE event_id = ?", [event.id]).count,
      deliveryNotes: get("SELECT COUNT(*) AS count FROM delivery_notes WHERE event_id = ?", [event.id]).count
    };
    transaction(() => {
      audit(user, "event_deleted", "event", event.id, {
        name: event.name,
        clientId: event.client_id,
        clientName: event.client_name,
        date: event.date,
        startTime: event.start_time,
        endTime: event.end_time,
        googleCalendarEventId: event.google_calendar_event_id || "",
        googleCalendarUid: event.google_calendar_uid || "",
        counts
      });
      run("DELETE FROM events WHERE id = ?", [event.id]);
    });
    for (const filePath of documentFiles) removeDocumentStorageFile(filePath);
    return sendJson(res, 200, { ok: true, deletedEventId: event.id, counts });
  }

  const eventSnapshotsMatch = pathname.match(/^\/api\/events\/([^/]+)\/snapshots$/);
  if (eventSnapshotsMatch && method === "GET") {
    requireAdmin(user);
    const event = get("SELECT id FROM events WHERE id = ?", [eventSnapshotsMatch[1]]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    return sendJson(res, 200, {
      snapshots: listEventSnapshots(event.id, url.searchParams.get("limit") || 50)
    });
  }

  const closeEventMatch = pathname.match(/^\/api\/events\/([^/]+)\/close$/);
  if (closeEventMatch && method === "POST") {
    requireAdmin(user);
    const event = get("SELECT * FROM events WHERE id = ?", [closeEventMatch[1]]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    run("UPDATE events SET status = 'finalizado', closed_at = CURRENT_TIMESTAMP WHERE id = ?", [event.id]);
    ensureDraftDeliveryNote(event);
    audit(user, "event_closed", "event", event.id, { closedBy: user.id });
    createEventSnapshot(event.id, "event_closed", user, { closedBy: user.id });
    const attendanceDetection = autoDetectAttendanceIncidents({ date: event.date, actor: user });
    const googleSync = await syncEventToGoogleCalendar(event.id, user, "event_closed", appOriginFromRequest(req));
    return sendJson(res, 200, { event: eventDetail(event.id), googleSync, attendanceDetection });
  }

  const duplicateMatch = pathname.match(/^\/api\/events\/([^/]+)\/duplicate$/);
  if (duplicateMatch && method === "POST") {
    requireAdmin(user);
    const source = eventDetail(duplicateMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Evento no encontrado" });
    if (eventPerformed(source)) {
      return sendJson(res, 409, { error: "Evento efectuado: solo se permite revisar o crear incidencias" });
    }
    const body = await readBody(req);
    const id = randomId("evt");
    const targetDate = body.date || source.date;
    const copiedAssignments = [];
    const skippedAssignments = [];
    transaction(() => {
      run(
        `INSERT INTO events
          (id, name, client_id, date, start_time, end_time, location, address, lat, lng, team_leader_id,
           required_total, status, notes, budget, google_maps_url, vehicle_count, base_distance_km, billable_km,
           kilometre_price, role_price_total, night_price_total, distance_price_total, service_price, location_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          `${source.name} copia`,
          source.client_id,
          targetDate,
          source.start_time,
          source.end_time,
          source.location,
          source.address,
          source.lat,
          source.lng,
          source.team_leader_id,
          source.required_total,
          "falta_personal",
          source.notes,
          source.budget,
          source.google_maps_url || "",
          Number(source.vehicle_count || 1),
          Number(source.base_distance_km || 0),
          Number(source.billable_km || 0),
          Number(source.kilometre_price || 0.37),
          Number(source.role_price_total || 0),
          Number(source.night_price_total || 0),
          Number(source.distance_price_total || 0),
          Number(source.service_price || source.budget || 0),
          source.location_source || null
        ]
      );
      for (const requirement of source.requirements) {
        run("INSERT INTO event_requirements (id, event_id, role, count) VALUES (?, ?, ?, ?)", [
          randomId("req"),
          id,
          requirement.role,
          requirement.count
        ]);
      }
      const targetEvent = get("SELECT * FROM events WHERE id = ?", [id]);
      for (const assignment of source.assignments || []) {
        if (assignment.status === "bloqueado") {
          skippedAssignments.push({
            employeeId: assignment.employee_id,
            employeeName: assignment.name,
            reason: "Asignacion bloqueada en evento origen"
          });
          continue;
        }
        const employee = get("SELECT * FROM employees WHERE id = ?", [assignment.employee_id]);
        if (!employee) {
          skippedAssignments.push({
            employeeId: assignment.employee_id,
            employeeName: assignment.name,
            reason: "Operario no encontrado"
          });
          continue;
        }
        const issues = validateAssignment(targetEvent, employee, assignment.role);
        const blocker = issues.find((issue) => issue.severity === "block");
        if (blocker) {
          skippedAssignments.push({
            employeeId: assignment.employee_id,
            employeeName: assignment.name,
            reason: blocker.message
          });
          continue;
        }
        const assignmentId = randomId("asg");
        run(
          "INSERT INTO assignments (id, event_id, employee_id, role, status) VALUES (?, ?, ?, ?, ?)",
          [assignmentId, id, assignment.employee_id, assignment.role, assignment.status || "confirmado"]
        );
        copiedAssignments.push({
          id: assignmentId,
          employeeId: assignment.employee_id,
          employeeName: assignment.name,
          role: assignment.role,
          status: assignment.status || "confirmado",
          warnings: issues.filter((issue) => issue.severity === "warning")
        });
      }
      if (copiedAssignments.some((assignment) => String(assignment.role || "").toLowerCase().includes("jefe"))) {
        const leader = copiedAssignments.find((assignment) => String(assignment.role || "").toLowerCase().includes("jefe"));
        run("UPDATE events SET team_leader_id = ? WHERE id = ?", [leader.employeeId, id]);
      } else if (!copiedAssignments.some((assignment) => assignment.employeeId === source.team_leader_id)) {
        run("UPDATE events SET team_leader_id = NULL WHERE id = ?", [id]);
      }
      updateEventStatus(id);
      updateEventPricing(id, pricingForEvent(id));
      ensureDraftDeliveryNote(get("SELECT * FROM events WHERE id = ?", [id]));
      audit(user, "event_duplicated", "event", id, {
        sourceEventId: source.id,
        date: targetDate,
        copiedAssignments: copiedAssignments.length,
        skippedAssignments: skippedAssignments.length
      });
      createEventSnapshot(id, "event_duplicated", user, {
        sourceEventId: source.id,
        date: targetDate,
        copiedAssignments,
        skippedAssignments
      });
    });
    const googleSync = await syncEventToGoogleCalendar(id, user, "event_duplicated", appOriginFromRequest(req));
    return sendJson(res, 201, { event: eventDetail(id), googleSync, copiedAssignments, skippedAssignments });
  }

  if (pathname === "/api/clients" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { clients: all("SELECT * FROM clients ORDER BY name") });
  }

  if (pathname === "/api/clients" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const id = randomId("cli");
    run(
      `INSERT INTO clients (id, name, legal_name, tax_id, contact_name, email, phone, address, province, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.legalName || body.name,
        body.taxId || "",
        body.contactName || "",
        body.email || "",
        body.phone || "",
        body.address || "",
        body.province || "",
        body.notes || ""
      ]
    );
    audit(user, "client_created", "client", id, {
      name: body.name,
      taxId: body.taxId || ""
    });
    return sendJson(res, 201, { client: get("SELECT * FROM clients WHERE id = ?", [id]) });
  }

  const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM clients WHERE id = ?", [clientMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Cliente no encontrado" });
    run(
      `UPDATE clients
       SET name = ?, legal_name = ?, tax_id = ?, contact_name = ?, email = ?, phone = ?,
           address = ?, province = ?, notes = ?
       WHERE id = ?`,
      [
        body.name ?? existing.name,
        body.legalName ?? existing.legal_name,
        body.taxId ?? existing.tax_id,
        body.contactName ?? existing.contact_name,
        body.email ?? existing.email,
        body.phone ?? existing.phone,
        body.address ?? existing.address,
        body.province ?? existing.province,
        body.notes ?? existing.notes,
        existing.id
      ]
    );
    audit(user, "client_updated", "client", existing.id);
    return sendJson(res, 200, { client: get("SELECT * FROM clients WHERE id = ?", [existing.id]) });
  }

  if (clientMatch && method === "DELETE") {
    requireAdmin(user);
    const existing = get("SELECT * FROM clients WHERE id = ?", [clientMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Cliente no encontrado" });
    const events = get("SELECT COUNT(*) AS count FROM events WHERE client_id = ?", [existing.id]).count;
    if (events > 0) {
      return sendJson(res, 409, { error: "No se puede eliminar un cliente con historico de eventos" });
    }
    run("DELETE FROM clients WHERE id = ?", [existing.id]);
    audit(user, "client_deleted", "client", existing.id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/employees" && method === "GET") {
    requireAdmin(user);
    const employees = all("SELECT * FROM employees ORDER BY name").map(parseEmployee);
    return sendJson(res, 200, { employees });
  }

  if (pathname === "/api/employees" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const id = randomId("emp");
    const role = employeeRoleFromBody(body, "Montaje");
    const skills = employeeSkillsFromBody({ ...body, role }, body.skills || []);
    const email = cleanContactEmail(body.email);
    const phone = cleanContactPhone(body.phone);
    const wantsPortal = body.portalAccess !== false;
    validateAdminEmployeeContact({ employeeId: id, email, phone, requireContact: wantsPortal });
    let portal = { userId: null, created: false };
    const portalPassword = wantsPortal ? employeePortalPasswordForCreate(body, phone) : null;
    const photoUrl = normalizeProfilePhoto(body, "");
    transaction(() => {
      if (wantsPortal) {
        portal = ensureEmployeePortalUser({
          name: body.name,
          email,
          phone,
          defaultPassword: portalPassword.password
        });
      }
      run(
        `INSERT INTO employees
          (id, user_id, name, role, phone, email, city, lat, lng, hourly_rate, km_rate, diet_rate, skills, photo_url, notes,
           dni, social_security_number, bank_account, address, province, postal_code, birth_date,
           shirt_size, pants_size, shoe_size, jacket_size, epi_size, emergency_contact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          portal.userId,
          body.name,
          role,
          phone || "",
          email || "",
          body.city || "",
          Number(body.lat || 40.4168),
          Number(body.lng || -3.7038),
          Number(body.hourlyRate || 15),
          Number(body.kmRate || 0.24),
          Number(body.dietRate || 0),
          JSON.stringify(skills),
          photoUrl,
          body.notes || "",
          body.dni || null,
          body.socialSecurityNumber || null,
          body.bankAccount || null,
          body.address || null,
          body.province || null,
          body.postalCode || null,
          body.birthDate || null,
          body.shirtSize || null,
          body.pantsSize || null,
          body.shoeSize || null,
          body.jacketSize || null,
          body.epiSize || null,
          body.emergencyContact || null
        ]
      );
      audit(user, "employee_created", "employee", id, {
        name: body.name,
        role,
        email: email || "",
        phone: phone || "",
        portalUserId: portal.userId,
        portalUserCreated: portal.created,
        portalPasswordMode: portalPassword?.mode || "",
        photoChanged: Boolean(photoUrl)
      });
    });
    return sendJson(res, 201, {
      employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [id])),
      portalAccess: portal
    });
  }

  const employeeMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Operario no encontrado" });
    const role = employeeRoleFromBody(body, existing.role);
    const skills = employeeSkillsFromBody({ ...body, role }, jsonField(existing.skills));
    const nextName = body.name ?? existing.name;
    const nextEmail = body.email === undefined ? cleanContactEmail(existing.email) : cleanContactEmail(body.email);
    const nextPhone = body.phone === undefined ? cleanContactPhone(existing.phone) : cleanContactPhone(body.phone);
    const nextStatus = body.status ?? existing.status;
    const wantsPortal = body.portalAccess === true || body.portalAccess === "true";
    validateAdminEmployeeContact({
      employeeId: existing.id,
      userId: existing.user_id || "",
      email: nextEmail,
      phone: nextPhone,
      requireContact: Boolean(existing.user_id || wantsPortal)
    });
    let portal = { userId: existing.user_id || null, created: false };
    const portalPassword = existing.user_id
      ? employeePortalPasswordForUpdate(body, nextPhone)
      : (wantsPortal ? employeePortalPasswordForCreate(body, nextPhone) : null);
    const portalCredentials = existing.user_id && portalPassword
      ? hashPassword(portalPassword.password)
      : null;
    const photoUrl = body.photoDataBase64 || body.photoUrl !== undefined
      ? normalizeProfilePhoto(body, existing.photo_url)
      : existing.photo_url;
    transaction(() => {
      if (existing.user_id) {
        run(
          `UPDATE users
           SET name = ?, email = NULLIF(?, ''), phone = NULLIF(?, ''), active = ?,
               password_hash = COALESCE(?, password_hash),
               salt = COALESCE(?, salt)
           WHERE id = ?`,
          [
            nextName,
            nextEmail || "",
            nextPhone || "",
            nextStatus === "activo" ? 1 : 0,
            portalCredentials?.hash || null,
            portalCredentials?.salt || null,
            existing.user_id
          ]
        );
        if (portalCredentials) {
          run("DELETE FROM sessions WHERE user_id = ?", [existing.user_id]);
          run("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [
            existing.user_id
          ]);
        }
      } else if (wantsPortal) {
        portal = ensureEmployeePortalUser({
          name: nextName,
          email: nextEmail,
          phone: nextPhone,
          defaultPassword: portalPassword.password
        });
      }
      run(
        `UPDATE employees
       SET user_id = ?, name = ?, role = ?, phone = ?, email = ?, status = ?, city = ?, lat = ?, lng = ?,
           hourly_rate = ?, km_rate = ?, diet_rate = ?, skills = ?, photo_url = ?, notes = ?, dni = ?,
           social_security_number = ?, bank_account = ?, address = ?, province = ?, postal_code = ?,
           birth_date = ?, shirt_size = ?, pants_size = ?, shoe_size = ?, jacket_size = ?,
           epi_size = ?, emergency_contact = ?
       WHERE id = ?`,
        [
          portal.userId || null,
          nextName,
          role,
          nextPhone || "",
          nextEmail || "",
          nextStatus,
          body.city ?? existing.city,
          Number(body.lat ?? existing.lat),
          Number(body.lng ?? existing.lng),
          Number(body.hourlyRate ?? existing.hourly_rate),
          Number(body.kmRate ?? existing.km_rate),
          Number(body.dietRate ?? existing.diet_rate),
          JSON.stringify(skills),
          photoUrl,
          body.notes ?? existing.notes,
          body.dni ?? existing.dni,
          body.socialSecurityNumber ?? existing.social_security_number,
          body.bankAccount ?? existing.bank_account,
          body.address ?? existing.address,
          body.province ?? existing.province,
          body.postalCode ?? existing.postal_code,
          body.birthDate ?? existing.birth_date,
          body.shirtSize ?? existing.shirt_size,
          body.pantsSize ?? existing.pants_size,
          body.shoeSize ?? existing.shoe_size,
          body.jacketSize ?? existing.jacket_size,
          body.epiSize ?? existing.epi_size,
          body.emergencyContact ?? existing.emergency_contact,
          employeeMatch[1]
        ]
      );
      audit(user, "employee_updated", "employee", employeeMatch[1], {
        role,
        status: nextStatus,
        rateChanged: body.hourlyRate !== undefined || body.kmRate !== undefined || body.dietRate !== undefined,
        clothingChanged: body.shirtSize !== undefined || body.pantsSize !== undefined || body.shoeSize !== undefined,
        photoChanged: photoUrl !== (existing.photo_url || ""),
        portalUserId: portal.userId,
        portalUserCreated: portal.created,
        portalSynced: Boolean(existing.user_id || wantsPortal),
        portalPasswordChanged: Boolean(portalPassword),
        portalPasswordMode: portalPassword?.mode || ""
      });
    });
    return sendJson(res, 200, {
      employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]])),
      portalAccess: portal
    });
  }

  if (pathname === "/api/assignments" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const event = eventWithDeliveryState(body.eventId);
    const employee = get("SELECT * FROM employees WHERE id = ?", [body.employeeId]);
    if (!event || !employee) return sendJson(res, 404, { error: "Evento u operario no encontrado" });
    if (deliveryNoteLocked(event)) {
      return sendJson(res, 409, { error: "Albaran firmado: no se pueden modificar asignaciones" });
    }
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: las asignaciones quedan en modo solo revision" });
    }
    const existing = get("SELECT * FROM assignments WHERE event_id = ? AND employee_id = ?", [
      event.id,
      employee.id
    ]);
    if (existing) return sendJson(res, 409, { error: "El operario ya esta asignado a este evento" });
    const role = body.role || employee.role;
    const issues = validateAssignment(event, employee, role);
    if (issues.some((issue) => issue.severity === "block")) {
      return sendJson(res, 409, { error: "Asignacion bloqueada", issues });
    }
    const id = randomId("asg");
    const status = cleanAssignmentStatus(body.status, "confirmado");
    transaction(() => {
      run("INSERT INTO assignments (id, event_id, employee_id, role, status) VALUES (?, ?, ?, ?, ?)", [
        id,
        body.eventId,
        body.employeeId,
        role,
        status
      ]);
      if (String(role).toLowerCase().includes("jefe") && status !== "bloqueado") {
        run("UPDATE events SET team_leader_id = ? WHERE id = ?", [employee.id, event.id]);
      }
      updateEventStatus(body.eventId);
      audit(user, "assignment_created", "assignment", id, {
        eventId: body.eventId,
        employeeId: body.employeeId,
        role
      });
      createEventSnapshot(event.id, "assignment_created", user, {
        assignmentId: id,
        employeeId: body.employeeId,
        role,
        status
      });
    });
    const googleSync = await syncEventToGoogleCalendar(event.id, user, "assignment_created", appOriginFromRequest(req));
    return sendJson(res, 201, { assignment: get("SELECT * FROM assignments WHERE id = ?", [id]), issues, googleSync });
  }

  const assignmentMatch = pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (assignmentMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM assignments WHERE id = ?", [assignmentMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Asignacion no encontrada" });
    const event = eventWithDeliveryState(existing.event_id);
    const employee = get("SELECT * FROM employees WHERE id = ?", [existing.employee_id]);
    if (!event || !employee) return sendJson(res, 404, { error: "Evento u operario no encontrado" });
    if (deliveryNoteLocked(event)) {
      return sendJson(res, 409, { error: "Albaran firmado: no se pueden modificar asignaciones" });
    }
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: solo se permite crear incidencias" });
    }
    const nextStatus = cleanAssignmentStatus(body.status, existing.status);
    const nextRole = body.role ?? existing.role;
    const issues = nextStatus === "bloqueado" ? [] : validateAssignment(event, employee, nextRole);
    if (issues.some((issue) => issue.severity === "block")) {
      return sendJson(res, 409, { error: "Cambio bloqueado", issues });
    }
    transaction(() => {
      run(
        "UPDATE assignments SET role = ?, status = ? WHERE id = ?",
        [nextRole, nextStatus, existing.id]
      );
      const leaderRole = String(nextRole).toLowerCase().includes("jefe") && nextStatus !== "bloqueado";
      if (leaderRole) {
        run("UPDATE events SET team_leader_id = ? WHERE id = ?", [employee.id, event.id]);
      } else if (event.team_leader_id === employee.id) {
        run("UPDATE events SET team_leader_id = NULL WHERE id = ?", [event.id]);
      }
      updateEventStatus(event.id);
      audit(user, "assignment_updated", "assignment", existing.id, {
        role: nextRole,
        status: nextStatus
      });
      createEventSnapshot(event.id, "assignment_updated", user, {
        assignmentId: existing.id,
        employeeId: existing.employee_id,
        role: nextRole,
        status: nextStatus
      });
    });
    const googleSync = await syncEventToGoogleCalendar(event.id, user, "assignment_updated", appOriginFromRequest(req));
    return sendJson(res, 200, {
      assignment: assignmentRowsForEvent(get("SELECT * FROM events WHERE id = ?", [event.id])).find((item) => item.id === existing.id),
      event: eventDetail(event.id),
      googleSync
    });
  }

  if (assignmentMatch && method === "DELETE") {
    requireAdmin(user);
    const existing = get("SELECT * FROM assignments WHERE id = ?", [assignmentMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Asignacion no encontrada" });
    const event = eventWithDeliveryState(existing.event_id);
    if (deliveryNoteLocked(event)) {
      return sendJson(res, 409, { error: "Albaran firmado: no se pueden modificar asignaciones" });
    }
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: las asignaciones no se pueden eliminar" });
    }
    const timeEntries = get(
      "SELECT COUNT(*) AS count FROM time_entries WHERE event_id = ? AND employee_id = ?",
      [existing.event_id, existing.employee_id]
    ).count;
    if (timeEntries > 0) {
      return sendJson(res, 409, {
        error: "No se puede quitar una asignacion con fichajes. Cambiala a bloqueada para conservar trazabilidad."
      });
    }
    const deletedAssignment =
      assignmentRowsForEvent(event).find((assignment) => assignment.id === existing.id) || existing;
    transaction(() => {
      run("DELETE FROM assignments WHERE id = ?", [existing.id]);
      if (event?.team_leader_id === existing.employee_id) {
        run("UPDATE events SET team_leader_id = NULL WHERE id = ?", [existing.event_id]);
      }
      updateEventStatus(existing.event_id);
      audit(user, "assignment_deleted", "assignment", existing.id, {
        eventId: existing.event_id,
        employeeId: existing.employee_id,
        deletedAssignment
      });
      createEventSnapshot(existing.event_id, "assignment_deleted", user, {
        assignmentId: existing.id,
        employeeId: existing.employee_id,
        deletedAssignment
      });
    });
    const googleSync = await syncEventToGoogleCalendar(existing.event_id, user, "assignment_deleted", appOriginFromRequest(req));
    return sendJson(res, 200, { ok: true, event: eventDetail(existing.event_id), googleSync });
  }

  const recommendationsMatch = pathname.match(/^\/api\/planner\/recommendations$/);
  if (recommendationsMatch && method === "GET") {
    requireAdmin(user);
    const eventId = url.searchParams.get("eventId");
    const event = eventId ? get("SELECT * FROM events WHERE id = ?", [eventId]) : null;
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: el equipo queda en modo revision" });
    }
    return sendJson(res, 200, { recommendations: plannerRecommendations(eventId) });
  }

  if (pathname === "/api/time-entries/clock" && method === "POST") {
    requireUser(user);
    const body = await readBody(req);
    const event = get("SELECT * FROM events WHERE id = ?", [body.eventId]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    let employeeId = body.employeeId;
    if (user.role === "employee") {
      const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
      employeeId = employee?.id;
    }
    const employee = get("SELECT * FROM employees WHERE id = ?", [employeeId]);
    if (!employee) return sendJson(res, 404, { error: "Operario no encontrado" });
    const assignment = get("SELECT * FROM assignments WHERE event_id = ? AND employee_id = ? AND status != 'bloqueado'", [
      event.id,
      employee.id
    ]);
    const type = body.type === "salida" ? "salida" : "entrada";
    const policy = clockPolicy();
    const windowState = clockWindowState(event, type, policy);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const accuracy = Number(body.accuracy);
    const ipAddress = requestIp(req);
    const userAgent = requestUserAgent(req);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return sendJson(res, 400, { error: "Ubicacion GPS obligatoria" });
    }
    const locationBlockReason = eventClockLocationBlockReason(event);
    const geo = locationBlockReason
      ? { distance: 0, inside: false }
      : isInsideRadius(lat, lng, event.lat, event.lng, policy.radiusM);
    const accepted = Boolean(assignment && windowState.allowed && geo.inside && !locationBlockReason);
    const sequenceError = accepted ? clockSequenceError(event, assignment, employee.id, type, policy) : null;
    if (sequenceError) {
      return sendJson(res, 409, {
        error: sequenceError,
        distance: geo.distance,
        radius: policy.radiusM
      });
    }
    const leaderClockOut = accepted && type === "salida" && isTeamLeaderForEvent(event, employee, assignment);
    if (leaderClockOut && (!String(body.signatureName || "").trim() || !String(body.signatureDni || "").trim())) {
      return sendJson(res, 428, {
        error: "Firma cliente requerida",
        requiresClientSignature: true
      });
    }
    const id = randomId("clk");
    let deliveryNote = null;
    transaction(() => {
      run(
        `INSERT INTO time_entries
          (id, event_id, employee_id, type, lat, lng, distance_m, within_radius, accepted, notes, gps_accuracy_m, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          event.id,
          employee.id,
          accepted ? type : `${type}_bloqueada`,
          lat,
          lng,
          geo.distance,
          geo.inside ? 1 : 0,
          accepted ? 1 : 0,
          accepted ? "" : locationBlockReason || windowState.reason || "Intento de fichaje bloqueado",
          Number.isFinite(accuracy) ? accuracy : null,
          ipAddress,
          userAgent
        ]
      );
      const autoConfirmedAssignment = accepted && type === "entrada" && assignment.status === "pendiente";
      if (autoConfirmedAssignment) {
        run("UPDATE assignments SET status = 'confirmado' WHERE id = ?", [assignment.id]);
        updateEventStatus(event.id);
        audit(user, "assignment_auto_confirmed_by_clock", "assignment", assignment.id, {
          eventId: event.id,
          employeeId: employee.id,
          timeEntryId: id
        });
      }
      if (leaderClockOut) {
        deliveryNote = signDeliveryNote(event, body);
        audit(user, "delivery_note_signed", "event", event.id, {
          deliveryNoteId: deliveryNote.id,
          signer: body.signatureName,
          servicePrice: Number(event.service_price || event.budget || 0),
          ipAddress
        });
      }
      if (accepted) {
        createEventSnapshot(event.id, leaderClockOut ? "delivery_note_signed" : "time_entry_created", user, {
          timeEntryId: id,
          employeeId: employee.id,
          type,
          accepted,
          distance: geo.distance,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          ipAddress,
          deliveryNoteId: deliveryNote?.id || null,
          autoConfirmedAssignment
        });
      }
    });
    if (!accepted) {
      const reason = !assignment
        ? "Operario no asignado"
        : locationBlockReason
          ? locationBlockReason
          : !windowState.allowed
          ? windowState.reason
          : "Fuera del radio GPS";
      const incidentId = randomId("inc");
      run(
        `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [incidentId, event.id, employee.id, "fichaje", "alta", "Fichaje bloqueado", `${reason}. Distancia: ${geo.distance} m.`]
      );
      createEventSnapshot(event.id, "time_entry_blocked", user, {
        timeEntryId: id,
        incidentId,
        employeeId: employee.id,
        type,
        reason,
        distance: geo.distance,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        ipAddress
      });
      return sendJson(res, 409, {
        error: reason,
        distance: locationBlockReason ? null : geo.distance,
        radius: policy.radiusM,
        windowOpenAt: windowState.openAt?.toISOString?.() || "",
        windowCloseAt: windowState.closeAt?.toISOString?.() || "",
        entry: get("SELECT * FROM time_entries WHERE id = ?", [id])
      });
    }
    const deliveryNoteResponse =
      user.role === "employee" && deliveryNote
        ? {
            id: deliveryNote.id,
            status: deliveryNote.status,
            locked: deliveryNote.locked,
            signed_at: deliveryNote.signed_at
          }
        : deliveryNote;
    return sendJson(res, 201, {
      ok: true,
      distance: geo.distance,
      radius: policy.radiusM,
      entry: get("SELECT * FROM time_entries WHERE id = ?", [id]),
      deliveryNote: deliveryNoteResponse
    });
  }

  if (pathname === "/api/time-entries" && method === "GET") {
    requireAdmin(user);
    const params = [];
    const where = [];
    const eventId = url.searchParams.get("eventId");
    const employeeId = url.searchParams.get("employeeId");
    const date = url.searchParams.get("date");
    if (eventId) {
      where.push("time_entries.event_id = ?");
      params.push(eventId);
    }
    if (employeeId) {
      where.push("time_entries.employee_id = ?");
      params.push(employeeId);
    }
    if (date) {
      where.push("substr(time_entries.timestamp, 1, 10) = ?");
      params.push(date);
    }
    return sendJson(res, 200, {
      entries: all(
        `SELECT time_entries.*, events.name AS event_name, events.date AS event_date, employees.name AS employee_name,
                corrected_by.name AS corrected_by_name
         FROM time_entries
         JOIN events ON events.id = time_entries.event_id
         JOIN employees ON employees.id = time_entries.employee_id
         LEFT JOIN users corrected_by ON corrected_by.id = time_entries.corrected_by_user_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY time_entries.timestamp DESC
         LIMIT 200`,
        params
      )
    });
  }

  const timeEntryMatch = pathname.match(/^\/api\/time-entries\/([^/]+)$/);
  if (timeEntryMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM time_entries WHERE id = ?", [timeEntryMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Fichaje no encontrado" });
    try {
      ensureTimeEntryEventEditable(existing.event_id);
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
    const cleanType = ["entrada", "salida", "entrada_bloqueada", "salida_bloqueada"].includes(body.type)
      ? body.type
      : existing.type;
    const nextTimestamp = body.timestamp || existing.timestamp;
    const nextAccepted = body.accepted === undefined ? Number(existing.accepted || 0) : (body.accepted ? 1 : 0);
    const nextNotes = body.notes ?? existing.notes;
    const correctionChanged =
      cleanType !== existing.type ||
      nextTimestamp !== existing.timestamp ||
      nextAccepted !== Number(existing.accepted || 0) ||
      nextNotes !== existing.notes;
    const correctionReason = String(body.correctionReason || body.notes || "Correccion manual oficina").trim();
    run(
      `UPDATE time_entries
       SET type = ?, timestamp = ?, accepted = ?, notes = ?,
           corrected_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE corrected_at END,
           corrected_by_user_id = CASE WHEN ? THEN ? ELSE corrected_by_user_id END,
           correction_reason = CASE WHEN ? THEN ? ELSE correction_reason END
       WHERE id = ?`,
      [
        cleanType,
        nextTimestamp,
        nextAccepted,
        nextNotes,
        correctionChanged ? 1 : 0,
        correctionChanged ? 1 : 0,
        user.id,
        correctionChanged ? 1 : 0,
        correctionReason,
        existing.id
      ]
    );
    audit(user, "time_entry_corrected", "time_entry", existing.id, {
      type: cleanType,
      accepted: Boolean(nextAccepted),
      timestamp: nextTimestamp,
      correctionChanged,
      correctionReason: correctionChanged ? correctionReason : ""
    });
    createEventSnapshot(existing.event_id, "time_entry_corrected", user, {
      timeEntryId: existing.id,
      type: cleanType,
      accepted: Boolean(nextAccepted),
      timestamp: nextTimestamp,
      correctionChanged,
      correctionReason: correctionChanged ? correctionReason : ""
    });
    return sendJson(res, 200, {
      entry: get(
        `SELECT time_entries.*, events.name AS event_name, events.date AS event_date, employees.name AS employee_name,
                corrected_by.name AS corrected_by_name
         FROM time_entries
         JOIN events ON events.id = time_entries.event_id
         JOIN employees ON employees.id = time_entries.employee_id
         LEFT JOIN users corrected_by ON corrected_by.id = time_entries.corrected_by_user_id
         WHERE time_entries.id = ?`,
        [existing.id]
      )
    });
  }

  if (pathname === "/api/incidents/detect-attendance" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const result = detectAttendanceIncidents({
      date: body.date || formatDate(),
      actor: user
    });
    return sendJson(res, 200, {
      ...result,
      incidents: all(
        `SELECT incidents.*, events.name AS event_name, employees.name AS employee_name
         FROM incidents
         LEFT JOIN events ON events.id = incidents.event_id
         LEFT JOIN employees ON employees.id = incidents.employee_id
         ORDER BY incidents.created_at DESC`
      )
    });
  }

  if (pathname === "/api/incidents" && method === "GET") {
    requireAdmin(user);
    const attendanceDetection = autoDetectAttendanceIncidents({ date: formatDate(), actor: user });
    return sendJson(res, 200, {
      attendanceDetection,
      incidents: all(
        `SELECT incidents.*, events.name AS event_name, employees.name AS employee_name
         FROM incidents
         LEFT JOIN events ON events.id = incidents.event_id
         LEFT JOIN employees ON employees.id = incidents.employee_id
         ORDER BY incidents.created_at DESC`
      )
    });
  }

  const incidentMatch = pathname.match(/^\/api\/incidents\/([^/]+)$/);
  if (incidentMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM incidents WHERE id = ?", [incidentMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Incidencia no encontrada" });
    const nextStatus = ["abierta", "resuelta"].includes(body.status) ? body.status : existing.status;
    const resolutionNote = String(body.resolutionNote ?? existing.resolution_note ?? "").trim();
    run(
      `UPDATE incidents
       SET status = ?,
           resolved_at = CASE WHEN ? = 'resuelta' THEN CURRENT_TIMESTAMP ELSE NULL END,
           resolution_note = CASE WHEN ? = 'resuelta' THEN ? ELSE NULL END
       WHERE id = ?`,
      [nextStatus, nextStatus, nextStatus, resolutionNote, existing.id]
    );
    audit(user, "incident_updated", "incident", existing.id, {
      status: nextStatus,
      resolutionNote: nextStatus === "resuelta" ? resolutionNote : ""
    });
    if (existing.event_id) {
      createEventSnapshot(existing.event_id, "incident_updated", user, {
        incidentId: existing.id,
        status: nextStatus,
        resolutionNote: nextStatus === "resuelta" ? resolutionNote : ""
      });
    }
    return sendJson(res, 200, {
      incident: get(
        `SELECT incidents.*, events.name AS event_name, employees.name AS employee_name
         FROM incidents
         LEFT JOIN events ON events.id = incidents.event_id
         LEFT JOIN employees ON employees.id = incidents.employee_id
         WHERE incidents.id = ?`,
        [existing.id]
      )
    });
  }

  if (pathname === "/api/availability" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { availability: listAvailability() });
  }

  if (pathname === "/api/availability" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const employee = get("SELECT id FROM employees WHERE id = ?", [body.employeeId]);
    if (!employee) return sendJson(res, 404, { error: "Operario no encontrado" });
    if (!body.startDate || !body.endDate) return sendJson(res, 400, { error: "Fechas obligatorias" });
    const id = randomId("ava");
    const status = cleanAvailabilityStatus(body.status, "aprobado");
    run(
      `INSERT INTO availability (id, employee_id, start_date, end_date, type, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        employee.id,
        body.startDate,
        body.endDate,
        cleanAvailabilityType(body.type),
        body.reason || "",
        status
      ]
    );
    audit(user, "availability_created", "availability", id, {
      employeeId: employee.id,
      status
    });
    return sendJson(res, 201, {
      availability: listAvailability().find((item) => item.id === id)
    });
  }

  const availabilityMatch = pathname.match(/^\/api\/availability\/([^/]+)$/);
  if (availabilityMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM availability WHERE id = ?", [availabilityMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Disponibilidad no encontrada" });
    const nextStatus = cleanAvailabilityStatus(body.status, existing.status);
    run(
      `UPDATE availability
       SET status = ?, reason = ?
       WHERE id = ?`,
      [
        nextStatus,
        body.reason === undefined ? existing.reason : body.reason,
        existing.id
      ]
    );
    audit(user, "availability_updated", "availability", existing.id, {
      previousStatus: existing.status,
      status: nextStatus
    });
    return sendJson(res, 200, {
      availability: listAvailability().find((item) => item.id === existing.id)
    });
  }

  if (pathname === "/api/documents" && method === "GET") {
    requireAdmin(user);
    const documents = listDocuments();
    return sendJson(res, 200, { documents, compliance: documentComplianceSummary(documents) });
  }

  if (pathname === "/api/documents/sync-statuses" && method === "POST") {
    requireAdmin(user);
    const result = syncStoredDocumentStatuses(user);
    const documents = listDocuments();
    return sendJson(res, 200, { ...result, documents, compliance: documentComplianceSummary(documents) });
  }

  if (pathname === "/api/documents" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const employee = get("SELECT id FROM employees WHERE id = ?", [body.employeeId]);
    if (!employee) return sendJson(res, 404, { error: "Operario no encontrado" });
    const id = randomId("doc");
    const file = saveDocumentFile(id, body);
    run(
      `INSERT INTO documents
        (id, employee_id, type, name, status, expires_at, url, file_name, file_mime, file_size, storage_path, uploaded_at, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        id,
        body.employeeId,
        body.type || "PRL",
        body.name || file.fileName || "Documento",
        ["vigente", "proximo", "caducado", "pendiente"].includes(body.status) ? body.status : "vigente",
        body.expiresAt || null,
        body.url || null,
        file.fileName,
        file.fileMime,
        file.fileSize,
        file.storagePath,
        user.id
      ]
    );
    audit(user, "document_uploaded", "document", id, {
      employeeId: body.employeeId,
      type: body.type || "PRL",
      hasFile: Boolean(file.storagePath)
    });
    return sendJson(res, 201, {
      document: listDocuments({ employeeId: body.employeeId }).find((document) => document.id === id)
    });
  }

  const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (documentMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM documents WHERE id = ?", [documentMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Documento no encontrado" });
    const nextStatus = ["vigente", "proximo", "caducado", "pendiente"].includes(body.status)
      ? body.status
      : existing.status;
    const nextType = String(body.type ?? existing.type).trim() || existing.type;
    const nextName = String(body.name ?? existing.name).trim() || existing.name;
    const nextExpiresAt = body.expiresAt === undefined ? existing.expires_at : (body.expiresAt || null);
    run(
      `UPDATE documents
       SET type = ?, name = ?, status = ?, expires_at = ?
       WHERE id = ?`,
      [nextType, nextName, nextStatus, nextExpiresAt, existing.id]
    );
    audit(user, "document_updated", "document", existing.id, {
      previousStatus: existing.status,
      status: nextStatus,
      type: nextType,
      expiresAt: nextExpiresAt
    });
    return sendJson(res, 200, {
      document: listDocuments({ employeeId: existing.employee_id }).find((document) => document.id === existing.id)
    });
  }

  const documentFileMatch = pathname.match(/^\/api\/documents\/([^/]+)\/file$/);
  if (documentFileMatch && method === "GET") {
    requireUser(user);
    const document = get("SELECT * FROM documents WHERE id = ?", [documentFileMatch[1]]);
    if (!document) return sendJson(res, 404, { error: "Documento no encontrado" });
    if (!canAccessDocument(user, document)) return sendJson(res, 403, { error: "Permiso insuficiente" });
    const filePath = documentFilePath(document);
    if (!filePath) return sendJson(res, 404, { error: "Archivo no disponible" });
    audit(user, "document_file_opened", "document", document.id, {
      employeeId: document.employee_id,
      fileName: document.file_name || document.name,
      fileMime: document.file_mime || "application/octet-stream",
      fileSize: document.file_size || fs.statSync(filePath).size
    });
    return send(res, 200, fs.readFileSync(filePath), {
      "content-type": document.file_mime || "application/octet-stream",
      "content-disposition": `inline; filename="${safeFileName(document.file_name || document.name)}"`,
      "cache-control": "private, no-store, max-age=0",
      "pragma": "no-cache",
      "expires": "0"
    });
  }

  const eventDocumentsMatch = pathname.match(/^\/api\/events\/([^/]+)\/documents$/);
  if (eventDocumentsMatch && method === "POST") {
    requireAdmin(user);
    const event = get("SELECT id FROM events WHERE id = ?", [eventDocumentsMatch[1]]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    const body = await readBody(req);
    const id = randomId("edoc");
    const file = saveDocumentFile(id, body);
    run(
      `INSERT INTO event_documents
        (id, event_id, type, name, notes, visible_to_employee, file_name, file_mime, file_size, storage_path, uploaded_at, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        id,
        event.id,
        String(body.type || "Operativo").trim() || "Operativo",
        String(body.name || file.fileName || "Documento evento").trim() || "Documento evento",
        body.notes || "",
        body.visibleToEmployee === false || body.visibleToEmployee === "false" ? 0 : 1,
        file.fileName,
        file.fileMime,
        file.fileSize,
        file.storagePath,
        user.id
      ]
    );
    audit(user, "event_document_uploaded", "event_document", id, {
      eventId: event.id,
      type: body.type || "Operativo",
      hasFile: Boolean(file.storagePath)
    });
    createEventSnapshot(event.id, "event_document_uploaded", user, {
      documentId: id,
      type: body.type || "Operativo",
      hasFile: Boolean(file.storagePath)
    });
    return sendJson(res, 201, {
      document: listEventDocuments({ eventId: event.id }).find((document) => document.id === id),
      event: eventDetail(event.id)
    });
  }

  const eventDocumentFileMatch = pathname.match(/^\/api\/event-documents\/([^/]+)\/file$/);
  if (eventDocumentFileMatch && method === "GET") {
    requireUser(user);
    const document = get("SELECT * FROM event_documents WHERE id = ?", [eventDocumentFileMatch[1]]);
    if (!document) return sendJson(res, 404, { error: "Documento de evento no encontrado" });
    if (!canAccessEventDocument(user, document)) return sendJson(res, 403, { error: "Permiso insuficiente" });
    const filePath = documentFilePath(document);
    if (!filePath) return sendJson(res, 404, { error: "Archivo no disponible" });
    audit(user, "event_document_file_opened", "event_document", document.id, {
      eventId: document.event_id,
      fileName: document.file_name || document.name,
      fileMime: document.file_mime || "application/octet-stream",
      fileSize: document.file_size || fs.statSync(filePath).size
    });
    return send(res, 200, fs.readFileSync(filePath), {
      "content-type": document.file_mime || "application/octet-stream",
      "content-disposition": `inline; filename="${safeFileName(document.file_name || document.name)}"`,
      "cache-control": "private, no-store, max-age=0",
      "pragma": "no-cache",
      "expires": "0"
    });
  }

  if (pathname === "/api/incidents" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const id = randomId("inc");
    run(
      `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, body.eventId || null, body.employeeId || null, body.type || "otro", body.priority || "media", body.title, body.description || ""]
    );
    audit(user, "incident_created", "incident", id, {
      eventId: body.eventId || null,
      employeeId: body.employeeId || null,
      type: body.type || "otro",
      priority: body.priority || "media"
    });
    if (body.eventId) {
      createEventSnapshot(body.eventId, "incident_created", user, {
        incidentId: id,
        employeeId: body.employeeId || null,
        type: body.type || "otro",
        priority: body.priority || "media"
      });
    }
    return sendJson(res, 201, { incident: get("SELECT * FROM incidents WHERE id = ?", [id]) });
  }

  if (pathname === "/api/employee/home" && method === "GET") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const today = formatDate();
    const policy = clockPolicy();
    const serviceSql = `
      SELECT events.id, events.name, events.date, events.start_time, events.end_time, events.location,
             events.address, events.lat, events.lng, events.status, events.notes,
             events.google_maps_url, events.location_source,
             clients.name AS client_name,
             leaders.name AS team_leader_name,
             leaders.phone AS team_leader_phone,
             assignments.role AS assignment_role,
             assignments.status AS assignment_status,
             CASE WHEN events.team_leader_id = assignments.employee_id OR lower(assignments.role) LIKE '%jefe%' THEN 1 ELSE 0 END AS is_team_leader,
             COALESCE(delivery_notes.locked, 0) AS delivery_note_locked
       FROM assignments
       JOIN events ON events.id = assignments.event_id
       JOIN clients ON clients.id = events.client_id
       LEFT JOIN employees leaders ON leaders.id = events.team_leader_id
       LEFT JOIN delivery_notes ON delivery_notes.event_id = events.id
       WHERE assignments.employee_id = ? AND assignments.status != 'bloqueado'
    `;
    const upcomingServicesRaw = all(
      `${serviceSql} AND events.date >= ?
       ORDER BY events.date ASC, events.start_time ASC
       LIMIT 12`,
      [employee.id, today]
    ).map((service) => employeeServiceClockData(service, employee.id, policy));
    const nextAssignmentRaw = upcomingServicesRaw[0] || null;
    const pastServicesRaw = all(
      `${serviceSql} AND (events.date < ? OR events.status = 'finalizado')
       ORDER BY events.date DESC, events.start_time DESC
       LIMIT 12`,
      [employee.id, today]
    ).map((service) => employeeServiceClockData(service, employee.id, policy));
    const coworkers = nextAssignmentRaw
      ? all(
          `SELECT employees.id, employees.name, employees.role
           FROM assignments
           JOIN employees ON employees.id = assignments.employee_id
           WHERE assignments.event_id = ? AND employees.id != ? AND assignments.status != 'bloqueado'
           ORDER BY employees.name`,
          [nextAssignmentRaw.id, employee.id]
        )
      : [];
    const documents = listDocuments({ employeeId: employee.id });
    const eventDocuments = nextAssignmentRaw
      ? listEventDocuments({ eventId: nextAssignmentRaw.id, visibleOnly: true })
      : [];
    const addChecklist = (service) => ({
      ...service,
      checklist: employeeServiceChecklist(service, documents)
    });
    const upcomingServices = upcomingServicesRaw.map(addChecklist);
    const pastServices = pastServicesRaw.map(addChecklist);
    const nextAssignment = upcomingServices[0] || null;
    const timeStats = get(
      `SELECT COUNT(DISTINCT event_id) AS events_done, COUNT(*) AS entries
       FROM time_entries
       WHERE employee_id = ? AND accepted = 1`,
      [employee.id]
    );
	    const allowances = get(
	      `SELECT COALESCE(SUM(km), 0) AS km,
	              COALESCE(SUM(diet), 0) AS dietas,
	              COALESCE(SUM(night_hours), 0) AS night_hours
	       FROM allowances
	       WHERE employee_id = ?`,
	      [employee.id]
    );
    const incidentRows = all(
      `SELECT incidents.id, incidents.event_id, incidents.type, incidents.priority, incidents.status,
              incidents.title, incidents.description, incidents.created_at, incidents.resolved_at,
              events.name AS event_name, events.date AS event_date
       FROM incidents
       LEFT JOIN events ON events.id = incidents.event_id
       WHERE incidents.employee_id = ?
       ORDER BY incidents.created_at DESC
       LIMIT 12`,
      [employee.id]
    );
    const plannedHours = pastServices.reduce(
      (sum, service) => sum + hoursBetween(service.start_time, service.end_time),
      0
    );
    const availabilityRows = all(
      `SELECT * FROM availability
       WHERE employee_id = ?
       ORDER BY start_date DESC, created_at DESC
       LIMIT 8`,
      [employee.id]
    );
    const settings = settingMap();
    return sendJson(res, 200, {
      employee: employeePortalProfile(employee),
      nextService: nextAssignment,
      upcomingServices,
      pastServices,
      coworkers,
      documents,
      eventDocuments,
      availability: availabilityRows,
      incidents: incidentRows,
      history: {
        events_done: timeStats.events_done,
	        entries: timeStats.entries,
	        hours: Math.round(plannedHours * 10) / 10,
	        km: Math.round(Number(allowances.km || 0) * 10) / 10,
	        dietas: Math.round(Number(allowances.dietas || 0) * 100) / 100,
	        night_hours: Number(allowances.night_hours || 0),
	        incidents: incidentRows.length
	      },
      radius: policy.radiusM,
      clockPolicy: policy,
      office: {
        phone: settings.office_phone || "+34910000000",
        whatsapp: settings.office_whatsapp || settings.office_phone || "34910000000"
      }
    });
  }

  if (pathname === "/api/employee/profile" && method === "PATCH") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
	    const body = await readBody(req);
	    const email = body.email === undefined ? cleanContactEmail(employee.email) : cleanContactEmail(body.email);
	    const phone = body.phone === undefined ? cleanContactPhone(employee.phone) : cleanContactPhone(body.phone);
	    validateEmployeeProfileContact({ employeeId: employee.id, userId: user.id, email, phone });
	    const password = body.password ? hashPassword(validateNewPassword(body.password)) : null;
	    const photoUrl = normalizeProfilePhoto(body, employee.photo_url);
	    transaction(() => {
	      run(
	        `UPDATE employees
	         SET phone = ?, email = ?, photo_url = ?
         WHERE id = ?`,
        [
	          phone,
	          email,
	          photoUrl,
	          employee.id
	        ]
	      );
      run(
        `UPDATE users
         SET phone = ?, email = ?,
             password_hash = COALESCE(?, password_hash),
             salt = COALESCE(?, salt)
         WHERE id = ?`,
        [
          phone,
          email,
          password?.hash || null,
          password?.salt || null,
          user.id
        ]
      );
      if (password) run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
	      audit(user, "employee_profile_updated", "employee", employee.id, {
	        emailChanged: email !== cleanContactEmail(employee.email),
	        phoneChanged: phone !== cleanContactPhone(employee.phone),
	        photoChanged: photoUrl !== (employee.photo_url || ""),
	        passwordChanged: Boolean(password)
	      });
    });
    return sendJson(res, 200, {
      employee: employeePortalProfile(get("SELECT * FROM employees WHERE id = ?", [employee.id]))
    });
  }

  const employeeConfirmMatch = pathname.match(/^\/api\/employee\/services\/([^/]+)\/confirm$/);
  if (employeeConfirmMatch && method === "POST") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const eventId = decodeURIComponent(employeeConfirmMatch[1]);
    const assignment = get(
      `SELECT assignments.*, events.name AS event_name, events.date AS event_date
       FROM assignments
       JOIN events ON events.id = assignments.event_id
       WHERE assignments.event_id = ? AND assignments.employee_id = ?`,
      [eventId, employee.id]
    );
    if (!assignment) return sendJson(res, 404, { error: "Servicio no encontrado" });
    if (assignment.status === "bloqueado") {
      return sendJson(res, 409, { error: "Servicio bloqueado por administracion" });
    }
    if (assignment.status !== "confirmado") {
      transaction(() => {
        run("UPDATE assignments SET status = 'confirmado' WHERE id = ?", [assignment.id]);
        updateEventStatus(eventId);
        audit(user, "employee_service_confirmed", "assignment", assignment.id, {
          eventId,
          employeeId: employee.id,
          eventName: assignment.event_name
        });
      });
    }
    return sendJson(res, 200, {
      ok: true,
      assignment: get("SELECT * FROM assignments WHERE id = ?", [assignment.id])
    });
  }

  if (pathname === "/api/employee/availability" && method === "POST") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const body = await readBody(req);
    if (!body.startDate || !body.endDate) return sendJson(res, 400, { error: "Fechas obligatorias" });
    const id = randomId("ava");
    run(
      `INSERT INTO availability (id, employee_id, start_date, end_date, type, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        employee.id,
        body.startDate,
        body.endDate,
        cleanAvailabilityType(body.type),
        body.reason || "",
        "solicitado"
      ]
    );
    audit(user, "employee_availability_requested", "availability", id, {
      employeeId: employee.id,
      startDate: body.startDate,
      endDate: body.endDate,
      type: cleanAvailabilityType(body.type)
    });
    return sendJson(res, 201, { availability: get("SELECT * FROM availability WHERE id = ?", [id]) });
  }

  if (pathname === "/api/employee/documents" && method === "POST") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const body = await readBody(req);
    if (!body.fileDataBase64) return sendJson(res, 400, { error: "Archivo obligatorio" });
    const id = randomId("doc");
    const file = saveDocumentFile(id, body);
    const type = String(body.type || "Documento").trim() || "Documento";
    const name = String(body.name || file.fileName || type).trim() || type;
    run(
      `INSERT INTO documents
        (id, employee_id, type, name, status, expires_at, url, file_name, file_mime, file_size, storage_path, uploaded_at, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, 'pendiente', ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        id,
        employee.id,
        type,
        name,
        body.expiresAt || null,
        file.fileName,
        file.fileMime,
        file.fileSize,
        file.storagePath,
        user.id
      ]
    );
    audit(user, "employee_document_uploaded", "document", id, {
      employeeId: employee.id,
      type,
      fileName: file.fileName,
      fileSize: file.fileSize
    });
    return sendJson(res, 201, {
      document: listDocuments({ employeeId: employee.id }).find((document) => document.id === id)
    });
  }

  if (pathname === "/api/employee/incidents" && method === "POST") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const body = await readBody(req);
    const eventId = String(body.eventId || "").trim();
    const assignment = get(
      `SELECT assignments.*, events.name AS event_name, events.date AS event_date
       FROM assignments
       JOIN events ON events.id = assignments.event_id
       WHERE assignments.event_id = ? AND assignments.employee_id = ? AND assignments.status != 'bloqueado'`,
      [eventId, employee.id]
    );
    if (!assignment) return sendJson(res, 404, { error: "Servicio no encontrado" });
    const type = cleanIncidentType(body.type);
    const description = String(body.description || "").trim();
    if (!description) return sendJson(res, 400, { error: "Descripcion obligatoria" });
    const id = randomId("inc");
    const title = String(body.title || "").trim() || `Aviso operario: ${type}`;
    const priority = employeeIncidentPriority(type);
    transaction(() => {
      run(
        `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, eventId, employee.id, type, priority, title, description]
      );
      audit(user, "employee_incident_created", "incident", id, {
        eventId,
        employeeId: employee.id,
        type,
        priority
      });
      createEventSnapshot(eventId, "employee_incident_created", user, {
        incidentId: id,
        employeeId: employee.id,
        type,
        priority
      });
    });
    return sendJson(res, 201, {
      incident: get("SELECT * FROM incidents WHERE id = ?", [id])
    });
  }

  if (pathname === "/api/allowances" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, {
      allowances: listAllowances({
        eventId: url.searchParams.get("eventId") || "",
        employeeId: url.searchParams.get("employeeId") || ""
      })
    });
  }

  if (pathname === "/api/allowances" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const eventId = body.eventId || body.event_id;
    const employeeId = body.employeeId || body.employee_id;
    if (!eventId || !employeeId) return sendJson(res, 400, { error: "Evento y operario son obligatorios" });
    const event = ensureAllowanceEventEditable(eventId);
    const assignment = assignedAllowanceEmployee(event.id, employeeId);
    if (!assignment) return sendJson(res, 409, { error: "El operario no esta asignado a este evento" });
    const existing = get("SELECT * FROM allowances WHERE event_id = ? AND employee_id = ?", [event.id, employeeId]);
    const values = allowanceValuesFromBody(body, existing || {});
    let allowanceId = existing?.id || randomId("all");
    transaction(() => {
      if (existing) {
        run(
          `UPDATE allowances
           SET km = ?, diet = ?, night_hours = ?, extras = ?
           WHERE id = ?`,
          [values.km, values.diet, values.nightHours, values.extras, existing.id]
        );
      } else {
        run(
          `INSERT INTO allowances (id, event_id, employee_id, km, diet, night_hours, extras)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [allowanceId, event.id, employeeId, values.km, values.diet, values.nightHours, values.extras]
        );
      }
      audit(user, existing ? "allowance_updated" : "allowance_created", "allowance", allowanceId, {
        eventId: event.id,
        employeeId,
        ...values
      });
      createEventSnapshot(event.id, existing ? "allowance_updated" : "allowance_created", user, {
        employeeId,
        employeeName: assignment.employee_name,
        ...values
      });
    });
    return sendJson(res, existing ? 200 : 201, { allowance: allowanceById(allowanceId) });
  }

  const allowanceMatch = pathname.match(/^\/api\/allowances\/([^/]+)$/);
  if (allowanceMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM allowances WHERE id = ?", [allowanceMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Plus no encontrado" });
    const event = ensureAllowanceEventEditable(existing.event_id);
    const values = allowanceValuesFromBody(body, existing);
    run(
      `UPDATE allowances
       SET km = ?, diet = ?, night_hours = ?, extras = ?
       WHERE id = ?`,
      [values.km, values.diet, values.nightHours, values.extras, existing.id]
    );
    audit(user, "allowance_updated", "allowance", existing.id, {
      eventId: event.id,
      employeeId: existing.employee_id,
      ...values
    });
    createEventSnapshot(event.id, "allowance_updated", user, {
      employeeId: existing.employee_id,
      ...values
    });
    return sendJson(res, 200, { allowance: allowanceById(existing.id) });
  }

  if (allowanceMatch && method === "DELETE") {
    requireAdmin(user);
    const existing = get("SELECT * FROM allowances WHERE id = ?", [allowanceMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Plus no encontrado" });
    const event = ensureAllowanceEventEditable(existing.event_id);
    const deletedAllowance = allowanceById(existing.id) || existing;
    transaction(() => {
      run("DELETE FROM allowances WHERE id = ?", [existing.id]);
      audit(user, "allowance_deleted", "allowance", existing.id, {
        eventId: event.id,
        employeeId: existing.employee_id,
        deletedAllowance
      });
      createEventSnapshot(event.id, "allowance_deleted", user, {
        employeeId: existing.employee_id,
        deletedAllowance
      });
    });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/finance/summary" && method === "GET") {
    requireAdmin(user);
    const filters = reportFiltersFromUrl(url);
    return sendJson(res, 200, { finance: financeSummary(filters) });
  }

  if (pathname === "/api/reports/events" && method === "GET") {
    requireAdmin(user);
    const filters = reportFiltersFromUrl(url);
    const rows = listEvents(filters).map((event) => ({
      id: event.id,
      evento: event.name,
      cliente: event.client_name,
      fecha: event.date,
      inicio: event.start_time,
      fin: event.end_time,
      ubicacion: event.location,
      estado: event.status,
      requeridos: event.required_total,
      asignados: event.assigned_count,
      fichados: event.clocked_count,
      precio_servicio: event.service_price,
      distancia_base_km: event.base_distance_km,
      km_facturables: event.billable_km,
      kilometraje: event.distance_price_total,
      coste: event.finance.cost,
      beneficio: event.finance.benefit,
      margen: event.finance.margin
    }));
    const format = url.searchParams.get("format");
    if (format === "csv") {
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=eventos.csv"
      });
    }
    if (format === "xls" || format === "excel") {
      return send(res, 200, createExcelXml(rows, "Eventos"), {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": "attachment; filename=eventos.xls"
      });
    }
    if (format === "pdf") {
      return send(res, 200, createPdfReport("Eventos y rentabilidad", rows), {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=eventos.pdf"
      });
    }
    return sendJson(res, 200, { rows, filters });
  }

  if (pathname === "/api/reports/finance" && method === "GET") {
    requireAdmin(user);
    const filters = reportFiltersFromUrl(url);
    const rows = financeReportRows(filters);
    const format = url.searchParams.get("format");
    if (format === "csv") {
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=finanzas.csv"
      });
    }
    if (format === "xls" || format === "excel") {
      return send(res, 200, createExcelXml(rows, "Finanzas"), {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": "attachment; filename=finanzas.xls"
      });
    }
    if (format === "pdf") {
      return send(res, 200, createPdfReport("Finanzas Pro", rows), {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=finanzas.pdf"
      });
    }
    return sendJson(res, 200, { rows, filters });
  }

  if (pathname === "/api/reports/employees" && method === "GET") {
    requireAdmin(user);
    const filters = reportFiltersFromUrl(url);
    const rows = employeeReportRows(filters);
    const format = url.searchParams.get("format");
    if (format === "csv") {
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=operarios.csv"
      });
    }
    if (format === "xls" || format === "excel") {
      return send(res, 200, createExcelXml(rows, "Operarios"), {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": "attachment; filename=operarios.xls"
      });
    }
    if (format === "pdf") {
      return send(res, 200, createPdfReport("Operarios y documentacion", rows), {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=operarios.pdf"
      });
    }
    return sendJson(res, 200, { rows, filters });
  }

  if (pathname === "/api/reports/incidents" && method === "GET") {
    requireAdmin(user);
    const filters = reportFiltersFromUrl(url);
    const rows = incidentReportRows(filters);
    const format = url.searchParams.get("format");
    if (format === "csv") {
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=incidencias.csv"
      });
    }
    if (format === "xls" || format === "excel") {
      return send(res, 200, createExcelXml(rows, "Incidencias"), {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": "attachment; filename=incidencias.xls"
      });
    }
    if (format === "pdf") {
      return send(res, 200, createPdfReport("Incidencias Pro", rows), {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=incidencias.pdf"
      });
    }
    return sendJson(res, 200, { rows, filters });
  }

  const clientDossierMatch = pathname.match(/^\/api\/events\/([^/]+)\/client-dossier$/);
  if (clientDossierMatch && method === "GET") {
    requireAdmin(user);
    const event = eventDetail(clientDossierMatch[1]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    const format = url.searchParams.get("format");
    const dossier = clientDossierData(event);
    audit(user, "client_dossier_exported", "event", event.id, {
      format: format || "html",
      staff: dossier.totals.staff,
      blockers: dossier.totals.blockers
    });
    if (format === "json") return sendJson(res, 200, dossier);
    if (format === "csv") {
      const rows = dossier.rows.map((row) => ({
        evento: event.name,
        cliente: dossier.client.name || event.client_name,
        fecha: event.date,
        operario: row.assignment.name,
	        rol: row.assignment.role,
	        estado_documental: row.status,
	        documentos: row.documents.map((document) => `${document.type}: ${documentStatusLabel(document.status)}${document.expires_at ? ` (${document.expires_at})` : ""}`).join(" | "),
	        archivos: row.documents.filter((document) => document.has_file).map((document) => document.file_name || document.name).join(" | ")
	      }));
      return send(res, 200, createCsv(rows), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=dossier-${safeFileName(event.name)}.csv`
      });
    }
    if (format === "pdf") {
      return send(res, 200, clientDossierPdf(event), {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename=dossier-${safeFileName(event.name)}.pdf`
      });
    }
    return send(res, 200, clientDossierHtml(event), { "content-type": "text/html; charset=utf-8" });
  }

  const deliveryMatch = pathname.match(/^\/api\/delivery-notes\/([^/]+)$/);
  if (deliveryMatch && method === "GET") {
    requireAdmin(user);
    const event = eventDetail(deliveryMatch[1]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    if (url.searchParams.get("format") === "pdf") {
      return send(res, 200, deliveryNotePdf(event), {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="albaran-${safeFileName(event.name)}.pdf"`
      });
    }
    return send(res, 200, deliveryNoteHtml(event), { "content-type": "text/html; charset=utf-8" });
  }

  if (pathname === "/api/backups" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, backupOverview());
  }

  const backupVerifyMatch = pathname.match(/^\/api\/backups\/([^/]+)\/verify$/);
  if (backupVerifyMatch && method === "GET") {
    requireAdmin(user);
    const backup = get("SELECT * FROM backups WHERE id = ?", [backupVerifyMatch[1]]);
    if (!backup) return sendJson(res, 404, { error: "Backup no encontrado" });
    const checked = backupStatus(backup);
    audit(user, "backup_verified", "backup", backup.id, {
      verified: checked.verified,
      integrity: checked.integrity
    });
    return sendJson(res, 200, { backup: checked });
  }

  const backupDownloadMatch = pathname.match(/^\/api\/backups\/([^/]+)\/file$/);
  if (backupDownloadMatch && method === "GET") {
    requireAdmin(user);
    const backup = get("SELECT * FROM backups WHERE id = ?", [backupDownloadMatch[1]]);
    if (!backup) return sendJson(res, 404, { error: "Backup no encontrado" });
    const resolved = safeBackupPath(backup.file_path);
    if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return sendJson(res, 409, { error: "El archivo de backup no esta disponible" });
    }
    const fileName = path.basename(resolved).replaceAll('"', "");
    audit(user, "backup_downloaded", "backup", backup.id, {
      fileName,
      sizeBytes: fs.statSync(resolved).size
    });
    return send(res, 200, fs.readFileSync(resolved), {
      "content-type": "application/vnd.sqlite3",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": fs.statSync(resolved).size
    });
  }

  if (pathname === "/api/backups" && method === "POST") {
    requireAdmin(user);
    const backup = createBackup("manual", `Backup manual por ${user.name}`);
    const row = get("SELECT * FROM backups WHERE id = ?", [backup.id]);
    audit(user, "backup_created", "backup", backup.id, {
      type: backup.type,
      sizeBytes: backup.size_bytes
    });
    return sendJson(res, 201, { backup: backupStatus(row) });
  }

  if (pathname === "/api/backups/auto-run" && method === "POST") {
    requireAdmin(user);
    const result = runAutomaticBackup("manual");
    if (result.skipped) return sendJson(res, 409, { error: `Backup automatico ${result.reason}` });
    const row = get("SELECT * FROM backups WHERE id = ?", [result.backup.id]);
    return sendJson(res, 201, {
      backup: backupStatus(row),
      pruned: result.pruned,
      automation: backupOverview().automation
    });
  }

  if (pathname === "/api/backups/restore" && method === "POST") {
    requireSuperAdmin(user);
    const body = await readBody(req);
    const confirmation = String(body.confirm || body.confirmation || "").trim().toUpperCase();
    if (confirmation !== "RESTAURAR") {
      return sendJson(res, 400, {
        error: "Confirmacion obligatoria: escribe RESTAURAR para preparar la restauracion."
      });
    }
    const restoreRequest = requestRestore(body.backupId);
    audit(user, "backup_restore_requested", "backup", restoreRequest.backup.id, {
      type: restoreRequest.backup.type,
      createdAt: restoreRequest.backup.created_at,
      safetyBackupId: restoreRequest.safetyBackup.id
    });
    return sendJson(res, 202, {
      backup: restoreRequest.backup,
      safetyBackup: backupStatus(get("SELECT * FROM backups WHERE id = ?", [restoreRequest.safetyBackup.id])),
      message: "Restauracion preparada. Reinicia el servidor para aplicar la copia con seguridad."
    });
  }

  return sendJson(res, 404, { error: "Ruta no encontrada" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(CLIENT_DIR, `.${requested}`);
  if (!filePath.startsWith(CLIENT_DIR)) {
    return sendJson(res, 403, { error: "Acceso denegado" });
  }
  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(CLIENT_DIR, "index.html");
  const ext = path.extname(finalPath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[ext] || "application/octet-stream";
  res.writeHead(200, secureHeaders({ "content-type": type }));
  fs.createReadStream(finalPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    const status = error.status || 500;
    const headers = error.retryAfterSeconds
      ? { ...JSON_HEADERS, "retry-after": String(error.retryAfterSeconds) }
      : JSON_HEADERS;
    send(res, status, {
      error: status === 500 ? "Error interno" : error.message,
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    }, headers);
    if (status === 500) console.error(error);
  }
});

server.listen(PORT, () => {
  console.log(`MARFAN CREW ERP escuchando en http://localhost:${PORT}`);
  backupAutomationState.nextRunAt = nextAutoBackupAt();
  const firstCheck = setTimeout(runAutomaticBackupIfDue, 10_000);
  firstCheck.unref?.();
  const interval = setInterval(runAutomaticBackupIfDue, 15 * 60 * 1000);
  interval.unref?.();
});

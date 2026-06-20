const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const {
  all,
  BACKUP_DIR,
  createBackup,
  DATA_DIR,
  get,
  requestRestore,
  run,
  transaction
} = require("./db");
const { distanceMeters, isInsideRadius } = require("./geo");
const { randomId, randomToken, verifyPassword, hashPassword } = require("./security");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_DIR = path.join(process.cwd(), "client");
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CLOCK_RADIUS_M = 150;
const MAX_BODY_BYTES = 15_000_000;
const DOCUMENT_UPLOAD_DIR = path.join(DATA_DIR, "uploads", "documents");
const DEFAULT_GOOGLE_CALENDAR_ID = "21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37@group.calendar.google.com";
const DEFAULT_GOOGLE_CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?src=21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37%40group.calendar.google.com&ctz=Europe%2FMadrid";
const GOOGLE_CALENDAR_TIME_ZONE = "Europe/Madrid";
const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
let googleAccessTokenCache = null;
const googleOauthLoopbacks = new Map();

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
    sha256: null
  };

  if (!resolved || !fs.existsSync(resolved)) return status;

  const stats = fs.statSync(resolved);
  if (!stats.isFile()) return status;

  status.exists = true;
  status.actual_size_bytes = stats.size;
  status.sha256 = sha256File(resolved);
  status.verified = Number(backup.size_bytes || 0) === stats.size;
  status.integrity = status.verified ? "verified" : "size_mismatch";
  return status;
}

function send(res, status, payload, headers = JSON_HEADERS) {
  res.writeHead(status, headers);
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

function tokenFromRequest(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)marfan_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function currentUser(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const session = get(
    `SELECT sessions.token, sessions.expires_at, users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND users.active = 1`,
    [token]
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  return publicUser(session);
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

function publicUser(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
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
    google_calendar_oauth_connected_at: ""
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
  return {
    ...settings,
    google_calendar_service_account_json: "",
    google_calendar_service_account_email: serviceAccount?.client_email || "",
    google_calendar_service_account_configured: serviceAccount ? "true" : "false",
    google_calendar_oauth_client_json: "",
    google_calendar_oauth_refresh_token: "",
    google_calendar_oauth_client_id: oauthClient?.client_id || "",
    google_calendar_oauth_client_configured: oauthClient ? "true" : "false",
    google_calendar_oauth_connected: settings.google_calendar_oauth_refresh_token ? "true" : "false"
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

function eventPerformed(event, today = formatDate()) {
  return Boolean(event && (event.status === "finalizado" || String(event.date) < today));
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

function eventCoordinatesFromBody(body) {
  const settings = settingMap();
  const fromMaps = extractGoogleMapsCoordinates(body.googleMapsUrl || body.mapsUrl || "");
  return {
    lat: Number(body.lat || fromMaps?.lat || numberSetting(settings, "base_lat", 36.7213)),
    lng: Number(body.lng || fromMaps?.lng || numberSetting(settings, "base_lng", -4.42164))
  };
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

function financeSummary() {
  const events = listEvents();
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
     LEFT JOIN allowances ON allowances.event_id = assignments.event_id AND allowances.employee_id = assignments.employee_id
     LEFT JOIN (
       SELECT event_id, COUNT(*) AS count
       FROM assignments
       WHERE status != 'bloqueado'
       GROUP BY event_id
     ) active_counts ON active_counts.event_id = assignments.event_id
     WHERE assignments.status != 'bloqueado'`
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

function financeReportRows() {
  const summary = financeSummary();
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

function listEvents({ from, to, search } = {}) {
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

function dashboardPayload() {
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

function clockProgress(event, assignment, entries) {
  const accepted = entries.filter((entry) => entry.accepted).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const state = liveClockState(event, assignment, entries);
  const lastEntry = accepted[0] || null;
  const canClockIn = ["sin_fichar", "pendiente", "tarde"].includes(state);
  const canClockOut = state === "en_curso";
  return {
    state,
    lastEntry,
    nextType: canClockIn ? "entrada" : canClockOut ? "salida" : null,
    canClockIn,
    canClockOut
  };
}

function employeeServiceClockData(service, employeeId) {
  const entries = all(
    `SELECT * FROM time_entries
     WHERE event_id = ? AND employee_id = ?
     ORDER BY timestamp DESC`,
    [service.id, employeeId]
  );
  const progress = clockProgress(service, { status: service.assignment_status }, entries);
  return {
    ...service,
    clock_state: progress.state,
    next_clock_type: progress.nextType,
    last_clock_type: progress.lastEntry?.type || null,
    last_clock_at: progress.lastEntry?.timestamp || null,
    can_clock_in: progress.canClockIn ? 1 : 0,
    can_clock_out: progress.canClockOut ? 1 : 0
  };
}

function clockSequenceError(event, assignment, employeeId, type) {
  const entries = all(
    `SELECT * FROM time_entries
     WHERE event_id = ? AND employee_id = ?
     ORDER BY timestamp DESC`,
    [event.id, employeeId]
  );
  const progress = clockProgress(event, assignment, entries);
  if (type === "entrada" && !progress.canClockIn) {
    return progress.state === "en_curso" ? "Entrada ya registrada" : "Servicio ya finalizado para este operario";
  }
  if (type === "salida" && !progress.canClockOut) {
    return progress.state === "finalizado" ? "Salida ya registrada" : "Primero debes fichar entrada";
  }
  return null;
}

function livePayload(date = formatDate()) {
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
  return event;
}

function eventDetailByGoogleUid(googleUid) {
  const row = get("SELECT id FROM events WHERE google_calendar_uid = ?", [googleUid]);
  return row ? eventDetail(row.id) : null;
}

function validateAssignment(event, employee) {
  const employeeId = employee.id || employee.employee_id;
  const issues = [];
  const existing = all(
    `SELECT events.*
     FROM assignments
     JOIN events ON events.id = assignments.event_id
     WHERE assignments.employee_id = ? AND assignments.status != 'bloqueado'
       AND events.date = ? AND events.id != ?`,
    [employeeId, event.date, event.id]
  );
  const start = toMinutes(event.start_time);
  const end = toMinutes(event.end_time);
  for (const other of existing) {
    if (rangesOverlap(start, end, toMinutes(other.start_time), toMinutes(other.end_time))) {
      issues.push({ type: "solape", severity: "block", message: `Solape con ${other.name}` });
    }
    const rest = Math.abs(start - toMinutes(other.end_time)) / 60;
    if (rest < 10) {
      issues.push({ type: "descanso", severity: "warning", message: "Descanso inferior a 10 horas" });
    }
  }

  const unavailable = get(
    `SELECT * FROM availability
     WHERE employee_id = ? AND start_date <= ? AND end_date >= ? AND status = 'aprobado'
     LIMIT 1`,
    [employeeId, event.date, event.date]
  );
  if (unavailable) {
    issues.push({ type: "disponibilidad", severity: "block", message: "El operario no esta disponible" });
  }

  const documents = listDocuments({ employeeId });
  const blockingDoc = documents.find((document) => ["caducado", "pendiente"].includes(document.status));
  if (blockingDoc) {
    issues.push({
      type: "documentacion",
      severity: "block",
      message: blockingDoc.status === "pendiente" ? `${blockingDoc.type} pendiente` : `${blockingDoc.type} caducado`
    });
  } else {
    const soonDoc = documents.find((document) => document.status === "proximo");
    if (soonDoc) {
      issues.push({
        type: "documentacion",
        severity: "warning",
        message: `${soonDoc.type} vence en ${soonDoc.days_to_expiry} dias`
      });
    }
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

function plannerRecommendations(eventId) {
  const event = get("SELECT * FROM events WHERE id = ?", [eventId]);
  if (!event) return [];
  const assigned = new Set(
    all("SELECT employee_id FROM assignments WHERE event_id = ?", [eventId]).map((row) => row.employee_id)
  );
  return all("SELECT * FROM employees WHERE status = 'activo' ORDER BY name").map(parseEmployee).map((employee) => {
    const issues = validateAssignment(event, employee);
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
    const roleMatch = employee.skills.some((skill) => event.notes?.toLowerCase().includes(String(skill).toLowerCase()));
    let score = 80;
    score += roleMatch ? 10 : 0;
    score -= Math.min(Math.round(distance / 1000), 25);
    score -= Math.min(Math.round(hours / 8), 15);
    score -= issues.some((issue) => issue.severity === "block") ? 80 : 0;
    score -= assigned.has(employee.id) ? 50 : 0;
    return {
      employee,
      score: Math.max(score, 0),
      distance,
      assigned: assigned.has(employee.id),
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
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${protocol}://${host}`;
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

  const settings = settingMap();
  const clientId = upsertGoogleCalendarClient();
  const id = randomId("evt");
  const date = body.date || formatDate();
  const startTime = body.startTime || body.start_time || "09:00";
  const endTime = body.endTime || body.end_time || addTime(startTime, 2);
  const location = body.location || "Ubicacion pendiente";
  const lat = Number(body.lat || settings.base_lat || 36.7213);
  const lng = Number(body.lng || settings.base_lng || -4.42164);
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
       google_calendar_uid, google_calendar_source, google_calendar_event_id, google_sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      "imported"
    ]
  );
  audit(actor, "google_event_imported", "event", id, { googleUid, source: body.source || "google" });
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

async function googleCalendarApiEvents(settings, { from, to } = {}) {
  const apiKey = String(settings.google_calendar_api_key || "").trim();
  const calendarId = String(settings.google_calendar_id || DEFAULT_GOOGLE_CALENDAR_ID).trim();
  if (!apiKey || !calendarId) return null;
  const params = new URLSearchParams({
    key: apiKey,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
    timeZone: "Europe/Madrid"
  });
  const min = googleApiDateBound(from);
  const max = googleApiDateBound(to, true);
  if (min) params.set("timeMin", min);
  if (max) params.set("timeMax", max);
  const sourceUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(`${sourceUrl}?${params}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Calendar API ${response.status}${detail ? `: ${detail.slice(0, 140)}` : ""}`);
  }
  const payload = await response.json();
  const events = (payload.items || []).map(googleApiEventToCalendarEvent).filter((event) => event.date);
  return { events, status: "connected_api", sourceUrl };
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
    redirect_uris: client.redirect_uris || []
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
      redirect_uris: []
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
  if (oauthClient && !oauthRefreshToken) {
    const error = new Error("Google Calendar OAuth pendiente de conectar");
    error.status = "pending_auth";
    throw error;
  }

  const credentials = googleServiceAccountCredentials(settings, { throwOnInvalid: true });
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

function startGoogleOAuthLoopback({ client, actor, appUrl }) {
  return new Promise((resolve, reject) => {
    const state = randomToken();
    const codeVerifier = randomToken() + randomToken();
    const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
    let redirectUri = "";
    const server = http.createServer(async (req, res) => {
      const callbackUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      try {
        const expected = googleOauthLoopbacks.get(state);
        if (!expected || callbackUrl.searchParams.get("state") !== state) {
          throw new Error("Estado OAuth no valido");
        }
        if (callbackUrl.searchParams.get("error")) {
          throw new Error(callbackUrl.searchParams.get("error_description") || callbackUrl.searchParams.get("error"));
        }
        const code = callbackUrl.searchParams.get("code");
        if (!code) throw new Error("Google no devolvio codigo de autorizacion");
        const tokens = await exchangeGoogleOAuthCode(client, code, codeVerifier, redirectUri);
        storeGoogleOAuthTokens(tokens);
        audit(actor, "google_calendar_oauth_connected", "company_settings", "google_calendar", {
          clientId: client.client_id
        });
        send(res, 200, oauthSuccessPage(appUrl), { "content-type": "text/html; charset=utf-8" });
      } catch (error) {
        audit(actor, "google_calendar_oauth_failed", "company_settings", "google_calendar", {
          error: error.message
        });
        send(res, 400, oauthErrorPage(error.message, appUrl), { "content-type": "text/html; charset=utf-8" });
      } finally {
        const item = googleOauthLoopbacks.get(state);
        if (item?.timeout) clearTimeout(item.timeout);
        googleOauthLoopbacks.delete(state);
        setTimeout(() => item?.server.close(), 250);
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}`;
      const timeout = setTimeout(() => {
        googleOauthLoopbacks.delete(state);
        server.close();
      }, 10 * 60 * 1000);
      googleOauthLoopbacks.set(state, { server, timeout });
      const authUrl = createGoogleOAuthAuthorizationUrl({ client, redirectUri, state, codeChallenge });
      resolve({ authUrl, redirectUri });
    });
  });
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
      private: {
        marfan_event_id: event.id,
        marfan_status: event.status || "",
        marfan_required_total: String(event.required_total || 0)
      }
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
    googleServiceAccountCredentials(settings, { throwOnInvalid: true });
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

function createPdfLines(title, lines) {
  const escapePdf = (value) => String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const safeText = (value, max = 112) => escapePdf(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
  const ops = [];
  const fill = (r, g, b) => ops.push(`${r} ${g} ${b} rg`);
  const stroke = (r, g, b) => ops.push(`${r} ${g} ${b} RG`);
  const rect = (x, y, w, h, mode = "f") => ops.push(`${x} ${y} ${w} ${h} re ${mode}`);
  const text = (value, x, y, size = 9, font = "F1", color = [0.06, 0.09, 0.16]) => {
    fill(...color);
    ops.push("BT", `/${font} ${size} Tf`, `${x} ${y} Td`, `(${safeText(value, 160)}) Tj`, "ET");
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
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function createPdfReport(title, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const lines = [
    title,
    `Generado: ${new Date().toLocaleString("es-ES")}`,
    "",
    headers.join(" | ")
  ];
  for (const row of rows.slice(0, 34)) {
    lines.push(headers.map((header) => String(row[header] ?? "")).join(" | "));
  }
  if (rows.length > 34) lines.push(`... ${rows.length - 34} filas adicionales`);
  return createPdfLines(title, lines);
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

function saveDocumentFile(documentId, body) {
  if (!body.fileDataBase64) {
    return {
      fileName: body.fileName || null,
      fileMime: body.fileMime || null,
      fileSize: body.fileSize ? Number(body.fileSize) : null,
      storagePath: null
    };
  }
  const base64 = String(body.fileDataBase64).includes(",")
    ? String(body.fileDataBase64).split(",").pop()
    : String(body.fileDataBase64);
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    const error = new Error("Archivo vacio");
    error.status = 400;
    throw error;
  }
  const fileName = safeFileName(body.fileName || `${documentId}.bin`);
  const storagePath = path.join(DOCUMENT_UPLOAD_DIR, `${documentId}-${fileName}`);
  fs.writeFileSync(storagePath, buffer);
  return {
    fileName,
    fileMime: body.fileMime || "application/octet-stream",
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

function canAccessDocument(user, document) {
  if (!user || !document) return false;
  if (["admin", "super_admin"].includes(user.role)) return true;
  const employee = get("SELECT id FROM employees WHERE user_id = ?", [user.id]);
  return Boolean(employee && employee.id === document.employee_id);
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

function listUsers() {
  return all(
    `SELECT users.id, users.role, users.name, users.email, users.phone, users.avatar_url, users.active,
            users.last_login_at, users.created_at,
            employees.id AS employee_id, employees.role AS employee_role, employees.status AS employee_status
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
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    employeeId: row.employee_id,
    employeeRole: row.employee_role,
    employeeStatus: row.employee_status
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

function deliveryNotePdf(event) {
  const note = event.deliveryNote || {};
  const servicePrice = Number(note.service_price ?? event.service_price ?? event.budget ?? 0);
  const rows = deliveryNoteRows(event);
  const lines = [
    `Albaran A4 - ${event.name}`,
    `MARFAN CREW ERP · Generado: ${new Date().toLocaleString("es-ES")}`,
    `Evento: ${event.id} · Fecha: ${event.date} · Horario: ${event.start_time}-${event.end_time}`,
    `Cliente: ${event.client_name} · Ubicacion: ${event.location}`,
    `Direccion: ${event.address || event.location}`,
    `Jefe de equipo: ${event.team_leader_name || "Pendiente"}`,
    "",
    `Precio servicio: ${servicePrice.toFixed(2)} EUR`,
    `Roles: ${Number(event.role_price_total || 0).toFixed(2)} EUR · Nocturnidad: ${Number(event.night_price_total || 0).toFixed(2)} EUR`,
    `Distancia base: ${Number(event.base_distance_km || 0).toFixed(1)} km · Km facturables: ${Number(event.billable_km || 0).toFixed(1)} km · Vehiculos: ${Number(event.vehicle_count || 1)}`,
    `Kilometraje: ${Number(event.distance_price_total || 0).toFixed(2)} EUR`,
    "",
    "Operarios | Rol | Horario | Km | Dieta | Noct. | Extras"
  ];
  for (const { assignment, allowance } of rows.slice(0, 28)) {
    lines.push([
      assignment.name,
      assignment.role,
      `${event.start_time}-${event.end_time}`,
      Number(allowance.km || 0).toFixed(1),
      `${Number(allowance.diet || 0).toFixed(2)} EUR`,
      Number(allowance.night_hours || 0).toFixed(1),
      `${Number(allowance.extras || 0).toFixed(2)} EUR`
    ].join(" | "));
  }
  if (rows.length > 28) lines.push(`... ${rows.length - 28} operarios adicionales`);
  if (!rows.length) lines.push("Sin operarios asignados");
  lines.push(
    "",
    `Notas: ${event.notes || ""}`,
    "",
    `Firma cliente: ${note.signature_name || ""} · DNI: ${note.signature_dni || ""}`,
    `Firma grafica: ${note.signature_image ? "capturada digitalmente" : "no capturada"}`,
    `Estado: ${note.locked ? "Firmado y bloqueado" : "Pendiente de firma"} · Fecha firma: ${note.signed_at || ""}`,
    `Observaciones cliente: ${note.client_notes || ""}`
  );
  return createPdfLines(`Albaran ${event.name}`, lines);
}

function deliveryNoteHtml(event) {
  const note = event.deliveryNote || {};
  const servicePrice = Number(note.service_price ?? event.service_price ?? event.budget ?? 0);
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
          header { display: flex; justify-content: space-between; border-bottom: 2px solid #101828; padding-bottom: 16px; margin-bottom: 18px; }
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
          <div><div class="brand">MARFAN CREW ERP</div><div class="muted">Albaran A4 por evento</div></div>
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
          <div><strong>Distancia desde base</strong><br />${Number(event.base_distance_km || 0).toFixed(1)} km</div>
          <div><strong>Km facturables</strong><br />${Number(event.billable_km || 0).toFixed(1)} km · ${Number(event.vehicle_count || 1)} veh.</div>
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
      ? row.documents.map((document) => `${document.type}:${documentStatusLabel(document.status)}${document.expires_at ? ` ${document.expires_at}` : ""}`).join(", ")
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
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #101828; padding-bottom: 16px; margin-bottom: 18px; }
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
          .doc-line { display: grid; grid-template-columns: 90px 1fr 90px; gap: 8px; padding: 3px 0; border-bottom: 1px solid #eaecf0; }
          .note { border: 1px solid #d0d5dd; padding: 12px; margin-top: 18px; background: #f9fafb; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Imprimir / guardar PDF</button>
        <header>
          <div><div class="brand">MARFAN CREW ERP</div><div class="muted">Dossier operativo para cliente</div></div>
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
          Este dossier resume equipo, roles y estado documental del evento. Los archivos originales permanecen protegidos en la plataforma y solo son accesibles por usuarios autorizados.
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

  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readBody(req);
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const account = get(
      "SELECT * FROM users WHERE active = 1 AND (lower(email) = ? OR phone = ?) LIMIT 1",
      [identifier, body.identifier]
    );
    if (!account || !verifyPassword(body.password || "", account.salt, account.password_hash)) {
      return sendJson(res, 401, { error: "Credenciales incorrectas" });
    }
    if (body.mode === "employee" && account.role !== "employee") {
      return sendJson(res, 403, { error: "Usa el login de administrador" });
    }
    if (body.mode === "admin" && account.role === "employee") {
      return sendJson(res, 403, { error: "Usa el login de empleado" });
    }

    const token = randomToken();
    const days = body.remember ? 30 : 1;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
      token,
      account.id,
      expiresAt
    ]);
    run("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [account.id]);
    audit(account, "login_success", "session", account.id, {
      mode: body.mode || "admin",
      remember: Boolean(body.remember)
    });
    return sendJson(res, 200, { token, user: publicUser(account), expiresAt });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = tokenFromRequest(req);
    if (user) audit(user, "logout", "session", user.id);
    if (token) run("DELETE FROM sessions WHERE token = ?", [token]);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/auth/recover" && method === "POST") {
    const body = await readBody(req);
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const account = get(
      "SELECT id FROM users WHERE active = 1 AND (lower(email) = ? OR phone = ?) LIMIT 1",
      [identifier, body.identifier]
    );
    let resetCode = null;
    if (account) {
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
    }
    return sendJson(res, 200, {
      ok: true,
      message: "Si el usuario existe, se ha generado un codigo temporal de recuperacion.",
      recoveryCode: resetCode,
      expiresInMinutes: resetCode ? 20 : undefined
    });
  }

  if (pathname === "/api/auth/reset-password" && method === "POST") {
    const body = await readBody(req);
    const code = String(body.recoveryCode || body.code || "").trim().toUpperCase();
    const password = String(body.password || "");
    if (!code || password.length < 6) {
      return sendJson(res, 400, { error: "Codigo y contrasena de al menos 6 caracteres obligatorios" });
    }
    const reset = findValidRecoveryToken(code);
    if (!reset) return sendJson(res, 400, { error: "Codigo caducado o no valido" });
    const credentials = hashPassword(password);
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
      "google_calendar_oauth_client_json"
    ];
    transaction(() => {
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        if (["google_calendar_service_account_json", "google_calendar_oauth_client_json"].includes(key) && !String(body[key] || "").trim()) continue;
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
    const appUrl = body.returnUrl || appOriginFromRequest(req);
    const result = await startGoogleOAuthLoopback({ client, actor: user, appUrl });
    return sendJson(res, 200, result);
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
    if (!body.name || !body.password || (!body.email && !body.phone)) {
      return sendJson(res, 400, { error: "Nombre, contrasena y email o telefono son obligatorios" });
    }
    const credentials = hashPassword(body.password);
    const id = randomId("usr");
    transaction(() => {
      run(
        `INSERT INTO users (id, role, name, email, phone, password_hash, salt, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          role,
          body.name,
          body.email || null,
          body.phone || null,
          credentials.hash,
          credentials.salt
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
            body.phone || "",
            body.email || "",
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

      audit(user, "user_created", "user", id, { role });
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
    const password = body.password ? hashPassword(body.password) : null;
    const finalRole = role || target.role;
    transaction(() => {
      run(
        `UPDATE users
         SET role = ?, name = ?, email = ?, phone = ?, active = ?,
             password_hash = COALESCE(?, password_hash),
             salt = COALESCE(?, salt)
         WHERE id = ?`,
        [
          finalRole,
          body.name ?? target.name,
          body.email ?? target.email,
          body.phone ?? target.phone,
          nextActive === undefined ? target.active : (nextActive ? 1 : 0),
          password?.hash || null,
          password?.salt || null,
          targetId
        ]
      );

      const linkedEmployee = get("SELECT id FROM employees WHERE user_id = ?", [targetId]);
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
            body.phone ?? target.phone ?? "",
            body.email ?? target.email ?? "",
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

      if (nextActive === false) run("DELETE FROM sessions WHERE user_id = ?", [targetId]);
      audit(user, "user_updated", "user", targetId, {
        role: finalRole,
        active: nextActive === undefined ? Boolean(target.active) : nextActive,
        passwordChanged: Boolean(password)
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
    return sendJson(res, 200, dashboardPayload());
  }

  if (pathname === "/api/live" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, livePayload(url.searchParams.get("date") || formatDate()));
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
           kilometre_price, role_price_total, night_price_total, distance_price_total, service_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          pricing.servicePrice
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
      updateEventStatus(id);
      audit(user, "event_created", "event", id, {
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
    const existing = get("SELECT * FROM events WHERE id = ?", [eventId]);
    if (!existing) return sendJson(res, 404, { error: "Evento no encontrado" });
    const mapsCoords = extractGoogleMapsCoordinates(body.googleMapsUrl ?? existing.google_maps_url ?? "");
    const lat = Number(body.lat ?? mapsCoords?.lat ?? existing.lat);
    const lng = Number(body.lng ?? mapsCoords?.lng ?? existing.lng);
    const nextRequirements = body.requirements
      ? normalizeRequirements(body.requirements, body.requiredTotal || existing.required_total)
      : all("SELECT role, count FROM event_requirements WHERE event_id = ?", [eventId]);
    const requiredTotal = nextRequirements.reduce((sum, requirement) => sum + Number(requirement.count || 0), 0) || Number(body.requiredTotal ?? existing.required_total);
    transaction(() => {
      run(
        `UPDATE events
         SET name = ?, client_id = ?, date = ?, start_time = ?, end_time = ?, location = ?, address = ?, lat = ?, lng = ?,
             team_leader_id = ?, required_total = ?, notes = ?, budget = ?, google_maps_url = ?, vehicle_count = ?
         WHERE id = ?`,
        [
          body.name ?? existing.name,
          body.clientId ?? existing.client_id,
          body.date ?? existing.date,
          body.startTime ?? existing.start_time,
          body.endTime ?? existing.end_time,
          body.location ?? existing.location,
          body.address ?? existing.address,
          lat,
          lng,
          body.teamLeaderId === "" ? null : (body.teamLeaderId ?? existing.team_leader_id),
          requiredTotal,
          body.notes ?? existing.notes,
          body.budget === "" || body.budget === undefined ? existing.budget : Number(body.budget),
          body.googleMapsUrl ?? existing.google_maps_url,
          Number(body.vehicleCount ?? existing.vehicle_count ?? 1),
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
    const googleSync = await syncEventToGoogleCalendar(eventId, user, "event_updated", appOriginFromRequest(req));
    return sendJson(res, 200, { event: eventDetail(eventId), googleSync });
  }

  const closeEventMatch = pathname.match(/^\/api\/events\/([^/]+)\/close$/);
  if (closeEventMatch && method === "POST") {
    requireAdmin(user);
    const event = get("SELECT * FROM events WHERE id = ?", [closeEventMatch[1]]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    run("UPDATE events SET status = 'finalizado', closed_at = CURRENT_TIMESTAMP WHERE id = ?", [event.id]);
    audit(user, "event_closed", "event", event.id, { closedBy: user.id });
    const googleSync = await syncEventToGoogleCalendar(event.id, user, "event_closed", appOriginFromRequest(req));
    return sendJson(res, 200, { event: eventDetail(event.id), googleSync });
  }

  const duplicateMatch = pathname.match(/^\/api\/events\/([^/]+)\/duplicate$/);
  if (duplicateMatch && method === "POST") {
    requireAdmin(user);
    const source = eventDetail(duplicateMatch[1]);
    if (!source) return sendJson(res, 404, { error: "Evento no encontrado" });
    const body = await readBody(req);
    const id = randomId("evt");
    transaction(() => {
      run(
        `INSERT INTO events
          (id, name, client_id, date, start_time, end_time, location, address, lat, lng, team_leader_id,
           required_total, status, notes, budget, google_maps_url, vehicle_count, base_distance_km, billable_km,
           kilometre_price, role_price_total, night_price_total, distance_price_total, service_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          `${source.name} copia`,
          source.client_id,
          body.date || source.date,
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
          Number(source.service_price || source.budget || 0)
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
      updateEventStatus(id);
      updateEventPricing(id, pricingForEvent(id));
      audit(user, "event_duplicated", "event", id, {
        sourceEventId: source.id,
        date: body.date || source.date
      });
    });
    const googleSync = await syncEventToGoogleCalendar(id, user, "event_duplicated", appOriginFromRequest(req));
    return sendJson(res, 201, { event: eventDetail(id), googleSync });
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
    run(
      `INSERT INTO employees
        (id, name, role, phone, email, city, lat, lng, hourly_rate, km_rate, diet_rate, skills, notes,
         dni, social_security_number, bank_account, address, province, postal_code, birth_date,
         shirt_size, pants_size, shoe_size, jacket_size, epi_size, emergency_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        role,
        body.phone || "",
        body.email || "",
        body.city || "",
        Number(body.lat || 40.4168),
        Number(body.lng || -3.7038),
        Number(body.hourlyRate || 15),
        Number(body.kmRate || 0.24),
        Number(body.dietRate || 0),
        JSON.stringify(skills),
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
      email: body.email || "",
      phone: body.phone || ""
    });
    return sendJson(res, 201, { employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [id])) });
  }

  const employeeMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Operario no encontrado" });
    const role = employeeRoleFromBody(body, existing.role);
    const skills = employeeSkillsFromBody({ ...body, role }, jsonField(existing.skills));
    run(
      `UPDATE employees
       SET name = ?, role = ?, phone = ?, email = ?, status = ?, city = ?, lat = ?, lng = ?,
           hourly_rate = ?, km_rate = ?, diet_rate = ?, skills = ?, notes = ?, dni = ?,
           social_security_number = ?, bank_account = ?, address = ?, province = ?, postal_code = ?,
           birth_date = ?, shirt_size = ?, pants_size = ?, shoe_size = ?, jacket_size = ?,
           epi_size = ?, emergency_contact = ?
       WHERE id = ?`,
      [
        body.name ?? existing.name,
        role,
        body.phone ?? existing.phone,
        body.email ?? existing.email,
        body.status ?? existing.status,
        body.city ?? existing.city,
        Number(body.lat ?? existing.lat),
        Number(body.lng ?? existing.lng),
        Number(body.hourlyRate ?? existing.hourly_rate),
        Number(body.kmRate ?? existing.km_rate),
        Number(body.dietRate ?? existing.diet_rate),
        JSON.stringify(skills),
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
      status: body.status ?? existing.status,
      rateChanged: body.hourlyRate !== undefined || body.kmRate !== undefined || body.dietRate !== undefined,
      clothingChanged: body.shirtSize !== undefined || body.pantsSize !== undefined || body.shoeSize !== undefined
    });
    return sendJson(res, 200, { employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]])) });
  }

  if (pathname === "/api/assignments" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const event = get("SELECT * FROM events WHERE id = ?", [body.eventId]);
    const employee = get("SELECT * FROM employees WHERE id = ?", [body.employeeId]);
    if (!event || !employee) return sendJson(res, 404, { error: "Evento u operario no encontrado" });
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: las asignaciones quedan en modo solo revision" });
    }
    const existing = get("SELECT * FROM assignments WHERE event_id = ? AND employee_id = ?", [
      event.id,
      employee.id
    ]);
    if (existing) return sendJson(res, 409, { error: "El operario ya esta asignado a este evento" });
    const issues = validateAssignment(event, employee);
    if (issues.some((issue) => issue.severity === "block")) {
      return sendJson(res, 409, { error: "Asignacion bloqueada", issues });
    }
    const id = randomId("asg");
    const role = body.role || employee.role;
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
    const event = get("SELECT * FROM events WHERE id = ?", [existing.event_id]);
    const employee = get("SELECT * FROM employees WHERE id = ?", [existing.employee_id]);
    if (!event || !employee) return sendJson(res, 404, { error: "Evento u operario no encontrado" });
    if (eventPerformed(event)) {
      return sendJson(res, 409, { error: "Evento efectuado: solo se permite crear incidencias" });
    }
    const nextStatus = cleanAssignmentStatus(body.status, existing.status);
    const nextRole = body.role ?? existing.role;
    const issues = nextStatus === "bloqueado" ? [] : validateAssignment(event, employee);
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
    const event = get("SELECT * FROM events WHERE id = ?", [existing.event_id]);
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
    transaction(() => {
      run("DELETE FROM assignments WHERE id = ?", [existing.id]);
      if (event?.team_leader_id === existing.employee_id) {
        run("UPDATE events SET team_leader_id = NULL WHERE id = ?", [existing.event_id]);
      }
      updateEventStatus(existing.event_id);
      audit(user, "assignment_deleted", "assignment", existing.id, {
        eventId: existing.event_id,
        employeeId: existing.employee_id
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
    const active = event.status !== "finalizado" && event.date === formatDate();
    const geo = isInsideRadius(Number(body.lat), Number(body.lng), event.lat, event.lng, CLOCK_RADIUS_M);
    const accepted = Boolean(assignment && active && geo.inside);
    const type = body.type === "salida" ? "salida" : "entrada";
    const sequenceError = accepted ? clockSequenceError(event, assignment, employee.id, type) : null;
    if (sequenceError) {
      return sendJson(res, 409, {
        error: sequenceError,
        distance: geo.distance,
        radius: CLOCK_RADIUS_M
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
          (id, event_id, employee_id, type, lat, lng, distance_m, within_radius, accepted, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          event.id,
          employee.id,
          accepted ? type : `${type}_bloqueada`,
          Number(body.lat),
          Number(body.lng),
          geo.distance,
          geo.inside ? 1 : 0,
          accepted ? 1 : 0,
          accepted ? "" : "Intento de fichaje bloqueado"
        ]
      );
      if (leaderClockOut) {
        deliveryNote = signDeliveryNote(event, body);
        audit(user, "delivery_note_signed", "event", event.id, {
          deliveryNoteId: deliveryNote.id,
          signer: body.signatureName,
          servicePrice: Number(event.service_price || event.budget || 0)
        });
      }
    });
    if (!accepted) {
      const reason = !assignment
        ? "Operario no asignado"
        : !active
          ? "Evento no activo"
          : "Fuera del radio GPS";
      run(
        `INSERT INTO incidents (id, event_id, employee_id, type, priority, title, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomId("inc"), event.id, employee.id, "fichaje", "alta", "Fichaje bloqueado", `${reason}. Distancia: ${geo.distance} m.`]
      );
      return sendJson(res, 409, {
        error: reason,
        distance: geo.distance,
        radius: CLOCK_RADIUS_M,
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
      radius: CLOCK_RADIUS_M,
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
        `SELECT time_entries.*, events.name AS event_name, events.date AS event_date, employees.name AS employee_name
         FROM time_entries
         JOIN events ON events.id = time_entries.event_id
         JOIN employees ON employees.id = time_entries.employee_id
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
    const cleanType = ["entrada", "salida", "entrada_bloqueada", "salida_bloqueada"].includes(body.type)
      ? body.type
      : existing.type;
    run(
      `UPDATE time_entries
       SET type = ?, timestamp = ?, accepted = ?, notes = ?
       WHERE id = ?`,
      [
        cleanType,
        body.timestamp || existing.timestamp,
        body.accepted === undefined ? existing.accepted : (body.accepted ? 1 : 0),
        body.notes ?? existing.notes,
        existing.id
      ]
    );
    audit(user, "time_entry_corrected", "time_entry", existing.id, {
      type: cleanType,
      accepted: body.accepted,
      timestamp: body.timestamp || existing.timestamp
    });
    return sendJson(res, 200, {
      entry: get(
        `SELECT time_entries.*, events.name AS event_name, events.date AS event_date, employees.name AS employee_name
         FROM time_entries
         JOIN events ON events.id = time_entries.event_id
         JOIN employees ON employees.id = time_entries.employee_id
         WHERE time_entries.id = ?`,
        [existing.id]
      )
    });
  }

  if (pathname === "/api/incidents" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, {
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
    run(
      `UPDATE incidents
       SET status = ?,
           resolved_at = CASE WHEN ? = 'resuelta' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
      [nextStatus, nextStatus, existing.id]
    );
    audit(user, "incident_updated", "incident", existing.id, { status: nextStatus });
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
    return sendJson(res, 200, { documents: listDocuments() });
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

  const documentFileMatch = pathname.match(/^\/api\/documents\/([^/]+)\/file$/);
  if (documentFileMatch && method === "GET") {
    requireUser(user);
    const document = get("SELECT * FROM documents WHERE id = ?", [documentFileMatch[1]]);
    if (!document) return sendJson(res, 404, { error: "Documento no encontrado" });
    if (!canAccessDocument(user, document)) return sendJson(res, 403, { error: "Permiso insuficiente" });
    const filePath = documentFilePath(document);
    if (!filePath) return sendJson(res, 404, { error: "Archivo no disponible" });
    return send(res, 200, fs.readFileSync(filePath), {
      "content-type": document.file_mime || "application/octet-stream",
      "content-disposition": `inline; filename="${safeFileName(document.file_name || document.name)}"`,
      "cache-control": "private, max-age=60"
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
    return sendJson(res, 201, { incident: get("SELECT * FROM incidents WHERE id = ?", [id]) });
  }

  if (pathname === "/api/employee/home" && method === "GET") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const today = formatDate();
    const serviceSql = `
      SELECT events.id, events.name, events.date, events.start_time, events.end_time, events.location,
             events.address, events.lat, events.lng, events.status, events.notes,
             events.google_maps_url,
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
    const upcomingServices = all(
      `${serviceSql} AND events.date >= ?
       ORDER BY events.date ASC, events.start_time ASC
       LIMIT 12`,
      [employee.id, today]
    ).map((service) => employeeServiceClockData(service, employee.id));
    const nextAssignment = upcomingServices[0] || null;
    const pastServices = all(
      `${serviceSql} AND (events.date < ? OR events.status = 'finalizado')
       ORDER BY events.date DESC, events.start_time DESC
       LIMIT 12`,
      [employee.id, today]
    ).map((service) => employeeServiceClockData(service, employee.id));
    const coworkers = nextAssignment
      ? all(
          `SELECT employees.id, employees.name, employees.role
           FROM assignments
           JOIN employees ON employees.id = assignments.employee_id
           WHERE assignments.event_id = ? AND employees.id != ? AND assignments.status != 'bloqueado'
           ORDER BY employees.name`,
          [nextAssignment.id, employee.id]
        )
      : [];
    const documents = listDocuments({ employeeId: employee.id });
    const timeStats = get(
      `SELECT COUNT(DISTINCT event_id) AS events_done, COUNT(*) AS entries
       FROM time_entries
       WHERE employee_id = ? AND accepted = 1`,
      [employee.id]
    );
    const allowances = get(
      `SELECT COALESCE(SUM(km), 0) AS km,
              COALESCE(SUM(night_hours), 0) AS night_hours
       FROM allowances
       WHERE employee_id = ?`,
      [employee.id]
    );
    const incidents = get("SELECT COUNT(*) AS count FROM incidents WHERE employee_id = ?", [employee.id]).count;
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
    return sendJson(res, 200, {
      employee: employeePortalProfile(employee),
      nextService: nextAssignment,
      upcomingServices,
      pastServices,
      coworkers,
      documents,
      availability: availabilityRows,
      history: {
        events_done: timeStats.events_done,
        entries: timeStats.entries,
        hours: Math.round(plannedHours * 10) / 10,
        km: Math.round(Number(allowances.km || 0) * 10) / 10,
        night_hours: Number(allowances.night_hours || 0),
        incidents
      },
      radius: CLOCK_RADIUS_M
    });
  }

  if (pathname === "/api/employee/profile" && method === "PATCH") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const body = await readBody(req);
    const password = body.password ? hashPassword(body.password) : null;
    transaction(() => {
      run(
        `UPDATE employees
         SET phone = ?, email = ?, photo_url = ?
         WHERE id = ?`,
        [
          body.phone ?? employee.phone,
          body.email ?? employee.email,
          body.photoUrl ?? employee.photo_url,
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
          body.phone ?? user.phone,
          body.email ?? user.email,
          password?.hash || null,
          password?.salt || null,
          user.id
        ]
      );
      audit(user, "employee_profile_updated", "employee", employee.id, {
        emailChanged: body.email !== undefined,
        phoneChanged: body.phone !== undefined,
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

  if (pathname === "/api/finance/summary" && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { finance: financeSummary() });
  }

  if (pathname === "/api/reports/events" && method === "GET") {
    requireAdmin(user);
    const rows = listEvents().map((event) => ({
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
    return sendJson(res, 200, { rows });
  }

  if (pathname === "/api/reports/finance" && method === "GET") {
    requireAdmin(user);
    const rows = financeReportRows();
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
    return sendJson(res, 200, { rows });
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
        documentos: row.documents.map((document) => `${document.type}: ${documentStatusLabel(document.status)}${document.expires_at ? ` (${document.expires_at})` : ""}`).join(" | ")
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
    const backups = all("SELECT * FROM backups ORDER BY created_at DESC").map(backupStatus);
    return sendJson(res, 200, { backups });
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

  if (pathname === "/api/backups/restore" && method === "POST") {
    requireSuperAdmin(user);
    const body = await readBody(req);
    const backup = requestRestore(body.backupId);
    audit(user, "backup_restore_requested", "backup", backup.id, {
      type: backup.type,
      createdAt: backup.created_at
    });
    return sendJson(res, 202, {
      backup,
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
  res.writeHead(200, { "content-type": type });
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
    sendJson(res, status, {
      error: status === 500 ? "Error interno" : error.message,
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
    if (status === 500) console.error(error);
  }
});

server.listen(PORT, () => {
  console.log(`MARFAN CREW ERP escuchando en http://localhost:${PORT}`);
});

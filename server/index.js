const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  all,
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

fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });

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

function settingMap() {
  return Object.fromEntries(all("SELECT key, value FROM company_settings").map((row) => [row.key, row.value]));
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

function createPdfLines(title, lines) {
  const escapePdf = (value) => String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const content = [
    "BT",
    "/F1 16 Tf",
    "40 805 Td",
    `(${escapePdf(title)}) Tj`,
    "/F1 8 Tf",
    "0 -20 Td",
    ...lines.slice(1).flatMap((line) => [`(${escapePdf(line).slice(0, 138)}) Tj`, "0 -13 Td"]),
    "ET"
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
    return sendJson(res, 200, { token, user: publicUser(account), expiresAt });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = tokenFromRequest(req);
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
      settings: settingMap(),
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
    const allowed = ["base_address", "base_lat", "base_lng", "included_km", "vehicle_km_price", "office_phone", "office_whatsapp"];
    transaction(() => {
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        run(
          `INSERT INTO company_settings (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
          [key, String(body[key] ?? "")]
        );
      }
      audit(user, "settings_updated", "company_settings", "global", body);
    });
    repriceOpenEvents();
    return sendJson(res, 200, { settings: settingMap(), roles: listWorkRoles() });
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
    requireSuperAdmin(user);
    return sendJson(res, 200, { users: listUsers() });
  }

  if (pathname === "/api/users" && method === "POST") {
    requireSuperAdmin(user);
    const body = await readBody(req);
    const role = ["super_admin", "admin", "employee"].includes(body.role) ? body.role : "employee";
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
    return sendJson(res, 200, { events: listEvents({ from, to }) });
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
    });
    return sendJson(res, 201, { event: eventDetail(id) });
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
    return sendJson(res, 200, { event: eventDetail(eventId) });
  }

  const closeEventMatch = pathname.match(/^\/api\/events\/([^/]+)\/close$/);
  if (closeEventMatch && method === "POST") {
    requireAdmin(user);
    const event = get("SELECT * FROM events WHERE id = ?", [closeEventMatch[1]]);
    if (!event) return sendJson(res, 404, { error: "Evento no encontrado" });
    run("UPDATE events SET status = 'finalizado', closed_at = CURRENT_TIMESTAMP WHERE id = ?", [event.id]);
    audit(user, "event_closed", "event", event.id, { closedBy: user.id });
    return sendJson(res, 200, { event: eventDetail(event.id) });
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
    });
    return sendJson(res, 201, { event: eventDetail(id) });
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
    run(
      `INSERT INTO employees
        (id, name, role, phone, email, city, lat, lng, hourly_rate, km_rate, diet_rate, skills, notes,
         dni, social_security_number, bank_account, address, province, postal_code, birth_date,
         shirt_size, pants_size, shoe_size, jacket_size, epi_size, emergency_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.role || "Montaje",
        body.phone || "",
        body.email || "",
        body.city || "",
        Number(body.lat || 40.4168),
        Number(body.lng || -3.7038),
        Number(body.hourlyRate || 15),
        Number(body.kmRate || 0.24),
        Number(body.dietRate || 0),
        JSON.stringify(body.skills || []),
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
    return sendJson(res, 201, { employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [id])) });
  }

  const employeeMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    requireAdmin(user);
    const body = await readBody(req);
    const existing = get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Operario no encontrado" });
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
        body.role ?? existing.role,
        body.phone ?? existing.phone,
        body.email ?? existing.email,
        body.status ?? existing.status,
        body.city ?? existing.city,
        Number(body.lat ?? existing.lat),
        Number(body.lng ?? existing.lng),
        Number(body.hourlyRate ?? existing.hourly_rate),
        Number(body.kmRate ?? existing.km_rate),
        Number(body.dietRate ?? existing.diet_rate),
        JSON.stringify(body.skills || jsonField(existing.skills)),
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
    return sendJson(res, 200, { employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [employeeMatch[1]])) });
  }

  if (pathname === "/api/assignments" && method === "POST") {
    requireAdmin(user);
    const body = await readBody(req);
    const event = get("SELECT * FROM events WHERE id = ?", [body.eventId]);
    const employee = get("SELECT * FROM employees WHERE id = ?", [body.employeeId]);
    if (!event || !employee) return sendJson(res, 404, { error: "Evento u operario no encontrado" });
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
    return sendJson(res, 201, { assignment: get("SELECT * FROM assignments WHERE id = ?", [id]), issues });
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
    return sendJson(res, 200, {
      assignment: assignmentRowsForEvent(get("SELECT * FROM events WHERE id = ?", [event.id])).find((item) => item.id === existing.id),
      event: eventDetail(event.id)
    });
  }

  if (assignmentMatch && method === "DELETE") {
    requireAdmin(user);
    const existing = get("SELECT * FROM assignments WHERE id = ?", [assignmentMatch[1]]);
    if (!existing) return sendJson(res, 404, { error: "Asignacion no encontrada" });
    const timeEntries = get(
      "SELECT COUNT(*) AS count FROM time_entries WHERE event_id = ? AND employee_id = ?",
      [existing.event_id, existing.employee_id]
    ).count;
    if (timeEntries > 0) {
      return sendJson(res, 409, {
        error: "No se puede quitar una asignacion con fichajes. Cambiala a bloqueada para conservar trazabilidad."
      });
    }
    const event = get("SELECT * FROM events WHERE id = ?", [existing.event_id]);
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
    return sendJson(res, 200, { ok: true, event: eventDetail(existing.event_id) });
  }

  const recommendationsMatch = pathname.match(/^\/api\/planner\/recommendations$/);
  if (recommendationsMatch && method === "GET") {
    requireAdmin(user);
    return sendJson(res, 200, { recommendations: plannerRecommendations(url.searchParams.get("eventId")) });
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
    return sendJson(res, 201, {
      ok: true,
      distance: geo.distance,
      radius: CLOCK_RADIUS_M,
      entry: get("SELECT * FROM time_entries WHERE id = ?", [id]),
      deliveryNote
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
    return sendJson(res, 201, { incident: get("SELECT * FROM incidents WHERE id = ?", [id]) });
  }

  if (pathname === "/api/employee/home" && method === "GET") {
    requireUser(user);
    const employee = get("SELECT * FROM employees WHERE user_id = ?", [user.id]);
    if (!employee) return sendJson(res, 404, { error: "Empleado no encontrado" });
    const today = formatDate();
    const serviceSql = `
      SELECT events.id, events.name, events.date, events.start_time, events.end_time, events.location,
             events.address, events.lat, events.lng, events.status, events.notes, events.budget,
             events.google_maps_url, events.vehicle_count, events.base_distance_km, events.billable_km,
             events.distance_price_total, events.service_price,
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
    );
    const nextAssignment = upcomingServices[0] || null;
    const pastServices = all(
      `${serviceSql} AND (events.date < ? OR events.status = 'finalizado')
       ORDER BY events.date DESC, events.start_time DESC
       LIMIT 12`,
      [employee.id, today]
    );
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
              COALESCE(SUM(diet), 0) AS diets,
              COALESCE(SUM(night_hours), 0) AS night_hours,
              COALESCE(SUM(extras), 0) AS extras
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
      employee: parseEmployee(employee),
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
        diets: Number(allowances.diets || 0),
        night_hours: Number(allowances.night_hours || 0),
        extras: Number(allowances.extras || 0),
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
      employee: parseEmployee(get("SELECT * FROM employees WHERE id = ?", [employee.id]))
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
    return sendJson(res, 200, { backups: all("SELECT * FROM backups ORDER BY created_at DESC") });
  }

  if (pathname === "/api/backups" && method === "POST") {
    requireAdmin(user);
    const backup = createBackup("manual", `Backup manual por ${user.name}`);
    return sendJson(res, 201, { backup });
  }

  if (pathname === "/api/backups/restore" && method === "POST") {
    requireSuperAdmin(user);
    const body = await readBody(req);
    const backup = requestRestore(body.backupId);
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

const root = document.querySelector("#app");

const state = {
  token: localStorage.getItem("marfan_token"),
  user: null,
  loginMode: "admin",
  recoveryCode: "",
  showReset: false,
  view: "dashboard",
  employeeTab: "inicio",
  employeeServiceMode: "week",
  employeeServiceDate: todayIso(),
  selectedEventId: null,
  selectedEventSnapshotId: null,
  assignmentEventId: null,
  assignmentCandidateId: null,
  editEventId: null,
  selectedClientId: null,
  editClientId: null,
  selectedEmployeeId: null,
  editEmployeeId: null,
  calendarMode: "week",
  calendarDate: todayIso(),
  draggedEventId: null,
  recommendations: null,
  reportFilters: { from: "", to: "", clientId: "", employeeId: "", status: "", search: "" },
  searchQuery: "",
  eventSnapshots: {},
  publicConfigLoaded: false,
  publicConfig: { demoMode: false, demoAccounts: null },
  data: {},
  employeeHome: null
};

const navItems = [
  ["dashboard", "Dashboard", "grid", null, "dashboard"],
  ["users", "Administradores", "users", null, "users"],
  ["audit", "Auditoria", "shield", "super_admin", "audit"],
  ["live", "Centro Live", "pulse", null, "live"],
  ["calendar", "Calendario", "calendar", null, "calendar"],
  ["events", "Eventos", "briefcase", null, "events"],
  ["clients", "Clientes", "users", null, "clients"],
  ["employees", "Operarios", "hardhat", null, "employees"],
  ["availability", "Disponibilidad", "calendar", null, "availability"],
  ["assignments", "Asignaciones", "route", null, "assignments"],
  ["clocking", "Fichajes", "clock", null, "clocking"],
  ["incidents", "Incidencias", "alert", null, "incidents"],
  ["documents", "Documentacion", "file", null, "documents"],
  ["finances", "Finanzas", "euro", null, "finances"],
  ["reports", "Informes", "chart", null, "reports"],
  ["settings", "Configuracion", "settings", null, "settings"],
  ["backups", "Backups", "backup", null, "backups"]
];

const adminPermissionDefs = [
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

const statusMeta = {
  completo: ["Completo", "green"],
  falta_personal: ["Falta personal", "amber"],
  critico: ["Critico", "red"],
  sin_jefe: ["Sin jefe", "dark"],
  finalizado: ["Finalizado", "blue"],
  confirmado: ["Confirmado", "green"],
  pendiente: ["Pendiente", "amber"],
  en_curso: ["En curso", "blue"],
  google: ["Google", "google"]
};

const iconPaths = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  pulse: "M3 12h4l3-7 4 14 3-7h4",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  briefcase: "M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M4 7h16v12H4zM4 12h16",
  users: "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  hardhat: "M4 14h16M6 14v-2a6 6 0 0 1 12 0v2M9 14V9M15 14V9M5 14l1 6h12l1-6",
  route: "M6 4a3 3 0 1 0 0 6c3 0 3-6 0-6zM18 14a3 3 0 1 0 0 6c3 0 3-6 0-6zM9 7h5a4 4 0 0 1 0 8h-4",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2",
  alert: "M12 3 2 21h20zM12 9v5M12 18h.01",
  file: "M6 2h8l4 4v16H6zM14 2v5h5M9 13h6M9 17h6",
  euro: "M18 7a6 6 0 1 0 0 10M4 10h10M4 14h10",
  chart: "M4 19V5M8 19v-7M12 19V8M16 19v-4M20 19V3",
  backup: "M12 3a8 8 0 1 0 7.75 10M19.75 13H16v-3.75M12 8v5l3 2",
  shield: "M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-5",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.05a2 2 0 1 1-2.83 2.83l-.05-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.07a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.04a2 2 0 1 1-2.83-2.83l.04-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.07a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.04-.05a2 2 0 1 1 2.83-2.83l.05.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.07a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.05-.04a2 2 0 1 1 2.83 2.83l-.04.05A1.7 1.7 0 0 0 19.4 9c.22.61.78 1 1.55 1H21a2 2 0 1 1 0 4h-.07a1.7 1.7 0 0 0-1.53 1z",
  search: "M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16",
  logout: "M10 17l5-5-5-5M15 12H3M21 3v18h-7",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6",
  save: "M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3",
  check: "M20 6 9 17l-5-5",
  map: "M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3zM9 3v15M15 6v15",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3.11 5.18 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L9 10.5a16 16 0 0 0 4.5 4.5l1.17-1.22a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.92z",
  message: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
  home: "M3 11 12 3l9 8v10h-6v-6H9v6H3z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"
};

function icon(name) {
  const path = iconPaths[name] || iconPaths.grid;
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function meters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number)} m`;
}

function shortDevice(value) {
  const text = String(value || "");
  if (!text) return "-";
  if (/iPhone|iPad|iOS/i.test(text)) return "iOS";
  if (/Android/i.test(text)) return "Android";
  if (/Windows/i.test(text)) return "Windows";
  if (/Macintosh|Mac OS/i.test(text)) return "Mac";
  return text.length > 52 ? `${text.slice(0, 49)}...` : text;
}

function formatBytes(value) {
  let size = Number(value || 0);
  const units = ["B", "KB", "MB", "GB"];
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: size >= 10 || unit === 0 ? 0 : 1 }).format(size)} ${units[unit]}`;
}

function shortDate(value) {
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function shortDateTime(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const normalized = String(value).replace(" ", "T");
  return normalized.slice(0, 16);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name) {
  return String(name || "MC")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statusTag(status) {
  const [label, tone] = statusMeta[status] || [status || "Pendiente", "blue"];
  return `<span class="tag ${tone}">${esc(label)}</span>`;
}

function backupIntegrityTag(backup) {
  if (backup.verified) return `<span class="tag green">Verificado</span>`;
  if (!backup.path_valid) return `<span class="tag red">Ruta invalida</span>`;
  if (!backup.exists) return `<span class="tag red">No disponible</span>`;
  if (backup.integrity === "size_mismatch") return `<span class="tag amber">Revisar tamano</span>`;
  if (backup.integrity === "sqlite_corrupt") return `<span class="tag red">SQLite corrupto</span>`;
  if (backup.integrity === "sqlite_error") return `<span class="tag red">No abre</span>`;
  return `<span class="tag blue">Pendiente</span>`;
}

function roleTag(role) {
  const map = {
    super_admin: ["Super admin", "red"],
    admin: ["Administrador", "blue"],
    employee: ["Empleado", "green"]
  };
  const [label, tone] = map[role] || [role, "blue"];
  return `<span class="tag ${tone}">${label}</span>`;
}

function userCan(permission) {
  if (!permission || permission === "audit") return state.user?.role === "super_admin" || permission !== "audit";
  if (state.user?.role === "super_admin") return true;
  if (state.user?.role !== "admin") return false;
  return (state.user.permissions || {})[permission] !== false;
}

function userCanAny(permissions) {
  return permissions.some((permission) => userCan(permission));
}

function visibleNavItems() {
  return navItems.filter((item) => {
    const roleOk = !item[3] || item[3] === state.user?.role;
    return roleOk && userCan(item[4] || item[0]);
  });
}

function ensureVisibleAdminView() {
  const visible = visibleNavItems();
  if (!visible.some(([id]) => id === state.view)) {
    state.view = visible[0]?.[0] || "dashboard";
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("content-type") && options.body) headers.set("content-type", "application/json");
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("marfan_token");
      state.token = null;
      state.user = null;
      renderLogin();
    }
    const message = typeof payload === "string" ? payload : payload.error || "Operacion no disponible";
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function toast(message, kind = "info") {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = `toast ${kind === "error" ? "error" : ""}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function demoAccountForMode(mode) {
  return state.publicConfig?.demoAccounts?.[mode] || {};
}

function renderLogin() {
  const demoMode = Boolean(state.publicConfig?.demoMode);
  const demoAccount = demoMode ? demoAccountForMode(state.loginMode) : {};
  const identifierPlaceholder = state.loginMode === "admin" ? "admin@empresa.com o telefono" : "600 000 000";
  root.innerHTML = `
    <main class="login-page">
      <section class="login-brand">
        <div>
          ${brand()}
          <h1>Controla toda la operacion en menos de 30 segundos</h1>
          <p>Eventos, operarios, fichajes, documentacion, rentabilidad y backups en una sola plataforma creada para personal auxiliar de eventos.</p>
        </div>
        <div class="login-proof">
          <div class="proof-item"><strong>Live</strong><span>Centro operativo</span></div>
          <div class="proof-item"><strong>GPS</strong><span>Fichaje seguro</span></div>
          <div class="proof-item"><strong>A4</strong><span>Albaran por evento</span></div>
        </div>
      </section>
      <section class="login-panel">
        <form class="login-card" data-form="login">
          <h2>Entrar</h2>
          <p>${state.loginMode === "admin" ? "Acceso administrador" : "Portal empleado"}</p>
          <div class="segmented">
            <button type="button" data-login-mode="admin" class="${state.loginMode === "admin" ? "active" : ""}">Administrador</button>
            <button type="button" data-login-mode="employee" class="${state.loginMode === "employee" ? "active" : ""}">Empleado</button>
          </div>
          <div class="field">
            <label>${state.loginMode === "admin" ? "Email o telefono" : "Telefono de contacto o email"}</label>
            <input name="identifier" autocomplete="username" placeholder="${esc(identifierPlaceholder)}" value="${esc(demoAccount.identifier || "")}" required />
          </div>
          <div class="field">
            <label>Contrasena</label>
            <input name="password" type="password" autocomplete="current-password" placeholder="Tu contrasena" value="${esc(demoAccount.password || "")}" required />
          </div>
          <div class="remember-row">
            <label><input name="remember" type="checkbox" checked /> Recordar sesion</label>
            <button class="btn ghost" type="button" data-recover>Recuperar contrasena</button>
          </div>
          <button class="btn primary full" type="submit">${icon("check")} Entrar</button>
          ${demoMode ? `<div class="demo-grid">
            <button type="button" data-demo="admin">Demo admin</button>
            <button type="button" data-demo="employee">Demo empleado</button>
          </div>` : ""}
        </form>
        ${recoveryPanel()}
      </section>
    </main>
  `;
  queueMicrotask(() => window.scrollTo(0, 0));
}

function recoveryPanel() {
  if (!state.showReset && !state.recoveryCode) {
    return `<button class="btn ghost full" type="button" data-show-reset>${icon("refresh")} Tengo codigo de recuperacion</button>`;
  }
  return `
    <form class="recovery-box" data-form="reset-password">
      <h3>Nueva contrasena</h3>
      ${state.recoveryCode ? `<div class="recovery-code"><span>Codigo temporal</span><strong>${esc(state.recoveryCode)}</strong><small>Caduca en 20 minutos.</small></div>` : ""}
      <div class="field"><label>Codigo</label><input name="recoveryCode" value="${esc(state.recoveryCode)}" required /></div>
      <div class="field"><label>Nueva contrasena</label><input name="password" type="password" minlength="8" required /></div>
      <div class="field"><label>Repetir contrasena</label><input name="confirmPassword" type="password" minlength="8" required /></div>
      <button class="btn primary full" type="submit">${icon("check")} Cambiar contrasena</button>
    </form>
  `;
}

function brand() {
  return `
    <div class="brand-mark">
      <div class="brand-emblem"><img class="brand-logo" src="/assets/logo.png" alt="MARFAN CREW" /></div>
      <div class="brand-title"><span>MARFAN</span><span>CREW ERP</span></div>
    </div>
  `;
}

function employeeAvatar(employee) {
  const photo = String(employee?.photo_url || "").trim();
  if (photo) return `<div class="avatar"><img src="${esc(photo)}" alt="${esc(employee.name || "Operario")}" /></div>`;
  return `<div class="avatar">${initials(employee?.name || "")}</div>`;
}

async function init() {
  await loadPublicConfig();
  if (!state.token) return renderLogin();
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    await renderApp();
  } catch {
    renderLogin();
  }
}

async function loadPublicConfig(force = false) {
  if (state.publicConfigLoaded && !force) return;
  try {
    const response = await fetch("/api/public/config", { cache: "no-store" });
    if (response.ok) {
      state.publicConfig = await response.json();
    }
  } catch {
    state.publicConfig = { demoMode: false, demoAccounts: null };
  }
  state.publicConfigLoaded = true;
}

async function renderApp(force = false) {
  if (!state.user) return renderLogin();
  if (state.user.role === "employee") {
    await renderEmployee(force);
  } else {
    await renderAdmin(force);
  }
}

async function loadAdminData(force = false) {
  if (!force && state.data.dashboard) return;
  const emptyDashboard = { cards: [], live: [], alerts: [], updatedAt: new Date().toISOString() };
  const emptyLive = { cards: [], events: [], alerts: [], updatedAt: new Date().toISOString(), date: todayIso() };
  const needsEvents = userCanAny(["dashboard", "live", "calendar", "events", "assignments", "clocking", "incidents", "finances", "reports"]);
  const needsClients = userCanAny(["dashboard", "live", "calendar", "events", "assignments", "clients", "finances", "reports"]);
  const needsEmployees = userCanAny(["dashboard", "live", "events", "assignments", "clocking", "incidents", "documents", "availability", "employees", "finances", "reports"]);
  const needsRoles = userCanAny(["events", "assignments", "settings"]);
  const rolesSource = userCan("settings")
    ? api("/api/settings")
    : needsRoles
      ? api("/api/work-roles").then((result) => ({ settings: {}, roles: result.roles || [] }))
      : Promise.resolve({ settings: {}, roles: [] });
  const [dashboard, live, clients, employees, events, calendar, backups, incidents, availability, documents, timeEntries, finance, allowances, settings, users, imports, auditLogs] = await Promise.all([
    userCan("dashboard") ? api("/api/dashboard") : Promise.resolve(emptyDashboard),
    userCan("live") ? api("/api/live") : Promise.resolve(emptyLive),
    needsClients ? api("/api/clients") : Promise.resolve({ clients: [] }),
    needsEmployees ? api("/api/employees") : Promise.resolve({ employees: [] }),
    needsEvents ? api("/api/events") : Promise.resolve({ events: [] }),
    userCan("calendar") ? api("/api/calendar") : Promise.resolve({ events: [], googleStatus: {} }),
    userCan("backups") ? api("/api/backups") : Promise.resolve({ backups: [], automation: {} }),
    userCan("incidents") ? api("/api/incidents") : Promise.resolve({ incidents: [] }),
    userCan("availability") ? api("/api/availability") : Promise.resolve({ availability: [] }),
    userCan("documents") ? api("/api/documents") : Promise.resolve({ documents: [], compliance: { employees: [], totals: {} } }),
    userCan("clocking") ? api("/api/time-entries") : Promise.resolve({ entries: [] }),
    userCan("finances") ? api("/api/finance/summary") : Promise.resolve({ finance: { totals: {}, byClient: [], byMonth: [], byEmployee: [], topEvents: [] } }),
    userCan("finances") ? api("/api/allowances") : Promise.resolve({ allowances: [] }),
    rolesSource,
    userCan("users") ? api("/api/users") : Promise.resolve({ users: [] }),
    userCan("imports") ? api("/api/imports") : Promise.resolve({ imports: [] }),
    state.user.role === "super_admin" ? api("/api/audit-logs") : Promise.resolve({ logs: [] })
  ]);
  state.data = { dashboard, live, clients: clients.clients, employees: employees.employees, events: events.events, calendarEvents: calendar.events, googleStatus: calendar.googleStatus, backups: backups.backups, backupAutomation: backups.automation, incidents: incidents.incidents, incidentDetection: incidents.attendanceDetection, availability: availability.availability, documents: documents.documents, documentCompliance: documents.compliance, timeEntries: timeEntries.entries, finance: finance.finance, allowances: allowances.allowances, settings: settings.settings, roles: settings.roles, users: users.users, imports: imports.imports, auditLogs: auditLogs.logs };
  state.selectedEventId ||= dashboard.live[0]?.id || events.events[0]?.id;
  state.assignmentEventId ||= dashboard.live[0]?.id || events.events[0]?.id;
}

async function loadSelectedEventSnapshots(force = false) {
  const event = (state.data.events || []).find((item) => item.id === state.selectedEventId);
  if (!event) return;
  if (!force && state.eventSnapshots[event.id]) return;
  try {
    const result = await api(`/api/events/${encodeURIComponent(event.id)}/snapshots?limit=8`);
    state.eventSnapshots[event.id] = result.snapshots || [];
  } catch {
    state.eventSnapshots[event.id] = [];
  }
}

async function renderAdmin(force = false) {
  ensureVisibleAdminView();
  await loadAdminData(force);
  await loadSelectedEventSnapshots(force);
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div>${brand()}</div>
        <nav class="nav-list">
          ${visibleNavItems().map(([id, label, ico]) => `<button data-nav="${id}" class="${state.view === id ? "active" : ""}">${icon(ico)} ${label}</button>`).join("")}
        </nav>
        <div class="sidebar-foot">
          <strong>Marfan Crew S.L.</strong><br />
          <span><span class="status-dot"></span> Empresa activa</span>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="search-shell">
            <div class="search">${icon("search")}<input data-search autocomplete="off" value="${esc(state.searchQuery)}" placeholder="Buscar eventos, operarios, clientes..." /></div>
            ${globalSearchResultsView()}
          </div>
          <div></div>
          <div class="top-actions">
            <div class="date-chip">${icon("calendar")} ${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</div>
            <button class="btn" data-refresh>${icon("refresh")} Actualizar</button>
            <div class="profile-chip"><span class="avatar">${initials(state.user.name)}</span><span>${esc(state.user.name)}</span></div>
            <button class="btn" data-logout title="Cerrar sesion">${icon("logout")}</button>
          </div>
        </header>
        <section class="workspace">${adminView()}</section>
      </main>
    </div>
  `;
  queueMicrotask(() => {
    setupSignaturePads();
    window.scrollTo(0, 0);
  });
}

function adminView() {
  const views = {
    dashboard: dashboardView,
    users: usersView,
    audit: auditView,
    live: liveOperationsView,
    calendar: calendarView,
    events: eventsView,
    clients: clientsView,
    employees: employeesView,
    availability: availabilityAdminView,
    assignments: assignmentsView,
    clocking: clockingView,
    incidents: incidentsView,
    documents: documentsView,
    finances: financesView,
    reports: reportsView,
    settings: settingsView,
    backups: backupsView,
    imports: importsView
  };
  return (views[state.view] || dashboardView)();
}

function searchableText(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function globalSearchResults() {
  const query = searchableText(state.searchQuery || "").trim();
  if (query.length < 2) return [];
  const match = (...parts) => searchableText(...parts).includes(query);
  const events = (state.data.events || [])
    .filter((event) => match(event.name, event.client_name, event.location, event.address, event.date, event.status))
    .map((event) => ({
      type: "event",
      id: event.id,
      label: event.name,
      meta: `${event.client_name || "Cliente"} · ${event.date} · ${event.location || ""}`,
      tag: event.status === "falta_personal" ? "pendiente" : event.status,
      icon: "briefcase"
    }));
  const clients = (state.data.clients || [])
    .filter((client) => match(client.name, client.legal_name, client.tax_id, client.contact_name, client.email, client.phone, client.province))
    .map((client) => ({
      type: "client",
      id: client.id,
      label: client.name,
      meta: `${client.contact_name || "Contacto"} · ${client.email || client.phone || client.tax_id || ""}`,
      tag: "cliente",
      icon: "users"
    }));
  const employees = (state.data.employees || [])
    .filter((employee) => match(employee.name, employee.role, employee.phone, employee.email, employee.dni, employee.city, employee.province))
    .map((employee) => ({
      type: "employee",
      id: employee.id,
      label: employee.name,
      meta: `${employee.role || "Operario"} · ${employee.phone || employee.email || employee.dni || ""}`,
      tag: employee.status === "activo" ? "activo" : "bloqueado",
      icon: "hardhat"
    }));
  return [...events, ...employees, ...clients].slice(0, 9);
}

function searchResultTag(result) {
  if (result.type === "client") return `<span class="tag blue">Cliente</span>`;
  if (result.type === "employee") return `<span class="tag ${result.tag === "activo" ? "green" : "red"}">Operario</span>`;
  return statusTag(result.tag);
}

function globalSearchResultsView() {
  const query = String(state.searchQuery || "").trim();
  const results = globalSearchResults();
  const active = query.length >= 2;
  return `
    <div class="search-results ${active ? "active" : ""}" data-search-results>
      ${active ? `
        ${results.length ? results.map((result) => `
          <button class="search-result" data-search-go="${result.type}" data-search-id="${result.id}">
            <span class="search-result-icon">${icon(result.icon)}</span>
            <span><strong>${esc(result.label)}</strong><small>${esc(result.meta)}</small></span>
            ${searchResultTag(result)}
          </button>
        `).join("") : `<div class="search-empty">Sin resultados para "${esc(query)}"</div>`}
      ` : ""}
    </div>
  `;
}

function refreshGlobalSearchResults() {
  const panel = document.querySelector("[data-search-results]");
  if (panel) panel.outerHTML = globalSearchResultsView();
}

function openGlobalSearchResult(type, id) {
  if (type === "event") {
    state.view = "events";
    state.selectedEventId = id;
    state.editEventId = null;
  } else if (type === "employee") {
    state.view = "employees";
    state.selectedEmployeeId = id;
    state.editEmployeeId = null;
  } else if (type === "client") {
    state.view = "clients";
    state.selectedClientId = id;
    state.editClientId = null;
  }
  state.searchQuery = "";
  state.recommendations = null;
  return renderAdmin();
}

function dashboardView() {
  const { dashboard } = state.data;
  return `
    <div class="page-head">
      <div>
        <h1>${state.view === "live" ? "Centro operativo live" : "Dashboard"}</h1>
        <p>Centro de control con estado operativo en tiempo real.</p>
      </div>
      <div class="muted"><span class="status-dot"></span> Actualizacion automatica · ${new Date(dashboard.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
    </div>
    <section class="cards-grid">
      ${dashboard.cards.map(cardTemplate).join("")}
    </section>
    <section class="dashboard-grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Operaciones en directo</h2>
          <div class="filters-row">
            <button class="btn">${icon("calendar")} Hoy</button>
            <button class="btn">${icon("grid")} Columnas</button>
          </div>
        </div>
        ${eventsTable(dashboard.live)}
      </div>
      <aside class="panel">
        <div class="panel-head"><h2>Alertas operativas</h2></div>
        <div class="alerts">
          ${dashboard.alerts.map((alert) => `
            <div class="alert-item ${alert.tone}">
              <div class="row-between"><strong>${esc(alert.title)}</strong><small>${esc(alert.time)}</small></div>
              <small>${esc(alert.detail)}</small>
            </div>
          `).join("")}
        </div>
      </aside>
    </section>
  `;
}

function liveOperationsView() {
  const live = state.data.live || { cards: [], events: [], alerts: [], updatedAt: new Date().toISOString() };
  return `
    <div class="page-head">
      <div>
        <h1>Centro operativo live</h1>
        <p>Torre de control de servicios, fichajes, retrasos, incidencias y personal por cubrir.</p>
      </div>
      <div class="toolbar-actions">
        <button class="btn" data-detect-attendance-date="${esc(live.date || todayIso())}">${icon("alert")} Detectar incidencias</button>
        <div class="muted"><span class="status-dot"></span> Actualizado · ${new Date(live.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
    <section class="cards-grid">
      ${(live.cards || []).map(cardTemplate).join("")}
    </section>
    ${attendanceDetectionNotice(live.attendanceDetection)}
    <section class="live-layout">
      <div class="live-events">
        ${(live.events || []).map(liveEventCard).join("") || `<div class="panel"><div class="empty">No hay eventos programados para hoy.</div></div>`}
      </div>
      <aside class="panel">
        <div class="panel-head"><h2>Alertas live</h2></div>
        <div class="alerts">
          ${(live.alerts || []).map((alert) => `
            <div class="alert-item ${alert.tone}">
              <div class="row-between"><strong>${esc(alert.title)}</strong><small>${esc(alert.time)}</small></div>
              <small>${esc(alert.detail)}</small>
            </div>
          `).join("") || `<div class="empty">Sin alertas activas.</div>`}
        </div>
      </aside>
    </section>
  `;
}

function liveEventCard(event) {
  return `
    <article class="panel live-event-card">
      <div class="panel-head">
        <div>
          <h2>${esc(event.name)}</h2>
          <small class="muted">${esc(event.client_name)} · ${esc(event.location)} · ${esc(event.start_time)}-${esc(event.end_time)}</small>
        </div>
        ${liveStatusTag(event.liveStatus)}
      </div>
      <div class="live-kpis">
        <div><span>Equipo</span><strong>${esc(event.liveCounts.staff)} / ${esc(event.required_total)}</strong></div>
        <div><span>En curso</span><strong>${esc(event.liveCounts.inProgress)}</strong></div>
        <div><span>Tarde</span><strong>${esc(event.liveCounts.late)}</strong></div>
        <div><span>Inc.</span><strong>${esc(event.liveCounts.openIncidents)}</strong></div>
      </div>
      <div class="table-wrap">
        <table class="data-table live-staff-table">
          <thead><tr><th>Operario</th><th>Rol</th><th>Fichaje</th><th>Ultima marca</th><th>Avisos</th><th></th></tr></thead>
          <tbody>
            ${(event.staff || []).map((member) => `
              <tr>
                <td><strong>${esc(member.name)}</strong><br /><small class="muted">${esc(member.phone || member.email || "")}</small></td>
                <td>${esc(member.role)}<br /><small class="muted">${assignmentStatusLabel(member.assignmentStatus)}</small></td>
                <td>${liveClockTag(member.clockState)}</td>
                <td>${member.lastEntry ? `${esc(member.lastEntry.type)}<br /><small class="muted">${esc(member.lastEntry.timestamp)} · ${esc(member.lastEntry.distance_m || 0)} m</small>` : `<span class="muted">Sin marca</span>`}</td>
                <td>${liveMemberWarnings(member)}</td>
                <td><button class="btn compact" data-open-assignments="${event.id}">${icon("users")} Equipo</button></td>
              </tr>
            `).join("") || `<tr><td colspan="6"><div class="empty">Sin operarios asignados.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function liveStatusTag(status) {
  const map = {
    finalizado: ["Finalizado", "blue"],
    incidencias: ["Incidencias", "red"],
    tarde: ["Retrasos", "red"],
    falta_personal: ["Falta personal", "amber"],
    en_curso: ["En curso", "green"],
    pendiente: ["Pendiente", "blue"]
  };
  const [label, tone] = map[status] || ["Pendiente", "blue"];
  return `<span class="tag ${tone}">${label}</span>`;
}

function liveClockTag(status) {
  const map = {
    en_curso: ["En curso", "green"],
    finalizado: ["Salida OK", "blue"],
    tarde: ["Tarde", "red"],
    sin_fichar: ["Sin fichar", "amber"],
    pendiente: ["Pendiente", "amber"],
    bloqueado: ["Bloqueado", "red"]
  };
  const [label, tone] = map[status] || ["Sin fichar", "amber"];
  return `<span class="tag ${tone}">${label}</span>`;
}

function liveMemberWarnings(member) {
  const warnings = [
    ...(member.issues || []).map((issue) => issue.message),
    ...(member.incidents || []).map((incident) => incident.title)
  ];
  if (!warnings.length) return `<span class="tag green">OK</span>`;
  return warnings.slice(0, 2).map((text) => `<span class="tag red">${esc(text)}</span>`).join(" ");
}

function permissionEnabled(permissions, key) {
  return (permissions || {})[key] !== false;
}

function permissionChecklist(permissions = {}, compact = false) {
  return `
    <div class="permission-grid ${compact ? "compact" : ""}">
      ${adminPermissionDefs.map(([key, label]) => `
        <label class="permission-toggle">
          <input type="checkbox" name="perm_${esc(key)}" ${permissionEnabled(permissions, key) ? "checked" : ""} />
          <span>${esc(label)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function permissionSummary(user) {
  if (user.role === "super_admin") return `<span class="tag red">Acceso total</span>`;
  if (user.role === "employee") return `<span class="muted">Portal empleado</span>`;
  const active = adminPermissionDefs.filter(([key]) => permissionEnabled(user.permissions, key));
  return `<span class="tag blue">${active.length}/${adminPermissionDefs.length} modulos</span>`;
}

function userRecoveryStatus(user) {
  if (!user.recoveryPending) return "";
  const detail = user.recoveryExpiresAt ? `<small class="muted">Caduca ${esc(shortDateTime(user.recoveryExpiresAt))}</small>` : "";
  const count = Number(user.recoveryPendingCount || 0);
  return `<span class="tag amber">Recuperacion pendiente${count > 1 ? ` x${count}` : ""}</span>${detail ? `<br />${detail}` : ""}`;
}

function usersView() {
  const users = state.data.users || [];
  const isSuper = state.user?.role === "super_admin";
  const activeUsers = users.filter((user) => user.active).length;
  const admins = users.filter((user) => user.role !== "employee" && user.active).length;
  const employees = users.filter((user) => user.role === "employee" && user.active).length;
  const recoveries = users.filter((user) => user.recoveryPending).length;
  return `
    <div class="page-head">
      <div>
        <h1>Administradores</h1>
        <p>Alta de usuarios administradores, accesos internos y permisos de gestion.</p>
      </div>
      <div class="filters-row">
        <span class="tag ${isSuper ? "red" : "blue"}">${isSuper ? "Super Admin" : "Admin"}</span>
        <span class="muted">${activeUsers} usuarios activos</span>
      </div>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Usuarios activos", value: activeUsers, hint: "Con acceso habilitado", tone: "green" })}
      ${cardTemplate({ label: "Administradores", value: admins, hint: "Gestionan la empresa", tone: "blue" })}
      ${isSuper ? cardTemplate({ label: "Empleados", value: employees, hint: "Portal operario", tone: "ink" }) : ""}
      ${isSuper ? cardTemplate({ label: "Recuperaciones", value: recoveries, hint: "Solicitudes pendientes", tone: recoveries ? "amber" : "green" }) : ""}
      ${cardTemplate({ label: "Bloqueados", value: users.length - activeUsers, hint: "Sin acceso", tone: "red" })}
    </section>
    <section class="split-grid users-view" style="margin-top:16px">
      <div class="panel">
        <div class="panel-head"><h2>${isSuper ? "Usuarios del sistema" : "Administradores internos"}</h2></div>
        <div class="table-wrap">
          <table class="data-table users-table">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Contacto</th><th>Ficha operario</th><th>Permisos</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${users.map((user) => {
                const isSelf = user.id === state.user.id;
                return `
                  <tr>
                    <td><strong>${esc(user.name)}</strong><br /><small class="muted">${esc(user.id)}</small></td>
                    <td>${roleTag(user.role)}</td>
                    <td>${esc(user.email || "")}<br /><small class="muted">${esc(user.phone || "")}</small></td>
                    <td>${user.employeeId ? `<strong>${esc(user.employeeRole)}</strong><br /><small class="muted">${esc(user.employeeStatus)}</small>` : `<span class="muted">No vinculada</span>`}</td>
                    <td>
                      ${isSuper && user.role === "admin" ? `
                        <form class="permission-editor" data-form="user-permissions" data-user-id="${esc(user.id)}">
                          ${permissionSummary(user)}
                          <details>
                            <summary>Editar</summary>
                            ${permissionChecklist(user.permissions, true)}
                            <button class="btn compact primary" type="submit">${icon("check")} Guardar</button>
                          </details>
                        </form>
                      ` : permissionSummary(user)}
                    </td>
                    <td>${user.active ? statusTag("confirmado") : `<span class="tag red">Bloqueado</span>`}${userRecoveryStatus(user)}</td>
                    <td>
                      <div class="table-actions">
                        ${isSuper && user.role === "employee" ? `<button class="btn compact" data-user-role="${user.id}" data-next-role="admin">Admin</button>` : ""}
                        ${isSuper && user.role === "admin" ? `<button class="btn compact" data-user-role="${user.id}" data-next-role="employee">Empleado</button>` : ""}
                        ${isSuper ? `<button class="btn compact ${user.recoveryPending ? "primary" : ""}" data-reset-user="${user.id}">${user.recoveryPending ? "Nueva clave" : "Clave"}</button>` : ""}
                        ${isSuper && !isSelf ? `<button class="btn compact ${user.active ? "red" : ""}" data-user-active="${user.id}" data-next-active="${user.active ? "false" : "true"}">${user.active ? "Bloq." : "Act."}</button>` : `<span class="muted">${isSelf ? "Tu usuario" : "Solo lectura"}</span>`}
                      </div>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <form class="panel inspector" data-form="user">
        <h2>Crear administrador</h2>
        ${isSuper ? `<div class="field"><label>Rol de acceso</label><select name="role"><option value="admin">Administrador</option><option value="employee">Empleado / operario</option><option value="super_admin">Super admin</option></select></div>` : `<input type="hidden" name="role" value="admin" />`}
        <div class="field"><label>Nombre</label><input name="name" required /></div>
        <div class="field"><label>Email</label><input name="email" type="email" /></div>
        <div class="field"><label>Telefono</label><input name="phone" /></div>
        <div class="field"><label>Contrasena temporal</label><input name="password" type="password" minlength="8" required value="marfan123" /></div>
        ${isSuper ? `<div class="inspector-section">
          <h3>Permisos del administrador</h3>
          ${permissionChecklist()}
        </div>` : ""}
        ${isSuper ? `<div class="inspector-section">
          <h3>Ficha operario si es empleado</h3>
          <div class="field"><label>Rol operativo</label><select name="employeeRole"><option>Montaje</option><option>Carga y descarga</option><option>Tecnico</option><option>Runner</option><option>Jefe de equipo</option><option>Carretillero</option><option>Limpieza</option><option>Auxiliar produccion</option></select></div>
          <div class="field"><label>Ciudad</label><input name="city" value="Madrid" /></div>
          <div class="field"><label>Tarifa hora</label><input name="hourlyRate" type="number" value="16" /></div>
          <div class="field"><label>Skills</label><input name="skills" placeholder="montaje, runner, prl" /></div>
        </div>` : ""}
        <button class="btn primary full" type="submit">${icon("plus")} Crear administrador</button>
      </form>
    </section>
  `;
}

function auditActionLabel(action) {
  const labels = {
    login_success: "Inicio de sesion",
    logout: "Cierre de sesion",
    user_created: "Usuario creado",
    user_updated: "Usuario actualizado",
    user_deactivated: "Usuario bloqueado",
    event_created: "Evento creado",
    event_updated: "Evento actualizado",
    event_closed: "Evento cerrado",
    event_duplicated: "Evento duplicado",
    client_created: "Cliente creado",
    client_updated: "Cliente actualizado",
    client_deleted: "Cliente eliminado",
    employee_created: "Operario creado",
    employee_updated: "Operario actualizado",
    assignment_created: "Asignacion creada",
    assignment_updated: "Asignacion actualizada",
    assignment_deleted: "Asignacion eliminada",
    incident_created: "Incidencia creada",
    incident_updated: "Incidencia actualizada",
    incident_auto_detected: "Incidencia detectada",
    incident_auto_upgraded: "Incidencia elevada",
    employee_incident_created: "Incidencia operario",
    document_uploaded: "Documento subido",
    document_updated: "Documento revisado",
    document_file_opened: "Documento abierto",
    employee_document_uploaded: "Documento operario",
    data_import_completed: "Importacion completada",
    delivery_note_signed: "Albaran firmado",
    time_entry_created: "Fichaje registrado",
    time_entry_blocked: "Fichaje bloqueado",
    time_entry_corrected: "Fichaje corregido",
    employee_service_confirmed: "Servicio confirmado",
    client_dossier_exported: "Dossier cliente exportado",
    availability_created: "Disponibilidad creada",
    availability_updated: "Disponibilidad actualizada",
    employee_availability_requested: "Disponibilidad solicitada",
    settings_updated: "Configuracion actualizada",
    work_role_created: "Rol creado",
    work_role_updated: "Rol actualizado",
    backup_created: "Backup creado",
    backup_verified: "Backup verificado",
    backup_downloaded: "Backup descargado",
    backup_restore_requested: "Restauracion solicitada",
    google_event_imported: "Evento Google importado",
    google_events_bulk_imported: "Eventos Google importados",
    google_calendar_synced: "Google Calendar sincronizado",
    google_calendar_sync_failed: "Error sincronizando Google",
    password_recovery_requested: "Recuperacion solicitada",
    password_reset_completed: "Contrasena cambiada"
  };
  return labels[action] || action;
}

function auditTone(action) {
  if (action.includes("deleted") || action.includes("deactivated") || action.includes("restore")) return "red";
  if (action.includes("backup") || action.includes("signed") || action.includes("login")) return "green";
  if (action.includes("updated") || action.includes("corrected")) return "blue";
  return "amber";
}

function auditMetadata(metadata) {
  const text = JSON.stringify(metadata || {});
  if (text === "{}") return "-";
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function auditView() {
  const logs = state.data.auditLogs || [];
  const today = todayIso();
  const todayLogs = logs.filter((item) => String(item.created_at || "").startsWith(today)).length;
  const backupLogs = logs.filter((item) => item.entity === "backup").length;
  const userLogs = logs.filter((item) => item.entity === "user" || item.entity === "session").length;
  const exportable = logs.length > 0;
  return `
    <div class="page-head">
      <div>
        <h1>Auditoria</h1>
        <p>Registro Super Admin de accesos, cambios, backups, fichajes y operaciones sensibles.</p>
      </div>
      <div class="filters-row">
        <span class="tag red">Super Admin</span>
        <button class="btn primary" data-audit-csv ${exportable ? "" : "disabled"}>${icon("download")} CSV</button>
      </div>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Registros", value: logs.length, hint: "Ultimos movimientos", tone: "blue" })}
      ${cardTemplate({ label: "Hoy", value: todayLogs, hint: "Actividad del dia", tone: "green" })}
      ${cardTemplate({ label: "Seguridad", value: userLogs, hint: "Usuarios y sesiones", tone: "red" })}
      ${cardTemplate({ label: "Backups", value: backupLogs, hint: "Copias y restauracion", tone: "amber" })}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Actividad reciente</h2><span class="muted">Ultimos ${logs.length}</span></div>
      <div class="table-wrap">
        <table class="data-table audit-table">
          <thead><tr><th>Fecha</th><th>Actor</th><th>Accion</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody>
            ${logs.map((item) => `
              <tr>
                <td><strong>${esc(item.created_at)}</strong></td>
                <td>${esc(item.actor_name)}<br /><small class="muted">${esc(item.actor_role)} ${item.actor_email ? `· ${esc(item.actor_email)}` : ""}</small></td>
                <td><span class="tag ${auditTone(item.action)}">${esc(auditActionLabel(item.action))}</span><br /><small class="muted">${esc(item.action)}</small></td>
                <td><strong>${esc(item.entity || "-")}</strong><br /><small class="muted">${esc(item.entity_id || "-")}</small></td>
                <td><small class="muted">${esc(auditMetadata(item.metadata))}</small></td>
              </tr>
            `).join("") || `<tr><td colspan="5"><div class="empty">Aun no hay actividad registrada.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function cardTemplate(card) {
  return `
    <article class="metric-card" data-tone="${card.tone}">
      <div class="label">${esc(card.label)}</div>
      <strong>${card.money ? money(card.value) : esc(card.value)}</strong>
      <small>${esc(card.hint)}</small>
    </article>
  `;
}

function eventsTable(events) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Hora</th><th>Evento</th><th>Cliente</th><th>Ubicacion</th><th>Precio</th><th>Staffing</th><th>Fichados</th><th>Inc.</th><th>Margen</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${events.map((event) => `
            <tr>
              <td><strong>${esc(event.start_time)}</strong></td>
              <td><div class="event-name">${esc(event.name)}</div><small class="muted">${esc(event.id)}</small></td>
              <td>${esc(event.client_name)}</td>
              <td>${esc(event.location)}</td>
              <td><strong>${money(event.service_price || event.budget)}</strong><br /><small class="muted">${esc(event.base_distance_km || 0)} km base</small></td>
              <td><strong>${event.assigned_count} / ${event.required_total}</strong><div class="bar"><span style="width:${Math.min(100, (event.assigned_count / Math.max(event.required_total, 1)) * 100)}%"></span></div></td>
              <td>${event.clocked_count} / ${event.assigned_count}</td>
              <td>${event.incident_count}</td>
              <td><strong style="color:${event.finance.margin < 30 ? "var(--amber)" : "var(--green)"}">${event.finance.margin}%</strong></td>
              <td>${statusTag(event.status)}</td>
              <td><button class="btn" data-select-event="${event.id}">${icon("search")} Ver</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function calendarView() {
  const mode = state.calendarMode || "week";
  const base = parseLocalDate(state.calendarDate || todayIso());
  const events = state.data.calendarEvents || state.data.events || [];
  const google = state.data.googleStatus || {};
  const settings = state.data.settings || {};
  const pendingGoogleEvents = events.filter((event) => event.external);
  const selected = events.find((event) => event.id === state.selectedEventId) || events[0];
  return `
    <div class="page-head">
      <div>
        <h1>Calendario Pro</h1>
        <p>${esc(calendarSubtitle(mode))}</p>
      </div>
      <div class="calendar-toolbar">
        <button class="btn" data-calendar-nav="prev">${icon("refresh")} Anterior</button>
        <button class="btn" data-calendar-nav="today">Hoy</button>
        <button class="btn" data-calendar-nav="next">Siguiente</button>
        <span class="date-chip">${calendarTitle(mode, base)}</span>
        ${["month", "week", "day", "agenda"].map((item) => `<button class="btn ${mode === item ? "primary" : ""}" data-calendar-mode="${item}">${calendarModeLabel(item)}</button>`).join("")}
      </div>
    </div>
    <div class="calendar-sync-strip">
      <span class="tag green">MARFAN ${esc((state.data.events || []).length)} eventos</span>
      <span class="tag ${googleCalendarStatusTone(google.status)}">Google ${esc(google.status || "pendiente")}</span>
      ${pendingGoogleEvents.length ? `<button class="btn compact" type="button" data-import-visible-google-events>${icon("plus")} Importar ${pendingGoogleEvents.length} Google</button>` : ""}
      ${google.error ? `<small class="muted">${esc(google.error)}</small>` : `<small class="muted">${esc(googleCalendarStatusMessage(google))}</small>`}
    </div>
    ${settings.google_calendar_embed_url ? `
      <section class="panel google-calendar-panel">
        <div class="panel-head"><h2>Vista Google Calendar</h2><span class="tag google">Embed publico</span></div>
        <iframe src="${esc(settings.google_calendar_embed_url)}" title="Google Calendar MARFAN" loading="lazy"></iframe>
      </section>
    ` : ""}
    <section class="calendar-layout">
      ${renderCalendarBody(mode, base, events)}
      <aside class="panel inspector">
        ${selected ? eventInspector(selected) : `<div class="empty">Sin evento seleccionado</div>`}
      </aside>
    </section>
  `;
}

function renderCalendarBody(mode, base, events) {
  if (mode === "month") return monthCalendar(base, events);
  if (mode === "day") return dayCalendar(base, events);
  if (mode === "agenda") return agendaCalendar(base, events);
  return weekCalendar(base, events);
}

function weekCalendar(base, events) {
  const week = weekDays(base);
  const hours = calendarHours(events, week[0].iso, week[6].iso);
  return `
    <div class="calendar-grid week-grid">
      <div class="calendar-cell header"></div>
      ${week.map((day) => `<div class="calendar-cell header">${esc(day.label)}<br />${esc(day.short)}</div>`).join("")}
      ${hours.map((hour) => `
        <div class="calendar-cell time">${String(hour).padStart(2, "0")}:00</div>
        ${week.map((day) => calendarCell(day.iso, hour, events)).join("")}
      `).join("")}
    </div>
  `;
}

function dayCalendar(base, events) {
  const iso = isoDate(base);
  const hours = calendarHours(events, iso, iso);
  return `
    <div class="calendar-grid day-grid">
      <div class="calendar-cell header"></div>
      <div class="calendar-cell header">${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(base)}</div>
      ${hours.map((hour) => `
        <div class="calendar-cell time">${String(hour).padStart(2, "0")}:00</div>
        ${calendarCell(iso, hour, events)}
      `).join("")}
    </div>
  `;
}

function monthCalendar(base, events) {
  const days = monthDays(base);
  const month = base.getMonth();
  const weekdays = weekDays(base).map((day) => day.label);
  return `
    <div class="calendar-grid month-grid">
      ${weekdays.map((label) => `<div class="calendar-cell header">${esc(label)}</div>`).join("")}
      ${days.map((day) => {
        const matches = eventsForDay(day.iso, events);
        return `
          <div class="calendar-cell month-day ${day.date.getMonth() !== month ? "outside" : ""}" data-drop-date="${day.iso}">
            <div class="month-day-number">${day.date.getDate()}</div>
            <div class="month-events">
              ${matches.map((event) => calendarEventButton(event, true)).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function agendaCalendar(base, events) {
  const from = isoDate(base);
  const to = isoDate(addCalendarDays(base, 45));
  const matches = events
    .filter((event) => event.date >= from && event.date <= to)
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  return `
    <div class="calendar-agenda">
      ${matches.map((event) => `
        <div class="agenda-row" data-drop-date="${event.date}">
          <div>
            <strong>${shortDate(event.date)}</strong>
            <small class="muted">${esc(event.start_time)} - ${esc(event.end_time)}</small>
          </div>
          ${calendarEventButton(event, true)}
          <div class="agenda-meta">
            <span>${esc(event.client_name)}</span>
            ${event.external ? `<strong>Google</strong>` : `<strong>${money(event.service_price || event.budget)}</strong>`}
            ${statusTag(event.status)}
          </div>
        </div>
      `).join("") || `<div class="panel"><div class="empty">Sin eventos en los proximos 45 dias.</div></div>`}
    </div>
  `;
}

function calendarCell(dayIso, hour, events) {
  const matches = events.filter((event) => event.date === dayIso && Number(event.start_time.slice(0, 2)) === hour);
  return `
    <div class="calendar-cell" data-drop-date="${dayIso}" data-drop-time="${String(hour).padStart(2, "0")}:00">
      ${matches.map((event) => calendarEventButton(event)).join("")}
    </div>
  `;
}

function calendarEventButton(event, compact = false) {
  const tone = statusMeta[event.status]?.[1] || "blue";
  const draggable = !event.external && event.status !== "finalizado";
  return `
    <button class="calendar-event ${tone} ${compact ? "compact" : ""}" data-select-event="${event.id}" ${draggable ? `draggable="true" data-calendar-drag="${event.id}"` : ""}>
      <strong>${esc(event.start_time)} - ${esc(event.end_time)}</strong>
      <span>${esc(event.name)}</span>
      <small>${esc(event.location)}</small>
      <small>${event.external ? "Google Calendar · importar para editar" : `${event.assigned_count} / ${event.required_total} · ${money(event.service_price || event.budget)}`}</small>
    </button>
  `;
}

function weekDays(date) {
  const base = new Date(date);
  const day = base.getDay() || 7;
  base.setDate(base.getDate() - day + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(base);
    d.setDate(base.getDate() + index);
    return {
      iso: d.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(d),
      short: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(d)
    };
  });
}

function monthDays(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  const firstDay = start.getDay() || 7;
  start.setDate(start.getDate() - firstDay + 1);
  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    return { date: d, iso: isoDate(d) };
  });
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || todayIso()).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCalendarDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addCalendarMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function calendarHours(events, from, to) {
  const matching = events.filter((event) => event.date >= from && event.date <= to);
  const starts = matching.map((event) => Number(event.start_time.slice(0, 2))).filter(Number.isFinite);
  const ends = matching.map((event) => Number(event.end_time.slice(0, 2))).filter(Number.isFinite);
  const min = Math.max(0, Math.min(7, ...starts));
  const max = Math.min(23, Math.max(22, ...ends));
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function eventsForDay(dayIso, events) {
  return events
    .filter((event) => event.date === dayIso)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

function calendarTitle(mode, date) {
  if (mode === "month") {
    return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(date);
  }
  if (mode === "day") {
    return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  }
  if (mode === "agenda") {
    return `Agenda desde ${shortDate(isoDate(date))}`;
  }
  const week = weekDays(date);
  return `${shortDate(week[0].iso)} - ${shortDate(week[6].iso)}`;
}

function calendarSubtitle(mode) {
  const subtitles = {
    month: "Vista mensual para detectar carga de trabajo y huecos.",
    week: "Semana operativa con arrastre de servicios por dia y hora.",
    day: "Detalle diario para coordinar entradas, salidas y jefes.",
    agenda: "Listado rapido de proximos servicios con precio y estado."
  };
  return subtitles[mode] || subtitles.week;
}

function calendarModeLabel(mode) {
  const labels = { month: "Mes", week: "Semana", day: "Dia", agenda: "Agenda" };
  return labels[mode] || "Semana";
}

function addHoursToTime(time, hours) {
  const [hour, minute] = String(time).split(":").map(Number);
  const total = hour * 60 + minute + Math.max(15, Math.round(Number(hours || 1) * 60));
  const normalized = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function moveCalendar(direction) {
  const mode = state.calendarMode || "week";
  const base = parseLocalDate(state.calendarDate || todayIso());
  if (direction === "today") {
    state.calendarDate = todayIso();
    return;
  }
  const factor = direction === "prev" ? -1 : 1;
  if (mode === "month") state.calendarDate = isoDate(addCalendarMonths(base, factor));
  else if (mode === "day") state.calendarDate = isoDate(addCalendarDays(base, factor));
  else if (mode === "agenda") state.calendarDate = isoDate(addCalendarDays(base, factor * 14));
  else state.calendarDate = isoDate(addCalendarDays(base, factor * 7));
}

function googleSyncLabel(status) {
  const labels = {
    synced: "Sincronizado",
    pending_auth: "Pendiente credencial",
    pending: "Pendiente",
    error: "Error",
    disabled: "Desactivado",
    imported: "Importado desde Google"
  };
  return labels[status] || "Pendiente";
}

function googleCalendarStatusTone(status) {
  if (["connected", "connected_api", "connected_oauth", "embed_only"].includes(status)) return "blue";
  if (status === "disabled") return "amber";
  return "red";
}

function googleCalendarStatusMessage(google = {}) {
  if (google.message) return google.message;
  if (google.status === "connected_oauth") return "Eventos Google leidos con OAuth. Al importarlos y editarlos se actualiza el evento original en Google.";
  if (google.status === "connected_api") return "Eventos Google leidos por API.";
  if (google.status === "embed_only") return "Vista Google activa. Falta API key, OAuth conectado o URL iCal para tarjetas nativas.";
  return "Calendario Google enlazado por ICS/embed publico.";
}

function googleEventImportPayload(googleEvent) {
  return {
    id: googleEvent.id,
    googleUid: googleEvent.google_uid || googleEvent.id,
    googleEventId: googleEvent.google_event_id || "",
    source: googleEvent.source || "google",
    name: googleEvent.name,
    date: googleEvent.date,
    startTime: googleEvent.start_time,
    endTime: googleEvent.end_time,
    location: googleEvent.location,
    address: googleEvent.address,
    notes: googleEvent.notes,
    lat: googleEvent.lat,
    lng: googleEvent.lng,
    googleMapsUrl: googleEvent.google_maps_url || ""
  };
}

function eventInspector(event) {
  if (event.external) {
    return `
      <div>${statusTag("google")}</div>
      <h2>${esc(event.name)}</h2>
      <div class="muted">Evento externo de Google Calendar</div>
      <div class="inspector-section">
        <div class="role-row"><span>Fecha</span><strong>${shortDate(event.date)}</strong></div>
        <div class="role-row"><span>Horario</span><strong>${esc(event.start_time)} - ${esc(event.end_time)}</strong></div>
        <div class="role-row"><span>Ubicacion</span><strong>${esc(event.location || "-")}</strong></div>
      </div>
      <div class="inspector-section">
        <h3>Notas Google</h3>
        <p class="muted">${esc(event.notes || "Sin descripcion")}</p>
      </div>
      <div class="inspector-section">
        <button class="btn primary full" data-import-google-event="${esc(event.id)}">${icon("plus")} Importar y editar en MARFAN</button>
        <small class="muted">Se creara una ficha editable para asignar personal, completar ubicacion, ajustar horario y preparar el servicio.</small>
      </div>
    `;
  }
  if (state.editEventId === event.id) return eventEditForm(event);
  const locked = assignmentEventLocked(event);
  return `
    <div>${statusTag(event.status)}</div>
    <h2>${esc(event.name)}</h2>
    <div class="muted">${esc(event.client_name)} · ${esc(event.location)}</div>
    <div class="inspector-section">
      <div class="role-row"><span>Fecha</span><strong>${shortDate(event.date)}</strong></div>
      <div class="role-row"><span>Horario</span><strong>${esc(event.start_time)} - ${esc(event.end_time)}</strong></div>
      <div class="role-row"><span>Jefe de equipo</span><strong>${esc(event.team_leader_name || "Pendiente")}</strong></div>
      <div class="role-row"><span>Google Calendar</span><strong>${googleSyncLabel(event.google_sync_status)}</strong></div>
      ${event.google_sync_error ? `<small class="muted">${esc(event.google_sync_error)}</small>` : ""}
    </div>
    <div class="inspector-section">
      <div class="role-row"><span>Personal requerido</span><strong>${event.required_total}</strong></div>
      <div class="role-row"><span>Asignado</span><strong>${event.assigned_count}</strong></div>
      <div class="role-row"><span>Fichados</span><strong>${event.clocked_count}</strong></div>
      <div class="role-row"><span>Incidencias</span><strong>${event.incident_count}</strong></div>
      ${event.requirements?.length ? `<div class="requirements-summary">${event.requirements.map((item) => `<span class="tag blue">${esc(item.role)} x${esc(item.count)}</span>`).join("")}</div>` : ""}
      ${eventStaffWarnings(event)}
    </div>
    ${eventHistoryPanel(event)}
    ${eventDocumentsPanel(event)}
    <div class="inspector-section">
      <div class="role-row"><span>Presupuesto</span><strong>${money(event.budget)}</strong></div>
      <div class="role-row"><span>Precio servicio</span><strong>${money(event.service_price || event.budget)}</strong></div>
      <div class="role-row"><span>Distancia base</span><strong>${esc(event.base_distance_km || 0)} km</strong></div>
      <div class="role-row"><span>Km facturables</span><strong>${esc(event.billable_km || 0)} km</strong></div>
      <div class="role-row"><span>Kilometraje</span><strong>${money(event.distance_price_total || 0)}</strong></div>
      <div class="role-row"><span>Coste</span><strong>${money(event.finance.cost)}</strong></div>
      <div class="role-row"><span>Beneficio</span><strong>${money(event.finance.benefit)}</strong></div>
      <div class="role-row"><span>Margen</span><strong>${event.finance.margin}%</strong></div>
    </div>
    <div class="inspector-section">
      ${locked ? `<span class="tag blue">Solo revision</span>` : `<button class="btn primary" data-open-assignments="${event.id}">${icon("users")} Asignar personal</button>`}
      ${locked ? "" : `<button class="btn" data-edit-event="${event.id}">${icon("pen")} Editar evento</button>`}
      ${locked ? "" : `<button class="btn" data-close-event="${event.id}">${icon("check")} Cerrar evento</button>`}
      ${locked ? "" : `<button class="btn" data-duplicate="${event.id}">${icon("briefcase")} Duplicar evento</button>`}
      ${state.user?.role === "super_admin" ? `<button class="btn red-outline" data-delete-event="${event.id}">${icon("trash")} Eliminar evento</button>` : ""}
      <button class="btn" data-client-dossier="${event.id}">${icon("file")} Dossier cliente</button>
      <button class="btn" data-client-dossier-pdf="${event.id}">${icon("download")} PDF dossier</button>
      <button class="btn" data-albaran="${event.id}">${icon("file")} Albaran</button>
      <button class="btn" data-albaran-pdf="${event.id}">${icon("download")} PDF albaran</button>
      ${locked ? "" : `<button class="btn" data-google-sync-event="${event.id}">${icon("refresh")} Sincronizar Google</button>`}
      ${event.google_calendar_html_link ? `<a class="btn" href="${esc(event.google_calendar_html_link)}" target="_blank" rel="noopener">${icon("calendar")} Abrir Google</a>` : ""}
      <button class="btn">${icon("chart")} Rentabilidad</button>
    </div>
  `;
}

function eventDocumentsPanel(event) {
  const docs = event.documents || [];
  return `
    <div class="inspector-section">
      <div class="row-between"><h3>Documentos del evento</h3><span class="tag blue">${docs.length}</span></div>
      <div class="event-doc-list">
        ${docs.map((doc) => `
          <div class="event-doc-row">
            <div>
              <strong>${esc(doc.type || "Documento")}</strong>
              <small class="muted">${esc(doc.name || doc.file_name || "")}${doc.visible_to_employee ? " · visible operario" : " · interno"}</small>
            </div>
            ${doc.has_file ? `<button class="btn compact" type="button" data-event-document-file="${esc(doc.id)}" data-file-name="${esc(doc.file_name || doc.name || "documento")}">${icon("download")} Abrir</button>` : `<span class="muted">Sin archivo</span>`}
          </div>
        `).join("") || `<div class="empty compact-empty">Sin documentos de evento.</div>`}
      </div>
      <form class="inline-edit-form event-document-form" data-form="event-document" data-event-id="${esc(event.id)}">
        <select name="type"><option>Operativo</option><option>Recinto</option><option>Produccion</option><option>Cliente</option><option>PRL evento</option><option>Otro</option></select>
        <input name="name" placeholder="Nombre visible" required />
        <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv" />
        <label class="toggle-row compact-toggle"><input name="visibleToEmployee" type="checkbox" checked /> Operario</label>
        <button class="btn compact" type="submit">${icon("upload")} Subir</button>
      </form>
    </div>
  `;
}

function eventSnapshotSummary(snapshot) {
  const event = snapshot.payload?.event || {};
  const assignments = (event.assignments || []).filter((item) => item.status !== "bloqueado").length;
  const required = Number(event.required_total || 0);
  const entries = (event.timeEntries || []).length;
  const incidents = (event.incidents || []).length;
  const delivery = event.deliveryNote?.locked ? "Albaran firmado" : "Albaran pendiente";
  return `${shortDate(event.date || todayIso())} · ${esc(event.start_time || "--:--")} - ${esc(event.end_time || "--:--")} · Equipo ${assignments}/${required} · ${entries} fichajes · ${incidents} inc. · ${delivery}`;
}

function findSnapshot(snapshotId) {
  return Object.values(state.eventSnapshots || {})
    .flatMap((items) => items || [])
    .find((snapshot) => snapshot.id === snapshotId);
}

function snapshotList(items, renderItem, emptyText) {
  const rows = (items || []).slice(0, 6);
  if (!rows.length) return `<div class="empty compact-empty">${esc(emptyText)}</div>`;
  return rows.map(renderItem).join("");
}

function eventSnapshotDetail(snapshot) {
  const event = snapshot.payload?.event || {};
  const assignments = event.assignments || [];
  const entries = event.timeEntries || [];
  const incidents = event.incidents || [];
  const delivery = event.deliveryNote;
  return `
    <div class="snapshot-detail">
      <div class="snapshot-detail-head">
        <div>
          <strong>${esc(event.name || "Evento")}</strong>
          <small>${esc(event.client_name || "-")} · ${esc(event.location || "-")}</small>
        </div>
        <button class="btn compact" type="button" data-snapshot-json="${esc(snapshot.id)}">${icon("download")} JSON</button>
      </div>
      <div class="snapshot-kpis">
        <div><span>Horario</span><strong>${shortDate(event.date || todayIso())}<br />${esc(event.start_time || "--:--")} - ${esc(event.end_time || "--:--")}</strong></div>
        <div><span>Equipo</span><strong>${assignments.filter((item) => item.status !== "bloqueado").length}/${esc(event.required_total || 0)}</strong></div>
        <div><span>Precio</span><strong>${money(event.service_price || event.budget || 0)}</strong></div>
        <div><span>Estado</span><strong>${esc(event.status || "-")}</strong></div>
      </div>
      <div class="snapshot-columns">
        <section>
          <h4>Equipo</h4>
          ${snapshotList(assignments, (assignment) => `
            <div class="snapshot-row">
              <span>${esc(assignment.name || assignment.employee_name || "Operario")}</span>
              <strong>${esc(assignment.role || "-")}</strong>
              <small>${esc(assignment.status || "-")}</small>
            </div>
          `, "Sin equipo asignado")}
        </section>
        <section>
          <h4>Fichajes</h4>
          ${snapshotList(entries, (entry) => `
            <div class="snapshot-row">
              <span>${esc(entry.employee_name || "Operario")}</span>
              <strong>${esc(entry.type || "-")}</strong>
              <small>${esc(shortDateTime(entry.timestamp))} · ${entry.accepted ? "Aceptado" : "Bloqueado"} · ${esc(entry.distance_m || 0)} m</small>
            </div>
          `, "Sin fichajes")}
        </section>
        <section>
          <h4>Incidencias</h4>
          ${snapshotList(incidents, (incident) => `
            <div class="snapshot-row">
              <span>${esc(incident.title || incident.type || "Incidencia")}</span>
              <strong>${esc(incident.priority || "-")}</strong>
              <small>${esc(incident.status || "-")}</small>
            </div>
          `, "Sin incidencias")}
        </section>
      </div>
      <div class="snapshot-delivery">
        <span>Albaran</span>
        <strong>${delivery ? `${esc(delivery.status || "borrador")} · ${delivery.locked ? "bloqueado" : "editable"}` : "No generado"}</strong>
        ${delivery?.signature_name ? `<small>${esc(delivery.signature_name)} · ${esc(delivery.signature_dni || "")} · ${esc(shortDateTime(delivery.signed_at))}</small>` : ""}
      </div>
      <div class="snapshot-integrity ${snapshot.payload_hash_valid ? "valid" : "invalid"}">
        <span>Integridad</span>
        <strong>${snapshot.payload_hash_valid ? "Verificada" : "Alterada"}</strong>
        <small>${esc(snapshot.payload_hash ? snapshot.payload_hash.slice(0, 24) : "sin huella")}</small>
      </div>
    </div>
  `;
}

function eventHistoryPanel(event) {
  const snapshots = state.eventSnapshots?.[event.id] || [];
  const openSnapshot = snapshots.find((snapshot) => snapshot.id === state.selectedEventSnapshotId);
  return `
    <div class="inspector-section event-history-section">
      <div class="row-between">
        <h3>Historial protegido</h3>
        <span class="tag blue">${snapshots.length}</span>
      </div>
      <div class="event-timeline">
        ${snapshots.length ? snapshots.map((snapshot) => `
          <button class="event-history-item ${state.selectedEventSnapshotId === snapshot.id ? "active" : ""}" type="button" data-event-snapshot="${esc(snapshot.id)}">
            <span class="history-dot"></span>
            <div>
              <strong>${esc(auditActionLabel(snapshot.action))}</strong>
              <small>${esc(shortDateTime(snapshot.created_at))} · ${esc(snapshot.actor_name || "Sistema")}</small>
              <p>${eventSnapshotSummary(snapshot)}</p>
            </div>
          </button>
        `).join("") : `<div class="empty">Aun no hay snapshots de este evento.</div>`}
      </div>
      ${openSnapshot ? eventSnapshotDetail(openSnapshot) : ""}
    </div>
  `;
}

function eventStaffWarnings(event) {
  const warnings = (event.assignments || [])
    .flatMap((assignment) => (assignment.issues || []).map((issue) => ({ ...issue, employee: assignment.name })))
    .filter((issue) => issue.severity === "block");
  if (!warnings.length) return "";
  return `
    <div class="assignment-warnings">
      ${warnings.slice(0, 4).map((issue) => `<span class="tag red">${esc(issue.employee)} · ${esc(issue.message)}</span>`).join("")}
    </div>
  `;
}

function roleRequirementGrid(counts = null) {
  const roles = (state.data.roles || []).filter((role) => role.active);
  const existing = counts || {};
  return `
    <div class="role-requirements">
      ${roles.map((role) => {
        const defaultCount = counts ? Number(existing[role.name] || 0) : role.name === "Jefe de equipo" ? 1 : role.name === "Montaje" ? 5 : 0;
        return `
          <label class="role-requirement">
            <span><strong>${esc(role.name)}</strong><small>${money(role.base_price)}/h · N ${money(role.night_price)}/h</small></span>
            <input data-role-count="${esc(role.name)}" type="number" min="0" value="${defaultCount}" />
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function requirementCounts(requirements = []) {
  return Object.fromEntries(requirements.map((requirement) => [requirement.role, Number(requirement.count || 0)]));
}

function eventEditForm(event) {
  return `
    <form class="event-edit-form" data-form="event-edit" data-event-id="${event.id}">
      <div class="row-between">
        <div>${statusTag(event.status)}</div>
        <button class="btn" type="button" data-cancel-edit-event>${icon("refresh")} Cancelar</button>
      </div>
      <h2>Editar evento</h2>
      <div class="field"><label>Nombre</label><input name="name" required value="${esc(event.name)}" /></div>
      <div class="field"><label>Cliente</label><select name="clientId">${state.data.clients.map((client) => `<option value="${client.id}" ${client.id === event.client_id ? "selected" : ""}>${esc(client.name)}</option>`).join("")}</select></div>
      <div class="form-grid compact">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${esc(event.date)}" required /></div>
        <div class="field"><label>Inicio</label><input name="startTime" type="time" value="${esc(event.start_time)}" required /></div>
        <div class="field"><label>Fin</label><input name="endTime" type="time" value="${esc(event.end_time)}" required /></div>
        <div class="field"><label>Vehiculos</label><input name="vehicleCount" type="number" min="1" value="${esc(event.vehicle_count || 1)}" /></div>
      </div>
      <div class="field"><label>Equipo necesario</label>${roleRequirementGrid(requirementCounts(event.requirements || []))}</div>
      <div class="field"><label>Ubicacion</label><input name="location" value="${esc(event.location)}" required /></div>
      <div class="field"><label>Direccion</label><input name="address" value="${esc(event.address || event.location)}" /></div>
      <div class="field"><label>Link Google Maps</label><input name="googleMapsUrl" data-google-maps-url value="${esc(event.google_maps_url || "")}" /></div>
      <div class="form-grid compact">
        <div class="field"><label>Latitud</label><input name="lat" data-event-lat type="number" step="0.000001" value="${esc(event.lat)}" /></div>
        <div class="field"><label>Longitud</label><input name="lng" data-event-lng type="number" step="0.000001" value="${esc(event.lng)}" /></div>
        <div class="field"><label>Precio manual</label><input name="budget" type="number" min="0" value="${esc(event.budget || "")}" /></div>
      </div>
      <div class="field"><label>Jefe de equipo</label><select name="teamLeaderId"><option value="">Pendiente</option>${state.data.employees.map((employee) => `<option value="${employee.id}" ${employee.id === event.team_leader_id ? "selected" : ""}>${esc(employee.name)} · ${esc(employee.role)}</option>`).join("")}</select></div>
      <div class="field"><label>Notas</label><textarea name="notes">${esc(event.notes || "")}</textarea></div>
      <button class="btn primary full" type="submit">${icon("check")} Guardar cambios</button>
    </form>
  `;
}

function createEventForm() {
  return `
    <form class="panel inspector" data-form="event">
      <h2>Nuevo evento</h2>
      <div class="field"><label>Nombre</label><input name="name" required value="Montaje corporativo" /></div>
      <div class="field"><label>Cliente</label><select name="clientId">${state.data.clients.map((client) => `<option value="${client.id}">${esc(client.name)}</option>`).join("")}</select></div>
      <div class="form-grid">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${todayIso()}" required /></div>
        <div class="field"><label>Inicio</label><input name="startTime" type="time" value="09:00" required /></div>
        <div class="field"><label>Fin</label><input name="endTime" type="time" value="15:00" required /></div>
        <div class="field"><label>Vehiculos</label><input name="vehicleCount" type="number" min="1" value="1" /></div>
      </div>
      <div class="field"><label>Equipo necesario</label>${roleRequirementGrid()}</div>
      <div class="field"><label>Ubicacion</label><input name="location" value="Recinto en Malaga" required /></div>
      <div class="field"><label>Link Google Maps</label><input name="googleMapsUrl" data-google-maps-url placeholder="https://www.google.com/maps/..." /></div>
      <div class="form-grid compact">
        <div class="field"><label>Latitud</label><input name="lat" data-event-lat type="number" step="0.000001" /></div>
        <div class="field"><label>Longitud</label><input name="lng" data-event-lng type="number" step="0.000001" /></div>
        <div class="field"><label>Precio manual</label><input name="budget" type="number" min="0" placeholder="Auto" /></div>
      </div>
      <div class="field"><label>Jefe de equipo</label><select name="teamLeaderId"><option value="">Pendiente</option>${state.data.employees.map((employee) => `<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.role)}</option>`).join("")}</select></div>
      <div class="field"><label>Notas</label><textarea name="notes">Montaje, runners y apoyo de produccion.</textarea></div>
      <button class="btn primary full" type="submit">${icon("plus")} Crear evento</button>
    </form>
  `;
}

function eventsView() {
  const selected = state.data.events.find((event) => event.id === state.selectedEventId);
  return `
    <div class="page-head">
      <div><h1>Eventos</h1><p>Crear, duplicar, editar y cerrar servicios.</p></div>
      <button class="btn primary" data-new-event>${icon("plus")} Crear evento</button>
    </div>
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head"><h2>Todos los eventos</h2></div>
        ${eventsTable(state.data.events)}
      </div>
      ${selected ? `<aside class="panel inspector">${eventInspector(selected)}</aside>` : createEventForm()}
    </section>
  `;
}

function clientForm() {
  return `
    <form class="panel inspector" data-form="client">
      <h2>Nuevo cliente</h2>
      <div class="field"><label>Cliente</label><input name="name" required /></div>
      <div class="field"><label>Razon social</label><input name="legalName" /></div>
      <div class="field"><label>CIF/NIF</label><input name="taxId" /></div>
      <div class="field"><label>Contacto</label><input name="contactName" /></div>
      <div class="field"><label>Email</label><input name="email" type="email" /></div>
      <div class="field"><label>Telefono</label><input name="phone" /></div>
      <div class="field"><label>Direccion</label><input name="address" /></div>
      <div class="field"><label>Provincia</label><input name="province" /></div>
      <div class="field"><label>Observaciones</label><textarea name="notes"></textarea></div>
      <button class="btn primary full" type="submit">${icon("plus")} Crear cliente</button>
    </form>
  `;
}

function clientMetrics(client) {
  const events = state.data.events.filter((event) => event.client_id === client.id);
  const billing = events.reduce((sum, event) => sum + Number(event.service_price || event.budget || 0), 0);
  const cost = events.reduce((sum, event) => sum + Number(event.finance?.cost || 0), 0);
  const benefit = billing - cost;
  const margin = billing ? Math.round((benefit / billing) * 1000) / 10 : 0;
  return { events, billing, cost, benefit, margin };
}

function clientDetail(client) {
  if (state.editClientId === client.id) return clientEditForm(client);
  const metrics = clientMetrics(client);
  return `
    <aside class="panel inspector">
      <div class="row-between">
        <span class="tag blue">Cliente</span>
        <button class="btn" data-edit-client="${client.id}">${icon("pen")} Editar</button>
      </div>
      <h2>${esc(client.name)}</h2>
      <div class="muted">${esc(client.legal_name || client.tax_id || "Sin razon social")}</div>
      <div class="inspector-section">
        <div class="role-row"><span>CIF/NIF</span><strong>${esc(client.tax_id || "-")}</strong></div>
        <div class="role-row"><span>Contacto</span><strong>${esc(client.contact_name || "-")}</strong></div>
        <div class="role-row"><span>Email</span><strong>${esc(client.email || "-")}</strong></div>
        <div class="role-row"><span>Telefono</span><strong>${esc(client.phone || "-")}</strong></div>
        <div class="role-row"><span>Provincia</span><strong>${esc(client.province || "-")}</strong></div>
        <div class="role-row"><span>Direccion</span><strong>${esc(client.address || "-")}</strong></div>
      </div>
      <div class="inspector-section">
        <h3>Rentabilidad</h3>
        <div class="role-row"><span>Eventos</span><strong>${metrics.events.length}</strong></div>
        <div class="role-row"><span>Facturacion</span><strong>${money(metrics.billing)}</strong></div>
        <div class="role-row"><span>Coste</span><strong>${money(metrics.cost)}</strong></div>
        <div class="role-row"><span>Beneficio</span><strong>${money(metrics.benefit)}</strong></div>
        <div class="role-row"><span>Margen</span><strong>${metrics.margin}%</strong></div>
      </div>
      <div class="inspector-section">
        <h3>Historico</h3>
        <div class="mobile-list">
          ${metrics.events.slice(0, 8).map((event) => `
            <div class="mobile-list-item">
              <div><strong>${esc(event.name)}</strong><small class="muted">${shortDate(event.date)} · ${esc(event.location)}</small></div>
              <strong>${money(event.service_price || event.budget)}</strong>
            </div>
          `).join("") || `<div class="empty">Sin eventos registrados.</div>`}
        </div>
      </div>
      <div class="inspector-section">
        <h3>Observaciones</h3>
        <p class="muted">${esc(client.notes || "Sin observaciones")}</p>
        <button class="btn red-outline full" data-delete-client="${client.id}" ${(metrics.events.length && state.user?.role !== "super_admin") ? "disabled" : ""}>Eliminar cliente</button>
        ${metrics.events.length && state.user?.role === "super_admin" ? `<small class="muted">Como super admin tambien se eliminaran sus eventos.</small>` : ""}
      </div>
    </aside>
  `;
}

function clientEditForm(client) {
  return `
    <form class="panel inspector" data-form="client-edit" data-client-id="${client.id}">
      <div class="row-between">
        <h2>Editar cliente</h2>
        <button class="btn" type="button" data-cancel-edit-client>${icon("refresh")} Cancelar</button>
      </div>
      <div class="field"><label>Cliente</label><input name="name" required value="${esc(client.name)}" /></div>
      <div class="field"><label>Razon social</label><input name="legalName" value="${esc(client.legal_name || "")}" /></div>
      <div class="field"><label>CIF/NIF</label><input name="taxId" value="${esc(client.tax_id || "")}" /></div>
      <div class="field"><label>Contacto</label><input name="contactName" value="${esc(client.contact_name || "")}" /></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(client.email || "")}" /></div>
      <div class="field"><label>Telefono</label><input name="phone" value="${esc(client.phone || "")}" /></div>
      <div class="field"><label>Direccion</label><input name="address" value="${esc(client.address || "")}" /></div>
      <div class="field"><label>Provincia</label><input name="province" value="${esc(client.province || "")}" /></div>
      <div class="field"><label>Observaciones</label><textarea name="notes">${esc(client.notes || "")}</textarea></div>
      <button class="btn primary full" type="submit">${icon("check")} Guardar cliente</button>
    </form>
  `;
}

function clientsView() {
  const selected = state.data.clients.find((client) => client.id === state.selectedClientId);
  return `
    <div class="page-head">
      <div><h1>Clientes</h1><p>Ficha fiscal, contactos, historico y rentabilidad.</p></div>
      <button class="btn primary" data-new-client>${icon("plus")} Nuevo cliente</button>
    </div>
    ${clientImportPanel()}
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head"><h2>Clientes activos</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Cliente</th><th>Contacto</th><th>Email</th><th>Telefono</th><th>Provincia</th><th>Eventos</th><th>Facturacion</th><th></th></tr></thead>
            <tbody>
              ${state.data.clients.map((client) => {
                const metrics = clientMetrics(client);
                return `<tr><td><strong>${esc(client.name)}</strong><br /><small class="muted">${esc(client.legal_name || client.tax_id || "")}</small></td><td>${esc(client.contact_name)}</td><td>${esc(client.email)}</td><td>${esc(client.phone)}</td><td>${esc(client.province || "")}</td><td>${metrics.events.length}</td><td>${money(metrics.billing)}</td><td><button class="btn" data-select-client="${client.id}">${icon("search")} Ver</button></td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
      ${selected ? clientDetail(selected) : clientForm()}
    </section>
  `;
}

function clientImportPanel() {
  const last = (state.data.imports || []).find((item) => item.metadata?.kind === "clients");
  return `
    <form class="panel import-panel" data-form="client-import">
      <div class="row-between">
        <div>
          <h2>Importar clientes</h2>
          <p class="muted">Sube Excel, CSV o TSV. Actualiza por CIF o nombre y no duplica fichas.</p>
        </div>
        <div class="filters-row">
          <input name="file" type="file" accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values" required />
          <button class="btn" type="button" data-client-template>${icon("download")} Plantilla</button>
          <button class="btn primary" type="submit">${icon("upload")} Importar</button>
        </div>
      </div>
      ${last ? `<small class="muted">Ultima carga: ${esc(last.source)} · ${esc(last.inserted)} nuevos · ${esc(last.updated)} actualizados · ${esc(last.skipped)} omitidos</small>` : ""}
    </form>
  `;
}

function importsView() {
  const imports = state.data.imports || [];
  const inserted = imports.reduce((sum, item) => sum + Number(item.inserted || 0), 0);
  const updated = imports.reduce((sum, item) => sum + Number(item.updated || 0), 0);
  const skipped = imports.reduce((sum, item) => sum + Number(item.skipped || 0), 0);
  const rowsRead = imports.reduce((sum, item) => sum + Number(item.rows_read || item.rowsRead || 0), 0);
  const cards = [
    { label: "Cargas", value: imports.length, hint: "Ultimas importaciones", tone: "blue" },
    { label: "Filas leidas", value: rowsRead, hint: "Registros procesados", tone: "blue" },
    { label: "Nuevos", value: inserted, hint: "Fichas creadas", tone: "green" },
    { label: "Actualizados", value: updated, hint: `${skipped} omitidos`, tone: "amber" }
  ];
  return `
    <div class="page-head">
      <div><h1>Importaciones</h1><p>Carga datos reales de operarios y clientes desde Excel, CSV o TSV sin duplicar fichas.</p></div>
    </div>
    <section class="cards-grid">
      ${cards.map(cardTemplate).join("")}
    </section>
    <section class="split-grid">
      ${employeeImportPanel()}
      ${clientImportPanel()}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Historial de importaciones</h2><span class="muted">${imports.length} cargas</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Archivo</th><th>Filas</th><th>Nuevos</th><th>Actualizados</th><th>Omitidos</th><th>Usuarios</th></tr></thead>
          <tbody>
            ${imports.map((item) => {
              const metadata = item.metadata || {};
              const kind = metadata.kind === "employees" ? "Operarios" : metadata.kind === "clients" ? "Clientes" : "Datos";
              return `
                <tr>
                  <td>${esc(shortDateTime(item.created_at))}</td>
                  <td>${statusTag(metadata.kind === "employees" ? "confirmado" : metadata.kind === "clients" ? "pendiente" : "finalizado")}<br /><small>${esc(kind)}</small></td>
                  <td><strong>${esc(item.source || "-")}</strong></td>
                  <td>${esc(item.rows_read || 0)}</td>
                  <td>${esc(item.inserted || 0)}</td>
                  <td>${esc(item.updated || 0)}</td>
                  <td>${esc(item.skipped || 0)}</td>
                  <td>${metadata.usersCreated === undefined ? "-" : esc(metadata.usersCreated)}</td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="8"><div class="empty">Todavia no hay importaciones registradas.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function employeeForm() {
  return `
    <form class="panel inspector" data-form="employee">
      <h2>Nuevo operario</h2>
      <div class="field"><label>Nombre</label><input name="name" required /></div>
      <div class="field"><label>Rol</label><select name="role"><option>Montaje</option><option>Carga y descarga</option><option>Tecnico</option><option>Runner</option><option>Jefe de equipo</option><option>Carretillero</option><option>Limpieza</option><option>Auxiliar produccion</option></select></div>
      <div class="leader-toggle">
        <label class="toggle-row"><input name="teamLeader" type="checkbox" /> Jefe de equipo</label>
        <small>Activa firma de cliente en salida y responsabilidad sobre el albaran.</small>
      </div>
      <div class="field"><label>Telefono</label><input name="phone" /></div>
      <div class="field"><label>Email</label><input name="email" type="email" /></div>
      <div class="leader-toggle">
        <label class="toggle-row"><input name="portalAccess" type="checkbox" checked /> Crear acceso portal empleado</label>
        <small>El operario podra entrar con su email o telefono y la contrasena temporal.</small>
      </div>
      <div class="field"><label>Contrasena portal</label><input name="portalPassword" type="password" minlength="8" value="Marfan2026!" /></div>
      <div class="form-grid compact">
        <div class="field"><label>Tarifa hora</label><input name="hourlyRate" type="number" value="16" /></div>
        <div class="field"><label>Km</label><input name="kmRate" type="number" step="0.01" value="0.24" /></div>
      </div>
      <div class="field"><label>Skills</label><input name="skills" placeholder="montaje, carga, runner" /></div>
      <div class="form-grid compact">
        <div class="field"><label>DNI</label><input name="dni" /></div>
        <div class="field"><label>NSS</label><input name="socialSecurityNumber" /></div>
      </div>
      <div class="field"><label>Cuenta bancaria</label><input name="bankAccount" /></div>
      <div class="form-grid compact">
        <div class="field"><label>Camiseta</label><input name="shirtSize" /></div>
        <div class="field"><label>Pantalon</label><input name="pantsSize" /></div>
        <div class="field"><label>Calzado</label><input name="shoeSize" /></div>
        <div class="field"><label>Chaqueta</label><input name="jacketSize" /></div>
      </div>
      <div class="field"><label>EPI / observacion de talla</label><input name="epiSize" /></div>
      <button class="btn primary full" type="submit">${icon("plus")} Crear operario</button>
    </form>
  `;
}

function employeeDetail(employee) {
  if (state.editEmployeeId === employee.id) return employeeEditForm(employee);
  const docs = (state.data.documents || []).filter((doc) => doc.employee_id === employee.id);
  const incidents = (state.data.incidents || []).filter((incident) => incident.employee_id === employee.id);
  const entries = (state.data.timeEntries || []).filter((entry) => entry.employee_id === employee.id);
  return `
    <aside class="panel inspector">
      <div class="row-between">
        ${statusTag(employee.status === "activo" ? "confirmado" : "pendiente")}
        <div class="filters-row">
          <button class="btn" data-edit-employee="${employee.id}">${icon("pen")} Editar</button>
          ${state.user?.role === "super_admin" ? `<button class="btn red-outline" data-delete-employee="${employee.id}">${icon("trash")} Eliminar</button>` : ""}
        </div>
      </div>
      <h2>${esc(employee.name)}</h2>
      <div class="muted">${esc(employee.role)} · ${esc(employee.city || employee.province || "Sin ciudad")}</div>
      <div class="inspector-section">
        <div class="role-row"><span>Telefono</span><strong>${esc(employee.phone || "-")}</strong></div>
        <div class="role-row"><span>Email</span><strong>${esc(employee.email || "-")}</strong></div>
        <div class="role-row"><span>Portal empleado</span><strong>${employee.user_id ? "Activo" : "Sin acceso"}</strong></div>
        <div class="role-row"><span>DNI</span><strong>${esc(employee.dni || "-")}</strong></div>
        <div class="role-row"><span>NSS</span><strong>${esc(employee.social_security_number || "-")}</strong></div>
        <div class="role-row"><span>Banco</span><strong>${esc(employee.bank_account || "-")}</strong></div>
      </div>
      <div class="inspector-section">
        <div class="role-row"><span>Tarifa hora</span><strong>${money(employee.hourly_rate)}/h</strong></div>
        <div class="role-row"><span>Km</span><strong>${money(employee.km_rate)}/km</strong></div>
        <div class="role-row"><span>Dieta</span><strong>${money(employee.diet_rate)}</strong></div>
      </div>
      <div class="inspector-section">
        <h3>Tallaje</h3>
        <div class="requirements-summary">
          <span class="tag blue">Camiseta ${esc(employee.shirt_size || "-")}</span>
          <span class="tag blue">Pantalon ${esc(employee.pants_size || "-")}</span>
          <span class="tag blue">Calzado ${esc(employee.shoe_size || "-")}</span>
          <span class="tag blue">Chaqueta ${esc(employee.jacket_size || "-")}</span>
        </div>
      </div>
      <div class="inspector-section">
        <h3>Documentacion</h3>
        ${docs.map((doc) => `<div class="role-row"><span>${esc(doc.type)} · ${esc(doc.name)}<br /><small class="muted">${esc(doc.expires_at || "Sin caducidad")}</small></span><span>${documentTag(doc.status)} ${documentExpiryText(doc)}</span></div>`).join("") || `<div class="empty">Sin documentos</div>`}
      </div>
      <div class="inspector-section">
        <h3>Actividad</h3>
        <div class="role-row"><span>Incidencias</span><strong>${incidents.length}</strong></div>
        <div class="role-row"><span>Fichajes</span><strong>${entries.length}</strong></div>
        <div class="role-row"><span>Skills</span><strong>${employee.skills.map(esc).join(", ") || "-"}</strong></div>
      </div>
      <div class="inspector-section">
        ${employee.role === "Jefe de equipo" ? `<span class="tag green">Jefe de equipo</span>` : `<button class="btn full" data-promote-leader="${employee.id}">${icon("hardhat")} Asignar jefe de equipo</button>`}
      </div>
    </aside>
  `;
}

function employeeEditForm(employee) {
  return `
    <form class="panel inspector" data-form="employee-edit" data-employee-id="${employee.id}">
      <div class="row-between">
        <h2>Editar operario</h2>
        <button class="btn" type="button" data-cancel-edit-employee>${icon("refresh")} Cancelar</button>
      </div>
      <div class="field"><label>Nombre</label><input name="name" required value="${esc(employee.name)}" /></div>
      <div class="field"><label>Rol</label><select name="role">${["Montaje", "Carga y descarga", "Tecnico", "Runner", "Jefe de equipo", "Carretillero", "Limpieza", "Auxiliar produccion", "Operario"].map((role) => `<option ${employee.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></div>
      <div class="leader-toggle">
        <label class="toggle-row"><input name="teamLeader" type="checkbox" ${employee.role === "Jefe de equipo" || (employee.skills || []).includes("jefe") ? "checked" : ""} /> Jefe de equipo</label>
        <small>Este rol permite firmar con el cliente al fichar salida y genera albaran.</small>
      </div>
      <div class="form-grid compact">
        <div class="field"><label>Telefono</label><input name="phone" value="${esc(employee.phone || "")}" /></div>
        <div class="field"><label>Email</label><input name="email" type="email" value="${esc(employee.email || "")}" /></div>
        <div class="field"><label>Estado</label><select name="status"><option value="activo" ${employee.status === "activo" ? "selected" : ""}>Activo</option><option value="bloqueado" ${employee.status !== "activo" ? "selected" : ""}>Bloqueado</option></select></div>
        <div class="field"><label>Ciudad</label><input name="city" value="${esc(employee.city || "")}" /></div>
      </div>
      ${employee.user_id ? `<div class="leader-toggle"><span class="tag green">Portal empleado activo</span><small>El acceso se sincroniza con nombre, email, telefono y estado.</small></div>` : `
        <div class="leader-toggle">
          <label class="toggle-row"><input name="portalAccess" type="checkbox" /> Activar acceso portal empleado</label>
          <small>Necesita email o telefono para iniciar sesion.</small>
        </div>
        <div class="field"><label>Contrasena portal</label><input name="portalPassword" type="password" minlength="8" value="Marfan2026!" /></div>
      `}
      <div class="form-grid compact">
        <div class="field"><label>Tarifa hora</label><input name="hourlyRate" type="number" step="0.01" value="${esc(employee.hourly_rate || 0)}" /></div>
        <div class="field"><label>Km</label><input name="kmRate" type="number" step="0.01" value="${esc(employee.km_rate || 0)}" /></div>
        <div class="field"><label>Dieta</label><input name="dietRate" type="number" step="0.01" value="${esc(employee.diet_rate || 0)}" /></div>
      </div>
      <div class="field"><label>Skills</label><input name="skills" value="${esc((employee.skills || []).join(", "))}" /></div>
      <div class="form-grid compact">
        <div class="field"><label>DNI</label><input name="dni" value="${esc(employee.dni || "")}" /></div>
        <div class="field"><label>NSS</label><input name="socialSecurityNumber" value="${esc(employee.social_security_number || "")}" /></div>
      </div>
      <div class="field"><label>Cuenta bancaria</label><input name="bankAccount" value="${esc(employee.bank_account || "")}" /></div>
      <div class="field"><label>Direccion</label><input name="address" value="${esc(employee.address || "")}" /></div>
      <div class="form-grid compact">
        <div class="field"><label>Provincia</label><input name="province" value="${esc(employee.province || "")}" /></div>
        <div class="field"><label>CP</label><input name="postalCode" value="${esc(employee.postal_code || "")}" /></div>
        <div class="field"><label>Latitud</label><input name="lat" type="number" step="0.000001" value="${esc(employee.lat || "")}" /></div>
        <div class="field"><label>Longitud</label><input name="lng" type="number" step="0.000001" value="${esc(employee.lng || "")}" /></div>
      </div>
      <div class="form-grid compact">
        <div class="field"><label>Camiseta</label><input name="shirtSize" value="${esc(employee.shirt_size || "")}" /></div>
        <div class="field"><label>Pantalon</label><input name="pantsSize" value="${esc(employee.pants_size || "")}" /></div>
        <div class="field"><label>Calzado</label><input name="shoeSize" value="${esc(employee.shoe_size || "")}" /></div>
        <div class="field"><label>Chaqueta</label><input name="jacketSize" value="${esc(employee.jacket_size || "")}" /></div>
      </div>
      <div class="field"><label>EPI / observacion de talla</label><input name="epiSize" value="${esc(employee.epi_size || "")}" /></div>
      <div class="field"><label>Contacto emergencia</label><input name="emergencyContact" value="${esc(employee.emergency_contact || "")}" /></div>
      <div class="field"><label>Notas</label><textarea name="notes">${esc(employee.notes || "")}</textarea></div>
      <button class="btn primary full" type="submit">${icon("check")} Guardar operario</button>
    </form>
  `;
}

function employeesView() {
  const selected = state.data.employees.find((employee) => employee.id === state.selectedEmployeeId);
  return `
    <div class="page-head">
      <div><h1>Operarios</h1><p>Roles, tarifas, documentacion, disponibilidad e historico.</p></div>
      <button class="btn primary" data-new-employee>${icon("plus")} Nuevo operario</button>
    </div>
    ${employeeImportPanel()}
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head"><h2>Personal activo</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Operario</th><th>Rol</th><th>Telefono</th><th>Tarifa</th><th>Tallaje</th><th>Skills</th><th>Portal</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${state.data.employees.map((employee) => `<tr><td><strong>${esc(employee.name)}</strong><br /><small class="muted">${esc(employee.email || employee.dni || "")}</small></td><td>${esc(employee.role)}</td><td>${esc(employee.phone)}</td><td>${money(employee.hourly_rate)}/h</td><td><small>Camiseta ${esc(employee.shirt_size || "-")} · Pantalon ${esc(employee.pants_size || "-")} · Zapato ${esc(employee.shoe_size || "-")}</small></td><td>${employee.skills.slice(0, 3).map((skill) => `<span class="tag blue">${esc(skill)}</span>`).join(" ")}</td><td>${employee.user_id ? `<span class="tag green">Activo</span>` : `<span class="tag amber">Pendiente</span>`}</td><td>${statusTag(employee.status === "activo" ? "confirmado" : "pendiente")}</td><td><button class="btn" data-select-employee="${employee.id}">${icon("search")} Ver</button></td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      ${selected ? employeeDetail(selected) : employeeForm()}
    </section>
  `;
}

function employeeImportPanel() {
  const last = (state.data.imports || []).find((item) => item.metadata?.kind === "employees");
  return `
    <form class="panel import-panel" data-form="employee-import">
      <div class="row-between">
        <div>
          <h2>Importar operarios</h2>
          <p class="muted">Sube Excel, CSV o TSV. Actualiza por DNI, email o telefono y conserva el historico.</p>
        </div>
        <div class="filters-row">
          <input name="file" type="file" accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values" required />
          <input name="defaultPassword" type="password" minlength="8" value="Marfan2026!" aria-label="Contrasena temporal" />
          <button class="btn" type="button" data-employee-template>${icon("download")} Plantilla</button>
          <button class="btn primary" type="submit">${icon("upload")} Importar</button>
        </div>
      </div>
      ${last ? `<small class="muted">Ultima carga: ${esc(last.source)} · ${esc(last.inserted)} nuevos · ${esc(last.updated)} actualizados · ${esc(last.skipped)} omitidos</small>` : ""}
    </form>
  `;
}

function assignmentEventLocked(event) {
  return Boolean(event && (event.status === "finalizado" || String(event.date) < todayIso()));
}

function assignmentEventCalendar(events, selectedEvent) {
  const sorted = [...events].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  return `
    <div class="assignment-event-calendar">
      ${sorted.map((item) => {
        const tone = statusMeta[item.status]?.[1] || "blue";
        const locked = assignmentEventLocked(item);
        return `
          <button type="button" class="assignment-event-card ${tone} ${selectedEvent?.id === item.id ? "active" : ""} ${locked ? "locked" : ""}" data-assignment-calendar-event="${item.id}">
            <span>${shortDate(item.date)}</span>
            <strong>${esc(item.name)}</strong>
            <small>${esc(item.start_time)}-${esc(item.end_time)} · ${esc(item.location)}</small>
            <em>${item.assigned_count}/${item.required_total}${locked ? " · revision" : ""}</em>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function detectedAbsenceIncidents(event) {
  if (!assignmentEventLocked(event)) return [];
  const entries = state.data.timeEntries || [];
  const incidents = state.data.incidents || [];
  return (event.assignments || [])
    .filter((assignment) => assignment.status !== "bloqueado")
    .map((assignment) => {
      const hasEntry = entries.some((entry) =>
        entry.event_id === event.id &&
        entry.employee_id === assignment.employee_id &&
        Number(entry.accepted || 0) === 1 &&
        entry.type === "entrada"
      );
      const openIncident = incidents.find((incident) =>
        incident.event_id === event.id &&
        incident.employee_id === assignment.employee_id &&
        incident.type === "ausencia" &&
        incident.status !== "resuelta"
      );
      return { assignment, hasEntry, openIncident };
    })
    .filter((item) => !item.hasEntry);
}

function assignmentLockedPanel(event, detected) {
  return `
    <div class="locked-review-panel">
      <div class="row-between"><h2>Solo revision</h2><span class="tag blue">Evento efectuado</span></div>
      <p class="muted">El equipo y los roles quedan bloqueados para conservar trazabilidad. Desde aqui solo puedes revisar y abrir incidencias.</p>
      <button class="btn full" type="button" data-detect-attendance-date="${esc(event.date)}">${icon("alert")} Detectar ausencias de este dia</button>
      <div class="inspector-section">
        <h3>Incidencias detectadas</h3>
        ${detected.length ? detected.map(({ assignment, openIncident }) => `
          <div class="mini-card">
            <div class="row-between">
              <div><strong>${esc(assignment.name)}</strong><br /><small class="muted">Sin fichaje de entrada aceptado</small></div>
              ${openIncident ? `<span class="tag amber">Ya abierta</span>` : `<button class="btn compact red" type="button" data-assignment-incident="${assignment.id}" data-incident-kind="ausencia">Crear ausencia</button>`}
            </div>
          </div>
        `).join("") : `<div class="empty">No hay ausencias automaticas pendientes.</div>`}
      </div>
    </div>
  `;
}

function assignmentsView() {
  const event = state.data.events.find((item) => item.id === state.assignmentEventId) || state.data.events[0];
  const locked = assignmentEventLocked(event);
  const detected = event ? detectedAbsenceIncidents(event) : [];
  const recommendations = !locked && state.recommendations?.eventId === event?.id ? state.recommendations.items : null;
  const manualCandidate = selectedAssignmentCandidate(recommendations);
  const manualBlocked = locked || (recommendations && (!manualCandidate || candidateIsBlocked(manualCandidate)));
  const candidateRows = assignmentCandidateRows(recommendations);
  return `
    <div class="page-head">
      <div><h1>Asignaciones</h1><p>Calendario visual de eventos, planificacion de equipos e incidencias de servicios efectuados.</p></div>
      <div class="filters-row">
        <select data-assignment-event>${state.data.events.map((item) => `<option value="${item.id}" ${event?.id === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
        <button class="btn primary" data-recommendations="${event?.id}" ${locked ? "disabled" : ""}>${icon("route")} Recomendar</button>
      </div>
    </div>
    ${assignmentEventCalendar(state.data.events || [], event)}
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head">
          <h2>${esc(event?.name || "Evento")}</h2>
          <div class="filters-row">${event ? statusTag(event.status) : ""}${locked ? `<span class="tag blue">Solo revision</span>` : ""}</div>
        </div>
        ${event ? eventsTable([event]) : `<div class="empty">Selecciona un evento</div>`}
        ${event ? assignmentsTeamTable(event, locked) : ""}
      </div>
      <aside class="panel inspector">
        ${locked && event ? assignmentLockedPanel(event, detected) : `
          <form data-form="assignment" data-event-id="${event?.id || ""}">
            <h2>Asignar manual</h2>
            <div class="field"><label>Operario</label><select name="employeeId" data-assignment-candidate>${candidateRows.map((candidate) => assignmentCandidateOption(candidate, manualCandidate?.employee.id)).join("")}</select></div>
            ${assignmentCandidatePreview(manualCandidate, recommendations)}
            <div class="field"><label>Rol en evento</label><select name="role">${(event?.requirements?.length ? event.requirements : state.data.roles || []).map((item) => `<option>${esc(item.role || item.name)}</option>`).join("")}</select></div>
            <button class="btn primary full" type="submit" ${manualBlocked ? "disabled" : ""}>${icon("plus")} Asignar operario</button>
          </form>
          <div class="inspector-section">
          <h2>Mejores operarios</h2>
          ${recommendations ? recommendations.slice(0, 8).map((item) => `
            <div class="mini-card">
              <div class="row-between"><strong>${esc(item.employee.name)}</strong><span class="tag ${item.score > 70 ? "green" : item.score > 40 ? "amber" : "red"}">${item.score}</span></div>
              <div class="muted">${esc(item.employee.role)} · ${Math.round(item.distance / 1000)} km · ${esc(item.recentHours || 0)} h/30d</div>
              <small>${esc(item.suggestedRole || item.employee.role)} · ${esc(item.roleFit || "cobertura")}</small>
              ${item.issues.length ? `<small class="muted">${item.issues.map((issue) => esc(issue.message)).join(" · ")}</small>` : `<small class="muted">Disponible y sin bloqueos</small>`}
              <button class="btn full" data-assign-recommended="${item.employee.id}" data-event-id="${event.id}" data-role="${esc(item.suggestedRole || item.employee.role)}" ${item.issues.some((issue) => issue.severity === "block") || item.assigned ? "disabled" : ""}>Asignar</button>
            </div>
          `).join("") : `<div class="empty">Pulsa Recomendar para calcular candidatos.</div>`}
          </div>
        `}
      </aside>
    </section>
  `;
}

function assignmentsTeamTable(event, locked = false) {
  const assignments = event.assignments || [];
  return `
    <div class="panel-head subtle-head"><h2>Equipo asignado</h2><span class="muted">${assignments.filter((item) => item.status !== "bloqueado").length} activos</span></div>
    <div class="table-wrap">
      <table class="data-table assignment-table">
        <thead><tr><th>Operario</th><th>Rol</th><th>Estado</th><th>Avisos</th><th>Acciones</th></tr></thead>
        <tbody>
          ${assignments.map((assignment) => `
            <tr>
              <td><strong>${esc(assignment.name)}</strong><br /><small class="muted">${esc(assignment.phone || assignment.email || assignment.employee_role || "")}</small></td>
              <td>
                ${locked ? `<strong>${esc(assignment.role)}</strong>` : `<form class="inline-edit-form" data-form="assignment-edit" data-assignment-id="${assignment.id}">
                  <select name="role">${assignmentRoleOptions(event, assignment.role)}</select>
                  <select name="status">${["confirmado", "pendiente", "bloqueado"].map((status) => `<option value="${status}" ${assignment.status === status ? "selected" : ""}>${assignmentStatusLabel(status)}</option>`).join("")}</select>
                  <button class="btn compact" type="submit">${icon("check")} Guardar</button>
                </form>`}
              </td>
              <td>${assignmentStatusTag(assignment.status)}</td>
              <td>${assignmentIssueList(assignment.issues || [])}</td>
              <td>${locked ? `<button class="btn compact" type="button" data-assignment-incident="${assignment.id}" data-incident-kind="otro">Incidencia</button>` : `<button class="btn compact red" data-delete-assignment="${assignment.id}">Quitar</button>`}</td>
            </tr>
          `).join("") || `<tr><td colspan="5"><div class="empty">Sin operarios asignados.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function assignmentRoleOptions(event, selected) {
  const roles = Array.from(new Set([
    ...(event.requirements || []).map((item) => item.role),
    ...(state.data.roles || []).map((item) => item.name),
    selected
  ].filter(Boolean)));
  return roles.map((role) => `<option value="${esc(role)}" ${role === selected ? "selected" : ""}>${esc(role)}</option>`).join("");
}

function assignmentCandidateRows(recommendations) {
  if (recommendations?.length) return recommendations;
  return (state.data.employees || []).map((employee) => ({
    employee,
    score: null,
    distance: null,
    assigned: false,
    issues: []
  }));
}

function candidateIsBlocked(candidate) {
  return Boolean(candidate?.assigned || candidate?.issues?.some((issue) => issue.severity === "block"));
}

function selectedAssignmentCandidate(recommendations) {
  const candidates = assignmentCandidateRows(recommendations);
  if (!candidates.length) return null;
  const selected = candidates.find((candidate) => candidate.employee.id === state.assignmentCandidateId);
  if (selected) return selected;
  return candidates.find((candidate) => !candidateIsBlocked(candidate)) || candidates[0];
}

function assignmentCandidateOption(candidate, selectedId) {
  const blocked = candidateIsBlocked(candidate);
  const warning = candidate.issues?.some((issue) => issue.severity === "warning");
  const suffix = candidate.assigned ? " · ya asignado" : blocked ? " · bloqueado" : warning ? " · aviso" : " · OK";
  const score = candidate.score === null ? "" : ` · ${candidate.score} pts`;
  const role = candidate.suggestedRole ? ` · ${candidate.suggestedRole}` : "";
  return `<option value="${candidate.employee.id}" ${candidate.employee.id === selectedId ? "selected" : ""} ${blocked ? "disabled" : ""}>${esc(candidate.employee.name)} · ${esc(candidate.employee.role)}${esc(role)}${score}${suffix}</option>`;
}

function assignmentCandidatePreview(candidate, recommendations) {
  if (!recommendations) {
    return `
      <div class="candidate-preview neutral">
        <strong>Disponibilidad sin calcular</strong>
        <small>Pulsa Recomendar para comprobar solapes, descanso, disponibilidad y documentacion antes de asignar.</small>
      </div>
    `;
  }
  if (!candidate) return `<div class="candidate-preview blocked"><strong>Sin candidatos disponibles</strong><small>Revisa operarios activos o bloqueos del evento.</small></div>`;
  const blocked = candidateIsBlocked(candidate);
  const issues = candidate.issues || [];
  return `
    <div class="candidate-preview ${blocked ? "blocked" : issues.length ? "warning" : "ok"}">
      <div class="row-between">
        <strong>${esc(candidate.employee.name)}</strong>
        <span class="tag ${blocked ? "red" : issues.length ? "amber" : "green"}">${blocked ? "No asignable" : issues.length ? "Con avisos" : "Asignable"}</span>
      </div>
      <small>${esc(candidate.employee.role)}${candidate.suggestedRole ? ` · sugerido: ${esc(candidate.suggestedRole)}` : ""}${candidate.score === null ? "" : ` · ${esc(candidate.score)} pts`}${candidate.distance === null ? "" : ` · ${Math.round(candidate.distance / 1000)} km`}</small>
      ${issues.length ? `<div class="assignment-warnings">${issues.map((issue) => `<span class="tag ${issue.severity === "block" ? "red" : "amber"}">${esc(issue.message)}</span>`).join("")}</div>` : `<small class="muted">Sin bloqueos detectados.</small>`}
    </div>
  `;
}

function assignmentStatusLabel(status) {
  const labels = { confirmado: "Confirmado", pendiente: "Pendiente", bloqueado: "Bloqueado" };
  return labels[status] || status;
}

function assignmentStatusTag(status) {
  const tones = { confirmado: "green", pendiente: "amber", bloqueado: "red" };
  return `<span class="tag ${tones[status] || "blue"}">${assignmentStatusLabel(status)}</span>`;
}

function assignmentIssueList(issues) {
  if (!issues.length) return `<span class="tag green">Sin bloqueos</span>`;
  return issues.map((issue) => `<span class="tag ${issue.severity === "block" ? "red" : "amber"}">${esc(issue.message)}</span>`).join(" ");
}

function clockingView() {
  const entries = state.data.timeEntries || [];
  return `
    <div class="page-head">
      <div><h1>Fichajes</h1><p>Entradas, salidas, GPS, distancia al evento y correcciones.</p></div>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Fichajes revisados", value: entries.filter((entry) => entry.accepted).length, hint: "Aceptados", tone: "green" })}
      ${cardTemplate({ label: "Bloqueados", value: entries.filter((entry) => !entry.accepted).length, hint: "Revisar incidencia", tone: "red" })}
      ${cardTemplate({ label: "Fuera de radio", value: entries.filter((entry) => !entry.within_radius).length, hint: "GPS no validado", tone: "amber" })}
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Estado por evento de hoy</h2></div>
      ${eventsTable(state.data.dashboard.live)}
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Registro de fichajes</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Hora</th><th>Operario</th><th>Evento</th><th>Tipo</th><th>GPS</th><th>Estado</th><th>Correccion</th></tr></thead>
          <tbody>${entries.map((entry) => `
            <tr>
              <td><strong>${esc(entry.timestamp)}</strong></td>
              <td>${esc(entry.employee_name)}</td>
              <td>${esc(entry.event_name)}<br /><small class="muted">${esc(entry.event_date || "")}</small></td>
              <td>${esc(entry.type)}</td>
	              <td>
	                ${meters(entry.distance_m)} · ${entry.within_radius ? "Dentro" : "Fuera"}
	                <br /><small class="muted">Prec. ${meters(entry.gps_accuracy_m)} · IP ${esc(entry.ip_address || "-")}</small>
	                <br /><small class="muted">${esc(shortDevice(entry.user_agent))}</small>
	              </td>
              <td>${entry.accepted ? statusTag("confirmado") : `<span class="tag red">Bloqueado</span>`}</td>
              <td>
                <form class="inline-edit" data-form="time-entry" data-entry-id="${entry.id}">
                  <input name="timestamp" type="datetime-local" value="${esc(toDateTimeLocal(entry.timestamp))}" />
                  <select name="type">
                    ${["entrada", "salida", "entrada_bloqueada", "salida_bloqueada"].map((type) => `<option value="${type}" ${entry.type === type ? "selected" : ""}>${type}</option>`).join("")}
                  </select>
                  <label class="toggle-row"><input name="accepted" type="checkbox" ${entry.accepted ? "checked" : ""} /> Aceptado</label>
                  <input name="notes" placeholder="Nota" value="${esc(entry.notes || "")}" />
                  <input name="correctionReason" placeholder="Motivo correccion" value="${esc(entry.correction_reason || "")}" />
                  ${entry.corrected_at ? `<small class="muted">Corregido por ${esc(entry.corrected_by_name || "-")} · ${esc(shortDateTime(entry.corrected_at))}</small>` : ""}
                  <button class="btn" type="submit">${icon("check")} Guardar</button>
                </form>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="7"><div class="empty">Sin fichajes registrados.</div></td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function attendanceDetectionNotice(summary) {
  if (!summary || summary.skippedReason === "future_date") return "";
  const created = Number(summary.created || 0);
  const updated = Number(summary.updated || 0);
  if (!created && !updated) return "";
  return `
    <section class="panel warning-panel">
      <div class="panel-head"><h2>Incidencias detectadas por la app</h2><span class="tag amber">${created + updated}</span></div>
      <p class="muted">${created} nuevas y ${updated} actualizadas para ${esc(summary.date || todayIso())}. Revisa ausencias y retrasos antes de cerrar el servicio.</p>
    </section>
  `;
}

function incidentsView() {
  const detection = state.data.incidentDetection;
  return `
    <div class="page-head">
      <div><h1>Incidencias Pro</h1><p>Ausencias, retrasos, accidentes, clientes, horas extra y documentacion.</p></div>
      <button class="btn" data-detect-attendance-date="${todayIso()}">${icon("alert")} Detectar hoy</button>
    </div>
    ${attendanceDetectionNotice(detection)}
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head"><h2>Incidencias abiertas y recientes</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Prioridad</th><th>Titulo</th><th>Evento</th><th>Operario</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>${state.data.incidents.map(incidentRow).join("")}</tbody>
          </table>
        </div>
      </div>
      <form class="panel inspector" data-form="incident">
        <h2>Nueva incidencia</h2>
        <div class="field"><label>Evento</label><select name="eventId">${state.data.events.map((event) => `<option value="${event.id}">${esc(event.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Operario</label><select name="employeeId"><option value="">Sin operario</option>${state.data.employees.map((employee) => `<option value="${employee.id}">${esc(employee.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Tipo</label><select name="type"><option>ausencia</option><option>retraso</option><option>accidente</option><option>cliente</option><option>horas extra</option><option>documentacion</option><option>otro</option></select></div>
        <div class="field"><label>Prioridad</label><select name="priority"><option>baja</option><option>media</option><option>alta</option><option>critica</option></select></div>
        <div class="field"><label>Titulo</label><input name="title" required /></div>
        <div class="field"><label>Descripcion</label><textarea name="description"></textarea></div>
        <button class="btn primary full" type="submit">${icon("alert")} Abrir incidencia</button>
      </form>
    </section>
  `;
}

function incidentRow(incident) {
  const tone = incident.priority === "critica" ? "red" : incident.priority === "alta" ? "amber" : "blue";
  return `
    <tr>
      <td><span class="tag ${tone}">${esc(incident.priority)}</span></td>
      <td><strong>${esc(incident.title)}</strong><br /><small class="muted">${esc(incident.description)}</small></td>
      <td>${esc(incident.event_name || "")}</td>
      <td>${esc(incident.employee_name || "")}</td>
      <td>
        ${esc(incident.status)}
        ${incident.resolved_at ? `<br /><small class="muted">${esc(incident.resolved_at)}</small>` : ""}
        ${incident.resolution_note ? `<br /><small>${esc(incident.resolution_note)}</small>` : ""}
      </td>
      <td>${incident.status === "resuelta" ? `<button class="btn" data-reopen-incident="${incident.id}">${icon("refresh")} Reabrir</button>` : `<button class="btn" data-resolve-incident="${incident.id}">${icon("check")} Resolver</button>`}</td>
    </tr>
  `;
}

function availabilityAdminView() {
  const rows = state.data.availability || [];
  const pending = rows.filter((item) => item.status === "solicitado").length;
  const approved = rows.filter((item) => item.status === "aprobado").length;
  const rejected = rows.filter((item) => item.status === "rechazado").length;
  return `
    <div class="page-head">
      <div><h1>Disponibilidad</h1><p>Solicitudes de operarios, vacaciones, bajas y bloqueos que respeta el planificador.</p></div>
      <div class="filters-row">
        <span class="tag amber">${pending} pendientes</span>
        <span class="tag green">${approved} aprobadas</span>
      </div>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Solicitudes pendientes", value: pending, hint: "Por revisar", tone: "amber" })}
      ${cardTemplate({ label: "Bloqueos activos", value: approved, hint: "Impiden asignar", tone: "green" })}
      ${cardTemplate({ label: "Rechazadas", value: rejected, hint: "No bloquean agenda", tone: "red" })}
      ${cardTemplate({ label: "Total registrado", value: rows.length, hint: "Historico visible", tone: "blue" })}
    </section>
    <section class="split-grid" style="margin-top:16px">
      <div class="panel">
        <div class="panel-head"><h2>Agenda de disponibilidad</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Estado</th><th>Operario</th><th>Periodo</th><th>Motivo</th><th>Eventos</th><th>Accion</th></tr></thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td>${availabilityStatusTag(item.status)}</td>
                  <td><strong>${esc(item.employee_name)}</strong><br /><small class="muted">${esc(item.employee_role || "")}</small></td>
                  <td><strong>${esc(item.start_date)}</strong><br /><small class="muted">hasta ${esc(item.end_date)}</small></td>
                  <td>${esc(availabilityLabel(item.type))}<br /><small class="muted">${esc(item.reason || "Sin nota")}</small></td>
                  <td><strong>${esc(item.affected_events || 0)}</strong><br /><small class="muted">en el periodo</small></td>
                  <td><div class="table-actions">${availabilityActionButtons(item)}</div></td>
                </tr>
              `).join("") || `<tr><td colspan="6"><div class="empty">Sin solicitudes de disponibilidad.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <form class="panel inspector" data-form="availability-admin">
        <h2>Registrar bloqueo</h2>
        <div class="field"><label>Operario</label><select name="employeeId" required>${state.data.employees.map((employee) => `<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.role)}</option>`).join("")}</select></div>
        <div class="form-grid compact">
          <div class="field"><label>Desde</label><input name="startDate" type="date" value="${todayIso()}" required /></div>
          <div class="field"><label>Hasta</label><input name="endDate" type="date" value="${todayIso()}" required /></div>
        </div>
        <div class="field"><label>Tipo</label><select name="type"><option value="vacaciones">Vacaciones</option><option value="no_disponible">No disponible</option><option value="enfermedad">Enfermedad</option><option value="otro">Otro</option></select></div>
        <div class="field"><label>Estado</label><select name="status"><option value="aprobado">Aprobado</option><option value="solicitado">Pendiente</option><option value="rechazado">Rechazado</option></select></div>
        <div class="field"><label>Nota interna</label><textarea name="reason"></textarea></div>
        <button class="btn primary full" type="submit">${icon("check")} Guardar disponibilidad</button>
      </form>
    </section>
  `;
}

function availabilityActionButtons(item) {
  if (item.status === "solicitado") {
    return `
      <button class="btn compact green" data-availability-status="${item.id}" data-next-status="aprobado">${icon("check")} Aprobar</button>
      <button class="btn compact red" data-availability-status="${item.id}" data-next-status="rechazado">Rechazar</button>
    `;
  }
  if (item.status === "aprobado") {
    return `
      <button class="btn compact" data-availability-status="${item.id}" data-next-status="solicitado">Pendiente</button>
      <button class="btn compact red" data-availability-status="${item.id}" data-next-status="rechazado">Rechazar</button>
    `;
  }
  return `<button class="btn compact" data-availability-status="${item.id}" data-next-status="solicitado">${icon("refresh")} Reabrir</button>`;
}

function documentsView() {
  const docs = state.data.documents || [];
  const compliance = state.data.documentCompliance || { totals: {}, employees: [] };
  const expired = docs.filter((doc) => doc.status === "caducado").length;
  const pending = docs.filter((doc) => doc.status === "pendiente").length;
  const soon = docs.filter((doc) => doc.status === "proximo").length;
  const valid = docs.filter((doc) => doc.status === "vigente").length;
  return `
    <div class="page-head">
      <div><h1>Documentacion RRHH</h1><p>PRL, EPIs, DNI, contratos, certificados, caducidades y alertas.</p></div>
      <button class="btn" data-sync-documents>${icon("refresh")} Actualizar estados</button>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Caducados", value: expired, hint: "Bloquean asignacion", tone: "red" })}
      ${cardTemplate({ label: "Pendientes", value: pending, hint: "Falta entregar", tone: "amber" })}
      ${cardTemplate({ label: "Proximos", value: soon, hint: "Vencen en 30 dias", tone: "amber" })}
      ${cardTemplate({ label: "Vigentes", value: valid, hint: "Documentos correctos", tone: "green" })}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Cumplimiento por operario</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Estado</th><th>Operario</th><th>Documentos</th><th>Bloqueos</th><th>Avisos</th></tr></thead>
          <tbody>${(compliance.employees || []).map((row) => `
            <tr>
              <td>${documentComplianceTag(row.status)}</td>
              <td><strong>${esc(row.employee_name)}</strong><br /><small class="muted">${esc(row.employee_role || "")}</small></td>
              <td>${esc(row.vigente)} vigentes / ${esc(row.total)} total</td>
              <td>${row.blockers.length ? row.blockers.map((doc) => `<span class="tag red">${esc(doc.type)}</span>`).join(" ") : `<span class="muted">Sin bloqueos</span>`}</td>
              <td>${row.warnings.length ? row.warnings.map((doc) => `<span class="tag amber">${esc(doc.type)}</span>`).join(" ") : `<span class="muted">Sin avisos</span>`}</td>
            </tr>
          `).join("") || `<tr><td colspan="5"><div class="empty">Sin documentos registrados.</div></td></tr>`}</tbody>
        </table>
      </div>
    </section>
    <section class="split-grid">
      <div class="panel">
        <div class="panel-head"><h2>Control documental</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Operario</th><th>Revision documental</th><th>Aviso</th><th>Archivo</th></tr></thead>
            <tbody>${docs.map(documentReviewRow).join("") || `<tr><td colspan="4"><div class="empty">Sin documentos registrados.</div></td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <form class="panel inspector" data-form="document">
        <h2>Subir documento</h2>
        <div class="field"><label>Operario</label><select name="employeeId" required>${state.data.employees.map((employee) => `<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.role)}</option>`).join("")}</select></div>
        <div class="field"><label>Tipo</label><select name="type"><option>PRL</option><option>DNI</option><option>Contrato</option><option>Certificado</option><option>EPI</option><option>Otro</option></select></div>
        <div class="field"><label>Nombre visible</label><input name="name" value="Documento PRL" required /></div>
        <div class="form-grid compact">
          <div class="field"><label>Estado</label><select name="status"><option value="vigente">Vigente</option><option value="proximo">Proximo</option><option value="caducado">Caducado</option><option value="pendiente">Pendiente</option></select></div>
          <div class="field"><label>Caducidad</label><input name="expiresAt" type="date" /></div>
        </div>
        <div class="field"><label>Archivo</label><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv" /></div>
        <button class="btn primary full" type="submit">${icon("upload")} Guardar documento</button>
      </form>
    </section>
  `;
}

function documentReviewRow(doc) {
  return `
    <tr>
      <td><strong>${esc(doc.employee_name)}</strong><br /><small class="muted">${esc(doc.employee_role)}</small></td>
      <td>
        <form class="inline-edit-form document-review-form" data-form="document-review" data-document-id="${esc(doc.id)}">
          <select name="type">${["PRL", "DNI", "Contrato", "Certificado", "EPI", "Otro"].map((type) => `<option value="${type}" ${doc.type === type ? "selected" : ""}>${type}</option>`).join("")}</select>
          <input name="name" value="${esc(doc.name)}" aria-label="Nombre documento" />
          <select name="status">${["vigente", "proximo", "caducado", "pendiente"].map((status) => `<option value="${status}" ${doc.status === status ? "selected" : ""}>${documentStatusLabel(status)}</option>`).join("")}</select>
          <input name="expiresAt" type="date" value="${esc(doc.expires_at || "")}" aria-label="Caducidad" />
          <button class="btn compact" type="submit">${icon("check")} Guardar</button>
        </form>
      </td>
      <td>${documentTag(doc.status)}<br />${documentExpiryText(doc)}</td>
      <td>${doc.has_file ? `<button class="btn" data-document-file="${doc.id}" data-file-name="${esc(doc.file_name || doc.name)}">${icon("download")} Abrir</button>` : `<span class="muted">Sin archivo</span>`}</td>
    </tr>
  `;
}

function documentStatusLabel(status) {
  const labels = { vigente: "Vigente", proximo: "Proximo", caducado: "Caducado", pendiente: "Pendiente" };
  return labels[status] || status;
}

function documentTag(status) {
  const map = {
    vigente: ["Vigente", "green"],
    proximo: ["Proximo", "amber"],
    caducado: ["Caducado", "red"],
    pendiente: ["Pendiente", "blue"]
  };
  const [label, tone] = map[status] || ["Pendiente", "blue"];
  return `<span class="tag ${tone}">${label}</span>`;
}

function documentComplianceTag(status) {
  const map = {
    bloqueado: ["Bloqueado", "red"],
    aviso: ["Aviso", "amber"],
    vigente: ["Apto", "green"]
  };
  const [label, tone] = map[status] || ["Pendiente", "blue"];
  return `<span class="tag ${tone}">${label}</span>`;
}

function documentExpiryText(doc) {
  if (doc.status === "pendiente") return `<span class="tag red">Entrega pendiente</span>`;
  if (doc.days_to_expiry === null || doc.days_to_expiry === undefined) return `<span class="muted">Sin caducidad</span>`;
  if (doc.days_to_expiry < 0) return `<span class="tag red">Vencido hace ${Math.abs(doc.days_to_expiry)} dias</span>`;
  if (doc.days_to_expiry === 0) return `<span class="tag amber">Vence hoy</span>`;
  if (doc.days_to_expiry <= 30) return `<span class="tag amber">${doc.days_to_expiry} dias</span>`;
  return `<span class="muted">${doc.days_to_expiry} dias</span>`;
}

function financesView() {
  const finance = state.data.finance || {};
  const totals = finance.totals || state.data.events.reduce((acc, event) => {
    acc.revenue += Number(event.service_price || event.budget || 0);
    acc.cost += Number(event.finance.cost || 0);
    acc.events += 1;
    return acc;
  }, { revenue: 0, cost: 0, events: 0, hours: 0, benefit: 0, margin: 0 });
  totals.benefit ||= totals.revenue - totals.cost;
  totals.margin ||= totals.revenue ? Math.round((totals.benefit / totals.revenue) * 1000) / 10 : 0;
  return `
    <div class="page-head">
      <div><h1>Finanzas Pro</h1><p>Ingresos, costes, beneficios, margenes y rentabilidad.</p></div>
    </div>
    <section class="cards-grid">
      ${cardTemplate({ label: "Ingresos", value: totals.revenue, hint: `${totals.events || 0} eventos`, tone: "green", money: true })}
      ${cardTemplate({ label: "Costes", value: totals.cost, hint: "Personal y dietas", tone: "amber", money: true })}
      ${cardTemplate({ label: "Beneficio", value: totals.benefit, hint: "Estimado", tone: "green", money: true })}
      ${cardTemplate({ label: "Margen medio", value: `${totals.margin || 0}%`, hint: "Rentabilidad global", tone: "blue" })}
      ${cardTemplate({ label: "Horas vendidas", value: totals.hours || 0, hint: "Horas planificadas", tone: "ink" })}
    </section>
    ${allowancesControlPanel()}
    <section class="finance-grid">
      <div class="panel">
        <div class="panel-head"><h2>Rentabilidad por cliente</h2></div>
        ${financeBucketTable(finance.byClient || [], "Cliente")}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Evolucion mensual</h2></div>
        ${financeBucketTable(finance.byMonth || [], "Mes")}
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Rentabilidad por operario</h2></div>
      ${employeeFinanceTable(finance.byEmployee || [])}
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Eventos con mayor beneficio</h2></div>
      ${topEventsFinanceTable(finance.topEvents || [])}
    </section>
  `;
}

function allowanceAssignmentKey(eventId, employeeId) {
  return `${eventId || ""}::${employeeId || ""}`;
}

function allowancesControlPanel() {
  const allowances = state.data.allowances || [];
  const allowanceMap = new Map(allowances.map((item) => [allowanceAssignmentKey(item.event_id, item.employee_id), item]));
  const editableRows = (state.data.events || [])
    .filter((event) => !assignmentEventLocked(event))
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))
    .flatMap((event) => (event.assignments || [])
      .filter((assignment) => assignment.status !== "bloqueado")
      .map((assignment) => ({
        event,
        assignment,
        allowance: allowanceMap.get(allowanceAssignmentKey(event.id, assignment.employee_id)) || {}
      })))
    .slice(0, 18);
  return `
    <section class="panel" style="margin-top:16px">
      <div class="panel-head">
        <div>
          <h2>Pluses por evento</h2>
          <p class="muted">Kilometros, dietas, nocturnidad y extras para coste interno y albaran.</p>
        </div>
      </div>
      <div class="list-grid">
        ${editableRows.map(({ event, assignment, allowance }) => `
          <form class="mini-card" data-form="allowance" data-event-id="${esc(event.id)}" data-employee-id="${esc(assignment.employee_id)}" data-allowance-id="${esc(allowance.id || "")}">
            <div class="row-between">
              <div>
                <h3>${esc(assignment.name)}</h3>
                <p class="muted">${esc(event.name)} · ${esc(shortDate(event.date))} · ${esc(assignment.role)}</p>
              </div>
              ${statusTag(allowance.id ? "confirmado" : "pendiente")}
            </div>
            <div class="form-grid compact">
              <div class="field"><label>Km</label><input name="km" type="number" min="0" step="0.1" value="${esc(allowance.km || 0)}" /></div>
              <div class="field"><label>Dieta</label><input name="diet" type="number" min="0" step="0.01" value="${esc(allowance.diet || 0)}" /></div>
              <div class="field"><label>Nocturnidad</label><input name="nightHours" type="number" min="0" step="0.1" value="${esc(allowance.night_hours || 0)}" /></div>
              <div class="field"><label>Extras</label><input name="extras" type="number" min="0" step="0.01" value="${esc(allowance.extras || 0)}" /></div>
            </div>
            <div class="filters-row">
              <button class="btn primary" type="submit">${icon("save")} Guardar</button>
              ${allowance.id ? `<button class="btn" type="button" data-delete-allowance="${esc(allowance.id)}">${icon("trash")} Quitar</button>` : ""}
            </div>
          </form>
        `).join("") || `<div class="empty">No hay eventos editables con operarios asignados.</div>`}
      </div>
      ${allowanceHistoryTable(allowances)}
    </section>
  `;
}

function allowanceHistoryTable(rows) {
  return `
    <div class="table-wrap" style="margin-top:16px">
      <table class="data-table">
        <thead><tr><th>Evento</th><th>Operario</th><th>Km</th><th>Dieta</th><th>Noct.</th><th>Extras</th><th>Estado</th></tr></thead>
        <tbody>
          ${rows.slice(0, 12).map((row) => `
            <tr>
              <td><strong>${esc(row.event_name || "")}</strong><br /><small class="muted">${esc(shortDate(row.event_date))} · ${esc(row.event_location || "")}</small></td>
              <td>${esc(row.employee_name || "")}<br /><small class="muted">${esc(row.assignment_role || row.employee_role || "")}</small></td>
              <td>${esc(row.km || 0)}</td>
              <td>${money(row.diet || 0)}</td>
              <td>${esc(row.night_hours || 0)} h</td>
              <td>${money(row.extras || 0)}</td>
              <td>${row.locked ? statusTag("finalizado") : statusTag("confirmado")}</td>
            </tr>
          `).join("") || `<tr><td colspan="7"><div class="empty">Sin pluses registrados todavia.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function financeBucketTable(rows, label) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${label}</th><th>Eventos</th><th>Ingresos</th><th>Costes</th><th>Beneficio</th><th>Margen</th></tr></thead>
        <tbody>
          ${rows.slice(0, 12).map((row) => `
            <tr>
              <td><strong>${esc(row.name)}</strong></td>
              <td>${esc(row.events || 0)}</td>
              <td>${money(row.revenue)}</td>
              <td>${money(row.cost)}</td>
              <td><strong>${money(row.benefit)}</strong></td>
              <td><span class="tag ${row.margin < 20 ? "red" : row.margin < 35 ? "amber" : "green"}">${esc(row.margin)}%</span></td>
            </tr>
          `).join("") || `<tr><td colspan="6"><div class="empty">Sin datos financieros.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function employeeFinanceTable(rows) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Operario</th><th>Servicios</th><th>Horas</th><th>Ingresos atrib.</th><th>Coste</th><th>Beneficio</th><th>Km / Dietas / Noct.</th></tr></thead>
        <tbody>
          ${rows.slice(0, 18).map((row) => `
            <tr>
              <td><strong>${esc(row.name)}</strong><br /><small class="muted">${esc(row.role || "")}</small></td>
              <td>${esc(row.events || 0)}</td>
              <td>${esc(row.hours || 0)} h</td>
              <td>${money(row.revenue)}</td>
              <td>${money(row.cost)}</td>
              <td><strong>${money(row.benefit)}</strong><br /><small class="muted">${esc(row.margin || 0)}%</small></td>
              <td>${esc(row.km || 0)} km · ${money(row.diets || 0)} · ${esc(row.nightHours || 0)} h</td>
            </tr>
          `).join("") || `<tr><td colspan="7"><div class="empty">Sin costes por operario.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function topEventsFinanceTable(rows) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Evento</th><th>Cliente</th><th>Fecha</th><th>Ingresos</th><th>Coste</th><th>Beneficio</th><th>Margen</th></tr></thead>
        <tbody>
          ${rows.slice(0, 12).map((row) => `
            <tr>
              <td><strong>${esc(row.name)}</strong></td>
              <td>${esc(row.client)}</td>
              <td>${esc(row.date)}</td>
              <td>${money(row.revenue)}</td>
              <td>${money(row.cost)}</td>
              <td><strong>${money(row.benefit)}</strong></td>
              <td><span class="tag ${row.margin < 20 ? "red" : row.margin < 35 ? "amber" : "green"}">${esc(row.margin)}%</span></td>
            </tr>
          `).join("") || `<tr><td colspan="7"><div class="empty">Sin eventos financieros.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function reportFilterValue(name) {
  return state.reportFilters?.[name] || "";
}

function reportStatusOptions() {
  const options = [
    ["", "Todos"],
    ["completo", "Completo"],
    ["falta_personal", "Falta personal"],
    ["critico", "Critico"],
    ["sin_jefe", "Sin jefe"],
    ["finalizado", "Finalizado"],
    ["google", "Google"],
    ["abierta", "Incidencia abierta"],
    ["resuelta", "Incidencia resuelta"]
  ];
  const selected = reportFilterValue("status");
  return options.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function syncReportFiltersFromDom() {
  const container = document.querySelector("[data-report-filters]");
  if (!container) return state.reportFilters || {};
  state.reportFilters = {
    from: container.querySelector("[name=from]")?.value || "",
    to: container.querySelector("[name=to]")?.value || "",
    clientId: container.querySelector("[name=clientId]")?.value || "",
    employeeId: container.querySelector("[name=employeeId]")?.value || "",
    status: container.querySelector("[name=status]")?.value || "",
    search: container.querySelector("[name=search]")?.value || ""
  };
  return state.reportFilters;
}

function reportPath(path, format) {
  const filters = syncReportFiltersFromDom();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (format) params.set("format", format);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function reportsView() {
  const clients = state.data.clients || [];
  const employees = state.data.employees || [];
  return `
    <div class="page-head">
      <div><h1>Informes</h1><p>Exportaciones PDF, Excel, JSON y CSV preparadas para operaciones.</p></div>
    </div>
    <section class="panel report-filter-panel" data-report-filters>
      <div class="row-between">
        <div>
          <h2>Filtros del informe</h2>
          <p class="muted">Acota las descargas por periodo, cliente, operario o estado operativo.</p>
        </div>
        <button class="btn" type="button" data-clear-report-filters>${icon("refresh")} Limpiar</button>
      </div>
      <div class="form-grid compact report-filter-grid">
        <div class="field"><label>Buscar</label><input name="search" value="${esc(reportFilterValue("search"))}" placeholder="Evento, cliente, operario, DNI..." /></div>
        <div class="field"><label>Desde</label><input name="from" type="date" value="${esc(reportFilterValue("from"))}" /></div>
        <div class="field"><label>Hasta</label><input name="to" type="date" value="${esc(reportFilterValue("to"))}" /></div>
        <div class="field"><label>Cliente</label><select name="clientId"><option value="">Todos</option>${clients.map((client) => `<option value="${esc(client.id)}" ${client.id === reportFilterValue("clientId") ? "selected" : ""}>${esc(client.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Operario</label><select name="employeeId"><option value="">Todos</option>${employees.map((employee) => `<option value="${esc(employee.id)}" ${employee.id === reportFilterValue("employeeId") ? "selected" : ""}>${esc(employee.name)} · ${esc(employee.role)}</option>`).join("")}</select></div>
        <div class="field"><label>Estado</label><select name="status">${reportStatusOptions()}</select></div>
      </div>
    </section>
    <section class="list-grid">
      <div class="mini-card row-between"><div><h3>Eventos y rentabilidad</h3><p class="muted">Incluye presupuesto, coste, beneficio, margen y estado operativo.</p></div><div class="filters-row"><button class="btn" type="button" data-export-json>${icon("file")} JSON</button><button class="btn" type="button" data-export-xls>${icon("download")} Excel</button><button class="btn" type="button" data-export-pdf>${icon("file")} PDF</button><button class="btn primary" type="button" data-export-csv>${icon("chart")} CSV</button></div></div>
      <div class="mini-card row-between"><div><h3>Finanzas Pro</h3><p class="muted">Rentabilidad por cliente, mes, operario y ranking de eventos.</p></div><div class="filters-row"><button class="btn" type="button" data-finance-json>${icon("file")} JSON</button><button class="btn" type="button" data-finance-xls>${icon("download")} Excel</button><button class="btn" type="button" data-finance-pdf>${icon("file")} PDF</button><button class="btn primary" type="button" data-finance-csv>${icon("chart")} CSV</button></div></div>
      <div class="mini-card row-between"><div><h3>Operarios y documentacion</h3><p class="muted">Tallaje, contacto, skills y estado documental por operario.</p></div><div class="filters-row"><button class="btn" type="button" data-employees-json>${icon("file")} JSON</button><button class="btn" type="button" data-employees-xls>${icon("download")} Excel</button><button class="btn" type="button" data-employees-pdf>${icon("file")} PDF</button><button class="btn primary" type="button" data-employees-csv>${icon("chart")} CSV</button></div></div>
      <div class="mini-card row-between"><div><h3>Incidencias Pro</h3><p class="muted">Seguimiento de retrasos, ausencias, documentacion y avisos por evento u operario.</p></div><div class="filters-row"><button class="btn" type="button" data-incidents-json>${icon("file")} JSON</button><button class="btn" type="button" data-incidents-xls>${icon("download")} Excel</button><button class="btn" type="button" data-incidents-pdf>${icon("file")} PDF</button><button class="btn primary" type="button" data-incidents-csv>${icon("chart")} CSV</button></div></div>
      <div class="mini-card row-between"><div><h3>Albaranes A4</h3><p class="muted">Un albaran por evento con horarios, dietas, kilometraje, precio y firma cliente.</p></div><div class="filters-row"><button class="btn" type="button" data-albaran="${state.data.events[0]?.id || ""}">${icon("file")} Abrir ultimo</button><button class="btn primary" type="button" data-albaran-pdf="${state.data.events[0]?.id || ""}">${icon("download")} PDF</button></div></div>
    </section>
  `;
}

function marfanCalendarFeedUrl(settings) {
  const token = settings.calendar_feed_token || "";
  return `${window.location.origin}/api/calendar/marfan.ics?token=${encodeURIComponent(token)}`;
}

function googleOAuthCallbackUriForOrigin(origin) {
  return `${String(origin || "").replace(/\/+$/, "")}/api/calendar/google-oauth/callback`;
}

function googleOAuthLocalAlternateUri(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString();
    }
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      return parsed.toString();
    }
  } catch {}
  return "";
}

function googleOAuthSetupIssue(settings, redirectUri, authorizedUris) {
  if (settings.google_calendar_oauth_client_type === "installed") {
    return "El JSON actual es Desktop/Installed. Crea un cliente OAuth tipo Web application y pega ese JSON en MARFAN.";
  }
  if (settings.google_calendar_oauth_client_configured === "true" && !authorizedUris.length) {
    return "El cliente OAuth actual no trae URIs autorizadas. Usa un cliente Web application con la URI de retorno configurada.";
  }
  if (authorizedUris.length && !authorizedUris.includes(redirectUri)) {
    return "Google rechazara la conexion porque no tiene autorizada la URI de retorno actual.";
  }
  return "";
}

function googleOAuthSetupPrompt(payload = {}) {
  const uri = payload.redirectUri || payload.suggestedRedirectUris?.[0] || googleOAuthCallbackUriForOrigin(window.location.origin);
  window.prompt("Copia esta URI en Google Cloud > Authorized redirect URIs y vuelve a conectar:", uri);
}

function settingsView() {
  const settings = state.data.settings || {};
  const roles = state.data.roles || [];
  const feedUrl = marfanCalendarFeedUrl(settings);
  const oauthRedirectUri = googleOAuthCallbackUriForOrigin(window.location.origin);
  const oauthAuthorizedUris = String(settings.google_calendar_oauth_redirect_uris || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const oauthSetupIssue = googleOAuthSetupIssue(settings, oauthRedirectUri, oauthAuthorizedUris);
  const oauthSuggestedUris = [oauthRedirectUri, googleOAuthLocalAlternateUri(oauthRedirectUri)].filter((item, index, list) => item && list.indexOf(item) === index);
  return `
    <div class="page-head">
      <div><h1>Configuracion</h1><p>Base operativa, kilometraje, telefono de oficina y precios por rol.</p></div>
    </div>
    <section class="split-grid">
      <form class="panel inspector" data-form="settings">
        <h2>Empresa y kilometraje</h2>
        <div class="field"><label>Base</label><input name="base_address" value="${esc(settings.base_address || "Calle Ciro Alegría 89, Málaga")}" /></div>
        <div class="form-grid compact">
          <div class="field"><label>Latitud base</label><input name="base_lat" type="number" step="0.000001" value="${esc(settings.base_lat || "")}" /></div>
          <div class="field"><label>Longitud base</label><input name="base_lng" type="number" step="0.000001" value="${esc(settings.base_lng || "")}" /></div>
          <div class="field"><label>Km incluidos</label><input name="included_km" type="number" step="0.1" value="${esc(settings.included_km || 20)}" /></div>
          <div class="field"><label>Euro/km vehiculo</label><input name="vehicle_km_price" type="number" step="0.01" value="${esc(settings.vehicle_km_price || 0.37)}" /></div>
        </div>
        <div class="form-grid compact">
          <div class="field"><label>Telefono oficina</label><input name="office_phone" value="${esc(settings.office_phone || "")}" /></div>
          <div class="field"><label>WhatsApp oficina</label><input name="office_whatsapp" value="${esc(settings.office_whatsapp || "")}" /></div>
        </div>
        <div class="inspector-section">
          <h3>Fichaje GPS</h3>
          <div class="form-grid compact">
            <div class="field"><label>Radio permitido (m)</label><input name="clock_radius_m" type="number" min="25" step="1" value="${esc(settings.clock_radius_m || 150)}" /></div>
            <div class="field"><label>Entrada antes (min)</label><input name="clock_entry_early_minutes" type="number" min="0" step="1" value="${esc(settings.clock_entry_early_minutes || 90)}" /></div>
            <div class="field"><label>Salida despues (min)</label><input name="clock_exit_late_minutes" type="number" min="0" step="1" value="${esc(settings.clock_exit_late_minutes || 240)}" /></div>
            <div class="field"><label>Margen incidencia (min)</label><input name="incident_absence_grace_minutes" type="number" min="1" step="1" value="${esc(settings.incident_absence_grace_minutes || 15)}" /></div>
          </div>
        </div>
        <div class="inspector-section">
          <h3>Google Calendar</h3>
          <label class="toggle-row"><input name="google_calendar_enabled" type="checkbox" value="true" ${settings.google_calendar_enabled === "false" ? "" : "checked"} /> Mostrar eventos externos de Google</label>
          <label class="toggle-row"><input name="google_calendar_sync_enabled" type="checkbox" value="true" ${settings.google_calendar_sync_enabled === "false" ? "" : "checked"} /> Guardar eventos MARFAN en Google</label>
          <div class="role-row"><span>Escritura Google</span><strong>${settings.google_calendar_service_account_configured === "true" ? "Configurada" : "Pendiente"}</strong></div>
          <div class="role-row"><span>OAuth Google</span><strong>${settings.google_calendar_oauth_connected === "true" ? "Conectado" : settings.google_calendar_oauth_client_configured === "true" ? "Cliente cargado" : "Pendiente"}</strong></div>
          <div class="role-row"><span>Eventos sincronizados</span><strong>${esc(settings.google_sync_synced_count || 0)} / ${esc(settings.google_sync_total_count || 0)}</strong></div>
          <div class="role-row"><span>Pendientes / errores</span><strong>${esc(Number(settings.google_sync_pending_count || 0) + Number(settings.google_sync_pending_auth_count || 0))} / ${esc(settings.google_sync_error_count || 0)}</strong></div>
          ${settings.google_calendar_oauth_client_id ? `<div class="role-row"><span>Cliente OAuth</span><strong>${esc(settings.google_calendar_oauth_client_id)}</strong></div>` : ""}
          ${settings.google_calendar_oauth_client_type ? `<div class="role-row"><span>Tipo cliente OAuth</span><strong>${esc(settings.google_calendar_oauth_client_type)}</strong></div>` : ""}
          <div class="field"><label>URI retorno OAuth para Google Cloud</label><input readonly value="${esc(oauthRedirectUri)}" /></div>
          ${oauthSetupIssue ? `
            <div class="mini-card">
              <strong>Google rechazara la conexion</strong>
              <small>${esc(oauthSetupIssue)}</small>
              ${oauthSuggestedUris.map((uri) => `<input readonly value="${esc(uri)}" />`).join("")}
            </div>
          ` : ""}
          ${oauthAuthorizedUris.length ? `<div class="field"><label>URIs autorizadas en el JSON actual</label><textarea readonly>${esc(oauthAuthorizedUris.join("\n"))}</textarea></div>` : ""}
          ${settings.google_calendar_service_account_email ? `<div class="role-row"><span>Cuenta servicio</span><strong>${esc(settings.google_calendar_service_account_email)}</strong></div>` : ""}
          <div class="field"><label>ID calendario Google</label><input name="google_calendar_id" value="${esc(settings.google_calendar_id || "")}" /></div>
          <div class="field"><label>API key Google Calendar</label><input name="google_calendar_api_key" type="password" value="" placeholder="${settings.google_calendar_api_key_configured === "true" ? "Configurada: dejar vacio para conservar" : "Opcional para leer eventos como tarjetas nativas"}" /></div>
          <div class="field"><label>URL iCal publica/secreta</label><input name="google_calendar_public_ics_url" type="password" value="" placeholder="${settings.google_calendar_public_ics_url_configured === "true" ? "Configurada: dejar vacio para conservar" : "Pega la direccion iCal si quieres leer eventos"}" /></div>
          <div class="field"><label>URL embed Google</label><input name="google_calendar_embed_url" value="${esc(settings.google_calendar_embed_url || "")}" /></div>
          <div class="field"><label>JSON cliente OAuth Google</label><textarea name="google_calendar_oauth_client_json" placeholder="Pega aqui el JSON client_secret de Google. Si lo dejas vacio se conserva el anterior."></textarea></div>
          <button class="btn full" type="button" data-google-oauth-start>${icon("calendar")} Conectar Google Calendar</button>
          <button class="btn full" type="button" data-google-sync-pending>${icon("refresh")} Reintentar pendientes Google</button>
          <div class="field"><label>JSON cuenta de servicio Google</label><textarea name="google_calendar_service_account_json" placeholder="Pega aqui el JSON de la cuenta de servicio. Si lo dejas vacio se conserva el anterior."></textarea></div>
          <div class="field"><label>Usuario delegado Google Workspace</label><input name="google_calendar_delegated_user" value="${esc(settings.google_calendar_delegated_user || "")}" placeholder="Opcional" /></div>
          <div class="field"><label>Feed MARFAN para suscribir en Google</label><input readonly value="${esc(feedUrl)}" /></div>
          <div class="calendar-embed-preview">
            <iframe src="${esc(settings.google_calendar_embed_url || "")}" title="Google Calendar MARFAN" loading="lazy"></iframe>
          </div>
        </div>
        <button class="btn primary full" type="submit">${icon("settings")} Guardar configuracion</button>
      </form>
      <div class="panel">
        <div class="panel-head"><h2>Roles y precios</h2></div>
        <div class="list-grid role-config-list">
          ${roles.map((role) => `
            <form class="mini-card role-config-card" data-form="role">
              <input type="hidden" name="id" value="${esc(role.id)}" />
              <div class="field"><label>Rol</label><input name="name" value="${esc(role.name)}" /></div>
              <div class="form-grid compact">
                <div class="field"><label>Precio base/h</label><input name="basePrice" type="number" step="0.01" value="${esc(role.base_price)}" /></div>
                <div class="field"><label>Nocturnidad/h</label><input name="nightPrice" type="number" step="0.01" value="${esc(role.night_price)}" /></div>
              </div>
              <label class="toggle-row"><input name="active" type="checkbox" ${role.active ? "checked" : ""} /> Activo</label>
              <button class="btn full" type="submit">${icon("check")} Guardar rol</button>
            </form>
          `).join("")}
          <form class="mini-card role-config-card" data-form="work-role">
            <h3>Nuevo rol</h3>
            <div class="field"><label>Nombre</label><input name="name" required /></div>
            <div class="form-grid compact">
              <div class="field"><label>Precio base/h</label><input name="basePrice" type="number" step="0.01" value="18" /></div>
              <div class="field"><label>Nocturnidad/h</label><input name="nightPrice" type="number" step="0.01" value="24" /></div>
            </div>
            <button class="btn primary full" type="submit">${icon("plus")} Crear rol</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function backupsView() {
  const backups = state.data.backups || [];
  const automation = state.data.backupAutomation || {};
  const totalSize = backups.reduce((sum, backup) => sum + Number(backup.actual_size_bytes || backup.size_bytes || 0), 0);
  const restorePending = Boolean(automation.restorePending);
  const cards = [
    { label: "Copias guardadas", value: backups.length, hint: "Versiones disponibles", tone: "blue" },
    { label: "Verificadas", value: backups.filter((backup) => backup.verified).length, hint: "Archivo presente y tamano correcto", tone: "green" },
    { label: "Automaticas", value: backups.filter((backup) => backup.type === "auto").length, hint: automation.enabled ? `Cada ${automation.intervalHours || 24} h` : "Desactivadas", tone: "amber" },
    { label: "Espacio usado", value: formatBytes(totalSize), hint: "Tamano real de copias", tone: "blue" }
  ];
  return `
    <div class="page-head">
      <div><h1>Backups</h1><p>Backup manual, automatico, versionado y restauracion protegida.</p></div>
      <div class="toolbar-actions">
        <button class="btn" data-auto-backup>${icon("refresh")} Backup auto ahora</button>
        <button class="btn primary" data-backup>${icon("backup")} Crear backup</button>
      </div>
    </div>
    <section class="cards-grid">
      ${cards.map(cardTemplate).join("")}
    </section>
    ${restorePending ? `
      <section class="panel warning-panel">
        <div class="panel-head"><h2>Restauracion preparada</h2></div>
        <p class="muted">Hay una restauracion pendiente. Se aplicara en el proximo reinicio seguro del servidor.</p>
        ${automation.restorePending?.safetyBackupId ? `<p class="muted">Copia previa: <strong>${esc(automation.restorePending.safetyBackupId)}</strong></p>` : ""}
      </section>
    ` : ""}
    <section class="split-grid">
      <form class="panel inspector" data-form="backup-settings">
        <h2>Backup automatico</h2>
        <label class="toggle-row"><input name="backup_auto_enabled" type="checkbox" ${automation.enabled === false ? "" : "checked"} /> Activado</label>
        <div class="form-grid compact">
          <div class="field"><label>Cada horas</label><input name="backup_auto_interval_hours" type="number" min="1" step="1" value="${esc(automation.intervalHours || 24)}" /></div>
          <div class="field"><label>Conservar dias</label><input name="backup_auto_retention_days" type="number" min="1" step="1" value="${esc(automation.retentionDays || 30)}" /></div>
          <div class="field"><label>Max. automaticas</label><input name="backup_auto_retention_count" type="number" min="1" step="1" value="${esc(automation.retentionCount || 30)}" /></div>
        </div>
        <div class="inspector-section">
          <div class="role-row"><span>Ultima automatica</span><strong>${esc(automation.latestAutoAt || "-")}</strong></div>
          <div class="role-row"><span>Proxima automatica</span><strong>${automation.enabled === false ? "Desactivada" : esc(automation.nextAutoAt || "-")}</strong></div>
          <div class="role-row"><span>Ultima ejecucion</span><strong>${esc(automation.lastRunAt || "-")}</strong></div>
        </div>
        <button class="btn primary full" type="submit">${icon("settings")} Guardar backups</button>
      </form>
      <div class="panel">
        <div class="panel-head"><h2>Politica de seguridad</h2></div>
        <div class="list-grid">
          <div class="mini-card"><strong>Manual</strong><small>Copia inmediata antes de cambios importantes.</small></div>
          <div class="mini-card"><strong>Automatico</strong><small>Copia programada mientras el servidor esta activo.</small></div>
          <div class="mini-card"><strong>Restauracion</strong><small>Solo Super Admin y siempre con copia previa de seguridad.</small></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Copias disponibles</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Tipo</th><th>Etiqueta</th><th>Tamano</th><th>Integridad</th><th>Fecha</th><th>Huella</th><th>Ruta</th><th>Acciones</th></tr></thead>
          <tbody>${backups.map((backup) => `
            <tr>
              <td>${statusTag(backup.type === "auto" ? "confirmado" : backup.type === "safety" ? "finalizado" : "pendiente")}</td>
              <td><strong>${esc(backup.label)}</strong></td>
	              <td>${formatBytes(backup.actual_size_bytes || backup.size_bytes)}<br /><small class="muted">${esc(backup.attachment_count || 0)} adjuntos · ${formatBytes(backup.attachment_bytes || 0)}</small></td>
              <td>${backupIntegrityTag(backup)}<br /><small class="muted">${esc(backup.sqlite_quick_check || backup.integrity_error || "-")}</small></td>
              <td>${esc(backup.created_at)}</td>
              <td><small class="muted">${esc(backup.sha256 ? backup.sha256.slice(0, 12) : "-")}</small></td>
              <td><small class="muted">${esc(backup.file_path)}</small></td>
              <td>
                <div class="table-actions">
                  <button class="btn compact" data-verify-backup="${backup.id}">${icon("check")} Verificar</button>
                  <button class="btn compact" data-download-backup="${backup.id}">${icon("download")} Descargar</button>
                  ${state.user.role === "super_admin" ? `<button class="btn compact" data-restore-backup="${backup.id}">Restaurar</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="8"><div class="empty">Todavia no hay backups guardados.</div></td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function loadEmployeeData(force = false) {
  if (!force && state.employeeHome) return;
  state.employeeHome = await api("/api/employee/home");
}

async function renderEmployee(force = false) {
  await loadEmployeeData(force);
  const data = state.employeeHome;
  const service = data.nextService;
  root.innerHTML = `
    <main class="employee-shell">
      <section class="phone-app">
        <div class="employee-hero">
          <div class="row-between">
	            ${brand()}
	            <div class="employee-actions">
	              <button class="btn ghost employee-logout" data-logout title="Cerrar sesion">${icon("logout")}</button>
	              ${employeeAvatar(data.employee)}
	            </div>
          </div>
          <h1>Hola, ${esc(data.employee.name.split(" ")[0])}</h1>
          <p>${esc(data.employee.role)} · ${esc(data.employee.city || "Operaciones")}</p>
        </div>
        <div class="employee-content">
          ${state.employeeTab === "inicio" ? employeeHomeView(data) : employeeTabView(data)}
        </div>
        <nav class="bottom-nav">
          ${[
            ["inicio", "Inicio", "home"],
            ["servicios", "Servicios", "calendar"],
            ["historico", "Historico", "clock"],
            ["documentos", "Docs", "file"],
            ["disponibilidad", "Disp.", "check"],
            ["perfil", "Perfil", "user"]
          ].map(([tab, label, ico]) => `<button data-employee-tab="${tab}" class="${state.employeeTab === tab ? "active" : ""}">${icon(ico)} ${label}</button>`).join("")}
        </nav>
      </section>
    </main>
  `;
  queueMicrotask(() => window.scrollTo(0, 0));
}

function employeeHomeView(data) {
  const service = data.nextService;
  if (!service) return `<div class="mobile-card"><h2>Sin servicios proximos</h2><p class="muted">Tu calendario esta libre.</p></div>`;
  const docAlerts = data.documents.filter((doc) => doc.status !== "vigente");
  const clockMeta = employeeClockMeta(service);
  const gpsReady = employeeServiceHasGps(service);
  return `
    <article class="service-card">
      <div class="row-between"><strong class="muted">MI PROXIMO SERVICIO</strong>${employeeServiceStatusTag(service)}</div>
      <h2>${esc(service.name)}</h2>
      <p class="muted">${esc(service.client_name)}</p>
      <div class="service-meta">
        <div class="meta-row">${icon("calendar")}<span>${shortDate(service.date)}</span></div>
        <div class="meta-row">${icon("clock")}<span>${esc(service.start_time)} - ${esc(service.end_time)} (${hoursBetweenClient(service.start_time, service.end_time)}h)</span></div>
        <div class="meta-row">${icon("map")}<span><strong>${esc(service.location)}</strong><br /><small class="muted">${esc(service.address || "")}</small></span></div>
      </div>
      <div class="event-reference">
        <div><span>Estado</span><strong>${esc(assignmentStatusLabel(service.assignment_status))}</strong></div>
        <div><span>Rol asignado</span><strong>${esc(service.assignment_role || data.employee.role)}</strong></div>
        <div><span>Entrada</span><strong>${esc(service.start_time)}</strong></div>
        <div><span>Salida</span><strong>${esc(service.end_time)}</strong></div>
      </div>
      ${employeeConfirmButton(service)}
      <div class="map-preview"><div class="map-pin"></div></div>
      <div class="row-between" style="margin-top:14px">
        <div><small class="muted">JEFE DE EQUIPO</small><br /><strong>${esc(service.team_leader_name || "Pendiente")}</strong></div>
        <a class="btn green" href="tel:${esc(service.team_leader_phone || "")}">${icon("phone")}</a>
      </div>
      <div style="margin-top:12px"><small class="muted">COMPANEROS (${data.coworkers.length})</small><br />${data.coworkers.slice(0, 4).map((worker) => `<span class="tag blue">${esc(worker.name.split(" ")[0])}</span>`).join(" ")}</div>
    </article>
    <div class="quick-actions">
      ${employeeClockActionButton(service, "entrada", true)}
      ${employeeClockActionButton(service, "salida")}
      ${gpsReady
        ? `<button data-open-maps="${service.lat},${service.lng}">${icon("map")} Abrir Maps</button>`
        : `<button disabled>${icon("map")} Maps pendiente</button>`}
      ${service.google_maps_url ? `<button data-open-url="${esc(service.google_maps_url)}">${icon("map")} Recinto</button>` : ""}
      <button data-call-office="${esc(data.office?.phone || "")}">${icon("phone")} Llamar oficina</button>
      <button data-whatsapp="${esc(data.office?.whatsapp || data.office?.phone || "")}">${icon("message")} WhatsApp</button>
    </div>
    ${service.is_team_leader ? teamLeaderSignaturePanel(service, data.coworkers || []) : ""}
    <article class="geo-card ${clockMeta.className}">
      <div class="row-between"><strong>FICHAJE POR GEOLOCALIZACION</strong><small class="muted">Radio ${data.radius} m</small></div>
      <div class="geo-main">
        <div class="geo-state"><div class="geo-badge">${icon(clockMeta.icon)}</div><div><strong>${esc(clockMeta.label)}</strong><br /><span class="muted">${esc(clockMeta.detail)}</span></div></div>
        <strong>${clockMeta.last}</strong>
      </div>
      <button class="clock-button ${clockMeta.className}" data-clock="${esc(clockMeta.nextType || "entrada")}" ${clockMeta.nextType ? "" : "disabled"}>${icon(clockMeta.nextType === "salida" ? "logout" : "check")} ${esc(clockMeta.action)}</button>
    </article>
	    <div class="mobile-grid">
	      <article class="mobile-card"><h3>Alertas de documentos</h3><p><strong>${docAlerts.length}</strong> documentos pendientes</p><button class="btn" data-employee-tab="documentos">${icon("file")} Ver documentos</button></article>
	      ${employeeChecklistCard(service)}
	    </div>
	    <form class="mobile-card" data-form="employee-incident">
	      <h3>Avisar incidencia</h3>
	      <input type="hidden" name="eventId" value="${esc(service.id)}" />
	      <div class="field"><label>Tipo</label><select name="type"><option value="retraso">Retraso</option><option value="accidente">Accidente</option><option value="cliente">Cliente</option><option value="documentacion">Documentacion</option><option value="otro">Otro</option></select></div>
	      <div class="field"><label>Mensaje</label><textarea name="description" placeholder="Cuenta que ocurre para que oficina lo vea al momento" required></textarea></div>
	      <button class="btn primary full" type="submit">${icon("alert")} Enviar aviso</button>
	    </form>
	  `;
	}

function employeeServiceHasGps(service) {
  const lat = Number(service?.lat);
  const lng = Number(service?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  const source = String(service?.location_source || "").toLowerCase();
  if (source === "base_fallback") return false;
  const locationText = `${service?.location || ""} ${service?.address || ""}`.toLowerCase();
  if (!source && locationText.includes("ubicacion pendiente")) return false;
  return true;
}

function employeeChecklistCard(service) {
  const checklist = service.checklist || { completed: 0, total: 0, percent: 0, items: [] };
  return `
    <article class="mobile-card">
      <h3>Checklist de hoy</h3>
      <p class="muted">${esc(checklist.completed)} / ${esc(checklist.total)} completadas</p>
      <div class="bar" style="width:100%"><span style="width:${Math.max(0, Math.min(100, Number(checklist.percent || 0)))}%"></span></div>
      ${(checklist.items || []).map((item) => `
        <p>${checklistItemTag(item.status)} ${esc(item.label)}<br /><small class="muted">${esc(item.detail || "")}</small></p>
      `).join("")}
    </article>
  `;
}

function checklistItemTag(status) {
  const map = {
    done: ["OK", "green"],
    warning: ["Aviso", "amber"],
    pending: ["Pendiente", "blue"]
  };
  const [label, tone] = map[status] || map.pending;
  return `<span class="tag ${tone}">${label}</span>`;
}

function employeeClockMeta(service) {
  const state = service.clock_state || "sin_fichar";
  const map = {
    sin_fichar: ["Pendiente de entrada", "Permite ubicacion GPS real para fichar entrada.", "FICHAR ENTRADA", "entrada", "ok", "check"],
    pendiente: ["Servicio pendiente de confirmar", "Confirma asistencia y ficha entrada al llegar.", "FICHAR ENTRADA", "entrada", "warning", "clock"],
    tarde: ["Entrada pendiente con retraso", "Ficha entrada cuanto antes o avisa a oficina.", "FICHAR ENTRADA", "entrada", "danger", "alert"],
    en_curso: ["Servicio en curso", "Entrada registrada. Al terminar, ficha salida.", "FICHAR SALIDA", "salida", "progress", "clock"],
    finalizado: ["Servicio finalizado", "Salida registrada correctamente.", "FICHAJE COMPLETO", null, "done", "check"],
    bloqueado: ["Fichaje bloqueado", "Contacta con oficina para revisar la asignacion.", "NO DISPONIBLE", null, "danger", "alert"]
  };
  const [label, detail, action, nextType, className, iconName] = map[state] || map.sin_fichar;
  const last = service.last_clock_at ? String(service.last_clock_at).slice(11, 16) : "GPS";
  const allowed =
    nextType === "entrada" ? Boolean(Number(service.can_clock_in || 0)) :
    nextType === "salida" ? Boolean(Number(service.can_clock_out || 0)) :
    false;
  if (nextType && !allowed) {
    return {
      label,
      detail: service.clock_block_reason || detail,
      action: "NO DISPONIBLE",
      nextType: null,
      className: "warning",
      icon: "clock",
      last
    };
  }
  return { label, detail, action, nextType, className, icon: iconName, last };
}

function employeeClockActionButton(service, type, primary = false) {
  const enabled = type === "entrada" ? Boolean(Number(service.can_clock_in || 0)) : Boolean(Number(service.can_clock_out || 0));
  const label = type === "entrada" ? "Fichar entrada" : "Fichar salida";
  const className = primary && enabled ? "green-action" : "";
  return `<button class="${className}" data-clock="${type}" ${enabled ? "" : "disabled"}>${icon(type === "entrada" ? "check" : "logout")} ${label}</button>`;
}

function teamLeaderSignaturePanel(service, coworkers = []) {
  if (service.delivery_note_locked) {
    return `
      <article class="mobile-card signature-panel locked">
        <div class="row-between"><h3>Albaran firmado</h3>${statusTag("finalizado")}</div>
        <p class="muted">El servicio ya tiene albaran bloqueado.</p>
      </article>
    `;
  }
  const teamSize = coworkers.length + 1;
  const roles = teamLeaderSignatureRoles(service, coworkers);
  return `
    <article class="mobile-card signature-panel" data-signature-panel>
      <div class="row-between"><h3>Firma cliente</h3><span class="tag blue">Jefe de equipo</span></div>
      <div class="signature-summary">
        <div><span>Servicio</span><strong>${esc(service.name)}</strong></div>
        <div><span>Horario</span><strong>${esc(service.start_time)} - ${esc(service.end_time)}</strong></div>
        <div><span>Equipo</span><strong>${esc(teamSize)} personas</strong></div>
        <div><span>Recinto</span><strong>${esc(service.location || "-")}</strong></div>
      </div>
      ${roles.length ? `<div class="signature-role-strip">${roles.map((item) => `<span class="tag blue">${esc(item.role)} x${esc(item.count)}</span>`).join("")}</div>` : ""}
      <div class="field"><label>Nombre firmante</label><input name="signatureName" data-signature-name autocomplete="name" /></div>
      <div class="field"><label>DNI/NIF firmante</label><input name="signatureDni" data-signature-dni /></div>
      <div class="field"><label>Firma</label><canvas class="signature-pad" width="520" height="180" data-signature-canvas></canvas></div>
      <div class="filters-row">
        <button class="btn" type="button" data-clear-signature>${icon("refresh")} Limpiar</button>
        <span class="muted">Se adjunta al fichar salida.</span>
      </div>
    </article>
  `;
}

function teamLeaderSignatureRoles(service, coworkers = []) {
  const counts = new Map();
  const addRole = (role) => {
    const clean = String(role || "Operario").trim() || "Operario";
    counts.set(clean, (counts.get(clean) || 0) + 1);
  };
  addRole(service.assignment_role);
  coworkers.forEach((worker) => addRole(worker.role));
  return Array.from(counts.entries()).map(([role, count]) => ({ role, count }));
}

function employeeTabView(data) {
  if (state.employeeTab === "servicios") {
    return employeeServicesView(data);
  }
  if (state.employeeTab === "historico") {
    const history = data.history || {};
    return `
      <div class="mobile-card">
        <h2>Mi historico</h2>
        <div class="history-grid">
	          <div><span>Horas</span><strong>${esc(history.hours || 0)}</strong></div>
	          <div><span>Eventos</span><strong>${esc(history.events_done || 0)}</strong></div>
	          <div><span>Kilometros</span><strong>${esc(history.km || 0)} km</strong></div>
	          <div><span>Dietas</span><strong>${money(history.dietas || 0)}</strong></div>
	          <div><span>Nocturnidad</span><strong>${esc(history.night_hours || 0)} h</strong></div>
	        </div>
        <div class="inspector-section">
          <div class="role-row"><span>Fichajes aceptados</span><strong>${esc(history.entries || 0)}</strong></div>
          <div class="role-row"><span>Incidencias</span><strong>${esc(history.incidents || 0)}</strong></div>
        </div>
        <div class="mobile-list">
          ${(data.pastServices || []).map(employeeServiceItem).join("") || `<div class="empty">Sin servicios finalizados todavía.</div>`}
        </div>
        <div class="inspector-section">
          <h3>Mis incidencias</h3>
          <div class="mobile-list">
            ${(data.incidents || []).map(employeeIncidentItem).join("") || `<div class="empty">Sin incidencias registradas.</div>`}
          </div>
        </div>
      </div>
    `;
  }
  if (state.employeeTab === "disponibilidad") {
    return `
      <form class="mobile-card" data-form="availability">
        <h2>Disponibilidad</h2>
        <div class="field"><label>Desde</label><input name="startDate" type="date" value="${todayIso()}" required /></div>
        <div class="field"><label>Hasta</label><input name="endDate" type="date" value="${todayIso()}" required /></div>
        <div class="field"><label>Motivo</label><select name="type"><option value="vacaciones">Vacaciones</option><option value="no_disponible">No disponible</option><option value="enfermedad">Enfermedad</option><option value="otro">Otro</option></select></div>
        <div class="field"><label>Nota</label><textarea name="reason"></textarea></div>
        <button class="btn primary full" type="submit">Enviar disponibilidad</button>
        <div class="inspector-section">
          <h3>Solicitudes recientes</h3>
          <div class="mobile-list">
            ${(data.availability || []).map((item) => `
              <div class="mobile-list-item">
                <div><strong>${availabilityLabel(item.type)}</strong><br /><small class="muted">${esc(item.start_date)} - ${esc(item.end_date)}</small></div>
                ${availabilityStatusTag(item.status)}
              </div>
            `).join("") || `<div class="empty">Sin solicitudes registradas.</div>`}
          </div>
        </div>
      </form>
    `;
  }
  if (state.employeeTab === "documentos") return employeeDocumentsView(data);
  return `
    <form class="mobile-card" data-form="profile">
      <h2>Perfil</h2>
      <div class="role-row"><span>Rol</span><strong>${esc(data.employee.role)}</strong></div>
	      <div class="role-row"><span>Tallaje</span><strong>${esc(data.employee.shirt_size || "-")} / ${esc(data.employee.pants_size || "-")} / ${esc(data.employee.shoe_size || "-")}</strong></div>
	      <div class="field"><label>Telefono</label><input name="phone" value="${esc(data.employee.phone || "")}" /></div>
	      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(data.employee.email || "")}" /></div>
	      <div class="field"><label>Foto / URL</label><input name="photoUrl" value="${esc(data.employee.photo_url || "")}" placeholder="https://..." /></div>
	      <div class="field"><label>Subir foto</label><input name="photoFile" type="file" accept="image/jpeg,image/png,image/webp" /></div>
	      <div class="field"><label>Nueva contrasena</label><input name="password" type="password" placeholder="Dejar vacio para no cambiar" /></div>
	      <button class="btn primary full" type="submit">${icon("user")} Guardar perfil</button>
    </form>
  `;
}

function employeeServicesView(data) {
  const services = employeeCalendarServices(data);
  const mode = state.employeeServiceMode || "week";
  const base = parseLocalDate(state.employeeServiceDate || todayIso());
  return `
    <div class="mobile-card employee-services-card">
      <div class="row-between">
        <div>
          <h2>Mis servicios</h2>
          <p class="muted">Calendario personal de turnos, ubicaciones y confirmaciones.</p>
        </div>
        <span class="tag blue">${services.length} servicios</span>
      </div>
      <div class="employee-service-toolbar">
        <button class="btn compact" data-employee-service-nav="prev">${icon("refresh")} Ant.</button>
        <button class="btn compact" data-employee-service-nav="today">Hoy</button>
        <button class="btn compact" data-employee-service-nav="next">Sig.</button>
        <strong>${esc(employeeCalendarTitle(mode, base))}</strong>
      </div>
      <div class="employee-mode-tabs">
        ${["month", "week", "day", "agenda"].map((item) => `<button type="button" data-employee-service-mode="${item}" class="${mode === item ? "active" : ""}">${employeeCalendarModeLabel(item)}</button>`).join("")}
      </div>
      ${employeeCalendarBody(mode, base, services)}
    </div>
  `;
}

function employeeCalendarServices(data) {
  const map = new Map();
  for (const service of [...(data.upcomingServices || []), ...(data.pastServices || [])]) {
    map.set(service.id, service);
  }
  return Array.from(map.values()).sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
}

function employeeCalendarBody(mode, base, services) {
  if (mode === "month") return employeeMonthCalendar(base, services);
  if (mode === "day") return employeeDayCalendar(base, services);
  if (mode === "agenda") return employeeAgendaCalendar(base, services);
  return employeeWeekCalendar(base, services);
}

function employeeMonthCalendar(base, services) {
  const month = base.getMonth();
  const days = monthDays(base);
  const weekdays = weekDays(base).map((day) => day.label);
  return `
    <div class="employee-month-grid">
      ${weekdays.map((label) => `<div class="employee-day-head">${esc(label)}</div>`).join("")}
      ${days.map((day) => {
        const matches = services.filter((service) => service.date === day.iso);
        return `
          <div class="employee-calendar-day ${day.date.getMonth() !== month ? "outside" : ""} ${day.iso === todayIso() ? "today" : ""}">
            <span>${day.date.getDate()}</span>
            ${matches.slice(0, 2).map(employeeCalendarPill).join("")}
            ${matches.length > 2 ? `<small class="muted">+${matches.length - 2}</small>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function employeeWeekCalendar(base, services) {
  const week = weekDays(base);
  return `
    <div class="employee-week-strip">
      ${week.map((day) => {
        const matches = services.filter((service) => service.date === day.iso);
        return `
          <div class="employee-week-day ${day.iso === todayIso() ? "today" : ""}">
            <strong>${esc(day.label)}</strong>
            <span>${esc(day.short)}</span>
            <em>${matches.length}</em>
          </div>
        `;
      }).join("")}
    </div>
    <div class="mobile-list">
      ${week.flatMap((day) => services.filter((service) => service.date === day.iso)).map(employeeServiceItem).join("") || `<div class="empty">No tienes servicios esta semana.</div>`}
    </div>
  `;
}

function employeeDayCalendar(base, services) {
  const iso = isoDate(base);
  const matches = services.filter((service) => service.date === iso);
  return `
    <div class="employee-day-focus">
      <strong>${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(base)}</strong>
      <span>${matches.length ? `${matches.length} servicios` : "Sin servicios"}</span>
    </div>
    <div class="mobile-list">
      ${matches.map(employeeServiceItem).join("") || `<div class="empty">No tienes servicios este dia.</div>`}
    </div>
  `;
}

function employeeAgendaCalendar(base, services) {
  const from = isoDate(addCalendarDays(base, -14));
  const to = isoDate(addCalendarDays(base, 45));
  const matches = services.filter((service) => service.date >= from && service.date <= to);
  return `
    <div class="mobile-list">
      ${matches.map(employeeServiceItem).join("") || `<div class="empty">Sin servicios en esta agenda.</div>`}
    </div>
  `;
}

function employeeCalendarPill(service) {
  const status = service.assignment_status === "pendiente" ? "pending" : service.status === "finalizado" ? "done" : "ok";
  return `<div class="employee-service-pill ${status}"><strong>${esc(service.start_time)}</strong><span>${esc(service.name)}</span></div>`;
}

function employeeCalendarTitle(mode, date) {
  if (mode === "month") return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(date);
  if (mode === "day") return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long" }).format(date);
  if (mode === "agenda") return `Agenda desde ${shortDate(isoDate(date))}`;
  const week = weekDays(date);
  return `${shortDate(week[0].iso)} - ${shortDate(week[6].iso)}`;
}

function employeeCalendarModeLabel(mode) {
  const labels = { month: "Mes", week: "Semana", day: "Dia", agenda: "Agenda" };
  return labels[mode] || "Semana";
}

function moveEmployeeServiceCalendar(direction) {
  const mode = state.employeeServiceMode || "week";
  const base = parseLocalDate(state.employeeServiceDate || todayIso());
  if (direction === "today") {
    state.employeeServiceDate = todayIso();
    return;
  }
  const factor = direction === "prev" ? -1 : 1;
  if (mode === "month") state.employeeServiceDate = isoDate(addCalendarMonths(base, factor));
  else if (mode === "day") state.employeeServiceDate = isoDate(addCalendarDays(base, factor));
  else if (mode === "agenda") state.employeeServiceDate = isoDate(addCalendarDays(base, factor * 14));
  else state.employeeServiceDate = isoDate(addCalendarDays(base, factor * 7));
}

function employeeDocumentsView(data) {
  const docs = data.documents || [];
  const eventDocs = data.eventDocuments || [];
  const blockers = docs.filter((doc) => ["caducado", "pendiente"].includes(doc.status)).length;
  const soon = docs.filter((doc) => doc.status === "proximo").length;
  const files = docs.filter((doc) => doc.has_file).length;
  return `
    <div class="mobile-card">
      <div class="row-between">
        <div>
          <h2>Documentos</h2>
          <p class="muted">PRL, contrato, DNI, certificados y EPIs disponibles desde tu portal.</p>
        </div>
        <span class="tag ${blockers ? "red" : soon ? "amber" : "green"}">${blockers ? `${blockers} bloqueos` : soon ? `${soon} avisos` : "OK"}</span>
      </div>
      <div class="history-grid">
        <div><span>Vigentes</span><strong>${esc(docs.filter((doc) => doc.status === "vigente").length)}</strong></div>
        <div><span>Archivos</span><strong>${esc(files)}</strong></div>
        <div><span>Avisos</span><strong>${esc(soon)}</strong></div>
        <div><span>Bloqueos</span><strong>${esc(blockers)}</strong></div>
      </div>
      <div class="mobile-list">
        ${docs.map((doc) => `
          <div class="mobile-list-item document-list-item">
            <div>
              <strong>${esc(doc.type)}</strong>
              <small class="muted">${esc(doc.name)} · ${esc(doc.expires_at || "Sin caducidad")}</small>
              ${documentExpiryText(doc)}
            </div>
            <div class="doc-actions">
              ${documentTag(doc.status)}
              ${doc.has_file ? `<button class="btn compact" type="button" data-document-file="${doc.id}" data-file-name="${esc(doc.file_name || doc.name)}">${icon("download")} Abrir</button>` : `<span class="muted">Sin archivo</span>`}
            </div>
          </div>
        `).join("") || `<div class="empty">Sin documentos registrados.</div>`}
      </div>
      ${eventDocs.length ? `
        <h3>Documentos del servicio</h3>
        <div class="mobile-list">
          ${eventDocs.map((doc) => `
            <div class="mobile-list-item document-list-item">
              <div>
                <strong>${esc(doc.type || "Documento")}</strong>
                <small class="muted">${esc(doc.name || doc.file_name || "")} · ${esc(doc.event_name || "Servicio")}</small>
              </div>
              <div class="doc-actions">
                ${doc.has_file ? `<button class="btn compact" type="button" data-event-document-file="${esc(doc.id)}" data-file-name="${esc(doc.file_name || doc.name || "documento")}">${icon("download")} Abrir</button>` : `<span class="muted">Sin archivo</span>`}
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <form class="inspector-section" data-form="employee-document">
        <h3>Subir documento</h3>
        <div class="field"><label>Tipo</label><select name="type"><option>DNI</option><option>PRL</option><option>Contrato</option><option>Certificado</option><option>EPI</option><option>Otro</option></select></div>
        <div class="field"><label>Nombre</label><input name="name" placeholder="Ej. DNI renovado" required /></div>
        <div class="field"><label>Caducidad</label><input name="expiresAt" type="date" /></div>
        <div class="field"><label>Archivo</label><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv" required /></div>
        <button class="btn primary full" type="submit">${icon("upload")} Enviar a revision</button>
      </form>
    </div>
  `;
}

function employeeServiceItem(service) {
  return `
    <div class="mobile-list-item service-list-item">
      <div>
        <strong>${esc(service.name)}</strong>
        <small class="muted">${esc(service.client_name)} · ${shortDate(service.date)}</small>
        <small>${esc(service.start_time)} - ${esc(service.end_time)} · ${esc(service.location)}</small>
      </div>
      <div class="doc-actions">
        ${employeeServiceStatusTag(service)}
        ${employeeConfirmButton(service, true)}
      </div>
    </div>
  `;
}

function employeeIncidentItem(incident) {
  const tone = incident.status === "resuelta" ? "green" : incident.priority === "critica" ? "red" : incident.priority === "alta" ? "amber" : "blue";
  return `
    <div class="mobile-list-item service-list-item">
      <div>
        <strong>${esc(incident.title || incident.type || "Incidencia")}</strong>
        <small class="muted">${esc(incident.event_name || "Sin evento")} · ${esc(incident.event_date || "")}</small>
        <small>${esc(incident.description || "")}</small>
      </div>
      <div class="doc-actions">
        <span class="tag ${tone}">${esc(incident.status || "abierta")}</span>
        <small class="muted">${shortDateTime(incident.resolved_at || incident.created_at)}</small>
      </div>
    </div>
  `;
}

function employeeServiceStatusTag(service) {
  return assignmentStatusTag(service.assignment_status || "pendiente");
}

function employeeConfirmButton(service, compact = false) {
  if (service.assignment_status !== "pendiente" || service.date < todayIso() || service.status === "finalizado") return "";
  return `<button class="btn ${compact ? "compact" : "primary full"}" type="button" data-confirm-service="${esc(service.id)}">${icon("check")} Confirmar asistencia</button>`;
}

function availabilityLabel(type) {
  const labels = {
    vacaciones: "Vacaciones",
    no_disponible: "No disponible",
    enfermedad: "Enfermedad",
    otro: "Otro motivo"
  };
  return labels[type] || type;
}

function availabilityStatusTag(status) {
  const map = {
    solicitado: ["Pendiente", "amber"],
    aprobado: ["Aprobado", "green"],
    rechazado: ["Rechazado", "red"]
  };
  const [label, tone] = map[status] || [status || "Pendiente", "blue"];
  return `<span class="tag ${tone}">${esc(label)}</span>`;
}

function hoursBetweenClient(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}

function extractMapsCoordinates(value) {
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

function setupSignaturePads() {
  document.querySelectorAll("[data-signature-canvas]").forEach((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#101828";
    let drawing = false;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height
      };
    };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      context.beginPath();
      context.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const p = point(event);
      context.lineTo(p.x, p.y);
      context.stroke();
      canvas.dataset.signed = "true";
    });
    const stop = () => {
      drawing = false;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
  });
}

function signaturePayload() {
  const panel = document.querySelector("[data-signature-panel]");
  if (!panel) return {};
  const canvas = panel.querySelector("[data-signature-canvas]");
  return {
    signatureName: panel.querySelector("[data-signature-name]")?.value || "",
    signatureDni: panel.querySelector("[data-signature-dni]")?.value || "",
    signatureImage: canvas?.dataset.signed ? canvas.toDataURL("image/png") : ""
  };
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function permissionsFromForm(form) {
  return Object.fromEntries(adminPermissionDefs.map(([key]) => [
    key,
    Boolean(form.querySelector(`[name=perm_${key}]`)?.checked)
  ]));
}

function eventRequirementsFromForm(form) {
  return Array.from(form.querySelectorAll("[data-role-count]"))
    .map((input) => ({
      role: input.dataset.roleCount,
      count: Number(input.value || 0)
    }))
    .filter((item) => item.role && item.count > 0);
}

function readFilePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) return resolve({});
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      fileMime: file.type || "application/octet-stream",
      fileSize: file.size,
      fileDataBase64: reader.result
    });
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) return reject(new Error("Selecciona un archivo CSV, TSV o Excel"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsText(file, "utf-8");
  });
}

async function submitDocument(form) {
  const data = new FormData(form);
  const filePayload = await readFilePayload(data.get("file"));
  await api("/api/documents", {
    method: "POST",
    body: {
      employeeId: data.get("employeeId"),
      type: data.get("type"),
      name: data.get("name"),
      status: data.get("status"),
      expiresAt: data.get("expiresAt"),
      ...filePayload
    }
  });
}

async function submitEventDocument(form) {
  const data = new FormData(form);
  const filePayload = await readFilePayload(data.get("file"));
  await api(`/api/events/${encodeURIComponent(form.dataset.eventId)}/documents`, {
    method: "POST",
    body: {
      type: data.get("type"),
      name: data.get("name"),
      notes: data.get("notes"),
      visibleToEmployee: Boolean(form.querySelector("[name=visibleToEmployee]")?.checked),
      ...filePayload
    }
  });
}

async function submitEmployeeDocument(form) {
  const data = new FormData(form);
  const filePayload = await readFilePayload(data.get("file"));
  await api("/api/employee/documents", {
    method: "POST",
    body: {
      type: data.get("type"),
      name: data.get("name"),
      expiresAt: data.get("expiresAt"),
      ...filePayload
    }
	  });
}

async function submitEmployeeProfile(form) {
  const data = new FormData(form);
  const body = {
    phone: data.get("phone"),
    email: data.get("email"),
    photoUrl: data.get("photoUrl"),
    password: data.get("password")
  };
  if (!body.password) delete body.password;
  const photoPayload = await readFilePayload(data.get("photoFile"));
  if (photoPayload.fileDataBase64) {
    body.photoDataBase64 = photoPayload.fileDataBase64;
    body.photoMime = photoPayload.fileMime;
    body.photoSize = photoPayload.fileSize;
  }
  await api("/api/employee/profile", { method: "PATCH", body });
}

async function submitCsvImport(form, kind) {
  const data = new FormData(form);
  const file = data.get("file");
  if (!file || !file.size) throw new Error("Selecciona un archivo CSV, TSV o Excel");
  const isExcel = /\.xlsx$/i.test(file.name || "") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const filePayload = isExcel ? await readFilePayload(file) : {};
  const fileText = isExcel ? "" : await readFileText(file);
  return api(`/api/imports/${kind}`, {
    method: "POST",
    body: {
      fileName: file.name,
      fileMime: file.type || (isExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv"),
      fileText,
      fileDataBase64: filePayload.fileDataBase64 || "",
      defaultPassword: data.get("defaultPassword") || "Marfan2026!"
    }
  });
}

async function submitLogin(form) {
  const body = formData(form);
  body.mode = state.loginMode;
  body.remember = Boolean(form.querySelector("[name=remember]").checked);
  const result = await api("/api/auth/login", { method: "POST", body });
  state.token = result.token;
  state.user = result.user;
  localStorage.setItem("marfan_token", result.token);
  await renderApp(true);
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  try {
    if (type === "login") return submitLogin(form);
    if (type === "reset-password") {
      const body = formData(form);
      if (body.password !== body.confirmPassword) throw new Error("Las contrasenas no coinciden");
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { recoveryCode: body.recoveryCode, password: body.password }
      });
      state.recoveryCode = "";
      state.showReset = false;
      toast("Contrasena actualizada");
      return renderLogin();
    }
    if (type === "event") {
      const body = formData(form);
      body.requirements = eventRequirementsFromForm(form);
      body.requiredTotal = body.requirements.reduce((sum, item) => sum + item.count, 0);
      await api("/api/events", { method: "POST", body });
      toast("Evento creado");
      await renderAdmin(true);
    }
    if (type === "event-edit") {
      const body = formData(form);
      body.requirements = eventRequirementsFromForm(form);
      body.requiredTotal = body.requirements.reduce((sum, item) => sum + item.count, 0);
      await api(`/api/events/${form.dataset.eventId}`, { method: "PATCH", body });
      state.editEventId = null;
      toast("Evento actualizado");
      await renderAdmin(true);
    }
    if (type === "assignment") {
      const body = formData(form);
      await api("/api/assignments", {
        method: "POST",
        body: { eventId: form.dataset.eventId, employeeId: body.employeeId, role: body.role }
      });
      toast("Operario asignado");
      await renderAdmin(true);
    }
    if (type === "assignment-edit") {
      await api(`/api/assignments/${form.dataset.assignmentId}`, {
        method: "PATCH",
        body: formData(form)
      });
      toast("Asignacion actualizada");
      await renderAdmin(true);
    }
    if (type === "client") {
      await api("/api/clients", { method: "POST", body: formData(form) });
      toast("Cliente creado");
      await renderAdmin(true);
    }
    if (type === "client-edit") {
      await api(`/api/clients/${form.dataset.clientId}`, { method: "PATCH", body: formData(form) });
      state.editClientId = null;
      toast("Cliente actualizado");
      await renderAdmin(true);
    }
    if (type === "employee") {
      const body = formData(form);
      body.skills = String(body.skills || "").split(",").map((item) => item.trim()).filter(Boolean);
      body.teamLeader = Boolean(form.querySelector("[name=teamLeader]")?.checked);
      body.portalAccess = Boolean(form.querySelector("[name=portalAccess]")?.checked);
      if (body.teamLeader) {
        body.role = "Jefe de equipo";
        body.skills = Array.from(new Set([...body.skills, "jefe"]));
      }
      await api("/api/employees", { method: "POST", body });
      toast("Operario creado");
      await renderAdmin(true);
    }
    if (type === "employee-edit") {
      const body = formData(form);
      body.skills = String(body.skills || "").split(",").map((item) => item.trim()).filter(Boolean);
      body.teamLeader = Boolean(form.querySelector("[name=teamLeader]")?.checked);
      body.portalAccess = Boolean(form.querySelector("[name=portalAccess]")?.checked);
      if (body.teamLeader) {
        body.role = "Jefe de equipo";
        body.skills = Array.from(new Set([...body.skills, "jefe"]));
      }
      await api(`/api/employees/${form.dataset.employeeId}`, { method: "PATCH", body });
      state.editEmployeeId = null;
      toast("Operario actualizado");
      await renderAdmin(true);
    }
    if (type === "employee-import") {
      const result = await submitCsvImport(form, "employees");
      toast(`Operarios importados: ${result.inserted} nuevos, ${result.updated} actualizados, ${result.skipped} omitidos`);
      await renderAdmin(true);
    }
    if (type === "client-import") {
      const result = await submitCsvImport(form, "clients");
      toast(`Clientes importados: ${result.inserted} nuevos, ${result.updated} actualizados, ${result.skipped} omitidos`);
      await renderAdmin(true);
    }
    if (type === "user") {
      const body = formData(form);
      body.skills = String(body.skills || "").split(",").map((item) => item.trim()).filter(Boolean);
      body.permissions = permissionsFromForm(form);
      await api("/api/users", { method: "POST", body });
      toast("Usuario creado");
      await renderAdmin(true);
    }
    if (type === "user-permissions") {
      await api(`/api/users/${form.dataset.userId}`, {
        method: "PATCH",
        body: { permissions: permissionsFromForm(form) }
      });
      toast("Permisos actualizados");
      await renderAdmin(true);
    }
    if (type === "incident") {
      await api("/api/incidents", { method: "POST", body: formData(form) });
      toast("Incidencia abierta");
      await renderAdmin(true);
    }
    if (type === "time-entry") {
      const body = formData(form);
      body.accepted = Boolean(form.querySelector("[name=accepted]")?.checked);
      if (!body.correctionReason) body.correctionReason = body.notes || "Correccion manual oficina";
      await api(`/api/time-entries/${form.dataset.entryId}`, { method: "PATCH", body });
      toast("Fichaje corregido");
      await renderAdmin(true);
    }
    if (type === "allowance") {
      const body = {
        ...formData(form),
        eventId: form.dataset.eventId,
        employeeId: form.dataset.employeeId
      };
      const allowanceId = form.dataset.allowanceId;
      await api(allowanceId ? `/api/allowances/${encodeURIComponent(allowanceId)}` : "/api/allowances", {
        method: allowanceId ? "PATCH" : "POST",
        body
      });
      toast("Pluses guardados");
      await renderAdmin(true);
    }
    if (type === "document") {
      await submitDocument(form);
      toast("Documento guardado");
      await renderAdmin(true);
    }
    if (type === "event-document") {
      await submitEventDocument(form);
      toast("Documento de evento guardado");
      await openEvent(form.dataset.eventId);
    }
    if (type === "document-review") {
      await api(`/api/documents/${encodeURIComponent(form.dataset.documentId)}`, {
        method: "PATCH",
        body: formData(form)
      });
      toast("Documento revisado");
      await renderAdmin(true);
    }
    if (type === "availability-admin") {
      await api("/api/availability", { method: "POST", body: formData(form) });
      toast("Disponibilidad registrada");
      await renderAdmin(true);
    }
    if (type === "settings") {
      const body = formData(form);
      body.google_calendar_enabled = form.querySelector("[name=google_calendar_enabled]")?.checked ? "true" : "false";
      body.google_calendar_sync_enabled = form.querySelector("[name=google_calendar_sync_enabled]")?.checked ? "true" : "false";
      await api("/api/settings", { method: "PATCH", body });
      toast("Configuracion guardada");
      await renderAdmin(true);
    }
    if (type === "backup-settings") {
      const body = formData(form);
      body.backup_auto_enabled = form.querySelector("[name=backup_auto_enabled]")?.checked ? "true" : "false";
      await api("/api/settings", { method: "PATCH", body });
      toast("Politica de backups guardada");
      await renderAdmin(true);
    }
    if (type === "role") {
      const body = formData(form);
      await api(`/api/work-roles/${body.id}`, {
        method: "PATCH",
        body: {
          name: body.name,
          basePrice: body.basePrice,
          nightPrice: body.nightPrice,
          active: Boolean(form.querySelector("[name=active]")?.checked)
        }
      });
      toast("Rol actualizado");
      await renderAdmin(true);
    }
    if (type === "work-role") {
      await api("/api/work-roles", { method: "POST", body: formData(form) });
      toast("Rol creado");
      await renderAdmin(true);
    }
    if (type === "availability") {
      await api("/api/employee/availability", { method: "POST", body: formData(form) });
      state.employeeHome = null;
      toast("Disponibilidad enviada");
      await renderEmployee(true);
    }
    if (type === "employee-document") {
      await submitEmployeeDocument(form);
      state.employeeHome = null;
      toast("Documento enviado a revision");
      await renderEmployee(true);
    }
    if (type === "employee-incident") {
      await api("/api/employee/incidents", { method: "POST", body: formData(form) });
      state.employeeHome = null;
      toast("Incidencia enviada a oficina");
      await renderEmployee(true);
	    }
	    if (type === "profile") {
	      await submitEmployeeProfile(form);
	      toast("Perfil actualizado");
	      state.employeeHome = null;
	      await renderEmployee(true);
    }
  } catch (error) {
    const firstIssue = error.payload?.issues?.[0]?.message;
    toast(firstIssue ? `${error.message}: ${firstIssue}` : error.message, "error");
  }
}

async function handleClick(event) {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.dataset.loginMode) {
    state.loginMode = target.dataset.loginMode;
    return renderLogin();
  }

  if (target.dataset.demo) {
    if (!state.publicConfig?.demoMode) return;
    state.loginMode = target.dataset.demo;
    renderLogin();
    return;
  }

  if (target.dataset.recover !== undefined) {
    const form = target.closest("form");
    const input = form?.querySelector("[name=identifier]");
    const identifier = input?.value.trim() || "";
    if (!identifier) {
      input?.focus();
      return toast("Escribe tu email o telefono para recuperar la contrasena", "error");
    }
    const result = await api("/api/auth/recover", { method: "POST", body: { identifier } });
    state.recoveryCode = result.recoveryCode || "";
    state.showReset = Boolean(result.recoveryCode);
    renderLogin();
    return toast(result.recoveryCode ? "Codigo temporal generado" : "Si el usuario existe, oficina gestionara la recuperacion");
  }

  if (target.dataset.showReset !== undefined) {
    state.showReset = true;
    return renderLogin();
  }

  if (target.dataset.nav) {
    state.view = target.dataset.nav;
    state.recommendations = null;
    state.searchQuery = "";
    return renderAdmin();
  }

  if (target.dataset.searchGo) {
    return openGlobalSearchResult(target.dataset.searchGo, target.dataset.searchId);
  }

  if (target.dataset.calendarMode) {
    state.calendarMode = target.dataset.calendarMode;
    return renderAdmin();
  }

  if (target.dataset.calendarNav) {
    moveCalendar(target.dataset.calendarNav);
    return renderAdmin();
  }

  if (target.dataset.openAssignments) {
    state.assignmentEventId = target.dataset.openAssignments;
    state.view = "assignments";
    state.recommendations = null;
    state.assignmentCandidateId = null;
    return renderAdmin();
  }

  if (target.dataset.assignmentCalendarEvent) {
    state.assignmentEventId = target.dataset.assignmentCalendarEvent;
    state.recommendations = null;
    state.assignmentCandidateId = null;
    return renderAdmin();
  }

  if (target.dataset.logout !== undefined) {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("marfan_token");
    state.token = null;
    state.user = null;
    state.data = {};
    state.eventSnapshots = {};
    return renderLogin();
  }

  if (target.dataset.refresh !== undefined) {
    await renderApp(true);
    return toast("Datos actualizados");
  }

  if (target.dataset.googleOauthStart !== undefined) {
    try {
      const form = target.closest("form");
      if (form) {
        const body = formData(form);
        body.google_calendar_enabled = form.querySelector("[name=google_calendar_enabled]")?.checked ? "true" : "false";
        body.google_calendar_sync_enabled = form.querySelector("[name=google_calendar_sync_enabled]")?.checked ? "true" : "false";
        await api("/api/settings", { method: "PATCH", body });
      }
      const result = await api("/api/calendar/google-oauth/start", {
        method: "POST",
        body: { returnUrl: window.location.origin }
      });
      window.location.href = result.authUrl;
    } catch (error) {
      if (["google_redirect_uri_mismatch", "google_oauth_client_type_invalid", "google_redirect_uri_missing"].includes(error.payload?.code)) {
        googleOAuthSetupPrompt(error.payload);
        toast("Google necesita un cliente OAuth Web con la URI autorizada", "error");
        return renderAdmin(true);
      }
      toast(error.message, "error");
    }
    return;
  }

  if (target.dataset.googleSyncPending !== undefined) {
    const result = await api("/api/calendar/google-sync/retry", {
      method: "POST",
      body: { limit: 50 }
    });
    toast(`Google: ${result.synced} sincronizados, ${result.failed} errores, ${result.pendingAuth} pendientes de conexion`);
    return renderAdmin(true);
  }

  if (target.dataset.googleSyncEvent) {
    const result = await api("/api/calendar/google-sync/retry", {
      method: "POST",
      body: { eventId: target.dataset.googleSyncEvent }
    });
    const status = googleSyncLabel(result.googleSync?.status);
    toast(`Google Calendar: ${status}`);
    return renderAdmin(true);
  }

  if (target.dataset.detectAttendanceDate) {
    const result = await api("/api/incidents/detect-attendance", {
      method: "POST",
      body: { date: target.dataset.detectAttendanceDate }
    });
    toast(`${result.created} nuevas, ${result.updated} actualizadas, ${result.skipped} sin cambios`);
    return renderAdmin(true);
  }

  if (target.dataset.selectEvent) {
    state.selectedEventId = target.dataset.selectEvent;
    state.editEventId = null;
    state.selectedEventSnapshotId = null;
    return renderAdmin();
  }

  if (target.dataset.eventSnapshot) {
    state.selectedEventSnapshotId =
      state.selectedEventSnapshotId === target.dataset.eventSnapshot ? null : target.dataset.eventSnapshot;
    return renderAdmin();
  }

  if (target.dataset.importVisibleGoogleEvents !== undefined) {
    const googleEvents = (state.data.calendarEvents || []).filter((item) => item.external);
    if (!googleEvents.length) return toast("No hay eventos Google pendientes en esta vista");
    const result = await api("/api/calendar/import-google-events", {
      method: "POST",
      body: { events: googleEvents.map(googleEventImportPayload) }
    });
    const first = result.events?.[0];
    if (first) {
      state.selectedEventId = first.id;
      state.selectedEventSnapshotId = null;
      state.editEventId = first.id;
      state.assignmentEventId = first.id;
    }
    toast(`Google importado: ${result.created} nuevos, ${result.existing} ya existentes`);
    return renderAdmin(true);
  }

  if (target.dataset.importGoogleEvent) {
    const googleEvent = (state.data.calendarEvents || []).find((item) => item.id === target.dataset.importGoogleEvent);
    if (!googleEvent) return toast("No encuentro ese evento de Google en el calendario actual", "error");
    const result = await api("/api/calendar/import-google-event", {
      method: "POST",
      body: googleEventImportPayload(googleEvent)
    });
    state.selectedEventId = result.event.id;
    state.selectedEventSnapshotId = null;
    state.editEventId = result.event.id;
    state.assignmentEventId = result.event.id;
    state.view = "events";
    toast(result.created ? "Evento importado. Ya puedes editarlo y asignar personal." : "Ese evento ya estaba importado en MARFAN.");
    return renderAdmin(true);
  }

  if (target.dataset.newEvent !== undefined) {
    state.selectedEventId = null;
    state.selectedEventSnapshotId = null;
    state.editEventId = null;
    return renderAdmin();
  }

  if (target.dataset.selectEmployee) {
    state.selectedEmployeeId = target.dataset.selectEmployee;
    state.editEmployeeId = null;
    return renderAdmin();
  }

  if (target.dataset.selectClient) {
    state.selectedClientId = target.dataset.selectClient;
    state.editClientId = null;
    return renderAdmin();
  }

  if (target.dataset.newClient !== undefined) {
    state.selectedClientId = null;
    state.editClientId = null;
    return renderAdmin();
  }

  if (target.dataset.editClient) {
    state.selectedClientId = target.dataset.editClient;
    state.editClientId = target.dataset.editClient;
    return renderAdmin();
  }

  if (target.dataset.cancelEditClient !== undefined) {
    state.editClientId = null;
    return renderAdmin();
  }

  if (target.dataset.deleteClient) {
    if (!confirm("¿Eliminar este cliente? Si eres super admin y tiene eventos, tambien se eliminaran sus eventos.")) return;
    await api(`/api/clients/${target.dataset.deleteClient}`, { method: "DELETE" });
    state.selectedClientId = null;
    state.editClientId = null;
    toast("Cliente eliminado");
    return renderAdmin(true);
  }

  if (target.dataset.deleteEvent) {
    if (!confirm("¿Eliminar este evento definitivamente? Esta accion solo puede hacerla un super admin.")) return;
    await api(`/api/events/${target.dataset.deleteEvent}`, { method: "DELETE" });
    state.selectedEventId = null;
    state.editEventId = null;
    toast("Evento eliminado");
    return renderAdmin(true);
  }

  if (target.dataset.newEmployee !== undefined) {
    state.selectedEmployeeId = null;
    state.editEmployeeId = null;
    return renderAdmin();
  }

  if (target.dataset.editEmployee) {
    state.selectedEmployeeId = target.dataset.editEmployee;
    state.editEmployeeId = target.dataset.editEmployee;
    return renderAdmin();
  }

  if (target.dataset.deleteEmployee) {
    if (!confirm("¿Eliminar este operario y su acceso al portal? Sus fichajes/incidencias quedaran en el historico cuando corresponda.")) return;
    await api(`/api/employees/${target.dataset.deleteEmployee}`, { method: "DELETE" });
    state.selectedEmployeeId = null;
    state.editEmployeeId = null;
    toast("Operario eliminado");
    return renderAdmin(true);
  }

  if (target.dataset.cancelEditEmployee !== undefined) {
    state.editEmployeeId = null;
    return renderAdmin();
  }

  if (target.dataset.editEvent) {
    state.editEventId = target.dataset.editEvent;
    state.selectedEventId = target.dataset.editEvent;
    return renderAdmin();
  }

  if (target.dataset.cancelEditEvent !== undefined) {
    state.editEventId = null;
    return renderAdmin();
  }

  if (target.dataset.closeEvent) {
    await api(`/api/events/${target.dataset.closeEvent}/close`, { method: "POST" });
    state.editEventId = null;
    toast("Evento cerrado");
    return renderAdmin(true);
  }

  if (target.dataset.duplicate) {
    const source = (state.data.events || []).find((event) => event.id === target.dataset.duplicate);
    const suggestedDate = isoDate(addCalendarDays(parseLocalDate(source?.date || todayIso()), 7));
    const date = window.prompt("Fecha para la copia (AAAA-MM-DD)", suggestedDate);
    if (!date) return;
    const result = await api(`/api/events/${target.dataset.duplicate}/duplicate`, { method: "POST", body: { date } });
    const copied = result.copiedAssignments?.length || 0;
    const skipped = result.skippedAssignments?.length || 0;
    toast(skipped ? `Evento duplicado: ${copied} asignados, ${skipped} omitidos` : `Evento duplicado con ${copied} asignados`);
    return renderAdmin(true);
  }

  if (target.dataset.recommendations) {
    const eventId = target.dataset.recommendations;
    const result = await api(`/api/planner/recommendations?eventId=${encodeURIComponent(eventId)}`);
    state.recommendations = { eventId, items: result.recommendations };
    const firstAvailable = result.recommendations.find((item) => !candidateIsBlocked(item)) || result.recommendations[0];
    state.assignmentCandidateId = firstAvailable?.employee.id || null;
    return renderAdmin();
  }

  if (target.dataset.assignRecommended) {
    await api("/api/assignments", {
      method: "POST",
      body: { eventId: target.dataset.eventId, employeeId: target.dataset.assignRecommended, role: target.dataset.role }
    });
    toast("Operario asignado");
    state.recommendations = null;
    return renderAdmin(true);
  }

  if (target.dataset.deleteAssignment) {
    await api(`/api/assignments/${target.dataset.deleteAssignment}`, { method: "DELETE" });
    toast("Asignacion eliminada");
    return renderAdmin(true);
  }

  if (target.dataset.deleteAllowance) {
    await api(`/api/allowances/${encodeURIComponent(target.dataset.deleteAllowance)}`, { method: "DELETE" });
    toast("Pluses quitados");
    return renderAdmin(true);
  }

  if (target.dataset.assignmentIncident) {
    const eventRow = (state.data.events || []).find((item) =>
      (item.assignments || []).some((assignment) => assignment.id === target.dataset.assignmentIncident)
    );
    const assignment = eventRow?.assignments?.find((item) => item.id === target.dataset.assignmentIncident);
    if (!eventRow || !assignment) return;
    const absence = target.dataset.incidentKind === "ausencia";
    await api("/api/incidents", {
      method: "POST",
      body: {
        eventId: eventRow.id,
        employeeId: assignment.employee_id,
        type: absence ? "ausencia" : "otro",
        priority: absence ? "alta" : "media",
        title: absence ? "Ausencia detectada" : "Incidencia del servicio",
        description: absence
          ? `La app no encuentra fichaje de entrada aceptado para ${assignment.name} en ${eventRow.name}.`
          : `Incidencia registrada desde revision del evento efectuado ${eventRow.name}.`
      }
    });
    toast(absence ? "Ausencia creada" : "Incidencia creada");
    return renderAdmin(true);
  }

  if (target.dataset.userRole) {
    await api(`/api/users/${target.dataset.userRole}`, {
      method: "PATCH",
      body: { role: target.dataset.nextRole }
    });
    toast("Permiso actualizado");
    return renderAdmin(true);
  }

  if (target.dataset.userActive) {
    await api(`/api/users/${target.dataset.userActive}`, {
      method: "PATCH",
      body: { active: target.dataset.nextActive === "true" }
    });
    toast(target.dataset.nextActive === "true" ? "Usuario activado" : "Usuario bloqueado");
    return renderAdmin(true);
  }

  if (target.dataset.resetUser) {
    const password = window.prompt("Nueva contrasena temporal");
    if (!password) return;
    if (password.length < 8) return toast("La contrasena debe tener al menos 8 caracteres", "error");
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return toast("La contrasena debe incluir letras y numeros", "error");
    }
    await api(`/api/users/${target.dataset.resetUser}`, {
      method: "PATCH",
      body: { password }
    });
    toast("Contrasena temporal actualizada");
    return renderAdmin(true);
  }

  if (target.dataset.resolveIncident) {
    const resolutionNote = window.prompt("Nota de resolucion", "Resuelto por oficina") || "";
    await api(`/api/incidents/${target.dataset.resolveIncident}`, {
      method: "PATCH",
      body: { status: "resuelta", resolutionNote }
    });
    toast("Incidencia resuelta");
    return renderAdmin(true);
  }

  if (target.dataset.reopenIncident) {
    await api(`/api/incidents/${target.dataset.reopenIncident}`, {
      method: "PATCH",
      body: { status: "abierta" }
    });
    toast("Incidencia reabierta");
    return renderAdmin(true);
  }

  if (target.dataset.availabilityStatus) {
    await api(`/api/availability/${target.dataset.availabilityStatus}`, {
      method: "PATCH",
      body: { status: target.dataset.nextStatus }
    });
    const labels = { aprobado: "Disponibilidad aprobada", rechazado: "Disponibilidad rechazada", solicitado: "Disponibilidad pendiente" };
    toast(labels[target.dataset.nextStatus] || "Disponibilidad actualizada");
    return renderAdmin(true);
  }

  if (target.dataset.promoteLeader) {
    const employee = state.data.employees.find((item) => item.id === target.dataset.promoteLeader);
    const skills = Array.from(new Set([...(employee?.skills || []), "jefe"]));
    await api(`/api/employees/${target.dataset.promoteLeader}`, {
      method: "PATCH",
      body: { role: "Jefe de equipo", skills }
    });
    toast("Rol de jefe de equipo asignado");
    return renderAdmin(true);
  }

  if (target.dataset.backup !== undefined) {
    await api("/api/backups", { method: "POST" });
    toast("Backup creado");
    return renderAdmin(true);
  }

  if (target.dataset.autoBackup !== undefined) {
    const result = await api("/api/backups/auto-run", { method: "POST" });
    toast(result.pruned ? `Backup automatico creado y ${result.pruned} copias antiguas limpiadas` : "Backup automatico creado");
    return renderAdmin(true);
  }

  if (target.dataset.verifyBackup) {
    const result = await api(`/api/backups/${target.dataset.verifyBackup}/verify`);
    toast(result.backup.verified ? "Backup verificado" : "Backup revisado: necesita atencion", result.backup.verified ? "info" : "error");
    return renderAdmin(true);
  }

  if (target.dataset.downloadBackup) {
    await downloadBackup(target.dataset.downloadBackup);
    return toast("Backup descargado");
  }

  if (target.dataset.restoreBackup) {
    const typed = window.prompt("Para preparar esta restauracion escribe RESTAURAR. Se creara una copia de seguridad previa y se aplicara en el proximo reinicio.");
    if (String(typed || "").trim().toUpperCase() !== "RESTAURAR") {
      return toast("Restauracion cancelada", "info");
    }
    await api("/api/backups/restore", {
      method: "POST",
      body: { backupId: target.dataset.restoreBackup, confirm: "RESTAURAR" }
    });
    return toast("Restauracion preparada para el proximo reinicio");
  }

  if (target.dataset.syncDocuments !== undefined) {
    const result = await api("/api/documents/sync-statuses", { method: "POST" });
    toast(result.updated ? `${result.updated} estados documentales actualizados` : "Estados documentales al dia");
    return renderAdmin(true);
  }

  if (target.dataset.clearReportFilters !== undefined) {
    state.reportFilters = { from: "", to: "", clientId: "", employeeId: "", status: "", search: "" };
    toast("Filtros de informe limpiados");
    return renderAdmin();
  }

  if (target.dataset.albaran) {
    const html = await api(`/api/delivery-notes/${target.dataset.albaran}`);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }

  if (target.dataset.clientDossier) {
    const html = await api(`/api/events/${encodeURIComponent(target.dataset.clientDossier)}/client-dossier`);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }

  if (target.dataset.clientDossierPdf) {
    const response = await fetch(`/api/events/${encodeURIComponent(target.dataset.clientDossierPdf)}/client-dossier?format=pdf`, {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo generar el PDF del dossier");
    const blob = await response.blob();
    return downloadBlob(`dossier-${target.dataset.clientDossierPdf}.pdf`, blob);
  }

  if (target.dataset.albaranPdf) {
    const response = await fetch(`/api/delivery-notes/${encodeURIComponent(target.dataset.albaranPdf)}?format=pdf`, {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo generar el PDF del albaran");
    const blob = await response.blob();
    return downloadBlob(`albaran-${target.dataset.albaranPdf}.pdf`, blob);
  }

  if (target.dataset.documentFile) {
    return openDocumentFile(target.dataset.documentFile, target.dataset.fileName || "documento");
  }

  if (target.dataset.eventDocumentFile) {
    return openEventDocumentFile(target.dataset.eventDocumentFile, target.dataset.fileName || "documento");
  }

  if (target.dataset.employeeTemplate !== undefined) {
    const csv = await api("/api/imports/templates/employees");
    return download("plantilla-operarios-marfan.csv", csv, "text/csv");
  }

  if (target.dataset.clientTemplate !== undefined) {
    const csv = await api("/api/imports/templates/clients");
    return download("plantilla-clientes-marfan.csv", csv, "text/csv");
  }

  if (target.dataset.auditCsv !== undefined) {
    const csv = await api("/api/audit-logs?format=csv");
    return download("marfan-auditoria.csv", csv, "text/csv");
  }

  if (target.dataset.snapshotJson) {
    const snapshot = findSnapshot(target.dataset.snapshotJson);
    if (!snapshot) return toast("No encuentro esa foto del evento", "error");
    const eventId = snapshot.event_id || snapshot.payload?.event?.id || "evento";
    return download(`snapshot-${eventId}-${snapshot.id}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  }

  if (target.dataset.exportCsv !== undefined) {
    const csv = await api(reportPath("/api/reports/events", "csv"));
    return download("marfan-eventos.csv", csv, "text/csv");
  }

  if (target.dataset.exportXls !== undefined) {
    const xls = await api(reportPath("/api/reports/events", "xls"));
    return download("marfan-eventos.xls", xls, "application/vnd.ms-excel");
  }

  if (target.dataset.exportPdf !== undefined) {
    const response = await fetch(reportPath("/api/reports/events", "pdf"), {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo exportar PDF");
    const blob = await response.blob();
    return downloadBlob("marfan-eventos.pdf", blob);
  }

  if (target.dataset.exportJson !== undefined) {
    const report = await api(reportPath("/api/reports/events"));
    return download("marfan-eventos.json", JSON.stringify(report.rows, null, 2), "application/json");
  }

  if (target.dataset.financeCsv !== undefined) {
    const csv = await api(reportPath("/api/reports/finance", "csv"));
    return download("marfan-finanzas.csv", csv, "text/csv");
  }

  if (target.dataset.financeXls !== undefined) {
    const xls = await api(reportPath("/api/reports/finance", "xls"));
    return download("marfan-finanzas.xls", xls, "application/vnd.ms-excel");
  }

  if (target.dataset.financePdf !== undefined) {
    const response = await fetch(reportPath("/api/reports/finance", "pdf"), {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo exportar finanzas PDF");
    const blob = await response.blob();
    return downloadBlob("marfan-finanzas.pdf", blob);
  }

  if (target.dataset.financeJson !== undefined) {
    const report = await api(reportPath("/api/reports/finance"));
    return download("marfan-finanzas.json", JSON.stringify(report.rows, null, 2), "application/json");
  }

  if (target.dataset.employeesCsv !== undefined) {
    const csv = await api(reportPath("/api/reports/employees", "csv"));
    return download("marfan-operarios.csv", csv, "text/csv");
  }

  if (target.dataset.employeesXls !== undefined) {
    const xls = await api(reportPath("/api/reports/employees", "xls"));
    return download("marfan-operarios.xls", xls, "application/vnd.ms-excel");
  }

  if (target.dataset.employeesPdf !== undefined) {
    const response = await fetch(reportPath("/api/reports/employees", "pdf"), {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo exportar operarios PDF");
    const blob = await response.blob();
    return downloadBlob("marfan-operarios.pdf", blob);
  }

  if (target.dataset.employeesJson !== undefined) {
    const report = await api(reportPath("/api/reports/employees"));
    return download("marfan-operarios.json", JSON.stringify(report.rows, null, 2), "application/json");
  }

  if (target.dataset.incidentsCsv !== undefined) {
    const csv = await api(reportPath("/api/reports/incidents", "csv"));
    return download("marfan-incidencias.csv", csv, "text/csv");
  }

  if (target.dataset.incidentsXls !== undefined) {
    const xls = await api(reportPath("/api/reports/incidents", "xls"));
    return download("marfan-incidencias.xls", xls, "application/vnd.ms-excel");
  }

  if (target.dataset.incidentsPdf !== undefined) {
    const response = await fetch(reportPath("/api/reports/incidents", "pdf"), {
      headers: { authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("No se pudo exportar incidencias PDF");
    const blob = await response.blob();
    return downloadBlob("marfan-incidencias.pdf", blob);
  }

  if (target.dataset.incidentsJson !== undefined) {
    const report = await api(reportPath("/api/reports/incidents"));
    return download("marfan-incidencias.json", JSON.stringify(report.rows, null, 2), "application/json");
  }

  if (target.dataset.employeeTab) {
    state.employeeTab = target.dataset.employeeTab;
    return renderEmployee();
  }

  if (target.dataset.employeeServiceMode) {
    state.employeeServiceMode = target.dataset.employeeServiceMode;
    return renderEmployee();
  }

  if (target.dataset.employeeServiceNav) {
    moveEmployeeServiceCalendar(target.dataset.employeeServiceNav);
    return renderEmployee();
  }

  if (target.dataset.confirmService) {
    await api(`/api/employee/services/${encodeURIComponent(target.dataset.confirmService)}/confirm`, { method: "POST" });
    toast("Asistencia confirmada");
    return renderEmployee(true);
  }

  if (target.dataset.clock) {
    return clock(target.dataset.clock);
  }

  if (target.dataset.clearSignature !== undefined) {
    const canvas = document.querySelector("[data-signature-canvas]");
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      delete canvas.dataset.signed;
    }
    return;
  }

  if (target.dataset.openMaps) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.dataset.openMaps)}`, "_blank", "noopener");
  }

  if (target.dataset.openUrl) {
    window.open(target.dataset.openUrl, "_blank", "noopener");
  }

  if (target.dataset.callOffice !== undefined) {
    const phone = String(target.dataset.callOffice || state.employeeHome?.office?.phone || "+34910000000").replace(/\s+/g, "");
    window.location.href = `tel:${phone}`;
  }

  if (target.dataset.whatsapp !== undefined) {
    const phone = String(target.dataset.whatsapp || state.employeeHome?.office?.whatsapp || state.employeeHome?.office?.phone || "34910000000").replace(/\D/g, "");
    window.open(`https://wa.me/${phone}`, "_blank", "noopener");
  }
}

function handleInput(event) {
  const target = event.target;
  if (target?.closest?.("[data-report-filters]")) {
    syncReportFiltersFromDom();
  }
  if (!target?.dataset || target.dataset.search === undefined) return;
  state.searchQuery = target.value;
  refreshGlobalSearchResults();
}

function handleKeydown(event) {
  const target = event.target;
  if (target?.dataset?.search === undefined) return;
  if (event.key === "Escape") {
    state.searchQuery = "";
    target.value = "";
    refreshGlobalSearchResults();
  }
  if (event.key === "Enter") {
    const first = globalSearchResults()[0];
    if (!first) return;
    event.preventDefault();
    openGlobalSearchResult(first.type, first.id);
  }
}

async function handleChange(event) {
  if (event.target.closest?.("[data-report-filters]")) {
    syncReportFiltersFromDom();
  }
  if (event.target.matches("[data-assignment-event]")) {
    state.assignmentEventId = event.target.value;
    state.recommendations = null;
    state.assignmentCandidateId = null;
    await renderAdmin();
  }
  if (event.target.matches("[data-assignment-candidate]")) {
    state.assignmentCandidateId = event.target.value;
    await renderAdmin();
  }
  if (event.target.matches("[data-google-maps-url]")) {
    let coords = extractMapsCoordinates(event.target.value);
    const form = event.target.closest("form");
    if (!coords && event.target.value.trim()) {
      try {
        toast("Resolviendo enlace de Google Maps...");
        const resolved = await api("/api/maps/resolve", {
          method: "POST",
          body: { url: event.target.value.trim() }
        });
        coords = resolved.coordinates;
        if (resolved.finalUrl) event.target.value = resolved.finalUrl;
      } catch (error) {
        toast(error.message, "error");
      }
    }
    if (coords && form) {
      form.querySelector("[data-event-lat]").value = coords.lat.toFixed(6);
      form.querySelector("[data-event-lng]").value = coords.lng.toFixed(6);
      toast("Coordenadas del recinto detectadas");
    }
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-calendar-drag]");
  if (!card) return;
  state.draggedEventId = card.dataset.calendarDrag;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggedEventId);
}

function handleDragOver(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (!zone || !state.draggedEventId) return;
  event.preventDefault();
  zone.classList.add("drag-over");
}

function handleDragLeave(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (zone) zone.classList.remove("drag-over");
}

async function handleDrop(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (!zone) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
  const eventId = event.dataTransfer?.getData("text/plain") || state.draggedEventId;
  const moved = state.data.events.find((item) => item.id === eventId);
  if (!moved) return;
  const body = { date: zone.dataset.dropDate };
  if (zone.dataset.dropTime) {
    const duration = hoursBetweenClient(moved.start_time, moved.end_time);
    body.startTime = zone.dataset.dropTime;
    body.endTime = addHoursToTime(zone.dataset.dropTime, duration);
  }
  try {
    await api(`/api/events/${eventId}`, { method: "PATCH", body });
    state.selectedEventId = eventId;
    state.calendarDate = body.date;
    toast("Evento movido y recalculado");
    await renderAdmin(true);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.draggedEventId = null;
  }
}

function handleDragEnd() {
  state.draggedEventId = null;
  document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
}

async function clock(type) {
  try {
    const service = state.employeeHome?.nextService;
    if (!service) return;
    const allowed = type === "entrada" ? Boolean(Number(service.can_clock_in || 0)) : Boolean(Number(service.can_clock_out || 0));
    if (!allowed) return toast(type === "entrada" ? "La entrada no esta disponible ahora" : "La salida no esta disponible ahora", "error");
    const coords = await getPosition();
    const signature = type === "salida" && service.is_team_leader ? signaturePayload() : {};
    if (type === "salida" && service.is_team_leader && (!signature.signatureName.trim() || !signature.signatureDni.trim())) {
      return toast("Faltan nombre y DNI del firmante", "error");
    }
    const result = await api("/api/time-entries/clock", {
      method: "POST",
      body: { eventId: service.id, type, lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy, ...signature }
    });
    toast(result.deliveryNote ? "Salida registrada y albaran firmado" : `${type === "salida" ? "Salida" : "Entrada"} registrada · ${result.distance} m`);
    await renderEmployee(true);
  } catch (error) {
    toast(error.message, "error");
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Este dispositivo no permite geolocalizacion"));
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      (error) => {
        const denied = error?.code === error?.PERMISSION_DENIED;
        reject(new Error(denied ? "Activa el permiso de ubicacion para fichar" : "No se pudo obtener GPS real"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  });
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function openDocumentFile(documentId, fileName) {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/file`, {
    headers: { authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Archivo no disponible");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (blob.type === "application/octet-stream") downloadBlob(fileName, blob);
}

async function openEventDocumentFile(documentId, fileName) {
  const response = await fetch(`/api/event-documents/${encodeURIComponent(documentId)}/file`, {
    headers: { authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Archivo no disponible");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (blob.type === "application/octet-stream") downloadBlob(fileName, blob);
}

async function downloadBackup(backupId) {
  const response = await fetch(`/api/backups/${encodeURIComponent(backupId)}/file`, {
    headers: { authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Backup no disponible");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const fileName = match?.[1] || `backup-${backupId}.sqlite`;
  downloadBlob(fileName, await response.blob());
}

document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);
document.addEventListener("input", handleInput);
document.addEventListener("keydown", handleKeydown);
document.addEventListener("change", handleChange);
document.addEventListener("dragstart", handleDragStart);
document.addEventListener("dragover", handleDragOver);
document.addEventListener("dragleave", handleDragLeave);
document.addEventListener("drop", handleDrop);
document.addEventListener("dragend", handleDragEnd);

init();


const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'marfan-clean-db.json');
const SEED_PATH = path.join(__dirname, 'data', 'db.seed.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

function ensureDb() {
  ensureDir(DATA_DIR);
  ensureDir(LOCAL_DATA_DIR);

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(loadSeed(), null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    const fallback = loadSeed();
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

function writeDb(db) {
  ensureDb();
  db.updated_at = nowIso();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  if (type === 'application/json') res.end(JSON.stringify(body));
  else res.end(body);
}

function notFound(res) {
  send(res, 404, { ok: false, error: 'No encontrado' });
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
  });
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

const sessions = new Map();

function getUser(req) {
  const auth = req.headers.authorization || '';
  const t = auth.replace(/^Bearer\s+/i, '');
  if (!t || !sessions.has(t)) return null;
  return sessions.get(t);
}

function requireUser(req, res) {
  const user = getUser(req);
  if (!user) {
    send(res, 401, { ok: false, error: 'No autorizado' });
    return null;
  }
  return user;
}

function isOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return String(aStart) < String(bEnd) && String(aEnd) > String(bStart);
}

function eventDate(e) {
  return String(e.date || e.event_date || '').slice(0, 10);
}

function eventStart(e) {
  return e.start || e.start_time || e.planned_start || '';
}

function eventEnd(e) {
  return e.end || e.end_time || e.planned_end || '';
}

function userName(u) {
  return u?.name || u?.email || u?.phone || ('Usuario #' + u?.id);
}

function enrichAssignment(db, a) {
  const u = db.users.find(x => String(x.id) === String(a.user_id)) || {};
  const e = db.events.find(x => String(x.id) === String(a.event_id)) || {};
  const rate = db.rates.find(x => String(x.id) === String(a.rate_id)) || {};
  return {
    ...a,
    user_name: userName(u),
    user_phone: u.phone || '',
    user_email: u.email || '',
    team_lead: !!a.team_lead,
    event_name: e.name || e.title || '',
    event_date: eventDate(e),
    event_start: eventStart(e),
    event_end: eventEnd(e),
    event_location: e.location || '',
    role_name: rate.name || a.role || '',
    sell_rate: Number(a.sell_rate ?? rate.sell ?? 0),
    cost_rate: Number(a.cost_rate ?? rate.cost ?? 0),
    diet: Number(a.diet ?? rate.diet ?? 0)
  };
}

function dashboard(db) {
  const t = today();
  const eventsToday = db.events.filter(e => eventDate(e) === t);
  const todayIds = new Set(eventsToday.map(e => String(e.id)));
  const assignmentsToday = db.assignments.filter(a => todayIds.has(String(a.event_id))).map(a => enrichAssignment(db, a));
  const checkinsToday = db.checkins.filter(c => String(c.created_at || '').slice(0, 10) === t);
  const checked = new Set(checkinsToday.map(c => String(c.user_id)));
  const assigned = new Set(assignmentsToday.map(a => String(a.user_id)));
  const incidentsOpen = db.incidents.filter(i => i.status !== 'resuelta');

  let cost = 0;
  let revenue = 0;
  assignmentsToday.forEach(a => {
    const hours = Math.max(0, Number(a.hours || 0) || plannedHours(a.event_start, a.event_end));
    cost += hours * Number(a.cost_rate || 0) + Number(a.diet || 0);
    revenue += hours * Number(a.sell_rate || 0) + Number(a.diet || 0);
  });

  return {
    events_today: eventsToday.length,
    assigned_today: assigned.size,
    checked_today: checked.size,
    pending_today: Math.max(0, assigned.size - checked.size),
    open_incidents: incidentsOpen.length,
    revenue_today: revenue,
    cost_today: cost,
    margin_today: revenue - cost
  };
}

function plannedHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return 0;
  let a = sh * 60 + (sm || 0);
  let b = eh * 60 + (em || 0);
  if (b < a) b += 24 * 60;
  return Math.round(((b - a) / 60) * 100) / 100;
}

function controlDaily(db, date = today()) {
  const events = db.events.filter(e => eventDate(e) === date);
  const eventIds = new Set(events.map(e => String(e.id)));
  const assignments = db.assignments.filter(a => eventIds.has(String(a.event_id))).map(a => enrichAssignment(db, a));
  const checkins = db.checkins.filter(c => String(c.created_at || '').slice(0, 10) === date);
  const checked = new Set(checkins.map(c => String(c.user_id)));
  return {
    date,
    cards: {
      events: events.length,
      assigned: new Set(assignments.map(a => String(a.user_id))).size,
      checked: checked.size,
      pending: assignments.filter(a => !checked.has(String(a.user_id))).length,
      without_staff: events.filter(e => !assignments.some(a => String(a.event_id) === String(e.id))).length,
      without_lead: events.filter(e => !assignments.some(a => String(a.event_id) === String(e.id) && a.team_lead)).length
    },
    events: events.map(e => {
      const a = assignments.filter(x => String(x.event_id) === String(e.id));
      return {
        ...e,
        assignments: a.map(x => ({ ...x, checked_in: checked.has(String(x.user_id)) })),
        assigned: a.length,
        checked: a.filter(x => checked.has(String(x.user_id))).length,
        pending: a.filter(x => !checked.has(String(x.user_id))).length,
        team_lead: a.find(x => x.team_lead) || null
      };
    })
  };
}

function activeOperators(db, date = today()) {
  const daily = controlDaily(db, date);
  const openIncidents = db.incidents.filter(i => i.status !== 'resuelta');
  const incidentUsers = new Set(openIncidents.map(i => String(i.user_id)).filter(Boolean));
  const rows = [];
  daily.events.forEach(e => {
    e.assignments.forEach(a => {
      let status = a.checked_in ? 'trabajando' : 'pendiente';
      if (incidentUsers.has(String(a.user_id))) status = 'incidencia';
      rows.push({
        ...a,
        event_id: e.id,
        event_name: e.name,
        date,
        status,
        has_incident: incidentUsers.has(String(a.user_id))
      });
    });
  });
  return {
    cards: {
      total: new Set(rows.map(r => String(r.user_id))).size,
      trabajando: rows.filter(r => r.status === 'trabajando').length,
      pendientes: rows.filter(r => r.status === 'pendiente').length,
      incidencias: rows.filter(r => r.status === 'incidencia').length,
      sin_telefono: rows.filter(r => !r.user_phone).length
    },
    operators: rows
  };
}

function planner(db, from = today(), days = 7) {
  const start = new Date(from);
  const dates = [];
  for (let i = 0; i < Number(days || 7); i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.map(date => {
    const daily = controlDaily(db, date);
    const needed = daily.events.reduce((sum, e) => sum + Number(e.required_workers || 0), 0);
    const assigned = daily.events.reduce((sum, e) => sum + e.assigned, 0);
    return {
      date,
      events: daily.events.length,
      needed,
      assigned,
      missing: Math.max(0, needed - assigned),
      status: missingStatus(needed, assigned)
    };
  });
}

function missingStatus(needed, assigned) {
  if (!needed) return 'sin_necesidad';
  if (assigned >= needed) return 'completo';
  if (assigned >= Math.ceil(needed * 0.75)) return 'casi';
  return 'falta';
}

async function handleApi(req, res, url) {
  const db = readDb();

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b = await parseBody(req);
    const user = db.users.find(u =>
      (String(u.email).toLowerCase() === String(b.user || b.email || '').toLowerCase() ||
       String(u.phone) === String(b.user || b.phone || '')) &&
      String(u.password) === String(b.password || '')
    );
    if (!user) return send(res, 401, { ok: false, error: 'Credenciales incorrectas' });
    const t = token();
    sessions.set(t, { id: user.id, role: user.role, name: user.name });
    return send(res, 200, { ok: true, token: t, user: { id: user.id, name: user.name, role: user.role } });
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, { ok: true, version: 'MARFAN CLEAN 1', uptime: process.uptime(), data: DB_PATH });
  }

  const publicGet = req.method === 'GET' && ['/api/bootstrap'].includes(url.pathname);
  const user = publicGet ? { role: 'public' } : requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return send(res, 200, { ok: true, settings: db.settings, demo: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    return send(res, 200, { ok: true, dashboard: dashboard(db) });
  }

  if (req.method === 'GET' && url.pathname === '/api/db') {
    return send(res, 200, { ok: true, db });
  }

  if (req.method === 'POST' && url.pathname === '/api/backup') {
    const backupDir = path.join(DATA_DIR, 'backups');
    ensureDir(backupDir);
    const file = path.join(backupDir, 'marfan-backup-' + nowIso().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
    return send(res, 200, { ok: true, file });
  }

  const collections = {
    '/api/users': 'users',
    '/api/clients': 'clients',
    '/api/events': 'events',
    '/api/assignments': 'assignments',
    '/api/incidents': 'incidents',
    '/api/documents': 'documents',
    '/api/rates': 'rates'
  };

  for (const [route, key] of Object.entries(collections)) {
    if (url.pathname === route && req.method === 'GET') {
      const rows = key === 'assignments' ? db[key].map(a => enrichAssignment(db, a)) : db[key];
      return send(res, 200, { ok: true, [key]: rows });
    }

    if (url.pathname === route && req.method === 'POST') {
      const b = await parseBody(req);
      const item = { id: nextId(db[key]), ...b, created_at: nowIso(), updated_at: nowIso() };

      if (key === 'assignments') {
        const event = db.events.find(e => String(e.id) === String(item.event_id));
        const overlaps = db.assignments
          .filter(a => String(a.user_id) === String(item.user_id))
          .map(a => ({ a, e: db.events.find(x => String(x.id) === String(a.event_id)) }))
          .filter(x => x.e && event && eventDate(x.e) === eventDate(event))
          .filter(x => isOverlap(eventStart(x.e), eventEnd(x.e), eventStart(event), eventEnd(event)));

        if (overlaps.length) {
          return send(res, 409, { ok: false, error: 'Operario solapado en ese horario', conflicts: overlaps });
        }
      }

      db[key].push(item);
      db.logs.push({ id: nextId(db.logs), action: 'create', collection: key, item_id: item.id, user_id: user.id, created_at: nowIso() });
      writeDb(db);
      return send(res, 200, { ok: true, item });
    }
  }

  const matchUpdate = url.pathname.match(/^\/api\/(users|clients|events|assignments|incidents|documents|rates)\/(\d+)$/);
  if (matchUpdate) {
    const key = matchUpdate[1];
    const id = Number(matchUpdate[2]);

    if (req.method === 'PUT') {
      const b = await parseBody(req);
      const i = db[key].findIndex(x => Number(x.id) === id);
      if (i < 0) return notFound(res);
      db[key][i] = { ...db[key][i], ...b, updated_at: nowIso() };
      writeDb(db);
      return send(res, 200, { ok: true, item: db[key][i] });
    }

    if (req.method === 'DELETE') {
      db[key] = db[key].filter(x => Number(x.id) !== id);
      writeDb(db);
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/control-diario') {
    return send(res, 200, { ok: true, ...controlDaily(db, url.searchParams.get('date') || today()) });
  }

  if (req.method === 'GET' && url.pathname === '/api/operarios-activos') {
    return send(res, 200, { ok: true, ...activeOperators(db, url.searchParams.get('date') || today()) });
  }

  if (req.method === 'GET' && url.pathname === '/api/planner') {
    return send(res, 200, { ok: true, days: planner(db, url.searchParams.get('from') || today(), url.searchParams.get('days') || 7) });
  }

  if (req.method === 'POST' && url.pathname === '/api/checkin') {
    const b = await parseBody(req);
    const row = {
      id: nextId(db.checkins),
      user_id: b.user_id || user.id,
      event_id: b.event_id || null,
      type: b.type || 'entrada',
      lat: b.lat || '',
      lng: b.lng || '',
      created_at: nowIso()
    };
    db.checkins.push(row);
    writeDb(db);
    return send(res, 200, { ok: true, checkin: row });
  }

  if (req.method === 'GET' && url.pathname === '/api/report/event') {
    const eventId = url.searchParams.get('id');
    const event = db.events.find(e => String(e.id) === String(eventId));
    if (!event) return notFound(res);
    const assignments = db.assignments.filter(a => String(a.event_id) === String(eventId)).map(a => enrichAssignment(db, a));
    return send(res, 200, { ok: true, event, assignments });
  }

  notFound(res);
}

function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = file.replace(/\.\./g, '');
  const full = path.join(PUBLIC_DIR, file);

  if (!full.startsWith(PUBLIC_DIR)) return notFound(res);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    const index = path.join(PUBLIC_DIR, 'index.html');
    return send(res, 200, fs.readFileSync(index, 'utf8'), 'text/html');
  }

  const ext = path.extname(full).toLowerCase();
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  send(res, 200, fs.readFileSync(full), types[ext] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: e.message });
  }
});

ensureDb();
server.listen(PORT, () => {
  console.log('MARFAN CLEAN 1 running on :' + PORT);
  console.log('Data:', DB_PATH);
});

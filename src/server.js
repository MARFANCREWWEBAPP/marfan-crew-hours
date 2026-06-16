
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const DB_FILE = path.join(DATA_DIR, 'marfan-crew-db.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function ensureDirs() {
  for (const dir of [
    DATA_DIR,
    path.join(DATA_DIR, 'uploads'),
    path.join(DATA_DIR, 'signatures'),
    path.join(DATA_DIR, 'documents'),
    path.join(DATA_DIR, 'exports'),
    path.join(DATA_DIR, 'backups'),
    path.join(DATA_DIR, 'logs')
  ]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
}

function defaultDb() {
  return {
    meta: {
      app: 'Marfan Crew',
      version: '2.1.2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    users: [
      {
        id: 'admin-1',
        role: 'super_admin',
        name: 'Administrador Marfan',
        email: 'admin@marfan.local',
        phone: '',
        password: 'Admin1234!',
        active: true,
        is_team_lead: false,
        created_at: new Date().toISOString()
      },
      {
        id: 'op-1',
        role: 'operator',
        name: 'Operario Demo',
        email: 'operario@marfan.local',
        phone: '600000000',
        password: 'Marfan1234*',
        active: true,
        is_team_lead: false,
        created_at: new Date().toISOString()
      }
    ],
    clients: [],
    events: [],
    assignments: [],
    checkins: [],
    signatures: [],
    audit_logs: []
  };
}

function readDb() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    const backup = path.join(DATA_DIR, 'backups', 'corrupt-' + Date.now() + '.json');
    try { fs.copyFileSync(DB_FILE, backup); } catch (_) {}
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
}

function writeDb(db) {
  db.meta.updated_at = new Date().toISOString();
  ensureDirs();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function send(res, status, data, type='application/json') {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  if (type === 'application/json') res.end(JSON.stringify(data));
  else res.end(data);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
  });
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

const sessions = new Map();

function currentUser(req) {
  const auth = req.headers.authorization || '';
  const t = auth.replace('Bearer ', '').trim();
  if (!t || !sessions.has(t)) return null;
  return sessions.get(t);
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { ok: false, error: 'No autenticado' });
    return null;
  }
  return user;
}

function toMinutes(date, time) {
  const d = String(date || '').slice(0,10);
  const t = String(time || '00:00').slice(0,5);
  const [h,m] = t.split(':').map(Number);
  const base = new Date(d + 'T00:00:00').getTime();
  return base + ((h || 0) * 60 + (m || 0)) * 60000;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function findAssignmentConflicts(db, eventId, userId, date, start, end) {
  const ns = toMinutes(date, start);
  let ne = toMinutes(date, end);
  if (ne <= ns) ne += 24*60*60000;

  return db.assignments.filter(a => {
    if (a.event_id === eventId) return false;
    if (a.user_id !== userId) return false;
    const ev = db.events.find(e => e.id === a.event_id);
    if (!ev) return false;
    const as = toMinutes(ev.date, a.start_time || ev.start_time);
    let ae = toMinutes(ev.date, a.end_time || ev.end_time);
    if (ae <= as) ae += 24*60*60000;
    return overlaps(ns, ne, as, ae);
  });
}

function serveFile(req, res) {
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  file = file.replace(/\.\./g, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    send(res, 404, '404 Not Found', 'text/plain');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const types = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json' };
  send(res, 200, fs.readFileSync(full), types[ext] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

    if (req.url === '/health') {
      return send(res, 200, {
        status: 'ok',
        app: 'Marfan Crew',
        version: '2.1.2',
        port: PORT,
        data_dir: DATA_DIR,
        db_exists: fs.existsSync(DB_FILE),
        time: new Date().toISOString()
      });
    }

    if (req.url === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = readDb();
      const login = String(body.login || body.email || body.phone || '').trim().toLowerCase();
      const password = String(body.password || '');
      const mode = String(body.mode || 'admin');

      const user = db.users.find(u => {
        const matchLogin = String(u.email || '').toLowerCase() === login || String(u.phone || '').toLowerCase() === login;
        const matchPass = String(u.password || '') === password;
        const matchMode = mode === 'operator'
          ? ['operator', 'team_lead'].includes(u.role)
          : ['super_admin', 'admin'].includes(u.role);
        return matchLogin && matchPass && matchMode && u.active !== false;
      });

      if (!user) return send(res, 401, { ok:false, error:'Credenciales incorrectas' });

      const t = token();
      const safe = { ...user };
      delete safe.password;
      sessions.set(t, safe);
      return send(res, 200, { ok:true, token:t, user:safe });
    }

    if (req.url === '/api/me') {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { ok:true, user });
    }

    if (req.url === '/api/bootstrap') {
      const db = readDb();
      return send(res, 200, {
        ok:true,
        version:'2.1.2',
        counts: {
          users: db.users.length,
          clients: db.clients.length,
          events: db.events.length,
          assignments: db.assignments.length,
          checkins: db.checkins.length
        },
        data_dir: DATA_DIR
      });
    }

    if (req.url === '/api/data') {
      const user = requireAuth(req, res);
      if (!user) return;
      const db = readDb();
      const safeUsers = db.users.map(u => { const x = {...u}; delete x.password; return x; });
      return send(res, 200, { ok:true, db: { ...db, users: safeUsers } });
    }

    if (req.url === '/api/users' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const newUser = {
        id: 'u-' + Date.now(),
        role: body.role || 'operator',
        name: body.name || '',
        email: body.email || '',
        phone: body.phone || '',
        password: body.password || 'Marfan1234*',
        active: true,
        is_team_lead: !!body.is_team_lead,
        created_at: new Date().toISOString()
      };
      if (newUser.is_team_lead) newUser.role = 'team_lead';
      db.users.push(newUser);
      db.audit_logs.push({ id:'log-'+Date.now(), user_id:user.id, action:'create_user', at:new Date().toISOString() });
      writeDb(db);
      const safe = {...newUser}; delete safe.password;
      return send(res, 200, { ok:true, user:safe });
    }

    if (req.url === '/api/events' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const ev = {
        id: 'ev-' + Date.now(),
        code: body.code || '',
        title: body.title || body.name || 'Nuevo evento',
        client_id: body.client_id || '',
        date: body.date || new Date().toISOString().slice(0,10),
        start_time: body.start_time || '09:00',
        end_time: body.end_time || '14:00',
        location: body.location || '',
        status: body.status || 'programado',
        notes: body.notes || '',
        created_at: new Date().toISOString()
      };
      db.events.push(ev);
      db.audit_logs.push({ id:'log-'+Date.now(), user_id:user.id, action:'create_event', event_id:ev.id, at:new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok:true, event:ev });
    }

    if (req.url === '/api/assignments' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const ev = db.events.find(e => e.id === body.event_id);
      if (!ev) return send(res, 404, { ok:false, error:'Evento no encontrado' });

      const userId = body.user_id;
      const conflicts = findAssignmentConflicts(
        db,
        ev.id,
        userId,
        ev.date,
        body.start_time || ev.start_time,
        body.end_time || ev.end_time
      );

      if (conflicts.length) {
        return send(res, 409, {
          ok:false,
          error:'Operario no disponible: tiene otro evento solapado en ese horario',
          conflicts
        });
      }

      const asg = {
        id: 'asg-' + Date.now(),
        event_id: ev.id,
        user_id: userId,
        role: body.role || 'operario',
        is_team_lead: !!body.is_team_lead,
        start_time: body.start_time || ev.start_time,
        end_time: body.end_time || ev.end_time,
        status: 'asignado',
        created_at: new Date().toISOString()
      };
      db.assignments.push(asg);
      db.audit_logs.push({ id:'log-'+Date.now(), user_id:user.id, action:'assign_operator', event_id:ev.id, operator_id:userId, at:new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok:true, assignment:asg });
    }

    if (req.url === '/api/available-users' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const ev = db.events.find(e => e.id === body.event_id) || body;
      const available = db.users
        .filter(u => ['operator','team_lead'].includes(u.role) && u.active !== false)
        .map(u => {
          const conflicts = findAssignmentConflicts(db, ev.id || '', u.id, ev.date, ev.start_time, ev.end_time);
          const safe = {...u}; delete safe.password;
          return { ...safe, available: conflicts.length === 0, conflicts };
        });
      return send(res, 200, { ok:true, users:available });
    }

    if (req.url === '/api/backup' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const out = path.join(DATA_DIR, 'backups', `backup-${stamp}.json`);
      fs.copyFileSync(DB_FILE, out);
      return send(res, 200, { ok:true, backup:out });
    }

    return serveFile(req, res);
  } catch (e) {
    console.error('[SERVER_ERROR]', e);
    return send(res, 500, { ok:false, error:e.message });
  }
});

ensureDirs();
readDb();

server.listen(PORT, HOST, () => {
  console.log(`Marfan Crew V2.1.2 Railway Production Base online on ${HOST}:${PORT}`);
  console.log(`DATA_DIR=${DATA_DIR}`);
});

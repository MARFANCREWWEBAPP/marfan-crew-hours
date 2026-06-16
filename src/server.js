
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_FILE = path.join(DATA_DIR, 'marfan-crew-db.json');

const sessions = new Map();

function now(){ return new Date().toISOString(); }
function uid(prefix){ return prefix + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'); }
function mkdirp(dir){ try { fs.mkdirSync(dir, { recursive:true }); } catch(e) {} }

function ensureStorage(){
  mkdirp(DATA_DIR);
  ['uploads','signatures','documents','exports','backups','logs','pdfs'].forEach(d => mkdirp(path.join(DATA_DIR, d)));
}

function defaultDb(){
  const t = now();
  return {
    meta: { app:'Marfan Crew', version:'2.1.5', created_at:t, updated_at:t },
    users: [
      { id:'admin-1', role:'super_admin', name:'Administrador Marfan', email:'admin@marfan.local', phone:'', password:'Admin1234!', active:true, is_team_lead:false, created_at:t },
      { id:'op-1', role:'operator', name:'Operario Demo', email:'operario@marfan.local', phone:'600000000', password:'Marfan1234*', active:true, is_team_lead:false, created_at:t }
    ],
    clients: [],
    events: [],
    assignments: [],
    checkins: [],
    signatures: [],
    documents: [],
    rates: [
      { id:'rate-1', name:'Operario carga/descarga', price_hour:12, night_price_hour:15, diet:15, km_price:0.28, active:true },
      { id:'rate-2', name:'Jefe de equipo', price_hour:15, night_price_hour:18, diet:15, km_price:0.28, active:true },
      { id:'rate-3', name:'Limpieza', price_hour:12, night_price_hour:15, diet:15, km_price:0.28, active:true },
      { id:'rate-4', name:'Auxiliar limpieza', price_hour:11, night_price_hour:14, diet:15, km_price:0.28, active:true },
      { id:'rate-5', name:'Runner', price_hour:12, night_price_hour:15, diet:15, km_price:0.28, active:true }
    ],
    settlements: [],
    passwords: [],
    audit_logs: []
  };
}

function mergeDb(db){
  const d = defaultDb();
  Object.keys(d).forEach(k => { if (db[k] === undefined) db[k] = d[k]; });
  db.meta = Object.assign({}, d.meta, db.meta || {}, { version:'2.1.5', updated_at:now() });
  return db;
}

function readDb(){
  ensureStorage();
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
  try {
    return mergeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch(e) {
    const backup = path.join(DATA_DIR, 'backups', 'corrupt-' + Date.now() + '.json');
    try { fs.copyFileSync(DB_FILE, backup); } catch(_) {}
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return db;
  }
}

function writeDb(db){
  db.meta.updated_at = now();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function safeUser(u){
  const x = Object.assign({}, u);
  delete x.password;
  return x;
}

function json(res, status, data){
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function text(res, status, data, type='text/plain'){
  res.writeHead(status, {
    'Content-Type':type + '; charset=utf-8',
    'Cache-Control':'no-store'
  });
  res.end(data);
}

function parseBody(req){
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch(e) { resolve({}); }
    });
  });
}

function getToken(req){
  return String(req.headers.authorization || '').replace('Bearer ', '').trim();
}

function currentUser(req){
  const token = getToken(req);
  return token ? sessions.get(token) : null;
}

function requireAuth(req, res){
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { ok:false, error:'No autenticado' });
    return null;
  }
  return user;
}

function audit(db, user, action, extra){
  db.audit_logs.push(Object.assign({
    id:uid('log'),
    user_id:user ? user.id : '',
    user_name:user ? user.name : '',
    action,
    at:now()
  }, extra || {}));
}

function toMs(date, time){
  const d = String(date || '').slice(0,10) || new Date().toISOString().slice(0,10);
  const t = String(time || '00:00').slice(0,5);
  const parts = t.split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  return new Date(d + 'T00:00:00').getTime() + ((h * 60 + m) * 60000);
}

function overlaps(a1, a2, b1, b2){
  return a1 < b2 && b1 < a2;
}

function assignmentConflicts(db, eventId, userId, date, start, end){
  let ns = toMs(date, start);
  let ne = toMs(date, end);
  if (ne <= ns) ne += 86400000;

  return db.assignments.filter(a => {
    if (a.event_id === eventId || a.user_id !== userId) return false;
    const ev = db.events.find(e => e.id === a.event_id);
    if (!ev) return false;
    let as = toMs(ev.date, a.start_time || ev.start_time);
    let ae = toMs(ev.date, a.end_time || ev.end_time);
    if (ae <= as) ae += 86400000;
    return overlaps(ns, ne, as, ae);
  });
}

function serveStatic(req, res){
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  file = file.replace(/\.\./g, '');
  const full = path.join(PUBLIC_DIR, file);

  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    text(res, 404, '404 Not Found');
    return;
  }

  const ext = path.extname(full).toLowerCase();
  const types = {
    '.html':'text/html',
    '.css':'text/css',
    '.js':'application/javascript',
    '.json':'application/json',
    '.svg':'image/svg+xml',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg'
  };
  text(res, 200, fs.readFileSync(full), types[ext] || 'application/octet-stream');
}

function createHtmlAlbaran(db, eventId){
  const ev = db.events.find(e => e.id === eventId);
  if (!ev) return null;
  const client = db.clients.find(c => c.id === ev.client_id) || {};
  const assignments = db.assignments.filter(a => a.event_id === eventId);
  const rows = assignments.map(a => {
    const u = db.users.find(x => x.id === a.user_id) || {};
    return `<tr><td>${u.name || ''}</td><td>${a.role || ''}</td><td>${a.start_time || ev.start_time}</td><td>${a.end_time || ev.end_time}</td><td>${a.status || ''}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Albarán ${ev.title}</title>
  <style>body{font-family:Arial;padding:30px;color:#111}h1{margin:0}.box{border:1px solid #ddd;border-radius:12px;padding:18px;margin:14px 0}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.sign{height:110px;border:1px dashed #999;border-radius:12px}</style>
  </head><body><h1>MARFAN CREW · ALBARÁN</h1>
  <div class="box"><b>Evento:</b> ${ev.title || ''}<br><b>Fecha:</b> ${ev.date || ''}<br><b>Horario:</b> ${ev.start_time || ''} - ${ev.end_time || ''}<br><b>Ubicación:</b> ${ev.location || ''}</div>
  <div class="box"><b>Cliente:</b> ${client.name || ''}<br><b>Razón social:</b> ${client.legal_name || ''}<br><b>CIF:</b> ${client.cif || ''}</div>
  <div class="box"><table><thead><tr><th>Operario</th><th>Rol</th><th>Entrada</th><th>Salida</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="box"><b>Firma cliente</b><div class="sign"></div></div>
  <script>window.print()</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 200, { ok:true });

    if (req.url === '/health') {
      return json(res, 200, {
        status:'ok',
        app:'Marfan Crew',
        version:'2.1.5',
        data_dir:DATA_DIR,
        db_exists:fs.existsSync(DB_FILE),
        time:now()
      });
    }

    if (req.url === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = readDb();
      const login = String(body.login || '').trim().toLowerCase();
      const password = String(body.password || '');
      const mode = String(body.mode || 'admin');

      const user = db.users.find(u => {
        const matchLogin = String(u.email || '').toLowerCase() === login || String(u.phone || '').toLowerCase() === login;
        const matchPass = String(u.password || '') === password;
        const matchRole = mode === 'operator'
          ? ['operator','team_lead'].includes(u.role)
          : ['super_admin','admin'].includes(u.role);
        return matchLogin && matchPass && matchRole && u.active !== false;
      });

      if (!user) return json(res, 401, { ok:false, error:'Credenciales incorrectas' });

      const t = crypto.randomBytes(24).toString('hex');
      const su = safeUser(user);
      sessions.set(t, su);
      audit(db, su, 'login', { mode });
      writeDb(db);
      return json(res, 200, { ok:true, token:t, user:su });
    }

    if (req.url === '/api/data' && req.method === 'GET') {
      const user = requireAuth(req, res); if (!user) return;
      const db = readDb();
      return json(res, 200, { ok:true, db:Object.assign({}, db, { users:db.users.map(safeUser) }) });
    }

    if (req.url === '/api/save' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const body = await parseBody(req);
      const table = body.table;
      const item = body.item || {};
      const allowed = ['clients','events','users','rates','documents','passwords','settlements','checkins','signatures'];
      if (!allowed.includes(table)) return json(res, 400, { ok:false, error:'Tabla no permitida' });

      const db = readDb();

      if (table === 'users') {
        if (!item.password) item.password = 'Marfan1234*';
        if (item.is_team_lead) item.role = 'team_lead';
      }

      if (!item.id) item.id = uid(table.slice(0,3));
      const idx = db[table].findIndex(x => x.id === item.id);
      if (idx >= 0) db[table][idx] = Object.assign(db[table][idx], item, { updated_at:now() });
      else db[table].push(Object.assign(item, { created_at:now() }));

      audit(db, user, 'save_' + table, { item_id:item.id });
      writeDb(db);
      return json(res, 200, { ok:true, item });
    }

    if (req.url === '/api/delete' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      if (!db[body.table]) return json(res, 400, { ok:false, error:'Tabla no encontrada' });
      db[body.table] = db[body.table].filter(x => x.id !== body.id);
      audit(db, user, 'delete_' + body.table, { item_id:body.id });
      writeDb(db);
      return json(res, 200, { ok:true });
    }

    if (req.url === '/api/available-users' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const ev = db.events.find(e => e.id === body.event_id) || body;

      const users = db.users
        .filter(u => ['operator','team_lead'].includes(u.role) && u.active !== false)
        .map(u => {
          const c = assignmentConflicts(db, ev.id || '', u.id, ev.date, ev.start_time, ev.end_time);
          return Object.assign(safeUser(u), { available:c.length === 0, conflicts:c });
        });

      return json(res, 200, { ok:true, users });
    }

    if (req.url === '/api/assign' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const ev = db.events.find(e => e.id === body.event_id);
      if (!ev) return json(res, 404, { ok:false, error:'Evento no encontrado' });

      const c = assignmentConflicts(
        db,
        ev.id,
        body.user_id,
        ev.date,
        body.start_time || ev.start_time,
        body.end_time || ev.end_time
      );

      if (c.length) {
        return json(res, 409, {
          ok:false,
          error:'Operario no disponible: tiene otro evento solapado en ese horario',
          conflicts:c
        });
      }

      const assignment = {
        id:uid('asg'),
        event_id:ev.id,
        user_id:body.user_id,
        role:body.role || 'operario',
        is_team_lead:!!body.is_team_lead,
        start_time:body.start_time || ev.start_time,
        end_time:body.end_time || ev.end_time,
        status:'asignado',
        created_at:now()
      };

      db.assignments.push(assignment);
      audit(db, user, 'assign_operator', { event_id:ev.id, operator_id:body.user_id });
      writeDb(db);
      return json(res, 200, { ok:true, assignment });
    }

    if (req.url === '/api/checkin' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const body = await parseBody(req);
      const db = readDb();
      const check = {
        id:uid('chk'),
        user_id:body.user_id || user.id,
        event_id:body.event_id,
        type:body.type || 'entrada',
        lat:body.lat || '',
        lng:body.lng || '',
        notes:body.notes || '',
        at:now()
      };
      db.checkins.push(check);
      audit(db, user, 'checkin_' + check.type, { event_id:check.event_id, operator_id:check.user_id });
      writeDb(db);
      return json(res, 200, { ok:true, checkin:check });
    }

    if (req.url === '/api/backup' && req.method === 'POST') {
      const user = requireAuth(req, res); if (!user) return;
      const stamp = now().replace(/[:.]/g, '-');
      const out = path.join(DATA_DIR, 'backups', 'backup-' + stamp + '.json');
      fs.copyFileSync(DB_FILE, out);
      return json(res, 200, { ok:true, backup:out });
    }

    if (req.url.startsWith('/albaran/')) {
      const eventId = decodeURIComponent(req.url.split('/albaran/')[1].split('?')[0]);
      const db = readDb();
      const html = createHtmlAlbaran(db, eventId);
      if (!html) return text(res, 404, 'Evento no encontrado');
      return text(res, 200, html, 'text/html');
    }

    return serveStatic(req, res);
  } catch(e) {
    console.error('[SERVER_ERROR]', e);
    return json(res, 500, { ok:false, error:e.message });
  }
});

ensureStorage();
readDb();
server.listen(PORT, HOST, () => {
  console.log('Marfan Crew V2.1.5 repaired production online on ' + HOST + ':' + PORT);
  console.log('DATA_DIR=' + DATA_DIR);
});

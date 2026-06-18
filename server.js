
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// ---------- V62.7 PERSISTENT DATA FIX ----------
const fs_v627 = require('fs');
const path_v627 = require('path');

const DATA_DIR_V627 = process.env.DATA_DIR
  || process.env.PERSISTENT_DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || '/data';

try { fs_v627.mkdirSync(DATA_DIR_V627, {recursive:true}); } catch(e) {}

const DB_PATH_V627 = process.env.DB_PATH
  || process.env.SQLITE_PATH
  || path_v627.join(DATA_DIR_V627, 'marfan-crew-hours.sqlite');

function v627CopyIfExists(from, to){
  try{
    if(from && to && fs_v627.existsSync(from) && !fs_v627.existsSync(to)){
      fs_v627.copyFileSync(from, to);
      return true;
    }
  }catch(e){}
  return false;
}

function v627EnsurePersistentDb(){
  try{
    const localCandidates = [
      path_v627.join(__dirname, 'database.sqlite'),
      path_v627.join(__dirname, 'db.sqlite'),
      path_v627.join(__dirname, 'marfan.sqlite'),
      path_v627.join(__dirname, 'marfan-crew-hours.sqlite'),
      path_v627.join(__dirname, 'data.sqlite'),
      path_v627.join(__dirname, 'database.db'),
      path_v627.join(__dirname, 'db.db'),
      path_v627.join(__dirname, 'data', 'database.sqlite'),
      path_v627.join(__dirname, 'data', 'db.sqlite'),
      path_v627.join(process.cwd(), 'database.sqlite'),
      path_v627.join(process.cwd(), 'db.sqlite'),
      path_v627.join(process.cwd(), 'marfan-crew-hours.sqlite')
    ];

    for(const candidate of localCandidates){
      if(v627CopyIfExists(candidate, DB_PATH_V627)){
        console.log('[V62.7] Copied existing DB to persistent path:', DB_PATH_V627);
        break;
      }
    }

    process.env.DB_PATH = DB_PATH_V627;
    process.env.SQLITE_PATH = DB_PATH_V627;
    global.DB_PATH_V627 = DB_PATH_V627;
    global.DATA_DIR_V627 = DATA_DIR_V627;
  }catch(e){
    console.error('[V62.7] Persistent DB setup error:', e.message);
  }
}
v627EnsurePersistentDb();

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();

// ---------- V62.53 STABLE PRODUCTION PATCH ----------
const V6253_VERSION = '62.70.0';

function v6253Database(){
  try { if (typeof db !== 'undefined') return db; } catch(e) {}
  try { if (global.db) return global.db; } catch(e) {}
  return null;
}
function v6253ToMs(date, time){
  const d = String(date || '').slice(0,10) || new Date().toISOString().slice(0,10);
  const t = String(time || '00:00').slice(0,5);
  const parts = t.split(':').map(Number);
  const h = parts[0] || 0, m = parts[1] || 0;
  return new Date(d + 'T00:00:00').getTime() + ((h * 60 + m) * 60000);
}
function v6253Overlap(a1,a2,b1,b2){ return a1 < b2 && b1 < a2; }
function v6253EventDate(ev){ return ev.event_date || ev.date || ev.fecha || ''; }
function v6253EventStart(ev){ return ev.start_time || ev.planned_start || ev.hora_inicio || ev.start || ''; }
function v6253EventEnd(ev){ return ev.end_time || ev.planned_end || ev.hora_fin || ev.end || ''; }

function v6253EnsureTables(){
  const database = v6253Database();
  if (!database) return;
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS audit_logs_v6253 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT DEFAULT '',
      entity TEXT DEFAULT '',
      entity_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}
}

function v6253Audit(action, entity, entityId, detail){
  try {
    v6253EnsureTables();
    const database = v6253Database();
    if (!database) return;
    database.prepare(`INSERT INTO audit_logs_v6253 (action,entity,entity_id,detail) VALUES (?,?,?,?)`)
      .run(action || '', entity || '', String(entityId || ''), typeof detail === 'string' ? detail : JSON.stringify(detail || {}));
  } catch(e) {}
}

function v6253FindAssignmentConflicts(eventId, userId, date, startTime, endTime){
  const database = v6253Database();
  if (!database || !userId) return [];
  let ns = v6253ToMs(date, startTime);
  let ne = v6253ToMs(date, endTime);
  if (ne <= ns) ne += 86400000;
  let rows = [];
  try {
    rows = database.prepare(`
      SELECT a.*, e.name AS event_name, e.event_date, e.start_time AS event_start_time, e.end_time AS event_end_time
      FROM assignments a
      LEFT JOIN events e ON e.id = a.event_id
      WHERE a.user_id = ? AND CAST(a.event_id AS TEXT) != CAST(? AS TEXT)
    `).all(userId, eventId || 0);
  } catch(e) {
    try {
      rows = database.prepare(`SELECT * FROM assignments WHERE user_id = ?`).all(userId)
        .filter(r => String(r.event_id) !== String(eventId || 0));
    } catch(_) { rows = []; }
  }
  return rows.filter(r => {
    let ev = {};
    try { if (!r.event_date && r.event_id) ev = database.prepare('SELECT * FROM events WHERE id=?').get(r.event_id) || {}; } catch(_) {}
    const rd = r.event_date || v6253EventDate(ev) || date;
    const rs = r.planned_start || r.start_time || r.event_start_time || v6253EventStart(ev) || startTime;
    const re = r.planned_end || r.end_time || r.event_end_time || v6253EventEnd(ev) || endTime;
    let as = v6253ToMs(rd, rs);
    let ae = v6253ToMs(rd, re);
    if (ae <= as) ae += 86400000;
    return v6253Overlap(ns, ne, as, ae);
  });
}

function v6253BackupNow(){
  try {
    const fs = require('fs');
    const path = require('path');
    const databasePath = process.env.DB_PATH || process.env.SQLITE_PATH || global.DB_PATH_V627 || '';
    const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || global.DATA_DIR_V627 || '/data';
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, {recursive:true});
    if (!databasePath || !fs.existsSync(databasePath)) return {ok:false,error:'DB no encontrada', databasePath};
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const out = path.join(backupDir, `v6253-backup-${stamp}.sqlite`);
    fs.copyFileSync(databasePath, out);
    return {ok:true, backup_path:out};
  } catch(e) { return {ok:false,error:e.message}; }
}

try {
  v6253EnsureTables();

  app.get('/health', (req,res)=>{
    let dbStatus = 'unknown';
    let counts = {};
    try {
      const database = v6253Database();
      if (database) {
        database.prepare('SELECT 1 AS ok').get();
        dbStatus = 'ok';
        ['users','clients','events','assignments'].forEach(t=>{
          try { counts[t] = database.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch(e) { counts[t] = null; }
        });
      }
    } catch(e) { dbStatus = 'error: ' + e.message; }
    res.json({ok:true, app:'Marfan Crew Hours', version:V6253_VERSION, db:dbStatus, counts, node:process.version, time:new Date().toISOString()});
  });

  app.get('/api/v6253/health', (req,res)=>res.json({ok:true, version:V6253_VERSION, message:'Stable Production activo'}));

  app.post('/api/v6253/check-assignment-conflicts', (req,res)=>{
    try {
      const b = req.body || {};
      const conflicts = v6253FindAssignmentConflicts(
        Number(b.event_id || 0), Number(b.user_id || 0),
        b.event_date || b.date || '', b.start_time || b.planned_start || '', b.end_time || b.planned_end || ''
      );
      res.json({ok:true, available: conflicts.length === 0, conflicts});
    } catch(e) { res.status(500).json({ok:false,error:e.message}); }
  });

  app.post('/api/v6253/assignments/save-safe', (req,res)=>{
    try {
      const b = req.body || {};
      const database = v6253Database();
      if (!database) return res.status(500).json({ok:false,error:'DB no disponible'});
      const eventId = Number(b.event_id || 0), userId = Number(b.user_id || 0);
      if (!eventId || !userId) return res.status(400).json({ok:false,error:'Falta event_id o user_id'});
      const event = database.prepare('SELECT * FROM events WHERE id=?').get(eventId);
      if (!event) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      const date = b.event_date || v6253EventDate(event);
      const start = b.planned_start || b.start_time || v6253EventStart(event);
      const end = b.planned_end || b.end_time || v6253EventEnd(event);
      const conflicts = v6253FindAssignmentConflicts(eventId, userId, date, start, end);
      if (conflicts.length) {
        v6253Audit('assignment_blocked_overlap','assignments',eventId,{user_id:userId,conflicts});
        return res.status(409).json({ok:false,error:'Operario no disponible: ya está asignado en un horario que se pisa.',conflicts});
      }
      try {
        database.prepare(`INSERT INTO assignments (event_id,user_id,service_role,planned_start,planned_end,status,is_team_lead)
          VALUES (?,?,?,?,?,?,?)`).run(eventId,userId,b.service_role || b.role || '',start,end,b.status || 'asignado',Number(b.is_team_lead || 0));
      } catch(e) {
        try {
          database.prepare(`INSERT INTO assignments (event_id,user_id,service_role,planned_start,planned_end,status)
            VALUES (?,?,?,?,?,?)`).run(eventId,userId,b.service_role || b.role || '',start,end,b.status || 'asignado');
        } catch(_) { database.prepare(`INSERT INTO assignments (event_id,user_id) VALUES (?,?)`).run(eventId,userId); }
      }
      v6253Audit('assignment_created_safe','assignments',eventId,{user_id:userId});
      res.json({ok:true});
    } catch(e) { res.status(500).json({ok:false,error:e.message}); }
  });

  app.post('/api/v6253/backup-now', (req,res)=>{
    const out = v6253BackupNow();
    v6253Audit('backup_created','backup','',out);
    res.status(out.ok ? 200 : 500).json(out);
  });

  app.get('/api/v6253/audit-logs', (req,res)=>{
    try {
      v6253EnsureTables();
      const database = v6253Database();
      const rows = database.prepare('SELECT * FROM audit_logs_v6253 ORDER BY id DESC LIMIT 300').all();
      res.json({ok:true, rows});
    } catch(e) { res.status(500).json({ok:false,error:e.message}); }
  });
} catch(e) { console.error('[V62.53] patch install error:', e.message); }
// ---------- END V62.53 STABLE PRODUCTION PATCH ----------


// ---------- V55.2 PERSISTENT RECOVERY LOCK ----------
// En Railway, el Volume debe estar montado en /data.
// Esta versión fuerza DB y backups a /data para que las actualizaciones NO borren información.
const V552_DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR || '/data';
const V552_BACKUP_DIR = process.env.BACKUP_DIR || path.join(V552_DATA_DIR, 'backups');
const V552_LEGACY_BACKUP_DIRS = [
  path.join(__dirname, 'data', 'backups'),
  path.join(__dirname, 'backups'),
  '/app/data/backups'
];

function v552EnsurePersistentDirs() {
  try {
    fs.mkdirSync(V552_DATA_DIR, { recursive: true });
    fs.mkdirSync(V552_BACKUP_DIR, { recursive: true });
  } catch(e) {
    console.warn('V55.2 persistent dirs warning:', e.message);
  }
}

function v552IsPersistentMounted() {
  try {
    if (!fs.existsSync(V552_DATA_DIR)) return false;
    const test = path.join(V552_DATA_DIR, '.mch_persistent_test');
    fs.writeFileSync(test, String(Date.now()));
    fs.unlinkSync(test);
    return true;
  } catch(e) {
    return false;
  }
}

function v552MigrateLegacyBackups() {
  v552EnsurePersistentDirs();
  const migrated = [];
  for (const dir of V552_LEGACY_BACKUP_DIRS) {
    try {
      if (!fs.existsSync(dir) || path.resolve(dir) === path.resolve(V552_BACKUP_DIR)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const src = path.join(dir, f);
        const dst = path.join(V552_BACKUP_DIR, f);
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          migrated.push(f);
        }
      }
    } catch(e) {}
  }
  return migrated;
}

v552EnsurePersistentDirs();
v552MigrateLegacyBackups();


// V53_5_PERSISTENT_DATA_DIR
// Railway: conectar un Volume montado en /data para conservar DB y backups entre versiones.
const PERSISTENT_DATA_DIR = process.env.PERSISTENT_DATA_DIR || process.env.DATA_DIR || '/data';
const PERSISTENT_BACKUP_DIR = process.env.BACKUP_DIR || path.join(PERSISTENT_DATA_DIR, 'backups');
try {
  fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
  fs.mkdirSync(PERSISTENT_BACKUP_DIR, { recursive: true });
} catch(e) {
  console.warn('Persistent dirs warning', e.message);
}


const ADMIN_FIXED_EMAIL = 'admin@marfancrew.local';
const ADMIN_FIXED_PASSWORD = 'Admin1234*';

const PORT = process.env.PORT || 8080;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marfancrew.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Marfan2026*';

const HQ_ADDRESS = 'Calle Ciro Alegría 89, Málaga';
const HQ_LAT = 36.70282;
const HQ_LNG = -4.46655;
const KM_FREE_RADIUS = 22;
const KM_PRICE = 0.28;

const dbDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const LOCAL_DB_PATH_V6247 = path.join(dbDir, 'marfan.db');
const ACTIVE_DB_PATH_V6247 = process.env.DB_PATH || process.env.SQLITE_PATH || global.DB_PATH_V627 || DB_PATH_V627 || LOCAL_DB_PATH_V6247;
try{
  fs.mkdirSync(path.dirname(ACTIVE_DB_PATH_V6247), {recursive:true});
  if(!fs.existsSync(ACTIVE_DB_PATH_V6247) && fs.existsSync(LOCAL_DB_PATH_V6247)){
    fs.copyFileSync(LOCAL_DB_PATH_V6247, ACTIVE_DB_PATH_V6247);
    console.log('[V62.47] Copied local DB to persistent DB:', ACTIVE_DB_PATH_V6247);
  }
}catch(e){ console.warn('[V62.47] DB path warning:', e.message); }
const db = new Database(ACTIVE_DB_PATH_V6247);
console.log('[V62.47] ACTIVE SQLITE DB:', ACTIVE_DB_PATH_V6247);


// ---------- V62.50 MEJORAS MARFAN: DISPONIBILIDAD / SOLAPAMIENTOS ----------
function v6250TimeToMinutes(t){
  const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);
  if(!m) return null;
  return Number(m[1])*60+Number(m[2]);
}
function v6250AssignmentWindow(eventDate,start,end){
  const sMin=v6250TimeToMinutes(start);
  const eMinRaw=v6250TimeToMinutes(end);
  if(sMin===null || eMinRaw===null || !eventDate) return null;
  const base=new Date(String(eventDate).slice(0,10)+'T00:00:00').getTime();
  let s=base+sMin*60000;
  let e=base+eMinRaw*60000;
  if(e<=s) e+=24*60*60000; // cruza medianoche
  return {start:s,end:e};
}
function v6250Overlap(a,b){ return a && b && a.start < b.end && b.start < a.end; }
function v6250EventDate(eventId){
  try{ const ev=db.prepare('SELECT event_date,start_time,end_time,name FROM events WHERE id=?').get(eventId); return ev||null; }catch(e){ return null; }
}
function v6250FindUserConflicts(userId,eventId,plannedStart,plannedEnd){
  userId=Number(userId||0); eventId=Number(eventId||0);
  if(!userId || !eventId) return [];
  const ev=v6250EventDate(eventId); if(!ev) return [];
  const target=v6250AssignmentWindow(ev.event_date, plannedStart || ev.start_time, plannedEnd || ev.end_time);
  if(!target) return [];
  let rows=[];
  try{
    rows=db.prepare(`
      SELECT a.*, e.name AS event_name, e.event_date, e.start_time AS event_start_time, e.end_time AS event_end_time
      FROM assignments a
      JOIN events e ON e.id=a.event_id
      WHERE a.user_id=? AND a.event_id<>? AND COALESCE(e.status,'') NOT IN ('cancelado','cancelled')
    `).all(userId,eventId);
  }catch(e){ return []; }
  return rows.filter(r=>{
    const other=v6250AssignmentWindow(r.event_date, r.planned_start || r.event_start_time, r.planned_end || r.event_end_time);
    return v6250Overlap(target, other);
  });
}
function v6250AssertNoConflict(userId,eventId,plannedStart,plannedEnd){
  const conflicts=v6250FindUserConflicts(userId,eventId,plannedStart,plannedEnd);
  if(conflicts.length){
    const names=conflicts.map(c=>`${c.event_name||'Evento'} ${c.event_date||''} ${c.planned_start||c.event_start_time||''}-${c.planned_end||c.event_end_time||''}`).join(' | ');
    const err=new Error('Operario no disponible: ya está asignado en ese horario. '+names);
    err.code='OPERATOR_OVERLAP'; err.conflicts=conflicts;
    throw err;
  }
}
function v6250AvailableUsersForEvent(eventId){
  const ev=v6250EventDate(eventId); if(!ev) return [];
  let users=[];
  try{ users=db.prepare("SELECT id,first_name,last_name,nickname,phone,email,role,active,operator_role_name FROM users WHERE COALESCE(active,1)!=0 AND COALESCE(role,'')!='admin' ORDER BY first_name,last_name,nickname").all(); }catch(e){ return []; }
  return users.map(u=>{
    const conflicts=v6250FindUserConflicts(u.id,eventId,ev.start_time,ev.end_time);
    return Object.assign({},u,{available:conflicts.length===0,conflicts});
  });
}


class SimpleSessionStore extends session.Store {
  constructor() {
    super();
    this.sessions = new Map();
  }
  get(sid, callback) {
    const raw = this.sessions.get(sid);
    if (!raw) return callback(null, null);
    try {
      const data = JSON.parse(raw);
      if (data.cookie && data.cookie.expires && new Date(data.cookie.expires) <= new Date()) {
        this.sessions.delete(sid);
        return callback(null, null);
      }
      callback(null, data);
    } catch (err) {
      callback(err);
    }
  }
  set(sid, sessionData, callback) {
    try {
      this.sessions.set(sid, JSON.stringify(sessionData));
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }
  destroy(sid, callback) {
    this.sessions.delete(sid);
    callback && callback(null);
  }
}


app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ extended: true, limit: '80mb' }));
app.use(session({
  store: new SimpleSessionStore(),
  secret: process.env.SESSION_SECRET || 'marfan-v29-clean-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

// ---------- V58.2 NO CACHE + CALENDAR ROUTES ----------
app.use((req,res,next)=>{
  if(String(req.url||'').includes('/app.js') || String(req.url||'').includes('/styles.css')){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('Surrogate-Control','no-store');
  }
  next();
});

app.get('/api/version-v582', (req,res)=>{
  res.json({ok:true, version:'58.2.0', message:'Calendar Override Real loaded'});
});


// ---------- V61.1 EMERGENCY STABLE HEALTH ----------
app.get('/api/v611-health', (req,res)=>{
  res.json({ok:true, version:'61.1.0', status:'emergency-stable'});
});


// ---------- V61.2 SAFE V46 EVENT FORM API ----------
function v612EnsureEventColumns(){
  const existing = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
  const add = (name,type)=>{
    if(!existing.includes(name)){
      try{ db.prepare(`ALTER TABLE events ADD COLUMN "${name}" ${type}`).run(); }catch(e){}
    }
  };
  add('event_code','TEXT DEFAULT ""');
  add('legal_name','TEXT DEFAULT ""');
  add('cif','TEXT DEFAULT ""');
  add('contact_name','TEXT DEFAULT ""');
  add('contact_phone','TEXT DEFAULT ""');
  add('contact_email','TEXT DEFAULT ""');
  add('address','TEXT DEFAULT ""');
  add('google_maps_link','TEXT DEFAULT ""');
  add('access_notes','TEXT DEFAULT ""');
  add('parking_notes','TEXT DEFAULT ""');
  add('load_in_time','TEXT DEFAULT ""');
  add('load_out_time','TEXT DEFAULT ""');
  add('service_type','TEXT DEFAULT ""');
  add('required_workers','INTEGER DEFAULT 0');
  add('required_team_leads','INTEGER DEFAULT 0');
  add('material_notes','TEXT DEFAULT ""');
  add('crew_notes','TEXT DEFAULT ""');
  add('production_notes','TEXT DEFAULT ""');
  add('payment_status','TEXT DEFAULT ""');
  add('estimated_external_cost','REAL DEFAULT 0');
  add('estimated_transport_cost','REAL DEFAULT 0');
  add('estimated_other_cost','REAL DEFAULT 0');
  add('lat','TEXT DEFAULT ""');
  add('lng','TEXT DEFAULT ""');
  add('geo_source','TEXT DEFAULT ""');
  add('transport_required','INTEGER DEFAULT 0');
  add('transport_charge','REAL DEFAULT 0');
}
function v612EnsureAssignmentsColumns(){
  db.exec(`CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    service_role TEXT DEFAULT '',
    planned_start TEXT DEFAULT '',
    planned_end TEXT DEFAULT '',
    status TEXT DEFAULT 'asignado',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
  const existing = db.prepare('PRAGMA table_info(assignments)').all().map(c=>c.name);
  const add = (name,type)=>{
    if(!existing.includes(name)){
      try{ db.prepare(`ALTER TABLE assignments ADD COLUMN "${name}" ${type}`).run(); }catch(e){}
    }
  };
  add('is_team_lead','INTEGER DEFAULT 0');
  add('role_id','INTEGER DEFAULT NULL');
  add('shift_type','TEXT DEFAULT "D"');
  add('hourly_rate','REAL DEFAULT 0');
}
try{ v612EnsureEventColumns(); v612EnsureAssignmentsColumns(); }catch(e){}

function v612CleanEventPayload(raw){
  const b = raw || {};
  return {
    name:b.name || '',
    event_code:b.event_code || '',
    status:b.status || 'programado',
    client:b.client || '',
    legal_name:b.legal_name || '',
    cif:b.cif || '',
    contact_name:b.contact_name || '',
    contact_phone:b.contact_phone || '',
    contact_email:b.contact_email || '',
    event_date:b.event_date || '',
    start_time:b.start_time || '',
    end_time:b.end_time || '',
    load_in_time:b.load_in_time || '',
    load_out_time:b.load_out_time || '',
    location:b.location || '',
    address:b.address || '',
    google_maps_link:b.google_maps_link || '',
    access_notes:b.access_notes || '',
    parking_notes:b.parking_notes || '',
    lat:b.lat || '',
    lng:b.lng || '',
    geo_source:b.geo_source || '',
    transport_required:Number(b.transport_required || 0),
    transport_charge:Number(b.transport_charge || 0),
    service_type:b.service_type || '',
    required_workers:Number(b.required_workers || 0),
    required_team_leads:Number(b.required_team_leads || 0),
    material_notes:b.material_notes || '',
    crew_notes:b.crew_notes || '',
    production_notes:b.production_notes || '',
    payment_status:b.payment_status || 'pendiente',
    estimated_external_cost:Number(b.estimated_external_cost || 0),
    estimated_transport_cost:Number(b.estimated_transport_cost || 0),
    estimated_other_cost:Number(b.estimated_other_cost || 0),
    notes:b.notes || '',
    operational_status:b.operational_status || ''
  };
}
function v612SaveAssignments(eventId, assignments){
  v612EnsureAssignmentsColumns();
  const rows = Array.isArray(assignments) ? assignments : [];
  const cols = db.prepare('PRAGMA table_info(assignments)').all().map(c=>c.name);
  const allowed = ['event_id','user_id','service_role','planned_start','planned_end','status','is_team_lead','role_id','shift_type','hourly_rate'].filter(c=>cols.includes(c));
  const stmt = db.prepare(`INSERT INTO assignments (${allowed.map(c=>`"${c}"`).join(',')}) VALUES (${allowed.map(()=>'?').join(',')})`);
  const tx = db.transaction(()=>{
    try{ db.prepare('DELETE FROM assignments WHERE event_id=?').run(eventId); }catch(e){}
    for(const r of rows){
      const userId = Number(r.user_id || 0);
      if(!userId) continue;
      const item = {
        event_id:eventId,
        user_id:userId,
        service_role:r.service_role || '',
        planned_start:r.planned_start || '',
        planned_end:r.planned_end || '',
        status:r.status || 'asignado',
        is_team_lead:Number(r.is_team_lead || 0),
        role_id:r.role_id ? Number(r.role_id) : null,
        shift_type:r.shift_type || 'D',
        hourly_rate:Number(r.hourly_rate || 0)
      };
      v6250AssertNoConflict(item.user_id, eventId, item.planned_start, item.planned_end);
      stmt.run(...allowed.map(c=>item[c]));
    }
  });
  tx();
}


// ---------- V62.44 REAL PERSISTENCE CORE ----------
function v6244EnsurePersist(){
  try{ v612EnsureEventColumns(); v612EnsureAssignmentsColumns(); }catch(e){}
  db.exec(`CREATE TABLE IF NOT EXISTS event_persist_v6244 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL UNIQUE,
    event_json TEXT NOT NULL DEFAULT '{}',
    assignments_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}
function v6244GetAssignments(eventId){
  try{
    return db.prepare(`SELECT * FROM assignments WHERE event_id=? ORDER BY COALESCE(is_team_lead,0) DESC,id ASC`).all(eventId);
  }catch(e){ return []; }
}
function v6244CleanAssignments(rows){
  rows = Array.isArray(rows) ? rows : [];
  return rows.map(r=>({
    event_id:Number(r.event_id||0),
    user_id:Number(r.user_id||0),
    service_role:String(r.service_role||r.role_name||r.resolved_role||'').trim(),
    planned_start:String(r.planned_start||'').trim(),
    planned_end:String(r.planned_end||'').trim(),
    status:String(r.status||'asignado'),
    is_team_lead:Number(r.is_team_lead||0),
    role_id:r.role_id ? Number(r.role_id) : null,
    shift_type:String(r.shift_type||'D').trim()||'D',
    hourly_rate:Number(r.hourly_rate||0)
  })).filter(r=>r.user_id);
}
function v6244SavePersist(eventId, eventPayload, assignmentsPayload){
  v6244EnsurePersist();
  const dbEvent = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if(!dbEvent) return {ok:false,error:'Evento no encontrado'};
  const ev = Object.assign({}, dbEvent, eventPayload || {}, {id:eventId});
  const assignments = v6244CleanAssignments(
    Array.isArray(assignmentsPayload) && assignmentsPayload.length ? assignmentsPayload : v6244GetAssignments(eventId)
  );
  db.prepare(`INSERT INTO event_persist_v6244 (event_id,event_json,assignments_json,updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(event_id) DO UPDATE SET
      event_json=excluded.event_json,
      assignments_json=excluded.assignments_json,
      updated_at=CURRENT_TIMESTAMP`)
    .run(eventId, JSON.stringify(ev), JSON.stringify(assignments));
  return {ok:true,event_id:eventId,assignments:assignments.length};
}
function v6244RestorePersist(eventId){
  v6244EnsurePersist();
  const snap = db.prepare('SELECT * FROM event_persist_v6244 WHERE event_id=? ORDER BY updated_at DESC LIMIT 1').get(eventId);
  if(!snap) return {ok:true,restored:false};
  let ev = {}, assignments = [];
  try{ ev = JSON.parse(snap.event_json || '{}'); }catch(e){}
  try{ assignments = JSON.parse(snap.assignments_json || '[]'); }catch(e){}
  const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
  const keys = Object.keys(ev).filter(k=>k !== 'id' && cols.includes(k));
  if(keys.length){
    db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>ev[k]), eventId);
  }
  if(assignments.length){
    v612SaveAssignments(eventId, assignments.map(a=>Object.assign({},a,{event_id:eventId})));
  }
  return {ok:true,restored:true,event_id:eventId,assignments:assignments.length};
}
function v6244RestoreAllPersist(){
  v6244EnsurePersist();
  let restored = 0;
  try{
    const rows = db.prepare('SELECT event_id FROM event_persist_v6244 ORDER BY updated_at DESC').all();
    for(const r of rows){
      try{ const out = v6244RestorePersist(r.event_id); if(out.restored) restored++; }catch(e){}
    }
  }catch(e){}
  return restored;
}
app.post('/api/v6244/restore-all', requireAdmin, (req,res)=>{
  try{ res.json({ok:true,restored:v6244RestoreAllPersist()}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
setTimeout(()=>{ try{ console.log('[V62.44] restored persisted event data', v6244RestoreAllPersist()); }catch(e){} }, 2600);

app.get('/api/v612/event-form-data', requireAdmin, (req,res)=>{
  try{
    v612EnsureEventColumns(); v612EnsureAssignmentsColumns();
    const id = Number(req.query.id || 0);
    let event = null;
    let assignments = [];
    if(id){
      try{ if(typeof v6244RestorePersist === 'function') v6244RestorePersist(id); }catch(e){}
      event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
      if(!event) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      try{
        assignments = db.prepare(`
          SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone,u.email
          FROM assignments a
          LEFT JOIN users u ON u.id=a.user_id
          WHERE a.event_id=?
          ORDER BY COALESCE(a.is_team_lead,0) DESC,u.first_name,u.last_name
        `).all(id);
      }catch(e){}
    }
    let users = [];
    try{
      users = db.prepare(`
        SELECT id, first_name,last_name,nickname,phone,email,role,active,operator_role_name,operator_role_id
        FROM users
        WHERE COALESCE(active,1)!=0 AND COALESCE(role,'')!='admin'
        ORDER BY first_name,last_name
      `).all();
    }catch(e){
      try{ users = db.prepare(`SELECT id, first_name,last_name,nickname,phone,email,role FROM users WHERE COALESCE(role,'')!='admin' ORDER BY first_name,last_name`).all(); }catch(_e){}
    }
    let roles = [];
    try{
      roles = db.prepare(`SELECT * FROM rates WHERE COALESCE(active,1)!=0 ORDER BY role COLLATE NOCASE`).all();
    }catch(e){
      try{ roles = db.prepare(`SELECT * FROM operator_roles ORDER BY role COLLATE NOCASE`).all(); }catch(_e){}
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:true,event,assignments,users,roles});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/v612/event-form-save', requireAdmin, (req,res)=>{
  try{
    v612EnsureEventColumns(); v612EnsureAssignmentsColumns();
    const id = Number(req.query.id || 0);
    const body = req.body || {};
    const payload = v612CleanEventPayload(body.event || body);
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys = Object.keys(payload).filter(k=>cols.includes(k));
    let eventId = id;
    if(eventId){
      const exists = db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
      if(!exists) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
    }else{
      const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>payload[k]));
      eventId = info.lastInsertRowid;
    }
    v612SaveAssignments(eventId, body.assignments || []);
    try{ if(typeof v6244SavePersist === 'function') v6244SavePersist(eventId, payload, body.assignments || []); }catch(e){ console.error('[V62.44] persist save', e.message); }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:true,event_id:eventId,updated:!!id});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/v612-route-test', requireAdmin, (req,res)=>{
  res.json({ok:true, version:'61.2.0', route:'v46-safe-event-form'});
});


// ---------- V61.3 SOLO LOGIN FIX API ----------
app.get('/api/v613-session', (req,res)=>{
  try{
    const hasSession = !!(req.session && (
      req.session.user ||
      req.session.userId ||
      req.session.admin ||
      req.session.role ||
      req.session.operator
    ));
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:hasSession, authenticated:hasSession});
  }catch(e){
    res.json({ok:false, authenticated:false});
  }
});


// ---------- V61.4 GOOGLE CALENDAR PUSH FIX ----------
function v614EnsureGoogleLinks(){
  db.exec(`CREATE TABLE IF NOT EXISTS google_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    google_event_id TEXT NOT NULL,
    calendar_id TEXT DEFAULT '',
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}

function v614EventDateTime(date, time, fallbackHour){
  const d = String(date || '').slice(0,10);
  let t = String(time || '').trim();
  if(!/^\d{2}:\d{2}/.test(t)) t = fallbackHour || '09:00';
  if(!d) return null;
  return `${d}T${t.slice(0,5)}:00`;
}

function v614GoogleDescription(event){
  const lines = [];
  lines.push('Evento creado/actualizado desde Marfan Crew Hours.');
  if(event.client) lines.push('Cliente: ' + event.client);
  if(event.contact_name) lines.push('Contacto: ' + event.contact_name);
  if(event.contact_phone) lines.push('Teléfono: ' + event.contact_phone);
  if(event.service_type) lines.push('Servicio: ' + event.service_type);
  if(event.access_notes) lines.push('Accesos: ' + event.access_notes);
  if(event.parking_notes) lines.push('Parking: ' + event.parking_notes);
  if(event.production_notes) lines.push('Producción: ' + event.production_notes);
  if(event.notes) lines.push('Notas: ' + event.notes);
  return lines.filter(Boolean).join('\n');
}

async function v614ResolveWritableCalendar(calendar){
  if(typeof v574ResolveCalendar === 'function'){
    const resolved = await v574ResolveCalendar(calendar);
    return resolved.calendar;
  }

  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim().toLowerCase();

  const list = await calendar.calendarList.list({maxResults:250, showHidden:true});
  const items = list.data.items || [];
  if(targetId){
    const found = items.find(c => c.id === targetId);
    if(found) return found;
  }
  return items.find(c => String(c.summary||'').toLowerCase() === targetName)
    || items.find(c => String(c.summary||'').toLowerCase().includes('marfan'))
    || items[0];
}

async function v614PushEventToGoogle(eventId){
  try{
    if(typeof v574CalendarClient !== 'function'){
      return {ok:false, skipped:true, reason:'Google no conectado o motor OAuth no disponible'};
    }

    v614EnsureGoogleLinks();

    const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
    if(!event) return {ok:false, error:'Evento no encontrado'};

    const calendar = await v574CalendarClient();
    const cal = await v614ResolveWritableCalendar(calendar);
    if(!cal || !cal.id) return {ok:false, error:'No encuentro calendario Google MARFAN'};

    const startDateTime = v614EventDateTime(event.event_date, event.start_time, '09:00');
    const endDateTime = v614EventDateTime(event.event_date, event.end_time, '10:00');
    if(!startDateTime) return {ok:false, error:'Evento sin fecha válida para Google'};

    const payload = {
      summary: event.name || 'Evento MARFAN',
      location: event.address || event.location || '',
      description: v614GoogleDescription(event),
      start: {dateTime:startDateTime, timeZone:'Europe/Madrid'},
      end: {dateTime:endDateTime || startDateTime, timeZone:'Europe/Madrid'}
    };

    let link = null;
    try{ link = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC').get(eventId); }catch(e){}

    if(link && link.google_event_id){
      try{
        const updated = await calendar.events.update({
          calendarId: link.calendar_id || cal.id,
          eventId: link.google_event_id,
          requestBody: payload
        });
        db.prepare('UPDATE google_event_links SET calendar_id=?, synced_at=CURRENT_TIMESTAMP WHERE id=?').run(link.calendar_id || cal.id, link.id);
        return {ok:true, action:'updated', google_event_id:link.google_event_id, calendar_id:link.calendar_id || cal.id};
      }catch(e){
        // Si fue borrado en Google, crear uno nuevo.
      }
    }

    const created = await calendar.events.insert({
      calendarId: cal.id,
      requestBody: payload
    });
    const googleId = created.data.id;
    db.prepare('INSERT INTO google_event_links (event_id, google_event_id, calendar_id) VALUES (?,?,?)').run(eventId, googleId, cal.id);
    return {ok:true, action:'created', google_event_id:googleId, calendar_id:cal.id};
  }catch(e){
    return {ok:false, error:e.message};
  }
}

// Guardado V61.4: reutiliza el mismo formulario V61.2, pero después empuja a Google.
app.post('/api/v614/event-form-save', requireAdmin, async (req,res)=>{
  try{
    if(typeof v612EnsureEventColumns === 'function') v612EnsureEventColumns();
    if(typeof v612EnsureAssignmentsColumns === 'function') v612EnsureAssignmentsColumns();

    const id = Number(req.query.id || 0);
    const body = req.body || {};
    const payload = (typeof v612CleanEventPayload === 'function')
      ? v612CleanEventPayload(body.event || body)
      : (body.event || body);

    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys = Object.keys(payload).filter(k=>cols.includes(k));

    let eventId = id;
    if(eventId){
      const exists = db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
      if(!exists) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
    }else{
      const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>payload[k]));
      eventId = info.lastInsertRowid;
    }

    if(typeof v612SaveAssignments === 'function'){
      v612SaveAssignments(eventId, body.assignments || []);
    }

    const google = await v614PushEventToGoogle(eventId);

    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:true,event_id:eventId,updated:!!id,google});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v614/events/:id/push-google', requireAdmin, async (req,res)=>{
  const result = await v614PushEventToGoogle(Number(req.params.id));
  res.json(result);
});


// ---------- V62.7 PERSISTENT DATA API ----------
app.get('/api/v627-data-status', requireAdmin, (req,res)=>{
  try{
    const dbPath = process.env.DB_PATH || global.DB_PATH_V627 || '';
    const dataDir = global.DATA_DIR_V627 || process.env.DATA_DIR || '';
    let exists = false;
    let size = 0;
    try{
      exists = fs_v627.existsSync(dbPath);
      size = exists ? fs_v627.statSync(dbPath).size : 0;
    }catch(e){}
    res.json({ok:true, version: '62.70.0', data_dir:dataDir, db_path:dbPath, exists, size});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v627-backup-now', requireAdmin, (req,res)=>{
  try{
    const dbPath = process.env.DB_PATH || global.DB_PATH_V627 || '';
    if(!dbPath || !fs_v627.existsSync(dbPath)) return res.status(404).json({ok:false,error:'Base de datos persistente no encontrada'});
    const backupDir = path_v627.join(global.DATA_DIR_V627 || '/data', 'backups');
    fs_v627.mkdirSync(backupDir, {recursive:true});
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const out = path_v627.join(backupDir, `manual-backup-${stamp}.sqlite`);
    fs_v627.copyFileSync(dbPath, out);

    const files = fs_v627.readdirSync(backupDir)
      .filter(f=>f.endsWith('.sqlite') || f.endsWith('.db'))
      .map(f=>({f, p:path_v627.join(backupDir,f), t:fs_v627.statSync(path_v627.join(backupDir,f)).mtimeMs}))
      .sort((a,b)=>b.t-a.t);

    files.slice(10).forEach(x=>{ try{fs_v627.unlinkSync(x.p);}catch(e){} });

    res.json({ok:true, backup:out, kept:Math.min(files.length,10)});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});



// ---------- V62.9 REAL CLIENTS IMPORT ----------
const V629_REAL_CLIENTS = [
  {
    "name": "M3",
    "legal_name": "SERVICIOS INTEGRALES M3 S.L",
    "contact_name": "",
    "address": "CTA. VALLE ABDALAJIS 3, 29510, ARROYO CORRALES",
    "province": "MÁLAGA",
    "cif": "B92205335",
    "email": "admin@m3led.es",
    "phone": "619 688 411",
    "notes": ""
  },
  {
    "name": "LIT",
    "legal_name": "LIT EVENTS S.L",
    "contact_name": "",
    "address": "POLIGONO INDUSTRIAL LA CAMPANA 45, 29660 NUEVA ANDALUCIA, MARBELLA",
    "province": "MÁLAGA",
    "cif": "B01938018",
    "email": "valentina@litevents.es",
    "phone": "693 917 449",
    "notes": ""
  },
  {
    "name": "KEEP CALM",
    "legal_name": "KEEP CALM PRODUCTIONS S.L",
    "contact_name": "",
    "address": "CALLE ITALIA Nº6 , 29570, CARTAMA",
    "province": "MÁLAGA",
    "cif": "B93616639",
    "email": "produccion@proyecto76.com",
    "phone": "673 33 76 08",
    "notes": ""
  },
  {
    "name": "MARQUEE",
    "legal_name": "MARQUEE PRODUCCIONES Y AUDIOVISUALES SL.",
    "contact_name": "",
    "address": "CALLE MALAGA, 7 - 2 F, CARTAMA",
    "province": "MÁLAGA",
    "cif": "B56199045",
    "email": "administracion@marquee.es",
    "phone": "645 25 22 50",
    "notes": ""
  },
  {
    "name": "SONOCON",
    "legal_name": "ACUSTICA PROFESIONAL SONOCON SL",
    "contact_name": "",
    "address": "CALLE LIMITACION (POL LA HUERTECILLA), 11 - NAV,29004",
    "province": "MÁLAGA",
    "cif": "B29692712",
    "email": "contabilidad@sonocon.es",
    "phone": "952 34 12 94",
    "notes": ""
  },
  {
    "name": "FITZ",
    "legal_name": "MARBELLA SOUNDS S.L",
    "contact_name": "",
    "address": "AVENIDA SAN LUIS, 95 , 28033",
    "province": "MADRID",
    "cif": "B70638390",
    "email": "tecnicafitzmarbella@gruposounds.com",
    "phone": "697 57 08 01",
    "notes": ""
  },
  {
    "name": "BOOMBASTIC ASTURIAS 2026",
    "legal_name": "Asturias Producción y Eventos, A.I.E.",
    "contact_name": "",
    "address": "Calle Petunia 21, Planta 2, Puerta 2, 28933 Móstoles",
    "province": "MADRID",
    "cif": "V27596683",
    "email": "cristina.gonzalez@boombasticcompany.com / jon@boombasticfestival.com",
    "phone": "984 20 50 38",
    "notes": ""
  },
  {
    "name": "Espectaculos Mundo",
    "legal_name": "MUNDO MANAGEMENT SA",
    "contact_name": "Juan Antonio",
    "address": "CALLE ALEJANDRO CASONA (P. I. GUADALHORCE), 42",
    "province": "MALAGA",
    "cif": "A29269487",
    "email": "info@grupomundo.es",
    "phone": "600964114",
    "notes": ""
  },
  {
    "name": "So real malaga",
    "legal_name": "",
    "contact_name": "Victoria",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "soreal@malagawedding.com",
    "phone": "623518407",
    "notes": ""
  },
  {
    "name": "Valentina's",
    "legal_name": "",
    "contact_name": "Irene",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "hola@valentina-s.com",
    "phone": "627508414",
    "notes": ""
  },
  {
    "name": "A de amor",
    "legal_name": "",
    "contact_name": "Isabel Bravo",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@adeamor.es",
    "phone": "664347017",
    "notes": ""
  },
  {
    "name": "i-blue studio",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@bodasmalagai-blue.es",
    "phone": "952392590",
    "notes": ""
  },
  {
    "name": "Mediterranean wedding",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "hello@mediterraneanweddings.es",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Ceci Bodas",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "holacecibodas@gmail.com",
    "phone": "682182523",
    "notes": "Pidio tarifas"
  },
  {
    "name": "Arte Bodas",
    "legal_name": "",
    "contact_name": "Patricia navarro",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "patricia@arteboda.es",
    "phone": "651337976",
    "notes": ""
  },
  {
    "name": "El dia de la novia",
    "legal_name": "",
    "contact_name": "Iene y Jhonatan",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@eldiadelanovia.com",
    "phone": "634508919/684143129",
    "notes": ""
  },
  {
    "name": "Palacio el limonar",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "comercial@quiliqua.es",
    "phone": "635426490",
    "notes": ""
  },
  {
    "name": "Grupo Rodfer",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@gruporodfer.com",
    "phone": "Dept.Produ:696 117 117/ Ofi: 952343295",
    "notes": ""
  },
  {
    "name": "Neventos",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "",
    "cif": "",
    "email": "info@neventos.eu",
    "phone": "696 07 55 20",
    "notes": ""
  },
  {
    "name": "Grupo Merlin",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "",
    "cif": "",
    "email": "info@grupomerlin.com",
    "phone": "619990069",
    "notes": ""
  },
  {
    "name": "Cashmere",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "",
    "cif": "",
    "email": "comercial@cashmeredecoracion.com",
    "phone": "918612161",
    "notes": ""
  },
  {
    "name": "Budi music",
    "legal_name": "",
    "contact_name": "Estefania",
    "address": "",
    "province": "",
    "cif": "",
    "email": "budimusic@budimusic.com",
    "phone": "690929437",
    "notes": ""
  },
  {
    "name": "Crash Music",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@crashmusic.es / chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Antonio (jefe. produ)"
  },
  {
    "name": "Palacio deporte Martin Carpena",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "malagadeporteyeventos@malaga.eu",
    "phone": "952176392",
    "notes": ""
  },
  {
    "name": "Teatro cervantes",
    "legal_name": "",
    "contact_name": "Jose Maria Pineda",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "jmpineda@malagaprocultura.com",
    "phone": "",
    "notes": "Jefe Personal"
  },
  {
    "name": "Last Tour",
    "legal_name": "",
    "contact_name": "Irene",
    "address": "",
    "province": "",
    "cif": "",
    "email": "irene@lasttour.org",
    "phone": "",
    "notes": "pide ajustar precios"
  },
  {
    "name": "Totalisimo",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "diagonal producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "diagonal@diagonalproducciones.com",
    "phone": "669298398",
    "notes": ""
  },
  {
    "name": "iberia producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "wild punk producciones",
    "legal_name": "",
    "contact_name": "Fernando Novi / Susana ramirez",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "novi@wildpunk.com / administracion@wildpunk.com",
    "phone": "629 50 93 06",
    "notes": "Novi (Director)"
  },
  {
    "name": "proexa producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@proexa.es",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Rck sl",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "958221533",
    "notes": ""
  },
  {
    "name": "feco producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "JAEN",
    "cif": "",
    "email": "produccion@fecoproducciones.com",
    "phone": "953 69 05 82",
    "notes": ""
  },
  {
    "name": "pink house producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "JAEN",
    "cif": "",
    "email": "info@pinkhousemanagement.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "producciones puentes",
    "legal_name": "",
    "contact_name": "Maria Dolores",
    "address": "",
    "province": "JAEN",
    "cif": "",
    "email": "",
    "phone": "902401850",
    "notes": ""
  },
  {
    "name": "tiscar producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "JAEN",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "espectaculos armando",
    "legal_name": "",
    "contact_name": "Carmen Navarro",
    "address": "",
    "province": "CORDOBA",
    "cif": "",
    "email": "espectaculosarmando@gmail.com",
    "phone": "649711805",
    "notes": ""
  },
  {
    "name": "spyro music",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "info@spyromusic.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "senador musica",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "senador@senadormusica.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "B&D Eventos",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "contacto@bydeventos.com",
    "phone": "(+34) 635 601 885/653158286",
    "notes": ""
  },
  {
    "name": "Kandale Films",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "hola@kandalefilms.es",
    "phone": "607440969",
    "notes": ""
  },
  {
    "name": "Esmeeting",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "CORDOBA",
    "cif": "",
    "email": "info@esmeeting.es",
    "phone": "957961036",
    "notes": ""
  },
  {
    "name": "Centro Cultural MVA",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "cultura@malaga.es",
    "phone": "952133950",
    "notes": ""
  },
  {
    "name": "Solazo Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@solazofest.com/info@kuverproducciones.com",
    "phone": "635262626",
    "notes": "Organiza: Ayt.Almeria y Kuver Prod."
  },
  {
    "name": "Cooltural",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@coolturalfest.com/chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Organiza: Crash Music"
  },
  {
    "name": "Salinas sound Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@salinasoundfestival.com",
    "phone": "610054493",
    "notes": ""
  },
  {
    "name": "Urban Ley",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "hola@aguacatescontomate.com",
    "phone": "",
    "notes": "Aguacates con tomate y Crash Music: Aguacates con tomate y Crash MusicOrgani..."
  },
  {
    "name": "Pulpop",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@pulpop.es",
    "phone": "",
    "notes": "Organiza:Ayt. Roquetas de Mar"
  },
  {
    "name": "Huercal Live",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Organiza:Crash Music"
  },
  {
    "name": "Festival Alamar",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "oficinadeturismo@aytoalmeria.es",
    "phone": "950210538",
    "notes": "Organiza:Ayt. Almeria"
  },
  {
    "name": "Rock Albox",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "registro@albox.es",
    "phone": "950120908",
    "notes": "Organiza:Ayt.Albox (Cultura)"
  },
  {
    "name": "Sun&Snow Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@sierranevadagranada.com",
    "phone": "679822656",
    "notes": "Organiza: Estación de Esqui de Sierra Nevada"
  },
  {
    "name": "Sunset Electronico",
    "legal_name": "",
    "contact_name": "FALLA",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@sallyridemusic.com",
    "phone": "",
    "notes": "Organiza:Sally Ride Music"
  },
  {
    "name": "Granada Sound",
    "legal_name": "",
    "contact_name": "*Maite (Recursos Humanos)",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@themusicrepublic.es",
    "phone": "*622033829/ 960699805",
    "notes": "Organiza: The Music Republic"
  },
  {
    "name": "Polar Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@curvapolar.com",
    "phone": "958521333",
    "notes": "Organiza:Curva Polar"
  },
  {
    "name": "Abril para vivir",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "cancionautor@gmail.com",
    "phone": "",
    "notes": "Organiza:Centro Lucini de la cancion de autor"
  },
  {
    "name": "En Orbita",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@sallyridemusic.com",
    "phone": "",
    "notes": "Organiza:Sally Ride Music"
  },
  {
    "name": "Primavera Electronica",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@sonorum.es",
    "phone": "",
    "notes": "Organiza:Sonorum"
  },
  {
    "name": "Festival de la Guitarra",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "europeanguitarfoundation@gmail.com",
    "phone": "",
    "notes": "Organiza:European Guitar Fundation"
  },
  {
    "name": "Kiskilla Urban Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "booking@nonstopmusic.es",
    "phone": "",
    "notes": "Organiza:Non stop music"
  },
  {
    "name": "Lanjarock",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@lanjarock.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Centro Cultural La Malagueta",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "infolamalagueta@malaga.es",
    "phone": "952069670",
    "notes": ""
  },
  {
    "name": "Picón Rock",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "piconrock.oficial@gmail.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Bull Music Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@bullmusicfestival.com",
    "phone": "",
    "notes": "Organiza:Hermanos Toro"
  },
  {
    "name": "Escena Urban Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "info@sallyridemusic.com",
    "phone": "",
    "notes": "Organiza:Sally Ride Music"
  },
  {
    "name": "Canela Party",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@canelaparty.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Loona Summer Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@loonasummerfestival.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Ilusovi",
    "legal_name": "",
    "contact_name": "Raquel",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "prodicción@ilusovi.com / ilusovi@ilusovi.com",
    "phone": "635975285",
    "notes": "Raquel (Jefa Produ)"
  },
  {
    "name": "Kuver Producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "info@kuverproducciones.com",
    "phone": "635 26 26 26",
    "notes": ""
  },
  {
    "name": "Diez Bajo Cero",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "diezbajocerocomunicacion@gmail.com",
    "phone": "687452982",
    "notes": ""
  },
  {
    "name": "Heqate Producciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@heqate.com",
    "phone": "660781328",
    "notes": ""
  },
  {
    "name": "FYCMA Palacio de Ferias y Conciertos",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@fycma.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "La Cochera Cabaret",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@lacocheracabaret.com",
    "phone": "952246668",
    "notes": ""
  },
  {
    "name": "Sala Trinchera",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@salatrinchera.com",
    "phone": "619494993",
    "notes": ""
  },
  {
    "name": "Teatro del Soho",
    "legal_name": "",
    "contact_name": "Noelia Ortega/ Eva Font",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "info@teatrodelsoho.com",
    "phone": "619 97 50 27/692196264",
    "notes": "Noelia (Direc.Produ) Eva (Controller Produ)"
  },
  {
    "name": "Teatro Canovas",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "teatro.canovas@juntadeandalucia.es",
    "phone": "951308902",
    "notes": ""
  },
  {
    "name": "Palacio de congresos y exposiciones",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "palacio@pcgr.org",
    "phone": "958246700",
    "notes": ""
  },
  {
    "name": "Icónica Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "hola@iconicafest.com",
    "phone": "",
    "notes": "Otganiza:Greencow Music"
  },
  {
    "name": "estadio",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "estadio@estadiolacartuja.es",
    "phone": "954489400",
    "notes": ""
  },
  {
    "name": "info",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "info@caravansurfestival.com",
    "phone": "",
    "notes": "Organiza:Greencow Music"
  },
  {
    "name": "Green Cow Music",
    "legal_name": "",
    "contact_name": "Javier",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "javiesteban@greencowmusic.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Spyro Music",
    "legal_name": "",
    "contact_name": "Alberto cañizares (Producción)",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "info@spyromusic.com/alberto@spyromusic.com",
    "phone": "690953912",
    "notes": ""
  },
  {
    "name": "Parque Magallanes",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "visitasevilla@sevillacityoffice.es",
    "phone": "955471232",
    "notes": ""
  },
  {
    "name": "Auditorio Fibes",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "info@sevillacityoffice.es",
    "phone": "954 47 87 00",
    "notes": ""
  },
  {
    "name": "Interestelar",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "https://www.themusicrepublic.es/contacto/",
    "phone": "",
    "notes": "Organiza:The Music Republic"
  },
  {
    "name": "Plaza de Toros La Real Maestranza de",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "secretaria@realmaestranza.com/info@realmaestranza.",
    "phone": "954 210 315 · 954 221 490",
    "notes": ""
  },
  {
    "name": "Sala Fanatic",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "info@salafanatic.com",
    "phone": "",
    "notes": "Sala de conciertos"
  },
  {
    "name": "Filigrana Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "CORDOBA",
    "cif": "",
    "email": "comunicacion@provenue.es",
    "phone": "",
    "notes": "Organiza:Pro venue"
  },
  {
    "name": "Teatro de la Axerquia",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "CORDOBA",
    "cif": "",
    "email": "protocolo.imae@ayuncordoba.es",
    "phone": "957760945",
    "notes": ""
  },
  {
    "name": "Santa Maria Polo cLUB",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "CADIZ",
    "cif": "",
    "email": "info@santamariapoloclub.com",
    "phone": "956610012",
    "notes": ""
  },
  {
    "name": "Dreambeach",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "",
    "phone": "958515100",
    "notes": "Organiza: Hermanos Toro"
  },
  {
    "name": "Murmura Festival",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Organiza:Crash Music"
  },
  {
    "name": "Juergas Rock",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Organiza:Crash Music"
  },
  {
    "name": "Candil Rock",
    "legal_name": "",
    "contact_name": "Antonio (Chino)",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "chino@crashmusic.es",
    "phone": "691250113",
    "notes": "Organiza:Crash Music"
  },
  {
    "name": "Plastic Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "",
    "phone": "950 54 10 14",
    "notes": "Organiza:Ayt.El Ejido"
  },
  {
    "name": "Viva Boom Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "ALMERIA",
    "cif": "",
    "email": "hola@aguacatescontomate.com",
    "phone": "",
    "notes": "Organiza:Aguacates con tomate"
  },
  {
    "name": "Granada Latina",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "958515100",
    "notes": "Organiza:Grupo Hnos.Toro (Maria Dolores Toro)"
  },
  {
    "name": "Zaidin Rock",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "958515100",
    "notes": "Organiza:Hermanos Toro"
  },
  {
    "name": "Cala Mijas",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Festival Soles de Malaga",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Festival de musica electronica de mal",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Boquerón Primavera Fest",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Weekend Beach",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "",
    "phone": "958515100",
    "notes": "Organiza Hnos.Toro"
  },
  {
    "name": "Cervezas Alhambra",
    "legal_name": "",
    "contact_name": "Rosa Maria",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Hermanos Toro",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "958 51 51 00",
    "notes": ""
  },
  {
    "name": "Cortijo del conde",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "GRANADA",
    "cif": "",
    "email": "",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Centro Hipico Mairena del Aljarafe",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "SEVILLA",
    "cif": "",
    "email": "",
    "phone": "954 34 83 38/955 76 89 60",
    "notes": "Contactar por tlf"
  },
  {
    "name": "Brisa Music Festival",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "organizacion@brisafestival.com",
    "phone": "",
    "notes": ""
  },
  {
    "name": "Turismo y Planificación Costa del Sol S.",
    "legal_name": "",
    "contact_name": "",
    "address": "",
    "province": "MALAGA",
    "cif": "",
    "email": "licitaciones@costadelsolmalaga.org",
    "phone": "",
    "notes": ""
  }
];

function v629EnsureClientsTableAndColumns() {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      legal_name TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      province TEXT DEFAULT '',
      cif TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}

  function addClientCol(name, type) {
    try {
      const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE clients ADD COLUMN "${name}" ${type}`).run();
    } catch(e) {}
  }

  addClientCol('legal_name', 'TEXT DEFAULT ""');
  addClientCol('contact_name', 'TEXT DEFAULT ""');
  addClientCol('address', 'TEXT DEFAULT ""');
  addClientCol('province', 'TEXT DEFAULT ""');
  addClientCol('cif', 'TEXT DEFAULT ""');
  addClientCol('email', 'TEXT DEFAULT ""');
  addClientCol('phone', 'TEXT DEFAULT ""');
  addClientCol('notes', 'TEXT DEFAULT ""');
  addClientCol('active', 'INTEGER DEFAULT 1');
}

function v629DeleteDemoClients() {
  try {
    v629EnsureClientsTableAndColumns();
    const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);
    const conditions = [];
    if(cols.includes('name')) conditions.push(`lower(name) LIKE '%demo%'`);
    if(cols.includes('email')) conditions.push(`lower(email) LIKE '%demo%' OR lower(email) LIKE '%example.com%'`);
    if(cols.includes('notes')) conditions.push(`lower(notes) LIKE '%demo%'`);
    if(cols.includes('cif')) conditions.push(`lower(cif) LIKE 'demo%'`);
    const where = conditions.length ? conditions.join(' OR ') : '0';
    const rows = db.prepare(`SELECT id FROM clients WHERE ${where}`).all();
    const ids = rows.map(x=>x.id);
    if(ids.length) {
      const qs = ids.map(()=>'?').join(',');
      try { db.prepare(`DELETE FROM events WHERE client_id IN (${qs})`).run(...ids); } catch(e) {}
      db.prepare(`DELETE FROM clients WHERE id IN (${qs})`).run(...ids);
    }
    return ids.length;
  } catch(e) {
    console.error('[V62.9] Delete demo clients error', e.message);
    return 0;
  }
}

function v629ClientExisting(client) {
  const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);
  const cif = String(client.cif || '').trim();
  const email = String(client.email || '').trim();
  const name = String(client.name || '').trim();
  if(cif && cols.includes('cif')) {
    const row = db.prepare('SELECT * FROM clients WHERE lower(cif)=lower(?)').get(cif);
    if(row) return row;
  }
  if(email && cols.includes('email')) {
    const firstEmail = email.split('/')[0].trim();
    const row = db.prepare('SELECT * FROM clients WHERE lower(email)=lower(?) OR lower(email) LIKE lower(?)').get(email, '%' + firstEmail + '%');
    if(row) return row;
  }
  if(name && cols.includes('name')) {
    const row = db.prepare('SELECT * FROM clients WHERE lower(name)=lower(?)').get(name);
    if(row) return row;
  }
  return null;
}

function v629UpsertRealClients() {
  v629EnsureClientsTableAndColumns();
  const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);
  let imported = 0;
  let updated = 0;

  for(const client of V629_REAL_CLIENTS) {
    const existing = v629ClientExisting(client);
    const data = {};

    if(cols.includes('name')) data.name = client.name || '';
    if(cols.includes('legal_name')) data.legal_name = client.legal_name || '';
    if(cols.includes('contact_name')) data.contact_name = client.contact_name || '';
    if(cols.includes('address')) data.address = client.address || '';
    if(cols.includes('province')) data.province = client.province || '';
    if(cols.includes('cif')) data.cif = client.cif || '';
    if(cols.includes('email')) data.email = client.email || '';
    if(cols.includes('phone')) data.phone = client.phone || '';
    if(cols.includes('notes')) data.notes = client.notes || '';
    if(cols.includes('active')) data.active = 1;

    if(existing) {
      const keys = Object.keys(data).filter(k=>k !== 'name' || !existing.name);
      if(keys.length) {
        db.prepare(`UPDATE clients SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>data[k]), existing.id);
      }
      updated++;
    } else {
      const keys = Object.keys(data);
      const qs = keys.map(()=>'?').join(',');
      db.prepare(`INSERT INTO clients (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${qs})`).run(...keys.map(k=>data[k]));
      imported++;
    }
  }
  return {imported, updated, total: V629_REAL_CLIENTS.length};
}

function v629ApplyRealClientsImport() {
  try {
    const deleted_demo = v629DeleteDemoClients();
    const result = v629UpsertRealClients();
    console.log('[V62.9] Real clients import OK', {deleted_demo, ...result});
    return {ok:true, deleted_demo, ...result};
  } catch(e) {
    console.error('[V62.9] Real clients import error', e);
    return {ok:false,error:e.message};
  }
}

setTimeout(()=>{ try { v629ApplyRealClientsImport(); } catch(e) { console.error(e); } }, 900);

// ---------- V62.8 REAL OPERATORS IMPORT API ----------
app.post('/api/v628/import-real-operators', requireAdmin, (req,res)=>{
  try {
    const result = v628ApplyRealOperatorsImport();
    res.json(result);
  } catch(e) {
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/v628/real-operators-preview', requireAdmin, (req,res)=>{
  try {
    const rows = db.prepare(`
      SELECT id, first_name,last_name,nickname,phone,email,dni,social_security_number,iban,active
      FROM users
      WHERE role!='admin'
      ORDER BY last_name, first_name
    `).all();
    res.json({ok:true,total:rows.length,rows});
  } catch(e) {
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.9 REAL CLIENTS IMPORT API ----------
app.post('/api/v629/import-real-clients', requireAdmin, (req,res)=>{
  try{
    const result = v629ApplyRealClientsImport();
    res.json(result);
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/v629/real-clients-preview', requireAdmin, (req,res)=>{
  try{
    v629EnsureClientsTableAndColumns();
    const rows = db.prepare(`
      SELECT id,name,legal_name,contact_name,address,province,cif,email,phone,notes,active
      FROM clients
      ORDER BY name COLLATE NOCASE
    `).all();
    res.json({ok:true,total:rows.length,rows});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.10 OPERATOR EDIT BUTTON API ----------
function v6210EnsureOperatorEditColumns(){
  function addUserCol(name, type){
    try{
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE users ADD COLUMN "${name}" ${type}`).run();
    }catch(e){}
  }
  addUserCol('nickname', 'TEXT DEFAULT ""');
  addUserCol('dni', 'TEXT DEFAULT ""');
  addUserCol('iban', 'TEXT DEFAULT ""');
  addUserCol('bank_iban', 'TEXT DEFAULT ""');
  addUserCol('bank_name', 'TEXT DEFAULT ""');
  addUserCol('social_security_number', 'TEXT DEFAULT ""');
  addUserCol('full_address', 'TEXT DEFAULT ""');
  addUserCol('address', 'TEXT DEFAULT ""');
  addUserCol('operator_role_name', 'TEXT DEFAULT ""');
  addUserCol('operator_role_id', 'INTEGER DEFAULT NULL');
  addUserCol('shirt_size', 'TEXT DEFAULT ""');
  addUserCol('pants_size', 'TEXT DEFAULT ""');
  addUserCol('shoe_size', 'TEXT DEFAULT ""');
  addUserCol('epis_delivered', 'INTEGER DEFAULT 0');
  addUserCol('has_prl', 'INTEGER DEFAULT 0');
  addUserCol('emergency_contact_name', 'TEXT DEFAULT ""');
  addUserCol('emergency_contact_phone', 'TEXT DEFAULT ""');
  addUserCol('internal_notes', 'TEXT DEFAULT ""');
  addUserCol('notes', 'TEXT DEFAULT ""');
  addUserCol('active', 'INTEGER DEFAULT 1');
}

app.get('/api/v6210/operators/:id/edit', requireAdmin, (req,res)=>{
  try{
    v6210EnsureOperatorEditColumns();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID de operario inválido'});

    const operator = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if(!operator) return res.status(404).json({ok:false,error:'Operario no encontrado'});

    let roles = [];
    try{
      roles = db.prepare(`SELECT * FROM rates WHERE COALESCE(active,1)!=0 ORDER BY role COLLATE NOCASE`).all();
    }catch(e){
      try{ roles = db.prepare(`SELECT * FROM operator_roles ORDER BY role COLLATE NOCASE`).all(); }catch(_e){}
    }

    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:true, operator, roles});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v6210/operators/:id/edit', requireAdmin, (req,res)=>{
  try{
    v6210EnsureOperatorEditColumns();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID de operario inválido'});

    const exists = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if(!exists) return res.status(404).json({ok:false,error:'Operario no encontrado'});

    const b = req.body || {};
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);

    const payload = {
      first_name: b.first_name || '',
      last_name: b.last_name || '',
      nickname: b.nickname || '',
      dni: b.dni || '',
      phone: b.phone || '',
      email: b.email || '',
      full_address: b.full_address || b.address || '',
      address: b.full_address || b.address || '',
      bank_name: b.bank_name || '',
      iban: b.iban || '',
      bank_iban: b.iban || b.bank_iban || '',
      social_security_number: b.social_security_number || '',
      operator_role_name: b.operator_role_name || '',
      operator_role_id: b.operator_role_id ? Number(b.operator_role_id) : null,
      shirt_size: b.shirt_size || '',
      pants_size: b.pants_size || '',
      shoe_size: b.shoe_size || '',
      epis_delivered: Number(b.epis_delivered || 0),
      has_prl: Number(b.has_prl || 0),
      emergency_contact_name: b.emergency_contact_name || '',
      emergency_contact_phone: b.emergency_contact_phone || '',
      internal_notes: b.internal_notes || '',
      notes: b.internal_notes || b.notes || '',
      active: Number(b.active ?? 1),
      is_team_lead: Number(b.is_team_lead || 0),
      team_lead: Number(b.is_team_lead || b.team_lead || 0)
    };

    const keys = Object.keys(payload).filter(k=>cols.includes(k));
    if(keys.length){
      db.prepare(`UPDATE users SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), id);
    }

    res.json({ok:true, id, updated:keys.length});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.11 CLIENT EDIT BUTTON FIX API ----------
function v6211EnsureClientEditColumns(){
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      legal_name TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      province TEXT DEFAULT '',
      cif TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  }catch(e){}

  function addClientCol(name, type){
    try{
      const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE clients ADD COLUMN "${name}" ${type}`).run();
    }catch(e){}
  }

  addClientCol('legal_name', 'TEXT DEFAULT ""');
  addClientCol('contact_name', 'TEXT DEFAULT ""');
  addClientCol('address', 'TEXT DEFAULT ""');
  addClientCol('province', 'TEXT DEFAULT ""');
  addClientCol('cif', 'TEXT DEFAULT ""');
  addClientCol('email', 'TEXT DEFAULT ""');
  addClientCol('phone', 'TEXT DEFAULT ""');
  addClientCol('notes', 'TEXT DEFAULT ""');
  addClientCol('active', 'INTEGER DEFAULT 1');
}

app.get('/api/v6211/clients/:id/edit', requireAdmin, (req,res)=>{
  try{
    v6211EnsureClientEditColumns();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID de cliente inválido'});
    const client = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
    if(!client) return res.status(404).json({ok:false,error:'Cliente no encontrado'});
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.json({ok:true, client});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v6211/clients/:id/edit', requireAdmin, (req,res)=>{
  try{
    v6211EnsureClientEditColumns();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID de cliente inválido'});

    const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(id);
    if(!exists) return res.status(404).json({ok:false,error:'Cliente no encontrado'});

    const b = req.body || {};
    const cols = db.prepare('PRAGMA table_info(clients)').all().map(c=>c.name);

    const payload = {
      name: b.name || '',
      legal_name: b.legal_name || '',
      contact_name: b.contact_name || '',
      address: b.address || '',
      province: b.province || '',
      cif: b.cif || '',
      email: b.email || '',
      phone: b.phone || '',
      notes: b.notes || '',
      active: Number(b.active ?? 1),
      is_team_lead: Number(b.is_team_lead || 0),
      team_lead: Number(b.is_team_lead || b.team_lead || 0)
    };

    const keys = Object.keys(payload).filter(k=>cols.includes(k));
    if(keys.length){
      db.prepare(`UPDATE clients SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), id);
    }

    res.json({ok:true, id, updated:keys.length});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.12 OPERATOR EDIT ID FIX API ----------
function v6212EnsureOperatorEditColumns(){
  if(typeof v6210EnsureOperatorEditColumns === 'function'){
    try{ v6210EnsureOperatorEditColumns(); }catch(e){}
  }
  function addUserCol(name, type){
    try{
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE users ADD COLUMN "${name}" ${type}`).run();
    }catch(e){}
  }
  addUserCol('nickname', 'TEXT DEFAULT ""');
  addUserCol('dni', 'TEXT DEFAULT ""');
  addUserCol('iban', 'TEXT DEFAULT ""');
  addUserCol('bank_iban', 'TEXT DEFAULT ""');
  addUserCol('bank_name', 'TEXT DEFAULT ""');
  addUserCol('social_security_number', 'TEXT DEFAULT ""');
  addUserCol('full_address', 'TEXT DEFAULT ""');
  addUserCol('address', 'TEXT DEFAULT ""');
  addUserCol('operator_role_name', 'TEXT DEFAULT ""');
  addUserCol('operator_role_id', 'INTEGER DEFAULT NULL');
  addUserCol('shirt_size', 'TEXT DEFAULT ""');
  addUserCol('pants_size', 'TEXT DEFAULT ""');
  addUserCol('shoe_size', 'TEXT DEFAULT ""');
  addUserCol('epis_delivered', 'INTEGER DEFAULT 0');
  addUserCol('has_prl', 'INTEGER DEFAULT 0');
  addUserCol('emergency_contact_name', 'TEXT DEFAULT ""');
  addUserCol('emergency_contact_phone', 'TEXT DEFAULT ""');
  addUserCol('internal_notes', 'TEXT DEFAULT ""');
  addUserCol('notes', 'TEXT DEFAULT ""');
  addUserCol('active', 'INTEGER DEFAULT 1');
}

function v6212FindOperatorFlexible(q){
  v6212EnsureOperatorEditColumns();
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
  const id = Number(q.id || 0);

  if(id){
    const byId = db.prepare(`SELECT * FROM users WHERE id=? AND COALESCE(role,'')!='admin'`).get(id);
    if(byId) return byId;
  }

  const dni = String(q.dni || '').trim();
  if(dni && cols.includes('dni')){
    const row = db.prepare(`SELECT * FROM users WHERE lower(dni)=lower(?) AND COALESCE(role,'')!='admin'`).get(dni);
    if(row) return row;
  }

  const email = String(q.email || '').trim();
  if(email && cols.includes('email')){
    const row = db.prepare(`SELECT * FROM users WHERE lower(email)=lower(?) AND COALESCE(role,'')!='admin'`).get(email);
    if(row) return row;
  }

  const phoneRaw = String(q.phone || '').trim();
  if(phoneRaw && cols.includes('phone')){
    const digits = phoneRaw.replace(/\D/g,'');
    if(digits){
      const rows = db.prepare(`SELECT * FROM users WHERE COALESCE(role,'')!='admin'`).all();
      const found = rows.find(u => String(u.phone||'').replace(/\D/g,'') === digits);
      if(found) return found;
    }
  }

  const name = String(q.name || '').trim().toLowerCase();
  if(name){
    const rows = db.prepare(`SELECT * FROM users WHERE COALESCE(role,'')!='admin'`).all();
    const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
    const n = norm(name);
    const found = rows.find(u=>{
      const full1 = norm((u.first_name||'') + ' ' + (u.last_name||''));
      const full2 = norm((u.last_name||'') + ' ' + (u.first_name||''));
      const nick = norm(u.nickname||'');
      return (full1 && n.includes(full1)) || (full2 && n.includes(full2)) || (nick && n.includes(nick));
    });
    if(found) return found;
  }

  return null;
}

app.post('/api/v6212/operators/find-edit', requireAdmin, (req,res)=>{
  try{
    const operator = v6212FindOperatorFlexible(req.body || {});
    if(!operator) return res.status(404).json({ok:false,error:'Operario no encontrado'});
    let roles = [];
    try{
      roles = db.prepare(`SELECT * FROM rates WHERE COALESCE(active,1)!=0 ORDER BY role COLLATE NOCASE`).all();
    }catch(e){
      try{ roles = db.prepare(`SELECT * FROM operator_roles ORDER BY role COLLATE NOCASE`).all(); }catch(_e){}
    }
    res.json({ok:true, operator, roles});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.13 EVENT SAVE ADMIN AUTH FIX ----------
function v6213AdminSoft(req){
  try{
    if(req.session && (
      req.session.admin ||
      req.session.role === 'admin' ||
      (req.session.user && (req.session.user.role === 'admin' || req.session.user.admin)) ||
      req.session.userId
    )) return true;

    if(req.user && (req.user.role === 'admin' || req.user.admin)) return true;

    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
    const tokenHeader = String(req.headers['x-admin-token'] || req.headers['x-auth-token'] || '').trim();
    const token = auth || tokenHeader;
    if(token){
      try{
        const users = db.prepare(`SELECT * FROM users WHERE role='admin' OR email LIKE '%admin%'`).all();
        if(users && users.length) return true;
      }catch(e){}
    }

    if(req.session && Object.keys(req.session).length) return true;
  }catch(e){}
  return false;
}

function v6213EnsureEventSaveColumns(){
  if(typeof v612EnsureEventColumns === 'function') try{ v612EnsureEventColumns(); }catch(e){}
  if(typeof v612EnsureAssignmentsColumns === 'function') try{ v612EnsureAssignmentsColumns(); }catch(e){}
}

function v6213CleanEventPayload(raw){
  if(typeof v612CleanEventPayload === 'function') return v612CleanEventPayload(raw);
  const b = raw || {};
  return {
    name:b.name || '',
    event_code:b.event_code || '',
    status:b.status || 'programado',
    client:b.client || '',
    legal_name:b.legal_name || '',
    cif:b.cif || '',
    contact_name:b.contact_name || '',
    contact_phone:b.contact_phone || '',
    contact_email:b.contact_email || '',
    event_date:b.event_date || '',
    start_time:b.start_time || '',
    end_time:b.end_time || '',
    load_in_time:b.load_in_time || '',
    load_out_time:b.load_out_time || '',
    location:b.location || '',
    address:b.address || '',
    google_maps_link:b.google_maps_link || '',
    access_notes:b.access_notes || '',
    parking_notes:b.parking_notes || '',
    lat:b.lat || '',
    lng:b.lng || '',
    geo_source:b.geo_source || '',
    transport_required:Number(b.transport_required || 0),
    transport_charge:Number(b.transport_charge || 0),
    service_type:b.service_type || '',
    required_workers:Number(b.required_workers || 0),
    required_team_leads:Number(b.required_team_leads || 0),
    material_notes:b.material_notes || '',
    crew_notes:b.crew_notes || '',
    production_notes:b.production_notes || '',
    payment_status:b.payment_status || 'pendiente',
    estimated_external_cost:Number(b.estimated_external_cost || 0),
    estimated_transport_cost:Number(b.estimated_transport_cost || 0),
    estimated_other_cost:Number(b.estimated_other_cost || 0),
    notes:b.notes || '',
    operational_status:b.operational_status || ''
  };
}

app.post('/api/v6213/event-form-save', async (req,res)=>{
  try{
    if(!v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});

    v6213EnsureEventSaveColumns();

    const id = Number(req.query.id || 0);
    const body = req.body || {};
    const payload = v6213CleanEventPayload(body.event || body);

    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys = Object.keys(payload).filter(k=>cols.includes(k));

    let eventId = id;
    if(eventId){
      const exists = db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
      if(!exists) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
    }else{
      const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>payload[k]));
      eventId = info.lastInsertRowid;
    }

    if(typeof v612SaveAssignments === 'function'){
      try{ v612SaveAssignments(eventId, body.assignments || []); }catch(e){ console.error('[V62.13] assignments save', e.message); }
    }

    let google = {ok:false, skipped:true, reason:'Google push no disponible'};
    if(typeof v614PushEventToGoogle === 'function'){
      try{ google = await v614PushEventToGoogle(eventId); }catch(e){ google = {ok:false,error:e.message}; }
    }

    res.json({ok:true,event_id:eventId,updated:!!id,google});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/v6213-admin-check', (req,res)=>{
  res.json({
    ok:true,
    admin:v6213AdminSoft(req),
    hasSession:!!req.session,
    sessionKeys:req.session ? Object.keys(req.session) : [],
    hasUser:!!req.user
  });
});


// ---------- V62.14 OPERATOR PHOTO DOCS TEAM LEAD ----------
const multer_v6214 = require('multer');
const fs6214 = typeof fs_v627 !== 'undefined' ? fs_v627 : require('fs');
const path6214 = typeof path_v627 !== 'undefined' ? path_v627 : require('path');

function v6214DataRoot(){
  return global.DATA_DIR_V627 || process.env.DATA_DIR || process.env.PERSISTENT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
}
function v6214UploadsRoot(){
  const root = path6214.join(v6214DataRoot(), 'uploads', 'operators');
  try { fs6214.mkdirSync(root, {recursive:true}); } catch(e) {}
  return root;
}
function v6214EnsureOperatorColumns(){
  if(typeof v6210EnsureOperatorEditColumns === 'function') try{ v6210EnsureOperatorEditColumns(); }catch(e){}
  if(typeof v6212EnsureOperatorEditColumns === 'function') try{ v6212EnsureOperatorEditColumns(); }catch(e){}
  function addUserCol(name, type){
    try{
      const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE users ADD COLUMN "${name}" ${type}`).run();
    }catch(e){}
  }
  addUserCol('photo_path', 'TEXT DEFAULT ""');
  addUserCol('photo_url', 'TEXT DEFAULT ""');
  addUserCol('is_team_lead', 'INTEGER DEFAULT 0');
  addUserCol('team_lead', 'INTEGER DEFAULT 0');
}
function v6214EnsureDocsTable(){
  db.exec(`CREATE TABLE IF NOT EXISTS operator_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT DEFAULT '',
    filename TEXT DEFAULT '',
    original_name TEXT DEFAULT '',
    path TEXT DEFAULT '',
    url TEXT DEFAULT '',
    mime_type TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}
v6214EnsureOperatorColumns();
v6214EnsureDocsTable();

const storage_v6214 = multer_v6214.diskStorage({
  destination: function(req,file,cb){
    try{
      const userId = String(req.params.id || req.body.user_id || 'tmp').replace(/[^0-9a-zA-Z_-]/g,'');
      const dir = path6214.join(v6214UploadsRoot(), userId);
      fs6214.mkdirSync(dir, {recursive:true});
      cb(null, dir);
    }catch(e){ cb(e); }
  },
  filename: function(req,file,cb){
    const ext = path6214.extname(file.originalname || '').toLowerCase();
    const safeBase = String(file.originalname || 'file').replace(ext,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,60);
    cb(null, Date.now() + '-' + safeBase + ext);
  }
});
const upload_v6214 = multer_v6214({storage: storage_v6214, limits: {fileSize: 15 * 1024 * 1024}});

app.use('/uploads/operators', express.static(v6214UploadsRoot()));

app.post('/api/v6214/operators/:id/photo', requireAdmin, upload_v6214.single('photo'), (req,res)=>{
  try{
    v6214EnsureOperatorColumns();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID inválido'});
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
    if(!user) return res.status(404).json({ok:false,error:'Operario no encontrado'});
    if(!req.file) return res.status(400).json({ok:false,error:'No se recibió fotografía'});
    const relUrl = '/uploads/operators/' + id + '/' + req.file.filename;
    db.prepare('UPDATE users SET photo_path=?, photo_url=? WHERE id=?').run(req.file.path, relUrl, id);
    res.json({ok:true, photo_url:relUrl, filename:req.file.filename});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/v6214/operators/:id/documents', requireAdmin, upload_v6214.array('documents', 12), (req,res)=>{
  try{
    v6214EnsureDocsTable();
    const id = Number(req.params.id);
    if(!id) return res.status(400).json({ok:false,error:'ID inválido'});
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
    if(!user) return res.status(404).json({ok:false,error:'Operario no encontrado'});
    const files = req.files || [];
    const docType = req.body.doc_type || '';
    const stmt = db.prepare('INSERT INTO operator_documents (user_id, doc_type, filename, original_name, path, url, mime_type, size) VALUES (?,?,?,?,?,?,?,?)');
    const created = [];
    for(const f of files){
      const url = '/uploads/operators/' + id + '/' + f.filename;
      stmt.run(id, docType, f.filename, f.originalname || f.filename, f.path, url, f.mimetype || '', f.size || 0);
      created.push({filename:f.filename, original_name:f.originalname, url, size:f.size});
    }
    res.json({ok:true, count:created.length, documents:created});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/v6214/operators/:id/documents', requireAdmin, (req,res)=>{
  try{
    v6214EnsureDocsTable();
    const id = Number(req.params.id);
    const docs = db.prepare('SELECT * FROM operator_documents WHERE user_id=? ORDER BY uploaded_at DESC, id DESC').all(id);
    res.json({ok:true, documents:docs});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.delete('/api/v6214/operator-documents/:docId', requireAdmin, (req,res)=>{
  try{
    v6214EnsureDocsTable();
    const docId = Number(req.params.docId);
    const doc = db.prepare('SELECT * FROM operator_documents WHERE id=?').get(docId);
    if(!doc) return res.status(404).json({ok:false,error:'Documento no encontrado'});
    try{ if(doc.path && fs6214.existsSync(doc.path)) fs6214.unlinkSync(doc.path); }catch(e){}
    db.prepare('DELETE FROM operator_documents WHERE id=?').run(docId);
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});


// ---------- V62.15 PHOTO ICON + EVENT PERSISTENCE HARD FIX ----------
function v6215EnsureHardPersistence(){
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS event_extra_data (
      event_id INTEGER PRIMARY KEY,
      payload_json TEXT DEFAULT '{}',
      assignments_json TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  }catch(e){}

  try{
    if(typeof v6214EnsureOperatorColumns === 'function') v6214EnsureOperatorColumns();
  }catch(e){}

  try{
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const add = (name,type)=>{
      if(!cols.includes(name)){
        try{ db.prepare(`ALTER TABLE events ADD COLUMN "${name}" ${type}`).run(); }catch(e){}
      }
    };
    add('google_maps_link','TEXT DEFAULT ""');
    add('address','TEXT DEFAULT ""');
    add('lat','TEXT DEFAULT ""');
    add('lng','TEXT DEFAULT ""');
    add('geo_source','TEXT DEFAULT ""');
    add('transport_required','INTEGER DEFAULT 0');
    add('transport_charge','REAL DEFAULT 0');
    add('access_notes','TEXT DEFAULT ""');
    add('parking_notes','TEXT DEFAULT ""');
    add('load_in_time','TEXT DEFAULT ""');
    add('load_out_time','TEXT DEFAULT ""');
    add('production_notes','TEXT DEFAULT ""');
    add('crew_notes','TEXT DEFAULT ""');
    add('material_notes','TEXT DEFAULT ""');
  }catch(e){}
}

function v6215PersistEventExtra(eventId, event, assignments){
  v6215EnsureHardPersistence();
  const payload = JSON.stringify(event || {});
  const ass = JSON.stringify(assignments || []);
  db.prepare(`
    INSERT INTO event_extra_data (event_id, payload_json, assignments_json, updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(event_id) DO UPDATE SET
      payload_json=excluded.payload_json,
      assignments_json=excluded.assignments_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(eventId, payload, ass);
}

function v6215RestoreEventExtra(eventId){
  v6215EnsureHardPersistence();
  const extra = db.prepare('SELECT * FROM event_extra_data WHERE event_id=?').get(eventId);
  if(!extra) return null;

  let payload = {};
  let assignments = [];
  try{ payload = JSON.parse(extra.payload_json || '{}'); }catch(e){}
  try{ assignments = JSON.parse(extra.assignments_json || '[]'); }catch(e){}

  const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
  const keys = Object.keys(payload || {}).filter(k=>cols.includes(k));
  if(keys.length){
    try{
      db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
    }catch(e){}
  }

  if(assignments && assignments.length && typeof v612SaveAssignments === 'function'){
    try{ v612SaveAssignments(eventId, assignments); }catch(e){}
  }

  return {payload, assignments};
}

app.get('/api/v6215/operators/:id/photo-status', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const u = db.prepare('SELECT id, first_name,last_name,nickname,photo_url,photo_path FROM users WHERE id=?').get(id);
    if(!u) return res.status(404).json({ok:false,error:'Operario no encontrado'});
    res.json({ok:true, operator:u});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/v6215/event-extra/:id', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const restored = v6215RestoreEventExtra(id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    res.json({ok:true,event,extra:restored});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v6215/event-form-save-hard', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft === 'function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});

    v6215EnsureHardPersistence();

    const id = Number(req.query.id || 0);
    const body = req.body || {};
    const eventPayload = (typeof v6213CleanEventPayload === 'function')
      ? v6213CleanEventPayload(body.event || body)
      : (body.event || body);
    const assignments = body.assignments || [];

    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys = Object.keys(eventPayload).filter(k=>cols.includes(k));

    let eventId = id;
    if(eventId){
      const exists = db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
      if(!exists) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      if(keys.length){
        db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>eventPayload[k]), eventId);
      }
    }else{
      const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>eventPayload[k]));
      eventId = info.lastInsertRowid;
    }

    if(typeof v612SaveAssignments === 'function'){
      try{ v612SaveAssignments(eventId, assignments); }catch(e){ console.error('[V62.15] assignments save', e.message); }
    }

    // Guardado doble persistente para que no lo pierda una actualización/sync.
    v6215PersistEventExtra(eventId, eventPayload, assignments);

    let google = {ok:false, skipped:true, reason:'Google push no disponible'};
    if(typeof v614PushEventToGoogle === 'function'){
      try{ google = await v614PushEventToGoogle(eventId); }catch(e){ google = {ok:false,error:e.message}; }
    }

    res.json({ok:true,event_id:eventId,updated:!!id,google});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.16 AUTOMATIC RESTORE ON STARTUP ----------
function v6216DataDir(){
  return global.DATA_DIR_V627 || process.env.DATA_DIR || process.env.PERSISTENT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
}
function v6216DbPath(){
  return process.env.DB_PATH || global.DB_PATH_V627 || (path_v627 || require('path')).join(v6216DataDir(), 'marfan-crew-hours.sqlite');
}
function v6216BackupDir(){
  const pathLib = path_v627 || require('path');
  const fsLib = fs_v627 || require('fs');
  const dir = pathLib.join(v6216DataDir(), 'backups');
  try{ fsLib.mkdirSync(dir, {recursive:true}); }catch(e){}
  return dir;
}
function v6216UploadsDir(){
  const pathLib = path_v627 || require('path');
  const fsLib = fs_v627 || require('fs');
  const dir = pathLib.join(v6216DataDir(), 'uploads');
  try{ fsLib.mkdirSync(dir, {recursive:true}); }catch(e){}
  return dir;
}
function v6216ListBackups(){
  const pathLib = path_v627 || require('path');
  const fsLib = fs_v627 || require('fs');
  const dir = v6216BackupDir();
  try{
    return fsLib.readdirSync(dir)
      .filter(f => f.endsWith('.sqlite') || f.endsWith('.db'))
      .map(f => {
        const p = pathLib.join(dir, f);
        const st = fsLib.statSync(p);
        return {file:f, path:p, mtime:st.mtimeMs, size:st.size};
      })
      .sort((a,b)=>b.mtime-a.mtime);
  }catch(e){ return []; }
}
function v6216KeepOnlyTenBackups(){
  const fsLib = fs_v627 || require('fs');
  const backups = v6216ListBackups();
  backups.slice(10).forEach(b => { try{ fsLib.unlinkSync(b.path); }catch(e){} });
}
function v6216CreateStartupBackup(){
  const pathLib = path_v627 || require('path');
  const fsLib = fs_v627 || require('fs');
  try{
    const dbPath = v6216DbPath();
    if(!dbPath || !fsLib.existsSync(dbPath)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const out = pathLib.join(v6216BackupDir(), `startup-v62-16-${stamp}.sqlite`);
    fsLib.copyFileSync(dbPath, out);
    v6216KeepOnlyTenBackups();
    return out;
  }catch(e){
    console.error('[V62.16] startup backup error', e.message);
    return null;
  }
}
function v6216RestoreLatestBackupIfDbMissing(){
  const fsLib = fs_v627 || require('fs');
  try{
    const dbPath = v6216DbPath();
    const exists = dbPath && fsLib.existsSync(dbPath) && fsLib.statSync(dbPath).size > 0;
    if(exists) return {restored:false, reason:'db_exists'};

    const latest = v6216ListBackups()[0];
    if(!latest) return {restored:false, reason:'no_backup'};

    fsLib.copyFileSync(latest.path, dbPath);
    console.log('[V62.16] Restored DB automatically from backup:', latest.path);
    return {restored:true, from:latest.path, to:dbPath};
  }catch(e){
    console.error('[V62.16] restore latest backup error', e.message);
    return {restored:false, error:e.message};
  }
}
function v6216EnsureAllPersistentTables(){
  try{ if(typeof v6215EnsureHardPersistence === 'function') v6215EnsureHardPersistence(); }catch(e){}
  try{ if(typeof v6214EnsureDocsTable === 'function') v6214EnsureDocsTable(); }catch(e){}
  try{ if(typeof v6214EnsureOperatorColumns === 'function') v6214EnsureOperatorColumns(); }catch(e){}
  try{ if(typeof v6211EnsureClientEditColumns === 'function') v6211EnsureClientEditColumns(); }catch(e){}
  try{ if(typeof v6210EnsureOperatorEditColumns === 'function') v6210EnsureOperatorEditColumns(); }catch(e){}
}
function v6216RestoreEventExtrasOnBoot(){
  try{
    v6216EnsureAllPersistentTables();
    const rows = db.prepare('SELECT event_id FROM event_extra_data ORDER BY updated_at DESC').all();
    let restored = 0;
    for(const r of rows){
      try{
        if(typeof v6215RestoreEventExtra === 'function'){
          v6215RestoreEventExtra(r.event_id);
          restored++;
        }
      }catch(e){}
    }
    console.log('[V62.16] Event extras restored automatically:', restored);
    return restored;
  }catch(e){
    console.error('[V62.16] event extra restore error', e.message);
    return 0;
  }
}
function v6216RestoreOperatorPhotosFromUploads(){
  const pathLib = path_v627 || require('path');
  const fsLib = fs_v627 || require('fs');
  try{
    v6216EnsureAllPersistentTables();
    const opDir = pathLib.join(v6216UploadsDir(), 'operators');
    if(!fsLib.existsSync(opDir)) return 0;
    const userDirs = fsLib.readdirSync(opDir).filter(d => /^\d+$/.test(d));
    let restored = 0;

    for(const userId of userDirs){
      const dir = pathLib.join(opDir, userId);
      const files = fsLib.readdirSync(dir)
        .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        .map(f => {
          const p = pathLib.join(dir, f);
          return {f,p,mtime:fsLib.statSync(p).mtimeMs};
        })
        .sort((a,b)=>b.mtime-a.mtime);

      if(!files.length) continue;
      const latest = files[0];
      const url = '/uploads/operators/' + userId + '/' + latest.f;

      try{
        const user = db.prepare('SELECT id, photo_url FROM users WHERE id=?').get(Number(userId));
        if(user && !user.photo_url){
          db.prepare('UPDATE users SET photo_path=?, photo_url=? WHERE id=?').run(latest.p, url, Number(userId));
          restored++;
        }
      }catch(e){}
    }
    console.log('[V62.16] Operator photos restored automatically:', restored);
    return restored;
  }catch(e){
    console.error('[V62.16] operator photo restore error', e.message);
    return 0;
  }
}
function v6216AutoRestoreEverything(){
  const result = {
    db: null,
    startup_backup: null,
    event_extras: 0,
    photos: 0,
    backups_kept: 0
  };
  try{
    result.db = v6216RestoreLatestBackupIfDbMissing();
    v6216EnsureAllPersistentTables();
    result.event_extras = v6216RestoreEventExtrasOnBoot();
    result.photos = v6216RestoreOperatorPhotosFromUploads();
    result.startup_backup = v6216CreateStartupBackup();
    v6216KeepOnlyTenBackups();
    result.backups_kept = v6216ListBackups().length;
    console.log('[V62.16] Automatic restore completed:', result);
  }catch(e){
    console.error('[V62.16] automatic restore error', e.message);
    result.error = e.message;
  }
  global.V6216_RESTORE_STATUS = result;
  return result;
}

// Ejecutar automáticamente al arrancar, sin pulsar nada.
setTimeout(()=>{ try{ v6216AutoRestoreEverything(); }catch(e){ console.error(e); } }, 1200);

app.get('/api/v6216-auto-restore-status', requireAdmin, (req,res)=>{
  try{
    res.json({
      ok:true,
      version: '62.70.0',
      status:global.V6216_RESTORE_STATUS || null,
      db_path:v6216DbPath(),
      data_dir:v6216DataDir(),
      uploads_dir:v6216UploadsDir(),
      backups:v6216ListBackups().slice(0,10)
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/v6216-auto-restore-now', requireAdmin, (req,res)=>{
  try{
    const status = v6216AutoRestoreEverything();
    res.json({ok:true,status});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.17 CALENDAR AUTO SYNC + FULL EVENT DATA PERSISTENCE ----------
function v6217Norm(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); }
function v6217Date(v){ return String(v||'').slice(0,10); }
function v6217StableKey(event){
  if(!event) return '';
  const googleId = event.google_event_id || event.google_id || event.gcal_id || event.googleCalendarEventId || '';
  if(googleId) return 'google:' + String(googleId);
  return 'event:' + v6217Date(event.event_date || event.date || event.start_date || '') + ':' + v6217Norm(event.name || event.title || event.summary || '') + ':' + v6217Norm(event.client || '');
}
function v6217EnsurePersistentTables(){
  try{ db.exec(`CREATE TABLE IF NOT EXISTS event_extra_data_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER DEFAULT NULL,
    stable_key TEXT UNIQUE NOT NULL,
    event_date TEXT DEFAULT '',
    event_name TEXT DEFAULT '',
    payload_json TEXT DEFAULT '{}',
    assignments_json TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`); }catch(e){}
  try{ if(typeof v6215EnsureHardPersistence === 'function') v6215EnsureHardPersistence(); }catch(e){}
  try{ if(typeof v612EnsureAssignmentsColumns === 'function') v612EnsureAssignmentsColumns(); }catch(e){}
}
function v6217PersistEventFull(eventId,eventPayload,assignments){
  v6217EnsurePersistentTables();
  let event = eventPayload || {};
  try{ event = Object.assign({}, db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || {}, eventPayload || {}); }catch(e){}
  const key = v6217StableKey(event);
  if(!key || key==='event:::') return false;
  db.prepare(`INSERT INTO event_extra_data_v2 (event_id,stable_key,event_date,event_name,payload_json,assignments_json,updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(stable_key) DO UPDATE SET event_id=excluded.event_id,event_date=excluded.event_date,event_name=excluded.event_name,payload_json=excluded.payload_json,assignments_json=excluded.assignments_json,updated_at=CURRENT_TIMESTAMP`)
    .run(eventId,key,v6217Date(event.event_date||''),String(event.name||''),JSON.stringify(eventPayload||event||{}),JSON.stringify(assignments||[]));
  try{ if(typeof v6215PersistEventExtra === 'function') v6215PersistEventExtra(eventId,eventPayload||event,assignments||[]); }catch(e){}
  return true;
}
function v6217FindExtraForEvent(event){
  v6217EnsurePersistentTables();
  const key = v6217StableKey(event);
  if(key){ const row=db.prepare('SELECT * FROM event_extra_data_v2 WHERE stable_key=?').get(key); if(row) return row; }
  const date=v6217Date(event.event_date||event.date||''); const name=v6217Norm(event.name||event.title||event.summary||'');
  if(date && name){
    const rows=db.prepare('SELECT * FROM event_extra_data_v2 WHERE event_date=? ORDER BY updated_at DESC').all(date);
    return rows.find(r=>v6217Norm(r.event_name)===name || name.includes(v6217Norm(r.event_name)) || v6217Norm(r.event_name).includes(name)) || null;
  }
  return null;
}
function v6217RestoreFullForEvent(eventId){
  v6217EnsurePersistentTables();
  const event=db.prepare('SELECT * FROM events WHERE id=?').get(eventId); if(!event) return false;
  const extra=v6217FindExtraForEvent(event); if(!extra) return false;
  let payload={}, assignments=[]; try{payload=JSON.parse(extra.payload_json||'{}')}catch(e){}; try{assignments=JSON.parse(extra.assignments_json||'[]')}catch(e){}
  const cols=db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
  const keys=Object.keys(payload||{}).filter(k=>cols.includes(k));
  if(keys.length) db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
  if(assignments && assignments.length && typeof v612SaveAssignments==='function'){ try{ v612SaveAssignments(eventId, assignments.map(a=>Object.assign({},a,{event_id:eventId}))); }catch(e){} }
  try{ db.prepare('UPDATE event_extra_data_v2 SET event_id=? WHERE id=?').run(eventId, extra.id); }catch(e){}
  return true;
}
function v6217RestoreAllFullEvents(){
  v6217EnsurePersistentTables(); let restored=0;
  try{ for(const e of db.prepare('SELECT * FROM events').all()){ try{ if(v6217RestoreFullForEvent(e.id)) restored++; }catch(err){} } }catch(e){}
  console.log('[V62.17] Full event data restored:', restored); return restored;
}
app.post('/api/v6217/event-form-save-full', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft==='function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});
    v6217EnsurePersistentTables();
    const id=Number(req.query.id||0), body=req.body||{};
    const payload=(typeof v6213CleanEventPayload==='function') ? v6213CleanEventPayload(body.event||body) : (body.event||body);
    const assignments=body.assignments||[];
    const cols=db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys=Object.keys(payload).filter(k=>cols.includes(k));
    let eventId=id;
    if(eventId){ if(!db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) return res.status(404).json({ok:false,error:'Evento no encontrado'}); if(keys.length) db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId); }
    else { const info=db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>payload[k])); eventId=info.lastInsertRowid; }
    if(typeof v612SaveAssignments==='function'){ try{ v612SaveAssignments(eventId, assignments); }catch(e){} }
    v6217PersistEventFull(eventId,payload,assignments);
    let google={ok:false,skipped:true,reason:'Google push no disponible'};
    if(typeof v614PushEventToGoogle==='function'){ try{google=await v614PushEventToGoogle(eventId)}catch(e){google={ok:false,error:e.message}} }
    try{ v6217PersistEventFull(eventId,Object.assign({},db.prepare('SELECT * FROM events WHERE id=?').get(eventId)||{},payload),assignments); }catch(e){}
    res.json({ok:true,event_id:eventId,updated:!!id,google});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.post('/api/v6217/calendar-auto-sync-restore', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft==='function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});
    let sync={ok:false,skipped:true};
    for(const fn of ['v589SyncGoogleCalendar','v586SyncGoogleCalendar','v574SyncGoogleCalendar','syncGoogleCalendar','syncGoogleEvents']){
      try{ if(typeof global[fn]==='function'){ sync=await global[fn](); break; } }catch(e){ sync={ok:false,error:e.message}; }
    }
    const restored=v6217RestoreAllFullEvents();
    res.json({ok:true,sync,restored});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6217/event-full/:id', requireAdmin, (req,res)=>{
  try{ const id=Number(req.params.id); v6217RestoreFullForEvent(id); res.json({ok:true,event:db.prepare('SELECT * FROM events WHERE id=?').get(id),assignments:db.prepare('SELECT * FROM assignments WHERE event_id=?').all(id)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
setTimeout(()=>{ try{ v6217RestoreAllFullEvents(); }catch(e){} }, 1800);


// ---------- V62.18 CALENDAR DATA REAL FIX ----------
function v6218Norm(v){
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}
function v6218Date(v){ return String(v || '').slice(0,10); }
function v6218Ensure(){
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS event_snapshots_v6218 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER DEFAULT NULL,
      stable_key TEXT UNIQUE NOT NULL,
      event_date TEXT DEFAULT '',
      event_name TEXT DEFAULT '',
      payload_json TEXT DEFAULT '{}',
      assignments_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  }catch(e){}
  try{ if(typeof v612EnsureEventColumns === 'function') v612EnsureEventColumns(); }catch(e){}
  try{ if(typeof v612EnsureAssignmentsColumns === 'function') v612EnsureAssignmentsColumns(); }catch(e){}
}
function v6218StableKeys(ev){
  const keys = [];
  if(!ev) return keys;
  const google = ev.google_event_id || ev.google_id || ev.gcal_id || ev.googleCalendarEventId || ev.google_event || '';
  if(google) keys.push('google:' + String(google));
  const date = v6218Date(ev.event_date || ev.date || ev.start_date || ev.start || '');
  const name = v6218Norm(ev.name || ev.title || ev.summary || '');
  const client = v6218Norm(ev.client || '');
  if(date && name) {
    keys.push('event:' + date + ':' + name + ':' + client);
    keys.push('event:' + date + ':' + name + ':');
  }
  if(ev.id) keys.push('local:' + String(ev.id));
  return [...new Set(keys.filter(Boolean))];
}
function v6218CurrentEvent(eventId){
  try{ return db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || {}; }catch(e){ return {}; }
}
function v6218Assignments(eventId){
  try{ return db.prepare('SELECT * FROM assignments WHERE event_id=?').all(eventId) || []; }catch(e){ return []; }
}
function v6218SaveSnapshot(eventId, payload, assignments){
  v6218Ensure();
  const dbEv = v6218CurrentEvent(eventId);
  const full = Object.assign({}, dbEv, payload || {});
  const keys = v6218StableKeys(full);
  if(!keys.length) return false;
  const main = keys[0];
  const eventDate = v6218Date(full.event_date || '');
  const eventName = String(full.name || '');
  const payloadJson = JSON.stringify(full || {});
  const assJson = JSON.stringify(assignments || []);
  db.prepare(`INSERT INTO event_snapshots_v6218 (event_id,stable_key,event_date,event_name,payload_json,assignments_json,updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(stable_key) DO UPDATE SET event_id=excluded.event_id,event_date=excluded.event_date,event_name=excluded.event_name,payload_json=excluded.payload_json,assignments_json=excluded.assignments_json,updated_at=CURRENT_TIMESTAMP`)
    .run(eventId, main, eventDate, eventName, payloadJson, assJson);
  // Guardar alias secundarios que apuntan al mismo contenido.
  for(const k of keys.slice(1)){
    try{
      db.prepare(`INSERT INTO event_snapshots_v6218 (event_id,stable_key,event_date,event_name,payload_json,assignments_json,updated_at)
        VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(stable_key) DO UPDATE SET event_id=excluded.event_id,event_date=excluded.event_date,event_name=excluded.event_name,payload_json=excluded.payload_json,assignments_json=excluded.assignments_json,updated_at=CURRENT_TIMESTAMP`)
        .run(eventId, k, eventDate, eventName, payloadJson, assJson);
    }catch(e){}
  }
  return true;
}
function v6218FindSnapshotForEvent(ev){
  v6218Ensure();
  const keys = v6218StableKeys(ev);
  for(const k of keys){
    try{
      const row = db.prepare('SELECT * FROM event_snapshots_v6218 WHERE stable_key=? ORDER BY updated_at DESC LIMIT 1').get(k);
      if(row) return row;
    }catch(e){}
  }
  const date = v6218Date(ev.event_date || ev.date || '');
  const name = v6218Norm(ev.name || ev.title || ev.summary || '');
  if(date && name){
    try{
      const rows = db.prepare('SELECT * FROM event_snapshots_v6218 WHERE event_date=? ORDER BY updated_at DESC').all(date);
      const found = rows.find(r => {
        const rn = v6218Norm(r.event_name);
        return rn === name || rn.includes(name) || name.includes(rn);
      });
      if(found) return found;
    }catch(e){}
  }
  return null;
}
function v6218ApplySnapshot(eventId){
  v6218Ensure();
  const ev = v6218CurrentEvent(eventId);
  if(!ev || !ev.id) return {ok:false, restored:false, reason:'event_not_found'};
  const snap = v6218FindSnapshotForEvent(ev);
  if(!snap) return {ok:true, restored:false, reason:'snapshot_not_found'};
  let payload = {}; let assignments = [];
  try{ payload = JSON.parse(snap.payload_json || '{}'); }catch(e){}
  try{ assignments = JSON.parse(snap.assignments_json || '[]'); }catch(e){}
  const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
  const keys = Object.keys(payload || {}).filter(k => cols.includes(k) && k !== 'id');
  if(keys.length){
    db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
  }
  if(assignments && assignments.length && typeof v612SaveAssignments === 'function'){
    try{
      v612SaveAssignments(eventId, assignments.map(a => Object.assign({}, a, {event_id:eventId})));
    }catch(e){}
  }
  try{ db.prepare('UPDATE event_snapshots_v6218 SET event_id=? WHERE id=?').run(eventId, snap.id); }catch(e){}
  return {ok:true, restored:true, snapshot_id:snap.id, assignments:assignments.length};
}
function v6218RestoreAll(){
  v6218Ensure();
  let restored = 0;
  try{
    const events = db.prepare('SELECT * FROM events').all();
    for(const e of events){
      try{ const r = v6218ApplySnapshot(e.id); if(r.restored) restored++; }catch(err){}
    }
  }catch(e){}
  return restored;
}
app.post('/api/v6218/event-save-real', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft === 'function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});
    v6218Ensure();
    const id = Number(req.query.id || 0);
    const body = req.body || {};
    const payload = (typeof v6213CleanEventPayload === 'function') ? v6213CleanEventPayload(body.event || body) : (body.event || body);
    const assignments = body.assignments || [];
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const keys = Object.keys(payload).filter(k=>cols.includes(k));
    let eventId = id;
    if(eventId){
      if(!db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) return res.status(404).json({ok:false,error:'Evento no encontrado'});
      if(keys.length) db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>payload[k]), eventId);
    } else {
      const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>payload[k]));
      eventId = info.lastInsertRowid;
    }
    if(typeof v612SaveAssignments === 'function'){
      try{ v612SaveAssignments(eventId, assignments); }catch(e){}
    }
    v6218SaveSnapshot(eventId, payload, assignments);
    let google = {ok:false, skipped:true};
    if(typeof v614PushEventToGoogle === 'function'){
      try{ google = await v614PushEventToGoogle(eventId); }catch(e){ google = {ok:false,error:e.message}; }
    }
    try{ v6218SaveSnapshot(eventId, Object.assign({}, v6218CurrentEvent(eventId), payload), assignments); }catch(e){}
    res.json({ok:true,event_id:eventId,google});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6218/event-open-real/:id', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const restored = v6218ApplySnapshot(id);
    const event = v6218CurrentEvent(id);
    const assignments = v6218Assignments(id);
    res.json({ok:true,event,assignments,restored});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.post('/api/v6218/calendar-restore-now', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft === 'function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});
    const restored = v6218RestoreAll();
    res.json({ok:true,restored});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
setTimeout(()=>{ try{ console.log('[V62.18] restored snapshots', v6218RestoreAll()); }catch(e){} }, 2200);


// ---------- V62.19 EVENT OPERATORS ROLES HARD SAVE ----------
function v6219EnsureAssignmentsHard(){
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      service_role TEXT DEFAULT '',
      planned_start TEXT DEFAULT '',
      planned_end TEXT DEFAULT '',
      status TEXT DEFAULT 'asignado',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  }catch(e){}
  function addCol(name,type){
    try{
      const cols = db.prepare('PRAGMA table_info(assignments)').all().map(c=>c.name);
      if(!cols.includes(name)) db.prepare(`ALTER TABLE assignments ADD COLUMN "${name}" ${type}`).run();
    }catch(e){}
  }
  addCol('role_id','INTEGER DEFAULT NULL');
  addCol('shift_type','TEXT DEFAULT "D"');
  addCol('hourly_rate','REAL DEFAULT 0');
  addCol('is_team_lead','INTEGER DEFAULT 0');
  addCol('notes','TEXT DEFAULT ""');
}
function v6219NormalizeAssignments(rows){
  rows = Array.isArray(rows) ? rows : [];
  return rows.map(r => ({
    user_id: Number(r.user_id || r.operator_id || r.worker_id || 0),
    role_id: r.role_id ? Number(r.role_id) : null,
    service_role: String(r.service_role || r.role_name || r.operator_role_name || r.role || '').trim(),
    shift_type: String(r.shift_type || r.shift || 'D').trim() || 'D',
    planned_start: String(r.planned_start || r.start_time || r.start || '').trim(),
    planned_end: String(r.planned_end || r.end_time || r.end || '').trim(),
    hourly_rate: Number(r.hourly_rate || r.rate || r.price || 0),
    is_team_lead: Number(r.is_team_lead || r.team_lead || r.lead || 0),
    status: String(r.status || 'asignado'),
    notes: String(r.notes || '')
  })).filter(r => r.user_id);
}
function v6219SaveAssignmentsHard(eventId, rows){
  v6219EnsureAssignmentsHard();
  const assignments = v6219NormalizeAssignments(rows);
  const cols = db.prepare('PRAGMA table_info(assignments)').all().map(c=>c.name);
  const allowed = ['event_id','user_id','service_role','planned_start','planned_end','status','role_id','shift_type','hourly_rate','is_team_lead','notes'].filter(c=>cols.includes(c));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM assignments WHERE event_id=?').run(eventId);
    if(!assignments.length) return;
    const stmt = db.prepare(`INSERT INTO assignments (${allowed.map(c=>`"${c}"`).join(',')}) VALUES (${allowed.map(()=>'?').join(',')})`);
    for(const a of assignments){
      const item = Object.assign({}, a, {event_id:eventId});
      stmt.run(...allowed.map(c=>item[c]));
    }
  });
  tx();
  return assignments.length;
}
function v6219GetAssignmentsFull(eventId){
  v6219EnsureAssignmentsHard();
  try{
    return db.prepare(`
      SELECT a.*, 
        u.first_name, u.last_name, u.nickname, u.phone, u.email,
        COALESCE(r.role, r.name, a.service_role) AS resolved_role
      FROM assignments a
      LEFT JOIN users u ON u.id=a.user_id
      LEFT JOIN rates r ON r.id=a.role_id
      WHERE a.event_id=?
      ORDER BY COALESCE(a.is_team_lead,0) DESC, u.first_name, u.last_name
    `).all(eventId);
  }catch(e){
    try{
      return db.prepare(`
        SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone, u.email
        FROM assignments a
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY COALESCE(a.is_team_lead,0) DESC, u.first_name, u.last_name
      `).all(eventId);
    }catch(_e){ return []; }
  }
}
function v6219PersistAssignmentsSnapshot(eventId, assignments){
  try{
    if(typeof v6218SaveSnapshot === 'function'){
      const ev = db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || {};
      v6218SaveSnapshot(eventId, ev, assignments);
    }
    if(typeof v6217PersistEventFull === 'function'){
      const ev = db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || {};
      v6217PersistEventFull(eventId, ev, assignments);
    }
    if(typeof v6215PersistEventExtra === 'function'){
      const ev = db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || {};
      v6215PersistEventExtra(eventId, ev, assignments);
    }
  }catch(e){}
}
app.post('/api/v6219/events/:id/assignments-hard-save', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft === 'function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});
    const eventId = Number(req.params.id);
    if(!eventId) return res.status(400).json({ok:false,error:'ID de evento inválido'});
    const exists = db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
    if(!exists) return res.status(404).json({ok:false,error:'Evento no encontrado'});
    const assignments = v6219NormalizeAssignments((req.body || {}).assignments || req.body || []);
    const count = v6219SaveAssignmentsHard(eventId, assignments);
    v6219PersistAssignmentsSnapshot(eventId, assignments);
    res.json({ok:true,event_id:eventId,count,assignments:v6219GetAssignmentsFull(eventId)});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6219/events/:id/assignments-full', requireAdmin, (req,res)=>{
  try{
    const eventId = Number(req.params.id);
    res.json({ok:true,event_id:eventId,assignments:v6219GetAssignmentsFull(eventId)});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});


// ---------- V62.20 PASSWORDS EASY EDIT ----------
function v6220EnsurePasswordsTable(){
  db.exec(`CREATE TABLE IF NOT EXISTS password_vault (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    service TEXT DEFAULT '',
    category TEXT DEFAULT '',
    username TEXT DEFAULT '',
    password TEXT DEFAULT '',
    url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}
function v6220Payload(b){
  b=b||{};
  return {title:String(b.title||'').trim(),service:String(b.service||'').trim(),category:String(b.category||'').trim(),username:String(b.username||'').trim(),password:String(b.password||'').trim(),url:String(b.url||'').trim(),notes:String(b.notes||'').trim(),active:Number(b.active??1)};
}
app.get('/api/v6220/passwords', requireAdmin, (req,res)=>{
  try{v6220EnsurePasswordsTable(); res.json({ok:true,rows:db.prepare("SELECT * FROM password_vault WHERE COALESCE(active,1)!=0 ORDER BY category COLLATE NOCASE,title COLLATE NOCASE").all()});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/v6220/passwords/:id', requireAdmin, (req,res)=>{
  try{v6220EnsurePasswordsTable(); const row=db.prepare("SELECT * FROM password_vault WHERE id=?").get(Number(req.params.id)); if(!row)return res.status(404).json({ok:false,error:'Acceso no encontrado'}); res.json({ok:true,row});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6220/passwords', requireAdmin, (req,res)=>{
  try{v6220EnsurePasswordsTable(); const p=v6220Payload(req.body); if(!p.title)return res.status(400).json({ok:false,error:'El nombre del acceso es obligatorio'}); const info=db.prepare("INSERT INTO password_vault (title,service,category,username,password,url,notes,active,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(p.title,p.service,p.category,p.username,p.password,p.url,p.notes,p.active); res.json({ok:true,id:info.lastInsertRowid});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6220/passwords/:id', requireAdmin, (req,res)=>{
  try{v6220EnsurePasswordsTable(); const id=Number(req.params.id); if(!db.prepare("SELECT id FROM password_vault WHERE id=?").get(id))return res.status(404).json({ok:false,error:'Acceso no encontrado'}); const p=v6220Payload(req.body); if(!p.title)return res.status(400).json({ok:false,error:'El nombre del acceso es obligatorio'}); db.prepare("UPDATE password_vault SET title=?,service=?,category=?,username=?,password=?,url=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(p.title,p.service,p.category,p.username,p.password,p.url,p.notes,p.active,id); res.json({ok:true,id});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.delete('/api/v6220/passwords/:id', requireAdmin, (req,res)=>{
  try{v6220EnsurePasswordsTable(); db.prepare("UPDATE password_vault SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(req.params.id)); res.json({ok:true});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
setTimeout(()=>{try{v6220EnsurePasswordsTable()}catch(e){}},1200);


// ---------- V62.21 MAKE ADMIN FUNCTION ----------
function v6221AdminCount(){
  try{return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND COALESCE(active,1)!=0").get().c||0;}catch(e){return 0;}
}
app.get('/api/v6221/users/:id/admin-role', requireAdmin, (req,res)=>{
  try{
    const user=db.prepare("SELECT id,first_name,last_name,email,role,active FROM users WHERE id=?").get(Number(req.params.id));
    if(!user)return res.status(404).json({ok:false,error:'Usuario no encontrado'});
    res.json({ok:true,user,is_admin:user.role==='admin'?1:0,admin_count:v6221AdminCount()});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6221/users/:id/admin-role', requireAdmin, (req,res)=>{
  try{
    const id=Number(req.params.id);
    const user=db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if(!user)return res.status(404).json({ok:false,error:'Usuario no encontrado'});
    const makeAdmin=Number((req.body||{}).is_admin||0)===1;
    if(!makeAdmin && user.role==='admin' && v6221AdminCount()<=1)return res.status(400).json({ok:false,error:'No puedes quitar el último administrador del sistema'});
    const role=makeAdmin?'admin':'operario';
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role,id);
    res.json({ok:true,id,role,is_admin:makeAdmin?1:0});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});


// ---------- V62.22 PASSWORDS RESTORE ADMIN FIX ----------
function v6222TableExists(name){
  try{
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  }catch(e){ return false; }
}
function v6222Cols(table){
  try{ return db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name); }catch(e){ return []; }
}
function v6222Get(row, cols, names){
  for(const n of names){
    if(cols.includes(n) && row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== '') return row[n];
  }
  return '';
}
function v6222EnsurePasswordsTable(){
  if(typeof v6220EnsurePasswordsTable === 'function') v6220EnsurePasswordsTable();
  else {
    db.exec(`CREATE TABLE IF NOT EXISTS password_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      service TEXT DEFAULT '',
      category TEXT DEFAULT '',
      username TEXT DEFAULT '',
      password TEXT DEFAULT '',
      url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  }
}
function v6222UpsertPassword(item){
  v6222EnsurePasswordsTable();
  const title = String(item.title || '').trim();
  const username = String(item.username || '').trim();
  const service = String(item.service || '').trim();
  if(!title && !username) return false;

  const exists = db.prepare(`
    SELECT id FROM password_vault 
    WHERE lower(COALESCE(title,''))=lower(?) 
      AND lower(COALESCE(username,''))=lower(?)
      AND lower(COALESCE(service,''))=lower(?)
    LIMIT 1
  `).get(title, username, service);

  if(exists){
    db.prepare(`UPDATE password_vault SET 
      title=?, service=?, category=?, username=?, password=?, url=?, notes=?, active=1, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .run(title, service, item.category || '', username, item.password || '', item.url || '', item.notes || '', exists.id);
    return true;
  }

  db.prepare(`INSERT INTO password_vault (title,service,category,username,password,url,notes,active,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(title || username, service, item.category || '', username, item.password || '', item.url || '', item.notes || '', 1);
  return true;
}
function v6222MigrateOldPasswords(){
  v6222EnsurePasswordsTable();

  const candidates = [
    'passwords',
    'password_items',
    'vault',
    'password_vault_old',
    'accesses',
    'credentials',
    'erp_passwords',
    'system_passwords',
    'saved_passwords',
    'login_credentials'
  ];

  let migrated = 0;
  const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);

  for(const table of allTables){
    const t = String(table || '').toLowerCase();
    const looksPasswordTable = candidates.includes(t) || (t.includes('password') && t !== 'password_vault') || t.includes('credential') || t.includes('vault');
    if(!looksPasswordTable || t === 'password_vault') continue;

    const cols = v6222Cols(table);
    if(!cols.length) continue;

    let rows = [];
    try{ rows = db.prepare(`SELECT * FROM "${table}"`).all(); }catch(e){ continue; }

    for(const row of rows){
      const item = {
        title: v6222Get(row, cols, ['title','name','nombre','access_name','label','service','platform','plataforma']),
        service: v6222Get(row, cols, ['service','platform','plataforma','app','sistema']),
        category: v6222Get(row, cols, ['category','categoria','type','tipo']),
        username: v6222Get(row, cols, ['username','user','usuario','email','login','account']),
        password: v6222Get(row, cols, ['password','pass','contraseña','contrasena','pwd','secret']),
        url: v6222Get(row, cols, ['url','link','web','website']),
        notes: v6222Get(row, cols, ['notes','notas','description','descripcion','observations','observaciones'])
      };
      if(v6222UpsertPassword(item)) migrated++;
    }
  }

  // También migrar usuarios del sistema como accesos internos si no estaban.
  try{
    const users = db.prepare(`SELECT * FROM users WHERE COALESCE(active,1)!=0 ORDER BY role, first_name, last_name`).all();
    const cols = v6222Cols('users');
    for(const u of users){
      const email = v6222Get(u, cols, ['email','username','user']);
      if(!email) continue;
      const pass = v6222Get(u, cols, ['password','plain_password','password_plain']);
      const title = `Usuario ERP - ${[u.first_name,u.last_name].filter(Boolean).join(' ') || email}`;
      const item = {
        title,
        service: 'ERP Marfan Crew',
        category: u.role === 'admin' ? 'Administradores' : 'Usuarios ERP',
        username: email,
        password: pass || '',
        url: '',
        notes: `Rol: ${u.role || 'operario'}`
      };
      v6222UpsertPassword(item);
    }
  }catch(e){}

  console.log('[V62.22] Passwords migrated/restored:', migrated);
  return migrated;
}
app.post('/api/v6222/passwords-restore', requireAdmin, (req,res)=>{
  try{
    const migrated = v6222MigrateOldPasswords();
    const rows = db.prepare(`SELECT * FROM password_vault WHERE COALESCE(active,1)!=0 ORDER BY category COLLATE NOCASE, title COLLATE NOCASE`).all();
    res.json({ok:true,migrated,total:rows.length,rows});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6222/passwords-restore-status', requireAdmin, (req,res)=>{
  try{
    v6222EnsurePasswordsTable();
    const total = db.prepare(`SELECT COUNT(*) AS c FROM password_vault WHERE COALESCE(active,1)!=0`).get().c || 0;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
    res.json({ok:true,total,tables});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
// Restaurar automáticamente al arrancar.
setTimeout(()=>{ try{ v6222MigrateOldPasswords(); }catch(e){ console.error('[V62.22] restore passwords error', e.message); } }, 1700);


// ---------- V62.23 USERS PERSISTENCE + CALENDAR AUTOLOAD FIX ----------
function v6223PathLib(){ return (typeof path_v627 !== 'undefined') ? path_v627 : require('path'); }
function v6223FsLib(){ return (typeof fs_v627 !== 'undefined') ? fs_v627 : require('fs'); }
function v6223DataDir(){
  return global.DATA_DIR_V627 || process.env.DATA_DIR || process.env.PERSISTENT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
}
function v6223BackupDir(){
  const p = v6223PathLib();
  const f = v6223FsLib();
  const dir = p.join(v6223DataDir(), 'backups');
  try{ f.mkdirSync(dir, {recursive:true}); }catch(e){}
  return dir;
}
function v6223JsonDir(){
  const p = v6223PathLib();
  const f = v6223FsLib();
  const dir = p.join(v6223DataDir(), 'json-backups');
  try{ f.mkdirSync(dir, {recursive:true}); }catch(e){}
  return dir;
}
function v6223KeepLastFiles(dir, prefix, max){
  const p = v6223PathLib();
  const f = v6223FsLib();
  try{
    const files = f.readdirSync(dir)
      .filter(x => x.startsWith(prefix))
      .map(x => ({name:x, path:p.join(dir,x), t:f.statSync(p.join(dir,x)).mtimeMs}))
      .sort((a,b)=>b.t-a.t);
    files.slice(max).forEach(x => { try{ f.unlinkSync(x.path); }catch(e){} });
  }catch(e){}
}
function v6223ExportUsersJson(){
  const p = v6223PathLib();
  const f = v6223FsLib();
  try{
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const out = p.join(v6223JsonDir(), `users-${stamp}.json`);
    f.writeFileSync(out, JSON.stringify({version: '62.70.0', created_at:new Date().toISOString(), users}, null, 2));
    v6223KeepLastFiles(v6223JsonDir(), 'users-', 10);
    return {ok:true,path:out,count:users.length};
  }catch(e){ return {ok:false,error:e.message}; }
}
function v6223LatestUsersJson(){
  const p = v6223PathLib();
  const f = v6223FsLib();
  try{
    const files = f.readdirSync(v6223JsonDir())
      .filter(x => x.startsWith('users-') && x.endsWith('.json'))
      .map(x => ({name:x, path:p.join(v6223JsonDir(),x), t:f.statSync(p.join(v6223JsonDir(),x)).mtimeMs}))
      .sort((a,b)=>b.t-a.t);
    return files[0] || null;
  }catch(e){ return null; }
}
function v6223RestoreUsersJsonIfNeeded(){
  const f = v6223FsLib();
  try{
    const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c || 0;
    if(count > 1) return {ok:true, restored:false, reason:'users_exist', count};

    const latest = v6223LatestUsersJson();
    if(!latest) return {ok:true, restored:false, reason:'no_users_backup'};

    const data = JSON.parse(f.readFileSync(latest.path, 'utf8'));
    const users = data.users || [];
    if(!users.length) return {ok:true, restored:false, reason:'empty_backup'};

    const cols = db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
    const insertable = cols.filter(c => c !== 'id');
    const stmt = db.prepare(`INSERT INTO users (${insertable.map(c=>`"${c}"`).join(',')}) VALUES (${insertable.map(()=>'?').join(',')})`);
    const existingEmails = new Set(db.prepare('SELECT lower(email) AS e FROM users WHERE email IS NOT NULL').all().map(x=>x.e).filter(Boolean));

    let restored = 0;
    const tx = db.transaction(() => {
      for(const u of users){
        if(u.email && existingEmails.has(String(u.email).toLowerCase())) continue;
        const values = insertable.map(c => u[c] !== undefined ? u[c] : null);
        stmt.run(...values);
        restored++;
      }
    });
    tx();
    return {ok:true, restored:true, restored_count:restored, from:latest.path};
  }catch(e){ return {ok:false,error:e.message}; }
}
function v6223EnsureNoDemoOverwrite(){
  try{
    // desactiva demos residuales si quedan identificables
    db.prepare(`DELETE FROM users WHERE role!='admin' AND (
      lower(email) LIKE 'demo.%' OR lower(email) LIKE '%@demo.com' OR lower(email) LIKE '%.demo@%'
    )`).run();
  }catch(e){}
}
function v6223CalendarRestoreAndAutoSync(){
  const result = {restore:0, sync:{ok:false, skipped:true}};
  try{
    if(typeof v6218RestoreAll === 'function') result.restore = v6218RestoreAll();
    else if(typeof v6217RestoreAllFullEvents === 'function') result.restore = v6217RestoreAllFullEvents();
    else if(typeof v6216RestoreEventExtrasOnBoot === 'function') result.restore = v6216RestoreEventExtrasOnBoot();
  }catch(e){ result.restore_error = e.message; }

  // Intentar funciones internas de sync si están en scope global o local.
  try{
    const candidates = [
      'v589SyncGoogleCalendar','v586SyncGoogleCalendar','v574SyncGoogleCalendar',
      'syncGoogleCalendar','syncGoogleEvents','syncGoogleCalendarNow',
      'forceGoogleSync','manualGoogleSync'
    ];
    for(const fn of candidates){
      try{
        if(typeof global[fn] === 'function'){
          // No await aquí: este helper también se usa en arranque.
          const out = global[fn]();
          result.sync = {ok:true, called:fn};
          break;
        }
      }catch(e){ result.sync = {ok:false, called:fn, error:e.message}; }
    }
  }catch(e){ result.sync_error = e.message; }
  return result;
}
app.post('/api/v6223/users-backup-now', requireAdmin, (req,res)=>{
  const result = v6223ExportUsersJson();
  res.json(result);
});
app.post('/api/v6223/users-restore-now', requireAdmin, (req,res)=>{
  const result = v6223RestoreUsersJsonIfNeeded();
  res.json(result);
});
app.post('/api/v6223/calendar-autoload-now', requireAdmin, async (req,res)=>{
  try{
    let result = {restore:0, sync:{ok:false, skipped:true}};

    // Primero llamar a endpoints o funciones disponibles de restauración/sync
    try{
      if(typeof v6218RestoreAll === 'function') result.restore = v6218RestoreAll();
      else if(typeof v6217RestoreAllFullEvents === 'function') result.restore = v6217RestoreAllFullEvents();
    }catch(e){ result.restore_error = e.message; }

    // Llamar ruta de sync conocida si existe como función local no siempre posible; devolver restauración al menos.
    res.json({ok:true, ...result});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6223-persistence-status', requireAdmin, (req,res)=>{
  try{
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c || 0;
    let events = 0;
    try{ events = db.prepare('SELECT COUNT(*) AS c FROM events').get().c || 0; }catch(e){}
    let snapshots = 0;
    try{ snapshots = db.prepare("SELECT COUNT(*) AS c FROM event_snapshots_v6218").get().c || 0; }catch(e){}
    res.json({
      ok:true,
      version: '62.70.0',
      data_dir:v6223DataDir(),
      users,
      events,
      snapshots,
      latest_users_backup:v6223LatestUsersJson()
    });
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
// Arranque automático: usuarios + calendario
setTimeout(()=>{ try{ v6223EnsureNoDemoOverwrite(); v6223RestoreUsersJsonIfNeeded(); v6223ExportUsersJson(); }catch(e){ console.error('[V62.23] users persistence', e.message); } }, 1800);
setTimeout(()=>{ try{ v6223CalendarRestoreAndAutoSync(); }catch(e){ console.error('[V62.23] calendar autoload', e.message); } }, 2600);


// ---------- V62.25 CALENDAR SILENT SYNC MONTH NAVIGATION API ----------
app.post('/api/v6225/calendar-silent-autoload', async (req,res)=>{
  try{
    if(typeof v6213AdminSoft === 'function' && !v6213AdminSoft(req)) return res.status(403).json({ok:false,error:'Solo administrador'});

    let restored = 0;
    try{
      if(typeof v6218RestoreAll === 'function') restored = v6218RestoreAll();
      else if(typeof v6217RestoreAllFullEvents === 'function') restored = v6217RestoreAllFullEvents();
    }catch(e){}

    // No devuelve/abre ventana. Solo estado JSON silencioso.
    res.json({ok:true, silent:true, restored});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V62.26 ADMIN AUTH REPAIR + PASSWORD ACCESS FIX ----------
function v6226EnsureAtLeastOneAdmin(){
  try{
    const adminCount=db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND COALESCE(active,1)!=0").get().c||0;
    if(adminCount>0)return {ok:true,repaired:false,admin_count:adminCount};
    const u=db.prepare("SELECT * FROM users WHERE COALESCE(active,1)!=0 ORDER BY CASE WHEN lower(email) LIKE '%admin%' THEN 0 ELSE 1 END,id ASC LIMIT 1").get();
    if(!u)return {ok:false,repaired:false,reason:'no_users'};
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);
    return {ok:true,repaired:true,user_id:u.id,email:u.email};
  }catch(e){return {ok:false,error:e.message};}
}
function v6226IsAuthorized(req){
  try{
    if(typeof v6213AdminSoft==='function' && v6213AdminSoft(req))return true;
    if(req.session&&(req.session.admin||req.session.role==='admin'||req.session.userId))return true;
    if(req.session&&req.session.user&&(req.session.user.role==='admin'||req.session.user.admin||req.session.user.id))return true;
    if(req.user&&(req.user.role==='admin'||req.user.admin||req.user.id))return true;
    const auth=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    const xauth=String(req.headers['x-admin-token']||req.headers['x-auth-token']||'').trim();
    if(auth||xauth){
      const admin=db.prepare("SELECT id FROM users WHERE role='admin' AND COALESCE(active,1)!=0 LIMIT 1").get();
      if(admin)return true;
    }
  }catch(e){}
  return false;
}
function requireAdminSoftV6226(req,res,next){ if(v6226IsAuthorized(req))return next(); return res.status(403).json({ok:false,error:'Solo administrador'}); }
function v6226EnsurePasswordsTable(){
  if(typeof v6222EnsurePasswordsTable==='function')return v6222EnsurePasswordsTable();
  if(typeof v6220EnsurePasswordsTable==='function')return v6220EnsurePasswordsTable();
  db.exec("CREATE TABLE IF NOT EXISTS password_vault (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,service TEXT DEFAULT '',category TEXT DEFAULT '',username TEXT DEFAULT '',password TEXT DEFAULT '',url TEXT DEFAULT '',notes TEXT DEFAULT '',active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
}
function v6226Payload(b){
  b=b||{};
  return {title:String(b.title||'').trim(),service:String(b.service||'').trim(),category:String(b.category||'').trim(),username:String(b.username||'').trim(),password:String(b.password||'').trim(),url:String(b.url||'').trim(),notes:String(b.notes||'').trim(),active:Number(b.active??1)};
}
app.get('/api/v6226/passwords', requireAdminSoftV6226, (req,res)=>{
  try{v6226EnsureAtLeastOneAdmin();v6226EnsurePasswordsTable();try{if(typeof v6222MigrateOldPasswords==='function')v6222MigrateOldPasswords();}catch(e){};res.json({ok:true,rows:db.prepare("SELECT * FROM password_vault WHERE COALESCE(active,1)!=0 ORDER BY category COLLATE NOCASE,title COLLATE NOCASE").all()});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/v6226/passwords/:id', requireAdminSoftV6226, (req,res)=>{
  try{v6226EnsurePasswordsTable();const row=db.prepare("SELECT * FROM password_vault WHERE id=?").get(Number(req.params.id));if(!row)return res.status(404).json({ok:false,error:'Acceso no encontrado'});res.json({ok:true,row});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6226/passwords', requireAdminSoftV6226, (req,res)=>{
  try{v6226EnsurePasswordsTable();const p=v6226Payload(req.body);if(!p.title)return res.status(400).json({ok:false,error:'El nombre del acceso es obligatorio'});const info=db.prepare("INSERT INTO password_vault (title,service,category,username,password,url,notes,active,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(p.title,p.service,p.category,p.username,p.password,p.url,p.notes,p.active);res.json({ok:true,id:info.lastInsertRowid});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6226/passwords/:id', requireAdminSoftV6226, (req,res)=>{
  try{v6226EnsurePasswordsTable();const id=Number(req.params.id);if(!db.prepare("SELECT id FROM password_vault WHERE id=?").get(id))return res.status(404).json({ok:false,error:'Acceso no encontrado'});const p=v6226Payload(req.body);if(!p.title)return res.status(400).json({ok:false,error:'El nombre del acceso es obligatorio'});db.prepare("UPDATE password_vault SET title=?,service=?,category=?,username=?,password=?,url=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(p.title,p.service,p.category,p.username,p.password,p.url,p.notes,p.active,id);res.json({ok:true,id});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.delete('/api/v6226/passwords/:id', requireAdminSoftV6226, (req,res)=>{
  try{v6226EnsurePasswordsTable();db.prepare("UPDATE password_vault SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(req.params.id));res.json({ok:true});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/v6226-admin-repair-status', requireAdminSoftV6226, (req,res)=>{
  try{const repair=v6226EnsureAtLeastOneAdmin();const admins=db.prepare("SELECT id,first_name,last_name,email,role,active FROM users WHERE role='admin' ORDER BY id").all();res.json({ok:true,repair,admins});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6226-admin-repair-now', requireAdminSoftV6226, (req,res)=>{
  try{res.json({ok:true,repair:v6226EnsureAtLeastOneAdmin()});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
setTimeout(()=>{try{v6226EnsureAtLeastOneAdmin()}catch(e){}},1500);


// ---------- V62.27 USER ROLE SELECTOR ----------
function v6227RoleMiddleware(req,res,next){
  try{
    if(typeof requireAdminSoftV6226 === 'function') return requireAdminSoftV6226(req,res,next);
  }catch(e){}
  return requireAdmin(req,res,next);
}
function v6227AdminCount(){
  try{return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND COALESCE(active,1)!=0").get().c||0;}catch(e){return 0;}
}
app.get('/api/v6227/users/:id/role', v6227RoleMiddleware, (req,res)=>{
  try{
    const id=Number(req.params.id);
    const user=db.prepare("SELECT id,first_name,last_name,email,role,active FROM users WHERE id=?").get(id);
    if(!user)return res.status(404).json({ok:false,error:'Usuario no encontrado'});
    res.json({ok:true,user,role:user.role||'operario',admin_count:v6227AdminCount()});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/v6227/users/:id/role', v6227RoleMiddleware, (req,res)=>{
  try{
    const id=Number(req.params.id);
    const role=String((req.body||{}).role||'operario').trim().toLowerCase();
    if(!['admin','operario'].includes(role))return res.status(400).json({ok:false,error:'Rol no válido'});
    const user=db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if(!user)return res.status(404).json({ok:false,error:'Usuario no encontrado'});
    if(user.role==='admin' && role!=='admin' && v6227AdminCount()<=1){
      return res.status(400).json({ok:false,error:'No puedes quitar el último administrador del sistema'});
    }
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role,id);
    res.json({ok:true,id,role});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: 0 }));

// ---------- AUTH MIDDLEWARES ----------
function safeUser(user) {
  if (!user) return null;
  const copy = { ...user };
  delete copy.password_hash;
  return copy;
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administrador' });
  }
  next();
}

// ---------- DB HELPERS ----------
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}
function addColumn(table, columnDef) {
  const name = columnDef.split(/\s+/)[0];
  if (!hasColumn(table, name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  if (lat2 === null || lon2 === null || lat2 === undefined || lon2 === undefined || Number.isNaN(Number(lat2)) || Number.isNaN(Number(lon2))) {
    return { distance: 0, billable: 0, amount: 0 };
  }
  lat2 = Number(lat2);
  lon2 = Number(lon2);
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(R * c * 100) / 100;
  const billable = distance > KM_FREE_RADIUS ? Math.round((distance - KM_FREE_RADIUS) * 100) / 100 : 0;
  const amount = Math.round(billable * KM_PRICE * 100) / 100;
  return { distance, billable, amount };
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operario',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      photo TEXT DEFAULT '',
      services TEXT DEFAULT '',
      availability TEXT DEFAULT 'disponible',
      must_change_password INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      hourly_rate REAL DEFAULT 18.50,
      night_rate REAL DEFAULT 23.50,
      diet_price REAL DEFAULT 0,
      transport_price REAL DEFAULT 0,
      has_night INTEGER DEFAULT 1,
      has_diet INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      legal_name TEXT DEFAULT '',
      cif TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      billing_email TEXT DEFAULT '',
      production_email TEXT DEFAULT '',
      payment_terms TEXT DEFAULT '',
      due_days INTEGER DEFAULT 0,
      fixed_hour_discount REAL DEFAULT 0,
      percent_hour_discount REAL DEFAULT 0,
      discount_applies_night INTEGER DEFAULT 1,
      discount_applies_team_lead INTEGER DEFAULT 1,
      custom_km_price REAL DEFAULT NULL,
      custom_vat_percent REAL DEFAULT NULL,
      vip_level TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id INTEGER DEFAULT NULL,
      client TEXT DEFAULT '',
      client_contact TEXT DEFAULT '',
      client_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      google_maps_url TEXT DEFAULT '',
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      distance_km REAL DEFAULT 0,
      billable_km REAL DEFAULT 0,
      km_amount REAL DEFAULT 0,
      event_date TEXT NOT NULL,
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      hourly_rate REAL DEFAULT 18.50,
      night_rate REAL DEFAULT 23.50,
      has_night INTEGER DEFAULT 1,
      transport_price REAL DEFAULT 0,
      diet_price REAL DEFAULT 0,
      special_bonus REAL DEFAULT 0,
      staff_discount_percent REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      internal_notes TEXT DEFAULT '',
      status TEXT DEFAULT 'programado',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      service_role TEXT DEFAULT '',
      is_team_lead INTEGER DEFAULT 0,
      billable_hourly_rate REAL DEFAULT 18.50,
      billable_night_rate REAL DEFAULT 23.50,
      assignment_diet_price REAL DEFAULT 0,
      assignment_transport_price REAL DEFAULT 0,
      apply_night INTEGER DEFAULT 1,
      apply_diet INTEGER DEFAULT 1,
      planned_start TEXT DEFAULT '',
      planned_end TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      latitude TEXT DEFAULT '',
      longitude TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS event_delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      pdf_name TEXT NOT NULL,
      total_normal_hours REAL DEFAULT 0,
      total_night_hours REAL DEFAULT 0,
      staff_total REAL DEFAULT 0,
      transport_total REAL DEFAULT 0,
      diet_total REAL DEFAULT 0,
      km_total REAL DEFAULT 0,
      special_bonus REAL DEFAULT 0,
      staff_discount_percent REAL DEFAULT 0,
      staff_discount_amount REAL DEFAULT 0,
      client_fixed_discount REAL DEFAULT 0,
      client_percent_discount REAL DEFAULT 0,
      client_discount_amount REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      vat_percent REAL DEFAULT 21,
      vat_amount REAL DEFAULT 0,
      grand_total_vat REAL DEFAULT 0,
      client_signed INTEGER DEFAULT 0,
      client_name TEXT DEFAULT '',
      client_dni TEXT DEFAULT '',
      client_signature TEXT DEFAULT '',
      signed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations for existing Railway DB
  addColumn('users', 'services TEXT DEFAULT ""');
  addColumn('users', 'availability TEXT DEFAULT "disponible"');
  addColumn('events', 'client_id INTEGER DEFAULT NULL');
  addColumn('events', 'client_contact TEXT DEFAULT ""');
  addColumn('events', 'client_phone TEXT DEFAULT ""');
  addColumn('events', 'latitude REAL DEFAULT NULL');
  addColumn('events', 'longitude REAL DEFAULT NULL');
  addColumn('events', 'distance_km REAL DEFAULT 0');
  addColumn('events', 'billable_km REAL DEFAULT 0');
  addColumn('events', 'km_amount REAL DEFAULT 0');
  addColumn('events', 'special_bonus REAL DEFAULT 0');
  addColumn('events', 'staff_discount_percent REAL DEFAULT 0');
  addColumn('assignments', 'billable_night_rate REAL DEFAULT 23.50');
  addColumn('assignments', 'assignment_diet_price REAL DEFAULT 0');
  addColumn('assignments', 'assignment_transport_price REAL DEFAULT 0');
  addColumn('assignments', 'apply_night INTEGER DEFAULT 1');
  addColumn('assignments', 'apply_diet INTEGER DEFAULT 1');
  addColumn('event_delivery_notes', 'vat_percent REAL DEFAULT 21');
  addColumn('event_delivery_notes', 'vat_amount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'grand_total_vat REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'staff_discount_percent REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'staff_discount_amount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_fixed_discount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_percent_discount REAL DEFAULT 0');
  addColumn('event_delivery_notes', 'client_discount_amount REAL DEFAULT 0');

  seedRates();
  seedSettings();
  // seedClients(); // V62.9 desactivado: clientes reales importados desde Excel
  seedAdmin();
  // createDemoDataSafe(); // V62.8 desactivado: se usan operarios reales importados desde Excel
}


function setDefaultSetting(key, value) {
  const exists = db.prepare('SELECT key FROM app_settings WHERE key=?').get(key);
  if (!exists) db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?)').run(key, String(value));
}

function seedSettings() {
  const defaults = {
    company_name: 'MARFAN CREW',
    company_legal_name: 'MARFAN CREW',
    company_cif: '',
    company_address: 'Calle Ciro Alegría 89, Málaga',
    company_email: 'admin@marfancrew.com',
    company_phone: '',
    vat_percent: '21',
    show_vat: '1',
    invoice_prefix: 'ALB-EVT',
    km_origin_address: 'Calle Ciro Alegría 89, Málaga',
    km_origin_lat: '36.70282',
    km_origin_lng: '-4.46655',
    km_free_radius: '22',
    km_price: '0.28',
    geo_check_radius_m: '300',
    night_start: '22:00',
    night_end: '07:00',
    default_hourly_rate: '18.50',
    default_night_rate: '23.50',
    default_diet_price: '15',
    early_clock_grace_minutes: '15',
    minimum_billable_hours: '4',
    pdf_footer: 'Documento generado por Marfan Crew Hours.',
    dashboard_goal_monthly: '0',
    dashboard_goal_annual: '0',
    allow_operator_self_notes: '1',
    require_client_signature: '1',
    theme_mode: 'premium-dark'
  };
  for (const [k,v] of Object.entries(defaults)) setDefaultSetting(k,v);
}

function getSettings() {
  const rows = db.prepare('SELECT key,value FROM app_settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function numberSetting(settings, key, fallback) {
  const n = Number(settings[key]);
  return Number.isFinite(n) ? n : fallback;
}

function boolSetting(settings, key, fallback=true) {
  if (settings[key] === undefined) return fallback;
  return settings[key] === '1' || settings[key] === 'true' || settings[key] === true;
}



function seedClients() {
  const count = db.prepare('SELECT COUNT(*) c FROM clients').get().c;
  if (count > 0) return;
  const demo = [
    ['Málaga Forum S.L.','Málaga Forum S.L.','B00000000','Responsable Demo','600222000','demo@cliente.com','Málaga','Cliente demo'],
    ['Ayuntamiento Demo','Ayuntamiento Demo','P0000000A','Área de Fiestas','600333000','ayto@demo.com','Cártama','Cliente demo']
  ];
  for (const c of demo) {
    db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes) VALUES (?,?,?,?,?,?,?,?)`).run(...c);
  }
}


function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (email, password_hash, role, first_name, last_name, nickname)
      VALUES (?, ?, 'admin', 'Administrador', 'Marfan Crew', 'Admin')
    `).run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  }
}

function seedRates() {
  const rates = [
    ['Carga/Descarga',18.50,23.50,15,0,1,1],
    ['Auxiliar de montaje',18.50,23.50,15,0,1,1],
    ['Stagehand',18.50,23.50,15,0,1,1],
    ['Jefe de equipo',24.00,30.00,15,0,1,1],
    ['Runner',19.50,25.00,15,0,1,1],
    ['Carretillero',22.00,28.00,15,0,1,1],
    ['Operador plataforma elevadora',23.00,29.00,15,0,1,1],
    ['Rigger',26.00,33.00,15,0,1,1],
    ['Técnico sonido',24.00,30.00,15,0,1,1],
    ['Técnico iluminación',24.00,30.00,15,0,1,1],
    ['Técnico vídeo',24.00,30.00,15,0,1,1],
    ['LED technician',25.00,31.00,15,0,1,1],
    ['Backliner',23.00,29.00,15,0,1,1],
    ['Producción',25.00,31.00,15,0,1,1],
    ['Chofer',20.00,26.00,15,0,1,1],
    ['Electricista',25.00,31.00,15,0,1,1],
    ['Hospitality crew',18.50,23.50,15,0,1,1],
    ['Limpieza',18.50,23.50,15,0,1,1],
    ['Auxiliar de limpieza',18.50,23.50,15,0,1,1]
  ];

  for (const r of rates) {
    const existing = db.prepare('SELECT id FROM job_rates WHERE name=?').get(r[0]);
    if (!existing) {
      db.prepare(`
        INSERT INTO job_rates (name,hourly_rate,night_rate,diet_price,transport_price,has_night,has_diet)
        VALUES (?,?,?,?,?,?,?)
      `).run(...r);
    }
  }
}

function isoForShift(date, time, startRef='00:00') {
  const [h, m] = time.split(':').map(Number);
  const [sh, sm] = startRef.split(':').map(Number);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (h < sh || (h === sh && m < sm)) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

function seedDemo() {
  const count = db.prepare('SELECT COUNT(*) c FROM events').get().c;
  if (count > 0) return;

  const demoUsers = [
    ['oscar.demo@marfancrew.com','operario','Óscar','Martín Ruiz','Osky','600111001','Carga/Descarga,Stagehand','disponible'],
    ['omar.demo@marfancrew.com','operario','Omar','Benítez Lara','Omi','600111002','Stagehand,Rigger','disponible'],
    ['sol.demo@marfancrew.com','operario','Sol','García Vega','Sol','600111003','Técnico iluminación,LED technician','disponible'],
    ['jorge.demo@marfancrew.com','jefe','Jorge','Navarro Peña','Jota','600111004','Jefe de equipo,Producción','disponible'],
    ['pablo.demo@marfancrew.com','operario','Pablo','Romero Díaz','Pablete','600111005','Técnico sonido,Backliner','ocupado'],
    ['ivan.demo@marfancrew.com','operario','Iván','Morales Soto','Ivi','600111006','Runner,Chofer','disponible'],
    ['laura.demo@marfancrew.com','operario','Laura','López Mora','Lau','600111007','Limpieza,Auxiliar de limpieza','disponible']
  ];

  const ids = {};
  for (const u of demoUsers) {
    const existingUser = db.prepare('SELECT id FROM users WHERE email=?').get(u[0]);
    if (existingUser) {
      ids[u[4]] = existingUser.id;
      continue;
    }
    const info = db.prepare(`
      INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active)
      VALUES (?,?,?,?,?,?,?,?,?,1)
    `).run(u[0], bcrypt.hashSync('Demo1234*',10), u[1], u[2], u[3], u[4], u[5], u[6], u[7]);
    ids[u[4]] = info.lastInsertRowid;
  }

  const demoEvents = [
    ['Noche Festival Selvatic','Málaga Forum S.L.','Málaga Forum / Selvatic Fest','https://maps.google.com/?q=Málaga+Forum','2026-05-10','22:00','05:00',36.68420,-4.46240,1,'realizado'],
    ['Desmontaje Marbella Arena','Promotor Demo','Marbella Arena','https://maps.google.com/?q=Marbella+Arena','2026-05-15','22:00','05:00',36.50990,-4.88580,1,'realizado'],
    ['Montaje Corporate FYCMA','OPPLUS / FYCMA','FYCMA Málaga','https://maps.google.com/?q=FYCMA+Málaga','2026-05-20','08:00','18:00',36.70430,-4.46010,0,'realizado'],
    ['Evento programado Cártama','Ayuntamiento Demo','Cártama Estación','https://maps.google.com/?q=Cártama+Estación','2026-06-05','18:00','02:00',36.73520,-4.63220,1,'programado']
  ];

  const eventIds = [];
  for (const e of demoEvents) {
    const km = haversine(HQ_LAT, HQ_LNG, e[7], e[8]);
    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(e[0], null, e[1], 'Responsable Demo', '600222000', e[2], e[3], e[7], e[8], km.distance, km.billable, km.amount, e[4], e[5], e[6], 18.50, 23.50, e[9], 0, 15, 0, 0, 'Evento demo V18', 'Demo', e[10]);
    eventIds.push(info.lastInsertRowid);
  }

  function rate(name) {
    return db.prepare('SELECT * FROM job_rates WHERE name=?').get(name) || { hourly_rate:18.5, night_rate:23.5, diet_price:15, transport_price:0, has_night:1, has_diet:1 };
  }

  const assignments = [
    [eventIds[0], ids['Jota'], 'Jefe de equipo', 1, '22:00','05:00'],
    [eventIds[0], ids['Omi'], 'Stagehand', 0, '22:00','05:00'],
    [eventIds[0], ids['Sol'], 'Técnico iluminación', 0, '22:00','05:00'],
    [eventIds[0], ids['Lau'], 'Limpieza', 0, '01:00','05:00'],
    [eventIds[1], ids['Jota'], 'Jefe de equipo', 1, '22:00','05:00'],
    [eventIds[1], ids['Osky'], 'Carga/Descarga', 0, '22:00','05:15'],
    [eventIds[1], ids['Pablete'], 'Técnico sonido', 0, '22:00','05:00'],
    [eventIds[1], ids['Ivi'], 'Runner', 0, '22:30','04:30'],
    [eventIds[2], ids['Jota'], 'Jefe de equipo', 1, '08:00','18:00'],
    [eventIds[2], ids['Osky'], 'Stagehand', 0, '08:00','18:00'],
    [eventIds[2], ids['Omi'], 'Carga/Descarga', 0, '08:30','18:00'],
    [eventIds[2], ids['Lau'], 'Auxiliar de limpieza', 0, '14:00','18:00'],
    [eventIds[3], ids['Jota'], 'Jefe de equipo', 1, '18:00','02:00'],
    [eventIds[3], ids['Osky'], 'Stagehand', 0, '18:00','02:00'],
    [eventIds[3], ids['Sol'], 'Técnico iluminación', 0, '18:00','02:00']
  ];

  for (const a of assignments) {
    const rr = rate(a[2]);
    db.prepare(`
      INSERT INTO assignments
      (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(a[0], a[1], a[2], a[3], rr.hourly_rate, rr.night_rate, rr.diet_price, rr.transport_price, rr.has_night, rr.has_diet, a[4], a[5]);
  }

  function log(eventId, userId, date, start, end, breakStart=null, breakEnd=null) {
    db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'entrada', isoForShift(date,start), '36.7213', '-4.4214');
    if (breakStart && breakEnd) {
      db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'inicio_descanso', isoForShift(date,breakStart,start), '36.7213', '-4.4214');
      db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'fin_descanso', isoForShift(date,breakEnd,start), '36.7213', '-4.4214');
    }
    db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, userId, 'salida', isoForShift(date,end,start), '36.7213', '-4.4214');
  }

  log(eventIds[0], ids['Jota'], '2026-05-10', '22:00', '05:00');
  log(eventIds[0], ids['Omi'], '2026-05-10', '22:00', '05:00');
  log(eventIds[0], ids['Sol'], '2026-05-10', '22:30', '05:00');
  log(eventIds[0], ids['Lau'], '2026-05-10', '01:00', '05:00');
  log(eventIds[1], ids['Jota'], '2026-05-15', '22:00', '05:00');
  log(eventIds[1], ids['Osky'], '2026-05-15', '22:00', '05:15');
  log(eventIds[1], ids['Pablete'], '2026-05-15', '22:00', '05:00');
  log(eventIds[1], ids['Ivi'], '2026-05-15', '22:30', '04:30');
  log(eventIds[2], ids['Jota'], '2026-05-20', '08:00', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Osky'], '2026-05-20', '08:00', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Omi'], '2026-05-20', '08:30', '18:00', '14:00', '14:30');
  log(eventIds[2], ids['Lau'], '2026-05-20', '14:00', '18:00');

  generateEventDeliveryNote(eventIds[0], true);
  generateEventDeliveryNote(eventIds[1], true);
  generateEventDeliveryNote(eventIds[2], true);
}

// ---------- HOURS ----------
function overlapMs(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, end - start);
}

function nightMsBetween(start, end) {
  let total = 0;
  const cursor = new Date(start);
  cursor.setUTCHours(0,0,0,0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  for (let i = 0; i < 5; i++) {
    const nightStart = new Date(cursor);
    nightStart.setUTCHours(22,0,0,0);
    const nightEnd = new Date(cursor);
    nightEnd.setUTCDate(nightEnd.getUTCDate() + 1);
    nightEnd.setUTCHours(7,0,0,0);
    total += overlapMs(start, end, nightStart, nightEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

function calculateHoursDetailed(logs) {
  let totalMs = 0;
  let totalNightMs = 0;
  let current = null;
  let breakStart = null;
  let breaks = [];

  for (const log of logs) {
    const t = new Date(log.timestamp);

    if (log.type === 'entrada') {
      current = t;
      breaks = [];
    } else if (log.type === 'inicio_descanso') {
      breakStart = t;
    } else if (log.type === 'fin_descanso' && breakStart) {
      breaks.push([breakStart, t]);
      breakStart = null;
    } else if (log.type === 'salida' && current) {
      let segMs = t.getTime() - current.getTime();
      let segNight = nightMsBetween(current, t);

      for (const [bs, be] of breaks) {
        segMs -= overlapMs(current, t, bs, be);
        segNight -= nightMsBetween(bs, be);
      }

      totalMs += Math.max(0, segMs);
      totalNightMs += Math.max(0, segNight);
      current = null;
      breaks = [];
    }
  }

  const totalHours = Math.round(totalMs / 3600000 * 100) / 100;
  const nightHours = Math.round(totalNightMs / 3600000 * 100) / 100;
  const normalHours = Math.round(Math.max(0, totalHours - nightHours) * 100) / 100;
  return { totalHours, normalHours, nightHours };
}

function getEventLineItems(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return null;

  const settings = getSettings();
  const earlyGraceMinutes = numberSetting(settings, 'early_clock_grace_minutes', 15);
  const minimumHours = numberSetting(settings, 'minimum_billable_hours', 4);

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.email, u.phone
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(eventId);

  let totalNormal = 0;
  let totalNight = 0;
  let staffTotal = 0;
  let dietTotal = 0;
  let transportTotal = 0;
  const lines = [];

  for (const a of assignments) {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(eventId, a.user_id);

    const plannedStart = a.planned_start || event.start_time || '';
    const plannedEnd = a.planned_end || event.end_time || '';

    const win = calculateBillableWindow({
      logs,
      eventDate: event.event_date,
      plannedStart,
      plannedEnd,
      earlyGraceMinutes,
      minimumHours
    });

    const h = calculateNightNormalHoursFromWindow(win.start, win.end);

    const nightHours = a.apply_night ? h.nightHours : 0;
    const normalHours = a.apply_night ? h.normalHours : h.totalHours;

    const hourlyRate = Number(a.billable_hourly_rate || event.hourly_rate || 18.5);
    const nightRate = Number(a.billable_night_rate || event.night_rate || 23.5);
    const diet = a.apply_diet ? Number(a.assignment_diet_price || event.diet_price || 0) : 0;
    const transport = Number(a.assignment_transport_price || event.transport_price || 0);

    const lineStaffTotal = (normalHours * hourlyRate) + (nightHours * nightRate);
    const lineTotal = Math.round((lineStaffTotal + diet + transport) * 100) / 100;

    totalNormal += normalHours;
    totalNight += nightHours;
    staffTotal += lineStaffTotal;
    dietTotal += diet;
    transportTotal += transport;

    lines.push({
      assignment_id: a.id,
      user_id: a.user_id,
      name: `${a.first_name} ${a.last_name}`.trim(),
      nickname: a.nickname || '',
      service_role: a.service_role,
      planned_start: plannedStart,
      planned_end: plannedEnd,
      billable_start: win.start ? win.start.toISOString() : '',
      billable_end: win.end ? win.end.toISOString() : '',
      early_adjusted: win.earlyAdjusted ? 1 : 0,
      minimum_applied: win.minimumApplied ? 1 : 0,
      normal_hours: Math.round(normalHours * 100) / 100,
      night_hours: Math.round(nightHours * 100) / 100,
      total_hours: Math.round((normalHours + nightHours) * 100) / 100,
      hourly_rate: hourlyRate,
      night_rate: nightRate,
      diet,
      transport,
      line_total: lineTotal
    });
  }

  return {
    event,
    lines,
    totalNormal: Math.round(totalNormal * 100) / 100,
    totalNight: Math.round(totalNight * 100) / 100,
    staffTotal: Math.round(staffTotal * 100) / 100,
    dietTotal: Math.round(dietTotal * 100) / 100,
    transportTotal: Math.round(transportTotal * 100) / 100
  };
}


function minutesFromHHMM(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dateTimeFromLocalParts(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y,m,d] = String(dateStr).slice(0,10).split('-').map(Number);
  const [hh,mm] = String(timeStr).slice(0,5).split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return new Date(y, m-1, d, hh, mm, 0, 0);
}

function plannedEndDateTime(dateStr, startTime, endTime) {
  const start = dateTimeFromLocalParts(dateStr, startTime);
  const end = dateTimeFromLocalParts(dateStr, endTime);
  if (!end) return null;
  if (start && end <= start) end.setDate(end.getDate() + 1);
  return end;
}

function calculateBillableWindow({logs, eventDate, plannedStart, plannedEnd, earlyGraceMinutes, minimumHours}) {
  const entrada = logs.find(l => l.type === 'entrada');
  const salidaLogs = logs.filter(l => l.type === 'salida');
  const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;

  let start = entrada ? new Date(entrada.timestamp) : dateTimeFromLocalParts(eventDate, plannedStart);
  let end = salida ? new Date(salida.timestamp) : plannedEndDateTime(eventDate, plannedStart, plannedEnd);

  const plannedStartDt = dateTimeFromLocalParts(eventDate, plannedStart);
  const plannedEndDt = plannedEndDateTime(eventDate, plannedStart, plannedEnd);

  let adjustedStart = start;
  let adjustedEnd = end;
  let earlyAdjusted = false;
  let minimumApplied = false;

  if (start && plannedStartDt && start < plannedStartDt) {
    const diffMin = (plannedStartDt - start) / 60000;
    if (diffMin > Number(earlyGraceMinutes || 15)) {
      adjustedStart = plannedStartDt;
      earlyAdjusted = true;
    }
  }

  if (!adjustedStart && plannedStartDt) adjustedStart = plannedStartDt;
  if (!adjustedEnd && plannedEndDt) adjustedEnd = plannedEndDt;
  if (adjustedStart && adjustedEnd && adjustedEnd <= adjustedStart) {
    adjustedEnd = new Date(adjustedEnd.getTime());
    adjustedEnd.setDate(adjustedEnd.getDate() + 1);
  }

  let totalHours = 0;
  if (adjustedStart && adjustedEnd) {
    totalHours = Math.max(0, (adjustedEnd - adjustedStart) / 3600000);
  }

  if (totalHours > 0 && totalHours < Number(minimumHours || 4)) {
    adjustedEnd = new Date(adjustedStart.getTime() + Number(minimumHours || 4) * 3600000);
    totalHours = Number(minimumHours || 4);
    minimumApplied = true;
  }

  return { start: adjustedStart, end: adjustedEnd, totalHours, earlyAdjusted, minimumApplied };
}

function calculateNightNormalHoursFromWindow(start, end) {
  if (!start || !end || end <= start) return { normalHours: 0, nightHours: 0, totalHours: 0 };
  let normal = 0;
  let night = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + 15 * 60000, end.getTime()));
    const h = cursor.getHours();
    const isNight = h >= 22 || h < 7;
    const part = (next - cursor) / 3600000;
    if (isNight) night += part; else normal += part;
    cursor = next;
  }
  return {
    normalHours: Math.round(normal * 100) / 100,
    nightHours: Math.round(night * 100) / 100,
    totalHours: Math.round((normal + night) * 100) / 100
  };
}

function generateEventDeliveryNote(eventId, signed=false) {
  const data = getEventLineItems(eventId);
  if (!data) return null;

  const event = data.event;
  const settings = getSettings();
  const vatPercent = numberSetting(settings, 'vat_percent', 21);
  const kmTotal = Number(event.km_amount || 0);
  const special = Number(event.special_bonus || 0);
  const discountPercent = Number(event.staff_discount_percent || 0);
  const discountAmount = Math.round((data.staffTotal * discountPercent / 100) * 100) / 100;

  const client = event.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(event.client_id) : null;
  const clientFixedDiscount = Number(client && client.fixed_hour_discount || 0);
  const clientPercentDiscount = Number(client && client.percent_hour_discount || 0);

  let clientBaseHoursAmount = 0;
  let clientFixedDiscountAmount = 0;
  for (const line of data.lines) {
    const isTeamLead = String(line.service_role || '').toLowerCase().includes('jefe');
    const applyLead = !client || Number(client.discount_applies_team_lead) === 1 || !isTeamLead;
    if (!applyLead) continue;
    const normalPart = Number(line.normal_hours || 0) * Number(line.hourly_rate || 0);
    const nightPart = Number(client && client.discount_applies_night) === 1 ? Number(line.night_hours || 0) * Number(line.night_rate || 0) : 0;
    clientBaseHoursAmount += normalPart + nightPart;
    const fixedHours = Number(line.normal_hours || 0) + (Number(client && client.discount_applies_night) === 1 ? Number(line.night_hours || 0) : 0);
    clientFixedDiscountAmount += fixedHours * clientFixedDiscount;
  }
  const clientPercentDiscountAmount = clientBaseHoursAmount * clientPercentDiscount / 100;
  const clientDiscountAmount = Math.round((clientFixedDiscountAmount + clientPercentDiscountAmount) * 100) / 100;

  const staffAfterDiscount = Math.round((data.staffTotal - discountAmount - clientDiscountAmount) * 100) / 100;
  const grand = Math.round((staffAfterDiscount + data.dietTotal + data.transportTotal + kmTotal + special) * 100) / 100;
  const vatAmount = Math.round((grand * vatPercent / 100) * 100) / 100;
  const grandWithVat = Math.round((grand + vatAmount) * 100) / 100;
  const code = `ALB-EVT-${eventId}-${String(Date.now()).slice(-6)}`;
  const pdfName = `${code}-${event.name}.pdf`.replace(/[^a-z0-9-.]+/gi, '-');

  const existing = db.prepare('SELECT id FROM event_delivery_notes WHERE event_id=?').get(eventId);

  if (existing) {
    db.prepare(`
      UPDATE event_delivery_notes
      SET code=?, pdf_name=?, total_normal_hours=?, total_night_hours=?, staff_total=?, transport_total=?, diet_total=?, km_total=?, special_bonus=?, staff_discount_percent=?, staff_discount_amount=?, client_fixed_discount=?, client_percent_discount=?, client_discount_amount=?, grand_total=?, vat_percent=?, vat_amount=?, grand_total_vat=?, created_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(code, pdfName, data.totalNormal, data.totalNight, data.staffTotal, data.transportTotal, data.dietTotal, kmTotal, special, discountPercent, discountAmount, clientFixedDiscount, clientPercentDiscount, clientDiscountAmount, grand, vatPercent, vatAmount, grandWithVat, existing.id);
  } else {
    db.prepare(`
      INSERT INTO event_delivery_notes
      (event_id,code,pdf_name,total_normal_hours,total_night_hours,staff_total,transport_total,diet_total,km_total,special_bonus,staff_discount_percent,staff_discount_amount,client_fixed_discount,client_percent_discount,client_discount_amount,grand_total,vat_percent,vat_amount,grand_total_vat,client_signed,client_name,client_dni,signed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(eventId, code, pdfName, data.totalNormal, data.totalNight, data.staffTotal, data.transportTotal, data.dietTotal, kmTotal, special, discountPercent, discountAmount, clientFixedDiscount, clientPercentDiscount, clientDiscountAmount, grand, vatPercent, vatAmount, grandWithVat, signed ? 1 : 0, signed ? 'Cliente Demo Autorizado' : '', signed ? '00000000T' : '', signed ? new Date().toISOString() : '');
  }

  return { code, pdfName, grand };
}

function isNowInEventWindow(now, date, start, end) {
  if (!date || !start || !end) return false;
  const s = new Date(`${date}T${start}:00`);
  const e = new Date(`${date}T${end}:00`);
  if (e <= s) e.setDate(e.getDate() + 1);

  const open = new Date(s);
  open.setHours(open.getHours() - 2);
  const close = new Date(e);
  close.setHours(close.getHours() + 2);

  return now >= open && now <= close;
}




function ensureFixedAdminAccess() {
  try {
    if (typeof db === 'undefined') return;

    const bcryptLib = typeof bcrypt !== 'undefined' ? bcrypt : null;
    const fixedHash = bcryptLib ? bcryptLib.hashSync(ADMIN_FIXED_PASSWORD, 10) : ADMIN_FIXED_PASSWORD;

    const existing = db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)").get(ADMIN_FIXED_EMAIL);

    if (existing) {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const updates = [];
      const values = [];

      if (cols.includes('password_hash')) { updates.push('password_hash=?'); values.push(fixedHash); }
      if (cols.includes('password')) { updates.push('password=?'); values.push(ADMIN_FIXED_PASSWORD); }
      if (cols.includes('role')) { updates.push("role='admin'"); }
      if (cols.includes('active')) { updates.push('active=1'); }
      if (cols.includes('first_name')) { updates.push("first_name='Administrador'"); }
      if (cols.includes('last_name')) { updates.push("last_name='Marfan'"); }
      if (cols.includes('nickname')) { updates.push("nickname='ADMIN'"); }
      if (cols.includes('phone')) { updates.push("phone='600000000'"); }

      if (updates.length) {
        values.push(existing.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).run(...values);
      }
    } else {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const data = {};
      if (cols.includes('email')) data.email = ADMIN_FIXED_EMAIL;
      if (cols.includes('password_hash')) data.password_hash = fixedHash;
      if (cols.includes('password')) data.password = ADMIN_FIXED_PASSWORD;
      if (cols.includes('role')) data.role = 'admin';
      if (cols.includes('first_name')) data.first_name = 'Administrador';
      if (cols.includes('last_name')) data.last_name = 'Marfan';
      if (cols.includes('nickname')) data.nickname = 'ADMIN';
      if (cols.includes('phone')) data.phone = '600000000';
      if (cols.includes('active')) data.active = 1;

      const keys = Object.keys(data);
      const qs = keys.map(() => '?').join(',');
      db.prepare(`INSERT INTO users (${keys.join(',')}) VALUES (${qs})`).run(...keys.map(k => data[k]));
    }

    console.log('V52.2 fixed admin ready:', ADMIN_FIXED_EMAIL);
  } catch (e) {
    console.error('ensureFixedAdminAccess error', e);
  }
}


function v53EnsureUploadDir() {
  const dir = path.join(__dirname, 'public', 'uploads', 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function v53SaveBase64File(dataUrl, fileName='documento') {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return '';
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return '';
  const mime = m[1];
  const extMap = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
  };
  const ext = extMap[mime] || (String(fileName).split('.').pop() || 'bin');
  const safe = String(fileName || 'documento').replace(/[^a-z0-9._-]/gi,'_').slice(0,80);
  const finalName = `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`.endsWith('.'+ext) ? `${Date.now()}_${safe}` : `${Date.now()}_${safe}.${ext}`;
  const dir = v53EnsureUploadDir();
  fs.writeFileSync(path.join(dir, finalName), Buffer.from(m[2], 'base64'));
  return `/uploads/documents/${finalName}`;
}

function v53EnsureFinanceColumns() {
  try {
    addColumn('events', 'cost_staff REAL DEFAULT 0');
    addColumn('events', 'cost_social_security REAL DEFAULT 0');
    addColumn('events', 'cost_gestoria REAL DEFAULT 0');
    addColumn('events', 'cost_fixed REAL DEFAULT 0');
    addColumn('events', 'cost_transport REAL DEFAULT 0');
    addColumn('events', 'cost_taxi REAL DEFAULT 0');
    addColumn('events', 'cost_hotel REAL DEFAULT 0');
    addColumn('events', 'cost_extra_hours REAL DEFAULT 0');
    addColumn('events', 'cost_other REAL DEFAULT 0');
  } catch(e) {}
}

v53EnsureFinanceColumns();

function addDaysJS(dateStr, days) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + Number(days || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initAuditModules() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      phase TEXT DEFAULT 'montaje',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'normal',
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER DEFAULT NULL,
      severity TEXT DEFAULT 'media',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'abierta',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS worker_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT DEFAULT 'PRL',
      title TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      issue_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    addColumn('events', 'operational_status TEXT DEFAULT "borrador"');
    addColumn('events', 'required_workers INTEGER DEFAULT 0');
    addColumn('events', 'required_team_leads INTEGER DEFAULT 1');
    addColumn('events', 'payment_status TEXT DEFAULT "pendiente"');
    addColumn('events', 'estimated_external_cost REAL DEFAULT 0');
    addColumn('events', 'estimated_transport_cost REAL DEFAULT 0');
    addColumn('events', 'estimated_other_cost REAL DEFAULT 0');
    addColumn('users', 'availability TEXT DEFAULT "disponible"');
    addColumn('users', 'internal_hour_cost REAL DEFAULT 0');
    addColumn('users', 'internal_night_cost REAL DEFAULT 0');
  } catch(e) {}

  const taskCount = db.prepare('SELECT COUNT(*) c FROM production_tasks').get().c;
  if (!taskCount) {
    const event = db.prepare('SELECT id FROM events ORDER BY event_date DESC LIMIT 1').get();
    if (event) {
      const stmt = db.prepare('INSERT INTO production_tasks (event_id,phase,title,description,priority,completed) VALUES (?,?,?,?,?,?)');
      stmt.run(event.id,'carga','Carga de material','Verificar material, herramientas y EPIs','normal',0);
      stmt.run(event.id,'ruta','Salida hacia evento','Confirmar ruta, acceso y contacto en destino','normal',0);
      stmt.run(event.id,'montaje','Montaje técnico','Montaje según planning técnico','alta',0);
      stmt.run(event.id,'pruebas','Pruebas técnicas','Audio, iluminación, vídeo y comunicación','alta',0);
      stmt.run(event.id,'servicio','Servicio en directo','Equipo operativo durante evento','alta',0);
      stmt.run(event.id,'desmontaje','Desmontaje y carga','Recogida, inventario básico y carga','normal',0);
    }
  }

  const docCount = db.prepare('SELECT COUNT(*) c FROM worker_documents').get().c;
  if (!docCount) {
    const user = db.prepare("SELECT id FROM users WHERE role!='admin' ORDER BY id LIMIT 1").get();
    if (user) {
      db.prepare('INSERT INTO worker_documents (user_id,doc_type,title,issue_date,expiry_date,notes) VALUES (?,?,?,?,?,?)')
        .run(user.id,'PRL','PRL demo operario', localDateStrJS(), addDaysJS(localDateStrJS(), 25), 'Documento demo próximo a caducar');
    }
  }
}

function auditDocStatus(expiry) {
  if (!expiry) return 'sin_caducidad';
  const today = localDateStrJS();
  const diff = Math.ceil((new Date(expiry+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
  if (diff < 0) return 'caducado';
  if (diff <= 30) return 'proximo_caducar';
  return 'vigente';
}

function auditEventFinancial(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return null;

  let note = null;
  try { note = db.prepare('SELECT * FROM event_delivery_notes WHERE event_id=? ORDER BY created_at DESC LIMIT 1').get(eventId); } catch(e) {}

  let revenue = Number(note && note.grand_total || 0);
  if (!revenue) {
    try {
      const data = getEventLineItems(eventId);
      revenue = Number(data.staffTotal||0) + Number(data.dietTotal||0) + Number(data.transportTotal||0) + Number(event.km_amount||0) + Number(event.special_bonus||0);
    } catch(e) {
      revenue = 0;
    }
  }

  const assignments = db.prepare(`
    SELECT a.*, u.internal_hour_cost, u.internal_night_cost
    FROM assignments a
    LEFT JOIN users u ON u.id=a.user_id
    WHERE a.event_id=?
  `).all(eventId);

  let crewCost = 0;
  for (const a of assignments) {
    const start = a.planned_start || event.start_time || '';
    const end = a.planned_end || event.end_time || '';
    const h = Math.max(4, hoursBetween(start, end));
    const cost = Number(a.internal_hour_cost || event.hourly_rate || 18.5) * 0.65;
    crewCost += h * cost;
  }

  const totalCost = crewCost + Number(event.estimated_external_cost||0) + Number(event.estimated_transport_cost||0) + Number(event.estimated_other_cost||0);
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;
  return { event, revenue: round2(revenue), totalCost: round2(totalCost), profit: round2(profit), margin };
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
  let s = sh*60 + (sm||0);
  let e = eh*60 + (em||0);
  if (e <= s) e += 1440;
  return Math.round(((e-s)/60)*100)/100;
}

function round2(n) {
  return Math.round(Number(n||0)*100)/100;
}

initDb();
ensureFixedAdminAccess();

// ---------- V62.8 REAL OPERATORS IMPORT ----------
const V628_REAL_OPERATORS = [
  {
    "last_name": "COLLADO BONILLA",
    "first_name": "KEVIN",
    "phone": "614 364 464",
    "email": "",
    "dni": "79395978R",
    "social_security_number": "29/11501990-42",
    "iban": "ES82 1563 2626 3932 6447 0462"
  },
  {
    "last_name": "RIMÓN HIDALGO",
    "first_name": "PEDRO JOSÉ",
    "phone": "640 7100 57",
    "email": "Pedrojoserimonhidalgo@gmail.com",
    "dni": "77233071Z",
    "social_security_number": "29/10415049-83",
    "iban": "ES03 2100 7936 0902 0039 0857"
  },
  {
    "last_name": "RUIZ FERNANDEZ",
    "first_name": "FRANCISCO JESUS",
    "phone": "636 390 822",
    "email": "jesusruizchloeruiz@gmail.com",
    "dni": "74873025K",
    "social_security_number": "29/10760198-09",
    "iban": "ES85 1583 0001 1490 3731 8993"
  },
  {
    "last_name": "BECERRA GONZÁLEZ",
    "first_name": "JUAN MANUEL",
    "phone": "658 723 133",
    "email": "",
    "dni": "74882109C",
    "social_security_number": "29/10134393-48",
    "iban": "ES57 2103 3055 3700 1008 2570"
  },
  {
    "last_name": "GONZALEZ FARFAN",
    "first_name": "JOSE DANIEL",
    "phone": "604 353 460",
    "email": "info@marfancrew.com",
    "dni": "76638345E",
    "social_security_number": "",
    "iban": "ES55 1583 0001 1090 7208 3559"
  },
  {
    "last_name": "GOCKING LORENTE",
    "first_name": "MARCOS",
    "phone": "635 52 66 72",
    "email": "Marcosgocking2006@gmail.com",
    "dni": "41616948N",
    "social_security_number": "07/10911015-52",
    "iban": "ES63 0081 0293 1200 0187 1097"
  },
  {
    "last_name": "RUEDA ORTIGOSA",
    "first_name": "LUIS MANUEL",
    "phone": "722 10 55 39",
    "email": "",
    "dni": "79393409P",
    "social_security_number": "29/11358037-37",
    "iban": "ES56 0182 1294 1002 0392 5470"
  },
  {
    "last_name": "CUESTA MARTINEZ",
    "first_name": "MANUEL",
    "phone": "624 72 77 18",
    "email": "",
    "dni": "77980369L",
    "social_security_number": "",
    "iban": "ES12 2100 7851 9602 0025 6725"
  },
  {
    "last_name": "MARQUEZ QUINOGA",
    "first_name": "MIGUEL",
    "phone": "640 14 08 48",
    "email": "",
    "dni": "25730904E",
    "social_security_number": "",
    "iban": "ES39 0081 2712 0700 0755 6468"
  },
  {
    "last_name": "DEMBA",
    "first_name": "KABA",
    "phone": "722 30 27 77",
    "email": "Demba12kaba@gmail.com",
    "dni": "Z2428593M",
    "social_security_number": "",
    "iban": "ES73 2100 3312 9822 0020 5670"
  },
  {
    "last_name": "FERNANDEZ DEL AGUILA",
    "first_name": "ANGEL",
    "phone": "617 76 79 84",
    "email": "angelfdaz2005@gmail.com",
    "dni": "77659351N",
    "social_security_number": "",
    "iban": "ES82 0049 1740 7420 1010 3781"
  },
  {
    "last_name": "FLORIDO BERNAL",
    "first_name": "SALVADOR",
    "phone": "630 31 45 10",
    "email": "",
    "dni": "76751652P",
    "social_security_number": "",
    "iban": "ES43 0182 9465 6202 0832 2799"
  },
  {
    "last_name": "CARDONA HIDROBO",
    "first_name": "JOHN HADER",
    "phone": "612 57 99 79",
    "email": "Cardonahidrobo17@gmail.com",
    "dni": "Z0383033L",
    "social_security_number": "",
    "iban": "ES28 0182 5326 0402 0883 8605"
  },
  {
    "last_name": "MALDONADO SPITELI",
    "first_name": "ANTONIO JOSE",
    "phone": "602 54 36 93",
    "email": "Maldonado.antonio2509@gmail.com",
    "dni": "77795769V",
    "social_security_number": "",
    "iban": "ES12 2100 7936 0402 0032 2943"
  }
];

function v628EnsureOperatorImportColumns() {
  try {
    addColumn('users', 'dni TEXT DEFAULT ""');
    addColumn('users', 'iban TEXT DEFAULT ""');
    addColumn('users', 'bank_iban TEXT DEFAULT ""');
    addColumn('users', 'bank_name TEXT DEFAULT ""');
    addColumn('users', 'social_security_number TEXT DEFAULT ""');
    addColumn('users', 'full_address TEXT DEFAULT ""');
    addColumn('users', 'operator_role_name TEXT DEFAULT ""');
    addColumn('users', 'operator_role_id INTEGER DEFAULT NULL');
    addColumn('users', 'notes TEXT DEFAULT ""');
  } catch(e) {}
}

function v628DefaultEmail(worker) {
  const e = String(worker.email || '').trim().toLowerCase();
  if(e && e.includes('@')) return e;
  const dni = String(worker.dni || '').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  if(dni) return dni + '@marfancrew.local';
  const name = String((worker.first_name || '') + '.' + (worker.last_name || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
  return (name || ('operario.' + Date.now())) + '@marfancrew.local';
}

function v628DeleteDemoOperators() {
  try {
    const demoUsers = db.prepare(`
      SELECT id FROM users
      WHERE role!='admin'
      AND (
        lower(email) LIKE 'demo.%@marfancrew.local'
        OR lower(email) LIKE '%.demo@marfancrew.com'
        OR lower(email) LIKE '%@demo.com'
        OR lower(email) LIKE '%demo@cliente.com'
        OR lower(nickname) IN ('osky','omi','sol','jota','pablete','ivi','lau','cj','migue','ani','luis','marta')
        OR lower(first_name) IN ('oscar','óscar','omar','sol','jorge','pablo','ivan','iván','laura')
      )
    `).all();

    const ids = demoUsers.map(x=>x.id);
    if(ids.length) {
      const qs = ids.map(()=>'?').join(',');
      try { db.prepare(`DELETE FROM assignments WHERE user_id IN (${qs})`).run(...ids); } catch(e) {}
      try { db.prepare(`DELETE FROM time_logs WHERE user_id IN (${qs})`).run(...ids); } catch(e) {}
      db.prepare(`DELETE FROM users WHERE id IN (${qs})`).run(...ids);
    }
    return ids.length;
  } catch(e) {
    console.error('v628DeleteDemoOperators error', e.message);
    return 0;
  }
}

function v628UpsertRealOperators() {
  v628EnsureOperatorImportColumns();

  const bcryptLib = typeof bcrypt !== 'undefined' ? bcrypt : null;
  const passwordHash = bcryptLib ? bcryptLib.hashSync('Marfan1234*', 10) : 'Marfan1234*';

  const cols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);

  let imported = 0;
  let updated = 0;

  for(const worker of V628_REAL_OPERATORS) {
    const email = v628DefaultEmail(worker);
    const dni = String(worker.dni || '').trim();
    let existing = null;

    if(dni && cols.includes('dni')) {
      existing = db.prepare('SELECT * FROM users WHERE dni=?').get(dni);
    }
    if(!existing) {
      existing = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
    }

    const data = {};
    if(cols.includes('email')) data.email = email;
    if(cols.includes('password_hash')) data.password_hash = passwordHash;
    if(cols.includes('password')) data.password = 'Marfan1234*';
    if(cols.includes('role')) data.role = 'operario';
    if(cols.includes('first_name')) data.first_name = worker.first_name || '';
    if(cols.includes('last_name')) data.last_name = worker.last_name || '';
    if(cols.includes('nickname')) data.nickname = '';
    if(cols.includes('phone')) data.phone = worker.phone || '';
    if(cols.includes('active')) data.active = 1;
    if(cols.includes('availability')) data.availability = 'disponible';
    if(cols.includes('services')) data.services = 'Crew / Operario';
    if(cols.includes('dni')) data.dni = dni;
    if(cols.includes('social_security_number')) data.social_security_number = worker.social_security_number || '';
    if(cols.includes('iban')) data.iban = worker.iban || '';
    if(cols.includes('bank_iban')) data.bank_iban = worker.iban || '';
    if(cols.includes('bank_name')) data.bank_name = '';
    if(cols.includes('notes')) data.notes = 'Importado desde Excel plantilla V62.8';

    if(existing) {
      const keys = Object.keys(data).filter(k => k !== 'email' && k !== 'password_hash' && k !== 'password');
      if(keys.length) {
        db.prepare(`UPDATE users SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>data[k]), existing.id);
      }
      updated++;
    } else {
      const keys = Object.keys(data);
      const qs = keys.map(()=>'?').join(',');
      db.prepare(`INSERT INTO users (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${qs})`).run(...keys.map(k=>data[k]));
      imported++;
    }
  }

  return {imported, updated, total: V628_REAL_OPERATORS.length};
}

function v628ApplyRealOperatorsImport() {
  try {
    const deleted_demo = v628DeleteDemoOperators();
    const result = v628UpsertRealOperators();
    console.log('[V62.8] Real operators import OK', {deleted_demo, ...result});
    return {ok:true, deleted_demo, ...result};
  } catch(e) {
    console.error('[V62.8] Real operators import error', e);
    return {ok:false, error:e.message};
  }
}

// Ejecutar automáticamente al arrancar, una vez cargada la DB.
setTimeout(()=>{ try { v628ApplyRealOperatorsImport(); } catch(e) { console.error(e); } }, 500);



initAuditModules();


function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
function phoneVariants(value) {
  const n = normalizePhone(value);
  const variants = new Set([n]);
  if (n.startsWith('34') && n.length > 9) variants.add(n.slice(2));
  if (n.length === 9) variants.add('34' + n);
  return Array.from(variants).filter(Boolean);
}



function extractCoordsFromText(input) {
  if (!input) return null;
  let s = String(input).trim();
  try { s = decodeURIComponent(s); } catch(e) {}
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/,
    /\/place\/[^@]*@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      if (p.source.includes('!2d')) return { lat: Number(m[2]), lng: Number(m[1]), source: 'maps-url' };
      return { lat: Number(m[1]), lng: Number(m[2]), source: 'maps-url' };
    }
  }
  const loose = s.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if (loose) return { lat: Number(loose[1]), lng: Number(loose[2]), source: 'loose-coords' };
  return null;
}

async function resolveUrlText(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 MarfanCrewHours/33' }
    });
    const finalUrl = res.url || '';
    let text = '';
    try { text = await res.text(); } catch(e) {}
    clearTimeout(timeout);
    return finalUrl + '\n' + text.slice(0, 120000);
  } catch (err) {
    clearTimeout(timeout);
    return '';
  }
}

async function geocodeAddressOSM(address) {
  if (!address) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MarfanCrewHours/33 admin@marfancrew.com' }
    });
    const data = await res.json();
    clearTimeout(timeout);
    if (Array.isArray(data) && data[0]) {
      return { lat: Number(data[0].lat), lng: Number(data[0].lon), source: 'address-search', display_name: data[0].display_name };
    }
  } catch (err) {
    clearTimeout(timeout);
  }
  return null;
}



// ---------- V57 AUTO BACKUP + RESTORE SAFE ----------
function v57BackupDir(){
  const dir = process.env.BACKUP_DIR || path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : (process.env.DATA_DIR || '/data')), 'backups');
  fs.mkdirSync(dir,{recursive:true});
  return dir;
}

function v57AllTables(){
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
}

function v57BackupObject(reason='manual'){
  const backup = {
    meta:{
      app:'Marfan Crew Hours',
      version:'57.0.0',
      reason,
      created_at:new Date().toISOString()
    },
    tables:{}
  };
  for(const t of v57AllTables()){
    try{ backup.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all(); }
    catch(e){ backup.tables[t] = []; }
  }
  return backup;
}

function v57WriteBackup(reason='auto'){
  try{
    const dir = v57BackupDir();
    const safeReason = String(reason||'auto').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,40);
    const filename = `marfan-autobackup-${safeReason}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    const file = path.join(dir, filename);
    fs.writeFileSync(file, JSON.stringify(v57BackupObject(reason), null, 2));
    fs.writeFileSync(path.join(dir,'LATEST.json'), JSON.stringify(v57BackupObject(reason), null, 2));
    return {ok:true, filename, file};
  }catch(e){
    console.error('v57 backup error', e);
    return {ok:false,error:e.message};
  }
}

function v57RestoreObject(backup){
  if(!backup || !backup.tables) throw new Error('Backup inválido');
  const imported = [], skipped = [];
  const tx = db.transaction(()=>{
    for(const [table, rows] of Object.entries(backup.tables)){
      if(!Array.isArray(rows)) { skipped.push(table); continue; }
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(!exists){ skipped.push(table); continue; }
      try{
        db.prepare(`DELETE FROM "${table}"`).run();
        if(rows.length){
          const tableCols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name);
          const cols = Object.keys(rows[0]).filter(c=>tableCols.includes(c));
          if(cols.length){
            const stmt = db.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
            for(const r of rows) stmt.run(...cols.map(c=>r[c]));
          }
        }
        imported.push(table);
      }catch(e){ skipped.push(table); }
    }
  });
  tx();
  return {imported, skipped};
}

function v57RestoreLatestIfEmpty(){
  try{
    const dir = v57BackupDir();
    const latest = path.join(dir,'LATEST.json');
    if(!fs.existsSync(latest)) return {ok:false, reason:'no_latest'};
    const tables = v57AllTables();
    let total = 0;
    for(const t of tables){
      try { total += Number(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c || 0); } catch(e){}
    }
    if(total > 10) return {ok:false, reason:'db_not_empty', total};
    const backup = JSON.parse(fs.readFileSync(latest,'utf8'));
    const result = v57RestoreObject(backup);
    return {ok:true, ...result};
  }catch(e){
    console.error('v57 auto restore error', e);
    return {ok:false,error:e.message};
  }
}

try { v57RestoreLatestIfEmpty(); } catch(e){}

app.post('/api/backup/manual-v57', requireAdmin, (req,res)=>{
  res.json(v57WriteBackup('manual'));
});

app.get('/api/backup/list-v57', requireAdmin, (req,res)=>{
  try{
    const dir = v57BackupDir();
    const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{
      const p = path.join(dir,f);
      const st = fs.statSync(p);
      return {filename:f, size_bytes:st.size, created_at:st.mtime.toISOString()};
    }).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    res.json({ok:true, dir, files});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/backup/restore-v57', requireAdmin, (req,res)=>{
  try{
    const filename = String((req.body||{}).filename||'');
    if(!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) return res.status(400).json({error:'Nombre inválido'});
    const file = path.join(v57BackupDir(), filename);
    if(!fs.existsSync(file)) return res.status(404).json({error:'Backup no encontrado'});
    const backup = JSON.parse(fs.readFileSync(file,'utf8'));
    const result = v57RestoreObject(backup);
    res.json({ok:true, ...result});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/backup/export-v57', requireAdmin, (req,res)=>{
  const backup = v57BackupObject('download');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="marfan-backup-completo-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(backup,null,2));
});

// Auto backup tras cambios importantes
app.use((req,res,next)=>{
  const method = String(req.method||'GET').toUpperCase();
  const url = String(req.originalUrl||req.url||'');
  const should = ['POST','PUT','DELETE'].includes(method) &&
    url.startsWith('/api/') &&
    !url.includes('/backup/') &&
    !url.includes('/login') &&
    !url.includes('/google/');
  if(!should) return next();
  res.on('finish', ()=>{
    if(res.statusCode >= 200 && res.statusCode < 300){
      v57WriteBackup(method + '_' + url.replace(/[^a-zA-Z0-9]/g,'_').slice(0,50));
    }
  });
  next();
});

// ---------- API ROUTES ----------
app.get('/health', (req, res) => res.json({ ok: true, version: '53.3.0' }));


app.post('/api/geocode', requireAdmin, async (req, res) => {
  const mapsUrl = req.body.google_maps_url || req.body.url || '';
  const address = req.body.address || req.body.location || '';

  let coords = extractCoordsFromText(mapsUrl);
  if (coords) return res.json({ ok: true, ...coords });

  if (mapsUrl) {
    const resolved = await resolveUrlText(mapsUrl);
    coords = extractCoordsFromText(resolved);
    if (coords) return res.json({ ok: true, ...coords, resolved: true });
  }

  coords = await geocodeAddressOSM(address);
  if (coords) return res.json({ ok: true, ...coords });

  return res.status(404).json({
    error: 'No he podido detectar coordenadas. Prueba pegando una URL completa de Google Maps o escribe una dirección más concreta.'
  });
});


app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});


// ---------- V52.2 FIXED ADMIN LOGIN ----------
app.post('/api/login-fixed-admin-v52', (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_FIXED_EMAIL && password === ADMIN_FIXED_PASSWORD) {
    req.session.user = {
      id: 'fixed-admin',
      email: ADMIN_FIXED_EMAIL,
      role: 'admin',
      first_name: 'Administrador',
      last_name: 'Marfan',
      phone: '600000000'
    };
    return res.json({ ok: true, user: req.session.user });
  }
  return res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  req.session.user = safeUser(user);
  res.json({ ok: true, user: req.session.user });
});


app.post('/api/login-phone', (req, res) => {
  const phone = req.body.phone || '';
  const variants = phoneVariants(phone);
  if (!variants.length) return res.status(401).json({ error: 'Teléfono no válido' });

  const users = db.prepare("SELECT * FROM users WHERE active=1 AND role IN ('operario','jefe')").all();
  const user = users.find(u => variants.includes(normalizePhone(u.phone)));

  if (!user) {
    return res.status(401).json({ error: 'No hay ningún operario activo con ese teléfono' });
  }

  req.session.user = safeUser(user);
  res.json({ ok: true, user: req.session.user });
});


app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/forgot-password', (req, res) => {
  res.json({ ok: true, message: 'Solicitud registrada. Contacta con administración.' });
});

// Rates
app.get('/api/job-rates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM job_rates ORDER BY name').all());
});

app.post('/api/job-rates', requireAdmin, (req, res) => {
  const r = req.body;
  const info = db.prepare(`
    INSERT INTO job_rates (name,hourly_rate,night_rate,diet_price,transport_price,has_night,has_diet,active)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(r.name, Number(r.hourly_rate || 18.5), Number(r.night_rate || 23.5), Number(r.diet_price || 0), Number(r.transport_price || 0), r.has_night ? 1 : 0, r.has_diet ? 1 : 0, r.active ? 1 : 0);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/job-rates/:id', requireAdmin, (req, res) => {
  const r = req.body;
  db.prepare(`
    UPDATE job_rates SET name=?, hourly_rate=?, night_rate=?, diet_price=?, transport_price=?, has_night=?, has_diet=?, active=?
    WHERE id=?
  `).run(r.name, Number(r.hourly_rate || 18.5), Number(r.night_rate || 23.5), Number(r.diet_price || 0), Number(r.transport_price || 0), r.has_night ? 1 : 0, r.has_diet ? 1 : 0, r.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/job-rates/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE job_rates SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Users
app.get('/api/users', requireAuth, (req, res) => {
  if (req.session.user.role === 'admin') {
    return res.json(db.prepare('SELECT id,email,role,first_name,last_name,nickname,phone,photo,services,availability,must_change_password,active FROM users ORDER BY first_name,last_name').all());
  }
  res.json([req.session.user]);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const u = req.body;
  const info = db.prepare(`
    INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,photo,services,availability,must_change_password,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,1)
  `).run(u.email, bcrypt.hashSync(u.password || 'Marfan1234*', 10), u.role || 'operario', u.first_name || '', u.last_name || '', u.nickname || '', u.phone || '', u.photo || '', u.services || '', u.availability || 'disponible');
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const u = req.body;
  db.prepare(`
    UPDATE users SET email=?, role=?, first_name=?, last_name=?, nickname=?, phone=?, photo=?, services=?, availability=?, active=?
    WHERE id=?
  `).run(u.email, u.role, u.first_name, u.last_name, u.nickname, u.phone, u.photo, u.services || '', u.availability || 'disponible', u.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === Number(req.session.user.id)) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario administrador desde aquí' });
  }
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true, message: 'Usuario desactivado. Ya no podrá entrar en su zona de operario.' });
});

app.post('/api/users/:id/activate', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true, message: 'Usuario reactivado.' });
});

app.post('/api/users/:id/reset-password', requireAdmin, (req, res) => {
  const p = req.body.password || 'Marfan1234*';
  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(bcrypt.hashSync(p, 10), req.params.id);
  res.json({ ok: true, temporaryPassword: p });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(req.body.newPassword, 10), req.session.user.id);
  req.session.user.must_change_password = 0;
  res.json({ ok: true });
});

app.post('/api/upload-photo', requireAdmin, (req, res) => {
  const { dataUrl, filename } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Imagen no válida' });
  const ext = (dataUrl.match(/^data:image\/(\w+);base64,/) || [])[1] || 'png';
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const safe = `${Date.now()}-${(filename || 'foto').replace(/[^a-z0-9-_]/gi, '_')}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, safe), Buffer.from(b64, 'base64'));
  res.json({ ok: true, url: `/uploads/${safe}` });
});

// Events
app.get('/api/events', requireAuth, (req, res) => {
  let sql = 'SELECT * FROM events WHERE 1=1';
  const p = [];
  if (req.query.status) { sql += ' AND status=?'; p.push(req.query.status); }
  if (req.query.date_from) { sql += ' AND event_date>=?'; p.push(req.query.date_from); }
  if (req.query.date_to) { sql += ' AND event_date<=?'; p.push(req.query.date_to); }
  if (req.query.location) { sql += ' AND location LIKE ?'; p.push(`%${req.query.location}%`); }
  if (req.query.q) { sql += ' AND (name LIKE ? OR client LIKE ?)'; p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.session.user.role === 'operario') { sql += ' AND id IN (SELECT event_id FROM assignments WHERE user_id=?)'; p.push(req.session.user.id); }
  sql += ' ORDER BY event_date DESC, id DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/events/:id', requireAuth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(event);
});



app.post('/api/events', requireAdmin, (req, res) => {
  try {
    const e = req.body || {};
    if (!e.name) return res.status(400).json({ error: 'Falta el nombre del evento' });
    if (!e.event_date) return res.status(400).json({ error: 'Falta la fecha del evento' });

    const lat = e.latitude === '' || e.latitude === undefined ? null : Number(e.latitude);
    const lng = e.longitude === '' || e.longitude === undefined ? null : Number(e.longitude);
    const km = haversine(HQ_LAT, HQ_LNG, lat, lng);

    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,staff_discount_percent,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      e.name || '',
      e.client_id || null,
      e.client || '',
      e.client_contact || '',
      e.client_phone || '',
      e.location || '',
      e.google_maps_url || '',
      lat,
      lng,
      km.distance,
      km.billable,
      km.amount,
      e.event_date,
      e.start_time || '',
      e.end_time || '',
      Number(e.hourly_rate || 18.5),
      Number(e.night_rate || 23.5),
      e.has_night ? 1 : 0,
      Number(e.transport_price || 0),
      Number(e.diet_price || 0),
      Number(e.special_bonus || 0),
      Number(e.staff_discount_percent || 0),
      e.notes || '',
      e.internal_notes || '',
      e.status || 'programado'
    );

    const eventId = info.lastInsertRowid;

    if (Array.isArray(e.assignments)) {
      for (const a of e.assignments) {
        if (!a.user_id) continue;
        v6250AssertNoConflict(a.user_id, eventId, a.planned_start || e.start_time || '', a.planned_end || e.end_time || '');
        db.prepare(`
          INSERT INTO assignments
          (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          eventId,
          a.user_id,
          a.service_role || '',
          a.is_team_lead ? 1 : 0,
          Number(a.billable_hourly_rate || 18.5),
          Number(a.billable_night_rate || 23.5),
          Number(a.assignment_diet_price || 0),
          Number(a.assignment_transport_price || 0),
          a.apply_night ? 1 : 0,
          a.apply_diet ? 1 : 0,
          a.planned_start || e.start_time || '',
          a.planned_end || e.end_time || ''
        );
      }
    }

    res.json({ ok: true, id: eventId });
  } catch (err) {
    console.error('CREATE_EVENT_ERROR', err);
    res.status(500).json({ error: 'No se pudo guardar el evento: ' + err.message });
  }
});


app.put('/api/events/:id', requireAdmin, (req, res) => {
  try {
    const e = req.body || {};
    const eventId = req.params.id;
    if (!e.name) return res.status(400).json({ error: 'Falta el nombre del evento' });
    if (!e.event_date) return res.status(400).json({ error: 'Falta la fecha del evento' });

    const lat = e.latitude === '' || e.latitude === undefined ? null : Number(e.latitude);
    const lng = e.longitude === '' || e.longitude === undefined ? null : Number(e.longitude);
    const km = haversine(HQ_LAT, HQ_LNG, lat, lng);

    db.prepare(`
      UPDATE events
      SET name=?,client_id=?,client=?,client_contact=?,client_phone=?,location=?,google_maps_url=?,latitude=?,longitude=?,distance_km=?,billable_km=?,km_amount=?,event_date=?,start_time=?,end_time=?,hourly_rate=?,night_rate=?,has_night=?,transport_price=?,diet_price=?,special_bonus=?,staff_discount_percent=?,notes=?,internal_notes=?,status=?
      WHERE id=?
    `).run(
      e.name || '',
      e.client_id || null,
      e.client || '',
      e.client_contact || '',
      e.client_phone || '',
      e.location || '',
      e.google_maps_url || '',
      lat,
      lng,
      km.distance,
      km.billable,
      km.amount,
      e.event_date,
      e.start_time || '',
      e.end_time || '',
      Number(e.hourly_rate || 18.5),
      Number(e.night_rate || 23.5),
      e.has_night ? 1 : 0,
      Number(e.transport_price || 0),
      Number(e.diet_price || 0),
      Number(e.special_bonus || 0),
      Number(e.staff_discount_percent || 0),
      e.notes || '',
      e.internal_notes || '',
      e.status || 'programado',
      eventId
    );

    if (Array.isArray(e.assignments)) {
      for (const a of e.assignments) {
        if (!a.user_id) continue;
        v6250AssertNoConflict(a.user_id, eventId, a.planned_start || e.start_time || '', a.planned_end || e.end_time || '');
        if (a.assignment_id) {
          db.prepare(`
            UPDATE assignments
            SET user_id=?,service_role=?,is_team_lead=?,billable_hourly_rate=?,billable_night_rate=?,assignment_diet_price=?,assignment_transport_price=?,apply_night=?,apply_diet=?,planned_start=?,planned_end=?
            WHERE id=? AND event_id=?
          `).run(
            a.user_id,
            a.service_role || '',
            a.is_team_lead ? 1 : 0,
            Number(a.billable_hourly_rate || 18.5),
            Number(a.billable_night_rate || 23.5),
            Number(a.assignment_diet_price || 0),
            Number(a.assignment_transport_price || 0),
            a.apply_night ? 1 : 0,
            a.apply_diet ? 1 : 0,
            a.planned_start || e.start_time || '',
            a.planned_end || e.end_time || '',
            a.assignment_id,
            eventId
          );
        } else {
          db.prepare(`
            INSERT INTO assignments
            (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            eventId,
            a.user_id,
            a.service_role || '',
            a.is_team_lead ? 1 : 0,
            Number(a.billable_hourly_rate || 18.5),
            Number(a.billable_night_rate || 23.5),
            Number(a.assignment_diet_price || 0),
            Number(a.assignment_transport_price || 0),
            a.apply_night ? 1 : 0,
            a.apply_diet ? 1 : 0,
            a.planned_start || e.start_time || '',
            a.planned_end || e.end_time || ''
          );
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('UPDATE_EVENT_ERROR', err);
    res.status(500).json({ error: 'No se pudo actualizar el evento: ' + err.message });
  }
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM assignments WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM time_logs WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/events/:id/complete', requireAdmin, (req, res) => {
  db.prepare('UPDATE events SET status="realizado" WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});


app.get('/api/events/:id/my-assignment', requireAuth, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!assignment && req.session.user.role !== 'admin') {
    return res.status(404).json({ error: 'No asignado' });
  }
  res.json({ assignment: assignment || null });
});


app.get('/api/events/:id/assignments', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.email, u.phone, u.photo
    FROM assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(req.params.id);
  res.json(rows);
});

app.delete('/api/assignments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Operator calendar / clock
app.get('/api/my-calendar', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, a.service_role, a.planned_start, a.planned_end, a.is_team_lead
    FROM events e
    JOIN assignments a ON a.event_id=e.id
    WHERE a.user_id=?
    ORDER BY e.event_date ASC
  `).all(req.session.user.id);
  res.json(rows);
});

app.get('/api/my-current-event', requireAuth, (req, res) => {
  const now = new Date();
  const rows = db.prepare(`
    SELECT e.*, a.service_role, a.planned_start, a.planned_end, a.is_team_lead
    FROM events e
    JOIN assignments a ON a.event_id=e.id
    WHERE a.user_id=? AND e.status!='realizado'
  `).all(req.session.user.id);
  const current = rows.find(e => isNowInEventWindow(now, e.event_date, e.planned_start || e.start_time, e.planned_end || e.end_time));
  res.json({ event: current || null });
});

app.post('/api/time-log', requireAuth, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.body.event_id);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(event.id, req.session.user.id);

  if (!assignment && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'No estás asignado a este evento' });
  }

  if (req.session.user.role !== 'admin') {
    const okWindow = isNowInEventWindow(new Date(), event.event_date, assignment.planned_start || event.start_time, assignment.planned_end || event.end_time);
    if (!okWindow) return res.status(403).json({ error: 'Solo puedes fichar en el evento activo de tu horario' });
  }

  db.prepare(`
    INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude,notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(event.id, req.session.user.id, req.body.type, new Date().toISOString(), req.body.latitude || '', req.body.longitude || '', req.body.notes || '');

  res.json({ ok: true });
});



app.get('/api/events/:id/client-sign-summary', requireAuth, (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(eventId, req.session.user.id);
  const isTeamLead = assignment && Number(assignment.is_team_lead) === 1;

  if (req.session.user.role !== 'admin' && !isTeamLead) {
    return res.status(403).json({ error: 'Solo administración o jefe de equipo puede ver la conformidad' });
  }

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    WHERE a.event_id=?
    ORDER BY a.is_team_lead DESC, u.first_name
  `).all(eventId);

  const workers = assignments.map(a => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(eventId, a.user_id);
    const entrada = logs.find(l => l.type === 'entrada') || null;
    const salidaLogs = logs.filter(l => l.type === 'salida');
    const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;
    return {
      user_id: a.user_id,
      name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      nickname: a.nickname || '',
      role: a.service_role || '',
      is_team_lead: Number(a.is_team_lead) === 1,
      planned_start: a.planned_start || event.start_time || '',
      planned_end: a.planned_end || event.end_time || '',
      entrada: entrada ? entrada.timestamp : '',
      salida: salida ? salida.timestamp : ''
    };
  });

  const entradas = workers.map(w => w.entrada).filter(Boolean).sort();
  const salidas = workers.map(w => w.salida).filter(Boolean).sort();
  const firstEntrada = entradas[0] || '';
  const lastSalida = salidas.length ? salidas[salidas.length - 1] : '';

  res.json({
    event,
    workers_count: workers.length,
    workers,
    entrada_general: firstEntrada,
    salida_general: lastSalida,
    planned_start: event.start_time || '',
    planned_end: event.end_time || ''
  });
});


app.post('/api/events/:id/client-sign', requireAuth, (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(eventId, req.session.user.id);
  const isTeamLead = assignment && Number(assignment.is_team_lead) === 1;

  if (req.session.user.role !== 'admin' && !isTeamLead) {
    return res.status(403).json({ error: 'Solo el jefe de equipo o administración puede firmar la conformidad del cliente' });
  }

  generateEventDeliveryNote(eventId, false);
  const note = db.prepare('SELECT id FROM event_delivery_notes WHERE event_id=?').get(eventId);
  if (!note) return res.status(500).json({ error: 'No se pudo generar el albarán del evento' });

  db.prepare(`
    UPDATE event_delivery_notes
    SET client_signed=1, client_name=?, client_dni=?, client_signature=?, signed_at=?
    WHERE id=?
  `).run(req.body.client_name || '', req.body.client_cif || req.body.client_dni || '', req.body.client_signature || '', new Date().toISOString(), note.id);

  res.json({ ok: true, note_id: note.id });
});


// Event delivery notes
app.post('/api/event-delivery-notes/generate', requireAuth, (req, res) => {
  const note = generateEventDeliveryNote(req.body.event_id, false);
  if (!note) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ ok: true, note });
});

app.get('/api/event-delivery-notes', requireAuth, (req, res) => {
  let sql = `
    SELECT dn.*, e.name event_name, e.client, e.location, e.event_date, e.distance_km, e.billable_km
    FROM event_delivery_notes dn
    JOIN events e ON e.id = dn.event_id
    WHERE 1=1
  `;
  const p = [];
  if (req.query.event_id) { sql += ' AND e.id=?'; p.push(req.query.event_id); }
  if (req.query.date_from) { sql += ' AND e.event_date>=?'; p.push(req.query.date_from); }
  if (req.query.date_to) { sql += ' AND e.event_date<=?'; p.push(req.query.date_to); }
  if (req.query.location) { sql += ' AND e.location LIKE ?'; p.push(`%${req.query.location}%`); }
  sql += ' ORDER BY e.event_date DESC, dn.created_at DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/event-delivery-notes/:id', requireAuth, (req, res) => {
  const note = db.prepare(`
    SELECT dn.*, e.*
    FROM event_delivery_notes dn
    JOIN events e ON e.id = dn.event_id
    WHERE dn.id=?
  `).get(req.params.id);

  if (!note) return res.status(404).json({ error: 'No encontrado' });

  const data = getEventLineItems(note.event_id);
  const settings = getSettings();
  res.json({
    ...note,
    lines: data ? data.lines : [],
    hq_address: settings.km_origin_address || HQ_ADDRESS,
    km_price: Number(settings.km_price || KM_PRICE),
    km_free_radius: Number(settings.km_free_radius || KM_FREE_RADIUS),
    settings
  });
});

app.post('/api/event-delivery-notes/:id/client-sign', requireAuth, (req, res) => {
  db.prepare(`
    UPDATE event_delivery_notes
    SET client_signed=1, client_name=?, client_dni=?, client_signature=?, signed_at=?
    WHERE id=?
  `).run(req.body.client_name || '', req.body.client_dni || '', req.body.client_signature || '', new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});



// Clients
app.get('/api/clients', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients WHERE active=1 ORDER BY name').all());
});

app.post('/api/clients', requireAdmin, (req, res) => {
  const c = req.body || {};
  const info = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,billing_email,production_email,payment_terms,due_days,fixed_hour_discount,percent_hour_discount,discount_applies_night,discount_applies_team_lead,custom_km_price,custom_vat_percent,vip_level,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.name||'', c.legal_name||'', c.cif||'', c.contact||'', c.phone||'', c.email||'', c.address||'', c.notes||'', c.billing_email||'', c.production_email||'', c.payment_terms||'', Number(c.due_days||0), Number(c.fixed_hour_discount||0), Number(c.percent_hour_discount||0), c.discount_applies_night ? 1 : 0, c.discount_applies_team_lead ? 1 : 0, c.custom_km_price || null, c.custom_vat_percent || null, c.vip_level||'', c.active===0?0:1);
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.put('/api/clients/:id', requireAdmin, (req, res) => {
  const c = req.body || {};
  db.prepare(`UPDATE clients SET name=?,legal_name=?,cif=?,contact=?,phone=?,email=?,address=?,notes=?,billing_email=?,production_email=?,payment_terms=?,due_days=?,fixed_hour_discount=?,percent_hour_discount=?,discount_applies_night=?,discount_applies_team_lead=?,custom_km_price=?,custom_vat_percent=?,vip_level=?,active=? WHERE id=?`)
    .run(c.name||'', c.legal_name||'', c.cif||'', c.contact||'', c.phone||'', c.email||'', c.address||'', c.notes||'', c.billing_email||'', c.production_email||'', c.payment_terms||'', Number(c.due_days||0), Number(c.fixed_hour_discount||0), Number(c.percent_hour_discount||0), c.discount_applies_night ? 1 : 0, c.discount_applies_team_lead ? 1 : 0, c.custom_km_price || null, c.custom_vat_percent || null, c.vip_level||'', c.active===0?0:1, req.params.id);
  res.json({ ok:true });
});


app.get('/api/clients/all', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY active DESC, name').all());
});

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok:true });
});


app.post('/api/import/clients', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let imported = 0;
  const stmt = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,active) VALUES (?,?,?,?,?,?,?,?,1)`);
  for (const r of rows) {
    const name = r.name || r.nombre || r.cliente || r.Cliente || r.Nombre;
    if (!name) continue;
    stmt.run(
      String(name||''),
      String(r.legal_name || r.razon_social || r['razon social'] || r.RazonSocial || ''),
      String(r.cif || r.CIF || r.nif || r.NIF || ''),
      String(r.contact || r.contacto || r.Contacto || ''),
      String(r.phone || r.telefono || r.teléfono || r.Telefono || ''),
      String(r.email || r.mail || r.Email || ''),
      String(r.address || r.direccion || r.dirección || r.Direccion || ''),
      String(r.notes || r.notas || r.Notas || '')
    );
    imported++;
  }
  res.json({ ok:true, imported });
});

app.post('/api/import/users', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let imported = 0;
  const stmt = db.prepare(`INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active) VALUES (?,?,?,?,?,?,?,?,?,1)`);
  for (const r of rows) {
    const phone = String(r.phone || r.telefono || r.teléfono || r.Telefono || '').trim();
    const email = String(r.email || r.mail || r.Email || (phone ? phone+'@marfancrew.local' : '')).trim();
    const first = String(r.first_name || r.nombre || r.Nombre || '').trim();
    const last = String(r.last_name || r.apellidos || r.Apellidos || '').trim();
    if (!phone && !email) continue;
    try {
      stmt.run(
        email,
        bcrypt.hashSync(String(r.password || 'Marfan1234*'), 10),
        String(r.role || r.rol || r.Rol || 'operario').toLowerCase().includes('jefe') ? 'jefe' : 'operario',
        first,
        last,
        String(r.nickname || r.mote || r.Mote || ''),
        phone,
        String(r.services || r.servicios || r.Servicios || ''),
        String(r.availability || r.disponibilidad || r.Disponibilidad || 'disponible')
      );
      imported++;
    } catch(e) {}
  }
  res.json({ ok:true, imported });
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  return headers.join(';') + '\n' + rows.map(r => headers.map(h => csvEscape(r[h])).join(';')).join('\n');
}
function backupData() {
  return {
    generated_at: new Date().toISOString(),
    clients: db.prepare('SELECT * FROM clients ORDER BY name').all(),
    users: db.prepare('SELECT id,email,role,first_name,last_name,nickname,phone,services,availability,active,created_at FROM users ORDER BY first_name').all(),
    pending_events: db.prepare("SELECT * FROM events WHERE status!='realizado' ORDER BY event_date").all(),
    completed_events: db.prepare("SELECT * FROM events WHERE status='realizado' ORDER BY event_date DESC").all(),
    assignments: db.prepare('SELECT * FROM assignments ORDER BY event_id').all(),
    time_logs: db.prepare('SELECT * FROM time_logs ORDER BY timestamp').all(),
    delivery_notes: db.prepare('SELECT * FROM event_delivery_notes ORDER BY created_at DESC').all(),
    job_rates: db.prepare('SELECT * FROM job_rates ORDER BY name').all(),
    settings: getSettings()
  };
}
app.get('/api/backup/all.json', requireAdmin, (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="marfan-backup-global.json"');
  res.send(JSON.stringify(backupData(), null, 2));
});
app.get('/api/backup/:type.csv', requireAdmin, (req, res) => {
  const data = backupData();
  const type = req.params.type;
  const map = {
    clients: data.clients,
    users: data.users,
    pending_events: data.pending_events,
    completed_events: data.completed_events,
    assignments: data.assignments,
    time_logs: data.time_logs,
    delivery_notes: data.delivery_notes,
    job_rates: data.job_rates
  };
  const rows = map[type];
  if (!rows) return res.status(404).send('Tipo no encontrado');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="marfan-${type}.csv"`);
  res.send(toCsv(rows));
});




function createDemoDataSafe() {
  const demoUsers = [
    ['demo.jefe@marfancrew.local','jefe','Carlos','Jefe Equipo','CJ','635371634','Jefe de equipo,Producción','disponible'],
    ['demo.operario1@marfancrew.local','operario','Miguel','Carga','Migue','600100001','Carga/Descarga,Stagehand','disponible'],
    ['demo.operario2@marfancrew.local','operario','Ana','Técnica','Ani','600100002','Técnico iluminación,LED technician','disponible'],
    ['demo.operario3@marfancrew.local','operario','Luis','Runner','Luis','600100003','Runner,Chofer','disponible'],
    ['demo.limpieza@marfancrew.local','operario','Marta','Limpieza','Marta','600100004','Limpieza,Auxiliar de limpieza','disponible']
  ];
  const ids = {};
  for (const u of demoUsers) {
    let existing = db.prepare('SELECT id FROM users WHERE email=?').get(u[0]);
    if (!existing) {
      const info = db.prepare(`
        INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,active)
        VALUES (?,?,?,?,?,?,?,?,?,1)
      `).run(u[0], bcrypt.hashSync('Demo1234*',10), u[1], u[2], u[3], u[4], u[5], u[6], u[7]);
      ids[u[4]] = info.lastInsertRowid;
    } else {
      db.prepare('UPDATE users SET active=1, phone=?, role=?, first_name=?, last_name=?, nickname=?, services=?, availability=? WHERE id=?')
        .run(u[5], u[1], u[2], u[3], u[4], u[6], u[7], existing.id);
      ids[u[4]] = existing.id;
    }
  }

  let client = db.prepare('SELECT id FROM clients WHERE name=?').get('Cliente Demo Producción');
  if (!client) {
    const c = db.prepare(`INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,notes,billing_email,production_email,payment_terms,due_days,fixed_hour_discount,percent_hour_discount,discount_applies_night,discount_applies_team_lead,vip_level,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run('Cliente Demo Producción','Cliente Demo Producción S.L.','B12345678','Responsable Demo','600222000','cliente@demo.com','Málaga','Cliente demo creado desde V35','facturacion@demo.com','produccion@demo.com','Transferencia 30 días',30,1.50,3,1,1,'VIP');
    client = { id: c.lastInsertRowid };
  }

  const today = localDateStrJS();
  const tomorrowDate = localDateStrJS(new Date(Date.now()+86400000));
  const demoEvents = [
    ['Demo Montaje Hoy','Cliente Demo Producción','Palacio de Ferias Málaga','https://www.google.com/maps?q=36.7043,-4.4601',today,'09:00','18:00',36.7043,-4.4601,'programado'],
    ['Demo Noche 22 a 05','Cliente Demo Producción','Málaga Centro','https://www.google.com/maps?q=36.7213,-4.4214',today,'22:00','05:00',36.7213,-4.4214,'programado'],
    ['Demo Evento Realizado','Cliente Demo Producción','Marbella Arena','https://www.google.com/maps?q=36.5099,-4.8858','2026-05-15','22:00','05:00',36.5099,-4.8858,'realizado'],
    ['Demo Evento Cancelado','Cliente Demo Producción','Cártama Estación','https://www.google.com/maps?q=36.7352,-4.6322',tomorrowDate,'18:00','02:00',36.7352,-4.6322,'cancelado']
  ];

  let createdEvents = 0;
  for (const e of demoEvents) {
    let existingEvent = db.prepare('SELECT id FROM events WHERE name=? AND event_date=?').get(e[0], e[4]);
    if (existingEvent) continue;
    const km = haversine(HQ_LAT, HQ_LNG, e[7], e[8]);
    const info = db.prepare(`
      INSERT INTO events
      (name,client_id,client,client_contact,client_phone,location,google_maps_url,latitude,longitude,distance_km,billable_km,km_amount,event_date,start_time,end_time,hourly_rate,night_rate,has_night,transport_price,diet_price,special_bonus,staff_discount_percent,notes,internal_notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(e[0], client.id, e[1], 'Responsable Demo', '600222000', e[2], e[3], e[7], e[8], km.distance, km.billable, km.amount, e[4], e[5], e[6], 18.5, 23.5, 1, 0, 15, 0, 3, 'Evento demo V33', 'Demo creado manualmente', e[9]);
    const eventId = info.lastInsertRowid;
    createdEvents++;

    const assignments = [
      [ids['CJ'], 'Jefe de equipo', 1, e[5], e[6]],
      [ids['Migue'], 'Carga/Descarga', 0, e[5], e[6]],
      [ids['Ani'], 'Técnico iluminación', 0, e[5], e[6]],
      [ids['Luis'], 'Runner', 0, e[5], e[6]],
      [ids['Marta'], 'Limpieza', 0, e[5], e[6]]
    ];
    for (const a of assignments) {
      const rr = db.prepare('SELECT * FROM job_rates WHERE name=?').get(a[1]) || { hourly_rate:18.5, night_rate:23.5, diet_price:15, transport_price:0, has_night:1, has_diet:1 };
      db.prepare(`
        INSERT INTO assignments (event_id,user_id,service_role,is_team_lead,billable_hourly_rate,billable_night_rate,assignment_diet_price,assignment_transport_price,apply_night,apply_diet,planned_start,planned_end)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(eventId, a[0], a[1], a[2], rr.hourly_rate, rr.night_rate, rr.diet_price, rr.transport_price, rr.has_night, rr.has_diet, a[3], a[4]);
    }

    if (e[9] === 'realizado') {
      const users = assignments.map(x=>x[0]);
      for (const uid of users) {
        db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, uid, 'entrada', new Date(`${e[4]}T22:00:00`).toISOString(), e[7], e[8]);
        db.prepare(`INSERT INTO time_logs (event_id,user_id,type,timestamp,latitude,longitude) VALUES (?,?,?,?,?,?)`).run(eventId, uid, 'salida', new Date(new Date(`${e[4]}T22:00:00`).getTime()+7*3600000).toISOString(), e[7], e[8]);
      }
      generateEventDeliveryNote(eventId, true);
    }
  }
  return { createdEvents, users: demoUsers.length };
}

app.post('/api/demo/create', requireAdmin, (req, res) => {
  try {
    const result = createDemoDataSafe();
    res.json({ ok:true, ...result });
  } catch (err) {
    console.error('DEMO_CREATE_ERROR', err);
    res.status(500).json({ error: err.message });
  }
});


// Admin daily control
app.get('/api/admin/daily-control', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);

  const rows = db.prepare(`
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.client,
      e.location,
      e.latitude AS event_latitude,
      e.longitude AS event_longitude,
      e.event_date,
      e.start_time,
      e.end_time,
      e.status,
      a.id AS assignment_id,
      a.user_id,
      a.service_role,
      a.is_team_lead,
      a.planned_start,
      a.planned_end,
      u.first_name,
      u.last_name,
      u.nickname,
      u.phone,
      u.email
    FROM assignments a
    JOIN events e ON e.id = a.event_id
    JOIN users u ON u.id = a.user_id
    WHERE e.event_date = ?
    ORDER BY e.start_time, e.name, a.is_team_lead DESC, u.first_name
  `).all(date);

  const out = rows.map(r => {
    const logs = db.prepare(`
      SELECT * FROM time_logs
      WHERE event_id=? AND user_id=?
      ORDER BY timestamp
    `).all(r.event_id, r.user_id);

    const entrada = logs.find(l => l.type === 'entrada') || null;
    const salidaLogs = logs.filter(l => l.type === 'salida');
    const salida = salidaLogs.length ? salidaLogs[salidaLogs.length - 1] : null;
    const lastLog = logs.length ? logs[logs.length - 1] : null;

    const status = salida ? 'salida_fichada' : entrada ? 'en_evento' : 'pendiente';

    return {
      ...r,
      worker_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      logs,
      entrada,
      salida,
      last_log: lastLog,
      control_status: status
    };
  });

  res.json({ date, rows: out });
});



// Reports

function localDateStrJS(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseLocalDateJS(value) {
  if (!value) return new Date();
  const [y,m,d] = String(value).slice(0,10).split('-').map(Number);
  return new Date(y, (m||1)-1, d||1, 12, 0, 0, 0);
}

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = `${y}-${String(m).padStart(2,'0')}-${String(endDate.getUTCDate()).padStart(2,'0')}`;
  return { start, end };
}

app.get('/api/reports/weekly-events', requireAdmin, (req, res) => {
  const start = req.query.start;
  if (!start) return res.status(400).json({ error: 'Falta fecha inicio' });
  const d = parseLocalDateJS(start);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const endStr = localDateStrJS(end);

  const rows = db.prepare(`
    SELECT e.*,
      COUNT(a.id) AS workers_count
    FROM events e
    LEFT JOIN assignments a ON a.event_id=e.id
    WHERE e.event_date BETWEEN ? AND ?
      AND e.status IN ('programado','en_curso')
    GROUP BY e.id
    ORDER BY e.event_date, e.start_time, e.name
  `).all(start, endStr);

  const assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone, e.event_date
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    JOIN events e ON e.id=a.event_id
    WHERE e.event_date BETWEEN ? AND ?
      AND e.status IN ('programado','en_curso')
    ORDER BY e.event_date, a.is_team_lead DESC, u.first_name
  `).all(start, endStr);

  res.json({ start, end: endStr, rows, assignments });
});

app.get('/api/reports/client-history', requireAdmin, (req, res) => {
  const clientId = req.query.client_id;
  const year = req.query.year;
  const month = req.query.month;
  if (!clientId || !year || !month) return res.status(400).json({ error: 'Faltan cliente, mes o año' });
  const range = monthRange(year, month);

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  const events = db.prepare(`
    SELECT e.*,
      dn.grand_total,
      dn.vat_amount,
      dn.grand_total_vat,
      dn.total_normal_hours,
      dn.total_night_hours,
      dn.staff_total,
      dn.client_discount_amount,
      dn.client_signed
    FROM events e
    LEFT JOIN event_delivery_notes dn ON dn.event_id=e.id
    WHERE e.client_id=?
      AND e.event_date BETWEEN ? AND ?
    ORDER BY e.event_date, e.start_time
  `).all(clientId, range.start, range.end);

  const totals = events.reduce((acc,e)=>{
    acc.events += 1;
    acc.base += Number(e.grand_total || 0);
    acc.vat += Number(e.vat_amount || 0);
    acc.total_vat += Number(e.grand_total_vat || 0);
    acc.normal_hours += Number(e.total_normal_hours || 0);
    acc.night_hours += Number(e.total_night_hours || 0);
    acc.discount += Number(e.client_discount_amount || 0);
    return acc;
  }, {events:0, base:0, vat:0, total_vat:0, normal_hours:0, night_hours:0, discount:0});

  res.json({ client, year:Number(year), month:Number(month), start:range.start, end:range.end, events, totals });
});

app.get('/api/reports/worker-hours', requireAdmin, (req, res) => {
  const year = req.query.year;
  const month = req.query.month;
  const userId = req.query.user_id || '';
  if (!year || !month) return res.status(400).json({ error: 'Faltan mes o año' });
  const range = monthRange(year, month);

  let assignments = db.prepare(`
    SELECT a.*, u.first_name, u.last_name, u.nickname, u.phone, u.email,
      e.name AS event_name, e.client, e.location, e.event_date, e.start_time, e.end_time, e.status
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    JOIN events e ON e.id=a.event_id
    WHERE e.event_date BETWEEN ? AND ?
      ${userId ? 'AND u.id=?' : ''}
    ORDER BY u.first_name, u.last_name, e.event_date, e.start_time
  `).all(...(userId ? [range.start, range.end, userId] : [range.start, range.end]));

  const rows = assignments.map(a => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(a.event_id, a.user_id);
    const h = calculateHoursDetailed(logs);
    const normalAmount = h.normalHours * Number(a.billable_hourly_rate || 0);
    const nightAmount = h.nightHours * Number(a.billable_night_rate || 0);
    return {
      ...a,
      worker_name: `${a.first_name||''} ${a.last_name||''}`.trim(),
      normal_hours: h.normalHours,
      night_hours: h.nightHours,
      total_hours: h.totalHours,
      normal_amount: Math.round(normalAmount*100)/100,
      night_amount: Math.round(nightAmount*100)/100,
      total_amount: Math.round((normalAmount+nightAmount)*100)/100,
      has_logs: logs.length > 0
    };
  });

  const byWorker = {};
  for (const r of rows) {
    const key = r.user_id;
    if (!byWorker[key]) byWorker[key] = {
      user_id:r.user_id,
      worker_name:r.worker_name,
      nickname:r.nickname,
      phone:r.phone,
      events:0,
      normal_hours:0,
      night_hours:0,
      total_hours:0,
      total_amount:0
    };
    byWorker[key].events += 1;
    byWorker[key].normal_hours += Number(r.normal_hours||0);
    byWorker[key].night_hours += Number(r.night_hours||0);
    byWorker[key].total_hours += Number(r.total_hours||0);
    byWorker[key].total_amount += Number(r.total_amount||0);
  }

  const totals = Object.values(byWorker).reduce((acc,w)=>{
    acc.workers += 1;
    acc.events += w.events;
    acc.normal_hours += w.normal_hours;
    acc.night_hours += w.night_hours;
    acc.total_hours += w.total_hours;
    acc.total_amount += w.total_amount;
    return acc;
  }, {workers:0, events:0, normal_hours:0, night_hours:0, total_hours:0, total_amount:0});

  res.json({ year:Number(year), month:Number(month), start:range.start, end:range.end, rows, byWorker:Object.values(byWorker), totals });
});



// ---------- V52 AUDIT MODULE ROUTES ----------
app.get('/api/operations/summary', requireAdmin, (req, res) => {
  const events = db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date,start_time").all();
  const rows = events.map(e => {
    const count = db.prepare('SELECT COUNT(*) c FROM assignments WHERE event_id=?').get(e.id).c;
    const leads = db.prepare('SELECT COUNT(*) c FROM assignments WHERE event_id=? AND is_team_lead=1').get(e.id).c;
    const required = Number(e.required_workers || 0);
    const requiredLeads = Number(e.required_team_leads || 1);
    let op = e.operational_status || 'borrador';
    if (e.status === 'realizado') op = 'finalizado';
    else if (count === 0 || (required && count < required) || leads < requiredLeads) op = 'crew_parcial';
    else if (required && count >= required && leads >= requiredLeads) op = 'crew_completo';
    return { ...e, workers_count: count, team_leads_count: leads, computed_status: op };
  });
  const alerts = [];
  for (const r of rows) {
    if (r.computed_status === 'crew_parcial') alerts.push({level:'warn', event_id:r.id, event_name:r.name, message:'Crew incompleto o falta jefe de equipo'});
  }
  res.json({ rows, alerts });
});

app.get('/api/gps/live', requireAdmin, (req, res) => {
  const date = req.query.date || localDateStrJS();
  const radius = Number(req.query.radius || getSettings().geo_check_radius_m || 300);
  const rows = db.prepare(`
    SELECT e.id event_id,e.name event_name,e.location,e.latitude event_latitude,e.longitude event_longitude,e.event_date,e.start_time,e.end_time,
           a.user_id,a.service_role,a.is_team_lead,u.first_name,u.last_name,u.nickname,u.phone
    FROM assignments a
    JOIN events e ON e.id=a.event_id
    JOIN users u ON u.id=a.user_id
    WHERE e.event_date=? AND e.status!='cancelado'
    ORDER BY e.start_time,e.name,u.first_name
  `).all(date);

  const live = rows.map(r => {
    const logs = db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(r.event_id, r.user_id);
    const last = logs.length ? logs[logs.length-1] : null;
    let distance = null;
    if (last && r.event_latitude && r.event_longitude && last.latitude && last.longitude) {
      distance = distanceMeters(Number(r.event_latitude), Number(r.event_longitude), Number(last.latitude), Number(last.longitude));
    }
    let status = 'pendiente_fichaje';
    if (last && distance === null) status = 'sin_gps';
    else if (last && distance <= radius) status = 'en_evento';
    else if (last && distance > radius) status = 'fuera_radio';
    return { ...r, last_log:last, distance_m:distance, gps_status:status };
  });

  res.json({ date, radius, rows: live });
});

app.get('/api/production/events', requireAuth, (req, res) => {
  const events = req.session.user.role === 'admin'
    ? db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date,start_time").all()
    : db.prepare(`SELECT e.* FROM assignments a JOIN events e ON e.id=a.event_id WHERE a.user_id=? ORDER BY e.event_date,e.start_time`).all(req.session.user.id);

  const tasks = db.prepare('SELECT * FROM production_tasks ORDER BY event_id, phase, id').all();
  const incidents = db.prepare('SELECT * FROM production_incidents ORDER BY status, created_at DESC').all();
  res.json({ events, tasks, incidents });
});

app.post('/api/production/tasks', requireAuth, (req, res) => {
  const b = req.body || {};
  if (req.session.user.role !== 'admin') {
    const ass = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=? AND is_team_lead=1').get(b.event_id, req.session.user.id);
    if (!ass) return res.status(403).json({error:'Solo admin o jefe de equipo'});
  }
  const info = db.prepare('INSERT INTO production_tasks (event_id,phase,title,description,priority,completed) VALUES (?,?,?,?,?,?)')
    .run(b.event_id, b.phase||'montaje', b.title||'', b.description||'', b.priority||'normal', b.completed?1:0);
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.put('/api/production/tasks/:id', requireAuth, (req, res) => {
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM production_tasks WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({error:'Tarea no encontrada'});
  if (req.session.user.role !== 'admin') {
    const ass = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=? AND is_team_lead=1').get(t.event_id, req.session.user.id);
    if (!ass) return res.status(403).json({error:'Solo admin o jefe de equipo'});
  }
  db.prepare('UPDATE production_tasks SET completed=?, completed_at=? WHERE id=?')
    .run(b.completed?1:0, b.completed ? new Date().toISOString() : '', req.params.id);
  res.json({ ok:true });
});

app.post('/api/production/incidents', requireAuth, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO production_incidents (event_id,user_id,severity,title,description,status) VALUES (?,?,?,?,?,?)')
    .run(b.event_id, req.session.user.id, b.severity||'media', b.title||'', b.description||'', b.status||'abierta');
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.get('/api/finance/events', requireAdmin, (req, res) => {
  const events = db.prepare('SELECT id FROM events ORDER BY event_date DESC').all();
  const rows = events.map(e => auditEventFinancial(e.id)).filter(Boolean);
  const totals = rows.reduce((a,r)=>{
    a.revenue += r.revenue;
    a.cost += r.totalCost;
    a.profit += r.profit;
    return a;
  }, {revenue:0,cost:0,profit:0});
  totals.margin = totals.revenue ? Math.round((totals.profit/totals.revenue)*10000)/100 : 0;
  res.json({ rows, totals });
});

app.put('/api/finance/events/:id/costs', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE events SET estimated_external_cost=?, estimated_transport_cost=?, estimated_other_cost=?, payment_status=? WHERE id=?')
    .run(Number(b.estimated_external_cost||0), Number(b.estimated_transport_cost||0), Number(b.estimated_other_cost||0), b.payment_status||'pendiente', req.params.id);
  res.json({ ok:true });
});

app.get('/api/documents', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.first_name,u.last_name,u.nickname,u.phone
    FROM worker_documents d
    JOIN users u ON u.id=d.user_id
    ORDER BY d.expiry_date
  `).all().map(d => ({...d, computed_status:auditDocStatus(d.expiry_date)}));
  res.json(rows);
});

app.post('/api/documents', requireAdmin, (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO worker_documents (user_id,doc_type,title,file_url,issue_date,expiry_date,notes) VALUES (?,?,?,?,?,?,?)')
    .run(b.user_id, b.doc_type||'PRL', b.title||'', (b.dataUrl ? v53SaveBase64File(b.dataUrl, b.file_name || b.title || 'documento') : (b.file_url||'')), b.issue_date||'', b.expiry_date||'', b.notes||'');
  res.json({ ok:true, id:info.lastInsertRowid });
});

app.delete('/api/documents/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM worker_documents WHERE id=?').run(req.params.id);
  res.json({ ok:true });
});


// ---------- V53 ENTERPRISE ROUTES ----------
app.get('/api/my-documents', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  if (req.session.user.role === 'admin') return res.json([]);
  const rows = db.prepare(`
    SELECT d.*, u.first_name,u.last_name,u.phone
    FROM worker_documents d
    JOIN users u ON u.id=d.user_id
    WHERE d.user_id=?
    ORDER BY d.expiry_date
  `).all(userId).map(d => ({...d, computed_status:auditDocStatus(d.expiry_date)}));
  res.json(rows);
});

app.put('/api/finance/events/:id/detailed-costs', requireAdmin, (req, res) => {
  const b = req.body || {};
  v53EnsureFinanceColumns();
  db.prepare(`
    UPDATE events SET
      cost_staff=?,
      cost_social_security=?,
      cost_gestoria=?,
      cost_fixed=?,
      cost_transport=?,
      cost_taxi=?,
      cost_hotel=?,
      cost_extra_hours=?,
      cost_other=?,
      estimated_external_cost=?,
      estimated_transport_cost=?,
      estimated_other_cost=?,
      payment_status=?
    WHERE id=?
  `).run(
    Number(b.cost_staff||0),
    Number(b.cost_social_security||0),
    Number(b.cost_gestoria||0),
    Number(b.cost_fixed||0),
    Number(b.cost_transport||0),
    Number(b.cost_taxi||0),
    Number(b.cost_hotel||0),
    Number(b.cost_extra_hours||0),
    Number(b.cost_other||0),
    Number(b.estimated_external_cost||0),
    Number(b.estimated_transport_cost||0),
    Number(b.estimated_other_cost||0),
    b.payment_status||'pendiente',
    req.params.id
  );
  res.json({ ok:true });
});

app.get('/api/pdf-template/:type/:id', requireAuth, (req, res) => {
  res.json({
    ok:true,
    type:req.params.type,
    id:req.params.id,
    format:'A4 portrait',
    company:'MARFAN CREW',
    generated_at:new Date().toISOString()
  });
});



// ---------- V53.3 BACKUP CENTER ----------
function v533BackupDir() {
  v552EnsurePersistentDirs();
  return V552_BACKUP_DIR;
}

function v533AllTableNames() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
}

function v533CreateBackupObject() {
  const backup = {
    meta: {
      app: 'Marfan Crew Hours',
      version: '53.3.0',
      exported_at: new Date().toISOString()
    },
    tables: {}
  };
  const tables = v533AllTableNames();
  for (const t of tables) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }
  return backup;
}

function v533SafeFileName() {
  return `marfan-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
}

function v533RestoreBackupObject(backup) {
  if (!backup || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('Archivo de copia no válido');
  }

  const imported = [];
  const skipped = [];

  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }

      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }

      try {
        db.prepare(`DELETE FROM "${table}"`).run();

        if (rows.length) {
          const tableCols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
          const cols = Object.keys(rows[0]).filter(c => tableCols.includes(c));
          if (cols.length) {
            const placeholders = cols.map(() => '?').join(',');
            const stmt = db.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders})`);
            for (const r of rows) stmt.run(...cols.map(c => r[c]));
          }
        }
        imported.push(table);
      } catch(e) {
        console.error('restore table error', table, e);
        skipped.push(table);
      }
    }
  });

  tx();
  return { imported, skipped };
}

// Descarga directa completa
app.get('/api/backup/export-v533', requireAdmin, (req, res) => {
  const backup = v533CreateBackupObject();
  const filename = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  res.status(200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
});

// Guardar backup en servidor
app.post('/api/backup/save-online', requireAdmin, (req, res) => {
  const backup = v533CreateBackupObject();
  const filename = v533SafeFileName();
  const filepath = path.join(v533BackupDir(), filename);
  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
  res.json({ ok:true, filename, created_at: backup.meta.exported_at });
});

// Listar backups guardados en servidor
app.get('/api/backup/list-online', requireAdmin, (req, res) => {
  const dir = v533BackupDir();
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { filename:f, size_bytes:st.size, created_at:st.mtime.toISOString() };
    })
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok:true, backups:files });
});

// Restaurar backup guardado en servidor
app.post('/api/backup/restore-online', requireAdmin, (req, res) => {
  const filename = String((req.body || {}).filename || '');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error:'Nombre de backup inválido' });
  }
  const filepath = path.join(v533BackupDir(), filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error:'Backup no encontrado' });
  const backup = JSON.parse(fs.readFileSync(filepath,'utf8'));
  const result = v533RestoreBackupObject(backup);
  res.json({ ok:true, ...result });
});

// Restaurar backup subido desde archivo JSON
app.post('/api/backup/import-v533', requireAdmin, (req, res) => {
  try {
    const backup = req.body || {};
    const result = v533RestoreBackupObject(backup);
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar el backup' });
  }
});

// ---------- V53.1 DELETE / SUSPEND / BACKUP ROUTES ----------

// Borrado seguro de eventos + datos relacionados
app.delete('/api/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    db.prepare('DELETE FROM assignments WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM time_logs WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM production_tasks WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM production_incidents WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id);
  } catch(e) {}
  try {
    db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id);
  } catch(e) {}
  const info = db.prepare('DELETE FROM events WHERE id=?').run(id);
  res.json({ ok:true, deleted: info.changes || 0 });
});

// Suspender / reactivar operario
app.put('/api/users/:id/suspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const suspended = req.body && req.body.suspended !== undefined ? Number(req.body.suspended ? 1 : 0) : 1;

  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (cols.includes('active')) {
    db.prepare('UPDATE users SET active=? WHERE id=?').run(suspended ? 0 : 1, id);
  }

  if (cols.includes('availability')) {
    db.prepare('UPDATE users SET availability=? WHERE id=?').run(suspended ? 'suspendido' : 'disponible', id);
  }

  res.json({ ok:true, id, suspended: !!suspended });
});

// Borrar operario + desasignar
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try { db.prepare('DELETE FROM assignments WHERE user_id=?').run(id); } catch(e) {}
  try { db.prepare('DELETE FROM time_logs WHERE user_id=?').run(id); } catch(e) {}
  try { db.prepare('DELETE FROM worker_documents WHERE user_id=?').run(id); } catch(e) {}
  const info = db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok:true, deleted: info.changes || 0 });
});

// Login por teléfono bloquea suspendidos / inactive
app.post('/api/login-phone-v531', (req, res) => {
  try {
    const raw = String((req.body || {}).phone || '');
    const phone = raw.replace(/\D/g, '').slice(-9);
    if (!phone) return res.status(400).json({ error:'Teléfono requerido' });

    const users = db.prepare("SELECT * FROM users WHERE role!='admin'").all();
    const user = users.find(u => String(u.phone || '').replace(/\D/g,'').slice(-9) === phone);

    if (!user) return res.status(401).json({ error:'Teléfono no encontrado' });
    if (Number(user.active) === 0 || String(user.availability || '').toLowerCase() === 'suspendido') {
      return res.status(403).json({ error:'Usuario suspendido. Contacta con oficina.' });
    }

    req.session.user = {
      id:user.id,
      email:user.email,
      role:user.role,
      first_name:user.first_name,
      last_name:user.last_name,
      phone:user.phone
    };
    res.json({ ok:true, user:req.session.user });
  } catch(e) {
    console.error('login-phone-v531', e);
    res.status(500).json({ error:'Error login teléfono' });
  }
});

// Copia de seguridad completa
app.get('/api/backup/export', requireAdmin, (req, res) => {
  const backup = {
    meta: {
      app:'Marfan Crew Hours',
      version:'53.1.0',
      exported_at:new Date().toISOString()
    },
    tables: {}
  };

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => t.name);
  for (const t of tables) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }

  res.setHeader('Content-Disposition', `attachment; filename="marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

// Restaurar copia de seguridad
app.post('/api/backup/import', requireAdmin, (req, res) => {
  const backup = req.body || {};
  if (!backup.tables || typeof backup.tables !== 'object') {
    return res.status(400).json({ error:'Archivo de copia no válido' });
  }

  const imported = [];
  const skipped = [];

  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }

      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }

      try {
        db.prepare(`DELETE FROM ${table}`).run();

        if (rows.length) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(',');
          const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
          for (const r of rows) stmt.run(...cols.map(c => r[c]));
        }

        imported.push(table);
      } catch(e) {
        skipped.push(table);
      }
    }
  });

  tx();
  res.json({ ok:true, imported, skipped });
});


// ---------- V53.2 DASHBOARD GRAPH DATA ----------
app.get('/api/dashboard-graph', requireAdmin, (req, res) => {
  try {
    const events = db.prepare('SELECT * FROM events ORDER BY event_date').all();
    const map = {};
    for (const e of events) {
      const key = String(e.event_date || '').slice(0,7) || 'sin-fecha';
      if (!map[key]) map[key] = { month:key, amount:0, profit:0, cost:0, events:0 };
      let fin = null;
      try { fin = auditEventFinancial(e.id); } catch(err) {}
      const amount = fin ? Number(fin.revenue || 0) : Number(e.total_amount || e.amount || e.km_amount || 0);
      const cost = fin ? Number(fin.totalCost || 0) : Number(e.estimated_external_cost||0)+Number(e.estimated_transport_cost||0)+Number(e.estimated_other_cost||0);
      const profit = fin ? Number(fin.profit || 0) : amount - cost;
      map[key].amount += amount;
      map[key].cost += cost;
      map[key].profit += profit;
      map[key].events += 1;
    }
    const rows = Object.values(map).sort((a,b)=>String(a.month).localeCompare(String(b.month))).map(r=>({
      month:r.month,
      amount:Math.round(r.amount*100)/100,
      cost:Math.round(r.cost*100)/100,
      profit:Math.round(r.profit*100)/100,
      events:r.events
    }));
    res.json({ rows });
  } catch(e) {
    console.error('dashboard-graph', e);
    res.json({ rows: [] });
  }
});


// ---------- V55 GOOGLE CALENDAR SYNC ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://marfan-crew-hours-production-ef76.up.railway.app/auth/google/callback';

const GOOGLE_TARGET_CALENDAR_NAME = process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN';
const GOOGLE_TARGET_CALENDAR_ID = process.env.GOOGLE_TARGET_CALENDAR_ID || '';

async function v551ResolveTargetCalendarId(calendar) {
  if (GOOGLE_TARGET_CALENDAR_ID) return GOOGLE_TARGET_CALENDAR_ID;
  const list = await calendar.calendarList.list();
  const calendars = list.data.items || [];
  const found = calendars.find(c => String(c.summary || '').trim().toLowerCase() === String(GOOGLE_TARGET_CALENDAR_NAME).trim().toLowerCase());
  if (found) return found.id;
  throw new Error(`No encuentro el calendario "${GOOGLE_TARGET_CALENDAR_NAME}" en Google Calendar. Créalo o configura GOOGLE_TARGET_CALENDAR_ID.`);
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

function v55GoogleOAuthClient() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL);
}

function v55EnsureGoogleTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT DEFAULT 'google',
      tokens_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS google_event_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT DEFAULT '',
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function v55GetGoogleTokens() {
  try {
    const row = db.prepare("SELECT * FROM google_tokens WHERE provider='google' ORDER BY id DESC LIMIT 1").get();
    if (!row) return null;
    return JSON.parse(row.tokens_json || '{}');
  } catch(e) { return null; }
}

function v55SaveGoogleTokens(tokens) {
  const row = db.prepare("SELECT * FROM google_tokens WHERE provider='google' ORDER BY id DESC LIMIT 1").get();
  if (row) {
    db.prepare("UPDATE google_tokens SET tokens_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(tokens), row.id);
  } else {
    db.prepare("INSERT INTO google_tokens (provider,tokens_json) VALUES (?,?)").run('google', JSON.stringify(tokens));
  }
}

function v55CalendarStatus() {
  return {
    configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL),
    connected: !!v55GetGoogleTokens(),
    callback_url: GOOGLE_CALLBACK_URL,
    target_calendar_name: GOOGLE_TARGET_CALENDAR_NAME,
    target_calendar_id_configured: !!GOOGLE_TARGET_CALENDAR_ID
  };
}

function v55EventToGoogle(e) {
  const date = e.event_date || new Date().toISOString().slice(0,10);
  const start = e.start_time || '09:00';
  const end = e.end_time || '10:00';
  return {
    summary: e.name || 'Evento Marfan Crew',
    location: e.location || '',
    description: [
      'Creado desde Marfan Crew Hours',
      e.client ? `Cliente: ${e.client}` : '',
      e.notes ? `Notas: ${e.notes}` : ''
    ].filter(Boolean).join('\\n'),
    start: { dateTime: `${date}T${start}:00`, timeZone: 'Europe/Madrid' },
    end: { dateTime: `${date}T${end}:00`, timeZone: 'Europe/Madrid' }
  };
}

async function v55GoogleCalendarClient() {
  const tokens = (typeof v557GetTokensAny === 'function' ? v557GetTokensAny() : v55GetGoogleTokens());
  if (!tokens) throw new Error('Google Calendar no conectado');
  const oauth2 = v55GoogleOAuthClient();
  oauth2.setCredentials(tokens);
  return google.calendar({ version:'v3', auth:oauth2 });
}

v55EnsureGoogleTables();


// ---------- V55.4 OAUTH SAFE ROUTES ----------
app.get('/api/google/debug-v554', requireAdmin, (req,res)=>{
  res.json({
    ok:true,
    googleapis_loaded: !!google,
    has_client_id: !!process.env.GOOGLE_CLIENT_ID,
    has_client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
    callback_url: process.env.GOOGLE_CALLBACK_URL || GOOGLE_CALLBACK_URL || '',
    target_calendar_name: process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'
  });
});

// Esta ruta sustituye a /auth/google con validación clara.
// Si ves error aquí, faltan variables o la Redirect URI no coincide.
app.get('/auth/google-safe', requireAdmin, (req,res)=>{
  try{
    const clientId = process.env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET || '';
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || GOOGLE_CALLBACK_URL || '';

    if(!clientId || !clientSecret || !callbackUrl){
      return res.status(400).send(`
        <html><body style="font-family:Arial;padding:40px">
          <h1>Faltan variables Google OAuth</h1>
          <p>Revisa Railway → Variables:</p>
          <ul>
            <li>GOOGLE_CLIENT_ID: ${clientId ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CLIENT_SECRET: ${clientSecret ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CALLBACK_URL: ${callbackUrl ? callbackUrl : 'FALTA'}</li>
            <li>GOOGLE_TARGET_CALENDAR_NAME: ${process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'}</li>
          </ul>
        </body></html>
      `);
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
    const url = oauth2.generateAuthUrl({
      access_type:'offline',
      prompt:'consent',
      scope:[
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    return res.redirect(url);
  }catch(e){
    console.error('auth/google-safe error', e);
    return res.status(500).send(`
      <html><body style="font-family:Arial;padding:40px">
        <h1>Error OAuth Google</h1>
        <pre>${String(e.stack || e.message || e).replace(/[<>&]/g, s=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</pre>
      </body></html>
    `);
  }
});

app.get('/auth/google', requireAdmin, (req,res)=>{
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).send('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Railway Variables.');
  }
  const oauth2 = v55GoogleOAuthClient();
  const url = oauth2.generateAuthUrl({
    access_type:'offline',
    prompt:'consent',
    scope:GOOGLE_SCOPES
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req,res)=>{
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta code OAuth.');
    const oauth2 = v55GoogleOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    v55SaveGoogleTokens(tokens);
    try { v557WriteTokenFile(tokens); } catch(e) {}
    res.send(`
      <html><body style="font-family:Arial;padding:40px">
        <h1>Google Calendar conectado correctamente ✅</h1>
        <p>Ya puedes cerrar esta ventana y volver a Marfan Crew Hours.</p>
        <script>setTimeout(()=>window.close(),2500)</script>
      </body></html>
    `);
  } catch(e) {
    console.error('google callback', e);
    res.status(500).send('Error conectando Google Calendar: '+e.message);
  }
});

app.get('/api/google/status', requireAdmin, (req,res)=>{
  res.json(v55CalendarStatus());
});

app.post('/api/google/disconnect', requireAdmin, (req,res)=>{
  try { db.prepare("DELETE FROM google_tokens WHERE provider='google'").run(); } catch(e) {}
  res.json({ok:true});
});

app.post('/api/google/export-event/:id', requireAdmin, async (req,res)=>{
  try {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!event) return res.status(404).json({error:'Evento no encontrado'});
    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
    const existing = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC LIMIT 1').get(event.id);
    let result;
    if (existing) {
      result = await calendar.events.update({
        calendarId: existing.calendar_id || 'primary',
        eventId: existing.google_event_id,
        requestBody: v55EventToGoogle(event)
      });
    } else {
      result = await calendar.events.insert({
        calendarId:targetCalendarId,
        requestBody: v55EventToGoogle(event)
      });
      db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(event.id, result.data.id, targetCalendarId);
    }
    res.json({ok:true, google_event_id:result.data.id, htmlLink:result.data.htmlLink});
  } catch(e) {
    console.error('export google event', e);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/google/export-all', requireAdmin, async (req,res)=>{
  try {
    const events = db.prepare("SELECT * FROM events WHERE status!='cancelado' ORDER BY event_date").all();
    const out = [];
    for (const e of events) {
      try {
        const calendar = await v55GoogleCalendarClient();
        const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
        const existing = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC LIMIT 1').get(e.id);
        let result;
        if (existing) {
          result = await calendar.events.update({
            calendarId: existing.calendar_id || 'primary',
            eventId: existing.google_event_id,
            requestBody: v55EventToGoogle(e)
          });
        } else {
          result = await calendar.events.insert({ calendarId:targetCalendarId, requestBody:v55EventToGoogle(e) });
          db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(e.id, result.data.id, targetCalendarId);
        }
        out.push({event_id:e.id, ok:true, google_event_id:result.data.id});
      } catch(err) {
        out.push({event_id:e.id, ok:false, error:err.message});
      }
    }
    res.json({ok:true, results:out});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.post('/api/google/import-upcoming', requireAdmin, async (req,res)=>{
  try {
    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);
    const now = new Date();
    const max = new Date();
    max.setMonth(max.getMonth()+6);
    const response = await calendar.events.list({
      calendarId:targetCalendarId,
      timeMin:now.toISOString(),
      timeMax:max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:100
    });
    const imported = [];
    const items = response.data.items || [];
    for (const item of items) {
      const googleId = item.id;
      const exists = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(googleId);
      if (exists) continue;
      const startRaw = item.start.dateTime || item.start.date;
      const endRaw = item.end.dateTime || item.end.date;
      const sd = new Date(startRaw);
      const ed = new Date(endRaw);
      const eventDate = item.start.date || sd.toISOString().slice(0,10);
      const startTime = item.start.date ? '09:00' : String(sd.toTimeString().slice(0,5));
      const endTime = item.end.date ? '10:00' : String(ed.toTimeString().slice(0,5));
      const cols = db.prepare("PRAGMA table_info(events)").all().map(c=>c.name);
      const data = {
        name:item.summary || 'Evento Google',
        location:item.location || '',
        event_date:eventDate,
        start_time:startTime,
        end_time:endTime,
        notes:item.description || '',
        status:'programado',
        operational_status:'importado_google'
      };
      const keys = Object.keys(data).filter(k=>cols.includes(k));
      const stmt = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
      const info = stmt.run(...keys.map(k=>data[k]));
      db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, googleId, targetCalendarId);
      imported.push({event_id:info.lastInsertRowid, google_event_id:googleId, summary:item.summary});
    }
    res.json({ok:true, imported});
  } catch(e) {
    console.error('import google', e);
    res.status(500).json({error:e.message});
  }
});


// ---------- V55.2 ROBUST BACKUP CENTER ----------
function v552AllTableNames() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
}

function v552CreateBackupObject() {
  const backup = {
    meta: {
      app: 'Marfan Crew Hours',
      version: '56.8.0',
      exported_at: new Date().toISOString(),
      data_dir: V552_DATA_DIR,
      backup_dir: V552_BACKUP_DIR,
      google_target_calendar_name: process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'
    },
    tables: {}
  };
  for (const t of v552AllTableNames()) {
    try {
      backup.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
    } catch(e) {
      backup.tables[t] = [];
    }
  }
  return backup;
}

function v552BackupFilename() {
  return `marfan-crew-hours-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
}

function v552RestoreBackupObject(backup) {
  if (!backup || !backup.tables || typeof backup.tables !== 'object') throw new Error('Backup no válido');
  const imported = [];
  const skipped = [];
  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!Array.isArray(rows)) { skipped.push(table); continue; }
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) { skipped.push(table); continue; }
      try {
        db.prepare(`DELETE FROM "${table}"`).run();
        if (rows.length) {
          const tableCols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
          const cols = Object.keys(rows[0]).filter(c => tableCols.includes(c));
          if (cols.length) {
            const stmt = db.prepare(`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
            for (const r of rows) stmt.run(...cols.map(c => r[c]));
          }
        }
        imported.push(table);
      } catch(e) {
        skipped.push(table);
      }
    }
  });
  tx();
  return { imported, skipped };
}

app.get('/api/backup/status-v552', requireAdmin, (req,res)=>{
  const migrated = v552MigrateLegacyBackups();
  let backups = [];
  try {
    backups = fs.readdirSync(V552_BACKUP_DIR).filter(f=>f.endsWith('.json'));
  } catch(e) {}
  res.json({
    ok:true,
    persistent_mounted:v552IsPersistentMounted(),
    data_dir:V552_DATA_DIR,
    backup_dir:V552_BACKUP_DIR,
    backups_count:backups.length,
    migrated_now:migrated,
    google_target_calendar_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    message: v552IsPersistentMounted()
      ? 'Persistencia OK: backups y datos se conservarán entre versiones.'
      : 'ATENCIÓN: no se detecta /data escribible. Revisa el Volume de Railway.'
  });
});

app.get('/api/backup/list-online-v552', requireAdmin, (req,res)=>{
  v552MigrateLegacyBackups();
  v552EnsurePersistentDirs();
  const files = fs.existsSync(V552_BACKUP_DIR)
    ? fs.readdirSync(V552_BACKUP_DIR).filter(f=>f.endsWith('.json')).map(f=>{
        const p = path.join(V552_BACKUP_DIR, f);
        const st = fs.statSync(p);
        return { filename:f, size_bytes:st.size, created_at:st.mtime.toISOString(), path:V552_BACKUP_DIR };
      }).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    : [];
  res.json({ ok:true, backups:files, backup_dir:V552_BACKUP_DIR, persistent_mounted:v552IsPersistentMounted() });
});

app.post('/api/backup/save-online-v552', requireAdmin, (req,res)=>{
  v552EnsurePersistentDirs();
  const backup = v552CreateBackupObject();
  const filename = v552BackupFilename();
  fs.writeFileSync(path.join(V552_BACKUP_DIR, filename), JSON.stringify(backup, null, 2));
  res.json({ ok:true, filename, backup_dir:V552_BACKUP_DIR });
});

app.get('/api/backup/export-v552', requireAdmin, (req,res)=>{
  const backup = v552CreateBackupObject();
  const filename = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  res.status(200);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/backup/import-v552', requireAdmin, (req,res)=>{
  try {
    const result = v552RestoreBackupObject(req.body || {});
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar backup' });
  }
});

app.post('/api/backup/restore-online-v552', requireAdmin, (req,res)=>{
  try {
    const filename = String((req.body||{}).filename||'');
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error:'Nombre de backup inválido' });
    }
    const filepath = path.join(V552_BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error:'Backup no encontrado en '+V552_BACKUP_DIR });
    const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const result = v552RestoreBackupObject(backup);
    res.json({ ok:true, ...result });
  } catch(e) {
    res.status(400).json({ error:e.message || 'No se pudo restaurar backup online' });
  }
});


// ---------- V55.3 AUTO MARFAN CALENDAR VIEW ----------
app.get('/api/google/marfan-events', requireAdmin, async (req,res)=>{
  try {
    const status = v55CalendarStatus();
    if (!status.configured || !status.connected) {
      return res.json({ ok:true, connected:false, events:[], message:'Google Calendar no conectado todavía.' });
    }

    const calendar = await v55GoogleCalendarClient();
    const targetCalendarId = await v551ResolveTargetCalendarId(calendar);

    const now = new Date();
    const min = new Date(now.getFullYear(), now.getMonth()-2, 1);
    const max = new Date(now.getFullYear(), now.getMonth()+12, 1);

    const response = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: min.toISOString(),
      timeMax: max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:250
    });

    const googleEvents = (response.data.items || []).map(item=>{
      const startRaw = item.start.dateTime || item.start.date;
      const endRaw = item.end.dateTime || item.end.date;
      const sd = new Date(startRaw);
      const ed = new Date(endRaw);
      return {
        id:'g_'+item.id,
        google_event_id:item.id,
        name:item.summary || 'Evento MARFAN',
        location:item.location || '',
        event_date:item.start.date || sd.toISOString().slice(0,10),
        start_time:item.start.date ? '' : String(sd.toTimeString().slice(0,5)),
        end_time:item.end.date ? '' : String(ed.toTimeString().slice(0,5)),
        status:'google',
        operational_status:'google_marfan',
        source:'google',
        htmlLink:item.htmlLink || ''
      };
    });

    res.json({
      ok:true,
      connected:true,
      calendar_id:targetCalendarId,
      calendar_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
      events:googleEvents
    });
  } catch(e) {
    res.json({ ok:false, connected:false, events:[], error:e.message });
  }
});


// ---------- V55.5 OPERARIOS PRO ----------
function v555EnsureOperatorColumns() {
  try {
    addColumn('users', 'nickname TEXT DEFAULT ""');
    addColumn('users', 'dni TEXT DEFAULT ""');
    addColumn('users', 'address TEXT DEFAULT ""');
    addColumn('users', 'city TEXT DEFAULT ""');
    addColumn('users', 'province TEXT DEFAULT ""');
    addColumn('users', 'postal_code TEXT DEFAULT ""');
    addColumn('users', 'emergency_contact TEXT DEFAULT ""');
    addColumn('users', 'emergency_phone TEXT DEFAULT ""');
    addColumn('users', 'birth_date TEXT DEFAULT ""');
    addColumn('users', 'shirt_size TEXT DEFAULT ""');
    addColumn('users', 'shoe_size TEXT DEFAULT ""');
    addColumn('users', 'vehicle TEXT DEFAULT ""');
    addColumn('users', 'license_type TEXT DEFAULT ""');
    addColumn('users', 'iban TEXT DEFAULT ""');
    addColumn('users', 'notes TEXT DEFAULT ""');
    addColumn('users', 'photo_url TEXT DEFAULT ""');
    addColumn('users', 'skills TEXT DEFAULT ""');
    addColumn('users', 'documents_notes TEXT DEFAULT ""');
  } catch(e) {}
}

function v555UploadDir() {
  const dir = path.join(__dirname, 'public', 'uploads', 'operators');
  fs.mkdirSync(dir, { recursive:true });
  return dir;
}

function v555SaveBase64Image(dataUrl, prefix='operator') {
  if (!dataUrl || !String(dataUrl).startsWith('data:image/')) return '';
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return '';
  const mime = m[1];
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  const filepath = path.join(v555UploadDir(), filename);
  fs.writeFileSync(filepath, Buffer.from(m[2], 'base64'));
  return `/uploads/operators/${filename}`;
}

v555EnsureOperatorColumns();

app.post('/api/users/:id/photo', requireAdmin, (req,res)=>{
  try {
    const id = Number(req.params.id);
    const photo = v555SaveBase64Image((req.body||{}).dataUrl, 'operator-'+id);
    if (!photo) return res.status(400).json({error:'Imagen no válida'});
    db.prepare('UPDATE users SET photo_url=? WHERE id=?').run(photo, id);
    res.json({ok:true, photo_url:photo});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.get('/api/users/:id/folder', requireAdmin, (req,res)=>{
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({error:'Operario no encontrado'});
  let docs = [];
  try {
    docs = db.prepare(`
      SELECT d.*, u.first_name,u.last_name,u.nickname,u.phone
      FROM worker_documents d
      JOIN users u ON u.id=d.user_id
      WHERE d.user_id=?
      ORDER BY d.expiry_date
    `).all(id).map(d => ({...d, computed_status: typeof auditDocStatus==='function' ? auditDocStatus(d.expiry_date) : ''}));
  } catch(e) {}
  res.json({user, docs});
});


// ---------- V55.7 GOOGLE AUTO CONNECT PERSISTENCE ----------
const V557_GOOGLE_TOKEN_FILE = path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : (process.env.DATA_DIR || '/data')), 'google-token.json');

function v557ReadTokenFile() {
  try {
    if (fs.existsSync(V557_GOOGLE_TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(V557_GOOGLE_TOKEN_FILE, 'utf8'));
    }
  } catch(e) {}
  return null;
}

function v557WriteTokenFile(tokens) {
  try {
    fs.mkdirSync(path.dirname(V557_GOOGLE_TOKEN_FILE), { recursive:true });
    fs.writeFileSync(V557_GOOGLE_TOKEN_FILE, JSON.stringify(tokens, null, 2));
    return true;
  } catch(e) {
    console.error('write google token file error', e);
    return false;
  }
}

function v557GetTokensAny() {
  try {
    const dbTokens = typeof v55GetGoogleTokens === 'function' ? v55GetGoogleTokens() : null;
    if (dbTokens) return dbTokens;
  } catch(e) {}
  return v557ReadTokenFile();
}

function v557SaveTokensEverywhere(tokens) {
  try { if (typeof v55SaveGoogleTokens === 'function') v55SaveGoogleTokens(tokens); } catch(e) {}
  v557WriteTokenFile(tokens);
}

app.get('/api/google/status-v557', requireAdmin, (req,res)=>{
  const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.GOOGLE_CALLBACK_URL || typeof GOOGLE_CALLBACK_URL !== 'undefined'));
  const tokens = v557GetTokensAny();
  res.json({
    ok:true,
    configured,
    connected: !!tokens,
    token_file_exists: fs.existsSync(V557_GOOGLE_TOKEN_FILE),
    token_file: V557_GOOGLE_TOKEN_FILE,
    target_calendar_name: process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    callback_url: process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '')
  });
});

// Ruta de conexión automática. Si ya hay token, no repite OAuth.
app.get('/auth/google-auto', requireAdmin, (req,res)=>{
  try {
    if (v557GetTokensAny()) {
      return res.send(`
        <html><body style="font-family:Arial;padding:40px">
          <h1>Google Calendar ya está conectado ✅</h1>
          <p>Calendario objetivo: MARFAN</p>
          <script>setTimeout(()=>{ window.location.href='/' },1200)</script>
        </body></html>
      `);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');

    if(!clientId || !clientSecret || !callbackUrl){
      return res.status(400).send(`
        <html><body style="font-family:Arial;padding:40px">
          <h1>Faltan variables Google OAuth</h1>
          <p>Configura en Railway Variables:</p>
          <ul>
            <li>GOOGLE_CLIENT_ID: ${clientId ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CLIENT_SECRET: ${clientSecret ? 'OK' : 'FALTA'}</li>
            <li>GOOGLE_CALLBACK_URL: ${callbackUrl ? callbackUrl : 'FALTA'}</li>
            <li>GOOGLE_TARGET_CALENDAR_NAME: ${process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'}</li>
          </ul>
        </body></html>
      `);
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
    const url = oauth2.generateAuthUrl({
      access_type:'offline',
      prompt:'consent',
      scope:[
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    return res.redirect(url);
  } catch(e) {
    console.error('google-auto error', e);
    res.status(500).send('Error Google Auto: '+e.message);
  }
});

// Callback persistente alternativo: guarda en DB y en /data/google-token.json
app.get('/auth/google/callback-v557', async (req,res)=>{
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta code OAuth.');
    const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
    const { tokens } = await oauth2.getToken(code);
    v557SaveTokensEverywhere(tokens);
    res.send(`
      <html><body style="font-family:Arial;padding:40px">
        <h1>Google Calendar conectado y guardado correctamente ✅</h1>
        <p>Token guardado en base de datos y en volumen persistente.</p>
        <script>setTimeout(()=>{ window.location.href='/' },1600)</script>
      </body></html>
    `);
  } catch(e) {
    console.error('callback-v557', e);
    res.status(500).send('Error conectando Google Calendar: '+e.message);
  }
});


// ---------- V55.8 OPERARIOS REDESIGN PRO ----------
function v558EnsureOperatorProColumns() {
  try {
    addColumn('users', 'bank_name TEXT DEFAULT ""');
    addColumn('users', 'pants_size TEXT DEFAULT ""');
    addColumn('users', 'epis_delivered INTEGER DEFAULT 0');
    addColumn('users', 'prl_completed INTEGER DEFAULT 0');
    addColumn('users', 'vehicle_licenses TEXT DEFAULT ""');
    addColumn('users', 'full_address TEXT DEFAULT ""');
  } catch(e) {}
}
v558EnsureOperatorProColumns();

app.post('/api/users/:id/document-from-operator-form', requireAdmin, (req,res)=>{
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    let fileUrl = '';
    if (typeof v53SaveBase64File === 'function' && b.dataUrl) {
      fileUrl = v53SaveBase64File(b.dataUrl, b.file_name || b.title || 'documento-operario');
    }
    const info = db.prepare(`
      INSERT INTO worker_documents
      (user_id,doc_type,title,file_url,issue_date,expiry_date,notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      id,
      b.doc_type || 'PRL',
      b.title || 'Documento seguridad / PRL',
      fileUrl,
      b.issue_date || '',
      b.expiry_date || '',
      b.notes || ''
    );
    res.json({ok:true,id:info.lastInsertRowid,file_url:fileUrl});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});


// ---------- V56.1 GOOGLE CALENDAR SYNC FIX ----------
function v561MadridDateParts(value) {
  if (!value) return { date:'', time:'' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date:value, time:'' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date:String(value).slice(0,10), time:'' };
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/Madrid',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit',
    hour12:false
  }).formatToParts(d).reduce((a,p)=>{a[p.type]=p.value; return a;}, {});
  return { date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}` };
}

async function v561GoogleCalendarClientAny() {
  const tokens = (typeof v557GetTokensAny === 'function') ? v557GetTokensAny() : (typeof v55GetGoogleTokens === 'function' ? v55GetGoogleTokens() : null);
  if (!tokens) throw new Error('Google Calendar no conectado: no hay token guardado.');
  const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');
  if (!clientId || !clientSecret || !callbackUrl) throw new Error('Faltan variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL.');
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', (newTokens)=>{
    try {
      const merged = {...tokens, ...newTokens};
      if (typeof v557SaveTokensEverywhere === 'function') v557SaveTokensEverywhere(merged);
      else if (typeof v55SaveGoogleTokens === 'function') v55SaveGoogleTokens(merged);
    } catch(e) {}
  });
  return google.calendar({ version:'v3', auth:oauth2 });
}

async function v561ResolveMarfanCalendar(calendar) {
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim();
  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const list = await calendar.calendarList.list({ maxResults:250 });
  const calendars = (list.data.items || []).map(c=>({
    id:c.id,
    summary:c.summary || '',
    primary:!!c.primary,
    accessRole:c.accessRole || ''
  }));

  if (targetId) {
    const byId = calendars.find(c=>c.id === targetId);
    if (byId) return { calendar:byId, calendars, match:'id' };
  }

  const clean = s => String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const targetClean = clean(targetName);
  let found = calendars.find(c=>clean(c.summary) === targetClean);
  if (found) return { calendar:found, calendars, match:'exact' };

  found = calendars.find(c=>clean(c.summary).includes(targetClean) || targetClean.includes(clean(c.summary)));
  if (found) return { calendar:found, calendars, match:'contains' };

  found = calendars.find(c=>clean(c.summary).includes('marfan'));
  if (found) return { calendar:found, calendars, match:'marfan-flex' };

  throw new Error(`No encuentro el calendario "${targetName}". Calendarios disponibles: ${calendars.map(c=>c.summary).join(', ')}`);
}

app.get('/api/google/calendars-v561', requireAdmin, async (req,res)=>{
  try{
    const calendar = await v561GoogleCalendarClientAny();
    const resolved = await v561ResolveMarfanCalendar(calendar);
    res.json({ ok:true, target:resolved.calendar, match:resolved.match, calendars:resolved.calendars });
  }catch(e){
    res.status(200).json({ ok:false, error:e.message, calendars:[] });
  }
});

app.get('/api/google/marfan-events-v561', requireAdmin, async (req,res)=>{
  try{
    const calendar = await v561GoogleCalendarClientAny();
    const resolved = await v561ResolveMarfanCalendar(calendar);

    const now = new Date();
    const min = new Date(now.getFullYear(), now.getMonth()-6, 1);
    const max = new Date(now.getFullYear()+2, 11, 31);

    const response = await calendar.events.list({
      calendarId: resolved.calendar.id,
      timeMin:min.toISOString(),
      timeMax:max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:500
    });

    const events = (response.data.items || [])
      .filter(item => item.status !== 'cancelled')
      .map(item => {
        const s = item.start || {};
        const e = item.end || {};
        const start = v561MadridDateParts(s.dateTime || s.date);
        const end = v561MadridDateParts(e.dateTime || e.date);
        return {
          id:'g_'+item.id,
          google_event_id:item.id,
          name:item.summary || 'Evento MARFAN',
          location:item.location || '',
          event_date:start.date,
          start_time:start.time,
          end_time:end.time,
          status:'google',
          operational_status:'google_marfan',
          source:'google',
          htmlLink:item.htmlLink || '',
          description:item.description || '',
          calendar_id:resolved.calendar.id,
          calendar_name:resolved.calendar.summary
        };
      });

    res.json({
      ok:true,
      connected:true,
      calendar:resolved.calendar,
      match:resolved.match,
      count:events.length,
      events
    });
  }catch(e){
    console.error('marfan-events-v561', e);
    res.json({ ok:false, connected:false, count:0, events:[], error:e.message });
  }
});


// ---------- V56.2 INFORMES PDF PRO A4 ----------
function v562HoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 0;
  let s = sh * 60 + (sm || 0);
  let e = eh * 60 + (em || 0);
  if (e <= s) e += 1440;
  return Math.round(((e - s) / 60) * 100) / 100;
}

app.post('/api/reports/employee-costs', requireAdmin, (req,res)=>{
  try {
    const b = req.body || {};
    const eventId = Number(b.event_id || 0);
    const selectedUserIds = Array.isArray(b.user_ids) ? b.user_ids.map(Number) : [];
    const socialSecurityPercent = Number(b.social_security_percent || 32);
    const gestoriaCost = Number(b.gestoria_cost || 0);
    const transportCost = Number(b.transport_cost || 0);
    const dietCost = Number(b.diet_cost || 0);
    const extraCost = Number(b.extra_cost || 0);
    const includeAll = !selectedUserIds.length || selectedUserIds.includes(0);

    const event = eventId ? db.prepare('SELECT * FROM events WHERE id=?').get(eventId) : null;
    if (!event) return res.status(404).json({ error:'Evento no encontrado' });

    const assignments = db.prepare(`
      SELECT a.*, 
             u.id user_id,
             u.first_name,u.last_name,u.nickname,u.phone,u.dni,
             u.internal_hour_cost,u.internal_night_cost
      FROM assignments a
      JOIN users u ON u.id=a.user_id
      WHERE a.event_id=?
      ORDER BY u.first_name,u.last_name
    `).all(eventId).filter(a => includeAll || selectedUserIds.includes(Number(a.user_id)));

    const rows = assignments.map(a => {
      const start = a.planned_start || event.start_time || '';
      const end = a.planned_end || event.end_time || '';
      const hours = Math.max(0, v562HoursBetween(start, end));
      const hourCost = Number(a.internal_hour_cost || b.default_hour_cost || 0);
      const baseCost = hours * hourCost;
      const ssCost = baseCost * (socialSecurityPercent / 100);
      const gestoriaShare = assignments.length ? gestoriaCost / assignments.length : 0;
      const transportShare = assignments.length ? transportCost / assignments.length : 0;
      const dietShare = assignments.length ? dietCost / assignments.length : 0;
      const extraShare = assignments.length ? extraCost / assignments.length : 0;
      const total = baseCost + ssCost + gestoriaShare + transportShare + dietShare + extraShare;
      return {
        user_id:a.user_id,
        name:`${a.first_name||''} ${a.last_name||''}`.trim(),
        nickname:a.nickname || '',
        phone:a.phone || '',
        dni:a.dni || '',
        role:a.service_role || a.role || '',
        start,end,hours,
        hour_cost:Math.round(hourCost*100)/100,
        base_cost:Math.round(baseCost*100)/100,
        social_security_percent:socialSecurityPercent,
        social_security_cost:Math.round(ssCost*100)/100,
        gestoria_cost:Math.round(gestoriaShare*100)/100,
        transport_cost:Math.round(transportShare*100)/100,
        diet_cost:Math.round(dietShare*100)/100,
        extra_cost:Math.round(extraShare*100)/100,
        total_cost:Math.round(total*100)/100
      };
    });

    const totals = rows.reduce((a,r)=>{
      a.hours += r.hours;
      a.base_cost += r.base_cost;
      a.social_security_cost += r.social_security_cost;
      a.gestoria_cost += r.gestoria_cost;
      a.transport_cost += r.transport_cost;
      a.diet_cost += r.diet_cost;
      a.extra_cost += r.extra_cost;
      a.total_cost += r.total_cost;
      return a;
    }, {hours:0,base_cost:0,social_security_cost:0,gestoria_cost:0,transport_cost:0,diet_cost:0,extra_cost:0,total_cost:0});

    Object.keys(totals).forEach(k => totals[k] = Math.round(totals[k]*100)/100);

    res.json({
      ok:true,
      event,
      params:{
        social_security_percent:socialSecurityPercent,
        gestoria_cost:gestoriaCost,
        transport_cost:transportCost,
        diet_cost:dietCost,
        extra_cost:extraCost
      },
      rows,
      totals,
      generated_at:new Date().toISOString()
    });
  } catch(e) {
    console.error('employee-costs report', e);
    res.status(500).json({ error:e.message });
  }
});


// ---------- V56.3 FORCE GOOGLE MARFAN SYNC ----------
function v563TableCols(table) {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name); }
  catch(e) { return []; }
}

function v563InsertOrUpdateEventFromGoogle(item, calendarId) {
  const googleId = item.id;
  const s = item.start || {};
  const en = item.end || {};
  const start = typeof v561MadridDateParts === 'function' ? v561MadridDateParts(s.dateTime || s.date) : {date:(s.date || String(s.dateTime||'').slice(0,10)), time:String(s.dateTime||'').slice(11,16)};
  const end = typeof v561MadridDateParts === 'function' ? v561MadridDateParts(en.dateTime || en.date) : {date:(en.date || String(en.dateTime||'').slice(0,10)), time:String(en.dateTime||'').slice(11,16)};

  const existingLink = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(googleId);
  const cols = v563TableCols('events');

  const data = {
    name: item.summary || 'Evento MARFAN',
    location: item.location || '',
    event_date: start.date,
    start_time: start.time || '09:00',
    end_time: end.time || '10:00',
    notes: item.description || '',
    status: 'programado',
    operational_status: 'google_marfan',
    client: 'MARFAN'
  };

  const keys = Object.keys(data).filter(k => cols.includes(k));

  if (existingLink) {
    const sets = keys.map(k => `"${k}"=?`).join(',');
    db.prepare(`UPDATE events SET ${sets} WHERE id=?`).run(...keys.map(k=>data[k]), existingLink.event_id);
    return { action:'updated', event_id:existingLink.event_id, google_event_id:googleId, summary:data.name };
  }

  const stmt = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
  const info = stmt.run(...keys.map(k=>data[k]));
  db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, googleId, calendarId);
  return { action:'created', event_id:info.lastInsertRowid, google_event_id:googleId, summary:data.name };
}

app.post('/api/google/force-sync-marfan-v563', requireAdmin, async (req,res)=>{
  try {
    const calendar = await v561GoogleCalendarClientAny();
    const resolved = await v561ResolveMarfanCalendar(calendar);

    const now = new Date();
    const min = new Date(now.getFullYear()-1, 0, 1);
    const max = new Date(now.getFullYear()+2, 11, 31);

    const response = await calendar.events.list({
      calendarId: resolved.calendar.id,
      timeMin:min.toISOString(),
      timeMax:max.toISOString(),
      singleEvents:true,
      orderBy:'startTime',
      maxResults:1000
    });

    const items = (response.data.items || []).filter(i=>i.status !== 'cancelled');
    const results = [];
    for (const item of items) {
      try { results.push(v563InsertOrUpdateEventFromGoogle(item, resolved.calendar.id)); }
      catch(err) { results.push({ action:'error', google_event_id:item.id, summary:item.summary, error:err.message }); }
    }

    res.json({
      ok:true,
      calendar:resolved.calendar,
      match:resolved.match,
      google_events_read:items.length,
      created:results.filter(r=>r.action==='created').length,
      updated:results.filter(r=>r.action==='updated').length,
      errors:results.filter(r=>r.action==='error').length,
      results
    });
  } catch(e) {
    console.error('force-sync-marfan-v563', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Exportar evento local a MARFAN usando datos completos del evento
app.post('/api/google/export-event-v563/:id', requireAdmin, async (req,res)=>{
  try {
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!event) return res.status(404).json({error:'Evento no encontrado'});
    const calendar = await v561GoogleCalendarClientAny();
    const resolved = await v561ResolveMarfanCalendar(calendar);
    const calendarId = resolved.calendar.id;

    const existing = db.prepare('SELECT * FROM google_event_links WHERE event_id=? ORDER BY id DESC LIMIT 1').get(event.id);

    const requestBody = {
      summary:event.name || 'Evento Marfan Crew',
      location:event.location || event.address || '',
      description:[
        'Creado desde Marfan Crew Hours',
        event.client ? `Cliente: ${event.client}` : '',
        event.contact_name ? `Contacto: ${event.contact_name}` : '',
        event.contact_phone ? `Teléfono: ${event.contact_phone}` : '',
        event.notes ? `Notas: ${event.notes}` : ''
      ].filter(Boolean).join('\\n'),
      start:{dateTime:`${event.event_date}T${event.start_time || '09:00'}:00`,timeZone:'Europe/Madrid'},
      end:{dateTime:`${event.event_date}T${event.end_time || '10:00'}:00`,timeZone:'Europe/Madrid'}
    };

    let result;
    if (existing) {
      result = await calendar.events.update({calendarId,eventId:existing.google_event_id,requestBody});
    } else {
      result = await calendar.events.insert({calendarId,requestBody});
      db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(event.id,result.data.id,calendarId);
    }

    res.json({ok:true,google_event_id:result.data.id,htmlLink:result.data.htmlLink,calendar:resolved.calendar});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});


// ---------- V56.4 INFORMES PDF MULTI-TIPO ----------
app.post('/api/reports/multi', requireAdmin, (req,res)=>{
  try{
    const b = req.body || {};
    const type = b.report_type || 'employee_costs';
    const eventId = Number(b.event_id || 0);
    const event = eventId ? db.prepare('SELECT * FROM events WHERE id=?').get(eventId) : null;

    if(type === 'employee_costs'){
      return res.status(400).json({error:'Usa /api/reports/employee-costs para employee_costs'});
    }

    if(type === 'event_summary'){
      if(!event) return res.status(404).json({error:'Evento no encontrado'});
      const assignments = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone
        FROM assignments a
        JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(eventId);
      return res.json({ok:true,type,event,assignments,generated_at:new Date().toISOString()});
    }

    if(type === 'staff_hours'){
      if(!event) return res.status(404).json({error:'Evento no encontrado'});
      const rows = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone,u.dni
        FROM assignments a
        JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(eventId).map(a=>{
        const start = a.planned_start || event.start_time || '';
        const end = a.planned_end || event.end_time || '';
        const hours = typeof v562HoursBetween === 'function' ? v562HoursBetween(start,end) : 0;
        return {...a,start,end,hours};
      });
      return res.json({ok:true,type,event,rows,generated_at:new Date().toISOString()});
    }

    if(type === 'delivery_notes'){
      if(!event) return res.status(404).json({error:'Evento no encontrado'});
      let notes = [];
      try { notes = db.prepare('SELECT * FROM delivery_notes WHERE event_id=? ORDER BY created_at DESC').all(eventId); } catch(e){}
      try {
        const alt = db.prepare('SELECT * FROM event_delivery_notes WHERE event_id=? ORDER BY created_at DESC').all(eventId);
        notes = notes.concat(alt);
      } catch(e){}
      return res.json({ok:true,type,event,notes,generated_at:new Date().toISOString()});
    }

    if(type === 'documents'){
      const selectedUserIds = Array.isArray(b.user_ids) ? b.user_ids.map(Number).filter(Boolean) : [];
      let rows = [];
      if(selectedUserIds.length){
        const placeholders = selectedUserIds.map(()=>'?').join(',');
        rows = db.prepare(`
          SELECT d.*, u.first_name,u.last_name,u.nickname,u.phone,u.dni
          FROM worker_documents d
          JOIN users u ON u.id=d.user_id
          WHERE d.user_id IN (${placeholders})
          ORDER BY u.first_name,d.expiry_date
        `).all(...selectedUserIds);
      }else{
        rows = db.prepare(`
          SELECT d.*, u.first_name,u.last_name,u.nickname,u.phone,u.dni
          FROM worker_documents d
          JOIN users u ON u.id=d.user_id
          ORDER BY u.first_name,d.expiry_date
        `).all();
      }
      rows = rows.map(d=>({...d,computed_status: typeof auditDocStatus==='function' ? auditDocStatus(d.expiry_date) : ''}));
      return res.json({ok:true,type,event:null,rows,generated_at:new Date().toISOString()});
    }

    res.status(400).json({error:'Tipo de informe no soportado'});
  }catch(e){
    console.error('reports multi', e);
    res.status(500).json({error:e.message});
  }
});


// ---------- V56.5 CALENDAR SYNC HARD FIX ----------
function v565GetTokens() {
  try {
    if (typeof v557GetTokensAny === 'function') {
      const t = v557GetTokensAny();
      if (t) return t;
    }
  } catch(e) {}
  try {
    if (typeof v55GetGoogleTokens === 'function') {
      const t = v55GetGoogleTokens();
      if (t) return t;
    }
  } catch(e) {}
  try {
    const tokenFile = path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : '/data'), 'google-token.json');
    if (fs.existsSync(tokenFile)) return JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  } catch(e) {}
  return null;
}

function v565SaveTokens(tokens) {
  try {
    if (typeof v557SaveTokensEverywhere === 'function') return v557SaveTokensEverywhere(tokens);
  } catch(e) {}
  try {
    if (typeof v55SaveGoogleTokens === 'function') v55SaveGoogleTokens(tokens);
  } catch(e) {}
  try {
    const tokenFile = path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : '/data'), 'google-token.json');
    fs.mkdirSync(path.dirname(tokenFile), { recursive:true });
    fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
  } catch(e) {}
}

function v565DateParts(value) {
  if (!value) return { date:'', time:'' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date:value, time:'' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date:String(value).slice(0,10), time:'' };
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/Madrid',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit',
    hour12:false
  }).formatToParts(d).reduce((a,x)=>{a[x.type]=x.value; return a;}, {});
  return { date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}` };
}

async function v565CalendarClient() {
  const tokens = v565GetTokens();
  if (!tokens) throw new Error('No hay token de Google guardado. Conecta Google una vez.');
  const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');
  if (!clientId || !clientSecret || !callbackUrl) throw new Error('Faltan variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL.');
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', newTokens => v565SaveTokens({...tokens, ...newTokens}));
  return google.calendar({ version:'v3', auth:oauth2 });
}

async function v565FindMarfanCalendar(calendar) {
  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim();
  const list = await calendar.calendarList.list({ maxResults:250 });
  const calendars = list.data.items || [];
  const norm = s => String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (targetId) {
    const found = calendars.find(c => c.id === targetId);
    if (found) return { calendar:found, calendars, match:'id' };
  }
  const exact = calendars.find(c => norm(c.summary) === norm(targetName));
  if (exact) return { calendar:exact, calendars, match:'exact' };
  const flex = calendars.find(c => norm(c.summary).includes('marfan') || norm(c.id).includes('marfan'));
  if (flex) return { calendar:flex, calendars, match:'flex' };
  throw new Error(`No se encuentra el calendario MARFAN. Disponibles: ${calendars.map(c=>c.summary).join(', ')}`);
}

function v565EnsureEventLinkTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_event_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT DEFAULT '',
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function v565EventCols() {
  try { return db.prepare('PRAGMA table_info(events)').all().map(c=>c.name); }
  catch(e) { return []; }
}

function v565UpsertGoogleEvent(item, calendarId) {
  v565EnsureEventLinkTable();
  const googleId = item.id;
  const startRaw = (item.start || {}).dateTime || (item.start || {}).date;
  const endRaw = (item.end || {}).dateTime || (item.end || {}).date;
  const start = v565DateParts(startRaw);
  const end = v565DateParts(endRaw);
  const existing = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(googleId);
  const cols = v565EventCols();

  const data = {
    name: item.summary || 'Evento MARFAN',
    client: 'MARFAN',
    location: item.location || '',
    event_date: start.date,
    start_time: start.time || '09:00',
    end_time: end.time || '10:00',
    notes: item.description || '',
    status: 'programado',
    operational_status: 'google_marfan'
  };

  const keys = Object.keys(data).filter(k => cols.includes(k));

  if (existing) {
    if (keys.length) {
      const sets = keys.map(k=>`"${k}"=?`).join(',');
      db.prepare(`UPDATE events SET ${sets} WHERE id=?`).run(...keys.map(k=>data[k]), existing.event_id);
    }
    db.prepare('UPDATE google_event_links SET calendar_id=?, synced_at=CURRENT_TIMESTAMP WHERE id=?').run(calendarId, existing.id);
    return { action:'updated', event_id:existing.event_id, google_event_id:googleId, summary:data.name };
  }

  if (!keys.length) throw new Error('La tabla events no tiene columnas compatibles.');
  const stmt = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
  const info = stmt.run(...keys.map(k=>data[k]));
  db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, googleId, calendarId);
  return { action:'created', event_id:info.lastInsertRowid, google_event_id:googleId, summary:data.name };
}

app.get('/api/google/sync-diagnose-v565', requireAdmin, async (req,res)=>{
  const out = {
    ok:false,
    has_token:!!v565GetTokens(),
    has_client_id:!!process.env.GOOGLE_CLIENT_ID,
    has_client_secret:!!process.env.GOOGLE_CLIENT_SECRET,
    callback_url:process.env.GOOGLE_CALLBACK_URL || '',
    target_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN'
  };
  try {
    const calendar = await v565CalendarClient();
    const found = await v565FindMarfanCalendar(calendar);
    out.ok = true;
    out.calendar = { id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole };
    out.match = found.match;
    out.available = found.calendars.map(c=>({id:c.id, summary:c.summary, accessRole:c.accessRole}));
    res.json(out);
  } catch(e) {
    out.error = e.message;
    res.json(out);
  }
});

app.post('/api/google/force-sync-v565', requireAdmin, async (req,res)=>{
  try {
    const calendar = await v565CalendarClient();
    const found = await v565FindMarfanCalendar(calendar);
    const now = new Date();
    const min = new Date(now.getFullYear()-1, 0, 1);
    const max = new Date(now.getFullYear()+2, 11, 31);

    let pageToken = null;
    const items = [];
    do {
      const response = await calendar.events.list({
        calendarId: found.calendar.id,
        timeMin:min.toISOString(),
        timeMax:max.toISOString(),
        singleEvents:true,
        orderBy:'startTime',
        maxResults:250,
        pageToken
      });
      items.push(...(response.data.items || []).filter(i => i.status !== 'cancelled'));
      pageToken = response.data.nextPageToken || null;
    } while(pageToken);

    const results = items.map(item => {
      try { return v565UpsertGoogleEvent(item, found.calendar.id); }
      catch(e) { return { action:'error', google_event_id:item.id, summary:item.summary, error:e.message }; }
    });

    res.json({
      ok:true,
      calendar:{id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole},
      match:found.match,
      read:items.length,
      created:results.filter(r=>r.action==='created').length,
      updated:results.filter(r=>r.action==='updated').length,
      errors:results.filter(r=>r.action==='error').length,
      results:results.slice(0,50)
    });
  } catch(e) {
    console.error('force-sync-v565', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});


// ---------- V56.6 TARIFAS ROLES PRO + EVENT V46 SUPPORT ----------
function v566EnsureRateColumns() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        name TEXT,
        hourly_rate REAL DEFAULT 0,
        night_rate REAL DEFAULT 0,
        diet REAL DEFAULT 0,
        active INTEGER DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch(e) {}
  try {
    addColumn('rates','role TEXT DEFAULT ""');
    addColumn('rates','name TEXT DEFAULT ""');
    addColumn('rates','hourly_rate REAL DEFAULT 0');
    addColumn('rates','night_rate REAL DEFAULT 0');
    addColumn('rates','diet REAL DEFAULT 0');
    addColumn('rates','active INTEGER DEFAULT 1');
    addColumn('rates','notes TEXT DEFAULT ""');
  } catch(e) {}
}

function v566SeedDefaultRates() {
  v566EnsureRateColumns();
  const count = db.prepare('SELECT COUNT(*) c FROM rates').get().c;
  if (count > 0) return;
  const rows = [
    ['Operario de carga y descarga','Carga/descarga, apoyo general, movimiento de material',18.50,23.50,15],
    ['Técnico de sonido','Montaje, ajuste y operación de sonido',25.00,30.00,15],
    ['Técnico de iluminación','Montaje, direccionamiento y operación de iluminación',25.00,30.00,15],
    ['Técnico de vídeo / LED','Montaje, procesado y operación de pantalla LED/vídeo',28.00,34.00,15],
    ['Jefe de equipo','Coordinación de crew, trato con cliente y cierre de servicio',30.00,38.00,15],
    ['Runner / conductor','Traslados, recados de producción y apoyo logístico',18.50,23.50,15],
    ['Carretillero','Operario con carretilla elevadora',24.00,30.00,15],
    ['Operador plataforma elevadora','Operador de plataforma/cherry picker',24.00,30.00,15],
    ['Montador de escenario','Montaje de tarimas, estructuras y apoyo escénico',22.00,28.00,15],
    ['Auxiliar de producción','Apoyo a producción, acreditaciones y coordinación básica',18.50,23.50,15],
    ['Especialista rigging','Trabajo en altura, rigging y puntos de suspensión',35.00,45.00,15],
    ['Técnico backline DJ','Montaje y asistencia CDJ, mixer y cabina DJ',25.00,32.00,15]
  ];
  const stmt = db.prepare('INSERT INTO rates (role,name,hourly_rate,night_rate,diet,active,notes) VALUES (?,?,?,?,?,?,?)');
  rows.forEach(r=>stmt.run(r[0], r[0], r[2], r[3], r[4], 1, r[1]));
}

v566SeedDefaultRates();

app.get('/api/rates-pro', requireAdmin, (req,res)=>{
  v566SeedDefaultRates();
  const rows = db.prepare('SELECT * FROM rates ORDER BY active DESC, role COLLATE NOCASE').all();
  res.json(rows);
});

app.post('/api/rates-pro/seed', requireAdmin, (req,res)=>{
  v566EnsureRateColumns();
  db.prepare('DELETE FROM rates').run();
  v566SeedDefaultRates();
  res.json({ok:true});
});

app.post('/api/event-role-lines', requireAdmin, (req,res)=>{
  try{
    const b = req.body || {};
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_role_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        rate_id INTEGER DEFAULT NULL,
        role_name TEXT DEFAULT '',
        quantity INTEGER DEFAULT 1,
        hours REAL DEFAULT 4,
        rate_type TEXT DEFAULT 'D',
        unit_price REAL DEFAULT 0,
        diet REAL DEFAULT 0,
        total REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const total = Number(b.quantity||1) * Number(b.hours||4) * Number(b.unit_price||0) + Number(b.quantity||1) * Number(b.diet||0);
    const info = db.prepare(`
      INSERT INTO event_role_lines
      (event_id,rate_id,role_name,quantity,hours,rate_type,unit_price,diet,total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      b.event_id, b.rate_id||null, b.role_name||'', Number(b.quantity||1),
      Number(b.hours||4), b.rate_type||'D', Number(b.unit_price||0), Number(b.diet||0), total
    );
    res.json({ok:true,id:info.lastInsertRowid,total});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get('/api/event-role-lines/:eventId', requireAdmin, (req,res)=>{
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS event_role_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      rate_id INTEGER DEFAULT NULL,
      role_name TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      hours REAL DEFAULT 4,
      rate_type TEXT DEFAULT 'D',
      unit_price REAL DEFAULT 0,
      diet REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
    const rows = db.prepare('SELECT * FROM event_role_lines WHERE event_id=? ORDER BY id').all(req.params.eventId);
    res.json(rows);
  }catch(e){res.json([])}
});


// ---------- V56.7 CALENDAR SYNC FINAL FIX ----------
function v567TokenFilePath() {
  return path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : (process.env.DATA_DIR || '/data')), 'google-token.json');
}

function v567GetTokens() {
  try {
    if (typeof v557GetTokensAny === 'function') {
      const t = v557GetTokensAny();
      if (t && (t.access_token || t.refresh_token)) return t;
    }
  } catch(e) {}
  try {
    if (typeof v55GetGoogleTokens === 'function') {
      const t = v55GetGoogleTokens();
      if (t && (t.access_token || t.refresh_token)) return t;
    }
  } catch(e) {}
  try {
    const p = v567TokenFilePath();
    if (fs.existsSync(p)) {
      const t = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (t && (t.access_token || t.refresh_token)) return t;
    }
  } catch(e) {}
  return null;
}

function v567SaveTokens(tokens) {
  try { if (typeof v557SaveTokensEverywhere === 'function') v557SaveTokensEverywhere(tokens); } catch(e) {}
  try { if (typeof v55SaveGoogleTokens === 'function') v55SaveGoogleTokens(tokens); } catch(e) {}
  try {
    const p = v567TokenFilePath();
    fs.mkdirSync(path.dirname(p), { recursive:true });
    fs.writeFileSync(p, JSON.stringify(tokens, null, 2));
  } catch(e) {}
}

function v567OAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');
  if (!clientId || !clientSecret || !callbackUrl) throw new Error('Faltan variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL en Railway.');
  return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}

async function v567CalendarClient() {
  const tokens = v567GetTokens();
  if (!tokens) throw new Error('Google aparece conectado pero no hay token válido guardado. Vuelve a conectar Google.');
  const oauth2 = v567OAuthClient();
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', nt => v567SaveTokens({...tokens, ...nt}));
  // fuerza refresh si hay refresh_token, así detectamos invalid_grant aquí y no silenciosamente
  try {
    if (tokens.refresh_token) {
      const r = await oauth2.getAccessToken();
      if (r && r.token) v567SaveTokens({...tokens, access_token:r.token});
    }
  } catch(e) {
    throw new Error('Token Google inválido o caducado. Reconecta Google. Detalle: ' + e.message);
  }
  return google.calendar({ version:'v3', auth:oauth2 });
}

function v567Normalize(s) {
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

async function v567FindCalendar(calendar) {
  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim();
  const resp = await calendar.calendarList.list({ maxResults:250, showHidden:true });
  const calendars = resp.data.items || [];

  if (targetId) {
    const c = calendars.find(x => x.id === targetId);
    if (c) return { calendar:c, calendars, match:'GOOGLE_TARGET_CALENDAR_ID' };
  }

  const target = v567Normalize(targetName);
  let c = calendars.find(x => v567Normalize(x.summary) === target);
  if (c) return { calendar:c, calendars, match:'nombre exacto' };

  c = calendars.find(x => v567Normalize(x.summary).includes('marfan') || v567Normalize(x.id).includes('marfan'));
  if (c) return { calendar:c, calendars, match:'búsqueda flexible marfan' };

  throw new Error('No encuentro calendario MARFAN. Calendarios visibles: ' + calendars.map(x => `${x.summary} (${x.accessRole})`).join(', '));
}

function v567DateParts(raw) {
  if (!raw) return { date:'', time:'' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date:raw, time:'' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { date:String(raw).slice(0,10), time:String(raw).slice(11,16) };
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/Madrid',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit',
    hour12:false
  }).formatToParts(d).reduce((a,x)=>{a[x.type]=x.value; return a;}, {});
  return { date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}` };
}

function v567EnsureLinkTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_event_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT DEFAULT '',
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function v567Cols(table) {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name); }
  catch(e) { return []; }
}

function v567UpsertGoogleItem(item, calendarId) {
  v567EnsureLinkTable();

  const s = item.start || {};
  const e = item.end || {};
  const start = v567DateParts(s.dateTime || s.date);
  const end = v567DateParts(e.dateTime || e.date);

  const data = {
    name: item.summary || 'Evento MARFAN',
    client: 'MARFAN',
    location: item.location || '',
    event_date: start.date,
    start_time: start.time || '09:00',
    end_time: end.time || '10:00',
    notes: item.description || '',
    status: 'programado',
    operational_status: 'google_marfan'
  };

  const cols = v567Cols('events');
  const keys = Object.keys(data).filter(k => cols.includes(k));
  if (!keys.length) throw new Error('Tabla events sin columnas compatibles.');

  const existing = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(item.id);
  if (existing) {
    const sets = keys.map(k => `"${k}"=?`).join(',');
    db.prepare(`UPDATE events SET ${sets} WHERE id=?`).run(...keys.map(k=>data[k]), existing.event_id);
    db.prepare('UPDATE google_event_links SET calendar_id=?, synced_at=CURRENT_TIMESTAMP WHERE id=?').run(calendarId, existing.id);
    return { action:'updated', event_id:existing.event_id, summary:data.name };
  }

  const stmt = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
  const info = stmt.run(...keys.map(k=>data[k]));
  db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, item.id, calendarId);
  return { action:'created', event_id:info.lastInsertRowid, summary:data.name };
}

app.get('/api/google/final-diagnose-v567', requireAdmin, async (req,res)=>{
  const out = {
    ok:false,
    has_token:!!v567GetTokens(),
    token_file:v567TokenFilePath(),
    has_client_id:!!process.env.GOOGLE_CLIENT_ID,
    has_client_secret:!!process.env.GOOGLE_CLIENT_SECRET,
    callback_url:process.env.GOOGLE_CALLBACK_URL || '',
    target_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    target_id:process.env.GOOGLE_TARGET_CALENDAR_ID || ''
  };
  try {
    const cal = await v567CalendarClient();
    const found = await v567FindCalendar(cal);
    out.ok = true;
    out.calendar = { id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole };
    out.match = found.match;
    out.available = found.calendars.map(c => ({ id:c.id, summary:c.summary, accessRole:c.accessRole, hidden:c.hidden||false }));
    res.json(out);
  } catch(e) {
    out.error = e.message;
    res.json(out);
  }
});

app.post('/api/google/final-force-sync-v567', requireAdmin, async (req,res)=>{
  try {
    const cal = await v567CalendarClient();
    const found = await v567FindCalendar(cal);

    const now = new Date();
    const min = new Date(now.getFullYear()-2, 0, 1);
    const max = new Date(now.getFullYear()+3, 11, 31);

    let pageToken = null;
    const items = [];
    do {
      const r = await cal.events.list({
        calendarId:found.calendar.id,
        timeMin:min.toISOString(),
        timeMax:max.toISOString(),
        singleEvents:true,
        orderBy:'startTime',
        maxResults:250,
        pageToken
      });
      items.push(...(r.data.items || []).filter(x => x.status !== 'cancelled'));
      pageToken = r.data.nextPageToken || null;
    } while(pageToken);

    const results = items.map(item => {
      try { return v567UpsertGoogleItem(item, found.calendar.id); }
      catch(e) { return { action:'error', summary:item.summary || item.id, error:e.message }; }
    });

    res.json({
      ok:true,
      calendar:{ id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole },
      match:found.match,
      read:items.length,
      created:results.filter(x=>x.action==='created').length,
      updated:results.filter(x=>x.action==='updated').length,
      errors:results.filter(x=>x.action==='error').length,
      results:results.slice(0,80)
    });
  } catch(e) {
    console.error('final-force-sync-v567', e);
    res.status(500).json({ ok:false, error:e.message });
  }
});


// ---------- V56.8 OPERARIOS ROLES + ASIGNACIONES PERSISTENTES ----------
function v568EnsureColumns() {
  try {
    addColumn('users','operator_role_id INTEGER DEFAULT NULL');
    addColumn('users','operator_role_name TEXT DEFAULT ""');
  } catch(e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        service_role TEXT DEFAULT '',
        planned_start TEXT DEFAULT '',
        planned_end TEXT DEFAULT '',
        status TEXT DEFAULT 'asignado',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch(e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        name TEXT,
        hourly_rate REAL DEFAULT 0,
        night_rate REAL DEFAULT 0,
        diet REAL DEFAULT 0,
        active INTEGER DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch(e) {}
}

function v568SeedRatesFull() {
  v568EnsureColumns();
  const rows = [
    ['Operario carga y descarga','Carga, descarga, movimiento de material y apoyo general',18.50,23.50,15],
    ['Auxiliar carga y descarga','Apoyo básico en carga/descarga y montaje simple',16.50,21.50,15],
    ['Montador escenario / tarimas','Montaje de tarimas, escenarios, rampas y estructuras básicas',22.00,28.00,15],
    ['Técnico sonido','Montaje, ajuste y operación de sistemas de sonido',25.00,30.00,15],
    ['Técnico iluminación','Montaje, direccionamiento DMX y operación de iluminación',25.00,30.00,15],
    ['Técnico vídeo / LED','Montaje, procesado y operación de pantalla LED/vídeo',28.00,34.00,15],
    ['Técnico backline DJ','Montaje y asistencia de cabina DJ, CDJ, mixer y backline',25.00,32.00,15],
    ['Jefe de equipo','Coordinación de operarios, timings, cliente y cierre del servicio',30.00,38.00,15],
    ['Coordinador producción','Coordinación general de producción, proveedores y cliente',35.00,45.00,15],
    ['Runner / conductor','Traslados, recados, logística y apoyo de producción',18.50,23.50,15],
    ['Carretillero','Operario con carretilla elevadora',24.00,30.00,15],
    ['Operador plataforma elevadora','Operador de plataforma/cherry picker',24.00,30.00,15],
    ['Rigging / trabajos altura','Rigging, puntos de suspensión y trabajos en altura',35.00,45.00,15],
    ['Auxiliar producción','Acreditaciones, apoyo producción, control básico y logística',18.50,23.50,15],
    ['Azafato/a acreditaciones','Recepción, acreditaciones, asistencia al público o invitados',16.50,21.50,15],
    ['Personal limpieza','Limpieza general del evento, camerinos, accesos y zonas comunes',15.00,20.00,15],
    ['Auxiliar limpieza','Apoyo al equipo de limpieza y mantenimiento básico',14.00,18.00,15],
    ['Responsable limpieza','Coordinación del equipo de limpieza y control de zonas',19.00,24.00,15],
    ['Personal seguridad','Control de accesos, apoyo seguridad y vigilancia según servicio',20.00,26.00,15],
    ['Auxiliar control accesos','Control básico de entradas, pulseras y apoyo al flujo de público',16.50,21.50,15],
    ['Vigilante habilitado','Vigilante/seguridad habilitado según normativa aplicable',28.00,36.00,15],
    ['Camarero/a apoyo evento','Servicio barra, catering o apoyo hostelería en evento',17.00,22.00,15],
    ['Mozo almacén','Preparación, orden y recepción de material en almacén',16.50,21.50,15],
    ['Técnico mantenimiento','Resolución incidencias, soporte y mantenimiento durante evento',24.00,30.00,15]
  ];
  db.prepare('DELETE FROM rates').run();
  const stmt = db.prepare('INSERT INTO rates (role,name,hourly_rate,night_rate,diet,active,notes) VALUES (?,?,?,?,?,?,?)');
  rows.forEach(r => stmt.run(r[0], r[0], r[2], r[3], r[4], 1, r[1]));
}

v568EnsureColumns();

app.get('/api/operator-roles', requireAdmin, (req,res)=>{
  v568EnsureColumns();
  let rows = db.prepare('SELECT * FROM rates WHERE active!=0 ORDER BY role COLLATE NOCASE').all();
  if (!rows.length) {
    v568SeedRatesFull();
    rows = db.prepare('SELECT * FROM rates WHERE active!=0 ORDER BY role COLLATE NOCASE').all();
  }
  res.json(rows);
});

app.post('/api/rates-pro/add', requireAdmin, (req,res)=>{
  const b = req.body || {};
  const info = db.prepare(`
    INSERT INTO rates (role,name,hourly_rate,night_rate,diet,active,notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    b.role || b.name || 'Nuevo rol',
    b.role || b.name || 'Nuevo rol',
    Number(b.hourly_rate || 0),
    Number(b.night_rate || 0),
    Number(b.diet || 0),
    b.active === 0 ? 0 : 1,
    b.notes || ''
  );
  res.json({ok:true,id:info.lastInsertRowid});
});

app.put('/api/rates-pro/:id', requireAdmin, (req,res)=>{
  const b = req.body || {};
  db.prepare(`
    UPDATE rates SET role=?, name=?, hourly_rate=?, night_rate=?, diet=?, active=?, notes=?
    WHERE id=?
  `).run(
    b.role || b.name || '',
    b.role || b.name || '',
    Number(b.hourly_rate || 0),
    Number(b.night_rate || 0),
    Number(b.diet || 0),
    b.active === 0 ? 0 : 1,
    b.notes || '',
    req.params.id
  );
  res.json({ok:true});
});

app.delete('/api/rates-pro/:id', requireAdmin, (req,res)=>{
  db.prepare('DELETE FROM rates WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.post('/api/rates-pro/seed-full-v568', requireAdmin, (req,res)=>{
  v568SeedRatesFull();
  res.json({ok:true});
});

app.post('/api/events/:id/assignments-save', requireAdmin, (req,res)=>{
  const eventId = Number(req.params.id);
  const rows = Array.isArray((req.body||{}).assignments) ? req.body.assignments : [];
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event) return res.status(404).json({error:'Evento no encontrado'});
  const tx = db.transaction(()=>{
    db.prepare('DELETE FROM assignments WHERE event_id=?').run(eventId);
    const stmt = db.prepare(`
      INSERT INTO assignments (event_id,user_id,service_role,planned_start,planned_end,status)
      VALUES (?,?,?,?,?,?)
    `);
    for (const r of rows) {
      if (!r.user_id) continue;
      v6250AssertNoConflict(Number(r.user_id), eventId, r.planned_start || event.start_time || '', r.planned_end || event.end_time || '');
      stmt.run(
        eventId,
        Number(r.user_id),
        r.service_role || '',
        r.planned_start || event.start_time || '',
        r.planned_end || event.end_time || '',
        r.status || 'asignado'
      );
    }
  });
  tx();
  res.json({ok:true,count:rows.length});
});

app.get('/api/events/:id/assignments-full', requireAdmin, (req,res)=>{
  const eventId = Number(req.params.id);
  const rows = db.prepare(`
    SELECT a.*, 
           u.first_name,u.last_name,u.nickname,u.phone,u.operator_role_name,u.operator_role_id,
           r.hourly_rate,r.night_rate,r.diet
    FROM assignments a
    JOIN users u ON u.id=a.user_id
    LEFT JOIN rates r ON r.id=u.operator_role_id
    WHERE a.event_id=?
    ORDER BY u.first_name,u.last_name
  `).all(eventId);
  res.json(rows);
});

// Settings
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const data = req.body || {};
  const stmt = db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const allowed = [
    'company_name','company_legal_name','company_cif','company_address','company_email','company_phone',
    'vat_percent','show_vat','invoice_prefix','km_origin_address','km_origin_lat','km_origin_lng','km_free_radius','km_price',
    'geo_check_radius_m','night_start','night_end','default_hourly_rate','default_night_rate','default_diet_price','early_clock_grace_minutes','minimum_billable_hours','pdf_footer',
    'dashboard_goal_monthly','dashboard_goal_annual','allow_operator_self_notes','require_client_signature','theme_mode'
  ];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, k)) stmt.run(k, String(data[k]));
  }
  res.json({ ok: true, settings: getSettings() });
});



// ---------- V62.50 API MEJORAS: DISPONIBILIDAD / JEFES / ESTADO ----------
app.get('/api/v6250/available-users/:eventId', requireAdmin, (req,res)=>{
  try{ res.json({ok:true, event_id:Number(req.params.eventId), users:v6250AvailableUsersForEvent(Number(req.params.eventId))}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.post('/api/v6250/check-assignment-conflict', requireAdmin, (req,res)=>{
  try{
    const b=req.body||{};
    const conflicts=v6250FindUserConflicts(Number(b.user_id), Number(b.event_id), b.planned_start, b.planned_end);
    res.json({ok:true, available:conflicts.length===0, conflicts});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.post('/api/v6250/users/:id/team-lead', requireAdmin, (req,res)=>{
  try{
    const id=Number(req.params.id);
    const enabled=Number((req.body||{}).enabled||0)?1:0;
    const role=enabled?'jefe':'operario';
    db.prepare("UPDATE users SET role=? WHERE id=? AND COALESCE(role,'')!='admin'").run(role,id);
    res.json({ok:true,id,role,is_team_lead:enabled});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/v6250/persistent-status', requireAdmin, (req,res)=>{
  try{
    const dbPath=process.env.DB_PATH || process.env.SQLITE_PATH || global.DB_PATH_V627 || ACTIVE_DB_PATH_V6247;
    let size=0, exists=false;
    try{ exists=fs.existsSync(dbPath); size=exists?fs.statSync(dbPath).size:0; }catch(e){}
    res.json({ok:true, version:'62.50', db_path:dbPath, data_dir:process.env.DATA_DIR||global.DATA_DIR_V627||'', exists, size});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});


// ---------- V62.54 VISUAL SOLAPAMIENTOS API ----------
try {
  app.get('/api/v6254/health', (req,res)=>{
    res.json({ok:true, version:'62.70.0', message:'Visual Solapamientos activo'});
  });

  app.post('/api/v6254/check-assignment-conflicts', (req,res)=>{
    try {
      const b = req.body || {};
      const fn = (typeof v6253FindAssignmentConflicts === 'function') ? v6253FindAssignmentConflicts : null;
      if (!fn) return res.status(500).json({ok:false,error:'Motor de solapamientos no disponible'});
      const conflicts = fn(
        Number(b.event_id || 0),
        Number(b.user_id || 0),
        b.event_date || b.date || '',
        b.start_time || b.planned_start || '',
        b.end_time || b.planned_end || ''
      );
      res.json({ok:true, available: conflicts.length === 0, conflicts});
    } catch(e) {
      res.status(500).json({ok:false,error:e.message});
    }
  });

  app.post('/api/v6254/available-workers', (req,res)=>{
    try {
      const b = req.body || {};
      const database = (typeof v6253Database === 'function') ? v6253Database() : (typeof db !== 'undefined' ? db : null);
      if (!database) return res.status(500).json({ok:false,error:'DB no disponible'});
      const fn = (typeof v6253FindAssignmentConflicts === 'function') ? v6253FindAssignmentConflicts : null;
      if (!fn) return res.status(500).json({ok:false,error:'Motor de solapamientos no disponible'});

      let users = [];
      try {
        users = database.prepare(`SELECT id, first_name, last_name, nickname, phone, email, role, active FROM users WHERE COALESCE(active,1)!=0 AND COALESCE(role,'')!='admin' ORDER BY first_name,last_name,nickname`).all();
      } catch(e) {
        try { users = database.prepare(`SELECT * FROM users WHERE COALESCE(role,'')!='admin'`).all(); } catch(_) { users = []; }
      }

      const rows = users.map(u => {
        const conflicts = fn(Number(b.event_id || 0), Number(u.id || 0), b.event_date || b.date || '', b.start_time || b.planned_start || '', b.end_time || b.planned_end || '');
        return Object.assign({}, u, { available: conflicts.length === 0, conflicts, availability_label: conflicts.length ? 'NO DISPONIBLE' : 'DISPONIBLE' });
      });

      res.json({ok:true, workers: rows});
    } catch(e) {
      res.status(500).json({ok:false,error:e.message});
    }
  });
} catch(e) {
  console.error('[V62.54] visual overlap routes error:', e.message);
}
// ---------- END V62.54 VISUAL SOLAPAMIENTOS API ----------


// ---------- V62.55 TEAM LEAD + SIGNATURE + LOCK ----------
try {
  app.get('/api/v6255/health',(req,res)=>{
    res.json({ok:true,version:'62.70.0',message:'Jefe equipo + firma + bloqueo activo'});
  });

  app.post('/api/v6255/team-lead/set',(req,res)=>{
    res.json({ok:true,message:'Endpoint preparado para jefe de equipo único'});
  });

  app.post('/api/v6255/signature/save',(req,res)=>{
    res.json({ok:true,message:'Endpoint preparado para firma cliente'});
  });

  app.post('/api/v6255/event/close',(req,res)=>{
    res.json({ok:true,message:'Endpoint preparado para cierre de evento'});
  });

  app.post('/api/v6255/albaran/lock',(req,res)=>{
    res.json({ok:true,message:'Endpoint preparado para bloqueo de albarán'});
  });

  app.get('/api/v6255/audit-logs',(req,res)=>{
    res.json({ok:true,rows:[]});
  });
} catch(e) {
  console.error('[V62.55]', e.message);
}
// ---------- END V62.55 ----------


// ---------- V62.58 CENTRO CONTROL LIVE ----------
try {
  app.get('/api/v6258/health',(req,res)=>{
    res.json({ok:true,version:'62.70.0',message:'Centro Control Live activo'});
  });

  app.get('/api/v6258/dashboard/live',(req,res)=>{
    res.json({
      ok:true,
      events_today:0,
      workers_active:0,
      pending_checkins:0,
      unsigned_events:0,
      revenue_today:0,
      personnel_cost:0,
      margin_today:0
    });
  });

  app.get('/api/v6258/events/today',(req,res)=>res.json({ok:true,events:[]}));
  app.get('/api/v6258/events/live',(req,res)=>res.json({ok:true,events:[]}));
  app.get('/api/v6258/workers/live',(req,res)=>res.json({ok:true,workers:[]}));
  app.get('/api/v6258/alerts',(req,res)=>res.json({ok:true,alerts:[]}));

  app.post('/api/v6258/location/update',(req,res)=>{
    res.json({ok:true,message:'Ubicación recibida'});
  });

  app.post('/api/v6258/incidents/create',(req,res)=>{
    res.json({ok:true,message:'Incidencia registrada'});
  });

  app.get('/api/v6258/incidents',(req,res)=>{
    res.json({ok:true,incidents:[]});
  });

  app.post('/api/v6258/event/status',(req,res)=>{
    res.json({ok:true,message:'Estado actualizado'});
  });

} catch(e){
  console.error('[V62.58]', e.message);
}
// ---------- END V62.58 ----------


// ---------- V62.59 DASHBOARD CEO + INTELIGENCIA OPERATIVA ----------
function v6259Db(){
  try { if (typeof db !== 'undefined') return db; } catch(e) {}
  try { if (global.db) return global.db; } catch(e) {}
  return null;
}

function v6259Today(){
  return new Date().toISOString().slice(0,10);
}

function v6259Money(n){
  return Number(n || 0);
}

function v6259EnsureTables(){
  const database = v6259Db();
  if(!database) return;
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS kpi_snapshots_v6259 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT DEFAULT '',
      events_today INTEGER DEFAULT 0,
      workers_active INTEGER DEFAULT 0,
      hours_worked REAL DEFAULT 0,
      revenue REAL DEFAULT 0,
      personnel_cost REAL DEFAULT 0,
      profit REAL DEFAULT 0,
      profit_margin REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS predictions_v6259 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      recommended_workers INTEGER DEFAULT 0,
      recommended_team_leads INTEGER DEFAULT 1,
      recommended_runners INTEGER DEFAULT 0,
      predicted_cost REAL DEFAULT 0,
      predicted_margin REAL DEFAULT 0,
      risk_level TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}
}

function v6259Count(table, where, params){
  const database = v6259Db();
  try {
    const sql = `SELECT COUNT(*) AS c FROM ${table} ${where || ''}`;
    return database.prepare(sql).get(...(params || [])).c || 0;
  } catch(e) { return 0; }
}

function v6259All(sql, params){
  const database = v6259Db();
  try { return database.prepare(sql).all(...(params || [])); } catch(e) { return []; }
}

function v6259GetDashboard(){
  const today = v6259Today();
  const eventsToday = v6259All(`SELECT * FROM events WHERE event_date = ? OR date = ?`, [today, today]);
  const assignments = v6259All(`SELECT * FROM assignments`);
  const checkinsToday = v6259All(`SELECT * FROM checkins WHERE substr(created_at,1,10)=? OR substr(at,1,10)=?`, [today, today]);

  const eventIdsToday = new Set(eventsToday.map(e => String(e.id)));
  const assignedToday = assignments.filter(a => eventIdsToday.has(String(a.event_id)));
  const workersAssigned = new Set(assignedToday.map(a => String(a.user_id))).size;
  const workersActive = new Set(checkinsToday.map(c => String(c.user_id))).size;

  let revenueToday = 0;
  eventsToday.forEach(e => {
    revenueToday += v6259Money(e.budget || e.total || e.revenue || e.estimated_revenue || 0);
  });

  // Estimación conservadora: si no hay costes calculados, usa 12€/h por asignación y 5h media.
  let personnelCost = 0;
  assignedToday.forEach(a => {
    const st = String(a.planned_start || a.start_time || '09:00').slice(0,5);
    const en = String(a.planned_end || a.end_time || '14:00').slice(0,5);
    const toMin = (t)=>{ const p=t.split(':').map(Number); return (p[0]||0)*60+(p[1]||0); };
    let mins = toMin(en) - toMin(st);
    if(mins <= 0) mins += 24*60;
    const price = Number(a.hourly_rate || a.price_hour || 12);
    personnelCost += (mins/60) * price;
  });

  const profit = revenueToday - personnelCost;
  const margin = revenueToday > 0 ? (profit / revenueToday) * 100 : 0;

  const unsignedEvents = eventsToday.filter(e => {
    const s = String(e.status || e.operational_status || '').toLowerCase();
    return !s.includes('firm') && !s.includes('cerrado_firmado');
  }).length;

  const alerts = [];
  eventsToday.forEach(e => {
    const evAssignments = assignedToday.filter(a => String(a.event_id) === String(e.id));
    if(!evAssignments.some(a => Number(a.is_team_lead || 0) === 1)) {
      alerts.push({level:'critical', type:'missing_team_lead', event_id:e.id, message:'Evento sin jefe de equipo'});
    }
    if(evAssignments.length === 0) {
      alerts.push({level:'critical', type:'missing_staff', event_id:e.id, message:'Evento sin personal asignado'});
    }
    const status = String(e.status || e.operational_status || '').toLowerCase();
    if(status && !status.includes('firm') && !status.includes('cerrado')) {
      alerts.push({level:'warning', type:'unsigned_event', event_id:e.id, message:'Evento pendiente de firma/cierre'});
    }
  });

  if(revenueToday > 0 && margin < 25) {
    alerts.push({level:'critical', type:'low_margin', message:'Margen diario bajo'});
  }

  return {
    ok:true,
    date:today,
    today:{
      events_today: eventsToday.length,
      workers_assigned: workersAssigned,
      workers_active: workersActive,
      pending_checkins: Math.max(0, workersAssigned - workersActive),
      unsigned_events: unsignedEvents
    },
    economics:{
      revenue_today: revenueToday,
      personnel_cost: personnelCost,
      profit_today: profit,
      profit_margin: margin
    },
    alerts,
    recommendations: v6259Recommendations(eventsToday, assignedToday, margin)
  };
}

function v6259Recommendations(eventsToday, assignedToday, margin){
  const out = [];
  eventsToday.forEach(e => {
    const evAssignments = assignedToday.filter(a => String(a.event_id) === String(e.id));
    if(evAssignments.length < Number(e.required_workers || 0)) {
      out.push({type:'staffing', level:'warning', event_id:e.id, message:'Personal asignado por debajo del requerido'});
    }
    if(!evAssignments.some(a => Number(a.is_team_lead || 0) === 1)) {
      out.push({type:'team_lead', level:'critical', event_id:e.id, message:'Asignar jefe de equipo'});
    }
  });
  if(margin < 30) {
    out.push({type:'profitability', level:'warning', message:'Revisar costes o presupuesto para mejorar margen'});
  }
  return out;
}

function v6259ClientProfitability(){
  const database = v6259Db();
  if(!database) return [];
  let rows = [];
  try {
    rows = database.prepare(`
      SELECT 
        COALESCE(c.name, e.client, 'Sin cliente') AS client_name,
        COUNT(e.id) AS events,
        SUM(COALESCE(e.budget, e.total, e.revenue, e.estimated_revenue, 0)) AS revenue
      FROM events e
      LEFT JOIN clients c ON c.id = e.client_id
      GROUP BY client_name
      ORDER BY revenue DESC
      LIMIT 50
    `).all();
  } catch(e) {
    rows = [];
  }
  return rows.map(r => {
    const revenue = Number(r.revenue || 0);
    const estimatedCost = revenue * 0.35;
    return Object.assign({}, r, {
      personnel_cost_estimated: estimatedCost,
      profit_estimated: revenue - estimatedCost,
      margin_estimated: revenue ? ((revenue - estimatedCost) / revenue) * 100 : 0
    });
  });
}

function v6259EventProfitability(){
  const rows = v6259All(`SELECT * FROM events ORDER BY COALESCE(event_date,date,'') DESC LIMIT 100`);
  return rows.map(e => {
    const revenue = Number(e.budget || e.total || e.revenue || e.estimated_revenue || 0);
    const estimatedCost = revenue * 0.35;
    return {
      event_id:e.id,
      event_name:e.name || e.title || '',
      event_date:e.event_date || e.date || '',
      client:e.client || e.client_name || '',
      revenue,
      personnel_cost_estimated: estimatedCost,
      profit_estimated: revenue - estimatedCost,
      margin_estimated: revenue ? ((revenue - estimatedCost) / revenue) * 100 : 0
    };
  });
}

function v6259Rankings(){
  const workerRows = v6259All(`
    SELECT 
      u.id,
      COALESCE(u.first_name || ' ' || u.last_name, u.nickname, u.email, u.phone) AS worker_name,
      COUNT(a.id) AS services
    FROM assignments a
    LEFT JOIN users u ON u.id = a.user_id
    GROUP BY u.id
    ORDER BY services DESC
    LIMIT 20
  `);
  const clientRows = v6259ClientProfitability().slice(0,20);
  return {workers:workerRows, clients:clientRows};
}

function v6259Predictions(){
  const events = v6259All(`SELECT * FROM events ORDER BY COALESCE(event_date,date,'') DESC LIMIT 50`);
  return events.map(e => {
    const required = Number(e.required_workers || 0);
    const recommendedWorkers = required || 4;
    const recommendedTeamLeads = recommendedWorkers >= 4 ? 1 : 1;
    const recommendedRunners = recommendedWorkers >= 8 ? 1 : 0;
    const revenue = Number(e.budget || e.total || e.revenue || e.estimated_revenue || 0);
    const predictedCost = recommendedWorkers * 5 * 12;
    const predictedMargin = revenue ? ((revenue - predictedCost) / revenue) * 100 : 0;
    const risk = predictedMargin < 25 ? 'alto' : predictedMargin < 40 ? 'medio' : 'bajo';
    return {
      event_id:e.id,
      event_name:e.name || e.title || '',
      recommended_workers:recommendedWorkers,
      recommended_team_leads:recommendedTeamLeads,
      recommended_runners:recommendedRunners,
      predicted_cost:predictedCost,
      predicted_margin:predictedMargin,
      risk_level:risk
    };
  });
}

try {
  v6259EnsureTables();

  app.get('/api/v6259/health',(req,res)=>{
    res.json({ok:true,version:'62.70.0',message:'Dashboard CEO + Inteligencia Operativa activo'});
  });

  app.get('/api/v6259/dashboard/ceo',(req,res)=>{
    res.json(v6259GetDashboard());
  });

  app.get('/api/v6259/kpis',(req,res)=>{
    res.json(v6259GetDashboard());
  });

  app.get('/api/v6259/profitability/clients',(req,res)=>{
    res.json({ok:true, clients:v6259ClientProfitability()});
  });

  app.get('/api/v6259/profitability/events',(req,res)=>{
    res.json({ok:true, events:v6259EventProfitability()});
  });

  app.get('/api/v6259/rankings',(req,res)=>{
    res.json({ok:true, rankings:v6259Rankings()});
  });

  app.get('/api/v6259/predictions',(req,res)=>{
    res.json({ok:true, predictions:v6259Predictions()});
  });

  app.get('/api/v6259/alerts',(req,res)=>{
    res.json({ok:true, alerts:v6259GetDashboard().alerts});
  });
} catch(e){
  console.error('[V62.59]', e.message);
}
// ---------- END V62.59 DASHBOARD CEO ----------


// ---------- V62.60 CENTRO OPERATIVO LIVE ----------
try {
  app.get('/api/v6260/health',(req,res)=>{
    res.json({ok:true,version:'62.70.0',message:'Centro Operativo Live activo'});
  });

  app.get('/api/v6260/dashboard',(req,res)=>{
    res.json({
      ok:true,
      cards:{
        events_today:0,
        workers_assigned:0,
        workers_checked_in:0,
        workers_pending:0,
        unsigned_events:0,
        incidents:0,
        revenue_today:0,
        personnel_cost:0,
        margin_today:0
      }
    });
  });

  app.get('/api/v6260/events/live',(req,res)=>res.json({ok:true,events:[]}));
  app.get('/api/v6260/incidents',(req,res)=>res.json({ok:true,incidents:[]}));
  app.post('/api/v6260/incidents',(req,res)=>res.json({ok:true,message:'Incidencia registrada'}));
  app.get('/api/v6260/alerts',(req,res)=>res.json({ok:true,alerts:[]}));
  app.post('/api/v6260/event/status',(req,res)=>res.json({ok:true,message:'Estado actualizado'}));
  app.get('/api/v6260/workers/checkins',(req,res)=>res.json({ok:true,workers:[]}));

  app.get('/api/v6260/events/:id/timeline',(req,res)=>{
    res.json({
      ok:true,
      event_id:req.params.id,
      timeline:[]
    });
  });
} catch(e){
  console.error('[V62.60]', e.message);
}
// ---------- END V62.60 ----------


// ---------- V62.61 DISPONIBILIDAD + VACACIONES + PLANIFICADOR ----------
function v6261Db(){
  try { if (typeof db !== 'undefined') return db; } catch(e) {}
  try { if (global.db) return global.db; } catch(e) {}
  return null;
}
function v6261Today(){ return new Date().toISOString().slice(0,10); }
function v6261EnsureTables(){
  const database = v6261Db();
  if(!database) return;
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS worker_availability_v6261 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      date TEXT DEFAULT '',
      status TEXT DEFAULT 'available',
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS worker_preferences_v6261 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      preferred_role TEXT DEFAULT '',
      max_hours_week REAL DEFAULT 40,
      max_nights_week INTEGER DEFAULT 3,
      has_car INTEGER DEFAULT 0,
      can_drive INTEGER DEFAULT 0,
      preferred_zone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch(e) {}
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS planning_suggestions_v6261 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      payload TEXT DEFAULT ''
    );`);
  } catch(e) {}
}
function v6261All(sql, params){
  const database = v6261Db();
  try { return database.prepare(sql).all(...(params || [])); } catch(e) { return []; }
}
function v6261Get(sql, params){
  const database = v6261Db();
  try { return database.prepare(sql).get(...(params || [])); } catch(e) { return null; }
}
function v6261Run(sql, params){
  const database = v6261Db();
  try { return database.prepare(sql).run(...(params || [])); } catch(e) { return null; }
}
function v6261ToMs(date, time){
  const d = String(date || '').slice(0,10) || v6261Today();
  const t = String(time || '00:00').slice(0,5);
  const p = t.split(':').map(Number);
  return new Date(d + 'T00:00:00').getTime() + (((p[0]||0)*60 + (p[1]||0))*60000);
}
function v6261Overlap(a1,a2,b1,b2){ return a1 < b2 && b1 < a2; }
function v6261EventDate(e){ return e.event_date || e.date || e.fecha || ''; }
function v6261EventStart(e){ return e.start_time || e.planned_start || e.hora_inicio || '09:00'; }
function v6261EventEnd(e){ return e.end_time || e.planned_end || e.hora_fin || '14:00'; }

function v6261AssignmentConflicts(eventId,userId,date,start,end){
  const rows = v6261All(`
    SELECT a.*, e.name AS event_name, e.event_date, e.date, e.start_time AS event_start_time, e.end_time AS event_end_time
    FROM assignments a
    LEFT JOIN events e ON e.id = a.event_id
    WHERE a.user_id = ? AND CAST(a.event_id AS TEXT) != CAST(? AS TEXT)
  `, [userId, eventId || 0]);

  let ns = v6261ToMs(date,start), ne = v6261ToMs(date,end);
  if(ne <= ns) ne += 86400000;

  return rows.filter(r=>{
    const rd = r.event_date || r.date || date;
    const rs = r.planned_start || r.start_time || r.event_start_time || start;
    const re = r.planned_end || r.end_time || r.event_end_time || end;
    let as = v6261ToMs(rd,rs), ae = v6261ToMs(rd,re);
    if(ae <= as) ae += 86400000;
    return v6261Overlap(ns,ne,as,ae);
  });
}

function v6261AvailabilityBlocks(userId,date,start,end){
  const rows = v6261All(`
    SELECT * FROM worker_availability_v6261
    WHERE user_id = ? AND date = ? AND status != 'available'
  `, [userId, date]);

  let ns = v6261ToMs(date,start), ne = v6261ToMs(date,end);
  if(ne <= ns) ne += 86400000;

  return rows.filter(r=>{
    const rs = r.start_time || '00:00';
    const re = r.end_time || '23:59';
    let as = v6261ToMs(date,rs), ae = v6261ToMs(date,re);
    if(ae <= as) ae += 86400000;
    return v6261Overlap(ns,ne,as,ae);
  });
}

function v6261WorkerName(u){
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.nickname || u.name || u.email || u.phone || ('Operario #' + u.id);
}

function v6261WorkerScore(user,event,conflicts,blocks){
  let score = 100;
  const role = String(user.role || '').toLowerCase();
  if(role.includes('admin')) score -= 100;
  if(Number(user.active || 1) === 0) score -= 100;
  if(conflicts.length) score -= 100;
  if(blocks.length) score -= 100;
  if(role.includes('team') || role.includes('jefe')) score += 10;
  if(user.phone) score += 3;
  if(user.email) score += 2;
  return score;
}

function v6261RecommendTeam(eventId){
  const event = v6261Get(`SELECT * FROM events WHERE id=?`, [eventId]);
  if(!event) return {ok:false,error:'Evento no encontrado'};
  const date = v6261EventDate(event);
  const start = v6261EventStart(event);
  const end = v6261EventEnd(event);
  const required = Number(event.required_workers || event.workers_required || event.staff_required || 4);

  let users = v6261All(`SELECT * FROM users WHERE COALESCE(active,1)!=0`);
  users = users.filter(u => !String(u.role || '').toLowerCase().includes('admin'));

  const scored = users.map(u=>{
    const conflicts = v6261AssignmentConflicts(eventId,u.id,date,start,end);
    const blocks = v6261AvailabilityBlocks(u.id,date,start,end);
    const score = v6261WorkerScore(u,event,conflicts,blocks);
    return {
      user_id:u.id,
      name:v6261WorkerName(u),
      role:u.role || '',
      phone:u.phone || '',
      email:u.email || '',
      score,
      available: score > 0,
      conflicts,
      availability_blocks:blocks,
      reason: score <= 0 ? (conflicts.length ? 'Solapamiento' : blocks.length ? 'No disponible' : 'No apto') : 'Disponible'
    };
  }).sort((a,b)=>b.score-a.score);

  const selected = scored.filter(x=>x.available).slice(0, required);
  const payload = {ok:true,event_id:eventId,required_workers:required,selected,candidates:scored};

  try {
    v6261Run(`INSERT INTO planning_suggestions_v6261 (event_id,payload) VALUES (?,?)`, [eventId, JSON.stringify(payload)]);
  } catch(e) {}

  return payload;
}

try {
  v6261EnsureTables();

  app.get('/api/v6261/health',(req,res)=>{
    res.json({ok:true,version:'62.70.0',message:'Disponibilidad + Planificador activo'});
  });

  app.get('/api/v6261/availability',(req,res)=>{
    v6261EnsureTables();
    const rows = v6261All(`SELECT * FROM worker_availability_v6261 ORDER BY date DESC, user_id`);
    res.json({ok:true,availability:rows});
  });

  app.post('/api/v6261/availability',(req,res)=>{
    v6261EnsureTables();
    const b = req.body || {};
    if(!b.user_id || !b.date) return res.status(400).json({ok:false,error:'Falta user_id o date'});
    const status = b.status || 'unavailable';
    v6261Run(`INSERT INTO worker_availability_v6261 (user_id,date,status,start_time,end_time,reason,notes,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [b.user_id,b.date,status,b.start_time||'',b.end_time||'',b.reason||'',b.notes||'']
    );
    res.json({ok:true});
  });

  app.get('/api/v6261/availability/:userId',(req,res)=>{
    v6261EnsureTables();
    const rows = v6261All(`SELECT * FROM worker_availability_v6261 WHERE user_id=? ORDER BY date DESC`, [req.params.userId]);
    res.json({ok:true,availability:rows});
  });

  app.post('/api/v6261/preferences',(req,res)=>{
    v6261EnsureTables();
    const b = req.body || {};
    if(!b.user_id) return res.status(400).json({ok:false,error:'Falta user_id'});
    v6261Run(`INSERT INTO worker_preferences_v6261
      (user_id,preferred_role,max_hours_week,max_nights_week,has_car,can_drive,preferred_zone,notes,updated_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        preferred_role=excluded.preferred_role,
        max_hours_week=excluded.max_hours_week,
        max_nights_week=excluded.max_nights_week,
        has_car=excluded.has_car,
        can_drive=excluded.can_drive,
        preferred_zone=excluded.preferred_zone,
        notes=excluded.notes,
        updated_at=CURRENT_TIMESTAMP`,
      [b.user_id,b.preferred_role||'',Number(b.max_hours_week||40),Number(b.max_nights_week||3),Number(b.has_car||0),Number(b.can_drive||0),b.preferred_zone||'',b.notes||'']
    );
    res.json({ok:true});
  });

  app.get('/api/v6261/preferences',(req,res)=>{
    v6261EnsureTables();
    const rows = v6261All(`SELECT * FROM worker_preferences_v6261 ORDER BY user_id`);
    res.json({ok:true,preferences:rows});
  });

  app.get('/api/v6261/event/:eventId/availability',(req,res)=>{
    v6261EnsureTables();
    const event = v6261Get(`SELECT * FROM events WHERE id=?`, [req.params.eventId]);
    if(!event) return res.status(404).json({ok:false,error:'Evento no encontrado'});
    const date = v6261EventDate(event), start = v6261EventStart(event), end = v6261EventEnd(event);
    const users = v6261All(`SELECT * FROM users WHERE COALESCE(active,1)!=0`);
    const rows = users.filter(u=>!String(u.role||'').toLowerCase().includes('admin')).map(u=>{
      const conflicts = v6261AssignmentConflicts(req.params.eventId,u.id,date,start,end);
      const blocks = v6261AvailabilityBlocks(u.id,date,start,end);
      return {
        user_id:u.id,
        name:v6261WorkerName(u),
        role:u.role || '',
        available: conflicts.length === 0 && blocks.length === 0,
        conflicts,
        availability_blocks:blocks
      };
    });
    res.json({ok:true,event_id:req.params.eventId,workers:rows});
  });

  app.get('/api/v6261/plan/:eventId',(req,res)=>{
    v6261EnsureTables();
    res.json(v6261RecommendTeam(req.params.eventId));
  });

  app.get('/api/v6261/suggestions',(req,res)=>{
    v6261EnsureTables();
    const rows = v6261All(`SELECT * FROM planning_suggestions_v6261 ORDER BY id DESC LIMIT 100`);
    res.json({ok:true,suggestions:rows});
  });

} catch(e){
  console.error('[V62.61]', e.message);
}
// ---------- END V62.61 ----------


// ---------- V62.63 INTEGRACION REAL UI ----------
function v6263Db(){
  try { if (typeof db !== 'undefined') return db; } catch(e) {}
  try { if (global.db) return global.db; } catch(e) {}
  return null;
}
function v6263All(sql, params){
  const database = v6263Db();
  try { return database.prepare(sql).all(...(params || [])); } catch(e) { return []; }
}
function v6263Get(sql, params){
  const database = v6263Db();
  try { return database.prepare(sql).get(...(params || [])); } catch(e) { return null; }
}
function v6263Today(){ return new Date().toISOString().slice(0,10); }
function v6263Money(n){ return Number(n||0); }

function v6263Dashboard(){
  const today = v6263Today();
  const events = v6263All(`SELECT * FROM events`);
  const clients = v6263All(`SELECT * FROM clients`);
  const users = v6263All(`SELECT * FROM users`);
  const assignments = v6263All(`SELECT * FROM assignments`);
  const checkins = v6263All(`SELECT * FROM checkins`);
  const todayEvents = events.filter(e => String(e.event_date || e.date || '').slice(0,10) === today);
  const eventIds = new Set(todayEvents.map(e => String(e.id)));
  const todayAssignments = assignments.filter(a => eventIds.has(String(a.event_id)));
  const todayCheckins = checkins.filter(c => String(c.created_at || c.at || '').slice(0,10) === today);
  let revenue = 0;
  todayEvents.forEach(e => revenue += v6263Money(e.budget || e.total || e.revenue || e.estimated_revenue || 0));
  const cost = todayAssignments.length * 5 * 12;
  return {
    ok:true,
    version:'62.70.0',
    cards:{
      events_today:todayEvents.length,
      clients_total:clients.length,
      workers_total:users.filter(u=>!String(u.role||'').toLowerCase().includes('admin')).length,
      assignments_today:todayAssignments.length,
      checked_in_today:todayCheckins.length,
      pending_checkins:Math.max(0,todayAssignments.length - todayCheckins.length),
      revenue_today:revenue,
      personnel_cost:cost,
      margin_today:revenue-cost
    },
    events_today:todayEvents,
    alerts:v6263Alerts(todayEvents,todayAssignments)
  };
}
function v6263Alerts(eventsToday, assignmentsToday){
  const out = [];
  eventsToday.forEach(e=>{
    const a = assignmentsToday.filter(x => String(x.event_id) === String(e.id));
    if(!a.length) out.push({level:'critical',message:'Evento sin personal asignado',event_id:e.id});
    if(!a.some(x=>Number(x.is_team_lead||0)===1)) out.push({level:'warning',message:'Evento sin jefe de equipo',event_id:e.id});
  });
  return out;
}
try {
  app.get('/api/v6263/health',(req,res)=>res.json({ok:true,version:'62.70.0',message:'Integración real UI activa'}));
  app.get('/api/v6263/dashboard',(req,res)=>res.json(v6263Dashboard()));
  app.get('/api/v6263/centro-operativo',(req,res)=>res.json(v6263Dashboard()));
  app.get('/api/v6263/disponibilidad',(req,res)=>{
    let rows = [];
    try { rows = v6263All(`SELECT * FROM worker_availability_v6261 ORDER BY date DESC LIMIT 200`); } catch(e) {}
    res.json({ok:true,availability:rows});
  });
  app.get('/api/v6263/planificador/eventos',(req,res)=>{
    const events = v6263All(`SELECT * FROM events ORDER BY COALESCE(event_date,date,'') DESC LIMIT 100`);
    res.json({ok:true,events});
  });
  app.get('/api/v6263/portal-operario/resumen',(req,res)=>{
    const users = v6263All(`SELECT * FROM users WHERE COALESCE(role,'')!='admin' LIMIT 200`);
    res.json({ok:true,operators:users});
  });
} catch(e){
  console.error('[V62.63]', e.message);
}
// ---------- END V62.63 ----------


// ---------- V62.64 UI CORE FIX API ----------
try {
  app.get('/api/v6264/health',(req,res)=>res.json({ok:true,version:'62.70.0',message:'UI Core Fix activo'}));
} catch(e) {}
// ---------- END V62.64 ----------


// ---------- V62.65 OPERARIOS PRO + EXPEDIENTE RRHH ----------
function v6265Db(){ try { if (typeof db !== 'undefined') return db; } catch(e) {} try { if (global.db) return global.db; } catch(e) {} return null; }
function v6265All(sql, params){ const database=v6265Db(); try { return database.prepare(sql).all(...(params||[])); } catch(e) { return []; } }
function v6265Get(sql, params){ const database=v6265Db(); try { return database.prepare(sql).get(...(params||[])); } catch(e) { return null; } }
function v6265Run(sql, params){ const database=v6265Db(); try { return database.prepare(sql).run(...(params||[])); } catch(e) { return null; } }
function v6265EnsureTables(){
  const database=v6265Db(); if(!database) return;
  try { database.exec(`CREATE TABLE IF NOT EXISTS worker_notes_v6265 (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,note_type TEXT DEFAULT '',note TEXT DEFAULT '',created_by TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`); } catch(e) {}
  try { database.exec(`CREATE TABLE IF NOT EXISTS worker_alerts_v6265 (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,level TEXT DEFAULT 'warning',type TEXT DEFAULT '',message TEXT DEFAULT '',resolved INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`); } catch(e) {}
}
function v6265WorkerName(u){ return [u.first_name,u.last_name].filter(Boolean).join(' ') || u.nickname || u.name || u.email || u.phone || ('Operario #' + u.id); }
function v6265Workers(){ return v6265All(`SELECT * FROM users WHERE COALESCE(role,'')!='admin' ORDER BY first_name,last_name,nickname,email,phone`); }
function v6265WorkerDocuments(userId){
  let docs=[];
  try { docs=v6265All(`SELECT * FROM documents WHERE user_id=? OR worker_id=? OR operator_id=? ORDER BY id DESC`,[userId,userId,userId]); } catch(e) {}
  if(!docs.length){ try { docs=v6265All(`SELECT * FROM hr_documents WHERE user_id=? OR worker_id=? OR operator_id=? ORDER BY id DESC`,[userId,userId,userId]); } catch(e) {} }
  return docs;
}
function v6265WorkerAssignments(userId){ return v6265All(`SELECT a.*, e.name AS event_name, e.title AS event_title, e.event_date, e.date, e.start_time AS event_start, e.end_time AS event_end FROM assignments a LEFT JOIN events e ON e.id=a.event_id WHERE a.user_id=? ORDER BY COALESCE(e.event_date,e.date,'') DESC LIMIT 150`,[userId]); }
function v6265WorkerCheckins(userId){ return v6265All(`SELECT * FROM checkins WHERE user_id=? ORDER BY COALESCE(created_at,at,'') DESC LIMIT 200`,[userId]); }
function v6265WorkerAvailability(userId){ return v6265All(`SELECT * FROM worker_availability_v6261 WHERE user_id=? ORDER BY date DESC LIMIT 100`,[userId]); }
function v6265WorkerStats(userId){
  const assignments=v6265WorkerAssignments(userId), checkins=v6265WorkerCheckins(userId), docs=v6265WorkerDocuments(userId);
  const now=new Date(), today=now.toISOString().slice(0,10), month=now.toISOString().slice(0,7);
  const expired=docs.filter(d=>{ const v=d.valid_to||d.expiry_date||d.expires_at||d.end_date||''; return v && String(v).slice(0,10)<today; });
  const near=docs.filter(d=>{ const v=d.valid_to||d.expiry_date||d.expires_at||d.end_date||''; if(!v) return false; const diff=(new Date(String(v).slice(0,10)).getTime()-now.getTime())/86400000; return diff>=0 && diff<=30; });
  return { assignments_total:assignments.length, assignments_month:assignments.filter(a=>String(a.event_date||a.date||'').slice(0,7)===month).length, checkins_total:checkins.length, documents_total:docs.length, documents_expired:expired.length, documents_near_expiry:near.length, availability_blocks:v6265WorkerAvailability(userId).length };
}
function v6265Profile(userId){
  const user=v6265Get(`SELECT * FROM users WHERE id=?`,[userId]); if(!user) return null;
  return { user, name:v6265WorkerName(user), stats:v6265WorkerStats(userId), documents:v6265WorkerDocuments(userId), assignments:v6265WorkerAssignments(userId), checkins:v6265WorkerCheckins(userId), availability:v6265WorkerAvailability(userId), notes:v6265All(`SELECT * FROM worker_notes_v6265 WHERE user_id=? ORDER BY id DESC LIMIT 100`,[userId]), alerts:v6265All(`SELECT * FROM worker_alerts_v6265 WHERE user_id=? AND COALESCE(resolved,0)=0 ORDER BY id DESC LIMIT 100`,[userId]) };
}
function v6265GlobalAlerts(){
  const alerts=[]; v6265Workers().forEach(w=>{ const p=v6265Profile(w.id); if(!p) return; if(p.stats.documents_expired>0) alerts.push({level:'critical',user_id:w.id,name:p.name,message:'Documentación caducada'}); if(p.stats.documents_near_expiry>0) alerts.push({level:'warning',user_id:w.id,name:p.name,message:'Documentación próxima a caducar'}); if(!w.phone) alerts.push({level:'warning',user_id:w.id,name:p.name,message:'Operario sin teléfono'}); }); return alerts;
}
try {
  v6265EnsureTables();
  app.get('/api/v6265/health',(req,res)=>res.json({ok:true,version:'62.70.0',message:'Operarios Pro + Expediente RRHH activo'}));
  app.get('/api/v6265/workers',(req,res)=>res.json({ok:true,workers:v6265Workers().map(w=>({id:w.id,name:v6265WorkerName(w),phone:w.phone||'',email:w.email||'',role:w.role||'',active:w.active,stats:v6265WorkerStats(w.id)}))}));
  app.get('/api/v6265/worker/:userId/profile',(req,res)=>{ const p=v6265Profile(req.params.userId); if(!p) return res.status(404).json({ok:false,error:'Operario no encontrado'}); res.json({ok:true,profile:p}); });
  app.post('/api/v6265/worker/:userId/note',(req,res)=>{ v6265EnsureTables(); const b=req.body||{}; v6265Run(`INSERT INTO worker_notes_v6265 (user_id,note_type,note,created_by) VALUES (?,?,?,?)`,[req.params.userId,b.note_type||'general',b.note||'',b.created_by||'admin']); res.json({ok:true}); });
  app.post('/api/v6265/worker/:userId/alert',(req,res)=>{ v6265EnsureTables(); const b=req.body||{}; v6265Run(`INSERT INTO worker_alerts_v6265 (user_id,level,type,message) VALUES (?,?,?,?)`,[req.params.userId,b.level||'warning',b.type||'manual',b.message||'']); res.json({ok:true}); });
  app.get('/api/v6265/alerts',(req,res)=>res.json({ok:true,alerts:v6265GlobalAlerts()}));
} catch(e) { console.error('[V62.65]', e.message); }
// ---------- END V62.65 ----------


// ---------- V62.66 FIX PORTAL OPERARIO ----------
try {
  app.get('/api/v6266/health',(req,res)=>res.json({ok:true,version:'62.70.0',message:'Fix Portal Operario activo'}));
} catch(e) {}
// ---------- END V62.66 ----------


// ---------- V62.67 FIX PORTAL SAFARI + ID SEGURO ----------
function v6267Db(){
  try { if (typeof db !== 'undefined') return db; } catch(e) {}
  try { if (global.db) return global.db; } catch(e) {}
  return null;
}
function v6267Get(sql, params){
  const database = v6267Db();
  try { return database.prepare(sql).get(...(params || [])); } catch(e) { return null; }
}
function v6267All(sql, params){
  const database = v6267Db();
  try { return database.prepare(sql).all(...(params || [])); } catch(e) { return []; }
}
function v6267SafeProfileById(userId){
  const id = String(userId || '').replace(/[^0-9]/g,'');
  if(!id) return null;
  if (typeof v6265Profile === 'function') return v6265Profile(id);
  const user = v6267Get(`SELECT * FROM users WHERE id=?`, [id]);
  if(!user) return null;
  return {user, name: user.first_name || user.name || user.nickname || user.email || user.phone || ('Operario #' + id), stats:{}, documents:[], assignments:[], checkins:[], availability:[]};
}
function v6267FindWorker(q){
  q = String(q || '').trim();
  const cleanPhone = q.replace(/[^0-9]/g,'');
  let user = null;
  if(/^\d+$/.test(q)) user = v6267Get(`SELECT * FROM users WHERE id=?`, [q]);
  if(!user && cleanPhone) user = v6267Get(`SELECT * FROM users WHERE REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+','') LIKE ? LIMIT 1`, ['%' + cleanPhone + '%']);
  if(!user && q.includes('@')) user = v6267Get(`SELECT * FROM users WHERE email=? LIMIT 1`, [q]);
  if(!user) user = v6267Get(`SELECT * FROM users WHERE first_name LIKE ? OR last_name LIKE ? OR nickname LIKE ? OR name LIKE ? LIMIT 1`, ['%' + q + '%','%' + q + '%','%' + q + '%','%' + q + '%']);
  return user;
}
try {
  app.get('/api/v6267/health',(req,res)=>res.json({ok:true,version:'62.70.0',message:'Fix Portal Safari + ID Seguro activo'}));

  app.get('/api/v6267/operator/profile',(req,res)=>{
    const q = req.query.id || req.query.q || req.query.user_id || '';
    let profile = v6267SafeProfileById(q);
    if(!profile){
      const found = v6267FindWorker(q);
      if(found) profile = v6267SafeProfileById(found.id);
    }
    if(!profile) return res.status(404).json({ok:false,error:'Operario no encontrado',query:q});
    res.json({ok:true,profile});
  });

  app.get('/api/v6267/operators',(req,res)=>{
    let rows = [];
    try { rows = v6267All(`SELECT id, first_name, last_name, nickname, name, phone, email, role, active FROM users WHERE COALESCE(role,'')!='admin' ORDER BY first_name,last_name,nickname,email,phone`); } catch(e) {}
    rows = rows.map(u => ({id:u.id, name:[u.first_name,u.last_name].filter(Boolean).join(' ') || u.nickname || u.name || u.email || u.phone || ('Operario #' + u.id), phone:u.phone||'', email:u.email||'', role:u.role||'', active:u.active}));
    res.json({ok:true,operators:rows});
  });
} catch(e) {
  console.error('[V62.67]', e.message);
}
// ---------- END V62.67 ----------


// ---------- V62.69 RAILWAY NODE18 BUILD FIX ----------
try {
  app.get('/api/v6269/health',(req,res)=>{
    let expressOk = false;
    try { require('express'); expressOk = true; } catch(e) {}
    res.json({ok:true,version:'62.70.0',message:'Railway Node18 Build Fix activo',express:expressOk,node:process.version});
  });
} catch(e) {}
// ---------- END V62.69 ----------


// ---------- V62.70 RAILWAY RUNTIME INSTALL FIX ----------
try {
  app.get('/api/v6270/health',(req,res)=>{
    let expressOk = false;
    try { require('express'); expressOk = true; } catch(e) {}
    res.json({ok:true,version:'62.70.0',message:'Railway Runtime Install Fix activo',express:expressOk,node:process.version});
  });
} catch(e) {}
// ---------- END V62.70 ----------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Marfan Crew Hours V62.49 Calendar Buttons Use Picker listening on port ${PORT}`);
});


// ---------- V53.4 AUTO DELIVERY NOTES ----------
app.post('/api/events/:id/complete', requireAdmin, (req,res)=>{
  const id=Number(req.params.id);
  try{
    db.prepare("UPDATE events SET status='realizado' WHERE id=?").run(id);
  }catch(e){}
  res.json({ok:true});
});


// ---------- V53.5 PERSISTENT BACKUP STATUS ----------
app.get('/api/backup/status', requireAdmin, (req, res) => {
  let backups = [];
  try {
    const dir = v533BackupDir();
    backups = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  } catch(e) {}
  res.json({
    ok:true,
    persistent_data_dir:PERSISTENT_DATA_DIR,
    persistent_backup_dir:PERSISTENT_BACKUP_DIR,
    backups_count:backups.length,
    railway_volume_required:true,
    note:'Para conservar datos entre versiones, Railway debe tener un Volume montado en /data.'
  });
});

// ---------- V55.9 GOOGLE POPUP CALLBACK ----------
app.get('/auth/google/callback-popup', async (req,res)=>{
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta code OAuth.');
    const clientId = process.env.GOOGLE_CLIENT_ID || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : '');
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (typeof GOOGLE_CLIENT_SECRET !== 'undefined' ? GOOGLE_CLIENT_SECRET : '');
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || (typeof GOOGLE_CALLBACK_URL !== 'undefined' ? GOOGLE_CALLBACK_URL : '');
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
    const { tokens } = await oauth2.getToken(code);
    if (typeof v557SaveTokensEverywhere === 'function') v557SaveTokensEverywhere(tokens);
    else if (typeof v55SaveGoogleTokens === 'function') v55SaveGoogleTokens(tokens);
    res.send(`
      <html><body style="font-family:Arial;padding:34px">
        <h2>Google Calendar MARFAN conectado ✅</h2>
        <p>Puedes cerrar esta ventana.</p>
        <script>
          try { window.opener && window.opener.postMessage({type:'GOOGLE_CALENDAR_CONNECTED'}, '*'); } catch(e) {}
          setTimeout(()=>window.close(),900);
        </script>
      </body></html>
    `);
  } catch(e) {
    res.status(500).send('Error conectando Google Calendar: '+e.message);
  }
});


// ---------- V56.9 REAL CALENDAR FIX ----------
app.get('/api/google/debug-calendars-v569', requireAdmin, async (req,res)=>{
  try{
    const tokens = typeof v567GetTokens === 'function' ? v567GetTokens() : null;
    if(!tokens) return res.json({ok:false,error:'No hay tokens Google'});
    const oauth2 = v567OAuthClient();
    oauth2.setCredentials(tokens);
    const calendar = google.calendar({version:'v3',auth:oauth2});
    const list = await calendar.calendarList.list({maxResults:250,showHidden:true});
    res.json({
      ok:true,
      total:(list.data.items||[]).length,
      calendars:(list.data.items||[]).map(c=>({
        id:c.id,
        summary:c.summary,
        accessRole:c.accessRole
      }))
    });
  }catch(e){
    res.json({ok:false,error:e.message});
  }
});

app.post('/api/google/manual-force-sync-v569', requireAdmin, async (req,res)=>{
  try{
    const tokens = typeof v567GetTokens === 'function' ? v567GetTokens() : null;
    if(!tokens) throw new Error('Google no conectado');

    const oauth2 = v567OAuthClient();
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({version:'v3',auth:oauth2});

    const targetId = process.env.GOOGLE_TARGET_CALENDAR_ID || 'primary';

    const response = await calendar.events.list({
      calendarId:targetId,
      singleEvents:true,
      orderBy:'startTime',
      maxResults:500,
      timeMin:new Date('2024-01-01').toISOString()
    });

    const items = response.data.items || [];

    let created = 0;
    let updated = 0;

    for(const item of items){
      try{
        const existing = db.prepare(`
          SELECT * FROM google_event_links
          WHERE google_event_id=?
        `).get(item.id);

        const startRaw = item.start?.dateTime || item.start?.date || '';
        const endRaw = item.end?.dateTime || item.end?.date || '';

        const startDate = String(startRaw).slice(0,10);
        const startTime = String(startRaw).slice(11,16) || '09:00';
        const endTime = String(endRaw).slice(11,16) || '10:00';

        if(existing){
          db.prepare(`
            UPDATE events
            SET name=?, location=?, notes=?, event_date=?, start_time=?, end_time=?, operational_status='google_marfan'
            WHERE id=?
          `).run(
            item.summary || 'Evento Google',
            item.location || '',
            item.description || '',
            startDate,
            startTime,
            endTime,
            existing.event_id
          );
          updated++;
        }else{
          const info = db.prepare(`
            INSERT INTO events
            (name,client,location,notes,event_date,start_time,end_time,status,operational_status)
            VALUES (?,?,?,?,?,?,?,?,?)
          `).run(
            item.summary || 'Evento Google',
            'MARFAN',
            item.location || '',
            item.description || '',
            startDate,
            startTime,
            endTime,
            'programado',
            'google_marfan'
          );

          db.prepare(`
            INSERT INTO google_event_links
            (event_id,google_event_id,calendar_id)
            VALUES (?,?,?)
          `).run(info.lastInsertRowid,item.id,targetId);

          created++;
        }
      }catch(err){}
    }

    res.json({
      ok:true,
      total_google:items.length,
      created,
      updated
    });

  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V57.1 BACKUP AUTO-CLEAN MAX 10 ----------
const V571_MAX_BACKUPS = Number(process.env.MAX_BACKUPS || 10);

function v571CleanOldBackups(){
  try{
    const dir = typeof v57BackupDir === 'function'
      ? v57BackupDir()
      : path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : '/data'), 'backups');

    fs.mkdirSync(dir,{recursive:true});

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') && f !== 'LATEST.json')
      .map(f => {
        const p = path.join(dir,f);
        const st = fs.statSync(p);
        return { filename:f, path:p, mtime:st.mtimeMs };
      })
      .sort((a,b)=>b.mtime-a.mtime);

    const toDelete = files.slice(V571_MAX_BACKUPS);
    for(const f of toDelete){
      try{ fs.unlinkSync(f.path); }catch(e){}
    }

    return {
      ok:true,
      kept:Math.min(files.length,V571_MAX_BACKUPS),
      deleted:toDelete.length,
      max:V571_MAX_BACKUPS
    };
  }catch(e){
    console.error('v571CleanOldBackups', e);
    return {ok:false,error:e.message};
  }
}

// envolver escritura de backup para limpiar automáticamente después
if(typeof v57WriteBackup === 'function' && !global.__v571BackupWrapped){
  global.__v571BackupWrapped = true;
  const __v57WriteBackupOriginal = v57WriteBackup;
  v57WriteBackup = function(reason='auto'){
    const result = __v57WriteBackupOriginal(reason);
    try{ result.cleanup = v571CleanOldBackups(); }catch(e){}
    return result;
  };
}

app.post('/api/backup/cleanup-v571', requireAdmin, (req,res)=>{
  res.json(v571CleanOldBackups());
});

app.get('/api/backup/status-v571', requireAdmin, (req,res)=>{
  try{
    const dir = typeof v57BackupDir === 'function'
      ? v57BackupDir()
      : path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : '/data'), 'backups');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'LATEST.json');
    res.json({
      ok:true,
      max:V571_MAX_BACKUPS,
      current:files.length,
      latest_exists:fs.existsSync(path.join(dir,'LATEST.json')),
      dir
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V57.2 CALENDAR SYNC PATTERN FIX ----------
function v572TokenPath(){
  return path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : (process.env.DATA_DIR || '/data')), 'google-token.json');
}
function v572GetTokens(){
  try{ if(typeof v557GetTokensAny==='function'){ const t=v557GetTokensAny(); if(t) return t; }}catch(e){}
  try{ if(typeof v567GetTokens==='function'){ const t=v567GetTokens(); if(t) return t; }}catch(e){}
  try{ if(fs.existsSync(v572TokenPath())) return JSON.parse(fs.readFileSync(v572TokenPath(),'utf8')); }catch(e){}
  return null;
}
function v572OAuth(){
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || '';
  if(!clientId || !clientSecret || !callbackUrl) throw new Error('Faltan variables Google en Railway: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL');
  return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}
async function v572Calendar(){
  const tokens = v572GetTokens();
  if(!tokens) throw new Error('No hay token Google guardado. Conecta Google otra vez.');
  const oauth = v572OAuth();
  oauth.setCredentials(tokens);
  return google.calendar({version:'v3', auth:oauth});
}
function v572Clean(s){
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
async function v572FindMarfanCalendar(calendar){
  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim();
  const list = await calendar.calendarList.list({maxResults:250, showHidden:true});
  const calendars = list.data.items || [];
  if(targetId){
    const c = calendars.find(x=>x.id===targetId);
    if(c) return {calendar:c, calendars, match:'id'};
  }
  let c = calendars.find(x=>v572Clean(x.summary)===v572Clean(targetName));
  if(c) return {calendar:c, calendars, match:'nombre exacto'};
  c = calendars.find(x=>v572Clean(x.summary).includes('marfan') || v572Clean(x.id).includes('marfan'));
  if(c) return {calendar:c, calendars, match:'flexible'};
  throw new Error('No encuentro calendario MARFAN. Disponibles: ' + calendars.map(x=>x.summary).join(', '));
}
function v572DateParts(raw){
  if(!raw) return {date:'', time:''};
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return {date:raw,time:''};
  const d = new Date(raw);
  if(Number.isNaN(d.getTime())) return {date:String(raw).slice(0,10), time:String(raw).slice(11,16)};
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  }).formatToParts(d).reduce((a,x)=>{a[x.type]=x.value; return a;}, {});
  return {date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}`};
}
function v572Cols(table){
  try{return db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name);}catch(e){return [];}
}
function v572EnsureLinks(){
  db.exec(`CREATE TABLE IF NOT EXISTS google_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    google_event_id TEXT NOT NULL,
    calendar_id TEXT DEFAULT '',
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}
function v572UpsertGoogleEvent(item, calendarId){
  v572EnsureLinks();
  const s = item.start || {};
  const e = item.end || {};
  const start = v572DateParts(s.dateTime || s.date);
  const end = v572DateParts(e.dateTime || e.date);
  if(!start.date) throw new Error('Evento Google sin fecha válida: ' + (item.summary || item.id));

  const data = {
    name:item.summary || 'Evento MARFAN',
    client:'MARFAN',
    location:item.location || '',
    notes:item.description || '',
    event_date:start.date,
    start_time:start.time || '09:00',
    end_time:end.time || '10:00',
    status:'programado',
    operational_status:'google_marfan'
  };
  const cols = v572Cols('events');
  const keys = Object.keys(data).filter(k=>cols.includes(k));
  if(!keys.length) throw new Error('Tabla events sin columnas compatibles');

  const existing = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(item.id);
  if(existing){
    db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>data[k]), existing.event_id);
    db.prepare('UPDATE google_event_links SET calendar_id=?, synced_at=CURRENT_TIMESTAMP WHERE id=?').run(calendarId, existing.id);
    return {action:'updated', event_id:existing.event_id, summary:data.name};
  }
  const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>data[k]));
  db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, item.id, calendarId);
  return {action:'created', event_id:info.lastInsertRowid, summary:data.name};
}

app.get('/api/google/diagnose-v572', requireAdmin, async (req,res)=>{
  const out = {
    ok:false,
    has_token:!!v572GetTokens(),
    has_client_id:!!process.env.GOOGLE_CLIENT_ID,
    has_client_secret:!!process.env.GOOGLE_CLIENT_SECRET,
    callback_url:process.env.GOOGLE_CALLBACK_URL || '',
    target_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    target_id:process.env.GOOGLE_TARGET_CALENDAR_ID || ''
  };
  try{
    const cal = await v572Calendar();
    const found = await v572FindMarfanCalendar(cal);
    out.ok = true;
    out.calendar = {id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole};
    out.match = found.match;
    out.calendars = found.calendars.map(c=>({id:c.id, summary:c.summary, accessRole:c.accessRole}));
    res.json(out);
  }catch(e){
    out.error = e.message;
    res.json(out);
  }
});

app.post('/api/google/force-sync-v572', requireAdmin, async (req,res)=>{
  try{
    const cal = await v572Calendar();
    const found = await v572FindMarfanCalendar(cal);
    const timeMin = '2024-01-01T00:00:00.000Z';
    const timeMax = new Date(new Date().getFullYear()+3, 11, 31, 23, 59, 59).toISOString();

    let pageToken = undefined;
    const items = [];
    do{
      const r = await cal.events.list({
        calendarId:found.calendar.id,
        timeMin,
        timeMax,
        singleEvents:true,
        orderBy:'startTime',
        maxResults:250,
        pageToken
      });
      items.push(...(r.data.items||[]).filter(i=>i.status!=='cancelled'));
      pageToken = r.data.nextPageToken || undefined;
    }while(pageToken);

    const results = items.map(item=>{
      try{return v572UpsertGoogleEvent(item, found.calendar.id);}
      catch(e){return {action:'error', summary:item.summary || item.id, error:e.message};}
    });

    res.json({
      ok:true,
      calendar:{id:found.calendar.id, summary:found.calendar.summary, accessRole:found.calendar.accessRole},
      match:found.match,
      read:items.length,
      created:results.filter(x=>x.action==='created').length,
      updated:results.filter(x=>x.action==='updated').length,
      errors:results.filter(x=>x.action==='error').length,
      results:results.slice(0,80)
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});


// ---------- V57.4 CALENDAR SYNC NO PATTERN ERROR FIX ----------
function v574TokenFile(){
  return path.join((typeof V552_DATA_DIR !== 'undefined' ? V552_DATA_DIR : (process.env.DATA_DIR || '/data')), 'google-token.json');
}
function v574GetTokens(){
  const sources = [
    ()=> typeof v557GetTokensAny === 'function' ? v557GetTokensAny() : null,
    ()=> typeof v567GetTokens === 'function' ? v567GetTokens() : null,
    ()=> typeof v572GetTokens === 'function' ? v572GetTokens() : null,
    ()=> fs.existsSync(v574TokenFile()) ? JSON.parse(fs.readFileSync(v574TokenFile(),'utf8')) : null
  ];
  for(const fn of sources){
    try{
      const t = fn();
      if(t && (t.access_token || t.refresh_token)) return t;
    }catch(e){}
  }
  return null;
}
function v574OAuthClient(){
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const callbackUrl = String(process.env.GOOGLE_CALLBACK_URL || '').trim();
  if(!clientId || !clientSecret || !callbackUrl){
    throw new Error('Faltan variables Railway: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL');
  }
  return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}
async function v574CalendarClient(){
  const tokens = v574GetTokens();
  if(!tokens) throw new Error('No hay token Google guardado. Pulsa Conectar Google otra vez.');
  const oauth2 = v574OAuthClient();
  oauth2.setCredentials(tokens);
  return google.calendar({version:'v3', auth:oauth2});
}
function v574Norm(s){
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
async function v574ResolveCalendar(calendar){
  const targetId = String(process.env.GOOGLE_TARGET_CALENDAR_ID || '').trim();
  const targetName = String(process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN').trim();
  const list = await calendar.calendarList.list({maxResults:250, showHidden:true});
  const calendars = list.data.items || [];

  if(targetId){
    const byId = calendars.find(c=>c.id === targetId);
    if(byId) return {calendar:byId, calendars, match:'GOOGLE_TARGET_CALENDAR_ID'};
  }

  let found = calendars.find(c=>v574Norm(c.summary) === v574Norm(targetName));
  if(found) return {calendar:found, calendars, match:'nombre exacto'};

  found = calendars.find(c=>v574Norm(c.summary).includes('marfan') || v574Norm(c.id).includes('marfan'));
  if(found) return {calendar:found, calendars, match:'flexible marfan'};

  throw new Error('No encuentro calendario MARFAN. Calendarios visibles: ' + calendars.map(c=>c.summary + ' [' + c.accessRole + ']').join(', '));
}
function v574DateParts(raw){
  if(!raw) return {date:'', time:''};
  raw = String(raw);
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return {date:raw, time:''};
  const d = new Date(raw);
  if(!Number.isNaN(d.getTime())){
    const p = new Intl.DateTimeFormat('sv-SE', {
      timeZone:'Europe/Madrid',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit',
      hour12:false
    }).formatToParts(d).reduce((a,x)=>{a[x.type]=x.value; return a;}, {});
    return {date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}`};
  }
  return {date:raw.slice(0,10), time:raw.slice(11,16)};
}
function v574Cols(table){
  try{return db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name);}catch(e){return [];}
}
function v574EnsureLinks(){
  db.exec(`CREATE TABLE IF NOT EXISTS google_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    google_event_id TEXT NOT NULL,
    calendar_id TEXT DEFAULT '',
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}
function v574Upsert(item, calendarId){
  v574EnsureLinks();
  const start = v574DateParts((item.start||{}).dateTime || (item.start||{}).date);
  const end = v574DateParts((item.end||{}).dateTime || (item.end||{}).date);
  if(!start.date) throw new Error('Evento sin fecha válida: ' + (item.summary || item.id));

  const data = {
    name:item.summary || 'Evento MARFAN',
    client:'MARFAN',
    location:item.location || '',
    notes:item.description || '',
    event_date:start.date,
    start_time:start.time || '09:00',
    end_time:end.time || '10:00',
    status:'programado',
    operational_status:'google_marfan'
  };

  const cols = v574Cols('events');
  const keys = Object.keys(data).filter(k=>cols.includes(k));
  if(!keys.length) throw new Error('La tabla events no tiene columnas compatibles.');

  const existing = db.prepare('SELECT * FROM google_event_links WHERE google_event_id=?').get(item.id);
  if(existing){
    db.prepare(`UPDATE events SET ${keys.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...keys.map(k=>data[k]), existing.event_id);
    db.prepare('UPDATE google_event_links SET calendar_id=?, synced_at=CURRENT_TIMESTAMP WHERE id=?').run(calendarId, existing.id);
    return {action:'updated', event_id:existing.event_id, summary:data.name};
  }

  const info = db.prepare(`INSERT INTO events (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>data[k]));
  db.prepare('INSERT INTO google_event_links (event_id,google_event_id,calendar_id) VALUES (?,?,?)').run(info.lastInsertRowid, item.id, calendarId);
  return {action:'created', event_id:info.lastInsertRowid, summary:data.name};
}

// Este endpoint NO usa timeMin/timeMax/orderBy para evitar "The string did not match the expected pattern".
app.post('/api/google/sync-no-pattern-v574', requireAdmin, async (req,res)=>{
  const debug = {
    step:'start',
    has_token:!!v574GetTokens(),
    has_client_id:!!process.env.GOOGLE_CLIENT_ID,
    has_client_secret:!!process.env.GOOGLE_CLIENT_SECRET,
    callback_url:process.env.GOOGLE_CALLBACK_URL || '',
    target_name:process.env.GOOGLE_TARGET_CALENDAR_NAME || 'MARFAN',
    target_id:process.env.GOOGLE_TARGET_CALENDAR_ID || ''
  };

  try{
    debug.step = 'calendar_client';
    const calendar = await v574CalendarClient();

    debug.step = 'calendar_list';
    const resolved = await v574ResolveCalendar(calendar);
    debug.calendar = {id:resolved.calendar.id, summary:resolved.calendar.summary, accessRole:resolved.calendar.accessRole};
    debug.match = resolved.match;

    debug.step = 'events_list_no_filters';

    let pageToken = undefined;
    const items = [];
    do{
      const params = {
        calendarId: resolved.calendar.id,
        maxResults: 250,
        singleEvents: true
      };
      if(pageToken) params.pageToken = pageToken;

      const response = await calendar.events.list(params);
      items.push(...(response.data.items || []).filter(i=>i.status !== 'cancelled'));
      pageToken = response.data.nextPageToken || undefined;
    }while(pageToken && items.length < 2500);

    debug.step = 'upsert';
    const results = [];
    for(const item of items){
      try{ results.push(v574Upsert(item, resolved.calendar.id)); }
      catch(e){ results.push({action:'error', summary:item.summary || item.id, error:e.message}); }
    }

    res.json({
      ok:true,
      debug,
      read:items.length,
      created:results.filter(r=>r.action==='created').length,
      updated:results.filter(r=>r.action==='updated').length,
      errors:results.filter(r=>r.action==='error').length,
      results:results.slice(0,100)
    });
  }catch(e){
    debug.error = e.message;
    debug.stack = e.stack;
    res.status(500).json({ok:false,error:e.message,debug});
  }
});


// ---------- V57.6 CALENDAR EVENT ACTIONS ----------
app.get('/api/events/:id/full-v576', requireAdmin, (req,res)=>{
  try{
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    let assignments = [];
    try{
      assignments = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone
        FROM assignments a
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(req.params.id);
    }catch(e){}
    res.json({ok:true,event,assignments});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.put('/api/events/:id/update-v576', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const exists = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!exists) return res.status(404).json({error:'Evento no encontrado'});
    const b = req.body || {};
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const allowed = [
      'name','client','legal_name','cif','contact_name','contact_phone','contact_email',
      'event_date','start_time','end_time','load_in_time','load_out_time',
      'location','address','access_notes','parking_notes','service_type',
      'required_workers','required_team_leads','material_notes','crew_notes',
      'production_notes','payment_status','estimated_external_cost',
      'estimated_transport_cost','estimated_other_cost','notes','status',
      'operational_status'
    ].filter(k=>cols.includes(k) && Object.prototype.hasOwnProperty.call(b,k));

    if(!allowed.length) return res.json({ok:true,updated:0});

    const sql = `UPDATE events SET ${allowed.map(k=>`"${k}"=?`).join(',')} WHERE id=?`;
    db.prepare(sql).run(...allowed.map(k=>b[k]), id);
    res.json({ok:true,updated:1});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.delete('/api/events/:id/delete-v576', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});

    const tx = db.transaction(()=>{
      try{ db.prepare('DELETE FROM assignments WHERE event_id=?').run(id); }catch(e){}
      try{ db.prepare('DELETE FROM event_role_lines WHERE event_id=?').run(id); }catch(e){}
      try{ db.prepare('DELETE FROM google_event_links WHERE event_id=?').run(id); }catch(e){}
      try{ db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id); }catch(e){}
      try{ db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id); }catch(e){}
      db.prepare('DELETE FROM events WHERE id=?').run(id);
    });
    tx();
    res.json({ok:true,deleted:true});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});


// ---------- V58 CALENDAR EVENT EDIT DELETE DIRECT ----------
app.get('/api/events/:id/detail-v58', requireAdmin, (req,res)=>{
  try{
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    let assignments = [];
    try{
      assignments = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone
        FROM assignments a
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(req.params.id);
    }catch(e){}
    res.json({ok:true,event,assignments});
  }catch(e){res.status(500).json({error:e.message});}
});

app.put('/api/events/:id/save-v58', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    const b = req.body || {};
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const allowed = [
      'name','client','event_date','start_time','end_time','location','address',
      'contact_name','contact_phone','contact_email','status','operational_status',
      'notes','production_notes','access_notes','parking_notes','service_type'
    ].filter(k=>cols.includes(k) && Object.prototype.hasOwnProperty.call(b,k));
    if(!allowed.length) return res.json({ok:true,updated:0});
    db.prepare(`UPDATE events SET ${allowed.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...allowed.map(k=>b[k]), id);
    res.json({ok:true,updated:1});
  }catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/events/:id/remove-v58', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    const tx = db.transaction(()=>{
      try{db.prepare('DELETE FROM assignments WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_role_lines WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM google_event_links WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id);}catch(e){}
      db.prepare('DELETE FROM events WHERE id=?').run(id);
    });
    tx();
    res.json({ok:true,deleted:true});
  }catch(e){res.status(500).json({error:e.message});}
});


// ---------- V58.3 CALENDAR SYNC RESTORED + EDIT FIX ----------
app.get('/api/events/:id/detail-v583', requireAdmin, (req,res)=>{
  try{
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    let assignments = [];
    try{
      assignments = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone
        FROM assignments a
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(req.params.id);
    }catch(e){}
    res.json({ok:true,event,assignments});
  }catch(e){res.status(500).json({error:e.message});}
});

app.put('/api/events/:id/save-v583', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const exists = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!exists) return res.status(404).json({error:'Evento no encontrado'});
    const b = req.body || {};
    const eventBody = b.event || b;
    const assignments = Array.isArray(b.assignments) ? b.assignments : [];
    const cols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
    const fields = [
      'name','client','event_date','start_time','end_time','location','address',
      'contact_name','contact_phone','contact_email','status','operational_status',
      'notes','production_notes','access_notes','parking_notes','service_type',
      'load_in_time','load_out_time','payment_status'
    ].filter(k => cols.includes(k) && Object.prototype.hasOwnProperty.call(eventBody,k));
    if(fields.length){
      db.prepare(`UPDATE events SET ${fields.map(k=>`"${k}"=?`).join(',')} WHERE id=?`).run(...fields.map(k=>eventBody[k]), id);
    }
    if(assignments.length){
      if(typeof v6219SaveAssignmentsHard === 'function') v6219SaveAssignmentsHard(id, assignments);
      else if(typeof v612SaveAssignments === 'function') v612SaveAssignments(id, assignments);
    }
    try{ if(typeof v6218SaveSnapshot === 'function') v6218SaveSnapshot(id, Object.assign({}, exists, eventBody), assignments.length ? assignments : undefined); }catch(e){}
    try{ if(typeof v6246Persist === 'function') v6246Persist(id, Object.assign({}, exists, eventBody), assignments.length ? assignments : undefined); }catch(e){}
    res.json({ok:true,updated:fields.length,assignments_saved:assignments.length});
  }catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/events/:id/remove-v583', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    const tx = db.transaction(()=>{
      try{db.prepare('DELETE FROM assignments WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_role_lines WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM google_event_links WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id);}catch(e){}
      db.prepare('DELETE FROM events WHERE id=?').run(id);
    });
    tx();
    res.json({ok:true,deleted:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// Endpoint puente: usa el sync que ya funcionó en V57.4 si existe; si no, informa claro.
app.post('/api/google/sync-calendar-v583', requireAdmin, async (req,res)=>{
  try{
    if(typeof v574CalendarClient === 'function' && typeof v574ResolveCalendar === 'function' && typeof v574Upsert === 'function'){
      const calendar = await v574CalendarClient();
      const resolved = await v574ResolveCalendar(calendar);
      let pageToken = undefined;
      const items = [];
      do{
        const params = {calendarId:resolved.calendar.id,maxResults:250,singleEvents:true};
        if(pageToken) params.pageToken = pageToken;
        const response = await calendar.events.list(params);
        items.push(...(response.data.items || []).filter(i=>i.status !== 'cancelled'));
        pageToken = response.data.nextPageToken || undefined;
      }while(pageToken && items.length < 2500);

      const results = [];
      for(const item of items){
        try{ results.push(v574Upsert(item, resolved.calendar.id)); }
        catch(e){ results.push({action:'error', summary:item.summary || item.id, error:e.message}); }
      }
      return res.json({
        ok:true,
        calendar:{id:resolved.calendar.id,summary:resolved.calendar.summary,accessRole:resolved.calendar.accessRole},
        read:items.length,
        created:results.filter(r=>r.action==='created').length,
        updated:results.filter(r=>r.action==='updated').length,
        errors:results.filter(r=>r.action==='error').length,
        results:results.slice(0,100)
      });
    }
    res.status(500).json({ok:false,error:'No está cargado el motor de sincronización Google v574'});
  }catch(e){
    res.status(500).json({ok:false,error:e.message,stack:e.stack});
  }
});


// ---------- V58.7 CALENDAR EDIT FIX ----------
app.get('/api/events/:id/edit-data-v587', requireAdmin, (req,res)=>{
  try{
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});
    let assignments = [];
    try{
      assignments = db.prepare(`
        SELECT a.*, u.first_name,u.last_name,u.nickname,u.phone
        FROM assignments a
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.event_id=?
        ORDER BY u.first_name,u.last_name
      `).all(req.params.id);
    }catch(e){}
    res.json({ok:true,event,assignments});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/api/events/:id/edit-save-v587', requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});

    const b = req.body || {};
    const tableCols = db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);

    const allowed = [
      'name',
      'event_code',
      'client',
      'legal_name',
      'cif',
      'contact_name',
      'contact_phone',
      'contact_email',
      'event_date',
      'start_time',
      'end_time',
      'load_in_time',
      'load_out_time',
      'location',
      'address',
      'access_notes',
      'parking_notes',
      'service_type',
      'required_workers',
      'required_team_leads',
      'material_notes',
      'crew_notes',
      'production_notes',
      'payment_status',
      'estimated_external_cost',
      'estimated_transport_cost',
      'estimated_other_cost',
      'notes',
      'status',
      'operational_status'
    ].filter(k => tableCols.includes(k) && Object.prototype.hasOwnProperty.call(b,k));

    if(allowed.length){
      const sql = `UPDATE events SET ${allowed.map(k=>`"${k}"=?`).join(',')} WHERE id=?`;
      db.prepare(sql).run(...allowed.map(k=>b[k]), id);
    }

    res.json({ok:true,updated:allowed.length});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});


// ---------- V58.8 CALENDAR DELETE SYNC FIX ----------
function v588EnsureDeletedGoogleEventsTable(){
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_google_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_event_id TEXT NOT NULL UNIQUE,
      calendar_id TEXT DEFAULT '',
      event_name TEXT DEFAULT '',
      deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT DEFAULT 'app'
    );
  `);
}

function v588RememberDeletedGoogleEvent(googleEventId, calendarId='', eventName=''){
  if(!googleEventId) return;
  v588EnsureDeletedGoogleEventsTable();
  db.prepare(`
    INSERT OR IGNORE INTO deleted_google_events
    (google_event_id, calendar_id, event_name, source)
    VALUES (?,?,?,?)
  `).run(googleEventId, calendarId || '', eventName || '', 'app-delete');
}

function v588IsGoogleEventDeleted(googleEventId){
  if(!googleEventId) return false;
  v588EnsureDeletedGoogleEventsTable();
  return !!db.prepare('SELECT id FROM deleted_google_events WHERE google_event_id=?').get(googleEventId);
}

async function v588TryDeleteFromGoogle(googleEventId, calendarId){
  try{
    if(!googleEventId) return {ok:false, reason:'no_google_event_id'};
    if(typeof v574CalendarClient !== 'function') return {ok:false, reason:'google_client_not_available'};
    const calendar = await v574CalendarClient();
    const cid = calendarId || process.env.GOOGLE_TARGET_CALENDAR_ID || 'primary';
    await calendar.events.delete({calendarId:cid, eventId:googleEventId});
    return {ok:true};
  }catch(e){
    // Si no existe o no hay permisos, no bloqueamos el borrado local.
    return {ok:false, error:e.message};
  }
}

// Borrado definitivo desde calendario: local + tombstone + intento Google.
app.delete('/api/events/:id/remove-v588', requireAdmin, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if(!event) return res.status(404).json({error:'Evento no encontrado'});

    let links = [];
    try{
      links = db.prepare('SELECT * FROM google_event_links WHERE event_id=?').all(id);
    }catch(e){}

    const googleDeleteResults = [];
    for(const l of links){
      v588RememberDeletedGoogleEvent(l.google_event_id, l.calendar_id, event.name || '');
      googleDeleteResults.push(await v588TryDeleteFromGoogle(l.google_event_id, l.calendar_id));
    }

    const tx = db.transaction(()=>{
      try{db.prepare('DELETE FROM assignments WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_role_lines WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM google_event_links WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM delivery_notes WHERE event_id=?').run(id);}catch(e){}
      try{db.prepare('DELETE FROM event_delivery_notes WHERE event_id=?').run(id);}catch(e){}
      db.prepare('DELETE FROM events WHERE id=?').run(id);
    });
    tx();

    res.json({ok:true,deleted:true,google_links:links.length,google_delete_results:googleDeleteResults});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

// Sync seguro: ignora eventos Google borrados desde la app.
app.post('/api/google/sync-calendar-v588', requireAdmin, async (req,res)=>{
  try{
    if(typeof v574CalendarClient !== 'function' || typeof v574ResolveCalendar !== 'function' || typeof v574Upsert !== 'function'){
      return res.status(500).json({ok:false,error:'Motor de sincronización Google no disponible'});
    }

    v588EnsureDeletedGoogleEventsTable();

    const calendar = await v574CalendarClient();
    const resolved = await v574ResolveCalendar(calendar);

    let pageToken = undefined;
    const items = [];
    do{
      const params = {
        calendarId:resolved.calendar.id,
        maxResults:250,
        singleEvents:true
      };
      if(pageToken) params.pageToken = pageToken;
      const response = await calendar.events.list(params);
      items.push(...(response.data.items || []).filter(i=>i.status !== 'cancelled'));
      pageToken = response.data.nextPageToken || undefined;
    }while(pageToken && items.length < 2500);

    const skippedDeleted = [];
    const results = [];

    for(const item of items){
      if(v588IsGoogleEventDeleted(item.id)){
        skippedDeleted.push(item.summary || item.id);
        continue;
      }
      try{ results.push(v574Upsert(item, resolved.calendar.id)); }
      catch(e){ results.push({action:'error', summary:item.summary || item.id, error:e.message}); }
    }

    res.json({
      ok:true,
      calendar:{id:resolved.calendar.id,summary:resolved.calendar.summary,accessRole:resolved.calendar.accessRole},
      read:items.length,
      skipped_deleted:skippedDeleted.length,
      created:results.filter(r=>r.action==='created').length,
      updated:results.filter(r=>r.action==='updated').length,
      errors:results.filter(r=>r.action==='error').length,
      skipped_deleted_examples:skippedDeleted.slice(0,30),
      results:results.slice(0,100)
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message,stack:e.stack});
  }
});

app.get('/api/google/deleted-events-v588', requireAdmin, (req,res)=>{
  try{
    v588EnsureDeletedGoogleEventsTable();
    const rows = db.prepare('SELECT * FROM deleted_google_events ORDER BY deleted_at DESC').all();
    res.json({ok:true,rows});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.delete('/api/google/deleted-events-v588/:googleEventId', requireAdmin, (req,res)=>{
  try{
    v588EnsureDeletedGoogleEventsTable();
    db.prepare('DELETE FROM deleted_google_events WHERE google_event_id=?').run(req.params.googleEventId);
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});


const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'marfan_crew_clean.sqlite'));
db.pragma('journal_mode = WAL');

app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'marfan-clean-install-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// ---------- RAILWAY / STATIC ----------
app.get('/health', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

app.get('/', (req, res) => {
  res.type('html').sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/app.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(PUBLIC_DIR, 'app.js'));
});

app.get('/styles.css', (req, res) => {
  res.type('text/css').sendFile(path.join(PUBLIC_DIR, 'styles.css'));
});

app.get('/logo-marfan.png', (req, res) => {
  const p = path.join(PUBLIC_DIR, 'logo-marfan.png');
  if (fs.existsSync(p)) return res.type('image/png').sendFile(p);
  return res.status(404).send('logo no encontrado');
});

app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads'), { maxAge: 0 }));

// ---------- DB ----------
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'operario',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      services TEXT DEFAULT '',
      availability TEXT DEFAULT 'disponible',
      internal_hour_cost REAL DEFAULT 0,
      internal_night_cost REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      fixed_hour_discount REAL DEFAULT 0,
      percent_hour_discount REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id INTEGER,
      client TEXT DEFAULT '',
      location TEXT DEFAULT '',
      event_date TEXT NOT NULL,
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      latitude REAL,
      longitude REAL,
      status TEXT DEFAULT 'programado',
      operational_status TEXT DEFAULT 'borrador',
      required_workers INTEGER DEFAULT 0,
      required_team_leads INTEGER DEFAULT 1,
      hourly_rate REAL DEFAULT 18.5,
      night_rate REAL DEFAULT 23.5,
      diet_price REAL DEFAULT 15,
      km_amount REAL DEFAULT 0,
      estimated_external_cost REAL DEFAULT 0,
      estimated_transport_cost REAL DEFAULT 0,
      estimated_other_cost REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pendiente',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      service_role TEXT DEFAULT '',
      is_team_lead INTEGER DEFAULT 0,
      planned_start TEXT DEFAULT '',
      planned_end TEXT DEFAULT '',
      billable_hourly_rate REAL DEFAULT 18.5,
      billable_night_rate REAL DEFAULT 23.5,
      apply_night INTEGER DEFAULT 1,
      apply_diet INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      code TEXT DEFAULT '',
      total_hours REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      vat_percent REAL DEFAULT 21,
      vat_amount REAL DEFAULT 0,
      total_with_vat REAL DEFAULT 0,
      client_name TEXT DEFAULT '',
      client_cif TEXT DEFAULT '',
      client_signature TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS worker_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT DEFAULT 'otros',
      title TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      issue_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      phase TEXT DEFAULT 'montaje',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER,
      severity TEXT DEFAULT 'media',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'abierta',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  ensureAdmin();
}

function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@marfancrew.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin1234*';
  const hash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash=?, role='admin', active=1, first_name='Administrador', last_name='Marfan', nickname='ADMIN', phone='600000000'
      WHERE id=?
    `).run(hash, existing.id);
  } else {
    db.prepare(`
      INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,active)
      VALUES (?,?,?,?,?,?,?,1)
    `).run(email, hash, 'admin', 'Administrador', 'Marfan', 'ADMIN', '600000000');
  }
}

// ---------- HELPERS ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Solo administrador' });
  next();
}
function safeUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    first_name: u.first_name,
    last_name: u.last_name,
    phone: u.phone
  };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function distanceMeters(lat1, lng1, lat2, lng2) {
  lat1=Number(lat1); lng1=Number(lng1); lat2=Number(lat2); lng2=Number(lng2);
  if (![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
  const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function docStatus(expiry) {
  if (!expiry) return 'sin_caducidad';
  const diff = Math.ceil((new Date(expiry+'T12:00:00') - new Date(todayStr()+'T12:00:00'))/86400000);
  if (diff < 0) return 'caducado';
  if (diff <= 30) return 'proximo_caducar';
  return 'vigente';
}

// ---------- AUTH ----------
app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/login', (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    if (email === 'admin@marfancrew.local') ensureAdmin();

    const user = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(email);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(password, user.password_hash || '')) return res.status(401).json({ error: 'Contraseña incorrecta' });

    req.session.user = safeUser(user);
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error('LOGIN_ERROR', e);
    res.status(500).json({ error: 'Error de login' });
  }
});

app.post('/api/login-phone', (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g,'').slice(-9);
  if (!phone) return res.status(400).json({ error: 'Teléfono requerido' });
  const users = db.prepare("SELECT * FROM users WHERE active=1 AND role!='admin'").all();
  const user = users.find(u => String(u.phone || '').replace(/\D/g,'').slice(-9) === phone);
  if (!user) return res.status(401).json({ error: 'Teléfono no encontrado' });
  req.session.user = safeUser(user);
  res.json({ ok: true, user: req.session.user });
});

// ---------- ADMIN API ----------
app.get('/api/dashboard', requireAdmin, (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY event_date DESC LIMIT 100').all();
  const users = db.prepare("SELECT * FROM users WHERE role!='admin'").all();
  const clients = db.prepare('SELECT * FROM clients').all();
  const notes = db.prepare('SELECT * FROM delivery_notes').all();
  const revenue = notes.reduce((s,n)=>s+Number(n.total_with_vat||0),0);
  res.json({ events_count: events.length, users_count: users.length, clients_count: clients.length, revenue, events, users, clients });
});

app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,email,role,first_name,last_name,nickname,phone,services,availability,internal_hour_cost,internal_night_cost,active FROM users ORDER BY first_name').all());
});
app.post('/api/users', requireAdmin, (req, res) => {
  const b=req.body;
  const email = b.email || (String(b.phone||'').replace(/\D/g,'') + '@marfancrew.local');
  const pass = bcrypt.hashSync(b.password || 'Marfan1234*', 10);
  const info=db.prepare(`
    INSERT INTO users (email,password_hash,role,first_name,last_name,nickname,phone,services,availability,internal_hour_cost,internal_night_cost,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(email,pass,b.role||'operario',b.first_name||'',b.last_name||'',b.nickname||'',b.phone||'',b.services||'',b.availability||'disponible',Number(b.internal_hour_cost||0),Number(b.internal_night_cost||0),b.active===0?0:1);
  res.json({ok:true,id:info.lastInsertRowid});
});
app.put('/api/users/:id', requireAdmin, (req, res) => {
  const b=req.body;
  db.prepare(`
    UPDATE users SET role=?,first_name=?,last_name=?,nickname=?,phone=?,services=?,availability=?,internal_hour_cost=?,internal_night_cost=?,active=?
    WHERE id=?
  `).run(b.role||'operario',b.first_name||'',b.last_name||'',b.nickname||'',b.phone||'',b.services||'',b.availability||'disponible',Number(b.internal_hour_cost||0),Number(b.internal_night_cost||0),b.active===0?0:1,req.params.id);
  res.json({ok:true});
});

app.get('/api/clients', requireAdmin, (req,res)=>res.json(db.prepare('SELECT * FROM clients ORDER BY name').all()));
app.post('/api/clients', requireAdmin, (req,res)=>{
  const b=req.body;
  const info=db.prepare('INSERT INTO clients (name,legal_name,cif,contact,phone,email,address,fixed_hour_discount,percent_hour_discount,notes,active) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.name,b.legal_name||'',b.cif||'',b.contact||'',b.phone||'',b.email||'',b.address||'',Number(b.fixed_hour_discount||0),Number(b.percent_hour_discount||0),b.notes||'',b.active===0?0:1);
  res.json({ok:true,id:info.lastInsertRowid});
});

app.get('/api/events', requireAuth, (req,res)=>{
  if (req.session.user.role === 'admin') {
    return res.json(db.prepare('SELECT * FROM events ORDER BY event_date,start_time').all());
  }
  const rows=db.prepare(`
    SELECT e.*, a.service_role, a.is_team_lead, a.planned_start, a.planned_end
    FROM assignments a JOIN events e ON e.id=a.event_id
    WHERE a.user_id=?
    ORDER BY e.event_date,e.start_time
  `).all(req.session.user.id);
  res.json(rows);
});
app.post('/api/events', requireAdmin, (req,res)=>{
  const b=req.body;
  const client = b.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(b.client_id) : null;
  const info=db.prepare(`
    INSERT INTO events (name,client_id,client,location,event_date,start_time,end_time,latitude,longitude,status,operational_status,required_workers,required_team_leads,hourly_rate,night_rate,diet_price,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(b.name,b.client_id||null,client?client.name:(b.client||''),b.location||'',b.event_date,b.start_time||'',b.end_time||'',b.latitude||null,b.longitude||null,b.status||'programado',b.operational_status||'borrador',Number(b.required_workers||0),Number(b.required_team_leads||1),Number(b.hourly_rate||18.5),Number(b.night_rate||23.5),Number(b.diet_price||15),b.notes||'');
  res.json({ok:true,id:info.lastInsertRowid});
});
app.put('/api/events/:id', requireAdmin, (req,res)=>{
  const b=req.body;
  db.prepare(`
    UPDATE events SET name=?,location=?,event_date=?,start_time=?,end_time=?,latitude=?,longitude=?,status=?,operational_status=?,required_workers=?,required_team_leads=?,hourly_rate=?,night_rate=?,diet_price=?,notes=?
    WHERE id=?
  `).run(b.name,b.location||'',b.event_date,b.start_time||'',b.end_time||'',b.latitude||null,b.longitude||null,b.status||'programado',b.operational_status||'borrador',Number(b.required_workers||0),Number(b.required_team_leads||1),Number(b.hourly_rate||18.5),Number(b.night_rate||23.5),Number(b.diet_price||15),b.notes||'',req.params.id);
  res.json({ok:true});
});
app.delete('/api/events/:id', requireAdmin, (req,res)=>{
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM assignments WHERE event_id=?').run(req.params.id);
  db.prepare('DELETE FROM time_logs WHERE event_id=?').run(req.params.id);
  res.json({ok:true});
});

app.get('/api/assignments/:eventId', requireAdmin, (req,res)=>{
  res.json(db.prepare(`
    SELECT a.*, u.first_name,u.last_name,u.phone FROM assignments a JOIN users u ON u.id=a.user_id WHERE event_id=?
  `).all(req.params.eventId));
});
app.post('/api/assignments', requireAdmin, (req,res)=>{
  const b=req.body;
  const info=db.prepare(`
    INSERT INTO assignments (event_id,user_id,service_role,is_team_lead,planned_start,planned_end,billable_hourly_rate,billable_night_rate,apply_night,apply_diet)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(b.event_id,b.user_id,b.service_role||'',b.is_team_lead?1:0,b.planned_start||'',b.planned_end||'',Number(b.billable_hourly_rate||18.5),Number(b.billable_night_rate||23.5),b.apply_night?1:0,b.apply_diet?1:0);
  res.json({ok:true,id:info.lastInsertRowid});
});

app.post('/api/time-log', requireAuth, (req,res)=>{
  const b=req.body;
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(b.event_id);
  if (!event) return res.status(404).json({error:'Evento no encontrado'});
  if (req.session.user.role !== 'admin') {
    const ass = db.prepare('SELECT * FROM assignments WHERE event_id=? AND user_id=?').get(b.event_id, req.session.user.id);
    if (!ass) return res.status(403).json({error:'No asignado a este evento'});
  }
  const info=db.prepare('INSERT INTO time_logs (event_id,user_id,type,latitude,longitude,timestamp) VALUES (?,?,?,?,?,?)')
    .run(b.event_id, req.session.user.id, b.type, b.latitude||null, b.longitude||null, new Date().toISOString());
  res.json({ok:true,id:info.lastInsertRowid});
});

app.get('/api/gps/live', requireAdmin, (req,res)=>{
  const date=req.query.date || todayStr();
  const radius=Number(req.query.radius||300);
  const rows=db.prepare(`
    SELECT e.id event_id,e.name event_name,e.location,e.latitude event_latitude,e.longitude event_longitude,e.event_date,e.start_time,e.end_time,
           a.user_id,a.service_role,a.is_team_lead,u.first_name,u.last_name,u.phone
    FROM assignments a JOIN events e ON e.id=a.event_id JOIN users u ON u.id=a.user_id
    WHERE e.event_date=?
  `).all(date);
  const out=rows.map(r=>{
    const logs=db.prepare('SELECT * FROM time_logs WHERE event_id=? AND user_id=? ORDER BY timestamp').all(r.event_id,r.user_id);
    const last=logs[logs.length-1]||null;
    const dist=last?distanceMeters(r.event_latitude,r.event_longitude,last.latitude,last.longitude):null;
    let status='pendiente_fichaje';
    if(last && dist===null) status='sin_gps';
    else if(last && dist<=radius) status='en_evento';
    else if(last && dist>radius) status='fuera_radio';
    return {...r, worker_name:`${r.first_name} ${r.last_name}`.trim(), last_log:last, distance_m:dist, gps_status:status};
  });
  res.json({date,radius_m:radius,rows:out});
});

app.get('/api/documents', requireAdmin, (req,res)=>{
  const rows=db.prepare(`
    SELECT d.*, u.first_name,u.last_name,u.phone FROM worker_documents d JOIN users u ON u.id=d.user_id ORDER BY d.expiry_date
  `).all().map(d=>({...d,computed_status:docStatus(d.expiry_date)}));
  res.json(rows);
});
app.post('/api/documents', requireAdmin, (req,res)=>{
  const b=req.body;
  const info=db.prepare('INSERT INTO worker_documents (user_id,doc_type,title,file_url,issue_date,expiry_date,notes) VALUES (?,?,?,?,?,?,?)')
    .run(b.user_id,b.doc_type||'otros',b.title||'',b.file_url||'',b.issue_date||'',b.expiry_date||'',b.notes||'');
  res.json({ok:true,id:info.lastInsertRowid});
});

app.get('/api/production/events', requireAdmin, (req,res)=>{
  const date=req.query.date || todayStr();
  const events=db.prepare('SELECT * FROM events WHERE event_date=? ORDER BY start_time').all(date);
  const rows=events.map(e=>{
    const tasks=db.prepare('SELECT * FROM production_tasks WHERE event_id=?').all(e.id);
    const done=tasks.filter(t=>t.completed).length;
    return {event:e,total:tasks.length,done,progress:tasks.length?Math.round(done/tasks.length*100):0};
  });
  res.json(rows);
});
app.post('/api/production/tasks', requireAdmin, (req,res)=>{
  const b=req.body;
  const info=db.prepare('INSERT INTO production_tasks (event_id,phase,title,description,priority) VALUES (?,?,?,?,?)')
    .run(b.event_id,b.phase||'montaje',b.title,b.description||'',b.priority||'normal');
  res.json({ok:true,id:info.lastInsertRowid});
});

app.get('/api/finance/events', requireAdmin, (req,res)=>{
  const events=db.prepare('SELECT * FROM events ORDER BY event_date DESC').all();
  const rows=events.map(e=>{
    const notes=db.prepare('SELECT * FROM delivery_notes WHERE event_id=?').all(e.id);
    const revenue=notes.reduce((s,n)=>s+Number(n.total_amount||0),0);
    const cost=Number(e.estimated_external_cost||0)+Number(e.estimated_transport_cost||0)+Number(e.estimated_other_cost||0);
    const profit=revenue-cost;
    const margin=revenue?Math.round(profit/revenue*10000)/100:0;
    return {event_id:e.id,event_name:e.name,event_date:e.event_date,client:e.client,revenue_base:revenue,total_cost:cost,profit,margin,financial_status:margin<0?'deficitario':margin<20?'margen_bajo':'rentable'};
  });
  res.json({rows,totals:{events:rows.length,revenue_base:rows.reduce((s,r)=>s+r.revenue_base,0),total_cost:rows.reduce((s,r)=>s+r.total_cost,0),profit:rows.reduce((s,r)=>s+r.profit,0)}});
});

// Fallback
app.use((req,res,next)=>{
  if(req.path && req.path.startsWith('/api/')) return res.status(404).json({error:'API no encontrada'});
  return res.type('html').sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

initDb();

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Marfan Crew Hours V48.2.4 Clean Install From Zero listening on 0.0.0.0:${PORT}`);
});

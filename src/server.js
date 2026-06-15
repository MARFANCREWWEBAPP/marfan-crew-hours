const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();
const { migrate, run, get, all } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended:true, limit:'8mb' }));
app.use(express.static(path.join(__dirname, '../public')));

function sign(user){ return jwt.sign({ id:user.id, role:user.role, name:user.name }, JWT_SECRET, { expiresIn:'24h' }); }
function auth(req,res,next){ const t=(req.headers.authorization||'').replace('Bearer ',''); if(!t) return res.status(401).json({error:'No autorizado'}); try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ res.status(401).json({error:'Token inválido'}); } }
function allow(...roles){ return (req,res,next)=> roles.includes(req.user.role) ? next() : res.status(403).json({error:'Permiso denegado'}); }
const adminRoles=['super_admin','admin'];
const adminTeam=[...adminRoles,'team_lead'];

app.post('/api/auth/login', async (req,res)=>{
  const { login, password } = req.body;
  const user = await get('SELECT * FROM users WHERE (email=? OR phone=?) AND active=1', [login, login]);
  if(!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({error:'Credenciales incorrectas'});
  res.json({token:sign(user), user:{id:user.id,name:user.name,role:user.role,email:user.email,phone:user.phone}});
});
app.get('/api/me', auth, async (req,res)=> res.json(await get('SELECT id,name,email,phone,role,position,active FROM users WHERE id=?',[req.user.id])));

app.get('/api/dashboard', auth, allow(...adminTeam), async (req,res)=>{
  const today=new Date().toISOString().slice(0,10);
  const [users,operators,clients,eventsToday,openEntries,monthRevenue,doneEvents,totalEvents] = await Promise.all([
    get('SELECT COUNT(*) total FROM users WHERE active=1'),
    get("SELECT COUNT(*) total FROM users WHERE role IN ('operator','team_lead') AND active=1"),
    get('SELECT COUNT(*) total FROM clients WHERE COALESCE(active,1)=1'),
    get('SELECT COUNT(*) total FROM events WHERE date=?',[today]),
    get('SELECT COUNT(*) total FROM time_entries WHERE check_in IS NOT NULL AND check_out IS NULL'),
    get("SELECT COALESCE(SUM(budget),0) total FROM events WHERE substr(date,1,7)=substr(date('now'),1,7)"),
    get("SELECT COUNT(*) total FROM events WHERE status IN ('done','realizado')"),
    get('SELECT COUNT(*) total FROM events')
  ]);
  const nextEvents=await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, COUNT(a.id) assigned_count FROM events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN event_assignments a ON a.event_id=e.id WHERE e.date>=? GROUP BY e.id ORDER BY e.date,e.start_time LIMIT 10`,[today]);
  res.json({users:users.total,operators:operators.total,clients:clients.total,eventsToday:eventsToday.total,activeWorkers:openEntries.total,monthRevenue:monthRevenue.total,doneEvents:doneEvents.total,totalEvents:totalEvents.total,nextEvents});
});

app.get('/api/users', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT id,name,email,phone,role,active,hourly_rate,position,dni,emergency_phone,notes,created_at FROM users ORDER BY role,name')));
app.post('/api/users', auth, allow('super_admin'), async (req,res)=>{
  const {name,email,phone,password,role,hourly_rate=0,position='',dni='',emergency_phone='',notes=''}=req.body;
  if(!name||!password||!role) return res.status(400).json({error:'Nombre, contraseña y rol son obligatorios'});
  if(!['super_admin','admin','team_lead','operator','client'].includes(role)) return res.status(400).json({error:'Rol inválido'});
  const hash=await bcrypt.hash(password,10);
  const r=await run('INSERT INTO users(name,email,phone,password_hash,role,hourly_rate,position,dni,emergency_phone,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',[name,email||null,phone||null,hash,role,hourly_rate,position,dni,emergency_phone,notes]);
  res.status(201).json(await get('SELECT id,name,email,phone,role,active,hourly_rate,position FROM users WHERE id=?',[r.id]));
});
app.put('/api/users/:id', auth, allow('super_admin'), async (req,res)=>{
  const {name,email,phone,role,active=1,hourly_rate=0,position='',dni='',emergency_phone='',notes=''}=req.body;
  await run('UPDATE users SET name=?,email=?,phone=?,role=?,active=?,hourly_rate=?,position=?,dni=?,emergency_phone=?,notes=? WHERE id=?',[name,email||null,phone||null,role,active?1:0,hourly_rate,position,dni,emergency_phone,notes,req.params.id]);
  res.json(await get('SELECT id,name,email,phone,role,active,hourly_rate,position FROM users WHERE id=?',[req.params.id]));
});
app.post('/api/users/:id/reset-password', auth, allow('super_admin'), async (req,res)=>{ const {password}=req.body; if(!password||password.length<8) return res.status(400).json({error:'La contraseña debe tener mínimo 8 caracteres'}); await run('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(password,10),req.params.id]); res.json({ok:true}); });

app.get('/api/clients', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM clients ORDER BY name')));
app.post('/api/clients', auth, allow(...adminRoles), async (req,res)=>{ const {name,legal_name='',cif='',contact_name='',email='',phone='',address='',province='',notes=''}=req.body; const r=await run('INSERT INTO clients(name,legal_name,cif,contact_name,email,phone,address,province,notes) VALUES(?,?,?,?,?,?,?,?,?)',[name,legal_name,cif,contact_name,email,phone,address,province,notes]); res.status(201).json(await get('SELECT * FROM clients WHERE id=?',[r.id])); });
app.put('/api/clients/:id', auth, allow(...adminRoles), async (req,res)=>{ const {name,legal_name='',cif='',contact_name='',email='',phone='',address='',province='',notes='',active=1}=req.body; await run('UPDATE clients SET name=?,legal_name=?,cif=?,contact_name=?,email=?,phone=?,address=?,province=?,notes=?,active=? WHERE id=?',[name,legal_name,cif,contact_name,email,phone,address,province,notes,active?1:0,req.params.id]); res.json(await get('SELECT * FROM clients WHERE id=?',[req.params.id])); });

app.get('/api/events', auth, async (req,res)=> res.json(await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, COUNT(a.id) assigned_count FROM events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN event_assignments a ON a.event_id=e.id GROUP BY e.id ORDER BY e.date DESC,e.start_time DESC`)));
app.post('/api/events', auth, allow(...adminTeam), async (req,res)=>{
  const b=req.body; const r=await run(`INSERT INTO events(title,event_code,client_id,client_name,location,address,google_maps_link,date,start_time,end_time,load_in_time,load_out_time,service_type,status,operational_status,budget,external_cost,transport_cost,other_cost,notes,access_notes,parking_notes,material_notes,crew_notes,production_notes,lat,lng) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[b.title,b.event_code||'',b.client_id||null,b.client_name||'',b.location||'',b.address||'',b.google_maps_link||'',b.date,b.start_time,b.end_time,b.load_in_time||'',b.load_out_time||'',b.service_type||'',b.status||'planned',b.operational_status||'',b.budget||0,b.external_cost||0,b.transport_cost||0,b.other_cost||0,b.notes||'',b.access_notes||'',b.parking_notes||'',b.material_notes||'',b.crew_notes||'',b.production_notes||'',b.lat||null,b.lng||null]);
  for(const userId of (b.assignments||[])) await run('INSERT OR IGNORE INTO event_assignments(event_id,user_id,hourly_rate) VALUES(?,?,(SELECT hourly_rate FROM users WHERE id=?))',[r.id,userId,userId]);
  res.status(201).json(await get('SELECT * FROM events WHERE id=?',[r.id]));
});
app.put('/api/events/:id', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; await run(`UPDATE events SET title=?,event_code=?,client_id=?,location=?,address=?,google_maps_link=?,date=?,start_time=?,end_time=?,load_in_time=?,load_out_time=?,service_type=?,status=?,operational_status=?,budget=?,external_cost=?,transport_cost=?,other_cost=?,notes=?,access_notes=?,parking_notes=?,material_notes=?,crew_notes=?,production_notes=?,lat=?,lng=? WHERE id=?`,[b.title,b.event_code||'',b.client_id||null,b.location||'',b.address||'',b.google_maps_link||'',b.date,b.start_time,b.end_time,b.load_in_time||'',b.load_out_time||'',b.service_type||'',b.status||'planned',b.operational_status||'',b.budget||0,b.external_cost||0,b.other_cost||0,b.transport_cost||0,b.notes||'',b.access_notes||'',b.parking_notes||'',b.material_notes||'',b.crew_notes||'',b.production_notes||'',b.lat||null,b.lng||null,req.params.id]); res.json(await get('SELECT * FROM events WHERE id=?',[req.params.id])); });
app.get('/api/events/:id/assignments', auth, async (req,res)=> res.json(await all(`SELECT a.*, u.name, u.role, u.phone FROM event_assignments a JOIN users u ON u.id=a.user_id WHERE event_id=? ORDER BY u.name`,[req.params.id])));
app.post('/api/events/:id/assignments', auth, allow(...adminTeam), async (req,res)=>{ const {user_ids=[]}=req.body; await run('DELETE FROM event_assignments WHERE event_id=?',[req.params.id]); for(const userId of user_ids) await run('INSERT OR IGNORE INTO event_assignments(event_id,user_id,hourly_rate) VALUES(?,?,(SELECT hourly_rate FROM users WHERE id=?))',[req.params.id,userId,userId]); res.json({ok:true}); });

app.get('/api/rates', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT * FROM rates ORDER BY role')));
app.post('/api/rates', auth, allow(...adminRoles), async (req,res)=>{ const {role,day_rate=0,night_rate=0,active=1}=req.body; const r=await run('INSERT INTO rates(role,day_rate,night_rate,active) VALUES(?,?,?,?)',[role,day_rate,night_rate,active?1:0]); res.status(201).json(await get('SELECT * FROM rates WHERE id=?',[r.id])); });
app.get('/api/documents', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM documents ORDER BY created_at DESC')));
app.post('/api/documents', auth, allow(...adminRoles), async (req,res)=>{ const {title,type='',owner_type='',owner_id=null,expiry_date='',notes=''}=req.body; const r=await run('INSERT INTO documents(title,type,owner_type,owner_id,expiry_date,notes) VALUES(?,?,?,?,?,?)',[title,type,owner_type,owner_id,expiry_date,notes]); res.status(201).json(await get('SELECT * FROM documents WHERE id=?',[r.id])); });
app.get('/api/delivery-notes', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM delivery_notes ORDER BY event_date DESC, id DESC')));
app.post('/api/delivery-notes/from-event/:id', auth, allow(...adminTeam), async (req,res)=>{ const ev=await get('SELECT e.*, COALESCE(c.name,e.client_name) client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=?',[req.params.id]); if(!ev) return res.status(404).json({error:'Evento no encontrado'}); const total=Number(ev.budget||0); const vat=total*1.21; const r=await run('INSERT INTO delivery_notes(event_id,number,client_name,event_date,grand_total,grand_total_vat) VALUES(?,?,?,?,?,?)',[ev.id,`ALB-${ev.id}-${Date.now()}`,ev.client_name||'',ev.date,total,vat]); res.status(201).json(await get('SELECT * FROM delivery_notes WHERE id=?',[r.id])); });

app.post('/api/time/check-in', auth, async (req,res)=>{ const {event_id,lat=null,lng=null,notes=''}=req.body; const existing=await get('SELECT id FROM time_entries WHERE event_id=? AND user_id=? AND check_out IS NULL',[event_id,req.user.id]); if(existing) return res.status(409).json({error:'Ya tienes un fichaje abierto'}); const r=await run('INSERT INTO time_entries(event_id,user_id,check_in,check_in_lat,check_in_lng,notes) VALUES(?,?,datetime("now"),?,?,?)',[event_id,req.user.id,lat,lng,notes]); res.status(201).json(await get('SELECT * FROM time_entries WHERE id=?',[r.id])); });
app.post('/api/time/check-out', auth, async (req,res)=>{ const {entry_id,lat=null,lng=null,break_minutes=0,notes='',client_signature_name='',client_signature_dni=''}=req.body; await run('UPDATE time_entries SET check_out=datetime("now"),check_out_lat=?,check_out_lng=?,break_minutes=?,notes=?,client_signature_name=?,client_signature_dni=? WHERE id=? AND user_id=?',[lat,lng,break_minutes,notes,client_signature_name,client_signature_dni,entry_id,req.user.id]); res.json(await get('SELECT * FROM time_entries WHERE id=?',[entry_id])); });
app.get('/api/time/entries', auth, allow(...adminTeam), async (req,res)=> res.json(await all(`SELECT t.*, u.name user_name, e.title event_title, e.date FROM time_entries t JOIN users u ON u.id=t.user_id JOIN events e ON e.id=t.event_id ORDER BY t.created_at DESC LIMIT 500`)));
app.get('/api/my-calendar', auth, async (req,res)=> res.json(await all(`SELECT e.* FROM events e JOIN event_assignments a ON a.event_id=e.id WHERE a.user_id=? ORDER BY e.date,e.start_time`,[req.user.id])));

app.get('/api/settings', auth, allow(...adminRoles), async (req,res)=>{ const rows=await all('SELECT key,value FROM settings ORDER BY key'); res.json(Object.fromEntries(rows.map(r=>[r.key,r.value]))); });
app.post('/api/settings', auth, allow('super_admin'), async (req,res)=>{ for(const [k,v] of Object.entries(req.body||{})) await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[k,String(v)]); res.json({ok:true}); });
app.get('/api/reports/summary', auth, allow(...adminTeam), async (req,res)=>{ const rows=await all(`SELECT substr(date,1,7) month, COUNT(*) events, COALESCE(SUM(budget),0) amount, COALESCE(SUM(external_cost+transport_cost+other_cost),0) cost FROM events GROUP BY substr(date,1,7) ORDER BY month DESC LIMIT 12`); res.json(rows.map(r=>({...r, profit:Number(r.amount||0)-Number(r.cost||0)}))); });
app.get('/api/health', (req,res)=> res.json({ok:true, app:'Marfan Crew 2.0.2', clean:true, legacyMenusMigrated:true}));

migrate().then(async()=>{ const email=process.env.DEFAULT_ADMIN_EMAIL||'admin@marfan.local'; const pass=process.env.DEFAULT_ADMIN_PASSWORD||'Admin1234!'; const exists=await get('SELECT id FROM users WHERE email=?',[email]); if(!exists) await run('INSERT INTO users(name,email,password_hash,role,active,position) VALUES(?,?,?,?,?,?)',['Super Admin',email,await bcrypt.hash(pass,10),'super_admin',1,'Dirección']); app.listen(PORT,()=>console.log(`Marfan Crew 2.0.2 running on ${PORT}`)); }).catch(err=>{ console.error(err); process.exit(1); });

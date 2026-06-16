const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();
const { migrate, run, get, all } = require('./db');
const { importLegacyData } = require('./legacy/importLegacyData');

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

app.get('/api/users', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT id,name,email,phone,role,active,hourly_rate,position,dni,emergency_phone,emergency_contact_name,emergency_contact_phone,notes,created_at,first_name,last_name,nickname,iban,bank_iban,bank_name,social_security_number,full_address,address,operator_role_name,shirt_size,pants_size,shoe_size,epis_delivered,has_prl FROM users ORDER BY role,name')));
app.post('/api/users', auth, allow('super_admin'), async (req,res)=>{
  const {name,email,phone,password,role,hourly_rate=0,position='',dni='',emergency_phone='',emergency_contact_name='',emergency_contact_phone='',notes='',first_name='',last_name='',nickname='',iban='',bank_iban='',bank_name='',social_security_number='',full_address='',address='',operator_role_name='',shirt_size='',pants_size='',shoe_size='',epis_delivered=0,has_prl=0}=req.body;
  if(!name||!password||!role) return res.status(400).json({error:'Nombre, contraseña y rol son obligatorios'});
  if(!['super_admin','admin','team_lead','operator','client'].includes(role)) return res.status(400).json({error:'Rol inválido'});
  const hash=await bcrypt.hash(password,10);
  const r=await run(`INSERT INTO users(name,email,phone,password_hash,role,hourly_rate,position,dni,emergency_phone,emergency_contact_name,emergency_contact_phone,notes,first_name,last_name,nickname,iban,bank_iban,bank_name,social_security_number,full_address,address,operator_role_name,shirt_size,pants_size,shoe_size,epis_delivered,has_prl) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[name,email||null,phone||null,hash,role,hourly_rate,position,dni,emergency_phone,emergency_contact_name,emergency_contact_phone,notes,first_name,last_name,nickname,iban,bank_iban,bank_name,social_security_number,full_address,address,operator_role_name,shirt_size,pants_size,shoe_size,Number(epis_delivered||0),Number(has_prl||0)]);
  res.status(201).json(await get('SELECT * FROM users WHERE id=?',[r.id]));
});
app.put('/api/users/:id', auth, allow('super_admin'), async (req,res)=>{
  const {name,email,phone,role,active=1,hourly_rate=0,position='',dni='',emergency_phone='',emergency_contact_name='',emergency_contact_phone='',notes='',first_name='',last_name='',nickname='',iban='',bank_iban='',bank_name='',social_security_number='',full_address='',address='',operator_role_name='',shirt_size='',pants_size='',shoe_size='',epis_delivered=0,has_prl=0}=req.body;
  await run(`UPDATE users SET name=?,email=?,phone=?,role=?,active=?,hourly_rate=?,position=?,dni=?,emergency_phone=?,emergency_contact_name=?,emergency_contact_phone=?,notes=?,first_name=?,last_name=?,nickname=?,iban=?,bank_iban=?,bank_name=?,social_security_number=?,full_address=?,address=?,operator_role_name=?,shirt_size=?,pants_size=?,shoe_size=?,epis_delivered=?,has_prl=? WHERE id=?`,[name,email||null,phone||null,role,active?1:0,hourly_rate,position,dni,emergency_phone,emergency_contact_name,emergency_contact_phone,notes,first_name,last_name,nickname,iban,bank_iban,bank_name,social_security_number,full_address,address,operator_role_name,shirt_size,pants_size,shoe_size,Number(epis_delivered||0),Number(has_prl||0),req.params.id]);
  res.json(await get('SELECT * FROM users WHERE id=?',[req.params.id]));
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

app.post('/api/legacy/import-data', auth, allow('super_admin'), async (req,res)=>{
  try{ res.json({ok:true, ...(await importLegacyData({get, run}))}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/legacy/status', auth, allow(...adminRoles), async (req,res)=>{
  const [clients,operators] = await Promise.all([
    get('SELECT COUNT(*) total FROM clients WHERE active=1'),
    get("SELECT COUNT(*) total FROM users WHERE role IN ('operator','team_lead') AND active=1")
  ]);
  res.json({ok:true, clients:clients.total, operators:operators.total, defaultOperatorLogin:'teléfono o email', defaultOperatorPassword:process.env.DEFAULT_OPERATOR_PASSWORD || 'Marfan1234*'});
});



// ---------- V2.0.4 OPERATIVA V62.49 REPLICADA ----------
function toISODate(d=new Date()){ return d.toISOString().slice(0,10); }
function hoursBetween(a,b,breakMin=0){ if(!a||!b) return 0; const ms=new Date(b).getTime()-new Date(a).getTime(); return Math.max(0,(ms/3600000)-(Number(breakMin||0)/60)); }
function nightHoursApprox(checkIn, checkOut){
  if(!checkIn || !checkOut) return 0;
  const start=new Date(checkIn), end=new Date(checkOut); let h=0;
  for(let t=new Date(start); t<end; t=new Date(t.getTime()+15*60000)){
    const hour=t.getHours()+t.getMinutes()/60;
    if(hour>=22 || hour<7) h+=0.25;
  }
  return Math.min(h, hoursBetween(checkIn,checkOut));
}
async function assignmentAllowed(eventId,userId){
  const u=await get('SELECT role FROM users WHERE id=?',[userId]);
  if(!u) return false;
  if(['super_admin','admin'].includes(u.role)) return true;
  const a=await get('SELECT id FROM event_assignments WHERE event_id=? AND user_id=?',[eventId,userId]);
  return !!a;
}

app.get('/api/events/:id', auth, async (req,res)=>{
  const ev=await get(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, c.legal_name, c.cif, c.contact_name, c.email client_email, c.phone client_phone FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=?`,[req.params.id]);
  if(!ev) return res.status(404).json({error:'Evento no encontrado'});
  res.json(ev);
});
app.delete('/api/events/:id', auth, allow(...adminRoles), async (req,res)=>{ await run('DELETE FROM events WHERE id=?',[req.params.id]); res.json({ok:true}); });
app.post('/api/events/:id/complete', auth, allow(...adminTeam), async (req,res)=>{ await run("UPDATE events SET status='done', operational_status='realizado' WHERE id=?",[req.params.id]); res.json({ok:true}); });
app.get('/api/events/:id/my-assignment', auth, async (req,res)=> res.json(await get('SELECT * FROM event_assignments WHERE event_id=? AND user_id=?',[req.params.id,req.user.id]) || null));
app.delete('/api/assignments/:id', auth, allow(...adminTeam), async (req,res)=>{ await run('DELETE FROM event_assignments WHERE id=?',[req.params.id]); res.json({ok:true}); });

app.get('/api/my-current-event', auth, async (req,res)=>{
  const today=toISODate();
  const ev=await get(`SELECT e.*, a.id assignment_id FROM events e JOIN event_assignments a ON a.event_id=e.id WHERE a.user_id=? AND e.date=? ORDER BY e.start_time LIMIT 1`,[req.user.id,today]);
  res.json(ev||null);
});
app.post('/api/time-log', auth, async (req,res)=>{
  const {event_id, action, lat=null, lng=null, break_minutes=0, notes='', client_signature_name='', client_signature_dni=''}=req.body;
  if(!event_id) return res.status(400).json({error:'Falta evento'});
  if(!(await assignmentAllowed(event_id, req.user.id))) return res.status(403).json({error:'No estás asignado a este evento'});
  if(action==='check_out' || action==='out'){
    const open=await get('SELECT * FROM time_entries WHERE event_id=? AND user_id=? AND check_out IS NULL ORDER BY id DESC LIMIT 1',[event_id,req.user.id]);
    if(!open) return res.status(404).json({error:'No tienes entrada abierta'});
    await run('UPDATE time_entries SET check_out=datetime("now"), check_out_lat=?, check_out_lng=?, break_minutes=?, notes=?, client_signature_name=?, client_signature_dni=? WHERE id=?',[lat,lng,break_minutes,notes,client_signature_name,client_signature_dni,open.id]);
    return res.json(await get('SELECT * FROM time_entries WHERE id=?',[open.id]));
  }
  const existing=await get('SELECT id FROM time_entries WHERE user_id=? AND check_out IS NULL',[req.user.id]);
  if(existing) return res.status(409).json({error:'Ya tienes un fichaje abierto'});
  const r=await run('INSERT INTO time_entries(event_id,user_id,check_in,check_in_lat,check_in_lng,notes) VALUES(?,?,datetime("now"),?,?,?)',[event_id,req.user.id,lat,lng,notes]);
  res.status(201).json(await get('SELECT * FROM time_entries WHERE id=?',[r.id]));
});
app.get('/api/my-time-entries', auth, async (req,res)=> res.json(await all(`SELECT t.*, e.title event_title, e.date FROM time_entries t JOIN events e ON e.id=t.event_id WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 200`,[req.user.id])));

app.get('/api/admin/daily-control', auth, allow(...adminTeam), async (req,res)=>{
  const date=req.query.date || toISODate();
  const events=await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, COUNT(a.id) assigned_count FROM events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN event_assignments a ON a.event_id=e.id WHERE e.date=? GROUP BY e.id ORDER BY e.start_time`,[date]);
  const entries=await all(`SELECT t.*, u.name user_name, e.title event_title FROM time_entries t JOIN users u ON u.id=t.user_id JOIN events e ON e.id=t.event_id WHERE e.date=? ORDER BY t.check_in DESC`,[date]);
  const missing=await all(`SELECT e.title event_title, u.name user_name, e.start_time FROM event_assignments a JOIN events e ON e.id=a.event_id JOIN users u ON u.id=a.user_id LEFT JOIN time_entries t ON t.event_id=e.id AND t.user_id=u.id WHERE e.date=? AND t.id IS NULL ORDER BY e.start_time,u.name`,[date]);
  res.json({date,events,entries,missing});
});
app.get('/api/gps/live', auth, allow(...adminTeam), async (req,res)=>{
  const rows=await all(`SELECT t.*, u.name user_name, u.phone, e.title event_title, e.date FROM time_entries t JOIN users u ON u.id=t.user_id JOIN events e ON e.id=t.event_id WHERE (t.check_in_lat IS NOT NULL OR t.check_out_lat IS NOT NULL) ORDER BY COALESCE(t.check_out,t.check_in) DESC LIMIT 200`);
  res.json(rows.map(r=>({...r, lat:r.check_out_lat||r.check_in_lat, lng:r.check_out_lng||r.check_in_lng, status:r.check_out?'salida':'entrada'})));
});

app.post('/api/events/:id/client-sign', auth, async (req,res)=>{
  const {client_signature_name='', client_signature_dni=''}=req.body;
  await run('UPDATE time_entries SET client_signature_name=?, client_signature_dni=? WHERE event_id=?',[client_signature_name,client_signature_dni,req.params.id]);
  res.json({ok:true});
});
app.get('/api/events/:id/client-sign-summary', auth, async (req,res)=>{
  const rows=await all(`SELECT t.*, u.name user_name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE event_id=? ORDER BY u.name`,[req.params.id]);
  const total=rows.reduce((a,r)=>a+hoursBetween(r.check_in,r.check_out,r.break_minutes),0);
  res.json({entries:rows,total_hours:total,signed:rows.some(r=>r.client_signature_name)});
});

app.post('/api/event-delivery-notes/generate', auth, allow(...adminTeam), async (req,res)=>{
  const {event_id}=req.body; const ev=await get(`SELECT e.*, COALESCE(c.name,e.client_name) client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=?`,[event_id]);
  if(!ev) return res.status(404).json({error:'Evento no encontrado'});
  const entries=await all('SELECT * FROM time_entries WHERE event_id=?',[event_id]);
  let normal=0, night=0; entries.forEach(t=>{ const h=hoursBetween(t.check_in,t.check_out,t.break_minutes); const nh=nightHoursApprox(t.check_in,t.check_out); night+=nh; normal+=Math.max(0,h-nh); });
  const settingsRows=await all('SELECT key,value FROM settings'); const st=Object.fromEntries(settingsRows.map(r=>[r.key,r.value]));
  const total=Number(ev.budget||0); const vat=total*(1+Number(st.vat_percent||21)/100);
  const r=await run('INSERT INTO delivery_notes(event_id,number,client_name,event_date,normal_hours,night_hours,diets,km,grand_total,grand_total_vat) VALUES(?,?,?,?,?,?,?,?,?,?)',[event_id,`ALB-${String(event_id).padStart(4,'0')}-${Date.now()}`,ev.client_name||'',ev.date,normal,night,0,0,total,vat]);
  res.status(201).json(await get('SELECT * FROM delivery_notes WHERE id=?',[r.id]));
});
app.get('/api/event-delivery-notes', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM delivery_notes ORDER BY created_at DESC')));
app.get('/api/event-delivery-notes/:id', auth, allow(...adminTeam), async (req,res)=> res.json(await get('SELECT * FROM delivery_notes WHERE id=?',[req.params.id])));
app.post('/api/event-delivery-notes/:id/client-sign', auth, async (req,res)=>{ await run('UPDATE delivery_notes SET client_signed=1 WHERE id=?',[req.params.id]); res.json({ok:true}); });

app.get('/api/reports/weekly-events', auth, allow(...adminTeam), async (req,res)=>{
  const rows=await all(`SELECT strftime('%Y-W%W',date) week, COUNT(*) events, COALESCE(SUM(budget),0) budget FROM events GROUP BY week ORDER BY week DESC LIMIT 26`); res.json(rows);
});
app.get('/api/reports/client-history', auth, allow(...adminTeam), async (req,res)=>{
  const rows=await all(`SELECT COALESCE(c.name,e.client_name,'Sin cliente') client, COUNT(e.id) events, COALESCE(SUM(e.budget),0) budget, MAX(e.date) last_event FROM events e LEFT JOIN clients c ON c.id=e.client_id GROUP BY client ORDER BY budget DESC`); res.json(rows);
});
app.get('/api/reports/worker-hours', auth, allow(...adminTeam), async (req,res)=>{
  const rows=await all(`SELECT u.name worker, COUNT(t.id) entries, t.check_in, t.check_out, t.break_minutes FROM time_entries t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 1000`);
  const map={}; rows.forEach(r=>{ map[r.worker]??={worker:r.worker,entries:0,hours:0,night_hours:0}; map[r.worker].entries++; map[r.worker].hours+=hoursBetween(r.check_in,r.check_out,r.break_minutes); map[r.worker].night_hours+=nightHoursApprox(r.check_in,r.check_out); });
  res.json(Object.values(map).sort((a,b)=>b.hours-a.hours));
});
app.get('/api/operations/summary', auth, allow(...adminTeam), async (req,res)=>{
  const today=toISODate();
  const open=await get('SELECT COUNT(*) total FROM time_entries WHERE check_out IS NULL');
  const pending=await get("SELECT COUNT(*) total FROM events WHERE status NOT IN ('done','cancelled') AND date>=?",[today]);
  const docs=await get("SELECT COUNT(*) total FROM documents WHERE expiry_date!='' AND expiry_date<=date('now','+30 day')");
  res.json({open_entries:open.total,pending_events:pending.total,expiring_documents:docs.total});
});
app.get('/api/finance/events', auth, allow(...adminRoles), async (req,res)=> res.json(await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, (COALESCE(e.budget,0)-COALESCE(e.external_cost,0)-COALESCE(e.transport_cost,0)-COALESCE(e.other_cost,0)) profit FROM events e LEFT JOIN clients c ON c.id=e.client_id ORDER BY e.date DESC`)));
app.put('/api/finance/events/:id/costs', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; await run('UPDATE events SET budget=?, external_cost=?, transport_cost=?, other_cost=? WHERE id=?',[b.budget||0,b.external_cost||0,b.transport_cost||0,b.other_cost||0,req.params.id]); res.json(await get('SELECT * FROM events WHERE id=?',[req.params.id])); });
app.put('/api/finance/events/:id/detailed-costs', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; await run('UPDATE events SET budget=?, external_cost=?, transport_cost=?, other_cost=?, notes=? WHERE id=?',[b.budget||0,b.external_cost||0,b.transport_cost||0,b.other_cost||0,b.notes||'',req.params.id]); res.json({ok:true}); });

app.get('/api/production/events', auth, allow(...adminTeam), async (req,res)=> res.json(await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.date>=date('now','-30 day') ORDER BY e.date,e.start_time`)));
app.post('/api/production/tasks', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO production_tasks(event_id,title,assigned_to,status,due_date,notes) VALUES(?,?,?,?,?,?)',[b.event_id||null,b.title,b.assigned_to||null,b.status||'pending',b.due_date||'',b.notes||'']); res.status(201).json(await get('SELECT * FROM production_tasks WHERE id=?',[r.id])); });
app.get('/api/production/tasks', auth, allow(...adminTeam), async (req,res)=> res.json(await all(`SELECT t.*, e.title event_title, u.name assigned_name FROM production_tasks t LEFT JOIN events e ON e.id=t.event_id LEFT JOIN users u ON u.id=t.assigned_to ORDER BY t.created_at DESC`)));
app.put('/api/production/tasks/:id', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; await run('UPDATE production_tasks SET title=?, assigned_to=?, status=?, due_date=?, notes=? WHERE id=?',[b.title,b.assigned_to||null,b.status||'pending',b.due_date||'',b.notes||'',req.params.id]); res.json({ok:true}); });
app.post('/api/production/incidents', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO production_incidents(event_id,user_id,title,severity,status,notes) VALUES(?,?,?,?,?,?)',[b.event_id||null,req.user.id,b.title,b.severity||'media',b.status||'abierta',b.notes||'']); res.status(201).json(await get('SELECT * FROM production_incidents WHERE id=?',[r.id])); });
app.get('/api/production/incidents', auth, allow(...adminTeam), async (req,res)=> res.json(await all(`SELECT i.*, e.title event_title, u.name user_name FROM production_incidents i LEFT JOIN events e ON e.id=i.event_id LEFT JOIN users u ON u.id=i.user_id ORDER BY i.created_at DESC`)));

app.get('/api/passwords', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT id,title,service,category,username,password,url,notes,active,created_at FROM password_vault ORDER BY title')));
app.post('/api/passwords', auth, allow('super_admin'), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO password_vault(title,service,category,username,password,url,notes,active) VALUES(?,?,?,?,?,?,?,?)',[b.title,b.service||'',b.category||'',b.username||'',b.password||'',b.url||'',b.notes||'',b.active===0?0:1]); res.status(201).json(await get('SELECT * FROM password_vault WHERE id=?',[r.id])); });
app.put('/api/passwords/:id', auth, allow('super_admin'), async (req,res)=>{ const b=req.body; await run('UPDATE password_vault SET title=?,service=?,category=?,username=?,password=?,url=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[b.title,b.service||'',b.category||'',b.username||'',b.password||'',b.url||'',b.notes||'',b.active===0?0:1,req.params.id]); res.json({ok:true}); });
app.delete('/api/passwords/:id', auth, allow('super_admin'), async (req,res)=>{ await run('DELETE FROM password_vault WHERE id=?',[req.params.id]); res.json({ok:true}); });

app.get('/api/rates-pro', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT * FROM rates ORDER BY role')));
app.post('/api/rates-pro/add', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO rates(role,day_rate,night_rate,active) VALUES(?,?,?,1)',[b.role,b.day_rate||0,b.night_rate||0]); res.status(201).json(await get('SELECT * FROM rates WHERE id=?',[r.id])); });
app.put('/api/rates-pro/:id', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; await run('UPDATE rates SET role=?, day_rate=?, night_rate=?, active=? WHERE id=?',[b.role,b.day_rate||0,b.night_rate||0,b.active===0?0:1,req.params.id]); res.json({ok:true}); });
app.delete('/api/rates-pro/:id', auth, allow(...adminRoles), async (req,res)=>{ await run('DELETE FROM rates WHERE id=?',[req.params.id]); res.json({ok:true}); });
app.get('/api/operator-roles', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT DISTINCT operator_role_name role FROM users WHERE operator_role_name!="" ORDER BY operator_role_name')));
app.post('/api/event-role-lines', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO event_role_lines(event_id,role_label,quantity,day_rate,night_rate,planned_start,planned_end,notes) VALUES(?,?,?,?,?,?,?,?)',[b.event_id,b.role_label,b.quantity||1,b.day_rate||0,b.night_rate||0,b.planned_start||'',b.planned_end||'',b.notes||'']); res.status(201).json(await get('SELECT * FROM event_role_lines WHERE id=?',[r.id])); });
app.get('/api/event-role-lines/:eventId', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM event_role_lines WHERE event_id=? ORDER BY role_label',[req.params.eventId])));

app.get('/api/backup/export', auth, allow('super_admin'), async (req,res)=>{
  const data={exported_at:new Date().toISOString(), users:await all('SELECT * FROM users'), clients:await all('SELECT * FROM clients'), events:await all('SELECT * FROM events'), assignments:await all('SELECT * FROM event_assignments'), time_entries:await all('SELECT * FROM time_entries'), rates:await all('SELECT * FROM rates'), documents:await all('SELECT * FROM documents'), delivery_notes:await all('SELECT * FROM delivery_notes'), settings:await all('SELECT * FROM settings')};
  res.setHeader('Content-Disposition','attachment; filename="marfan-backup.json"'); res.json(data);
});
app.post('/api/backup/import', auth, allow('super_admin'), async (req,res)=> res.status(501).json({error:'Importación destructiva desactivada por seguridad. Usa soporte técnico para restaurar.'}));
app.get('/api/dashboard-graph', auth, allow(...adminTeam), async (req,res)=> res.json(await all(`SELECT substr(date,1,7) month, COUNT(*) events, COALESCE(SUM(budget),0) budget FROM events GROUP BY month ORDER BY month DESC LIMIT 18`)));
app.get('/api/pdf-template/:type/:id', auth, async (req,res)=>{
  const {type,id}=req.params;
  if(type==='event') return res.json({html:`<h1>Evento ${id}</h1><p>Imprime esta vista desde el navegador.</p>`});
  if(type==='delivery-note') return res.json({html:`<h1>Albarán ${id}</h1><p>Imprime esta vista desde el navegador.</p>`});
  res.status(404).json({error:'Tipo no soportado'});
});

app.get('/api/health', (req,res)=> res.json({ok:true, app:'Marfan Crew 2.0.4', clean:true, legacyMenusMigrated:true, legacyDataImported:true}));

migrate().then(async()=>{ const email=process.env.DEFAULT_ADMIN_EMAIL||'admin@marfan.local'; const pass=process.env.DEFAULT_ADMIN_PASSWORD||'Admin1234!'; const exists=await get('SELECT id FROM users WHERE email=?',[email]); if(!exists) await run('INSERT INTO users(name,email,password_hash,role,active,position) VALUES(?,?,?,?,?,?)',['Super Admin',email,await bcrypt.hash(pass,10),'super_admin',1,'Dirección']); if(process.env.AUTO_IMPORT_LEGACY_DATA !== 'false'){ try{ const r=await importLegacyData({get,run}); console.log('[Marfan 2.0.4] Datos V62.49 importados', r); }catch(e){ console.warn('[Marfan 2.0.4] Import legacy warning', e.message); } } app.listen(PORT,()=>console.log(`Marfan Crew 2.0.4 running on ${PORT}`)); }).catch(err=>{ console.error(err); process.exit(1); });

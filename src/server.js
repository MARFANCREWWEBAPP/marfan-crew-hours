const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const { migrate, run, get, all } = require('./db');
const { importLegacyData } = require('./legacy/importLegacyData');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev_secret_change_me') console.warn('[SEGURIDAD] Configura JWT_SECRET en Railway para producción.');

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

function isAdminUser(){ return false; }
async function audit(req, action, entity='', entity_id='', details={}){ try{ await run('INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)',[req.user?.id||null,action,entity,String(entity_id||''),JSON.stringify(details||{})]); }catch(e){} }
function haversineMeters(lat1,lng1,lat2,lng2){
  if([lat1,lng1,lat2,lng2].some(v=>v===null||v===undefined||v===''||Number.isNaN(Number(v)))) return null;
  const R=6371000, toRad=x=>Number(x)*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
async function getSettingsMap(){ const rows=await all('SELECT key,value FROM settings'); return Object.fromEntries(rows.map(r=>[r.key,r.value])); }
function nightHoursExact(checkIn, checkOut){
  if(!checkIn || !checkOut) return 0;
  const start=new Date(checkIn), end=new Date(checkOut); if(!(end>start)) return 0;
  let mins=0;
  for(let t=new Date(start); t<end; t=new Date(t.getTime()+60000)){
    const h=t.getHours()+t.getMinutes()/60;
    if(h>=22 || h<7) mins++;
  }
  return Math.round((mins/60)*100)/100;
}
const VAULT_KEY = crypto.createHash('sha256').update(process.env.VAULT_SECRET || JWT_SECRET || 'dev').digest();
function encryptVaultText(text=''){
  if(!text || String(text).startsWith('enc:')) return text || '';
  const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const enc=Buffer.concat([cipher.update(String(text),'utf8'), cipher.final()]);
  const tag=cipher.getAuthTag(); return 'enc:'+Buffer.concat([iv,tag,enc]).toString('base64');
}
function decryptVaultText(text=''){
  try{ if(!text || !String(text).startsWith('enc:')) return text||''; const raw=Buffer.from(String(text).slice(4),'base64'); const iv=raw.subarray(0,12), tag=raw.subarray(12,28), enc=raw.subarray(28); const decipher=crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'); }catch(e){ return ''; }
}
async function migratePasswordVaultEncryption(){
  try{ const rows=await all('SELECT id,password FROM password_vault WHERE password IS NOT NULL AND password != ""'); for(const r of rows){ if(!String(r.password).startsWith('enc:')) await run('UPDATE password_vault SET password=? WHERE id=?',[encryptVaultText(r.password),r.id]); } }catch(e){ console.warn('[Vault] migración cifrado:', e.message); }
}


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
  await audit(req,'create_user','users',r.id,{role});
  res.status(201).json(await get('SELECT * FROM users WHERE id=?',[r.id]));
});
app.put('/api/users/:id', auth, allow('super_admin'), async (req,res)=>{
  const {name,email,phone,role,active=1,hourly_rate=0,position='',dni='',emergency_phone='',emergency_contact_name='',emergency_contact_phone='',notes='',first_name='',last_name='',nickname='',iban='',bank_iban='',bank_name='',social_security_number='',full_address='',address='',operator_role_name='',shirt_size='',pants_size='',shoe_size='',epis_delivered=0,has_prl=0}=req.body;
  await run(`UPDATE users SET name=?,email=?,phone=?,role=?,active=?,hourly_rate=?,position=?,dni=?,emergency_phone=?,emergency_contact_name=?,emergency_contact_phone=?,notes=?,first_name=?,last_name=?,nickname=?,iban=?,bank_iban=?,bank_name=?,social_security_number=?,full_address=?,address=?,operator_role_name=?,shirt_size=?,pants_size=?,shoe_size=?,epis_delivered=?,has_prl=? WHERE id=?`,[name,email||null,phone||null,role,active?1:0,hourly_rate,position,dni,emergency_phone,emergency_contact_name,emergency_contact_phone,notes,first_name,last_name,nickname,iban,bank_iban,bank_name,social_security_number,full_address,address,operator_role_name,shirt_size,pants_size,shoe_size,Number(epis_delivered||0),Number(has_prl||0),req.params.id]);
  await audit(req,'update_user','users',req.params.id,{role});
  res.json(await get('SELECT * FROM users WHERE id=?',[req.params.id]));
});
app.post('/api/users/:id/reset-password', auth, allow('super_admin'), async (req,res)=>{ const {password}=req.body; if(!password||password.length<8) return res.status(400).json({error:'La contraseña debe tener mínimo 8 caracteres'}); await run('UPDATE users SET password_hash=? WHERE id=?',[await bcrypt.hash(password,10),req.params.id]); res.json({ok:true}); });

app.get('/api/clients', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM clients ORDER BY name')));
app.post('/api/clients', auth, allow(...adminRoles), async (req,res)=>{ const {name,legal_name='',cif='',contact_name='',email='',phone='',address='',province='',notes=''}=req.body; const r=await run('INSERT INTO clients(name,legal_name,cif,contact_name,email,phone,address,province,notes) VALUES(?,?,?,?,?,?,?,?,?)',[name,legal_name,cif,contact_name,email,phone,address,province,notes]); await audit(req,'create_client','clients',r.id,{});
  res.status(201).json(await get('SELECT * FROM clients WHERE id=?',[r.id])); });
app.put('/api/clients/:id', auth, allow(...adminRoles), async (req,res)=>{ const {name,legal_name='',cif='',contact_name='',email='',phone='',address='',province='',notes='',active=1}=req.body; await run('UPDATE clients SET name=?,legal_name=?,cif=?,contact_name=?,email=?,phone=?,address=?,province=?,notes=?,active=? WHERE id=?',[name,legal_name,cif,contact_name,email,phone,address,province,notes,active?1:0,req.params.id]); res.json(await get('SELECT * FROM clients WHERE id=?',[req.params.id])); });

app.get('/api/events', auth, async (req,res)=> {
  const isAdmin = adminTeam.includes(req.user.role);
  const rows = isAdmin
    ? await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, COUNT(a.id) assigned_count FROM events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN event_assignments a ON a.event_id=e.id GROUP BY e.id ORDER BY e.date DESC,e.start_time DESC`)
    : await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, 1 assigned_count FROM events e JOIN event_assignments a ON a.event_id=e.id LEFT JOIN clients c ON c.id=e.client_id WHERE a.user_id=? ORDER BY e.date DESC,e.start_time DESC`, [req.user.id]);
  res.json(rows);
});
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
async function validateGeofence(eventId, lat, lng){
  const ev=await get('SELECT id,lat,lng,title FROM events WHERE id=?',[eventId]);
  const st=await getSettingsMap();
  const max=Number(st.geofence_radius_m||250);
  const distance=haversineMeters(lat,lng,ev?.lat,ev?.lng);
  if(distance===null) return {ok:true, distance:null, warning:'Evento o móvil sin coordenadas. Geocerca no aplicada.'};
  if(distance>max) return {ok:false, distance, error:`Estás a ${Math.round(distance)} m del evento. Máximo permitido: ${max} m.`};
  return {ok:true, distance};
}

app.get('/api/events/:id', auth, async (req,res)=>{
  const ev=await get(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, c.legal_name, c.cif, c.contact_name, c.email client_email, c.phone client_phone FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=?`,[req.params.id]);
  if(!ev) return res.status(404).json({error:'Evento no encontrado'});
  if(!adminTeam.includes(req.user.role) && !(await assignmentAllowed(req.params.id, req.user.id))) return res.status(403).json({error:'No tienes acceso a este evento'});
  res.json(ev);
});
app.put('/api/events/:id', auth, allow(...adminTeam), async (req,res)=>{
  const b=req.body||{};
  await run(`UPDATE events SET title=?,event_code=?,client_id=?,client_name=?,location=?,address=?,google_maps_link=?,date=?,start_time=?,end_time=?,load_in_time=?,load_out_time=?,service_type=?,status=?,operational_status=?,budget=?,external_cost=?,transport_cost=?,other_cost=?,notes=?,access_notes=?,parking_notes=?,material_notes=?,crew_notes=?,production_notes=?,lat=?,lng=? WHERE id=?`,[b.title,b.event_code||'',b.client_id||null,b.client_name||'',b.location||'',b.address||'',b.google_maps_link||'',b.date,b.start_time,b.end_time,b.load_in_time||'',b.load_out_time||'',b.service_type||'',b.status||'planned',b.operational_status||'',b.budget||0,b.external_cost||0,b.transport_cost||0,b.other_cost||0,b.notes||'',b.access_notes||'',b.parking_notes||'',b.material_notes||'',b.crew_notes||'',b.production_notes||'',b.lat||null,b.lng||null,req.params.id]);
  await audit(req,'update_event','events',req.params.id,{});
  res.json(await get('SELECT * FROM events WHERE id=?',[req.params.id]));
});
app.delete('/api/events/:id', auth, allow(...adminRoles), async (req,res)=>{ await run('DELETE FROM events WHERE id=?',[req.params.id]); await audit(req,'delete_event','events',req.params.id,{}); res.json({ok:true}); });
app.post('/api/events/:id/complete', auth, allow(...adminTeam), async (req,res)=>{ await run("UPDATE events SET status='done', operational_status='realizado' WHERE id=?",[req.params.id]); await audit(req,'complete_event','events',req.params.id,{}); res.json({ok:true}); });
app.get('/api/events/:id/my-assignment', auth, async (req,res)=> res.json(await get('SELECT * FROM event_assignments WHERE event_id=? AND user_id=?',[req.params.id,req.user.id]) || null));
app.delete('/api/assignments/:id', auth, allow(...adminTeam), async (req,res)=>{ await run('DELETE FROM event_assignments WHERE id=?',[req.params.id]); await audit(req,'delete_assignment','assignments',req.params.id,{}); res.json({ok:true}); });

app.get('/api/my-current-event', auth, async (req,res)=>{
  const today=toISODate();
  const ev=await get(`SELECT e.*, a.id assignment_id FROM events e JOIN event_assignments a ON a.event_id=e.id WHERE a.user_id=? AND e.date=? ORDER BY e.start_time LIMIT 1`,[req.user.id,today]);
  res.json(ev||null);
});
app.get('/api/my-events', auth, async (req,res)=>{
  const rows=await all(`SELECT e.*, COALESCE(c.name,e.client_name) client_name, a.role_label, a.planned_start, a.planned_end FROM events e JOIN event_assignments a ON a.event_id=e.id LEFT JOIN clients c ON c.id=e.client_id WHERE a.user_id=? ORDER BY e.date DESC,e.start_time DESC LIMIT 200`,[req.user.id]);
  res.json(rows);
});
app.post('/api/time-log', auth, async (req,res)=>{
  const {event_id, action, lat=null, lng=null, break_minutes=0, notes='', client_signature_name='', client_signature_dni=''}=req.body;
  if(!event_id) return res.status(400).json({error:'Falta evento'});
  if(!(await assignmentAllowed(event_id, req.user.id))) return res.status(403).json({error:'No estás asignado a este evento'});
  const geo=await validateGeofence(event_id, lat, lng);
  if(!geo.ok) return res.status(403).json({error:geo.error, distance_m:geo.distance});
  if(action==='check_out' || action==='out'){
    const open=await get('SELECT * FROM time_entries WHERE event_id=? AND user_id=? AND check_out IS NULL ORDER BY id DESC LIMIT 1',[event_id,req.user.id]);
    if(!open) return res.status(404).json({error:'No tienes entrada abierta'});
    await run('UPDATE time_entries SET check_out=datetime("now"), check_out_lat=?, check_out_lng=?, gps_distance_out_m=?, break_minutes=?, notes=?, client_signature_name=?, client_signature_dni=? WHERE id=?',[lat,lng,geo.distance,break_minutes,notes,client_signature_name,client_signature_dni,open.id]);
    await audit(req,'check_out','time_entries',open.id,{event_id,distance:geo.distance});
    return res.json(await get('SELECT * FROM time_entries WHERE id=?',[open.id]));
  }
  const existing=await get('SELECT id FROM time_entries WHERE user_id=? AND check_out IS NULL',[req.user.id]);
  if(existing) return res.status(409).json({error:'Ya tienes un fichaje abierto'});
  const r=await run('INSERT INTO time_entries(event_id,user_id,check_in,check_in_lat,check_in_lng,gps_distance_in_m,notes) VALUES(?,?,datetime("now"),?,?,?,?)',[event_id,req.user.id,lat,lng,geo.distance,notes]);
  await audit(req,'check_in','time_entries',r.id,{event_id,distance:geo.distance});
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
  const st=await getSettingsMap(); const vatPercent=Number(st.vat_percent||21), dietAmount=Number(st.diet_amount||15);
  const entries=await all(`SELECT t.*, u.name user_name,u.hourly_rate,u.position,u.operator_role_name,a.role_label,a.hourly_rate assignment_rate,r.day_rate,r.night_rate FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN event_assignments a ON a.event_id=t.event_id AND a.user_id=t.user_id LEFT JOIN rates r ON lower(r.role)=lower(COALESCE(a.role_label,u.operator_role_name,u.position,'')) WHERE t.event_id=? ORDER BY u.name,t.check_in`,[event_id]);
  let normal=0, night=0, lineTotal=0;
  const number=`${st.invoice_prefix||'ALB'}-${String(event_id).padStart(4,'0')}-${Date.now()}`;
  const r=await run('INSERT INTO delivery_notes(event_id,number,client_name,event_date,normal_hours,night_hours,diets,km,grand_total,grand_total_vat,vat_percent,locked) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)',[event_id,number,ev.client_name||'',ev.date,0,0,0,0,0,0,vatPercent]);
  for(const t of entries){
    const totalH=hoursBetween(t.check_in,t.check_out,t.break_minutes); const nh=nightHoursExact(t.check_in,t.check_out); const norm=Math.max(0,totalH-nh);
    const dayRate=Number(t.assignment_rate||t.day_rate||t.hourly_rate||0); const nightRate=Number(t.night_rate||dayRate||0); const diet = totalH>=6 ? dietAmount : 0; const lt=(norm*dayRate)+(nh*nightRate)+diet;
    normal+=norm; night+=nh; lineTotal+=lt;
    await run('INSERT INTO delivery_note_lines(delivery_note_id,event_id,user_id,worker_name,role_label,check_in,check_out,break_minutes,normal_hours,night_hours,day_rate,night_rate,diet,km,line_total,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[r.id,event_id,t.user_id,t.user_name||'',t.role_label||t.operator_role_name||t.position||'',t.check_in||'',t.check_out||'',t.break_minutes||0,norm,nh,dayRate,nightRate,diet,0,lt,t.notes||'']);
  }
  const base = Number(ev.budget||0) || lineTotal; const vat=base*(1+vatPercent/100);
  await run('UPDATE delivery_notes SET normal_hours=?, night_hours=?, diets=?, grand_total=?, grand_total_vat=? WHERE id=?',[normal,night,entries.filter(t=>hoursBetween(t.check_in,t.check_out,t.break_minutes)>=6).length*dietAmount,base,vat,r.id]);
  await audit(req,'generate_delivery_note','delivery_notes',r.id,{event_id});
  res.status(201).json(await get('SELECT * FROM delivery_notes WHERE id=?',[r.id]));
});
app.get('/api/event-delivery-notes', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM delivery_notes ORDER BY created_at DESC')));
app.get('/api/event-delivery-notes/:id', auth, allow(...adminTeam), async (req,res)=> res.json(await get('SELECT * FROM delivery_notes WHERE id=?',[req.params.id])));
app.post('/api/event-delivery-notes/:id/client-sign', auth, async (req,res)=>{ const b=req.body||{}; const note=await get('SELECT * FROM delivery_notes WHERE id=?',[req.params.id]); if(!note) return res.status(404).json({error:'Albarán no encontrado'}); if(note.locked) return res.status(409).json({error:'El albarán ya está firmado y bloqueado'}); await run('UPDATE delivery_notes SET client_signed=1, locked=1, signature_name=?, signature_dni=?, signature_data_url=?, signed_at=datetime("now") WHERE id=?',[b.signature_name||b.client_signature_name||'',b.signature_dni||b.client_signature_dni||'',b.signature_data_url||'',req.params.id]); await audit(req,'sign_delivery_note','delivery_notes',req.params.id,{name:b.signature_name}); res.json({ok:true}); });
app.get('/api/event-delivery-notes/:id/lines', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM delivery_note_lines WHERE delivery_note_id=? ORDER BY worker_name',[req.params.id])));


// ---------- V2.0.4 A4 PDF PRO ----------
function safeText(v){ return String(v ?? '').replace(/[\r\n]+/g,' ').trim(); }
async function getDeliveryNoteFull(noteId){
  const note=await get(`SELECT dn.*, e.title event_title,e.event_code,e.location,e.address,e.google_maps_link,e.date,e.start_time,e.end_time,e.load_in_time,e.load_out_time,e.service_type,e.notes event_notes,e.access_notes,e.parking_notes,e.material_notes,e.crew_notes,e.production_notes,e.budget,e.external_cost,e.transport_cost,e.other_cost,e.lat,e.lng,COALESCE(c.name,e.client_name,dn.client_name) client_name,c.legal_name,c.cif,c.contact_name,c.email client_email,c.phone client_phone,c.address client_address,c.province client_province FROM delivery_notes dn LEFT JOIN events e ON e.id=dn.event_id LEFT JOIN clients c ON c.id=e.client_id WHERE dn.id=?`,[noteId]);
  if(!note) return null;
  let entries=await all(`SELECT l.*, l.worker_name user_name, l.role_label, l.check_in, l.check_out, l.break_minutes, l.normal_hours, l.night_hours, l.day_rate, l.night_rate, l.diet, l.km, l.line_total FROM delivery_note_lines l WHERE l.delivery_note_id=? ORDER BY l.worker_name,l.check_in`,[noteId]);
  if(!entries.length){
    entries=await all(`SELECT t.*, u.name user_name,u.dni,u.phone,u.hourly_rate,u.position,u.operator_role_name,a.role_label,a.hourly_rate assignment_rate,a.planned_start,a.planned_end,a.is_team_lead FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN event_assignments a ON a.event_id=t.event_id AND a.user_id=t.user_id WHERE t.event_id=? ORDER BY u.name,t.check_in`,[note.event_id]);
  }
  return {note,entries};
}
function drawLine(doc,y){ doc.moveTo(40,y).lineTo(555,y).strokeColor('#e5e7eb').lineWidth(1).stroke(); }
function drawKV(doc,label,value,x,y,w=230){ doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280').text(label,x,y,{width:w}); doc.font('Helvetica').fontSize(10).fillColor('#111827').text(safeText(value)||'-',x,y+11,{width:w}); }
function moneyEUR(v){ return new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(v||0)); }
app.get('/api/event-delivery-notes/:id/pdf', auth, allow(...adminTeam), async (req,res)=>{
  try{
    const PDFDocument = require('pdfkit');
    const data = await getDeliveryNoteFull(req.params.id);
    if(!data) return res.status(404).json({error:'Albarán no encontrado'});
    const {note,entries}=data;
    const settingsRows=await all('SELECT key,value FROM settings');
    const st=Object.fromEntries(settingsRows.map(r=>[r.key,r.value]));
    const doc = new PDFDocument({size:'A4', margin:40, info:{Title:`Albarán ${note.number||note.id}`, Author:st.company_name||'MARFAN CREW'}});
    const filename = `albaran-${safeText(note.number||note.id).replace(/[^a-zA-Z0-9-_]/g,'-')}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.roundedRect(40,35,515,78,16).fill('#f5f5f7');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(22).text(st.company_name || 'MARFAN CREW',60,55);
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(st.hq_address || 'Calle Ciro Alegría 89, Málaga',60,82);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text('ALBARÁN DE SERVICIO',360,55,{width:170,align:'right'});
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(safeText(note.number || `ALB-${note.id}`),360,80,{width:170,align:'right'});
    doc.fontSize(9).text(`Fecha emisión: ${new Date().toLocaleDateString('es-ES')}`,360,96,{width:170,align:'right'});

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Cliente',40,135);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Evento',310,135);
    drawKV(doc,'Nombre comercial',note.client_name,40,155);
    drawKV(doc,'Razón social',note.legal_name,40,195);
    drawKV(doc,'CIF/NIF',note.cif,40,235,110);
    drawKV(doc,'Contacto',`${note.contact_name||''} ${note.client_phone||''}`,160,235,120);
    drawKV(doc,'Evento',note.event_title,310,155);
    drawKV(doc,'Fecha / horario',`${note.event_date||note.date||''} · ${note.start_time||''} - ${note.end_time||''}`,310,195);
    drawKV(doc,'Lugar',note.location || note.address,310,235);
    drawLine(doc,278);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Detalle de operarios y fichajes',40,295);
    let y=318;
    const head=['Operario','Rol','Entrada','Salida','Norm.','Noct.','Firma'];
    const widths=[120,80,70,70,45,45,85];
    let x=40;
    doc.roundedRect(40,y-6,515,22,6).fill('#111827');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    head.forEach((h,i)=>{ doc.text(h,x+4,y,{width:widths[i]-6}); x+=widths[i]; });
    y+=25;
    doc.font('Helvetica').fontSize(8).fillColor('#111827');
    let totalHours=0,totalNight=0;
    for(const r of entries){
      if(y>705){ doc.addPage(); y=55; }
      const nh=Number(r.night_hours ?? nightHoursExact(r.check_in,r.check_out)); const norm=Number(r.normal_hours ?? Math.max(0,hoursBetween(r.check_in,r.check_out,r.break_minutes)-nh)); const h=norm+nh; totalHours+=h; totalNight+=nh;
      x=40;
      const vals=[r.user_name, r.role_label||r.operator_role_name||r.position||'', r.check_in?new Date(r.check_in).toLocaleString('es-ES',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'-', r.check_out?new Date(r.check_out).toLocaleString('es-ES',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'-', norm.toFixed(2), nh.toFixed(2), r.client_signature_name||''];
      vals.forEach((v,i)=>{ doc.text(safeText(v),x+4,y,{width:widths[i]-6}); x+=widths[i]; });
      y+=20; drawLine(doc,y-5);
    }
    if(!entries.length){ doc.fillColor('#6b7280').text('No hay fichajes registrados para este evento.',44,y); y+=25; }

    y=Math.max(y+16,565);
    doc.roundedRect(40,y,250,90,12).strokeColor('#d1d5db').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Resumen de horas',58,y+16);
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Horas normales: ${Number(note.normal_hours || Math.max(0,totalHours-totalNight)).toFixed(2)}`,58,y+38);
    doc.text(`Horas nocturnas: ${Number(note.night_hours || totalNight).toFixed(2)}`,58,y+54);
    doc.text(`Dietas: ${moneyEUR(note.diets || 0)} · Km: ${Number(note.km || 0).toFixed(2)}`,58,y+70);

    doc.roundedRect(305,y,250,90,12).fill('#f9fafb').strokeColor('#d1d5db').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Resumen económico',323,y+16);
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Base imponible: ${moneyEUR(note.grand_total || note.budget || 0)}`,323,y+38,{width:210,align:'right'});
    doc.text(`IVA ${st.vat_percent || 21}% incluido: ${moneyEUR(note.grand_total_vat || 0)}`,323,y+56,{width:210,align:'right'});
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(`TOTAL: ${moneyEUR(note.grand_total_vat || note.grand_total || 0)}`,323,y+72,{width:210,align:'right'});

    y+=115;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Validación cliente',40,y);
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Nombre: ${safeText(note.signature_name || entries.find(e=>e.client_signature_name)?.client_signature_name || '')}`,40,y+20,{width:240});
    doc.text(`DNI: ${safeText(note.signature_dni || entries.find(e=>e.client_signature_dni)?.client_signature_dni || '')}`,40,y+37,{width:240});
    if(note.signature_data_url && String(note.signature_data_url).startsWith('data:image')){ try{ const b64=String(note.signature_data_url).split(',')[1]; doc.image(Buffer.from(b64,'base64'),315,y+5,{fit:[210,50]}); }catch(e){} }
    doc.moveTo(310,y+58).lineTo(540,y+58).strokeColor('#111827').stroke();
    doc.fontSize(8).fillColor('#6b7280').text('Firma cliente',390,y+64);

    doc.fontSize(7).fillColor('#6b7280').text('Documento generado automáticamente desde Marfan Crew 2.0.4. Formato A4 profesional para control interno y validación de servicio.',40,802,{width:515,align:'center'});
    doc.end();
  }catch(e){
    console.error('[PDF A4]', e);
    res.status(500).json({error:'No se pudo generar el PDF A4', detail:e.message});
  }
});

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

app.get('/api/passwords', auth, allow(...adminRoles), async (req,res)=> { const rows=await all('SELECT id,title,service,category,username,password,url,notes,active,created_at FROM password_vault ORDER BY title'); res.json(rows.map(r=>({...r,password:decryptVaultText(r.password)}))); });
app.post('/api/passwords', auth, allow('super_admin'), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO password_vault(title,service,category,username,password,url,notes,active) VALUES(?,?,?,?,?,?,?,?)',[b.title,b.service||'',b.category||'',b.username||'',encryptVaultText(b.password||''),b.url||'',b.notes||'',b.active===0?0:1]); await audit(req,'create_password','password_vault',r.id,{title:b.title}); res.status(201).json({...await get('SELECT * FROM password_vault WHERE id=?',[r.id]), password:b.password||''}); });
app.put('/api/passwords/:id', auth, allow('super_admin'), async (req,res)=>{ const b=req.body; await run('UPDATE password_vault SET title=?,service=?,category=?,username=?,password=?,url=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[b.title,b.service||'',b.category||'',b.username||'',encryptVaultText(b.password||''),b.url||'',b.notes||'',b.active===0?0:1,req.params.id]); await audit(req,'update_password','password_vault',req.params.id,{title:b.title}); res.json({ok:true}); });
app.delete('/api/passwords/:id', auth, allow('super_admin'), async (req,res)=>{ await run('DELETE FROM password_vault WHERE id=?',[req.params.id]); await audit(req,'delete_password','password_vault',req.params.id,{}); res.json({ok:true}); });

app.get('/api/rates-pro', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT * FROM rates ORDER BY role')));
app.post('/api/rates-pro/add', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO rates(role,day_rate,night_rate,active) VALUES(?,?,?,1)',[b.role,b.day_rate||0,b.night_rate||0]); res.status(201).json(await get('SELECT * FROM rates WHERE id=?',[r.id])); });
app.put('/api/rates-pro/:id', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body; await run('UPDATE rates SET role=?, day_rate=?, night_rate=?, active=? WHERE id=?',[b.role,b.day_rate||0,b.night_rate||0,b.active===0?0:1,req.params.id]); res.json({ok:true}); });
app.delete('/api/rates-pro/:id', auth, allow(...adminRoles), async (req,res)=>{ await run('DELETE FROM rates WHERE id=?',[req.params.id]); res.json({ok:true}); });
app.get('/api/operator-roles', auth, allow(...adminRoles), async (req,res)=> res.json(await all('SELECT DISTINCT operator_role_name role FROM users WHERE operator_role_name!="" ORDER BY operator_role_name')));
app.post('/api/event-role-lines', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body; const r=await run('INSERT INTO event_role_lines(event_id,role_label,quantity,day_rate,night_rate,planned_start,planned_end,notes) VALUES(?,?,?,?,?,?,?,?)',[b.event_id,b.role_label,b.quantity||1,b.day_rate||0,b.night_rate||0,b.planned_start||'',b.planned_end||'',b.notes||'']); res.status(201).json(await get('SELECT * FROM event_role_lines WHERE id=?',[r.id])); });
app.get('/api/event-role-lines/:eventId', auth, allow(...adminTeam), async (req,res)=> res.json(await all('SELECT * FROM event_role_lines WHERE event_id=? ORDER BY role_label',[req.params.eventId])));


app.put('/api/time-entries/:id/correct', auth, allow(...adminTeam), async (req,res)=>{ const b=req.body||{}; if(!b.correction_reason) return res.status(400).json({error:'Indica motivo de corrección'}); await run('UPDATE time_entries SET check_in=?, check_out=?, break_minutes=?, notes=?, admin_corrected=1, correction_reason=?, corrected_by=?, corrected_at=datetime("now") WHERE id=?',[b.check_in||null,b.check_out||null,b.break_minutes||0,b.notes||'',b.correction_reason,req.user.id,req.params.id]); await audit(req,'correct_time_entry','time_entries',req.params.id,{reason:b.correction_reason}); res.json(await get('SELECT * FROM time_entries WHERE id=?',[req.params.id])); });
app.get('/api/audit-logs', auth, allow(...adminRoles), async (req,res)=> res.json(await all(`SELECT l.*, u.name user_name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 500`)));
app.post('/api/documents/upload-json', auth, allow(...adminRoles), async (req,res)=>{ const b=req.body||{}; const uploadDir=path.join(__dirname,'../public/uploads'); fs.mkdirSync(uploadDir,{recursive:true}); let url='', filename='', size=0, mime=b.mime_type||''; if(b.data_url && String(b.data_url).startsWith('data:')){ const m=String(b.data_url).match(/^data:([^;]+);base64,(.*)$/); if(m){ mime=m[1]; const buf=Buffer.from(m[2],'base64'); filename=`doc-${Date.now()}-${String(b.original_name||'archivo').replace(/[^a-zA-Z0-9._-]/g,'-')}`; fs.writeFileSync(path.join(uploadDir,filename),buf); url='/uploads/'+filename; size=buf.length; } } const r=await run('INSERT INTO documents(title,type,owner_type,owner_id,expiry_date,notes,filename,original_name,path,url,mime_type,size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[b.title||b.original_name||'Documento',b.type||'',b.owner_type||'',b.owner_id||null,b.expiry_date||'',b.notes||'',filename,b.original_name||'',filename?path.join(uploadDir,filename):'',url,mime,size]); await audit(req,'upload_document','documents',r.id,{title:b.title}); res.status(201).json(await get('SELECT * FROM documents WHERE id=?',[r.id])); });

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

app.get('/api/health', (req,res)=> res.json({ok:true, app:'Marfan Crew 2.0.5 Enterprise Fix', clean:true, geofence:true, pdfA4Pro:true, vaultEncrypted:true, auditLogs:true}));

migrate().then(async()=>{ await migratePasswordVaultEncryption(); const email=process.env.DEFAULT_ADMIN_EMAIL||'admin@marfan.local'; const pass=process.env.DEFAULT_ADMIN_PASSWORD||'Admin1234!'; const exists=await get('SELECT id FROM users WHERE email=?',[email]); if(!exists) await run('INSERT INTO users(name,email,password_hash,role,active,position) VALUES(?,?,?,?,?,?)',['Super Admin',email,await bcrypt.hash(pass,10),'super_admin',1,'Dirección']); if(process.env.AUTO_IMPORT_LEGACY_DATA !== 'false'){ try{ const r=await importLegacyData({get,run}); console.log('[Marfan 2.0.5] Datos V62.49 importados', r); }catch(e){ console.warn('[Marfan 2.0.5] Import legacy warning', e.message); } } app.listen(PORT,()=>console.log(`Marfan Crew 2.0.5 running on ${PORT}`)); }).catch(err=>{ console.error(err); process.exit(1); });

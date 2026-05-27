
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'marfan-v49.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: false }));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marfancrew.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234*';
const OFFICE_WHATSAPP = '+34635371634';

let sessions = {};

function today(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function plusDays(n){
  const d = new Date();
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function baseDb(){
  return {
    settings:{
      company:'MARFAN CREW',
      vat:21,
      hourlyRate:18.5,
      nightRate:23.5,
      diet:15,
      kmPrice:0.28,
      officeWhatsapp:OFFICE_WHATSAPP,
      gpsRadius:300
    },
    users:[
      {id:1,email:'operario.demo@marfancrew.local',role:'operario',first_name:'Operario',last_name:'Demo',phone:'666111222',services:'Stagehand / Montaje',availability:'disponible',active:1,internal_hour_cost:12,internal_night_cost:15},
      {id:2,email:'jefe.demo@marfancrew.local',role:'jefe',first_name:'Jefe',last_name:'Equipo Demo',phone:'666333444',services:'Jefe equipo / Producción',availability:'disponible',active:1,internal_hour_cost:16,internal_night_cost:20},
      {id:3,email:'limpieza.demo@marfancrew.local',role:'operario',first_name:'Limpieza',last_name:'Demo',phone:'666555777',services:'Limpieza / Auxiliar limpieza',availability:'disponible',active:1,internal_hour_cost:10,internal_night_cost:13}
    ],
    clients:[
      {id:1,name:'Cliente Demo Producción',legal_name:'Cliente Demo SL',cif:'B00000000',contact:'Responsable Demo',phone:'600222000',email:'demo@cliente.com',address:'Málaga',fixed_hour_discount:0,percent_hour_discount:3,active:1}
    ],
    events:[
      {id:1,name:'Evento Demo Noche',client_id:1,client:'Cliente Demo Producción',location:'Málaga Centro',event_date:today(),start_time:'22:00',end_time:'05:00',latitude:36.7213,longitude:-4.4214,status:'programado',operational_status:'crew_completo',required_workers:3,required_team_leads:1,hourly_rate:18.5,night_rate:23.5,diet_price:15,km_amount:0,estimated_external_cost:80,estimated_transport_cost:25,estimated_other_cost:0,payment_status:'pendiente',notes:'Evento demo nocturno'},
      {id:2,name:'Montaje Corporate Demo',client_id:1,client:'Cliente Demo Producción',location:'FYCMA Málaga',event_date:plusDays(1),start_time:'08:00',end_time:'14:00',latitude:36.7039,longitude:-4.4626,status:'programado',operational_status:'crew_parcial',required_workers:4,required_team_leads:1,hourly_rate:18.5,night_rate:23.5,diet_price:15,km_amount:12.6,estimated_external_cost:0,estimated_transport_cost:20,estimated_other_cost:0,payment_status:'pendiente',notes:'Evento demo mañana'}
    ],
    assignments:[
      {id:1,event_id:1,user_id:1,service_role:'Stagehand',is_team_lead:0,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:18.5,billable_night_rate:23.5,apply_night:1,apply_diet:1},
      {id:2,event_id:1,user_id:2,service_role:'Jefe equipo',is_team_lead:1,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:22,billable_night_rate:28,apply_night:1,apply_diet:1},
      {id:3,event_id:1,user_id:3,service_role:'Limpieza',is_team_lead:0,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:18.5,billable_night_rate:23.5,apply_night:1,apply_diet:1}
    ],
    logs:[],
    documents:[],
    productionTasks:[
      {id:1,event_id:1,phase:'carga',title:'Carga de material',description:'Verificar EPIs y herramientas',completed:0,priority:'normal'},
      {id:2,event_id:1,phase:'montaje',title:'Montaje técnico',description:'Montaje según planning',completed:0,priority:'alta'},
      {id:3,event_id:1,phase:'servicio',title:'Servicio en directo',description:'Equipo operativo',completed:0,priority:'alta'},
      {id:4,event_id:1,phase:'desmontaje',title:'Desmontaje',description:'Recogida e inventario básico',completed:0,priority:'normal'}
    ],
    incidents:[],
    deliveryNotes:[]
  };
}
function loadDb(){
  if(!fs.existsSync(DB_FILE)){
    const db = baseDb();
    saveDb(db);
    return db;
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch(e){ const db=baseDb(); saveDb(db); return db; }
}
function saveDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function nextId(arr){ return arr.length ? Math.max(...arr.map(x=>Number(x.id)||0))+1 : 1; }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function getUser(req){
  const auth = req.headers.authorization || '';
  const t = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return t && sessions[t] ? sessions[t] : null;
}
function requireAuth(req,res,next){ const u=getUser(req); if(!u) return res.status(401).json({error:'No autenticado'}); req.user=u; next(); }
function requireAdmin(req,res,next){ const u=getUser(req); if(!u||u.role!=='admin') return res.status(403).json({error:'Solo administrador'}); req.user=u; next(); }
function hoursBetween(start,end){
  if(!start||!end) return 0;
  const [sh,sm]=start.split(':').map(Number); const [eh,em]=end.split(':').map(Number);
  let s=sh*60+sm, e=eh*60+em; if(e<=s)e+=1440;
  return Math.max(0,(e-s)/60);
}
function eventFinancial(db,e){
  const ass = db.assignments.filter(a=>a.event_id==e.id);
  let revenue=0, cost=0;
  for(const a of ass){
    const h = Math.max(4, hoursBetween(a.planned_start||e.start_time,a.planned_end||e.end_time));
    revenue += h * Number(a.billable_hourly_rate||e.hourly_rate||18.5);
    const u = db.users.find(x=>x.id==a.user_id) || {};
    cost += h * Number(u.internal_hour_cost||12);
    if(a.apply_diet) revenue += Number(e.diet_price||15);
  }
  revenue += Number(e.km_amount||0);
  cost += Number(e.estimated_external_cost||0)+Number(e.estimated_transport_cost||0)+Number(e.estimated_other_cost||0);
  const profit = revenue-cost;
  const margin = revenue ? Math.round((profit/revenue)*10000)/100 : 0;
  return {revenue:Math.round(revenue*100)/100,cost:Math.round(cost*100)/100,profit:Math.round(profit*100)/100,margin};
}

// Static
app.get('/health',(req,res)=>res.type('text/plain').send('OK'));
app.get('/',(req,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));

// Auth
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body||{};
  if(email===ADMIN_EMAIL && password===ADMIN_PASSWORD){
    const t=token(); sessions[t]={id:'admin',role:'admin',email:ADMIN_EMAIL,name:'Administrador Marfan'};
    return res.json({ok:true,token:t,user:sessions[t]});
  }
  res.status(401).json({error:'Credenciales incorrectas'});
});
app.post('/api/login-phone',(req,res)=>{
  const db=loadDb();
  const phone=String((req.body||{}).phone||'').replace(/\D/g,'').slice(-9);
  const u=db.users.find(x=>String(x.phone||'').replace(/\D/g,'').slice(-9)===phone && Number(x.active)!==0);
  if(!u) return res.status(401).json({error:'Teléfono no encontrado'});
  const t=token(); sessions[t]={id:u.id,role:u.role,email:u.email,phone:u.phone,name:`${u.first_name} ${u.last_name}`.trim()};
  res.json({ok:true,token:t,user:sessions[t]});
});
app.get('/api/me',requireAuth,(req,res)=>res.json({user:req.user}));
app.post('/api/logout',requireAuth,(req,res)=>{ delete sessions[(req.headers.authorization||'').replace('Bearer ','')]; res.json({ok:true}); });

// Dashboard
app.get('/api/dashboard',requireAdmin,(req,res)=>{
  const db=loadDb();
  const financials=db.events.map(e=>eventFinancial(db,e));
  const revenue=financials.reduce((s,x)=>s+x.revenue,0);
  const profit=financials.reduce((s,x)=>s+x.profit,0);
  res.json({
    events:db.events.length, users:db.users.length, clients:db.clients.length,
    revenue, profit,
    alerts:[
      ...db.events.filter(e=>db.assignments.filter(a=>a.event_id==e.id).length < Number(e.required_workers||0)).map(e=>({type:'crew',text:`Crew incompleto: ${e.name}`})),
      ...db.documents.filter(d=>d.expiry_date && d.expiry_date < today()).map(d=>({type:'doc',text:`Documento caducado: ${d.title}`}))
    ],
    monthly: db.events.map(e=>({month:e.event_date.slice(0,7), amount:eventFinancial(db,e).revenue}))
  });
});

// Generic CRUD
app.get('/api/users',requireAdmin,(req,res)=>res.json(loadDb().users));
app.post('/api/users',requireAdmin,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.users),...req.body,active:req.body.active===0?0:1}; db.users.push(item); saveDb(db); res.json(item); });
app.put('/api/users/:id',requireAdmin,(req,res)=>{ const db=loadDb(); const i=db.users.findIndex(x=>x.id==req.params.id); if(i<0)return res.status(404).json({error:'No encontrado'}); db.users[i]={...db.users[i],...req.body}; saveDb(db); res.json(db.users[i]); });
app.delete('/api/users/:id',requireAdmin,(req,res)=>{ const db=loadDb(); db.users=db.users.filter(x=>x.id!=req.params.id); saveDb(db); res.json({ok:true}); });

app.get('/api/clients',requireAdmin,(req,res)=>res.json(loadDb().clients));
app.post('/api/clients',requireAdmin,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.clients),...req.body,active:1}; db.clients.push(item); saveDb(db); res.json(item); });
app.put('/api/clients/:id',requireAdmin,(req,res)=>{ const db=loadDb(); const i=db.clients.findIndex(x=>x.id==req.params.id); if(i<0)return res.status(404).json({error:'No encontrado'}); db.clients[i]={...db.clients[i],...req.body}; saveDb(db); res.json(db.clients[i]); });

app.get('/api/events',requireAuth,(req,res)=>{ const db=loadDb(); if(req.user.role==='admin')return res.json(db.events); const ids=db.assignments.filter(a=>a.user_id==req.user.id).map(a=>a.event_id); res.json(db.events.filter(e=>ids.includes(e.id))); });
app.post('/api/events',requireAdmin,(req,res)=>{ const db=loadDb(); const c=db.clients.find(x=>x.id==req.body.client_id); const item={id:nextId(db.events),client:c?c.name:(req.body.client||''),...req.body}; db.events.push(item); saveDb(db); res.json(item); });
app.put('/api/events/:id',requireAdmin,(req,res)=>{ const db=loadDb(); const i=db.events.findIndex(x=>x.id==req.params.id); if(i<0)return res.status(404).json({error:'No encontrado'}); db.events[i]={...db.events[i],...req.body}; saveDb(db); res.json(db.events[i]); });
app.delete('/api/events/:id',requireAdmin,(req,res)=>{ const db=loadDb(); db.events=db.events.filter(x=>x.id!=req.params.id); db.assignments=db.assignments.filter(x=>x.event_id!=req.params.id); saveDb(db); res.json({ok:true}); });

app.get('/api/assignments/:eventId',requireAuth,(req,res)=>{ const db=loadDb(); res.json(db.assignments.filter(a=>a.event_id==req.params.eventId)); });
app.post('/api/assignments',requireAdmin,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.assignments),...req.body}; db.assignments.push(item); saveDb(db); res.json(item); });
app.delete('/api/assignments/:id',requireAdmin,(req,res)=>{ const db=loadDb(); db.assignments=db.assignments.filter(x=>x.id!=req.params.id); saveDb(db); res.json({ok:true}); });

app.post('/api/time-log',requireAuth,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.logs),user_id:req.user.id,timestamp:new Date().toISOString(),...req.body}; db.logs.push(item); saveDb(db); res.json(item); });

app.get('/api/gps/live',requireAdmin,(req,res)=>{
  const db=loadDb(); const date=req.query.date||today();
  const rows=[];
  for(const a of db.assignments){
    const e=db.events.find(x=>x.id==a.event_id); if(!e||e.event_date!==date)continue;
    const u=db.users.find(x=>x.id==a.user_id)||{};
    const logs=db.logs.filter(l=>l.event_id==e.id&&l.user_id==u.id);
    const last=logs[logs.length-1];
    rows.push({event:e,user:u,assignment:a,last,gps_status:last?'fichado':'pendiente',distance_m:null});
  }
  res.json({date,rows});
});

app.get('/api/finance/events',requireAdmin,(req,res)=>{ const db=loadDb(); res.json(db.events.map(e=>({event:e,...eventFinancial(db,e)}))); });
app.put('/api/finance/events/:id',requireAdmin,(req,res)=>{ const db=loadDb(); const e=db.events.find(x=>x.id==req.params.id); if(!e)return res.status(404).json({error:'No encontrado'}); Object.assign(e,req.body); saveDb(db); res.json(e); });

app.get('/api/documents',requireAdmin,(req,res)=>res.json(loadDb().documents));
app.post('/api/documents',requireAdmin,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.documents),...req.body}; db.documents.push(item); saveDb(db); res.json(item); });
app.delete('/api/documents/:id',requireAdmin,(req,res)=>{ const db=loadDb(); db.documents=db.documents.filter(x=>x.id!=req.params.id); saveDb(db); res.json({ok:true}); });

app.get('/api/production/events',requireAuth,(req,res)=>{ const db=loadDb(); res.json({events:db.events,tasks:db.productionTasks,incidents:db.incidents}); });
app.post('/api/production/tasks',requireAdmin,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.productionTasks),...req.body,completed:0}; db.productionTasks.push(item); saveDb(db); res.json(item); });
app.put('/api/production/tasks/:id',requireAuth,(req,res)=>{ const db=loadDb(); const t=db.productionTasks.find(x=>x.id==req.params.id); if(!t)return res.status(404).json({error:'No encontrado'}); Object.assign(t,req.body); saveDb(db); res.json(t); });
app.post('/api/production/incidents',requireAuth,(req,res)=>{ const db=loadDb(); const item={id:nextId(db.incidents),user_id:req.user.id,status:'abierta',created_at:new Date().toISOString(),...req.body}; db.incidents.push(item); saveDb(db); res.json(item); });

app.get('/api/delivery-notes',requireAdmin,(req,res)=>res.json(loadDb().deliveryNotes));
app.post('/api/delivery-notes/:eventId',requireAdmin,(req,res)=>{ const db=loadDb(); const e=db.events.find(x=>x.id==req.params.eventId); if(!e)return res.status(404).json({error:'No encontrado'}); const f=eventFinancial(db,e); const item={id:nextId(db.deliveryNotes),event_id:e.id,code:`ALB-${String(nextId(db.deliveryNotes)).padStart(4,'0')}`,created_at:new Date().toISOString(),client:e.client,total_amount:f.revenue,vat_amount:Math.round(f.revenue*0.21*100)/100,total_with_vat:Math.round(f.revenue*1.21*100)/100}; db.deliveryNotes.push(item); saveDb(db); res.json(item); });

app.get('/api/settings',requireAdmin,(req,res)=>res.json(loadDb().settings));
app.put('/api/settings',requireAdmin,(req,res)=>{ const db=loadDb(); db.settings={...db.settings,...req.body}; saveDb(db); res.json(db.settings); });

app.get('*',(req,res)=>{ if(req.path.startsWith('/api/'))return res.status(404).json({error:'API no encontrada'}); res.sendFile(path.join(PUBLIC_DIR,'index.html')); });

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT,'0.0.0.0',()=>console.log(`Marfan Crew Hours V49 Full Restore Clean listening on 0.0.0.0:${PORT}`));

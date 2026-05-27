
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'marfan-v50-pro.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: false }));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marfancrew.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234*';

const sessions = {};

function localDate(days=0){
  const d = new Date();
  d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function nowISO(){ return new Date().toISOString(); }
function nextId(arr){ return arr.length ? Math.max(...arr.map(x=>Number(x.id)||0))+1 : 1; }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function hoursBetween(start,end){
  if(!start || !end) return 0;
  const [sh,sm]=String(start).split(':').map(Number);
  const [eh,em]=String(end).split(':').map(Number);
  if(!Number.isFinite(sh)||!Number.isFinite(eh)) return 0;
  let s=sh*60+(sm||0), e=eh*60+(em||0);
  if(e<=s) e += 1440;
  return Math.round(((e-s)/60)*100)/100;
}
function nightHours(start,end){
  if(!start || !end) return 0;
  const [sh,sm]=String(start).split(':').map(Number);
  const [eh,em]=String(end).split(':').map(Number);
  let s=sh*60+(sm||0), e=eh*60+(em||0);
  if(e<=s)e+=1440;
  let n=0;
  for(let m=s;m<e;m+=15){
    const hour = Math.floor((m%1440)/60);
    if(hour>=22 || hour<7) n += 0.25;
  }
  return Math.round(n*100)/100;
}
function distanceMeters(lat1,lng1,lat2,lng2){
  lat1=Number(lat1);lng1=Number(lng1);lat2=Number(lat2);lng2=Number(lng2);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
  const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function docStatus(expiry){
  if(!expiry) return 'sin_caducidad';
  const diff = Math.ceil((new Date(expiry+'T12:00:00')-new Date(localDate(0)+'T12:00:00'))/86400000);
  if(diff<0) return 'caducado';
  if(diff<=30) return 'proximo_caducar';
  return 'vigente';
}
function seedDb(){
  return {
    settings:{
      company:'MARFAN CREW',
      vat:21,
      hourlyRate:18.5,
      nightRate:23.5,
      teamLeadRate:22,
      diet:15,
      kmPrice:0.28,
      gpsRadius:300,
      officeWhatsapp:'+34635371634',
      minimumHours:4,
      earlyGraceMinutes:15
    },
    rates:[
      {id:1,role:'Stagehand / Carga y descarga',hourly_rate:18.5,night_rate:23.5,diet:15,active:1},
      {id:2,role:'Jefe de equipo',hourly_rate:22,night_rate:28,diet:15,active:1},
      {id:3,role:'Técnico de sonido',hourly_rate:24,night_rate:30,diet:15,active:1},
      {id:4,role:'Técnico de iluminación',hourly_rate:24,night_rate:30,diet:15,active:1},
      {id:5,role:'Runner',hourly_rate:18.5,night_rate:23.5,diet:15,active:1},
      {id:6,role:'Limpieza',hourly_rate:18.5,night_rate:23.5,diet:15,active:1},
      {id:7,role:'Auxiliar de limpieza',hourly_rate:18.5,night_rate:23.5,diet:15,active:1}
    ],
    users:[
      {id:1,email:'jefe.demo@marfancrew.local',role:'jefe',first_name:'Jorge',last_name:'Jefe Demo',phone:'666333444',services:'Jefe de equipo / Producción',availability:'disponible',active:1,internal_hour_cost:16,internal_night_cost:20},
      {id:2,email:'operario.demo@marfancrew.local',role:'operario',first_name:'Óscar',last_name:'Stagehand Demo',phone:'666111222',services:'Stagehand / Carga y descarga',availability:'disponible',active:1,internal_hour_cost:12,internal_night_cost:15},
      {id:3,email:'tecnico.sonido@marfancrew.local',role:'operario',first_name:'Iván',last_name:'Sonido Demo',phone:'666222333',services:'Técnico de sonido',availability:'disponible',active:1,internal_hour_cost:16,internal_night_cost:20},
      {id:4,email:'limpieza.demo@marfancrew.local',role:'operario',first_name:'Sol',last_name:'Limpieza Demo',phone:'666555777',services:'Limpieza',availability:'disponible',active:1,internal_hour_cost:10,internal_night_cost:13},
      {id:5,email:'runner.demo@marfancrew.local',role:'operario',first_name:'Pablo',last_name:'Runner Demo',phone:'666777888',services:'Runner',availability:'parcial',active:1,internal_hour_cost:12,internal_night_cost:15}
    ],
    clients:[
      {id:1,name:'FYCMA Demo',legal_name:'Palacio de Ferias Demo SL',cif:'B92000001',contact:'Responsable Producción',phone:'600222000',email:'produccion@fycmademo.com',address:'Av. Ortega y Gasset, Málaga',fixed_hour_discount:0,percent_hour_discount:3,active:1,notes:'Cliente demo corporate'},
      {id:2,name:'Festival Costa Demo',legal_name:'Festival Costa Demo SL',cif:'B93000002',contact:'Dirección Técnica',phone:'600333000',email:'tech@festivaldemo.com',address:'Málaga',fixed_hour_discount:0,percent_hour_discount:0,active:1,notes:'Cliente demo festival'}
    ],
    events:[
      {id:1,name:'Evento Demo Noche Festival',client_id:2,client:'Festival Costa Demo',location:'Málaga Centro',event_date:localDate(0),start_time:'22:00',end_time:'05:00',latitude:36.7213,longitude:-4.4214,status:'programado',operational_status:'crew_completo',required_workers:4,required_team_leads:1,hourly_rate:18.5,night_rate:23.5,diet_price:15,km_amount:0,estimated_external_cost:120,estimated_transport_cost:35,estimated_other_cost:0,payment_status:'pendiente',notes:'Evento demo nocturno con nocturnidad automática'},
      {id:2,name:'Montaje Corporate Demo',client_id:1,client:'FYCMA Demo',location:'FYCMA Málaga',event_date:localDate(1),start_time:'08:00',end_time:'14:00',latitude:36.7039,longitude:-4.4626,status:'programado',operational_status:'crew_parcial',required_workers:5,required_team_leads:1,hourly_rate:18.5,night_rate:23.5,diet_price:15,km_amount:12.6,estimated_external_cost:0,estimated_transport_cost:20,estimated_other_cost:0,payment_status:'pendiente',notes:'Evento demo montaje corporativo'},
      {id:3,name:'Evento Realizado Demo A4',client_id:1,client:'FYCMA Demo',location:'Auditorio Demo',event_date:localDate(-3),start_time:'09:00',end_time:'13:00',latitude:36.70,longitude:-4.46,status:'realizado',operational_status:'finalizado',required_workers:3,required_team_leads:1,hourly_rate:18.5,night_rate:23.5,diet_price:15,km_amount:0,estimated_external_cost:40,estimated_transport_cost:15,estimated_other_cost:0,payment_status:'facturado',notes:'Evento demo realizado para albarán'}
    ],
    assignments:[
      {id:1,event_id:1,user_id:1,service_role:'Jefe de equipo',is_team_lead:1,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:22,billable_night_rate:28,apply_night:1,apply_diet:1},
      {id:2,event_id:1,user_id:2,service_role:'Stagehand / Carga y descarga',is_team_lead:0,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:18.5,billable_night_rate:23.5,apply_night:1,apply_diet:1},
      {id:3,event_id:1,user_id:3,service_role:'Técnico de sonido',is_team_lead:0,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:24,billable_night_rate:30,apply_night:1,apply_diet:1},
      {id:4,event_id:1,user_id:4,service_role:'Limpieza',is_team_lead:0,planned_start:'22:00',planned_end:'05:00',billable_hourly_rate:18.5,billable_night_rate:23.5,apply_night:1,apply_diet:1},
      {id:5,event_id:3,user_id:1,service_role:'Jefe de equipo',is_team_lead:1,planned_start:'09:00',planned_end:'13:00',billable_hourly_rate:22,billable_night_rate:28,apply_night:1,apply_diet:0},
      {id:6,event_id:3,user_id:2,service_role:'Stagehand / Carga y descarga',is_team_lead:0,planned_start:'09:00',planned_end:'13:00',billable_hourly_rate:18.5,billable_night_rate:23.5,apply_night:1,apply_diet:0}
    ],
    logs:[
      {id:1,event_id:3,user_id:1,type:'entrada',latitude:36.70,longitude:-4.46,timestamp:localDate(-3)+'T09:00:00.000Z'},
      {id:2,event_id:3,user_id:1,type:'salida',latitude:36.70,longitude:-4.46,timestamp:localDate(-3)+'T13:00:00.000Z'},
      {id:3,event_id:3,user_id:2,type:'entrada',latitude:36.70,longitude:-4.46,timestamp:localDate(-3)+'T08:40:00.000Z'},
      {id:4,event_id:3,user_id:2,type:'salida',latitude:36.70,longitude:-4.46,timestamp:localDate(-3)+'T12:30:00.000Z'}
    ],
    documents:[
      {id:1,user_id:1,doc_type:'PRL',title:'PRL Jorge Demo',file_url:'',issue_date:localDate(-300),expiry_date:localDate(20),notes:'Próximo a caducar'},
      {id:2,user_id:2,doc_type:'DNI/NIE',title:'DNI Óscar Demo',file_url:'',issue_date:localDate(-800),expiry_date:localDate(365),notes:'Vigente'}
    ],
    productionTasks:[
      {id:1,event_id:1,phase:'carga',title:'Carga de material',description:'Verificar EPIs y herramientas',completed:0,priority:'normal'},
      {id:2,event_id:1,phase:'montaje',title:'Montaje técnico',description:'Montaje según planning',completed:0,priority:'alta'},
      {id:3,event_id:1,phase:'pruebas',title:'Pruebas técnicas',description:'Audio, iluminación y vídeo',completed:0,priority:'alta'},
      {id:4,event_id:1,phase:'desmontaje',title:'Desmontaje',description:'Recogida e inventario básico',completed:0,priority:'normal'}
    ],
    incidents:[
      {id:1,event_id:1,user_id:1,severity:'media',title:'Pendiente confirmar acceso carga',description:'Confirmar acceso con producción local',status:'abierta',created_at:nowISO()}
    ],
    deliveryNotes:[],
    clientSignatures:[]
  }
}
function loadDb(){
  if(!fs.existsSync(DB_FILE)){
    const db = seedDb();
    saveDb(db);
    return db;
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch(e){ const db=seedDb(); saveDb(db); return db; }
}
function saveDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function getUser(req){
  const auth = req.headers.authorization || '';
  const t = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return t && sessions[t] ? sessions[t] : null;
}
function requireAuth(req,res,next){ const u=getUser(req); if(!u) return res.status(401).json({error:'No autenticado'}); req.user=u; next(); }
function requireAdmin(req,res,next){ const u=getUser(req); if(!u || u.role!=='admin') return res.status(403).json({error:'Solo administrador'}); req.user=u; next(); }
function eventFinancial(db,e){
  const ass = db.assignments.filter(a=>a.event_id==e.id);
  let revenue=0, cost=0, hours=0, night=0, diets=0;
  for(const a of ass){
    const h=Math.max(Number(db.settings.minimumHours||4),hoursBetween(a.planned_start||e.start_time,a.planned_end||e.end_time));
    const nh=a.apply_night ? nightHours(a.planned_start||e.start_time,a.planned_end||e.end_time) : 0;
    const normal=Math.max(0,h-nh);
    revenue += normal*Number(a.billable_hourly_rate||e.hourly_rate||18.5) + nh*Number(a.billable_night_rate||e.night_rate||23.5);
    if(a.apply_diet){ revenue += Number(e.diet_price||15); diets += Number(e.diet_price||15); }
    const u=db.users.find(x=>x.id==a.user_id)||{};
    cost += h*Number(u.internal_hour_cost||12);
    hours+=h; night+=nh;
  }
  revenue += Number(e.km_amount||0);
  cost += Number(e.estimated_external_cost||0)+Number(e.estimated_transport_cost||0)+Number(e.estimated_other_cost||0);
  const profit=revenue-cost, margin=revenue?Math.round((profit/revenue)*10000)/100:0;
  return {revenue:round(revenue),cost:round(cost),profit:round(profit),margin,hours:round(hours),night:round(night),diets:round(diets),vat:round(revenue*0.21),total_vat:round(revenue*1.21)};
}
function round(n){ return Math.round(Number(n||0)*100)/100; }
function clean(obj){ return JSON.parse(JSON.stringify(obj)); }

// STATIC
app.get('/health',(req,res)=>res.type('text/plain').send('OK'));
app.get('/',(req,res)=>res.sendFile(path.join(PUBLIC_DIR,'index.html')));

// AUTH
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
app.post('/api/logout',requireAuth,(req,res)=>{const t=(req.headers.authorization||'').replace('Bearer ',''); delete sessions[t]; res.json({ok:true});});

// API
app.get('/api/dashboard',requireAdmin,(req,res)=>{
  const db=loadDb();
  const financials=db.events.map(e=>eventFinancial(db,e));
  const revenue=financials.reduce((s,x)=>s+x.revenue,0), profit=financials.reduce((s,x)=>s+x.profit,0);
  const monthMap={};
  db.events.forEach(e=>{ const m=e.event_date.slice(0,7); monthMap[m]=(monthMap[m]||0)+eventFinancial(db,e).revenue; });
  res.json({
    events:db.events.length, users:db.users.length, clients:db.clients.length, revenue:round(revenue), profit:round(profit),
    active:db.events.filter(e=>e.status!=='realizado'&&e.status!=='cancelado').length,
    done:db.events.filter(e=>e.status==='realizado').length,
    alerts:[
      ...db.events.filter(e=>db.assignments.filter(a=>a.event_id==e.id).length < Number(e.required_workers||0)).map(e=>({type:'crew',text:`Crew incompleto: ${e.name}`})),
      ...db.documents.filter(d=>docStatus(d.expiry_date)!=='vigente').map(d=>({type:'doc',text:`Documento ${docStatus(d.expiry_date)}: ${d.title}`}))
    ],
    monthly:Object.entries(monthMap).map(([month,amount])=>({month,amount:round(amount)}))
  });
});
app.get('/api/export',requireAdmin,(req,res)=>res.json(loadDb()));
app.post('/api/reset-demo',requireAdmin,(req,res)=>{ const db=seedDb(); saveDb(db); res.json({ok:true}); });

for (const name of ['users','clients','events','assignments','documents','productionTasks','incidents','deliveryNotes','rates']) {
  app.get('/api/'+name,requireAuth,(req,res)=>{
    const db=loadDb();
    if(name==='events' && req.user.role!=='admin'){
      const ids=db.assignments.filter(a=>a.user_id==req.user.id).map(a=>a.event_id);
      return res.json(db.events.filter(e=>ids.includes(e.id)));
    }
    if(req.user.role!=='admin' && name!=='events') return res.status(403).json({error:'Solo administrador'});
    res.json(db[name]||[]);
  });
  app.post('/api/'+name,requireAdmin,(req,res)=>{
    const db=loadDb(); const item={id:nextId(db[name]||[]),...req.body};
    if(name==='events'){
      const c=db.clients.find(x=>x.id==item.client_id);
      item.client=c?c.name:(item.client||'');
    }
    db[name].push(item); saveDb(db); res.json(item);
  });
  app.put('/api/'+name+'/:id',requireAdmin,(req,res)=>{
    const db=loadDb(); const arr=db[name]||[]; const i=arr.findIndex(x=>x.id==req.params.id);
    if(i<0)return res.status(404).json({error:'No encontrado'});
    arr[i]={...arr[i],...req.body}; saveDb(db); res.json(arr[i]);
  });
  app.delete('/api/'+name+'/:id',requireAdmin,(req,res)=>{
    const db=loadDb(); db[name]=(db[name]||[]).filter(x=>x.id!=req.params.id); saveDb(db); res.json({ok:true});
  });
}
app.get('/api/assignments/event/:eventId',requireAuth,(req,res)=>{
  const db=loadDb(); res.json(db.assignments.filter(a=>a.event_id==req.params.eventId));
});
app.post('/api/time-log',requireAuth,(req,res)=>{
  const db=loadDb(); const item={id:nextId(db.logs),user_id:req.user.id,timestamp:nowISO(),...req.body}; db.logs.push(item); saveDb(db); res.json(item);
});
app.get('/api/gps/live',requireAdmin,(req,res)=>{
  const db=loadDb(); const date=req.query.date||localDate(0), radius=Number(req.query.radius||db.settings.gpsRadius||300);
  const rows=[];
  for(const a of db.assignments){
    const e=db.events.find(x=>x.id==a.event_id); if(!e||e.event_date!==date)continue;
    const u=db.users.find(x=>x.id==a.user_id)||{};
    const logs=db.logs.filter(l=>l.event_id==e.id&&l.user_id==u.id);
    const last=logs[logs.length-1];
    const dist=last?distanceMeters(e.latitude,e.longitude,last.latitude,last.longitude):null;
    rows.push({event:e,user:u,assignment:a,last,distance_m:dist,gps_status:last?(dist===null?'sin_gps':dist<=radius?'en_evento':'fuera_radio'):'pendiente'});
  }
  res.json({date,radius,rows});
});
app.get('/api/finance/events',requireAdmin,(req,res)=>{ const db=loadDb(); res.json(db.events.map(e=>({event:e,...eventFinancial(db,e)}))); });
app.post('/api/delivery-notes/generate/:eventId',requireAdmin,(req,res)=>{
  const db=loadDb(); const e=db.events.find(x=>x.id==req.params.eventId); if(!e)return res.status(404).json({error:'Evento no encontrado'});
  const f=eventFinancial(db,e); const item={id:nextId(db.deliveryNotes),event_id:e.id,code:`ALB-${String(nextId(db.deliveryNotes)).padStart(4,'0')}`,created_at:nowISO(),client:e.client,total_amount:f.revenue,vat_amount:f.vat,total_with_vat:f.total_vat,lines:db.assignments.filter(a=>a.event_id==e.id).map(a=>({user_id:a.user_id,role:a.service_role,hours:Math.max(4,hoursBetween(a.planned_start,a.planned_end)),rate:a.billable_hourly_rate}))};
  db.deliveryNotes.push(item); saveDb(db); res.json(item);
});
app.get('/api/settings',requireAdmin,(req,res)=>res.json(loadDb().settings));
app.put('/api/settings',requireAdmin,(req,res)=>{ const db=loadDb(); db.settings={...db.settings,...req.body}; saveDb(db); res.json(db.settings); });

app.get('*',(req,res)=>{ if(req.path.startsWith('/api/'))return res.status(404).json({error:'API no encontrada'}); res.sendFile(path.join(PUBLIC_DIR,'index.html')); });

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT,'0.0.0.0',()=>console.log(`Marfan Crew Hours V51 Enterprise V46 Core listening on 0.0.0.0:${PORT}`));

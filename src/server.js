
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const DB_FILE = path.join(DATA_DIR, 'marfan-crew-db.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function mkdirp(dir){ try{ fs.mkdirSync(dir,{recursive:true}); }catch(e){} }
function ensureDirs(){ [DATA_DIR,'uploads','signatures','documents','exports','backups','logs'].forEach(d=>mkdirp(d===DATA_DIR?d:path.join(DATA_DIR,d))); }
function now(){ return new Date().toISOString(); }
function id(prefix){ return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2,8); }

function defaultDb(){
  return {
    meta:{app:'Marfan Crew',version:'2.1.3',created_at:now(),updated_at:now()},
    users:[
      {id:'admin-1',role:'super_admin',name:'Administrador Marfan',email:'admin@marfan.local',phone:'',password:'Admin1234!',active:true,is_team_lead:false,created_at:now()},
      {id:'op-1',role:'operator',name:'Operario Demo',email:'operario@marfan.local',phone:'600000000',password:'Marfan1234*',active:true,is_team_lead:false,created_at:now()}
    ],
    clients:[], events:[], assignments:[], checkins:[], signatures:[], documents:[],
    rates:[
      {id:'rate-1',name:'Operario carga/descarga',price_hour:12,night_price_hour:15,diet:15,km_price:0.28},
      {id:'rate-2',name:'Jefe de equipo',price_hour:15,night_price_hour:18,diet:15,km_price:0.28}
    ],
    settlements:[], passwords:[], audit_logs:[]
  };
}
function mergeDb(db){
  const d=defaultDb();
  for(const k of Object.keys(d)){ if(db[k]===undefined) db[k]=d[k]; }
  db.meta = Object.assign(d.meta, db.meta||{}, {version:'2.1.3',updated_at:now()});
  return db;
}
function readDb(){
  ensureDirs();
  if(!fs.existsSync(DB_FILE)){ const db=defaultDb(); fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2)); return db; }
  try{return mergeDb(JSON.parse(fs.readFileSync(DB_FILE,'utf8')));}
  catch(e){ try{fs.copyFileSync(DB_FILE,path.join(DATA_DIR,'backups','corrupt-'+Date.now()+'.json'));}catch(_){} const db=defaultDb(); fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2)); return db; }
}
function writeDb(db){ db.meta.updated_at=now(); fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2)); }
function send(res,status,data,type='application/json'){
  res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'});
  type==='application/json'?res.end(JSON.stringify(data)):res.end(data);
}
function body(req){return new Promise(resolve=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){resolve({})}})})}
function cleanUser(u){const x={...u}; delete x.password; return x;}
const sessions = new Map();
function makeToken(){return crypto.randomBytes(24).toString('hex')}
function userFromReq(req){ const t=String(req.headers.authorization||'').replace('Bearer ','').trim(); return sessions.get(t)||null; }
function requireAuth(req,res){const u=userFromReq(req); if(!u){send(res,401,{ok:false,error:'No autenticado'});return null;} return u;}
function toMs(date,time){ const d=String(date||'').slice(0,10)||new Date().toISOString().slice(0,10); const t=String(time||'00:00').slice(0,5); const [h,m]=t.split(':').map(Number); return new Date(d+'T00:00:00').getTime()+(((h||0)*60+(m||0))*60000); }
function overlaps(a,b,c,d){ return a<d && c<b; }
function conflicts(db,eventId,userId,date,start,end){
  let s=toMs(date,start), e=toMs(date,end); if(e<=s)e+=86400000;
  return db.assignments.filter(a=>{
    if(a.event_id===eventId || a.user_id!==userId)return false;
    const ev=db.events.find(x=>x.id===a.event_id); if(!ev)return false;
    let as=toMs(ev.date,a.start_time||ev.start_time), ae=toMs(ev.date,a.end_time||ev.end_time); if(ae<=as)ae+=86400000;
    return overlaps(s,e,as,ae);
  });
}
function log(db,user,action,extra={}){ db.audit_logs.push(Object.assign({id:id('log'),user_id:user&&user.id,action,at:now()},extra)); }
function serve(req,res){
  let f=req.url.split('?')[0]; if(f==='/')f='/index.html'; f=f.replace(/\.\./g,'');
  const full=path.join(PUBLIC_DIR,f);
  if(!fs.existsSync(full)||fs.statSync(full).isDirectory()) return send(res,404,'404 Not Found','text/plain');
  const ext=path.extname(full).toLowerCase(); const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json'};
  send(res,200,fs.readFileSync(full),types[ext]||'application/octet-stream');
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS')return send(res,200,{ok:true});
    if(req.url==='/health')return send(res,200,{status:'ok',app:'Marfan Crew',version:'2.1.3',data_dir:DATA_DIR,db_exists:fs.existsSync(DB_FILE),time:now()});
    if(req.url==='/api/login'&&req.method==='POST'){
      const b=await body(req), db=readDb();
      const login=String(b.login||'').trim().toLowerCase(), pass=String(b.password||''), mode=String(b.mode||'admin');
      const u=db.users.find(u=>{
        const ml=String(u.email||'').toLowerCase()===login || String(u.phone||'').toLowerCase()===login;
        const mr=mode==='operator'?['operator','team_lead'].includes(u.role):['super_admin','admin'].includes(u.role);
        return ml && mr && u.password===pass && u.active!==false;
      });
      if(!u)return send(res,401,{ok:false,error:'Credenciales incorrectas'});
      const t=makeToken(); sessions.set(t,cleanUser(u)); return send(res,200,{ok:true,token:t,user:cleanUser(u)});
    }
    if(req.url==='/api/data'){ const u=requireAuth(req,res); if(!u)return; const db=readDb(); return send(res,200,{ok:true,db:{...db,users:db.users.map(cleanUser)}}); }
    if(req.url==='/api/bootstrap'){ const db=readDb(); return send(res,200,{ok:true,version:'2.1.3',counts:Object.fromEntries(['users','clients','events','assignments','checkins','documents','rates','settlements'].map(k=>[k,(db[k]||[]).length]))}); }
    if(req.url==='/api/save'&&req.method==='POST'){
      const u=requireAuth(req,res); if(!u)return; const b=await body(req), db=readDb(), table=b.table, item=b.item||{};
      const allowed=['clients','events','users','rates','documents','passwords','settlements','checkins'];
      if(!allowed.includes(table)) return send(res,400,{ok:false,error:'Tabla no permitida'});
      if(table==='users' && !item.password) item.password='Marfan1234*';
      if(table==='users' && item.is_team_lead) item.role='team_lead';
      if(!item.id)item.id=id(table.slice(0,3));
      const idx=db[table].findIndex(x=>x.id===item.id);
      if(idx>=0) db[table][idx]=Object.assign(db[table][idx],item,{updated_at:now()}); else db[table].push(Object.assign(item,{created_at:now()}));
      log(db,u,'save_'+table,{item_id:item.id}); writeDb(db); return send(res,200,{ok:true,item});
    }
    if(req.url==='/api/delete'&&req.method==='POST'){
      const u=requireAuth(req,res); if(!u)return; const b=await body(req), db=readDb(), table=b.table, itemId=b.id;
      if(!db[table]) return send(res,400,{ok:false,error:'Tabla no encontrada'});
      db[table]=db[table].filter(x=>x.id!==itemId); log(db,u,'delete_'+table,{item_id:itemId}); writeDb(db); return send(res,200,{ok:true});
    }
    if(req.url==='/api/available-users'&&req.method==='POST'){
      const u=requireAuth(req,res); if(!u)return; const b=await body(req), db=readDb(); const ev=db.events.find(e=>e.id===b.event_id)||b;
      const users=db.users.filter(x=>['operator','team_lead'].includes(x.role)&&x.active!==false).map(x=>{ const c=conflicts(db,ev.id||'',x.id,ev.date,ev.start_time,ev.end_time); return {...cleanUser(x),available:c.length===0,conflicts:c}; });
      return send(res,200,{ok:true,users});
    }
    if(req.url==='/api/assign'&&req.method==='POST'){
      const u=requireAuth(req,res); if(!u)return; const b=await body(req), db=readDb(); const ev=db.events.find(e=>e.id===b.event_id); if(!ev)return send(res,404,{ok:false,error:'Evento no encontrado'});
      const c=conflicts(db,ev.id,b.user_id,ev.date,b.start_time||ev.start_time,b.end_time||ev.end_time);
      if(c.length)return send(res,409,{ok:false,error:'Operario no disponible: horario solapado',conflicts:c});
      const asg={id:id('asg'),event_id:ev.id,user_id:b.user_id,role:b.role||'operario',is_team_lead:!!b.is_team_lead,start_time:b.start_time||ev.start_time,end_time:b.end_time||ev.end_time,status:'asignado',created_at:now()};
      db.assignments.push(asg); log(db,u,'assign_operator',{event_id:ev.id,operator_id:b.user_id}); writeDb(db); return send(res,200,{ok:true,assignment:asg});
    }
    if(req.url==='/api/backup'&&req.method==='POST'){
      const u=requireAuth(req,res); if(!u)return; const stamp=now().replace(/[:.]/g,'-'), out=path.join(DATA_DIR,'backups','backup-'+stamp+'.json');
      fs.copyFileSync(DB_FILE,out); return send(res,200,{ok:true,backup:out});
    }
    return serve(req,res);
  }catch(e){ console.error('[ERROR]',e); return send(res,500,{ok:false,error:e.message}); }
});
ensureDirs(); readDb();
server.listen(PORT,HOST,()=>console.log(`Marfan Crew V2.1.3 online ${HOST}:${PORT} DATA=${DATA_DIR}`));

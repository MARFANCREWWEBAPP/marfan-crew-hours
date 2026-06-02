

function localDateStr(date=new Date()){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseLocalDate(value){
  if(!value) return new Date();
  const [y,m,d]=String(value).slice(0,10).split('-').map(Number);
  return new Date(y,(m||1)-1,d||1,12,0,0,0);
}
function addLocalDays(value,days){
  const d=parseLocalDate(value);
  d.setDate(d.getDate()+Number(days||0));
  return localDateStr(d);
}
function monthStartLocal(value){
  const d=value?parseLocalDate(value):new Date();
  return new Date(d.getFullYear(),d.getMonth(),1,12,0,0,0);
}
function sameLocalMonth(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth();
}
function formatLocalDate(value){
  if(!value) return '';
  const d=parseLocalDate(value);
  return d.toLocaleDateString('es-ES');
}

let mapsDetectTimer=null;
let state={user:null,view:'dashboard',events:[],users:[],clients:[],notes:[],rates:[],myCalendar:[],currentEvent:null,settings:{},wizard:null,calendarDate:new Date(),notesCalendarDate:new Date(),realizadosFilters:{}};
const $=s=>document.querySelector(s);

async function api(url,opts={}){
  const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  if(!r.ok){let e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||r.statusText)}
  return r.json();
}
function logoTag(cls='login-logo'){return `<img class="${cls}" src="/assets/logo.png" onerror="this.style.display='none'">`}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function fullName(u){return `${u.first_name||''} ${u.last_name||''}`.trim()+(u.nickname?` (${u.nickname})`:'');}

function fmtSignDateTime(v){
  if(!v) return 'Pendiente';
  try{return new Date(v).toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'})}catch(e){return v}
}
function fmtSignTime(v){
  if(!v) return 'Pendiente';
  try{return new Date(v).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}catch(e){return v}
}

function contactOffice(){
  const text=encodeURIComponent('Hola oficina, soy operario de Marfan Crew. Necesito contactar con vosotros.');
  window.open('https://wa.me/34635371634?text='+text,'_blank');
}

async function init(){const me=await api('/api/me');state.user=me.user;render();}
function render(){if(!state.user)return renderLogin();renderApp();}


function renderLogin(){
  document.getElementById('app').innerHTML=`<div class="login"><div class="login-card">${logoTag()}<div class="logo-text">MARFAN CREW</div><div class="sub">Control profesional de crew, horas y albaranes</div>
  <div class="card" style="box-shadow:none;margin-bottom:14px">
    <h3>Administrador</h3>
    <form id="loginForm"><input name="email" placeholder="Email administrador"><input name="password" type="password" placeholder="Contraseña"><button>Entrar como admin</button></form>
  </div>
  <div class="card" style="box-shadow:none;margin-bottom:14px">
    <h3>Operario / Jefe de equipo</h3>
    <p class="muted">Acceso rápido solo con el número de teléfono registrado.</p>
    <form id="phoneLoginForm"><input name="phone" inputmode="tel" placeholder="Teléfono, ejemplo 635371634"><button class="ok">Entrar con teléfono</button></form>
  </div>
  <button class="linkbtn" onclick="forgot()">¿Has olvidado tu contraseña?</button><p class="muted" style="font-size:12px;text-align:center">Los operarios y jefes entran con su teléfono. El admin entra con email y contraseña.</p></div></div>`;
  $('#loginForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const res=await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
      state.user=res.user; render();
    }catch(err){alert(err.message)}
  };
  $('#phoneLoginForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const res=await api('/api/login-phone',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
      state.user=res.user; render();
    }catch(err){alert(err.message)}
  };
}

async function forgot(){await api('/api/forgot-password',{method:'POST',body:JSON.stringify({})});alert('Solicitud registrada. Contacta con administración.');}

function label(v){return {
  dashboard:'Dashboard',
  control:'Control diario',
  operaciones:'',
  gps:'GPS Live',
  produccion:'',
  finanzas:'Finanzas Pro',
  documentacion:'Documentación',
  clientes:'Clientes',
  informes:'Informes PDF',
  eventos:'Calendario eventos',
  realizados:'Eventos realizados',
  operarios:'Operarios',
  tarifas:'Tarifas',
  operario:'Vista operario',
  albaranes:'Albaranes evento',
  passwords:'Contraseñas',
  config:'Ajustes ERP'
}[v]||v}
function menu(){
  const role = state.user ? state.user.role : '';
  const items = role === 'admin'
    ? ['dashboard','control','operaciones','clientes','informes','eventos','realizados','operarios','tarifas','gps','produccion','finanzas','documentacion','operario','albaranes','passwords','config']
    : ['operario'];
  return items.map(v=>`<button class="${state.view===v?'active':''}" onclick="go('${v}')">${label(v)}</button>`).join('')
}
async function load(extra=''){
  state.events=await api('/api/events'+extra).catch(()=>[]);
  state.users=await api('/api/users').catch(()=>[]);
  state.clients=await api('/api/clients').catch(()=>[]);
  state.notes=await api('/api/event-delivery-notes').catch(()=>[]);
  state.rates=await api('/api/job-rates').catch(()=>[]);
  state.myCalendar=await api('/api/my-calendar').catch(()=>[]);
  state.currentEvent=(await api('/api/my-current-event').catch(()=>({event:null}))).event;
  state.settings=await api('/api/settings').catch(()=>({vat_percent:'21',show_vat:'1',company_name:'MARFAN CREW'}));
}
async function go(v){
  if(state.user && state.user.role !== 'admin') v='operario';
  state.view=v;
  await load();
  renderApp();
}


async function renderApp(){
  if(state.user && state.user.role !== 'admin') state.view='operario';
  await load();
  document.getElementById('app').innerHTML=`<div class="app"><aside class="side">${logoTag('brand-logo')}<div class="brand">MARFAN CREW</div><div class="muted">${state.user.email||state.user.phone||''}</div><br><div class="nav">${menu()}</div><br><button class="secondary" onclick="logout()">Salir</button></aside><main class="main"><div class="top"><h1>${label(state.view)}</h1><span class="badge">${state.user.role}</span></div><div id="content"></div><div id="modalRoot"></div></main></div>`;
  const routes={dashboard:viewDashboard,control:viewDailyControl,operaciones:viewOperations,clientes:viewClients,informes:viewReportsV562,eventos:viewCalendar,realizados:viewRealizados,operarios:viewUsers,tarifas:viewRates,gps:viewGpsLive,produccion:viewProductionLive,finanzas:viewFinancePro,documentacion:viewDocuments,operario:viewOperario,albaranes:viewNotes,passwords:viewPasswords,config:viewConfig};
  try{ await (routes[state.view]||viewDashboard)(); }
  catch(err){ console.error('VIEW_RENDER_ERROR',err); const c=document.getElementById('content'); if(c)c.innerHTML=`<div class="card"><h3>Error cargando menú</h3><p class="muted">${esc(err.message||err)}</p><button onclick="go('dashboard')">Volver al dashboard</button></div>`; }
}

async function logout(){await api('/api/logout',{method:'POST'});state.user=null;render();}


function viewDashboard(){
  const now=new Date();
  const year=now.getFullYear();
  const monthKeyNow=`${year}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const settings=state.settings||{};
  const vat=Number(settings.vat_percent||21);
  const calcVat=(net)=>Math.round((Number(net||0)*(1+vat/100))*100)/100;

  const notes=Array.isArray(state.notes)?state.notes:[];
  const events=Array.isArray(state.events)?state.events:[];
  const users=Array.isArray(state.users)?state.users:[];
  const rates=Array.isArray(state.rates)?state.rates:[];

  const monthly=notes.filter(n=>String(n.event_date||'').slice(0,7)===monthKeyNow).reduce((s,n)=>s+Number(n.grand_total||0),0);
  const monthlyVat=notes.filter(n=>String(n.event_date||'').slice(0,7)===monthKeyNow).reduce((s,n)=>s+Number(n.grand_total_vat||calcVat(n.grand_total)),0);
  const annual=notes.filter(n=>String(n.event_date||'').slice(0,4)===String(year)).reduce((s,n)=>s+Number(n.grand_total||0),0);
  const annualVat=notes.filter(n=>String(n.event_date||'').slice(0,4)===String(year)).reduce((s,n)=>s+Number(n.grand_total_vat||calcVat(n.grand_total)),0);
  const total=notes.reduce((s,n)=>s+Number(n.grand_total||0),0);
  const totalVat=notes.reduce((s,n)=>s+Number(n.grand_total_vat||calcVat(n.grand_total)),0);

  const activeEvents=events.filter(e=>e.status!=='realizado'&&e.status!=='cancelado').length;
  const doneEvents=events.filter(e=>e.status==='realizado').length;
  const canceledEvents=events.filter(e=>e.status==='cancelado').length;
  const activeWorkers=users.filter(u=>u.role!=='admin'&&Number(u.active)!==0).length;
  const inactiveWorkers=users.filter(u=>u.role!=='admin'&&Number(u.active)===0).length;
  const pendingSigns=notes.filter(n=>!n.client_signed).length;

  const byMonth={};
  for(const n of notes){
    const k=String(n.event_date||'').slice(0,7)||'Sin fecha';
    if(!byMonth[k]) byMonth[k]={net:0,vat:0};
    byMonth[k].net+=Number(n.grand_total||0);
    byMonth[k].vat+=Number(n.grand_total_vat||calcVat(n.grand_total));
  }
  const monthRows=Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12).map(([m,t])=>`<tr><td data-label="Mes">${m}</td><td data-label="Base"><b>${t.net.toFixed(2)} € + IVA</b></td><td data-label="Total">${t.vat.toFixed(2)} €</td></tr>`).join('');

  const upcoming=events
    .filter(e=>e.status!=='realizado'&&e.status!=='cancelado')
    .sort((a,b)=>String(a.event_date||'').localeCompare(String(b.event_date||'')) || String(a.start_time||'').localeCompare(String(b.start_time||'')))
    .slice(0,10)
    .map(e=>`<tr><td data-label="Fecha">${formatLocalDate(e.event_date)}<br>${esc(e.start_time||'')}-${esc(e.end_time||'')}</td><td data-label="Evento"><b>${esc(e.name||'')}</b><br><span class="muted">${esc(e.client||'')}</span></td><td data-label="Lugar">${esc(e.location||'')}</td><td data-label="Acción"><button onclick="openEventDetail(${e.id})">Abrir</button></td></tr>`)
    .join('');

  const lastNotes=notes
    .slice()
    .sort((a,b)=>String(b.created_at||b.event_date||'').localeCompare(String(a.created_at||a.event_date||'')))
    .slice(0,10)
    .map(n=>`<tr><td data-label="Fecha">${formatLocalDate(n.event_date)}</td><td data-label="Evento">${esc(n.event_name||'')}</td><td data-label="Base">${Number(n.grand_total||0).toFixed(2)} € + IVA</td><td data-label="Total"><b>${Number(n.grand_total_vat||calcVat(n.grand_total)).toFixed(2)} €</b></td><td data-label="Firma">${n.client_signed?'Firmado':'Pendiente'}</td><td data-label="Acción"><button onclick="printEventNote(${n.id})">PDF</button></td></tr>`)
    .join('');

  const chartMonths=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  const chartData=chartMonths.map(k=>{
    const monthNotes=notes.filter(n=>String(n.event_date||'').slice(0,7)===k);
    const base=monthNotes.reduce((s,n)=>s+Number(n.grand_total||0),0);
    const total=monthNotes.reduce((s,n)=>s+Number(n.grand_total_vat||calcVat(n.grand_total)),0);
    const iva=Math.max(0,total-base);
    return {key:k,base,total,iva};
  });
  const max=Math.max(100,...chartData.map(x=>x.total));
  const bars=chartData.map((d,i)=>{
    const h=Math.max(4,Math.round((d.total/max)*150));
    const mes=String(i+1).padStart(2,'0');
    return `<div class="dashbar-wrap">
      <div class="dashbar-tooltip"><b>${mes}/${year}</b><br>Base: ${d.base.toFixed(2)} € + IVA<br>IVA: ${d.iva.toFixed(2)} €<br>Total: ${d.total.toFixed(2)} €</div>
      <div style="height:160px;display:flex;align-items:flex-end"><div class="dashbar" style="height:${h}px"></div></div>
      <small>${mes}</small>
    </div>`;
  }).join('');

  $('#content').innerHTML=`<div class="cards3">
    <div class="card"><div class="muted">Mes base</div><div class="kpi">${monthly.toFixed(2)} €</div><p class="muted">+ IVA ${vat}%</p></div>
    <div class="card"><div class="muted">Mes IVA incluido</div><div class="kpi">${monthlyVat.toFixed(2)} €</div><p class="muted">${monthKeyNow}</p></div>
    <div class="card"><div class="muted">Año base</div><div class="kpi">${annual.toFixed(2)} €</div><p class="muted">+ IVA ${vat}%</p></div>
    <div class="card"><div class="muted">Año IVA incluido</div><div class="kpi">${annualVat.toFixed(2)} €</div><p class="muted">${year}</p></div>
    <div class="card"><div class="muted">Total registrado</div><div class="kpi">${totalVat.toFixed(2)} €</div><p class="muted">Base: ${total.toFixed(2)} €</p></div>
    <div class="card"><div class="muted">Eventos activos</div><div class="kpi">${activeEvents}</div><p class="muted">Realizados ${doneEvents} · Cancelados ${canceledEvents}</p></div>
    <div class="card"><div class="muted">Operarios activos</div><div class="kpi">${activeWorkers}</div><p class="muted">Desactivados ${inactiveWorkers}</p></div>
    <div class="card"><div class="muted">Albaranes sin firma</div><div class="kpi">${pendingSigns}</div><p class="muted">Pendientes de conformidad</p></div>
  </div>

  <div class="card"><h3>Accesos rápidos</h3><div class="actions">
    <button onclick="openEventWizard()">+ Crear evento</button>
    <button class="secondary" onclick="go('control')">Control diario</button>
    <button class="secondary" onclick="go('clientes')">Clientes</button>
    <button class="secondary" onclick="go('operarios')">Operarios</button>
    <button class="secondary" onclick="go('informes')">Informes PDF</button>
    <button class="secondary" onclick="go('albaranes')">Albaranes</button>
    <button class="secondary" onclick="createDemoData()">Crear datos demo</button>
  </div></div>

  <div class="card"><h3>Progresión anual IVA incluido</h3><p class="muted">Pasa el ratón por cada barra para ver la facturación exacta.</p>
  <style>
    .dashbar-wrap{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:52px}
    .dashbar{width:30px;background:#000;border-radius:8px 8px 0 0;cursor:pointer;transition:all .15s ease}
    .dashbar-wrap:hover .dashbar{transform:scaleX(1.12);opacity:.82}
    .dashbar-tooltip{display:none;position:absolute;bottom:190px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.45;white-space:nowrap;z-index:10;box-shadow:0 12px 35px rgba(0,0,0,.25)}
    .dashbar-tooltip:after{content:"";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid #000}
    .dashbar-wrap:hover .dashbar-tooltip{display:block}
  </style>
  <div style="display:flex;gap:12px;align-items:flex-end;overflow:auto;padding:46px 0 12px">${bars}</div></div>

  <div class="cards3">
    <div class="card"><h3>Próximos eventos</h3><table class="table"><tbody>${upcoming||'<tr><td>No hay próximos eventos.</td></tr>'}</tbody></table></div>
    <div class="card"><h3>Facturación por mes</h3><table class="table"><thead><tr><th>Mes</th><th>Base</th><th>Total IVA incl.</th></tr></thead><tbody>${monthRows||'<tr><td>Sin datos.</td></tr>'}</tbody></table></div>
  </div>

  <div class="card"><h3>Últimos albaranes</h3><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Base</th><th>Total</th><th>Firma</th><th>Acción</th></tr></thead><tbody>${lastNotes||'<tr><td>Sin albaranes.</td></tr>'}</tbody></table></div>`;
}

function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function rateNames(){return state.rates.filter(r=>r.active).map(r=>r.name)}
function serviceOptions(v=''){return rateNames().map(s=>`<option ${v===s?'selected':''}>${s}</option>`).join('')}
function userOptions(v=''){
  let list=state.users.filter(u=>u.role!=='admin'&&u.active);
  const selected=state.users.find(u=>String(u.id)===String(v));
  if(selected && !list.find(u=>String(u.id)===String(v))) list=[selected,...list];
  return list.map(u=>`<option value="${u.id}" ${String(v)===String(u.id)?'selected':''}>${fullName(u)} - ${u.email||u.phone}${u.active?'':' · inactivo'}</option>`).join('')
}

function clientOptions(v=''){
  return ['<option value="">Seleccionar cliente</option>'].concat((state.clients||[]).map(c=>`<option value="${c.id}" ${String(v)===String(c.id)?'selected':''}>${esc(c.name)} · ${esc(c.cif||'')}</option>`)).join('');
}
function applyClientToEvent(select){
  const c=(state.clients||[]).find(x=>String(x.id)===String(select.value));
  if(!c) return;
  const f=$('#wizardForm');
  if(!f) return;
  f.client.value=c.name||'';
  f.client_contact.value=c.contact||'';
  f.client_phone.value=c.phone||'';
  if(f.staff_discount_percent && c.percent_hour_discount!==undefined){
    const pct=Math.round(Number(c.percent_hour_discount||0));
    const radio=[...f.querySelectorAll('[name=staff_discount_percent]')].find(r=>Number(r.value)===pct);
    if(radio) radio.checked=true;
  }
  const info=document.getElementById('clientCommercialInfo');
  if(info) info.innerHTML=`Condiciones cliente: descuento fijo ${Number(c.fixed_hour_discount||0).toFixed(2)} €/h · descuento ${Number(c.percent_hour_discount||0).toFixed(2)}% · dietas/transporte/km excluidos`;
}
function parseCsvText(text){
  const lines=text.replace(/\r/g,'').split('\n').filter(x=>x.trim());
  if(!lines.length) return [];
  const sep=lines[0].includes(';')?';':',';
  const parseLine=(line)=>{
    const out=[];let cur='',q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"' && line[i+1]==='"'){cur+='"';i++;continue}
      if(ch==='"'){q=!q;continue}
      if(ch===sep && !q){out.push(cur.trim());cur='';continue}
      cur+=ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers=parseLine(lines[0]).map(h=>h.trim());
  return lines.slice(1).map(line=>{
    const vals=parseLine(line); const obj={};
    headers.forEach((h,i)=>obj[h]=vals[i]||'');
    return obj;
  });
}
async function importCsvFile(input,type){
  const file=input.files[0];
  if(!file) return;
  const text=await file.text();
  const rows=parseCsvText(text);
  const endpoint=type==='clients'?'/api/import/clients':'/api/import/users';
  const res=await api(endpoint,{method:'POST',body:JSON.stringify({rows})});
  alert(`Importación finalizada: ${res.imported} registros`);
  await load();
  go('config');
}

async function createDemoData(){
  if(!confirm('¿Crear datos demo de prueba? No duplica si ya existen.')) return;
  const res=await api('/api/demo/create',{method:'POST',body:JSON.stringify({})});
  alert(`Datos demo creados. Eventos nuevos: ${res.createdEvents}. Operarios demo disponibles: ${res.users}.`);
  await load();
  go('dashboard');
}

function downloadBackup(path){
  window.open(path,'_blank');
}


function getRate(name){return state.rates.find(r=>r.name===name)||{hourly_rate:18.5,night_rate:23.5,diet_price:15,transport_price:0,has_night:1,has_diet:1}}
function getDiscountOptions(current=0){
  return [0,1,2,3,4,5,6,7,8,9,10].map(d=>`<label class="col-2 switchline"><input type="radio" name="staff_discount_percent" value="${d}" ${Number(current||0)===d?'checked':''}> ${d}%</label>`).join('');
}
function rateSummary(name){
  const r=getRate(name);
  return `${Number(r.hourly_rate||0).toFixed(2)}€/h · Noct. ${Number(r.night_rate||0).toFixed(2)}€/h · Dieta ${Number(r.diet_price||0).toFixed(2)}€`;
}
function rateSummary(name){
  const r=getRate(name);
  return `${Number(r.hourly_rate||0).toFixed(2)}€/h · Noct. ${Number(r.night_rate||0).toFixed(2)}€/h · Dieta ${Number(r.diet_price||0).toFixed(2)}€`;
}


function mapsLink(lat,lng){
  if(!lat || !lng) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`;
}
function fmtDateTime(v){
  if(!v) return '—';
  try{return new Date(v).toLocaleString('es-ES')}catch(e){return v}
}
function distanceMeters(lat1,lng1,lat2,lng2){
  lat1=Number(lat1);lng1=Number(lng1);lat2=Number(lat2);lng2=Number(lng2);
  if(!Number.isFinite(lat1)||!Number.isFinite(lng1)||!Number.isFinite(lat2)||!Number.isFinite(lng2)) return null;
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function geoBadge(row, log){
  if(!log || !log.latitude || !log.longitude) return '<span class="badge">Sin GPS</span>';
  const meters=distanceMeters(row.event_latitude,row.event_longitude,log.latitude,log.longitude);
  if(meters===null) return '<span class="badge">GPS registrado</span>';
  if(meters<=300) return `<span class="badge" style="background:#dcfce7;border-color:#86efac;color:#166534">Verificado 300m · ${meters} m</span>`;
  if(meters<=1000) return `<span class="badge" style="background:#fef9c3;border-color:#fde047;color:#854d0e">Revisar · ${meters} m</span>`;
  return `<span class="badge" style="background:#fee2e2;border-color:#fca5a5;color:#991b1b">Lejos · ${meters} m</span>`;
}
async function viewDailyControl(){
  const today=localDateStr();
  const selected=state.dailyControlDate||today;
  const data=await api('/api/admin/daily-control?date='+selected).catch(()=>({rows:[]}));
  state.dailyControlDate=selected;

  const statusText={
    pendiente:'Pendiente entrada',
    en_evento:'Entrada fichada',
    salida_fichada:'Salida fichada'
  };

  const rows=(data.rows||[]).map(r=>{
    const entrada=r.entrada;
    const salida=r.salida;
    const entradaMap=entrada&&entrada.latitude&&entrada.longitude?`<a target="_blank" href="${mapsLink(entrada.latitude,entrada.longitude)}">Ver entrada</a>`:'—';
    const salidaMap=salida&&salida.latitude&&salida.longitude?`<a target="_blank" href="${mapsLink(salida.latitude,salida.longitude)}">Ver salida</a>`:'—';
    return `<tr>
      <td data-label="Operario"><b>${esc(r.worker_name||'')}</b><br><span class="muted">${esc(r.nickname||'')} · ${esc(r.phone||'')}</span><br>${Number(r.is_team_lead)===1?'<span class="badge">Jefe equipo</span>':'<span class="badge">Operario</span>'}</td>
      <td data-label="Evento"><b>${esc(r.event_name)}</b><br>${esc(r.client||'')}<br><span class="muted">${esc(r.location||'')}</span></td>
      <td data-label="Horario">${esc(r.planned_start||r.start_time||'')} - ${esc(r.planned_end||r.end_time||'')}<br><span class="muted">${esc(r.service_role||'')}</span></td>
      <td data-label="Estado"><b>${statusText[r.control_status]||r.control_status}</b><br>${geoBadge(r,entrada)} ${salida?geoBadge(r,salida):''}</td>
      <td data-label="Entrada">${fmtDateTime(entrada&&entrada.timestamp)}<br>${entradaMap}</td>
      <td data-label="Salida">${fmtDateTime(salida&&salida.timestamp)}<br>${salidaMap}</td>
      <td data-label="Verificación"><div class="actions">${r.event_latitude&&r.event_longitude?`<a target="_blank" href="${mapsLink(r.event_latitude,r.event_longitude)}"><button class="secondary">Mapa evento</button></a>`:''}${entradaMap!=='—'?`<a target="_blank" href="${mapsLink(entrada.latitude,entrada.longitude)}"><button>GPS entrada</button></a>`:''}${salidaMap!=='—'?`<a target="_blank" href="${mapsLink(salida.latitude,salida.longitude)}"><button class="secondary">GPS salida</button></a>`:''}</div></td>
    </tr>`;
  }).join('');

  const total=(data.rows||[]).length;
  const fichados=(data.rows||[]).filter(r=>r.control_status==='en_evento'||r.control_status==='salida_fichada').length;
  const salidas=(data.rows||[]).filter(r=>r.control_status==='salida_fichada').length;
  const pendientes=(data.rows||[]).filter(r=>r.control_status==='pendiente').length;

  $('#content').innerHTML=`<div class="cards3">
    <div class="card"><div class="muted">Operarios asignados hoy</div><div class="kpi">${total}</div></div>
    <div class="card"><div class="muted">Entradas fichadas</div><div class="kpi">${fichados}</div></div>
    <div class="card"><div class="muted">Salidas fichadas</div><div class="kpi">${salidas}</div></div>
    <div class="card"><div class="muted">Pendientes</div><div class="kpi">${pendientes}</div></div>
  </div>
  <div class="card"><div class="top"><div><h3>Control diario de operarios</h3><p class="muted">Verifica remotamente entradas/salidas y geolocalización. Ratio correcto: 300 m alrededor del evento.</p></div><div><input type="date" id="controlDate" value="${selected}"><button onclick="state.dailyControlDate=$('#controlDate').value;viewDailyControl()">Ver día</button></div></div></div>
  <div class="card"><table class="table"><thead><tr><th>Operario</th><th>Evento</th><th>Horario</th><th>Estado</th><th>Entrada</th><th>Salida</th><th>Verificación</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No hay operarios asignados para este día.</td></tr>'}</tbody></table></div>`;
}



async function viewClients(){
  const clients=await api('/api/clients/all').catch(()=>state.clients||[]);
  const rows=clients.map(c=>`<tr>
    <td data-label="Cliente"><b>${esc(c.name)}</b><br><span class="muted">${esc(c.legal_name||'')}</span></td>
    <td data-label="CIF/NIF">${esc(c.cif||'')}</td>
    <td data-label="Contacto">${esc(c.contact||'')}<br><span class="muted">${esc(c.phone||'')}</span><br><span class="muted">${esc(c.email||'')}</span></td>
    <td data-label="Condiciones">${Number(c.fixed_hour_discount||0).toFixed(2)} €/h<br>${Number(c.percent_hour_discount||0).toFixed(2)}% horas<br><span class="muted">${esc(c.payment_terms||'')}</span></td>
    <td data-label="Dirección">${esc(c.address||'')}</td>
    <td data-label="Estado">${Number(c.active)===1?'<span class="badge">Activo</span>':'<span class="badge">Inactivo</span>'}</td>
    <td data-label="Acciones"><div class="actions"><button onclick="openClientEditor(${c.id})">Editar</button><button class="danger" onclick="deleteClient(${c.id})">Desactivar</button></div></td>
  </tr>`).join('');

  $('#content').innerHTML=`<div class="card"><div class="top"><div><h3>Clientes</h3><p class="muted">Crea, edita y gestiona tus clientes para seleccionarlos rápidamente al crear eventos.</p></div><button onclick="openClientEditor()">+ Crear cliente</button></div></div>
  <div class="card"><table class="table"><thead><tr><th>Cliente</th><th>CIF/NIF</th><th>Contacto</th><th>Condiciones</th><th>Dirección</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No hay clientes creados.</td></tr>'}</tbody></table></div>`;
}


function openClientEditor(id=null){
  const c=id?(state.clients||[]).find(x=>String(x.id)===String(id)):{name:'',legal_name:'',cif:'',contact:'',phone:'',email:'',address:'',notes:'',billing_email:'',production_email:'',payment_terms:'',due_days:0,fixed_hour_discount:0,percent_hour_discount:0,discount_applies_night:1,discount_applies_team_lead:1,custom_km_price:'',custom_vat_percent:'',vip_level:'',active:1};
  if(id && !c){
    api('/api/clients/all').then(list=>{
      state.clients=list;
      openClientEditor(id);
    });
    return;
  }
  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><h2>${id?'Editar cliente':'Crear cliente'}</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
  <form id="clientEditForm" class="grid">
    <div class="col-12"><h3>Datos fiscales y producción</h3></div>
    <input class="col-6" name="name" value="${esc(c.name||'')}" placeholder="Nombre comercial / cliente" required>
    <input class="col-6" name="legal_name" value="${esc(c.legal_name||'')}" placeholder="Razón social">
    <input class="col-3" name="cif" value="${esc(c.cif||'')}" placeholder="CIF / NIF">
    <input class="col-3" name="contact" value="${esc(c.contact||'')}" placeholder="Persona de contacto">
    <input class="col-3" name="phone" value="${esc(c.phone||'')}" placeholder="Teléfono">
    <input class="col-3" name="email" value="${esc(c.email||'')}" placeholder="Email general">
    <input class="col-6" name="billing_email" value="${esc(c.billing_email||'')}" placeholder="Email facturación">
    <input class="col-6" name="production_email" value="${esc(c.production_email||'')}" placeholder="Email producción">
    <input class="col-12" name="address" value="${esc(c.address||'')}" placeholder="Dirección fiscal / sede">

    <div class="col-12"><h3>Condiciones comerciales crew</h3><p class="muted">Estos descuentos se aplican solo a horas de operarios. Nunca descuentan transporte, dietas, kilometraje ni pluses.</p></div>
    <input class="col-3" name="fixed_hour_discount" type="number" step="0.01" value="${Number(c.fixed_hour_discount||0)}" placeholder="Descuento fijo €/h">
    <input class="col-3" name="percent_hour_discount" type="number" step="0.01" value="${Number(c.percent_hour_discount||0)}" placeholder="Descuento % horas">
    <label class="col-3 switchline"><input name="discount_applies_night" type="checkbox" ${Number(c.discount_applies_night)!==0?'checked':''}> Aplicar a nocturnidad</label>
    <label class="col-3 switchline"><input name="discount_applies_team_lead" type="checkbox" ${Number(c.discount_applies_team_lead)!==0?'checked':''}> Aplicar a jefe equipo</label>
    <input class="col-3" name="custom_km_price" type="number" step="0.01" value="${c.custom_km_price??''}" placeholder="€/km personalizado">
    <input class="col-3" name="custom_vat_percent" type="number" step="0.01" value="${c.custom_vat_percent??''}" placeholder="IVA personalizado %">
    <input class="col-3" name="payment_terms" value="${esc(c.payment_terms||'')}" placeholder="Forma de pago">
    <input class="col-3" name="due_days" type="number" value="${Number(c.due_days||0)}" placeholder="Vencimiento días">
    <input class="col-3" name="vip_level" value="${esc(c.vip_level||'')}" placeholder="Nivel cliente / VIP">

    <textarea class="col-12" name="notes" placeholder="Notas internas / condiciones especiales">${esc(c.notes||'')}</textarea>
    <label class="col-12 switchline"><input name="active" type="checkbox" ${Number(c.active)!==0?'checked':''}> Cliente activo</label>
    <button class="col-12">Guardar cliente</button>
  </form></div></div>`;
  $('#clientEditForm').onsubmit=async e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.target));
    d.active=e.target.active.checked?1:0;
    d.discount_applies_night=e.target.discount_applies_night.checked?1:0;
    d.discount_applies_team_lead=e.target.discount_applies_team_lead.checked?1:0;
    if(id) await api('/api/clients/'+id,{method:'PUT',body:JSON.stringify(d)});
    else await api('/api/clients',{method:'POST',body:JSON.stringify(d)});
    closeWizard();
    await load();
    viewClients();
  };
}

async function deleteClient(id){
  if(confirm('¿Desactivar este cliente? No se borra el histórico.')){
    await api('/api/clients/'+id,{method:'DELETE'});
    await load();
    viewClients();
  }
}




function reportPdfWindow(title, body){
  const w=window.open('','_blank');
  const css = '@page{size:A4 portrait;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px}.top{display:flex;align-items:center;gap:16px;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px}.logo{max-width:120px;max-height:70px;object-fit:contain}h1{font-size:20px;margin:0}h2{font-size:15px;margin:18px 0 8px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#f2f2f2;font-size:10px;text-transform:uppercase}.box{border:1px solid #222;border-radius:8px;padding:10px;margin:8px 0}.total{font-size:16px;font-weight:bold}.muted{color:#666}.printbtn{margin-top:14px;padding:10px 14px;border:0;background:#111;color:#fff;border-radius:8px}@media print{.printbtn{display:none}}';
  const html = '<html><head><title>'+esc(title)+'</title><style>'+css+'</style></head><body><div class="a4"><div class="top"><img class="logo" src="/assets/logo.png"><div><h1>'+esc(title)+'</h1><p class="muted">Generado: '+new Date().toLocaleString('es-ES')+'</p></div></div>'+body+'<button class="printbtn" onclick="window.print()">Descargar / imprimir PDF</button></body></html>';
  w.document.write(html);
  w.document.close();
}

function weekStartMonday(dateStr){
  const d=dateStr?parseLocalDate(dateStr):new Date();
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return localDateStr(d);
}

async function printWeeklyEventsReport(){
  const start=$('#repWeekStart').value || weekStartMonday();
  const data=await api('/api/reports/weekly-events?start='+start);
  const byEvent={};
  (data.assignments||[]).forEach(a=>{(byEvent[a.event_id]||(byEvent[a.event_id]=[])).push(a)});
  const rows=(data.rows||[]).map(e=>`<tr><td>${e.event_date}<br>${e.start_time||''}-${e.end_time||''}</td><td><b>${esc(e.name)}</b><br>${esc(e.client||'')}</td><td>${esc(e.location||'')}</td><td>${e.workers_count}</td><td>${(byEvent[e.id]||[]).map(a=>`${esc(a.first_name)} ${esc(a.last_name)} · ${esc(a.service_role)}${a.is_team_lead?' · JEFE':''}`).join('<br>')}</td></tr>`).join('');
  reportPdfWindow(`Eventos programados semana ${data.start} a ${data.end}`, `<div class="cardpdf"><b>Semana:</b> ${data.start} - ${data.end}<br><b>Total eventos:</b> ${(data.rows||[]).length}</div><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Localización</th><th>Operarios</th><th>Equipo asignado</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Sin eventos programados.</td></tr>'}</tbody></table>`);
}

async function printClientHistoryReport(){
  const clientId=$('#repClient').value;
  const year=$('#repClientYear').value;
  const month=$('#repClientMonth').value;
  if(!clientId) return alert('Selecciona cliente');
  const data=await api(`/api/reports/client-history?client_id=${clientId}&year=${year}&month=${month}`);
  const c=data.client||{};
  const rows=(data.events||[]).map(e=>`<tr><td>${e.event_date}<br>${e.start_time||''}-${e.end_time||''}</td><td><b>${esc(e.name)}</b><br>${esc(e.location||'')}</td><td>${esc(e.status||'')}</td><td>${Number(e.total_normal_hours||0).toFixed(2)}</td><td>${Number(e.total_night_hours||0).toFixed(2)}</td><td>${Number(e.grand_total||0).toFixed(2)} € + IVA<br><b>${Number(e.grand_total_vat||0).toFixed(2)} €</b></td></tr>`).join('');
  reportPdfWindow(`Historial cliente · ${c.name||''} · ${String(month).padStart(2,'0')}/${year}`, `<div class="cardpdf"><b>Cliente:</b> ${esc(c.name||'')}<br><b>Razón social:</b> ${esc(c.legal_name||'')}<br><b>CIF/NIF:</b> ${esc(c.cif||'')}<br><b>Periodo:</b> ${String(month).padStart(2,'0')}/${year}</div><div class="box total">Eventos: ${data.totals.events} · Base: ${Number(data.totals.base||0).toFixed(2)} € + IVA · Total IVA incl.: ${Number(data.totals.total_vat||0).toFixed(2)} € · Horas: ${(Number(data.totals.normal_hours||0)+Number(data.totals.night_hours||0)).toFixed(2)}</div><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Estado</th><th>H normales</th><th>H noct.</th><th>Total</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Sin eventos para este periodo.</td></tr>'}</tbody></table>`);
}

async function printWorkerHoursReport(){
  const userId=$('#repWorker').value;
  const year=$('#repWorkerYear').value;
  const month=$('#repWorkerMonth').value;
  const data=await api(`/api/reports/worker-hours?year=${year}&month=${month}&user_id=${userId||''}`);
  const summary=(data.byWorker||[]).map(w=>`<tr><td><b>${esc(w.worker_name)}</b><br>${esc(w.nickname||'')} · ${esc(w.phone||'')}</td><td>${w.events}</td><td>${Number(w.normal_hours||0).toFixed(2)}</td><td>${Number(w.night_hours||0).toFixed(2)}</td><td><b>${Number(w.total_hours||0).toFixed(2)}</b></td><td>${Number(w.total_amount||0).toFixed(2)} €</td></tr>`).join('');
  const detail=(data.rows||[]).map(r=>`<tr><td>${esc(r.worker_name)}</td><td>${r.event_date}</td><td>${esc(r.event_name)}<br>${esc(r.location||'')}</td><td>${esc(r.service_role||'')}</td><td>${Number(r.normal_hours||0).toFixed(2)}</td><td>${Number(r.night_hours||0).toFixed(2)}</td><td>${Number(r.total_hours||0).toFixed(2)}</td></tr>`).join('');
  reportPdfWindow(`Historial horas operarios · ${String(month).padStart(2,'0')}/${year}`, `<div class="box total">Operarios: ${data.totals.workers} · Eventos/asignaciones: ${data.totals.events} · Horas normales: ${Number(data.totals.normal_hours||0).toFixed(2)} · Horas nocturnas: ${Number(data.totals.night_hours||0).toFixed(2)} · Total horas: ${Number(data.totals.total_hours||0).toFixed(2)}</div><h2>Resumen por operario</h2><table class="table"><thead><tr><th>Operario</th><th>Eventos</th><th>H normales</th><th>H noct.</th><th>Total horas</th><th>Importe horas</th></tr></thead><tbody>${summary||'<tr><td colspan="6">Sin horas.</td></tr>'}</tbody></table><h2>Detalle de eventos</h2><table class="table"><thead><tr><th>Operario</th><th>Fecha</th><th>Evento</th><th>Cargo</th><th>H normales</th><th>H noct.</th><th>Total</th></tr></thead><tbody>${detail||'<tr><td colspan="7">Sin detalle.</td></tr>'}</tbody></table>`);
}

function viewReports(){
  const now=new Date();
  const y=now.getFullYear();
  const m=now.getMonth()+1;
  const week=weekStartMonday();
  const clientOpts=['<option value="">Seleccionar cliente</option>'].concat((state.clients||[]).map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.cif||'')}</option>`)).join('');
  const workerOpts=['<option value="">Todos los operarios</option>'].concat((state.users||[]).filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${fullName(u)} · ${esc(u.phone||'')}</option>`)).join('');
  const months=Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===m?'selected':''}>${String(i+1).padStart(2,'0')}</option>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Informes PDF</h3><p class="muted">Genera informes imprimibles/descargables para producción, administración y control interno.</p></div>
  <div class="cards3">
    <div class="card"><h3>Eventos programados semanales</h3><p class="muted">Listado de eventos de una semana con equipo asignado.</p><input id="repWeekStart" type="date" value="${week}"><button onclick="printWeeklyEventsReport()">Generar PDF semanal</button></div>
    <div class="card"><h3>Historial mensual por cliente</h3><select id="repClient">${clientOpts}</select><div class="grid"><select class="col-6" id="repClientMonth">${months}</select><input class="col-6" id="repClientYear" type="number" value="${y}"></div><button onclick="printClientHistoryReport()">Generar PDF cliente</button></div>
    <div class="card"><h3>Historial mensual de horas por operario</h3><select id="repWorker">${workerOpts}</select><div class="grid"><select class="col-6" id="repWorkerMonth">${months}</select><input class="col-6" id="repWorkerYear" type="number" value="${y}"></div><button onclick="printWorkerHoursReport()">Generar PDF horas</button></div>
  </div>`;
}



function viewCalendar(){
  const selected = state.calendarMonth || localDateStr();
  const first = monthStartLocal(selected);
  const year = first.getFullYear();
  const month = first.getMonth();
  const firstWeekDay = (first.getDay()+6)%7;
  const gridStart = new Date(year, month, 1-firstWeekDay, 12,0,0,0);
  const days=[];
  for(let i=0;i<42;i++){
    const d=new Date(gridStart);
    d.setDate(gridStart.getDate()+i);
    const key=localDateStr(d);
    const evs=(state.events||[]).filter(e=>String(e.event_date||'').slice(0,10)===key && e.status!=='realizado');
    days.push(`<div class="day ${sameLocalMonth(d,first)?'':'mutedday'}"><div class="num">${d.getDate()}</div>${evs.map(e=>`<div class="event-chip ${e.status==='cancelado'?'done':'planned'}" onclick="openEventDetail(${e.id})"><b>${esc(e.start_time||'')}</b> ${esc(e.name||'')}<br><span class="muted">${esc(e.location||'')}</span></div>`).join('')}</div>`);
  }
  const prev = new Date(year,month-1,1,12,0,0,0);
  const next = new Date(year,month+1,1,12,0,0,0);
  const list=(state.events||[]).filter(e=>e.status!=='realizado').sort((a,b)=>String(a.event_date||'').localeCompare(String(b.event_date||''))||String(a.start_time||'').localeCompare(String(b.start_time||''))).slice(0,80).map(e=>`<tr><td data-label="Fecha">${formatLocalDate(e.event_date)}<br>${esc(e.start_time||'')}-${esc(e.end_time||'')}</td><td data-label="Evento"><b>${esc(e.name||'')}</b><br>${esc(e.client||'')}</td><td data-label="Lugar">${esc(e.location||'')}</td><td data-label="Estado">${esc(e.status||'')}</td><td><button onclick="openEventDetail(${e.id})">Abrir</button><button class="danger" onclick="deleteEvent(${e.id})">Borrar</button></td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><div class="top"><div><h3>Calendario eventos</h3><p class="muted">Fechas locales fijas. El evento queda exactamente en el día seleccionado.</p></div><button onclick="openEventWizard()">+ Crear evento</button></div><div class="actions"><button class="secondary" onclick="state.calendarMonth='${localDateStr(prev)}';viewCalendar()">Mes anterior</button><button class="secondary" onclick="state.calendarMonth='${localDateStr()}';viewCalendar()">Hoy</button><button class="secondary" onclick="state.calendarMonth='${localDateStr(next)}';viewCalendar()">Mes siguiente</button></div><h3>${first.toLocaleDateString('es-ES',{month:'long',year:'numeric'})}</h3><div class="calendar">${days.join('')}</div></div><div class="card"><h3>Listado de eventos programados/cancelados</h3><table class="table"><tbody>${list||'<tr><td>No hay eventos.</td></tr>'}</tbody></table></div>`;
}

async function viewRealizados(){
  let q='?status=realizado';
  if(state.realizadosFilters.date_from)q+=`&date_from=${state.realizadosFilters.date_from}`;
  if(state.realizadosFilters.date_to)q+=`&date_to=${state.realizadosFilters.date_to}`;
  if(state.realizadosFilters.location)q+=`&location=${encodeURIComponent(state.realizadosFilters.location)}`;
  if(state.realizadosFilters.q)q+=`&q=${encodeURIComponent(state.realizadosFilters.q)}`;
  const rows=await api('/api/events'+q);
  const html=rows.map(e=>`<tr><td data-label="Fecha">${e.event_date}</td><td data-label="Evento"><b>${esc(e.name)}</b><br><span class="muted">${esc(e.client)}</span></td><td data-label="Localización">${esc(e.location)}</td><td data-label="KM">${Number(e.distance_km||0).toFixed(2)} km<br>Fact: ${Number(e.billable_km||0).toFixed(2)} km</td><td data-label="Acciones"><button onclick="openEventDetail(${e.id})">Ver/editar</button><button class="secondary" onclick="generateEventNote(${e.id})">Albarán</button><button class="danger" onclick="deleteEvent(${e.id})">Borrar</button></td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Eventos realizados</h3><div class="grid"><input class="col-3" id="rfFrom" type="date" value="${state.realizadosFilters.date_from||''}"><input class="col-3" id="rfTo" type="date" value="${state.realizadosFilters.date_to||''}"><input class="col-3" id="rfQ" placeholder="Evento / cliente" value="${esc(state.realizadosFilters.q||'')}"><input class="col-3" id="rfLoc" placeholder="Localización" value="${esc(state.realizadosFilters.location||'')}"><button class="col-12" onclick="applyRealizadosFilters()">Filtrar realizados</button></div></div><div class="card"><table class="table"><tbody>${html}</tbody></table></div>`;
}
function applyRealizadosFilters(){state.realizadosFilters={date_from:$('#rfFrom').value,date_to:$('#rfTo').value,q:$('#rfQ').value,location:$('#rfLoc').value};viewRealizados()}


function extractGoogleMapsCoords(url){
  if(!url) return null;
  let s=String(url).trim();
  try{s=decodeURIComponent(s)}catch(e){}
  const patterns=[
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/,
    /\/place\/[^@]*@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/
  ];
  for(const p of patterns){
    const m=s.match(p);
    if(m){
      if(p.source.includes('!2d')){
        return {lat:m[2], lng:m[1]};
      }
      return {lat:m[1], lng:m[2]};
    }
  }
  const loose=s.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if(loose) return {lat:loose[1], lng:loose[2]};
  return null;
}

async function fillCoordsFromMapsLink(showAlert=true){
  const urlEl=document.querySelector('[name=google_maps_url]');
  const latEl=document.querySelector('[name=latitude]');
  const lngEl=document.querySelector('[name=longitude]');
  const locEl=document.querySelector('[name=location]');
  if(!urlEl || !latEl || !lngEl) return false;
  const local=extractGoogleMapsCoords(urlEl.value);
  if(local){
    latEl.value=local.lat; lngEl.value=local.lng;
    if(state.wizard){state.wizard.latitude=local.lat;state.wizard.longitude=local.lng;}
    markGeoStatus('Coordenadas detectadas automáticamente');
    if(showAlert) alert('Coordenadas detectadas: '+local.lat+', '+local.lng);
    return true;
  }
  try{
    markGeoStatus('Buscando coordenadas...');
    const res=await api('/api/geocode',{method:'POST',body:JSON.stringify({google_maps_url:urlEl.value,address:locEl?locEl.value:''})});
    latEl.value=res.lat; lngEl.value=res.lng;
    if(state.wizard){state.wizard.latitude=res.lat;state.wizard.longitude=res.lng;}
    markGeoStatus('Coordenadas detectadas automáticamente');
    if(showAlert) alert('Coordenadas detectadas: '+res.lat+', '+res.lng);
    return true;
  }catch(err){
    markGeoStatus('No se detectaron coordenadas. Escribe dirección completa o pega URL completa.');
    if(showAlert) alert(err.message);
    return false;
  }
}


function markGeoStatus(text){
  const el=document.getElementById('geoStatus');
  if(el) el.textContent=text||'';
}
function scheduleAutoGeoDetect(){
  clearTimeout(mapsDetectTimer);
  mapsDetectTimer=setTimeout(()=>fillCoordsFromMapsLink(false),650);
}

function attachMapsAutoCoords(){
  const urlEl=document.querySelector('[name=google_maps_url]');
  const locEl=document.querySelector('[name=location]');
  if(urlEl){
    urlEl.onpaste=()=>setTimeout(()=>fillCoordsFromMapsLink(false),180);
    urlEl.oninput=scheduleAutoGeoDetect;
    urlEl.onchange=()=>fillCoordsFromMapsLink(false);
    urlEl.onblur=()=>fillCoordsFromMapsLink(false);
  }
  if(locEl){
    locEl.oninput=()=>{
      if(!document.querySelector('[name=latitude]')?.value || !document.querySelector('[name=longitude]')?.value) scheduleAutoGeoDetect();
    };
  }
}


function openEventWizard(){
  state.wizard={step:1,name:'',client:'',client_contact:'',client_phone:'',location:'',google_maps_url:'',latitude:'',longitude:'',event_date:localDateStr(),start_time:'',end_time:'',hourly_rate:'18.50',night_rate:'23.50',has_night:true,transport_price:'0',diet_price:'15',special_bonus:'0',staff_discount_percent:'0',notes:'',internal_notes:'',status:'programado',assignments:[]};
  renderWizard();
}
async function openEventDetail(id){
  const e=await api('/api/events/'+id);
  const assignments=await api(`/api/events/${id}/assignments`);
  state.wizard={...e,step:1,editing:true,assignments:assignments.map(a=>({assignment_id:a.id,user_id:a.user_id,service_role:a.service_role,is_team_lead:!!a.is_team_lead,billable_hourly_rate:a.billable_hourly_rate,billable_night_rate:a.billable_night_rate,assignment_diet_price:a.assignment_diet_price,assignment_transport_price:a.assignment_transport_price,apply_night:!!a.apply_night,apply_diet:!!a.apply_diet,planned_start:a.planned_start,planned_end:a.planned_end}))};
  renderWizard();
}
function syncWizard(){
  const f=$('#wizardForm'); if(!f)return;
  const data=Object.fromEntries(new FormData(f));
  Object.assign(state.wizard,data);
  state.wizard.has_night=f.has_night ? (f.has_night.type==='hidden' ? true : !!f.has_night.checked) : true;
  state.wizard.staff_discount_percent=data.staff_discount_percent || state.wizard.staff_discount_percent || 0;
  state.wizard.assignments=[...document.querySelectorAll('.assign-row')].map((row,i)=>({
    assignment_id:state.wizard.assignments[i]?.assignment_id,
    user_id:row.querySelector('[name=user_id]').value,
    service_role:row.querySelector('[name=service_role]').value,
    is_team_lead:row.querySelector('[name=is_team_lead]').checked,
    billable_hourly_rate:row.querySelector('[name=billable_hourly_rate]').value,
    billable_night_rate:row.querySelector('[name=billable_night_rate]').value,
    assignment_diet_price:row.querySelector('[name=assignment_diet_price]').value,
    assignment_transport_price:row.querySelector('[name=assignment_transport_price]').value,
    apply_night:row.querySelector('[name=apply_night]').checked,
    apply_diet:row.querySelector('[name=apply_diet]').checked,
    planned_start:row.querySelector('[name=planned_start]').value,
    planned_end:row.querySelector('[name=planned_end]').value
  }));
}
function wizardStep(n){syncWizard();state.wizard.step=n;renderWizard()}
function addAssignmentRow(){
  syncWizard();
  const name=rateNames()[0]||'Stagehand';
  const r=getRate(name);
  state.wizard.assignments.push({
    user_id:'',
    service_role:name,
    is_team_lead:false,
    billable_hourly_rate:r.hourly_rate,
    billable_night_rate:r.night_rate,
    assignment_diet_price:r.diet_price,
    assignment_transport_price:r.transport_price,
    apply_night:!!r.has_night,
    apply_diet:!!r.has_diet,
    planned_start:state.wizard.start_time||'',
    planned_end:state.wizard.end_time||''
  });
  renderWizard();
}
async function removeAssignmentRow(i){syncWizard();const a=state.wizard.assignments[i];if(a.assignment_id)await api('/api/assignments/'+a.assignment_id,{method:'DELETE'});state.wizard.assignments.splice(i,1);renderWizard()}
function closeWizard(){state.wizard=null;$('#modalRoot').innerHTML=''}


function renderWizard(){
  const w=state.wizard; let body='';
  const assignments=(w.assignments||[]).map((a,i)=>{
    const r=getRate(a.service_role||'');
    const hourly=a.billable_hourly_rate||r.hourly_rate||18.50;
    const night=a.billable_night_rate||r.night_rate||23.50;
    const diet=a.assignment_diet_price||r.diet_price||0;
    const transport=a.assignment_transport_price||r.transport_price||0;
    return `<div class="assign-row">
      <select name="user_id">${userOptions(a.user_id)}</select>
      <div>
        <select name="service_role" onchange="applyRateToRow(this); this.closest('.assign-row').querySelector('.rate-view').innerHTML=rateSummary(this.value)">${serviceOptions(a.service_role)}</select>
        <div class="muted rate-view" style="font-size:12px">${rateSummary(a.service_role)}</div>
        <input type="hidden" name="billable_hourly_rate" value="${hourly}">
        <input type="hidden" name="billable_night_rate" value="${night}">
        <input type="hidden" name="assignment_diet_price" value="${diet}">
        <input type="hidden" name="assignment_transport_price" value="${transport}">
      </div>
      <div><input name="planned_start" type="time" value="${a.planned_start||w.start_time||''}"><input name="planned_end" type="time" value="${a.planned_end||w.end_time||''}"></div>
      <label><input name="apply_night" type="checkbox" ${a.apply_night?'checked':''} style="width:auto;min-height:auto"> Noct.</label>
      <label><input name="apply_diet" type="checkbox" ${a.apply_diet?'checked':''} style="width:auto;min-height:auto"> Dieta</label>
      <label><input name="is_team_lead" type="checkbox" ${a.is_team_lead?'checked':''} style="width:auto;min-height:auto"> Jefe</label>
      <button type="button" class="danger" onclick="removeAssignmentRow(${i})">Quitar</button>
    </div>`;
  }).join('');

  body=`<div class="grid">
    <div class="col-12"><h3>1. Datos principales</h3></div>
    <input class="col-6" name="name" value="${esc(w.name)}" placeholder="Nombre evento" required>
    <select class="col-6" name="client_id" onchange="applyClientToEvent(this)">${clientOptions(w.client_id||'')}</select>
    <input class="col-6" name="client" value="${esc(w.client)}" placeholder="Cliente">
    <input class="col-3" name="client_contact" value="${esc(w.client_contact||'')}" placeholder="Contacto">
    <input class="col-3" name="client_phone" value="${esc(w.client_phone||'')}" placeholder="Teléfono cliente">
    <div class="col-12"><p id="clientCommercialInfo" class="muted" style="font-size:13px">Selecciona cliente para aplicar sus condiciones comerciales.</p></div>
    <input class="col-3" name="event_date" type="date" value="${esc(w.event_date||'')}" required>
    <input class="col-3" name="start_time" type="time" value="${esc(w.start_time||'')}">
    <input class="col-3" name="end_time" type="time" value="${esc(w.end_time||'')}">
    <select class="col-3" name="status"><option value="programado" ${w.status==='programado'?'selected':''}>Programado</option><option value="en_curso" ${w.status==='en_curso'?'selected':''}>En curso</option><option value="realizado" ${w.status==='realizado'?'selected':''}>Realizado</option><option value="cancelado" ${w.status==='cancelado'?'selected':''}>Cancelado</option></select>

    <div class="col-12"><h3>2. Localización exacta</h3><p class="muted">Pega el link de Google Maps o escribe la dirección. Se detecta automáticamente. El control de fichaje verifica 300 m alrededor del evento.</p></div>
    <input class="col-6" name="location" value="${esc(w.location)}" placeholder="Dirección / nombre del lugar">
    <div class="col-6"><input name="google_maps_url" value="${esc(w.google_maps_url)}" placeholder="Pega aquí el enlace de Google Maps"><p id="geoStatus" class="muted" style="font-size:12px;margin-top:0"></p><button type="button" class="secondary" onclick="fillCoordsFromMapsLink(true)">Detectar coordenadas ahora</button></div>
    <input class="col-3" name="latitude" value="${w.latitude||''}" placeholder="Latitud">
    <input class="col-3" name="longitude" value="${w.longitude||''}" placeholder="Longitud">

    <div class="col-12"><h3>3. Descuento y notas</h3><p class="muted">Descuento solo sobre importe de operarios.</p></div>
    <div class="col-12 grid">${getDiscountOptions(w.staff_discount_percent||0)}</div>
    <input type="hidden" name="hourly_rate" value="${w.hourly_rate||'18.50'}">
    <input type="hidden" name="night_rate" value="${w.night_rate||'23.50'}">
    <input type="hidden" name="has_night" value="1">
    <input type="hidden" name="transport_price" value="${w.transport_price||'0'}">
    <input type="hidden" name="diet_price" value="${w.diet_price||'15'}">
    <input class="col-3" name="special_bonus" type="number" step="0.01" value="${w.special_bonus||0}" placeholder="Plus especial">
    <textarea class="col-6" name="notes" placeholder="Notas albarán">${esc(w.notes)}</textarea>
    <textarea class="col-6" name="internal_notes" placeholder="Notas internas">${esc(w.internal_notes)}</textarea>

    <div class="col-12"><h3>4. Operarios asignados</h3><p class="muted">Las tarifas salen automáticamente según el cargo.</p></div>
    <div class="col-12">${assignments || '<p class="muted">Todavía no hay operarios asignados.</p>'}<button type="button" class="secondary" onclick="addAssignmentRow()">+ Añadir operario</button></div>
  </div>`;

  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><h2>${w.editing?'Editar evento':'Crear evento simple'}</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div><form id="wizardForm">${body}</form><div class="actions" style="justify-content:space-between;margin-top:18px"><div>${w.editing?`<button class="danger" onclick="deleteEvent(${w.id})">Borrar evento</button><button class="warn" onclick="completeEvent(${w.id})">Marcar realizado</button>`:''}</div><div><button class="ok" onclick="saveWizard()">Guardar evento</button></div></div></div></div>`;
  attachMapsAutoCoords();
}

async function saveWizard(){
  await fillCoordsFromMapsLink(false);
  syncWizard();
  try{
    if(!state.wizard.name || !state.wizard.event_date){
      alert('Falta nombre del evento o fecha.');
      return;
    }
    if(state.wizard.editing) await api('/api/events/'+state.wizard.id,{method:'PUT',body:JSON.stringify(state.wizard)});
    else await api('/api/events',{method:'POST',body:JSON.stringify(state.wizard)});
    closeWizard();
    await load();
    go(state.view);
  }catch(err){
    alert('Error al guardar evento: '+err.message);
  }
}

function openUserEditor(id=null){
  const u=id?state.users.find(x=>String(x.id)===String(id)):{email:'',role:'operario',first_name:'',last_name:'',nickname:'',phone:'',photo:'',services:'',availability:'disponible',active:1};
  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><div><h2>${id?'Editar usuario':'Crear operario / jefe'}</h2><p class="muted">Los operarios y jefes pueden entrar solo con su teléfono si están activos.</p></div><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
  <form id="userEditForm" class="grid">
    <input class="col-4" name="first_name" value="${esc(u.first_name)}" placeholder="Nombre">
    <input class="col-4" name="last_name" value="${esc(u.last_name)}" placeholder="Apellidos">
    <input class="col-4" name="nickname" value="${esc(u.nickname)}" placeholder="Mote">
    <input class="col-4" name="email" value="${esc(u.email)}" placeholder="Email opcional / admin">
    <input class="col-4" name="phone" value="${esc(u.phone||'')}" placeholder="Teléfono de acceso" required>
    ${id?'':`<input class="col-4" name="password" value="Marfan1234*" placeholder="Contraseña temporal opcional">`}
    <select class="col-4" name="role">
      <option value="operario" ${u.role==='operario'?'selected':''}>Operario</option>
      <option value="jefe" ${u.role==='jefe'?'selected':''}>Jefe equipo</option>
      <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
    </select>
    <select class="col-4" name="availability">
      <option value="disponible" ${u.availability==='disponible'?'selected':''}>Disponible</option>
      <option value="ocupado" ${u.availability==='ocupado'?'selected':''}>Ocupado</option>
      <option value="vacaciones" ${u.availability==='vacaciones'?'selected':''}>Vacaciones</option>
      <option value="no disponible" ${u.availability==='no disponible'?'selected':''}>No disponible</option>
    </select>
    <label class="col-4 switchline"><input type="checkbox" name="active" ${Number(u.active)!==0?'checked':''}> Usuario activo</label>
    <input class="col-12" name="services" value="${esc(u.services||'')}" placeholder="Servicios: Limpieza, Auxiliar de limpieza, Stagehand...">
    <div class="col-12"><input id="photoFile" type="file" accept="image/*"><input name="photo" id="photoUrl" value="${esc(u.photo||'')}" placeholder="URL foto / subida directa"><br>${u.photo?`<img class="preview" src="${u.photo}">`:''}</div>
    <button class="col-12">Guardar usuario</button>
  </form></div></div>`;
  $('#photoFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{const res=await api('/api/upload-photo',{method:'POST',body:JSON.stringify({dataUrl:reader.result,filename:file.name})});$('#photoUrl').value=res.url};reader.readAsDataURL(file)};
  $('#userEditForm').onsubmit=async e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.target));
    d.active=!!e.target.active.checked;
    if(!d.email && d.phone) d.email=d.phone.replace(/\D/g,'')+'@marfancrew.local';
    if(id) await api('/api/users/'+id,{method:'PUT',body:JSON.stringify(d)});
    else await api('/api/users',{method:'POST',body:JSON.stringify(d)});
    closeWizard();
    await load();
    go('operarios');
  };
}

async function deleteUser(id){
  if(confirm('¿Desactivar este usuario? No podrá entrar en su zona de operario/jefe.')){
    const res=await api('/api/users/'+id,{method:'DELETE'});
    alert(res.message||'Usuario desactivado');
    await load();
    go('operarios');
  }
}
async function activateUser(id){
  const res=await api('/api/users/'+id+'/activate',{method:'POST'});
  alert(res.message||'Usuario reactivado');
  await load();
  go('operarios');
}



function viewUsers(){
  const activos=state.users.filter(u=>u.role!=='admin'&&Number(u.active)!==0).length;
  const inactivos=state.users.filter(u=>u.role!=='admin'&&Number(u.active)===0).length;
  const rows=state.users.map(u=>`<tr>
    <td data-label="Foto">${u.photo?`<img class="photo" src="${u.photo}">`:''}</td>
    <td data-label="Nombre"><b>${esc(u.first_name)}</b><br>${esc(u.last_name)}<br><span class="muted">${esc(u.nickname||'')}</span></td>
    <td data-label="Acceso">${esc(u.email||'')}<br><span class="muted">Tel: ${esc(u.phone||'')}</span></td>
    <td data-label="Rol"><span class="badge">${esc(u.role)}</span><br>${Number(u.active)!==0?'<span class="badge">Activo</span>':'<span class="badge">Desactivado</span>'}<br><span class="muted">${esc(u.availability||'')}</span></td>
    <td data-label="Servicios">${esc(u.services||'')}</td>
    <td data-label="Acciones"><div class="actions">
      <button onclick="openUserEditor(${u.id})">Editar</button>
      ${Number(u.active)!==0?`<button class="danger" onclick="deleteUser(${u.id})">Desactivar</button>`:`<button class="ok" onclick="activateUser(${u.id})">Reactivar</button>`}
      <button class="secondary" onclick="resetPass(${u.id})">Reset clave</button>
    </div></td>
  </tr>`).join('');

  $('#content').innerHTML=`<div class="card"><div class="top"><div><h3>Operarios / Jefes de equipo</h3><p class="muted">Crea, edita, desactiva y reactiva usuarios. Si un operario está desactivado no podrá entrar en su zona de operario/jefe.</p></div><button onclick="openUserEditor()">+ Crear operario</button></div></div>
  <div class="cards3"><div class="card"><div class="muted">Activos</div><div class="kpi">${activos}</div></div><div class="card"><div class="muted">Desactivados</div><div class="kpi">${inactivos}</div></div></div>
  <div class="card"><table class="table"><thead><tr><th>Foto</th><th>Nombre</th><th>Acceso</th><th>Rol/Estado</th><th>Servicios</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openUserEditor(id=null){
  const u=id?state.users.find(x=>String(x.id)===String(id)):{email:'',role:'operario',first_name:'',last_name:'',nickname:'',phone:'',photo:'',services:'',availability:'disponible',active:1};
  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><div><h2>${id?'Editar usuario':'Crear operario / jefe'}</h2><p class="muted">Los operarios y jefes pueden entrar solo con su teléfono si están activos.</p></div><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
  <form id="userEditForm" class="grid">
    <input class="col-4" name="first_name" value="${esc(u.first_name)}" placeholder="Nombre">
    <input class="col-4" name="last_name" value="${esc(u.last_name)}" placeholder="Apellidos">
    <input class="col-4" name="nickname" value="${esc(u.nickname)}" placeholder="Mote">
    <input class="col-4" name="email" value="${esc(u.email)}" placeholder="Email opcional / admin">
    <input class="col-4" name="phone" value="${esc(u.phone||'')}" placeholder="Teléfono de acceso" required>
    ${id?'':`<input class="col-4" name="password" value="Marfan1234*" placeholder="Contraseña temporal opcional">`}
    <select class="col-4" name="role">
      <option value="operario" ${u.role==='operario'?'selected':''}>Operario</option>
      <option value="jefe" ${u.role==='jefe'?'selected':''}>Jefe equipo</option>
      <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
    </select>
    <select class="col-4" name="availability">
      <option value="disponible" ${u.availability==='disponible'?'selected':''}>Disponible</option>
      <option value="ocupado" ${u.availability==='ocupado'?'selected':''}>Ocupado</option>
      <option value="vacaciones" ${u.availability==='vacaciones'?'selected':''}>Vacaciones</option>
      <option value="no disponible" ${u.availability==='no disponible'?'selected':''}>No disponible</option>
    </select>
    <label class="col-4 switchline"><input type="checkbox" name="active" ${Number(u.active)!==0?'checked':''}> Usuario activo</label>
    <input class="col-12" name="services" value="${esc(u.services||'')}" placeholder="Servicios: Limpieza, Auxiliar de limpieza, Stagehand...">
    <div class="col-12"><input id="photoFile" type="file" accept="image/*"><input name="photo" id="photoUrl" value="${esc(u.photo||'')}" placeholder="URL foto / subida directa"><br>${u.photo?`<img class="preview" src="${u.photo}">`:''}</div>
    <button class="col-12">Guardar usuario</button>
  </form></div></div>`;
  $('#photoFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{const res=await api('/api/upload-photo',{method:'POST',body:JSON.stringify({dataUrl:reader.result,filename:file.name})});$('#photoUrl').value=res.url};reader.readAsDataURL(file)};
  $('#userEditForm').onsubmit=async e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.target));
    d.active=!!e.target.active.checked;
    if(!d.email && d.phone) d.email=d.phone.replace(/\D/g,'')+'@marfancrew.local';
    if(id) await api('/api/users/'+id,{method:'PUT',body:JSON.stringify(d)});
    else await api('/api/users',{method:'POST',body:JSON.stringify(d)});
    closeWizard();
    await load();
    go('operarios');
  };
}

async function deleteUser(id){
  if(confirm('¿Desactivar este usuario? No podrá entrar en su zona de operario/jefe.')){
    const res=await api('/api/users/'+id,{method:'DELETE'});
    alert(res.message||'Usuario desactivado');
    await load();
    go('operarios');
  }
}
async function activateUser(id){
  const res=await api('/api/users/'+id+'/activate',{method:'POST'});
  alert(res.message||'Usuario reactivado');
  await load();
  go('operarios');
}


function viewRates(){
  const rows=state.rates.map(r=>`<div class="rate-card" data-id="${r.id}"><input name="name" value="${esc(r.name)}"><input name="hourly_rate" type="number" step="0.01" value="${r.hourly_rate}"><input name="night_rate" type="number" step="0.01" value="${r.night_rate}"><input name="diet_price" type="number" step="0.01" value="${r.diet_price}"><input name="transport_price" type="number" step="0.01" value="${r.transport_price}"><label><input name="has_night" type="checkbox" ${r.has_night?'checked':''} style="width:auto;min-height:auto"> N</label><label><input name="has_diet" type="checkbox" ${r.has_diet?'checked':''} style="width:auto;min-height:auto"> D</label><div class="actions"><button onclick="saveRate(${r.id})">Guardar</button><button class="danger" onclick="deleteRate(${r.id})">Baja</button></div></div>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Tarifas por cargo</h3><p class="muted">Tarifa normal, nocturna, dieta y transporte por cargo.</p></div><div class="card"><h3>Nueva tarifa</h3><form id="newRate" class="grid"><input class="col-3" name="name" placeholder="Cargo"><input class="col-2" name="hourly_rate" type="number" step="0.01" value="18.50"><input class="col-2" name="night_rate" type="number" step="0.01" value="23.50"><input class="col-2" name="diet_price" type="number" step="0.01" value="15"><input class="col-2" name="transport_price" type="number" step="0.01" value="0"><label class="col-1"><input name="has_night" type="checkbox" checked style="width:auto;min-height:auto"> N</label><label class="col-1"><input name="has_diet" type="checkbox" checked style="width:auto;min-height:auto"> D</label><button class="col-12">Crear tarifa</button></form></div><div class="card">${rows}</div>`;
  $('#newRate').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.has_night=!!e.target.has_night.checked;d.has_diet=!!e.target.has_diet.checked;d.active=1;await api('/api/job-rates',{method:'POST',body:JSON.stringify(d)});go('tarifas')};
}
async function saveRate(id){const box=document.querySelector(`.rate-card[data-id="${id}"]`);const d={};box.querySelectorAll('input').forEach(i=>d[i.name]=i.type==='checkbox'?i.checked:i.value);d.active=1;await api('/api/job-rates/'+id,{method:'PUT',body:JSON.stringify(d)});alert('Tarifa guardada')}
async function deleteRate(id){if(confirm('¿Dar de baja esta tarifa?')){await api('/api/job-rates/'+id,{method:'DELETE'});go('tarifas')}}


async function clock(event_id,type){
  try{
    const sendLog = async (coords={}) => {
      await api('/api/time-log',{method:'POST',body:JSON.stringify({event_id,type,latitude:coords.latitude||'',longitude:coords.longitude||''})});
      alert('Fichaje guardado' + (coords.latitude ? ' con geolocalización' : ''));
      if(type==='salida' && state.currentEvent && Number(state.currentEvent.id)===Number(event_id) && Number(state.currentEvent.is_team_lead)===1){
        setTimeout(()=>openTeamLeadSignModal(event_id),350);
      }
    };

    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        p=>sendLog({latitude:p.coords.latitude,longitude:p.coords.longitude}),
        ()=>sendLog({})
      );
    }else{
      await sendLog({});
    }
  }catch(e){alert(e.message)}
}


function notesByDate(){const o={};state.notes.forEach(n=>{(o[n.event_date]||(o[n.event_date]=[])).push(n)});return o}

function viewOperario(){
  const current=state.currentEvent;
  const rows=(state.myCalendar||[]).map(e=>`<tr>
    <td data-label="Fecha">${e.event_date}<br>${e.planned_start||e.start_time||''} - ${e.planned_end||e.end_time||''}</td>
    <td data-label="Evento"><b>${esc(e.name)}</b><br><span class="muted">${esc(e.location||'')}</span></td>
    <td data-label="Cargo">${esc(e.service_role||'')}</td>
    <td data-label="Estado">${current&&Number(current.id)===Number(e.id)?'<span class="badge">Activo para fichar</span>':'<span class="badge">Asignado</span>'}</td>
  </tr>`).join('');
  const isLead=current && Number(current.is_team_lead)===1;
  $('#content').innerHTML=`<div class="card"><div class="top"><div><h3>Mi zona de trabajo</h3><p class="muted">Solo ves tus eventos asignados, fichaje con geolocalización y contacto con oficina.</p></div><button class="ok" onclick="contactOffice()">Contactar con oficina por WhatsApp</button></div></div>
  <div class="card"><h3>Evento activo para fichar</h3>${current?`<p><b>${esc(current.name)}</b><br>${esc(current.location||'')}<br>${esc(current.planned_start||current.start_time||'')} - ${esc(current.planned_end||current.end_time||'')}<br><span class="badge">${isLead?'Jefe de equipo':'Operario asignado'}</span></p><div class="cards3"><button class="ok" onclick="clock(${current.id},'entrada')">Entrada</button><button class="secondary" onclick="clock(${current.id},'inicio_descanso')">Inicio descanso</button><button class="secondary" onclick="clock(${current.id},'fin_descanso')">Fin descanso</button><button class="danger" onclick="clock(${current.id},'salida')">Salida</button></div>${isLead?`<p class="muted" style="margin-top:12px">Al fichar salida se abrirá automáticamente la firma de conformidad del cliente.</p><button class="secondary" onclick="openTeamLeadSignModal(${current.id})">Abrir firma cliente manualmente</button>`:''}`:`<p class="muted">Ahora mismo no tienes ningún evento activo para fichar.</p>`}</div>
  <div class="card"><h3>Mi calendario de eventos asignados</h3><table class="table"><tbody>${rows||'<tr><td>No tienes eventos asignados.</td></tr>'}</tbody></table></div>`;
}

async function clock(event_id,type){
  try{
    const sendLog = async (coords={}) => {
      await api('/api/time-log',{method:'POST',body:JSON.stringify({event_id,type,latitude:coords.latitude||'',longitude:coords.longitude||''})});
      alert('Fichaje guardado' + (coords.latitude ? ' con geolocalización' : ''));
      if(type==='salida' && state.currentEvent && Number(state.currentEvent.id)===Number(event_id) && Number(state.currentEvent.is_team_lead)===1){
        setTimeout(()=>openTeamLeadSignModal(event_id),350);
      }
    };
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(p=>sendLog({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>sendLog({}));
    }else{ await sendLog({}); }
  }catch(e){alert(e.message)}
}


async function openTeamLeadSignModal(eventId){
  let s;
  try{
    s=await api(`/api/events/${eventId}/client-sign-summary`);
  }catch(e){
    alert(e.message);
    return;
  }
  const e=s.event||{};
  const workerRows=(s.workers||[]).map(w=>`<tr>
    <td>${esc(w.name)} ${w.nickname?`<span class="muted">(${esc(w.nickname)})</span>`:''}</td>
    <td>${esc(w.role)} ${w.is_team_lead?'<span class="badge">Jefe equipo</span>':''}</td>
    <td>${w.entrada?fmtSignTime(w.entrada):'Pendiente'}</td>
    <td>${w.salida?fmtSignTime(w.salida):'Pendiente'}</td>
  </tr>`).join('');

  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><h2>Conformidad cliente · Resumen del servicio</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
  <div class="card" style="box-shadow:none">
    <h3>${esc(e.name||'Evento')}</h3>
    <p class="muted">${esc(e.client||'')} · ${esc(e.location||'')}</p>
    <div class="cards3">
      <div class="card"><div class="muted">Hora entrada real</div><div class="kpi" style="font-size:26px">${s.entrada_general?fmtSignTime(s.entrada_general):(s.planned_start||'Pendiente')}</div><p class="muted">${s.entrada_general?fmtSignDateTime(s.entrada_general):'Horario previsto'}</p></div>
      <div class="card"><div class="muted">Hora salida real</div><div class="kpi" style="font-size:26px">${s.salida_general?fmtSignTime(s.salida_general):(s.planned_end||'Pendiente')}</div><p class="muted">${s.salida_general?fmtSignDateTime(s.salida_general):'Pendiente de salida'}</p></div>
      <div class="card"><div class="muted">Operarios en servicio</div><div class="kpi" style="font-size:26px">${s.workers_count||0}</div><p class="muted">Equipo asignado al evento</p></div>
    </div>
    <h3>Equipo que ha trabajado</h3>
    <table class="table"><thead><tr><th>Operario</th><th>Cargo</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>${workerRows||'<tr><td colspan="4">Sin operarios asignados.</td></tr>'}</tbody></table>
  </div>
  <div class="card" style="box-shadow:none">
    <h3>Firma de conformidad del cliente</h3>
    <p class="muted">El cliente declara que ha revisado el resumen del servicio, horario de entrada/salida y número de operarios indicados.</p>
    <input id="teamClientName" placeholder="Nombre completo / razón social del cliente">
    <input id="teamClientCif" placeholder="CIF / NIF del cliente">
    <label class="switchline"><input id="clientAcceptSummary" type="checkbox"> El cliente confirma que los datos mostrados son correctos</label>
    <div class="signature-box"><canvas id="sig" width="700" height="240"></canvas></div>
    <div class="actions"><button class="secondary" onclick="clearSig()">Limpiar firma</button><button class="ok" onclick="signEventAsTeamLead(${eventId})">Guardar conformidad</button></div>
  </div></div></div>`;
  setupSignature();
}


async function signEventAsTeamLead(eventId){
  if($('#clientAcceptSummary') && !$('#clientAcceptSummary').checked){
    alert('El cliente debe confirmar que los datos del servicio son correctos antes de firmar.');
    return;
  }
  const c=$('#sig');
  await api(`/api/events/${eventId}/client-sign`,{method:'POST',body:JSON.stringify({
    client_name:$('#teamClientName').value,
    client_cif:$('#teamClientCif').value,
    client_signature:c.toDataURL('image/png')
  })});
  alert('Conformidad del cliente guardada en el albarán');
  closeWizard();
  await load();
  viewOperario();
}


function viewNotes(){
  const d=state.notesCalendarDate, y=d.getFullYear(), m=d.getMonth();
  const first=new Date(y,m,1), start=new Date(first); start.setDate(first.getDate()-((first.getDay()+6)%7));
  const days=[]; for(let i=0;i<42;i++){const x=new Date(start);x.setDate(start.getDate()+i);days.push(x)}
  const currentMonth=monthKey(d), by=notesByDate();
  const rows=state.notes.map(n=>`<tr><td data-label="Fecha">${n.event_date}</td><td data-label="Evento">${esc(n.event_name)}<br>${esc(n.location)}</td><td data-label="Horas">${n.total_normal_hours}h normales<br>${n.total_night_hours}h nocturnas</td><td data-label="KM">${Number(n.distance_km||0).toFixed(2)} km<br>Fact: ${Number(n.billable_km||0).toFixed(2)} km</td><td data-label="Total"><b>${Number(n.grand_total||0).toFixed(2)} € + IVA</b><br><span class="muted">Total: ${Number(n.grand_total_vat||0).toFixed(2)} € IVA incl.</span></td><td data-label="Firma">${n.client_signed?'Firmado ✅':'Pendiente'}</td><td data-label="Acciones"><button onclick="printEventNote(${n.id})">Ver PDF A4</button><button class="secondary" onclick="openSignModal(${n.id})">Firma cliente</button></td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><div class="top"><div><h3>Albaranes únicos por evento</h3><p class="muted">Cada PDF incluye todos los operarios del evento.</p></div><div class="actions"><button class="secondary" onclick="prevNotesMonth()">← Mes</button><button class="secondary" onclick="nextNotesMonth()">Mes →</button></div></div><h2>${d.toLocaleDateString('es-ES',{month:'long',year:'numeric'})}</h2><div class="calendar">${days.map(day=>{const key=day.toISOString().slice(0,10);return `<div class="day ${monthKey(day)!==currentMonth?'mutedday':''}"><div class="num">${day.getDate()}</div>${(by[key]||[]).map(n=>`<div class="event-chip done" onclick="printEventNote(${n.id})"><b>${esc(n.event_name)}</b><br>${Number(n.grand_total).toFixed(2)}€ · ${Number(n.total_night_hours).toFixed(2)}h noct.</div>`).join('')}</div>`}).join('')}</div></div><div class="card"><table class="table"><tbody>${rows}</tbody></table></div>`;
}
function prevNotesMonth(){state.notesCalendarDate.setMonth(state.notesCalendarDate.getMonth()-1);viewNotes()}
function nextNotesMonth(){state.notesCalendarDate.setMonth(state.notesCalendarDate.getMonth()+1);viewNotes()}

async function printEventNote(id){
  const n=await api('/api/event-delivery-notes/'+id);
  const lines=n.lines.map(l=>`<tr><td>${esc(l.name)} ${l.nickname?`(${esc(l.nickname)})`:''}<br><span class="muted">${l.early_adjusted?'Entrada anticipada ajustada<br>':''}${l.minimum_applied?'Mínimo 4h aplicado':''}</span></td><td>${esc(l.service_role)}</td><td>${l.normal_hours}</td><td>${l.night_hours}</td><td>${Number(l.hourly_rate).toFixed(2)}€</td><td>${Number(l.night_rate).toFixed(2)}€</td><td>${Number(l.diet).toFixed(2)}€</td><td>${Number(l.transport).toFixed(2)}€</td><td><b>${Number(l.line_total).toFixed(2)}€</b></td></tr>`).join('');
  const w=window.open('','_blank');
  w.document.write(`<html><head><title>${n.pdf_name}</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;background:#fff;font-size:11px;line-height:1.35}
.a4{width:186mm;min-height:273mm;margin:0 auto;background:#fff}
.logo{max-width:42mm;max-height:24mm;object-fit:contain}
.top{border-bottom:2px solid #000;padding-bottom:6mm;margin-bottom:6mm;display:flex;justify-content:space-between;align-items:flex-start;gap:10mm}
.top h1{margin:0;font-size:22px}
.muted{color:#666}
.table{width:100%;border-collapse:collapse;margin-top:4mm}
.table th,.table td{border-bottom:1px solid #ddd;padding:2.5mm;text-align:left;vertical-align:top;font-size:10.5px}
.table th{background:#f4f4f4;text-transform:uppercase;font-size:9px;letter-spacing:.3px}
.cardpdf{border:1px solid #ddd;border-radius:4mm;padding:4mm;margin:0 0 4mm 0;break-inside:avoid}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.kpi{font-size:22px;font-weight:700}
.totalbox{border:2px solid #000;border-radius:4mm;padding:4mm;margin-top:5mm}
.small{font-size:9px}
.printbtn{margin-top:5mm;padding:10px 14px;border:0;background:#000;color:#fff;border-radius:8px}
tr{break-inside:avoid}
thead{display:table-header-group}
tfoot{display:table-footer-group}
@media print{.printbtn{display:none}}
</style></head><body><div class="a4"><div class="top"><img class="logo" src="/assets/logo.png"><div><h1>${esc((n.settings&&n.settings.company_name)||'MARFAN CREW')}</h1><h2>ALBARÁN ÚNICO DE EVENTO · BASE + IVA</h2></div></div><div class="cardpdf"><b>Código:</b> ${n.code}<br><b>Evento:</b> ${esc(n.name)}<br><b>Cliente:</b> ${esc(n.client)}<br><b>Fecha:</b> ${n.event_date}<br><b>Ubicación:</b> ${esc(n.location)}<br><b>Sede:</b> ${esc(n.hq_address)}<br><b>Distancia:</b> ${Number(n.distance_km).toFixed(2)} km · <b>Km facturables:</b> ${Number(n.billable_km).toFixed(2)} km · <b>Precio/km:</b> ${Number(n.km_price).toFixed(2)}€</div><div class="cardpdf"><h3>Operarios incluidos</h3><table class="table"><thead><tr><th>Operario</th><th>Cargo</th><th>H normales</th><th>H noct.</th><th>€/h</th><th>€/h noct.</th><th>Dieta</th><th>Transp.</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table></div><div class="cardpdf"><p>Subtotal operarios: <b>${Number(n.staff_total).toFixed(2)}€</b></p><p>Descuento evento ${Number(n.staff_discount_percent||0).toFixed(0)}%: <b>- ${Number(n.staff_discount_amount||0).toFixed(2)}€</b></p><p>Descuento cliente fijo/%: <b>- ${Number(n.client_discount_amount||0).toFixed(2)}€</b></p><p class="muted">Dietas, transporte, kilometraje y pluses excluidos de descuentos.</p><p>Dietas: <b>${Number(n.diet_total).toFixed(2)}€</b></p><p>Transporte: <b>${Number(n.transport_total).toFixed(2)}€</b></p><p>Kilometraje automático: <b>${Number(n.km_total).toFixed(2)}€</b></p><p>Plus especial: <b>${Number(n.special_bonus).toFixed(2)}€</b></p><hr><p><b>BASE IMPONIBLE:</b> ${Number(n.grand_total).toFixed(2)}€ + IVA</p><p><b>IVA ${Number(n.vat_percent||21).toFixed(0)}%:</b> ${Number(n.vat_amount||0).toFixed(2)}€</p><p class="total">TOTAL IVA INCLUIDO: ${Number(n.grand_total_vat||0).toFixed(2)}€</p></div><div class="cardpdf"><h3>Conforme cliente / firma jefe de equipo</h3><p class="muted">El cliente firma tras revisar hora de entrada, hora de salida y número de operarios del servicio.</p><p>Nombre / razón social: ${esc(n.client_name||'Pendiente')}</p><p>CIF/NIF: ${esc(n.client_dni||'Pendiente')}</p>${n.client_signature?`<img class="sig" src="${n.client_signature}">`:''}</div><button class="printbtn" onclick="window.print()">Descargar / imprimir PDF A4</button></div></body></html>`);
  w.document.close();
}

let sigCtx,drawing=false;
function openSignModal(id){$('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><h2>Firma cliente</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div><input id="clientName" placeholder="Nombre cliente"><input id="clientDni" placeholder="CIF / NIF"><div class="signature-box"><canvas id="sig" width="700" height="240"></canvas></div><div class="actions"><button class="secondary" onclick="clearSig()">Limpiar</button><button onclick="signNote(${id})">Guardar firma</button></div></div></div>`;setupSignature()}
function setupSignature(){const c=$('#sig');if(!c)return;sigCtx=c.getContext('2d');sigCtx.lineWidth=3;sigCtx.lineCap='round';const pos=e=>{const r=c.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)}};const start=e=>{drawing=true;const p=pos(e);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y);e.preventDefault()};const move=e=>{if(!drawing)return;const p=pos(e);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();e.preventDefault()};const end=()=>drawing=false;c.onmousedown=start;c.onmousemove=move;c.onmouseup=end;c.onmouseleave=end;c.ontouchstart=start;c.ontouchmove=move;c.ontouchend=end}
function clearSig(){const c=$('#sig');sigCtx.clearRect(0,0,c.width,c.height)}
async function signNote(id){const c=$('#sig');await api(`/api/event-delivery-notes/${id}/client-sign`,{method:'POST',body:JSON.stringify({client_name:$('#clientName').value,client_dni:$('#clientDni').value,client_signature:c.toDataURL('image/png')})});alert('Firma guardada');closeWizard();go('albaranes')}


function openTeamLeadSignModal(eventId){
  $('#modalRoot').innerHTML=`<div class="modal-back"><div class="modal"><div class="modal-head"><h2>Conformidad cliente · Jefe de equipo</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
  <p class="muted">El cliente firma que las horas y el equipo asignado son correctos. Esta firma se guardará en el albarán del evento.</p>
  <input id="teamClientName" placeholder="Nombre completo / razón social del cliente">
  <input id="teamClientCif" placeholder="CIF / NIF del cliente">
  <div class="signature-box"><canvas id="sig" width="700" height="240"></canvas></div>
  <div class="actions"><button class="secondary" onclick="clearSig()">Limpiar firma</button><button class="ok" onclick="signEventAsTeamLead(${eventId})">Guardar conformidad</button></div></div></div>`;
  setupSignature();
}
async function signEventAsTeamLead(eventId){
  if($('#clientAcceptSummary') && !$('#clientAcceptSummary').checked){
    alert('El cliente debe confirmar que los datos del servicio son correctos antes de firmar.');
    return;
  }
  const c=$('#sig');
  await api(`/api/events/${eventId}/client-sign`,{method:'POST',body:JSON.stringify({
    client_name:$('#teamClientName').value,
    client_cif:$('#teamClientCif').value,
    client_signature:c.toDataURL('image/png')
  })});
  alert('Conformidad del cliente guardada en el albarán');
  closeWizard();
  await load();
  viewOperario();
}


function viewPasswords(){const rows=state.users.map(u=>`<tr><td data-label="Usuario">${fullName(u)}<br>${esc(u.email)}</td><td data-label="Rol">${esc(u.role)}</td><td data-label="Acción"><button onclick="resetPass(${u.id})">Resetear contraseña</button></td></tr>`).join('');$('#content').innerHTML=`<div class="card"><h3>Reset contraseñas</h3><table class="table"><tbody>${rows}</tbody></table></div>`}
async function resetPass(id){const password=prompt('Nueva contraseña temporal','Marfan1234*');if(password){await api(`/api/users/${id}/reset-password`,{method:'POST',body:JSON.stringify({password})});alert('Contraseña actualizada')}}
function viewConfig(){$('#content').innerHTML=`<div class="card"><h3>Cambiar mi contraseña</h3><form id="passForm"><input name="newPassword" type="password" placeholder="Nueva contraseña"><button>Cambiar</button></form></div><div class="card"><h3>Datos fijos de cálculo</h3><p>Sede: Calle Ciro Alegría 89, Málaga.</p><p>Radio gratis: 22 km.</p><p>Kilometraje: 0,28 €/km.</p><p>Nocturnidad: 22:00 a 07:00.</p></div>`;$('#passForm').onsubmit=async e=>{e.preventDefault();await api('/api/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});alert('Contraseña cambiada')}}

// ---------- V52 AUDIT MODULE VIEWS ----------
function opBadge(status){
  const cls = status==='crew_completo' || status==='finalizado' ? 'status-ok' : status==='crew_parcial' ? 'status-warn' : 'status-blue';
  return `<span class="status-badge ${cls}">${esc(status||'borrador')}</span>`;
}

async function viewOperations(){
  const data = await api('/api/operations/summary');
  const cards = `
    <div class="audit-grid">
      <div class="audit-card"><div class="muted">Eventos activos</div><div class="audit-kpi">${data.rows.length}</div></div>
      <div class="audit-card"><div class="muted">Crew parcial</div><div class="audit-kpi">${data.rows.filter(x=>x.computed_status==='crew_parcial').length}</div></div>
      <div class="audit-card"><div class="muted">Alertas</div><div class="audit-kpi">${data.alerts.length}</div></div>
    </div>`;
  const rows = data.rows.map(e=>`<tr>
    <td data-label="Fecha">${formatLocalDate(e.event_date)}<br>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</td>
    <td data-label="Evento"><b>${esc(e.name)}</b><br><span class="muted">${esc(e.location||'')}</span></td>
    <td data-label="Estado">${opBadge(e.computed_status)}</td>
    <td data-label="Crew">${e.workers_count}/${e.required_workers||'—'}<br>Jefes: ${e.team_leads_count}/${e.required_team_leads||1}</td>
    <td data-label="Acción"><button onclick="openEventDetail(${e.id})">Gestionar</button></td>
  </tr>`).join('');
  $('#content').innerHTML = `${cards}<div class="card"><div class="v52-head"><div><h3 style="display:none!important">Operaciones</h3><p class="v52-sub">Control de estados, crew incompleto y eventos en riesgo.</p></div><button onclick="go('eventos')">Ir a calendario</button></div></div><div class="card"><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Estado</th><th>Crew</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>No hay eventos activos.</td></tr>'}</tbody></table></div>`;
}

async function viewGpsLive(){
  const date = localDateStr();
  const data = await api('/api/gps/live?date='+date);
  const rows = data.rows.map(r=>`<tr>
    <td data-label="Operario"><b>${esc((r.first_name||'')+' '+(r.last_name||''))}</b><br>${esc(r.phone||'')}</td>
    <td data-label="Evento"><b>${esc(r.event_name)}</b><br>${esc(r.location||'')}</td>
    <td data-label="Estado">${r.gps_status==='en_evento'?'<span class="status-badge status-ok">En evento</span>':r.gps_status==='fuera_radio'?'<span class="status-badge status-bad">Fuera de radio</span>':'<span class="status-badge status-warn">'+esc(r.gps_status)+'</span>'}</td>
    <td data-label="Distancia">${r.distance_m!==null&&r.distance_m!==undefined?r.distance_m+' m':'—'}</td>
    <td data-label="Último fichaje">${r.last_log?new Date(r.last_log.timestamp).toLocaleString('es-ES'):'—'}</td>
  </tr>`).join('');
  $('#content').innerHTML = `<div class="audit-grid"><div class="audit-card"><div class="muted">Fecha</div><div class="audit-kpi" style="font-size:22px">${data.date}</div></div><div class="audit-card"><div class="muted">Radio GPS</div><div class="audit-kpi">${data.radius}m</div></div><div class="audit-card"><div class="muted">Operarios monitorizados</div><div class="audit-kpi">${data.rows.length}</div></div></div><div class="card"><h3>GPS Live</h3><table class="table"><thead><tr><th>Operario</th><th>Evento</th><th>Estado</th><th>Distancia</th><th>Último</th></tr></thead><tbody>${rows||'<tr><td>Sin fichajes/eventos hoy.</td></tr>'}</tbody></table></div>`;
}

async function viewProductionLive(){
  const data = await api('/api/production/events');
  const events = data.events || [];
  const tasks = data.tasks || [];
  const incidents = data.incidents || [];
  const phases = ['carga','ruta','montaje','pruebas','servicio','desmontaje'];

  $('#content').innerHTML = `<div class="card"><div class="v52-head"><div><h3 style="display:none!important">Producción Live</h3><p class="v52-sub">Timeline operativo por evento, checklist e incidencias.</p></div><button onclick="go('gps')">Ver GPS Live</button></div><form id="prodTaskForm" class="grid" style="margin-top:12px"><select class="col-3" name="event_id">${events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><select class="col-2" name="phase">${phases.map(p=>`<option value="${p}">${p}</option>`).join('')}</select><input class="col-4" name="title" placeholder="Nueva tarea" required><select class="col-2" name="priority"><option value="normal">Normal</option><option value="media">Media</option><option value="alta">Alta</option></select><button class="col-1">Añadir</button></form></div><div class="card"><h3>Fases operativas</h3>${phases.map(p=>`<div class="production-phase"><h4>${p}</h4>${tasks.filter(t=>t.phase===p).map(t=>`<p><span class="status-badge ${t.priority==='alta'?'status-bad':t.priority==='media'?'status-warn':'status-blue'}">${esc(t.priority)}</span> ${esc(t.title)} <button class="secondary" onclick="toggleProdTask(${t.id},${t.completed?0:1})">${t.completed?'Reabrir':'Completar'}</button></p>`).join('')||'<p class="muted">Sin tareas.</p>'}</div>`).join('')}</div><div class="card"><h3>Incidencias</h3>${incidents.map(i=>`<p><span class="status-badge status-warn">${esc(i.severity)}</span> ${esc(i.title)} · ${esc(i.status)}</p>`).join('')||'<p class="muted">Sin incidencias abiertas.</p>'}</div>`;

  $('#prodTaskForm').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await api('/api/production/tasks',{method:'POST',body:JSON.stringify(d)});
    viewProductionLive();
  };
}

async function toggleProdTask(id, completed){
  await api('/api/production/tasks/'+id,{method:'PUT',body:JSON.stringify({completed})});
  viewProductionLive();
}

async function viewFinancePro(){
  const data = await api('/api/finance/events');
  const rows = data.rows.map(r=>`<tr>
    <td data-label="Evento"><b>${esc(r.event.name)}</b><br>${formatLocalDate(r.event.event_date)}</td>
    <td data-label="Ingresos">${Number(r.revenue||0).toFixed(2)} € + IVA</td>
    <td data-label="Costes">${Number(r.totalCost||0).toFixed(2)} €</td>
    <td data-label="Beneficio"><b>${Number(r.profit||0).toFixed(2)} €</b></td>
    <td data-label="Margen">${Number(r.margin||0).toFixed(2)}%</td>
    <td data-label="Acción"><button onclick="openFinanceCosts(${r.event.id})">Costes</button></td>
  </tr>`).join('');
  $('#content').innerHTML = `<div class="audit-grid"><div class="audit-card"><div class="muted">Ingresos</div><div class="audit-kpi">${Number(data.totals.revenue||0).toFixed(2)} €</div></div><div class="audit-card"><div class="muted">Costes</div><div class="audit-kpi">${Number(data.totals.cost||0).toFixed(2)} €</div></div><div class="audit-card"><div class="muted">Beneficio</div><div class="audit-kpi">${Number(data.totals.profit||0).toFixed(2)} €</div></div><div class="audit-card"><div class="muted">Margen</div><div class="audit-kpi">${Number(data.totals.margin||0).toFixed(2)}%</div></div></div><div class="card"><h3>Finanzas Pro</h3><table class="table"><thead><tr><th>Evento</th><th>Ingresos</th><th>Costes</th><th>Beneficio</th><th>Margen</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>Sin datos financieros.</td></tr>'}</tbody></table></div>`;
}

function openFinanceCosts(eventId){
  $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal"><div class="modal-head"><h2>Costes evento</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div><form id="costForm" class="grid"><input class="col-3" name="estimated_external_cost" type="number" step="0.01" placeholder="Coste externo"><input class="col-3" name="estimated_transport_cost" type="number" step="0.01" placeholder="Coste transporte"><input class="col-3" name="estimated_other_cost" type="number" step="0.01" placeholder="Otros costes"><select class="col-3" name="payment_status"><option value="pendiente">Pendiente</option><option value="facturado">Facturado</option><option value="cobrado">Cobrado</option><option value="impagado">Impagado</option></select><button class="col-12">Guardar</button></form></div></div>`;
  $('#costForm').onsubmit = async e => {
    e.preventDefault();
    await api('/api/finance/events/'+eventId+'/costs',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    closeWizard();
    viewFinancePro();
  };
}

async function viewDocuments(){
  const docs = await api('/api/documents');
  const users = state.users || await api('/api/users').catch(()=>[]);
  const rows = docs.map(d=>`<tr>
    <td data-label="Operario"><b>${esc((d.first_name||'')+' '+(d.last_name||''))}</b><br>${esc(d.phone||'')}</td>
    <td data-label="Documento">${esc(d.doc_type)}<br><b>${esc(d.title)}</b></td>
    <td data-label="Caduca">${d.expiry_date||'—'}</td>
    <td data-label="Estado">${d.computed_status==='vigente'?'<span class="status-badge status-ok">Vigente</span>':d.computed_status==='proximo_caducar'?'<span class="status-badge status-warn">Próximo</span>':'<span class="status-badge status-bad">'+esc(d.computed_status)+'</span>'}</td>
    <td data-label="Acción"><button class="danger" onclick="deleteDocument(${d.id})">Borrar</button></td>
  </tr>`).join('');
  $('#content').innerHTML = `<div class="audit-grid"><div class="audit-card"><div class="muted">Documentos</div><div class="audit-kpi">${docs.length}</div></div><div class="audit-card"><div class="muted">Caducados/próximos</div><div class="audit-kpi">${docs.filter(d=>d.computed_status!=='vigente').length}</div></div></div><div class="card"><h3>Nuevo documento</h3><form id="docForm" class="grid"><select class="col-3" name="user_id">${users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${fullName(u)}</option>`).join('')}</select><select class="col-2" name="doc_type"><option>PRL</option><option>DNI/NIE</option><option>Carretilla</option><option>Plataforma</option><option>Contrato</option><option>Otros</option></select><input class="col-3" name="title" placeholder="Título documento"><input class="col-2" name="expiry_date" type="date"><input class="col-2" name="issue_date" type="date"><textarea class="col-12" name="notes" placeholder="Notas"></textarea><button class="col-12">Guardar documento</button></form></div><div class="card"><h3>Documentación operarios</h3><table class="table"><thead><tr><th>Operario</th><th>Documento</th><th>Caduca</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>Sin documentos.</td></tr>'}</tbody></table></div>`;
  $('#docForm').onsubmit = async e => {
    e.preventDefault();
    await api('/api/documents',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    viewDocuments();
  };
}

async function deleteDocument(id){
  if(confirm('¿Borrar documento?')){
    await api('/api/documents/'+id,{method:'DELETE'});
    viewDocuments();
  }
}

init();


// ---------- V53 ENTERPRISE OVERRIDES ----------
function v53Money(n){ return Number(n||0).toFixed(2)+' €'; }

function v53ChartTooltip(){
  let el=document.getElementById('v53Tooltip');
  if(!el){
    el=document.createElement('div');
    el.id='v53Tooltip';
    el.className='v53-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

function v53ShowTooltip(ev, html){
  const el=v53ChartTooltip();
  el.innerHTML=html;
  el.style.display='block';
  const pad=16;
  let x=ev.clientX+14, y=ev.clientY+14;
  const rect=el.getBoundingClientRect();
  if(x+rect.width>window.innerWidth-pad) x=ev.clientX-rect.width-14;
  if(y+rect.height>window.innerHeight-pad) y=ev.clientY-rect.height-14;
  el.style.left=x+'px';
  el.style.top=y+'px';
}

function v53HideTooltip(){
  const el=document.getElementById('v53Tooltip');
  if(el) el.style.display='none';
}

async function viewDashboard(){
  const d = await api('/api/dashboard').catch(()=>({}));
  const ingresos = Number(d.revenue || d.income || d.total || 0);
  const beneficio = Number(d.profit || 0);
  const activos = Number(d.active || 0);
  const operarios = Number(d.users || d.workers || 0);
  const clientes = Number(d.clients || 0);
  const eventos = Number(d.events || 0);
  const albaranesSinFirma = Number(d.unsigned_notes || d.notes_unsigned || 0);
  const monthly = d.monthly || [];

  $('#content').innerHTML = `
    <div class="v53-kpi-grid">
      <div class="v53-kpi-card"><div class="label">Ingresos</div><div class="value">${v53Money(ingresos)}</div></div>
      <div class="v53-kpi-card"><div class="label">Beneficio</div><div class="value">${v53Money(beneficio)}</div></div>
      <div class="v53-kpi-card"><div class="label">Eventos activos</div><div class="value">${activos}</div></div>
      <div class="v53-kpi-card"><div class="label">Operarios</div><div class="value">${operarios}</div></div>
      <div class="v53-kpi-card"><div class="label">Clientes</div><div class="value">${clientes}</div></div>
      <div class="v53-kpi-card"><div class="label">Albaranes sin firma</div><div class="value">${albaranesSinFirma}</div></div>
      <div class="v53-kpi-card"><div class="label">Eventos totales</div><div class="value">${eventos}</div></div>
    </div>

    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Progresión anual</h3>
          <p class="v52-sub">Tooltip mejorado: no se corta y muestra datos ampliados por mes.</p>
        </div>
        <button onclick="go('finanzas')">Ver Finanzas Pro</button>
      </div>
      <div class="chart v53-chart-wrap">
        ${(monthly.length?monthly:[{month:'Demo',amount:1,profit:0,events:0,cost:0}]).map(x=>`
          <div class="bar"
               style="height:${Math.max(12,Math.min(200,Number(x.amount||0)/8))}px"
               onmousemove="v53ShowTooltip(event,'<b>${esc(x.month||'Mes')}</b><br>Facturación: ${v53Money(x.amount||0)}<br>Beneficio: ${v53Money(x.profit||0)}<br>Coste: ${v53Money(x.cost||0)}<br>Eventos: ${Number(x.events||0)}')"
               onmouseleave="v53HideTooltip()">
            <span>${esc(x.month||'Mes')}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <h3>Alertas operativas</h3>
      ${(d.alerts||[]).length ? d.alerts.map(a=>`<p><span class="status-badge status-warn">${esc(a.type||'alerta')}</span> ${esc(a.text||a.message||'')}</p>`).join('') : '<p class="muted">Sin alertas críticas.</p>'}
    </div>

    <div class="card">
      <h3>Accesos rápidos</h3>
      <div class="actions">
        <button onclick="go('eventos')">Crear evento</button>
        <button onclick="go('tarifas')">Tarifas</button>
        <button onclick="go('gps')">GPS Live</button>
        <button onclick="go('finanzas')">Finanzas Pro</button>
        <button onclick="go('documentacion')">Documentación</button>
        <button onclick="go('albaranes')">Albaranes A4</button>
      </div>
    </div>
  `;
}

async function viewRates(){
  const rates = await api('/api/rates').catch(()=>[]);
  $('#content').innerHTML = `
    <div class="card">
      <h3>Tarifas</h3>
      <p class="muted">Explicación rápida de importes y selectores.</p>
      <div class="v53-rate-help">
        <div class="v53-help-chip"><b>18,5 €</b>Operario estándar diurno</div>
        <div class="v53-help-chip"><b>23,5 €</b>Operario nocturno / especial</div>
        <div class="v53-help-chip"><b>15 €</b>Dieta</div>
        <div class="v53-help-chip"><b>0 €</b>Sin dieta / sin extra</div>
      </div>
      <div class="v53-legend">
        <span class="v53-pill">N = Nocturno</span>
        <span class="v53-pill">D = Diurno</span>
      </div>
      <form id="rateForm" class="grid">
        <input class="field" name="role" placeholder="Tipo de operario / cargo">
        <input class="field" name="hourly_rate" type="number" step="0.01" placeholder="18.5 · D">
        <input class="field" name="night_rate" type="number" step="0.01" placeholder="23.5 · N">
        <input class="field" name="diet" type="number" step="0.01" placeholder="15 · Dieta">
        <button>Guardar tarifa</button>
      </form>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Tipo</th><th>D / Diurno</th><th>N / Nocturno</th><th>Dieta</th><th>Estado</th></tr></thead>
        <tbody>${rates.map(r=>`
          <tr>
            <td><b>${esc(r.role||r.name||'')}</b></td>
            <td><span class="v53-pill">D</span> ${v53Money(r.hourly_rate||0)}</td>
            <td><span class="v53-pill">N</span> ${v53Money(r.night_rate||0)}</td>
            <td>${v53Money(r.diet||0)}</td>
            <td>${Number(r.active)!==0?'<span class="status-badge status-ok">Activa</span>':'<span class="status-badge status-bad">Inactiva</span>'}</td>
          </tr>
        `).join('') || '<tr><td colspan="5">Sin tarifas.</td></tr>'}</tbody>
      </table>
    </div>
  `;
  const f=$('#rateForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const payload={...Object.fromEntries(new FormData(e.target)), active:1};
    await api('/api/rates',{method:'POST',body:JSON.stringify(payload)});
    viewRates();
  };
}

async function viewGpsLive(radius=Number(localStorage.getItem('gpsRadius')||300)){
  localStorage.setItem('gpsRadius', radius);
  const date = localDateStr ? localDateStr() : new Date().toISOString().slice(0,10);
  const data = await api('/api/gps/live?date='+date+'&radius='+radius);
  const rows = data.rows.map(r=>`<tr>
    <td data-label="Operario"><b>${esc((r.first_name||'')+' '+(r.last_name||''))}</b><br>${esc(r.phone||'')}</td>
    <td data-label="Evento"><b>${esc(r.event_name)}</b><br>${esc(r.location||'')}</td>
    <td data-label="Estado">${r.gps_status==='en_evento'?'<span class="status-badge status-ok">En evento</span>':r.gps_status==='fuera_radio'?'<span class="status-badge status-bad">Fuera radio</span>':'<span class="status-badge status-warn">'+esc(r.gps_status)+'</span>'}</td>
    <td data-label="Distancia">${r.distance_m!==null&&r.distance_m!==undefined?r.distance_m+' m':'—'}</td>
    <td data-label="Último">${r.last_log?new Date(r.last_log.timestamp).toLocaleString('es-ES'):'—'}</td>
  </tr>`).join('');
  $('#content').innerHTML = `
    <div class="card">
      <h3>GPS Live</h3>
      <p class="muted">Selecciona el radio de control para mayor precisión.</p>
      <div class="v53-radio-row">
        ${[50,100,200,300,500].map(r=>`<button class="${Number(radius)===r?'active':''}" onclick="viewGpsLive(${r})">${r}m</button>`).join('')}
      </div>
    </div>
    <div class="v53-kpi-grid">
      <div class="v53-kpi-card"><div class="label">Radio seleccionado</div><div class="value">${radius}m</div></div>
      <div class="v53-kpi-card"><div class="label">Operarios monitorizados</div><div class="value">${data.rows.length}</div></div>
      <div class="v53-kpi-card"><div class="label">En evento</div><div class="value">${data.rows.filter(r=>r.gps_status==='en_evento').length}</div></div>
      <div class="v53-kpi-card"><div class="label">Fuera radio</div><div class="value">${data.rows.filter(r=>r.gps_status==='fuera_radio').length}</div></div>
    </div>
    <div class="card">
      <table class="table"><thead><tr><th>Operario</th><th>Evento</th><th>Estado</th><th>Distancia</th><th>Último</th></tr></thead><tbody>${rows||'<tr><td>Sin datos GPS hoy.</td></tr>'}</tbody></table>
    </div>
  `;
}

async function viewFinancePro(){
  const data = await api('/api/finance/events');
  const rows = data.rows.map(r=>`<tr>
    <td data-label="Evento"><b>${esc(r.event.name)}</b><br>${formatLocalDate(r.event.event_date)}</td>
    <td data-label="Ingresos">${v53Money(r.revenue||0)} + IVA</td>
    <td data-label="Costes">${v53Money(r.totalCost||0)}</td>
    <td data-label="Beneficio"><b>${v53Money(r.profit||0)}</b></td>
    <td data-label="Margen">${Number(r.margin||0).toFixed(2)}%</td>
    <td data-label="Acción"><button onclick="openFinanceCostsV53(${r.event.id})">Costes reales</button></td>
  </tr>`).join('');
  $('#content').innerHTML = `
    <div class="v53-kpi-grid">
      <div class="v53-kpi-card"><div class="label">Ingresos</div><div class="value">${v53Money(data.totals.revenue||0)}</div></div>
      <div class="v53-kpi-card"><div class="label">Costes</div><div class="value">${v53Money(data.totals.cost||0)}</div></div>
      <div class="v53-kpi-card"><div class="label">Beneficio</div><div class="value">${v53Money(data.totals.profit||0)}</div></div>
      <div class="v53-kpi-card"><div class="label">Margen</div><div class="value">${Number(data.totals.margin||0).toFixed(2)}%</div></div>
    </div>
    <div class="card">
      <h3>Finanzas Pro · Costes reales</h3>
      <table class="table"><thead><tr><th>Evento</th><th>Ingresos</th><th>Costes</th><th>Beneficio</th><th>Margen</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>Sin eventos financieros.</td></tr>'}</tbody></table>
    </div>
  `;
}

function openFinanceCostsV53(eventId){
  $('#modalRoot').innerHTML = `
    <div class="modal-back"><div class="modal">
      <div class="modal-head"><h2>Costes reales del evento</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
      <form id="costFormV53" class="grid">
        <input class="col-3" name="cost_staff" type="number" step="0.01" placeholder="Coste operarios">
        <input class="col-3" name="cost_social_security" type="number" step="0.01" placeholder="Seguridad Social">
        <input class="col-3" name="cost_gestoria" type="number" step="0.01" placeholder="Gestoría">
        <input class="col-3" name="cost_fixed" type="number" step="0.01" placeholder="Costes fijos">
        <input class="col-3" name="cost_transport" type="number" step="0.01" placeholder="Transporte">
        <input class="col-3" name="cost_taxi" type="number" step="0.01" placeholder="Taxi">
        <input class="col-3" name="cost_hotel" type="number" step="0.01" placeholder="Hotel">
        <input class="col-3" name="cost_extra_hours" type="number" step="0.01" placeholder="Horas extra">
        <input class="col-3" name="cost_other" type="number" step="0.01" placeholder="Otros costes">
        <select class="col-3" name="payment_status">
          <option value="pendiente">Pendiente</option>
          <option value="facturado">Facturado</option>
          <option value="cobrado">Cobrado</option>
          <option value="parcial">Parcial</option>
          <option value="impagado">Impagado</option>
        </select>
        <button class="col-12">Guardar costes reales</button>
      </form>
    </div></div>`;
  $('#costFormV53').onsubmit=async e=>{
    e.preventDefault();
    await api('/api/finance/events/'+eventId+'/detailed-costs',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    closeWizard();
    viewFinancePro();
  };
}

async function viewDocuments(){
  const docs = await api('/api/documents');
  const users = state.users || await api('/api/users').catch(()=>[]);
  const rows = docs.map(d=>`<tr>
    <td data-label="Operario"><b>${esc((d.first_name||'')+' '+(d.last_name||''))}</b><br>${esc(d.phone||'')}</td>
    <td data-label="Documento">${esc(d.doc_type)}<br><b>${esc(d.title)}</b></td>
    <td data-label="Validez">${d.issue_date||'—'} → ${d.expiry_date||'—'}</td>
    <td data-label="Estado">${d.computed_status==='vigente'?'<span class="status-badge status-ok">Vigente</span>':d.computed_status==='proximo_caducar'?'<span class="status-badge status-warn">Próximo</span>':'<span class="status-badge status-bad">'+esc(d.computed_status)+'</span>'}</td>
    <td data-label="Archivo">${d.file_url?`<a target="_blank" href="${d.file_url}"><button>Ver</button></a>`:'—'}</td>
    <td data-label="PDF"><button class="secondary" onclick="printDocA4(${d.id})">PDF A4</button></td>
    <td data-label="Acción"><button class="danger" onclick="deleteDocument(${d.id})">Borrar</button></td>
  </tr>`).join('');
  $('#content').innerHTML = `
    <div class="card">
      <h3>Documentación RRHH</h3>
      <form id="docForm" class="grid">
        <select class="col-3" name="user_id">${users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${fullName(u)}</option>`).join('')}</select>
        <select class="col-2" name="doc_type"><option>PRL</option><option>DNI/NIE</option><option>Carretilla</option><option>Plataforma</option><option>Contrato</option><option>Alta SS</option><option>Formación</option><option>Otros</option></select>
        <input class="col-3" name="title" placeholder="Título documento">
        <input class="col-2" name="issue_date" type="date" title="Fecha emisión">
        <input class="col-2" name="expiry_date" type="date" title="Fecha validez/caducidad">
        <input class="col-12" id="docFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx">
        <textarea class="col-12" name="notes" placeholder="Observaciones"></textarea>
        <button class="col-12">Guardar documento con archivo</button>
      </form>
    </div>
    <div class="card">
      <table class="table"><thead><tr><th>Operario</th><th>Documento</th><th>Validez</th><th>Estado</th><th>Archivo</th><th>PDF</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>Sin documentos.</td></tr>'}</tbody></table>
    </div>`;
  $('#docForm').onsubmit=async e=>{
    e.preventDefault();
    const payload=Object.fromEntries(new FormData(e.target));
    const file=$('#docFile').files[0];
    if(file){
      payload.file_name=file.name;
      payload.dataUrl=await fileToDataUrl(file);
    }
    await api('/api/documents',{method:'POST',body:JSON.stringify(payload)});
    viewDocuments();
  };
}

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

async function printDocA4(id){
  const docs=await api('/api/documents');
  const d=docs.find(x=>Number(x.id)===Number(id));
  if(!d)return;
  openA4Window('Documento operario', `
    <h1>Documento operario</h1>
    <table>
      <tr><td><b>Operario</b></td><td>${esc((d.first_name||'')+' '+(d.last_name||''))}</td></tr>
      <tr><td><b>Tipo</b></td><td>${esc(d.doc_type)}</td></tr>
      <tr><td><b>Título</b></td><td>${esc(d.title)}</td></tr>
      <tr><td><b>Emisión</b></td><td>${esc(d.issue_date||'—')}</td></tr>
      <tr><td><b>Validez</b></td><td>${esc(d.expiry_date||'—')}</td></tr>
      <tr><td><b>Estado</b></td><td>${esc(d.computed_status||'')}</td></tr>
      <tr><td><b>Observaciones</b></td><td>${esc(d.notes||'')}</td></tr>
    </table>
  `);
}

function openA4Window(title, body){
  const w=window.open('','_blank');
  w.document.write(`<html><head><title>${esc(title)}</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:Arial;color:#111}.head{border-bottom:2px solid #111;margin-bottom:18px;padding-bottom:10px}h1{font-size:22px}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:8px}.foot{margin-top:30px;font-size:12px;color:#666}</style></head><body><div class="head"><h1>MARFAN CREW</h1><p>${esc(title)} · A4 Vertical</p></div>${body}<div class="foot">Documento generado desde Marfan Crew Hours</div><br><button onclick="window.print()">Imprimir / Guardar PDF</button></body></html>`);
  w.document.close();
}

async function operario(){
  const ev=await api('/api/events').catch(()=>[]);
  const docs=await api('/api/my-documents').catch(()=>[]);
  $('#content').innerHTML=`
    <div class="card">
      <h3>Mis eventos asignados</h3>
      <table class="table"><tbody>${ev.map(e=>`<tr><td>${formatLocalDate(e.event_date)}<br>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</td><td><b>${esc(e.name)}</b><br>${esc(e.location||'')}</td><td><button onclick="clock(${e.id},'entrada')">Entrada</button><button class="danger" onclick="clock(${e.id},'salida')">Salida</button></td></tr>`).join('')||'<tr><td>Sin eventos asignados.</td></tr>'}</tbody></table>
    </div>
    <div class="card">
      <h3>Mis documentos</h3>
      <p class="muted">Documentos disponibles para enseñar o descargar si los solicita el cliente.</p>
      ${docs.map(d=>`<div class="v53-doc-card"><b>${esc(d.title)}</b><br>${esc(d.doc_type)} · Validez: ${esc(d.expiry_date||'—')}<br>${d.file_url?`<a target="_blank" href="${d.file_url}"><button>Ver documento</button></a>`:''}<button class="secondary" onclick="printMyDocA4(${d.id})">PDF A4</button></div>`).join('')||'<p class="muted">No tienes documentos asignados.</p>'}
      <p class="muted">Contactar oficina: <a href="https://wa.me/34635371634" target="_blank">WhatsApp oficina</a></p>
    </div>
  `;
}

async function printMyDocA4(id){
  const docs=await api('/api/my-documents');
  const d=docs.find(x=>Number(x.id)===Number(id));
  if(!d)return;
  openA4Window('Mi documento', `
    <h1>${esc(d.title)}</h1>
    <table>
      <tr><td><b>Tipo</b></td><td>${esc(d.doc_type)}</td></tr>
      <tr><td><b>Validez</b></td><td>${esc(d.expiry_date||'—')}</td></tr>
      <tr><td><b>Estado</b></td><td>${esc(d.computed_status||'')}</td></tr>
    </table>
  `);
}

async function deleteDocument(id){
  if(confirm('¿Borrar documento?')){
    await api('/api/documents/'+id,{method:'DELETE'});
    viewDocuments();
  }
}


// ---------- V53.1 DELETE / SUSPEND / BACKUP OVERRIDES ----------

// Login operario reforzado: bloquea suspendidos
async function doPhone(){
  try{
    let d;
    try {
      d = await api('/api/login-phone-v531',{method:'POST',body:JSON.stringify({phone:$('#phone').value})});
    } catch(e) {
      d = await api('/api/login-phone',{method:'POST',body:JSON.stringify({phone:$('#phone').value})});
    }
    state.user=d.user;
    state.view='operario';
    render();
  }catch(e){
    $('#loginMsg').innerHTML='❌ '+esc(e.message);
  }
}

// Eventos con botón borrar real + confirmación
async function viewCalendar(){
  const events = await api('/api/events');
  const clients = await api('/api/clients').catch(()=>[]);
  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Eventos</h3>
          <p class="v52-sub">Crear, gestionar y borrar eventos con confirmación.</p>
        </div>
      </div>
      <form id="eventForm" class="grid">
        <input class="field" name="name" placeholder="Nombre evento" required>
        <select class="field" name="client_id"><option value="">Cliente</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name||c.legal_name||'Cliente')}</option>`).join('')}</select>
        <input class="field" name="location" placeholder="Localización">
        <input class="field" name="event_date" type="date" value="${typeof localDateStr==='function'?localDateStr():new Date().toISOString().slice(0,10)}">
        <input class="field" name="start_time" type="time">
        <input class="field" name="end_time" type="time">
        <button>Crear evento</button>
      </form>
    </div>

    <div class="card">
      <h3>Listado de eventos</h3>
      <table class="table">
        <thead><tr><th>Fecha</th><th>Evento</th><th>Cliente / Localización</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${events.map(e=>`
            <tr>
              <td>${formatLocalDate ? formatLocalDate(e.event_date) : esc(e.event_date)}<br>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</td>
              <td><b>${esc(e.name||'')}</b></td>
              <td>${esc(e.client||'')}<br><span class="muted">${esc(e.location||'')}</span></td>
              <td>${esc(e.status||e.operational_status||'')}</td>
              <td>
                <button onclick="openEventDetail(${e.id})">Abrir</button>
                <button class="danger" onclick="deleteEventV531(${e.id}, '${esc(e.name||'Evento').replace(/'/g, "\\'")}')">Borrar</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5">Sin eventos.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  const f=$('#eventForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/events',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    viewCalendar();
  };
}

async function deleteEventV531(id, name){
  const ok = confirm(`ATENCIÓN: se va a borrar el evento "${name}".\n\nTambién se eliminarán sus asignaciones, fichajes, producción y albaranes relacionados.\n\n¿Confirmas el borrado?`);
  if(!ok) return;
  await api('/api/events/'+id,{method:'DELETE'});
  alert('Evento borrado correctamente.');
  viewCalendar();
}

// Operarios: borrar + suspender/reactivar
async function viewUsers(){
  const users = await api('/api/users');
  $('#content').innerHTML = `
    <div class="card">
      <h3>Crear operario</h3>
      <form id="userForm" class="grid">
        <input class="field" name="first_name" placeholder="Nombre">
        <input class="field" name="last_name" placeholder="Apellidos">
        <input class="field" name="phone" placeholder="Teléfono">
        <input class="field" name="email" placeholder="Email">
        <select class="field" name="role"><option value="operario">Operario</option><option value="jefe">Jefe equipo</option></select>
        <input class="field" name="services" placeholder="Servicios / cargo">
        <button>Crear operario</button>
      </form>
    </div>

    <div class="card">
      <h3>Operarios</h3>
      <table class="table">
        <thead><tr><th>Operario</th><th>Rol</th><th>Servicios</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.filter(u=>u.role!=='admin').map(u=>`
            <tr>
              <td><b>${esc(fullName ? fullName(u) : ((u.first_name||'')+' '+(u.last_name||'')))}</b><br>${esc(u.phone||'')}<br><span class="muted">${esc(u.email||'')}</span></td>
              <td>${esc(u.role||'')}</td>
              <td>${esc(u.services||'')}</td>
              <td>${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                ? '<span class="status-badge status-bad">Suspendido</span>'
                : '<span class="status-badge status-ok">Activo</span>'}</td>
              <td>
                ${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                  ? `<button class="ok" onclick="suspendUserV531(${u.id},0)">Reactivar</button>`
                  : `<button class="secondary" onclick="suspendUserV531(${u.id},1)">Suspender</button>`}
                <button class="danger" onclick="deleteUserV531(${u.id}, '${esc(fullName ? fullName(u) : (u.first_name||'Operario')).replace(/'/g, "\\'")}')">Borrar</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5">Sin operarios.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  const f=$('#userForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/users',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(e.target)),active:1,availability:'disponible'})});
    viewUsers();
  };
}

async function suspendUserV531(id, suspended){
  const msg = suspended
    ? 'Este operario quedará suspendido y NO podrá entrar a su panel de operario. ¿Confirmas?'
    : 'Este operario volverá a estar activo y podrá entrar a su panel. ¿Confirmas?';
  if(!confirm(msg)) return;
  await api('/api/users/'+id+'/suspend',{method:'PUT',body:JSON.stringify({suspended})});
  viewUsers();
}

async function deleteUserV531(id, name){
  if(!confirm(`ATENCIÓN: se va a borrar el operario "${name}".\n\nSe eliminarán sus asignaciones, fichajes y documentos.\n\n¿Confirmas el borrado?`)) return;
  await api('/api/users/'+id,{method:'DELETE'});
  alert('Operario borrado correctamente.');
  viewUsers();
}

// Ajustes con backup export/import
async function viewConfig(){
  let settings = {};
  try { settings = await api('/api/settings'); } catch(e) {}
  $('#content').innerHTML = `
    <div class="card">
      <h3>Ajustes generales</h3>
      <form id="settingsForm" class="grid">
        <input class="field" name="company_name" value="${esc(settings.company_name||settings.company||'MARFAN CREW')}" placeholder="Empresa">
        <input class="field" name="vat" value="${esc(settings.vat||21)}" placeholder="IVA">
        <input class="field" name="geo_check_radius_m" value="${esc(settings.geo_check_radius_m||settings.gpsRadius||300)}" placeholder="Radio GPS">
        <button>Guardar ajustes</button>
      </form>
    </div>

    <div class="card">
      <h3>Copia de seguridad</h3>
      <p class="muted">Descarga o restaura todos los datos de la web app: eventos, operarios, clientes, usuarios, fichajes, albaranes, tarifas y documentación.</p>
      <div class="actions">
        <button onclick="downloadBackupV531()">Descargar copia de seguridad</button>
        <label class="secondary" style="display:inline-block;padding:12px 16px;border-radius:11px;font-weight:900;cursor:pointer">
          Cargar copia de seguridad
          <input id="backupFileV531" type="file" accept=".json" style="display:none" onchange="uploadBackupV531(event)">
        </label>
      </div>
      <p class="muted"><b>Importante:</b> restaurar una copia reemplaza los datos actuales por los del archivo cargado.</p>
    </div>
  `;
  const f=$('#settingsForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    alert('Ajustes guardados.');
  };
}

async function downloadBackupV531(){
  const res = await fetch('/api/backup/export',{headers:{Authorization: token ? 'Bearer '+token : ''}});
  if(!res.ok){
    alert('No se pudo descargar la copia.');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function uploadBackupV531(ev){
  const file = ev.target.files[0];
  if(!file) return;
  if(!confirm('ATENCIÓN: vas a restaurar una copia de seguridad.\n\nEsto reemplazará la información actual de eventos, operarios, clientes, fichajes, albaranes y ajustes.\n\n¿Quieres continuar?')) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){ alert('Archivo JSON no válido.'); return; }

  await api('/api/backup/import',{method:'POST',body:JSON.stringify(data)});
  alert('Copia restaurada correctamente. Recarga la página.');
  location.reload();
}


// ---------- V53.2 DASHBOARD GRAPH RESTORE ----------
function v532Tooltip(){
  let el=document.getElementById('v532Tooltip');
  if(!el){
    el=document.createElement('div');
    el.id='v532Tooltip';
    el.className='v532-tooltip';
    document.body.appendChild(el);
  }
  return el;
}
function v532ShowTooltip(ev, html){
  const el=v532Tooltip();
  el.innerHTML=html;
  el.style.display='block';
  let x=ev.clientX+14, y=ev.clientY+14;
  const rect=el.getBoundingClientRect();
  if(x+rect.width>window.innerWidth-12) x=ev.clientX-rect.width-14;
  if(y+rect.height>window.innerHeight-12) y=ev.clientY-rect.height-14;
  el.style.left=x+'px';
  el.style.top=y+'px';
}
function v532HideTooltip(){
  const el=document.getElementById('v532Tooltip');
  if(el) el.style.display='none';
}

async function viewDashboard(){
  const d = await api('/api/dashboard').catch(()=>({}));
  let graph = [];
  try {
    graph = (await api('/api/dashboard-graph')).rows || [];
  } catch(e) {
    graph = d.monthly || [];
  }

  const ingresos = Number(d.revenue || d.income || d.total || 0);
  const beneficio = Number(d.profit || 0);
  const activos = Number(d.active || 0);
  const operarios = Number(d.users || d.workers || 0);
  const clientes = Number(d.clients || 0);
  const eventos = Number(d.events || 0);
  const albaranesSinFirma = Number(d.unsigned_notes || d.notes_unsigned || 0);
  const max = Math.max(1, ...graph.map(x=>Number(x.amount||0)));

  $('#content').innerHTML = `
    <div class="v53-kpi-grid">
      <div class="v53-kpi-card"><div class="label">Ingresos</div><div class="value">${v53Money(ingresos)}</div></div>
      <div class="v53-kpi-card"><div class="label">Beneficio</div><div class="value">${v53Money(beneficio)}</div></div>
      <div class="v53-kpi-card"><div class="label">Eventos activos</div><div class="value">${activos}</div></div>
      <div class="v53-kpi-card"><div class="label">Operarios</div><div class="value">${operarios}</div></div>
      <div class="v53-kpi-card"><div class="label">Clientes</div><div class="value">${clientes}</div></div>
      <div class="v53-kpi-card"><div class="label">Albaranes sin firma</div><div class="value">${albaranesSinFirma}</div></div>
      <div class="v53-kpi-card"><div class="label">Eventos totales</div><div class="value">${eventos}</div></div>
    </div>

    <div class="card v532-chart-card">
      <div class="v52-head">
        <div>
          <h3>Progresión anual de facturación</h3>
          <p class="v52-sub">Gráfica restaurada con tooltip flotante para que no se corte la información mensual.</p>
        </div>
        <div class="actions">
          <button onclick="go('finanzas')">Ver Finanzas Pro</button>
          <button class="secondary" onclick="go('eventos')">Eventos</button>
        </div>
      </div>

      <div class="v532-chart">
        ${(graph.length?graph:[{month:'Demo',amount:0,profit:0,cost:0,events:0}]).map(x=>{
          const h = Math.max(8, Math.round((Number(x.amount||0)/max)*190));
          const month = esc(x.month||'Mes');
          const amount = v53Money(x.amount||0);
          const profit = v53Money(x.profit||0);
          const cost = v53Money(x.cost||0);
          const events = Number(x.events||0);
          return `
            <div class="v532-bar-wrap">
              <div class="v532-bar"
                style="height:${h}px"
                onmousemove="v532ShowTooltip(event, '<b>${month}</b><br>Facturación: ${amount}<br>Beneficio: ${profit}<br>Coste: ${cost}<br>Eventos: ${events}')"
                onclick="v532ShowTooltip(event, '<b>${month}</b><br>Facturación: ${amount}<br>Beneficio: ${profit}<br>Coste: ${cost}<br>Eventos: ${events}')"
                onmouseleave="v532HideTooltip()">
              </div>
              <div class="v532-month">${month}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <h3>Alertas operativas</h3>
      ${(d.alerts||[]).length ? d.alerts.map(a=>`<p><span class="status-badge status-warn">${esc(a.type||'alerta')}</span> ${esc(a.text||a.message||'')}</p>`).join('') : '<p class="muted">Sin alertas críticas.</p>'}
    </div>

    <div class="card">
      <h3>Accesos rápidos</h3>
      <div class="actions">
        <button onclick="go('eventos')">Crear evento</button>
        <button onclick="go('tarifas')">Tarifas</button>
        <button onclick="go('gps')">GPS Live</button>
        <button onclick="go('finanzas')">Finanzas Pro</button>
        <button onclick="go('documentacion')">Documentación</button>
        <button onclick="go('albaranes')">Albaranes A4</button>
      </div>
    </div>
  `;
}


// ---------- V53.3 BACKUP CENTER + CALENDAR RESTORE ----------
async function downloadBackupV531(){
  const res = await fetch('/api/backup/export-v533', {
    method:'GET',
    headers:{ Authorization: token ? 'Bearer '+token : '' }
  });
  if(!res.ok){
    const t = await res.text().catch(()=>'');
    alert('No se pudo descargar la copia de seguridad. ' + t);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function uploadBackupV531(ev){
  const file = ev.target.files[0];
  if(!file) return;
  if(!confirm('ATENCIÓN: vas a restaurar una copia de seguridad completa.\n\nEsto reemplazará los datos actuales por los del archivo.\n\n¿Confirmas?')) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){ alert('Archivo JSON no válido.'); return; }
  const r = await api('/api/backup/import-v533',{method:'POST',body:JSON.stringify(data)});
  alert(`Copia restaurada correctamente.\nTablas importadas: ${r.imported.length}\nSaltadas: ${r.skipped.length}`);
  location.reload();
}

async function saveOnlineBackupV533(){
  const r = await api('/api/backup/save-online',{method:'POST'});
  alert('Backup guardado en servidor: ' + r.filename);
  viewConfig();
}

async function restoreOnlineBackupV533(filename){
  if(!confirm(`Se restaurará el backup online:\n${filename}\n\n¿Confirmas?`)) return;
  const r = await api('/api/backup/restore-online',{method:'POST',body:JSON.stringify({filename})});
  alert(`Backup restaurado.\nTablas importadas: ${r.imported.length}\nSaltadas: ${r.skipped.length}`);
  location.reload();
}

async function refreshOnlineBackupsV533(){
  const box = document.getElementById('onlineBackupsBox');
  if(!box) return;
  try{
    const d = await api('/api/backup/list-online');
    box.innerHTML = `<div class="v533-backup-list">${
      d.backups.map(b=>`
        <div class="v533-backup-item">
          <div>
            <b>${esc(b.filename)}</b><br>
            <span class="muted">${new Date(b.created_at).toLocaleString('es-ES')} · ${(b.size_bytes/1024).toFixed(1)} KB</span>
          </div>
          <button onclick="restoreOnlineBackupV533('${esc(b.filename).replace(/'/g,"\\'")}')">Restaurar</button>
        </div>
      `).join('') || '<p class="muted">No hay backups online guardados todavía.</p>'
    }</div>`;
  }catch(e){
    box.innerHTML = '<p class="muted">No se pudieron listar los backups online.</p>';
  }
}

async function viewConfig(){
  let settings = {};
  try { settings = await api('/api/settings'); } catch(e) {}
  $('#content').innerHTML = `
    <div class="card">
      <h3>Ajustes generales</h3>
      <form id="settingsForm" class="grid">
        <input class="field" name="company_name" value="${esc(settings.company_name||settings.company||'MARFAN CREW')}" placeholder="Empresa">
        <input class="field" name="vat" value="${esc(settings.vat||21)}" placeholder="IVA">
        <input class="field" name="geo_check_radius_m" value="${esc(settings.geo_check_radius_m||settings.gpsRadius||300)}" placeholder="Radio GPS">
        <button>Guardar ajustes</button>
      </form>
    </div>

    <div class="card">
      <h3>Copia de seguridad completa</h3>
      <p class="muted">Incluye eventos, operarios, usuarios, clientes, fichajes, tarifas, albaranes, documentación y ajustes.</p>
      <div class="actions">
        <button onclick="downloadBackupV531()">Descargar backup JSON</button>
        <label class="secondary" style="display:inline-block;padding:12px 16px;border-radius:11px;font-weight:900;cursor:pointer">
          Cargar backup JSON
          <input id="backupFileV531" type="file" accept=".json" style="display:none" onchange="uploadBackupV531(event)">
        </label>
      </div>
    </div>

    <div class="card">
      <h3>Backup online en servidor</h3>
      <p class="muted">Guarda copias dentro del servidor Railway. Para que sean persistentes a largo plazo, activa un volumen/persistent storage en Railway.</p>
      <div class="actions">
        <button onclick="saveOnlineBackupV533()">Guardar backup online ahora</button>
        <button class="secondary" onclick="refreshOnlineBackupsV533()">Actualizar lista</button>
      </div>
      <div id="onlineBackupsBox" style="margin-top:14px"></div>
    </div>
  `;
  const f=$('#settingsForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    alert('Ajustes guardados.');
  };
  refreshOnlineBackupsV533();
}

function v533MonthKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function v533DateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
let v533CalendarOffset = 0;

async function viewCalendar(){
  const events = await api('/api/events');
  const clients = await api('/api/clients').catch(()=>[]);
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth()+v533CalendarOffset, 1);
  const start = new Date(current);
  const startDay = (start.getDay()+6)%7; // lunes = 0
  start.setDate(start.getDate()-startDay);
  const days = [];
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    days.push(d);
  }
  const monthName = current.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Calendario de eventos</h3>
          <p class="v52-sub">Vista tipo Google Calendar restaurada.</p>
        </div>
        <div class="v533-cal-actions">
          <button class="secondary" onclick="v533CalendarOffset--;viewCalendar()">← Mes anterior</button>
          <button onclick="v533CalendarOffset=0;viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v533CalendarOffset++;viewCalendar()">Mes siguiente →</button>
        </div>
      </div>
      <h2 style="text-transform:capitalize">${monthName}</h2>
    </div>

    <div class="card">
      <h3>Crear evento rápido</h3>
      <form id="eventForm" class="grid">
        <input class="field" name="name" placeholder="Nombre evento" required>
        <select class="field" name="client_id"><option value="">Cliente</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name||c.legal_name||'Cliente')}</option>`).join('')}</select>
        <input class="field" name="location" placeholder="Localización">
        <input class="field" name="event_date" type="date" value="${v533DateKey(new Date())}">
        <input class="field" name="start_time" type="time">
        <input class="field" name="end_time" type="time">
        <button>Crear evento</button>
      </form>
    </div>

    <div class="v533-calendar-head">
      <div>Lunes</div><div>Martes</div><div>Miércoles</div><div>Jueves</div><div>Viernes</div><div>Sábado</div><div>Domingo</div>
    </div>
    <div class="v533-calendar">
      ${days.map(day=>{
        const key = v533DateKey(day);
        const evs = events.filter(e=>e.event_date===key);
        const other = day.getMonth()!==current.getMonth();
        return `
          <div class="v533-day ${other?'other':''}">
            <div class="v533-day-num">${day.getDate()}</div>
            ${evs.map(e=>`
              <span class="v533-event-chip ${e.status==='realizado'?'done':e.status==='cancelado'?'cancel':''}" onclick="openEventDetail(${e.id})">
                ${esc(e.start_time||'')} ${esc(e.name||'Evento')}
              </span>
            `).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;
  const f=$('#eventForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/events',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    viewCalendar();
  };
}


// ---------- V53.4 ENTERPRISE UX PATCH ----------
function v534Toast(msg){
 let el=document.getElementById('v534Toast');
 if(!el){
   el=document.createElement('div');
   el.id='v534Toast';
   el.style.cssText='position:fixed;right:20px;bottom:20px;background:#111;color:#fff;padding:14px 18px;border-radius:14px;z-index:999999;font-weight:800';
   document.body.appendChild(el);
 }
 el.innerHTML='✅ '+msg;
 el.style.display='block';
 clearTimeout(window.__toastv534);
 window.__toastv534=setTimeout(()=>el.style.display='none',2500);
}

const __fetchv534 = window.fetch;
window.fetch = async (...args)=>{
 const r = await __fetchv534(...args);
 try{
   const method=((args[1]||{}).method||'GET').toUpperCase();
   if(r.ok && ['POST','PUT','DELETE'].includes(method)){
      setTimeout(()=>v534Toast('Guardado correctamente'),100);
   }
 }catch(e){}
 return r;
};

async function finalizarEventoV534(id){
 if(!confirm('¿Finalizar evento y generar albaranes automáticamente?')) return;
 await api('/api/events/'+id+'/complete',{method:'POST'});
 v534Toast('Evento finalizado');
}

async function operario(){
  const docs=await api('/api/my-documents').catch(()=>[]);
  $('#content').innerHTML='<div class="card"><h3>📁 Mis documentos</h3>'+(
    docs.map(d=>'<div class="v53-doc-card"><b>'+esc(d.title||'Documento')+'</b><br>'+(d.file_url?'<a target="_blank" href="'+d.file_url+'"><button>Ver documento</button></a>':'')+'</div>').join('')
    || '<p>No hay documentos</p>'
  )+'</div>';
}


// ---------- V53.5 PERSISTENT BACKUP UI ----------
async function refreshOnlineBackupsV533(){
  const box = document.getElementById('onlineBackupsBox');
  if(!box) return;
  try{
    const status = await api('/api/backup/status').catch(()=>null);
    const d = await api('/api/backup/list-online');
    box.innerHTML = `
      ${status ? `<div class="v533-backup-item">
        <div>
          <b>Estado persistencia</b><br>
          <span class="muted">Datos: ${esc(status.persistent_data_dir)} · Backups: ${esc(status.persistent_backup_dir)}</span><br>
          <span class="muted">Importante: Railway necesita Volume montado en /data para conservarlo entre versiones.</span>
        </div>
      </div>` : ''}
      <div class="v533-backup-list">${
        d.backups.map(b=>`
          <div class="v533-backup-item">
            <div>
              <b>${esc(b.filename)}</b><br>
              <span class="muted">${new Date(b.created_at).toLocaleString('es-ES')} · ${(b.size_bytes/1024).toFixed(1)} KB</span>
            </div>
            <button onclick="restoreOnlineBackupV533('${esc(b.filename).replace(/'/g,"\\'")}')">Restaurar</button>
          </div>
        `).join('') || '<p class="muted">No hay backups online guardados todavía.</p>'
      }</div>`;
  }catch(e){
    box.innerHTML = '<p class="muted">No se pudieron listar los backups online.</p>';
  }
}


// ---------- V55 GOOGLE SYNC FULL FRONTEND ----------
let v55CalDate = new Date();
let v55CalView = localStorage.getItem('v55CalView') || 'month';

function v55DateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function v55AddDays(d,n){
  const x=new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function v55StartOfWeek(d){
  const x=new Date(d);
  const day=(x.getDay()+6)%7;
  x.setDate(x.getDate()-day);
  return x;
}
function v55CalendarTitle(){
  if(v55CalView==='day') return v55CalDate.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(v55CalView==='week'){
    const s=v55StartOfWeek(v55CalDate), e=v55AddDays(s,6);
    return `${s.toLocaleDateString('es-ES',{day:'numeric',month:'short'})} - ${e.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}`;
  }
  return v55CalDate.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
}
function v55MoveCalendar(n){
  if(v55CalView==='day') v55CalDate=v55AddDays(v55CalDate,n);
  else if(v55CalView==='week') v55CalDate=v55AddDays(v55CalDate,n*7);
  else v55CalDate=new Date(v55CalDate.getFullYear(), v55CalDate.getMonth()+n, 1);
  viewCalendar();
}
function v55SetView(v){
  v55CalView=v;
  localStorage.setItem('v55CalView',v);
  viewCalendar();
}
async function v55ConnectGoogle(){
  location.href='/auth/google-safe';
}
async function v55DisconnectGoogle(){
  if(!confirm('¿Desconectar Google Calendar?')) return;
  await api('/api/google/disconnect',{method:'POST'});
  viewCalendar();
}
async function v55ExportAll(){
  if(!confirm('¿Exportar a MARFANs los eventos activos a Google Calendar?')) return;
  const r=await api('/api/google/export-all',{method:'POST'});
  alert('Exportación terminada. Eventos procesados: '+(r.results||[]).length);
  viewCalendar();
}
async function v55ImportGoogle(){
  if(!confirm('¿Importar próximos eventos SOLO del calendario MARFAN?')) return;
  const r=await api('/api/google/import-upcoming',{method:'POST'});
  alert('Importados: '+(r.imported||[]).length);
  viewCalendar();
}
async function v55ExportOne(id){
  const r=await api('/api/google/export-event/'+id,{method:'POST'});
  alert('Evento sincronizado con Google Calendar.');
  if(r.htmlLink) window.open(r.htmlLink,'_blank');
}

function v55RenderMonth(events){
  const first=new Date(v55CalDate.getFullYear(), v55CalDate.getMonth(), 1);
  const start=v55StartOfWeek(first);
  const days=[];
  for(let i=0;i<42;i++) days.push(v55AddDays(start,i));
  return `<div class="v55-calendar-grid">
    ${days.map(day=>{
      const key=v55DateKey(day);
      const evs=events.filter(e=>e.event_date===key);
      const other=day.getMonth()!==v55CalDate.getMonth();
      return `<div class="v55-day-card ${other?'other':''}">
        <div class="v55-day-number">${day.getDate()}</div>
        ${evs.map(e=>`<span class="v55-event ${e.operational_status==='importado_google'?'google':''} ${e.status==='realizado'?'done':''} ${e.status==='cancelado'?'cancel':''}" onclick="openEventDetail(${e.id})">${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('')}
      </div>`;
    }).join('')}
  </div>`;
}
function v55RenderWeek(events){
  const start=v55StartOfWeek(v55CalDate);
  const days=[0,1,2,3,4,5,6].map(i=>v55AddDays(start,i));
  return `<div class="v55-week-grid">
    ${days.map(day=>{
      const key=v55DateKey(day);
      const evs=events.filter(e=>e.event_date===key);
      return `<div class="v55-day-card">
        <div class="v55-day-number">${day.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</div>
        ${evs.map(e=>`<span class="v55-event ${e.operational_status==='importado_google'?'google':''}" onclick="openEventDetail(${e.id})">${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('') || '<p class="muted">Sin eventos</p>'}
      </div>`;
    }).join('')}
  </div>`;
}
function v55RenderDay(events){
  const key=v55DateKey(v55CalDate);
  const evs=events.filter(e=>e.event_date===key);
  return `<div class="v55-day-view">
    ${Array.from({length:24}).map((_,h)=>{
      const hh=String(h).padStart(2,'0');
      const hourEvents=evs.filter(e=>String(e.start_time||'').startsWith(hh+':'));
      return `<div class="v55-hour">
        <div class="v55-hour-time">${hh}:00</div>
        <div class="v55-hour-events">${hourEvents.map(e=>`<span class="v55-event ${e.operational_status==='importado_google'?'google':''}" onclick="openEventDetail(${e.id})">${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('')}</div>
      </div>`;
    }).join('')}
  </div>`;
}

async function viewCalendar(){
  const events = await api('/api/events');
  const clients = await api('/api/clients').catch(()=>[]);
  const googleStatus = await api('/api/google/status').catch(()=>({configured:false,connected:false}));

  const body = v55CalView==='week' ? v55RenderWeek(events) : v55CalView==='day' ? v55RenderDay(events) : v55RenderMonth(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos</h3>
          <p class="v52-sub">Vista tipo Google Calendar. Solo sincroniza con el calendario MARFAN.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google conectado</span><button class="secondary" onclick="v55DisconnectGoogle()">Desconectar</button>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v55ConnectGoogle()">Google MARFAN</button>`}
          <button class="secondary" onclick="v55ImportGoogle()">Importar MARFAN</button>
          <button class="secondary" onclick="v55ExportAll()">Exportar a MARFAN</button>
        </div>
      </div>
      ${!googleStatus.configured ? '<p class="status-badge status-bad">Faltan variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL en Railway.</p>' : ''}
    </div>

    <div class="card">
      <h3>Crear evento rápido</h3>
      <form id="eventForm" class="grid">
        <input class="field" name="name" placeholder="Nombre evento" required>
        <select class="field" name="client_id"><option value="">Cliente</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name||c.legal_name||'Cliente')}</option>`).join('')}</select>
        <input class="field" name="location" placeholder="Localización">
        <input class="field" name="event_date" type="date" value="${v55DateKey(v55CalDate)}">
        <input class="field" name="start_time" type="time" value="09:00">
        <input class="field" name="end_time" type="time" value="10:00">
        <button>Crear evento</button>
      </form>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
  const f=$('#eventForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const created = await api('/api/events',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    if(confirm('Evento creado. ¿Quieres exportarlo a Google Calendar ahora?')){
      try { await v55ExportOne(created.id || created.event_id); } catch(err){ alert('Evento creado, pero no se pudo exportar: '+err.message); }
    }
    viewCalendar();
  };
}


// ---------- V55.2 PERSISTENT RECOVERY UI ----------
async function downloadBackupV531(){
  const res = await fetch('/api/backup/export-v552', {
    method:'GET',
    headers:{ Authorization: token ? 'Bearer '+token : '' }
  });
  if(!res.ok){
    alert('No se pudo descargar la copia de seguridad.');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marfan-crew-hours-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function uploadBackupV531(ev){
  const file = ev.target.files[0];
  if(!file) return;
  if(!confirm('ATENCIÓN: vas a restaurar una copia completa. Esto reemplazará los datos actuales. ¿Confirmas?')) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch(e){ alert('Archivo JSON no válido'); return; }
  const r = await api('/api/backup/import-v552',{method:'POST',body:JSON.stringify(data)});
  alert(`Copia restaurada.\nTablas importadas: ${r.imported.length}\nSaltadas: ${r.skipped.length}`);
  location.reload();
}

async function saveOnlineBackupV533(){
  const r = await api('/api/backup/save-online-v552',{method:'POST'});
  alert('Backup guardado en volumen persistente: '+r.filename);
  refreshOnlineBackupsV533();
}

async function restoreOnlineBackupV533(filename){
  if(!confirm(`Restaurar backup online:\n${filename}\n\n¿Confirmas?`)) return;
  const r = await api('/api/backup/restore-online-v552',{method:'POST',body:JSON.stringify({filename})});
  alert(`Backup restaurado.\nTablas importadas: ${r.imported.length}\nSaltadas: ${r.skipped.length}`);
  location.reload();
}

async function refreshOnlineBackupsV533(){
  const box = document.getElementById('onlineBackupsBox');
  if(!box) return;
  try{
    const status = await api('/api/backup/status-v552');
    const d = await api('/api/backup/list-online-v552');
    box.innerHTML = `
      <div class="v533-backup-item">
        <div>
          <b>Estado persistencia</b><br>
          <span class="muted">Datos: ${esc(status.data_dir)} · Backups: ${esc(status.backup_dir)}</span><br>
          <span class="${status.persistent_mounted?'status-badge status-ok':'status-badge status-bad'}">${esc(status.message)}</span><br>
          <span class="muted">Calendario Google objetivo: ${esc(status.google_target_calendar_name || 'MARFAN')}</span>
        </div>
      </div>
      <div class="v533-backup-list">${
        d.backups.map(b=>`
          <div class="v533-backup-item">
            <div>
              <b>${esc(b.filename)}</b><br>
              <span class="muted">${new Date(b.created_at).toLocaleString('es-ES')} · ${(b.size_bytes/1024).toFixed(1)} KB</span><br>
              <span class="muted">Ruta: ${esc(b.path || d.backup_dir || '')}</span>
            </div>
            <button onclick="restoreOnlineBackupV533('${esc(b.filename).replace(/'/g,"\\'")}')">Restaurar</button>
          </div>
        `).join('') || '<p class="muted">No hay backups online en el volumen persistente. Pulsa “Guardar backup online ahora”.</p>'
      }</div>`;
  }catch(e){
    box.innerHTML = '<p class="status-badge status-bad">No se pudieron listar backups: '+esc(e.message)+'</p>';
  }
}

async function viewConfig(){
  let settings = {};
  try { settings = await api('/api/settings'); } catch(e) {}
  $('#content').innerHTML = `
    <div class="card">
      <h3>Ajustes generales</h3>
      <form id="settingsForm" class="grid">
        <input class="field" name="company_name" value="${esc(settings.company_name||settings.company||'MARFAN CREW')}" placeholder="Empresa">
        <input class="field" name="vat" value="${esc(settings.vat||21)}" placeholder="IVA">
        <input class="field" name="geo_check_radius_m" value="${esc(settings.geo_check_radius_m||settings.gpsRadius||300)}" placeholder="Radio GPS">
        <button>Guardar ajustes</button>
      </form>
    </div>

    <div class="card">
      <h3>Copia de seguridad completa</h3>
      <p class="muted">La lista se lee desde /data/backups. Si al actualizar no aparece, es que Railway no está montando bien el Volume en /data.</p>
      <div class="actions">
        <button onclick="downloadBackupV531()">Descargar backup JSON</button>
        <label class="secondary" style="display:inline-block;padding:12px 16px;border-radius:11px;font-weight:900;cursor:pointer">
          Cargar backup JSON
          <input id="backupFileV531" type="file" accept=".json" style="display:none" onchange="uploadBackupV531(event)">
        </label>
      </div>
    </div>

    <div class="card">
      <h3>Backups online persistentes</h3>
      <p class="muted">Estos backups permanecen entre versiones SI el Volume está montado en /data.</p>
      <div class="actions">
        <button onclick="saveOnlineBackupV533()">Guardar backup online ahora</button>
        <button class="secondary" onclick="refreshOnlineBackupsV533()">Actualizar lista</button>
      </div>
      <div id="onlineBackupsBox" style="margin-top:14px"></div>
    </div>
  `;
  const f=$('#settingsForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    await api('/api/settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    alert('Ajustes guardados.');
  };
  refreshOnlineBackupsV533();
}


// ---------- V55.3 CALENDAR AUTO VIEW - NO CONFUSION BUTTON ----------
async function viewCalendar(){
  const localEvents = await api('/api/events');
  const clients = await api('/api/clients').catch(()=>[]);
  const googleStatus = await api('/api/google/status').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));
  const googleData = await api('/api/google/marfan-events').catch(()=>({connected:false,events:[],message:'Sin conexión Google'}));

  const googleEvents = googleData.events || [];
  const events = [
    ...localEvents.map(e=>({...e, source:'local'})),
    ...googleEvents
  ];

  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Vista tipo Google Calendar sincronizada automáticamente con el calendario MARFAN.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google MARFAN conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span>`}
          <button class="secondary" onclick="v55ImportGoogle()">Importar MARFAN</button>
          <button class="secondary" onclick="v55ExportAll()">Exportar a MARFAN</button>
        </div>
      </div>
      <div class="v553-sync-info">
        ${googleStatus.connected
          ? `Mostrando eventos locales + eventos del calendario Google “MARFAN”.`
          : `Para sincronizar con Google MARFAN, primero conecta OAuth en Variables Railway y entra una vez a /auth/google-safe.`}
      </div>
      ${!googleStatus.configured ? '<br><p class="status-badge status-bad">Faltan variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL en Railway.</p>' : ''}
    </div>

    <div class="card">
      <h3>Crear evento rápido</h3>
      <form id="eventForm" class="grid">
        <input class="field" name="name" placeholder="Nombre evento" required>
        <select class="field" name="client_id"><option value="">Cliente</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name||c.legal_name||'Cliente')}</option>`).join('')}</select>
        <input class="field" name="location" placeholder="Localización">
        <input class="field" name="event_date" type="date" value="${v55DateKey(v55CalDate)}">
        <input class="field" name="start_time" type="time" value="09:00">
        <input class="field" name="end_time" type="time" value="10:00">
        <button>Crear evento</button>
      </form>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;

  const f=$('#eventForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const created = await api('/api/events',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    if(googleStatus.connected){
      try { await v55ExportOne(created.id || created.event_id); } 
      catch(err){ alert('Evento creado, pero no se pudo exportar a MARFAN: '+err.message); }
    }
    viewCalendar();
  };
}

function v55RenderMonthAuto(events){
  const first=new Date(v55CalDate.getFullYear(), v55CalDate.getMonth(), 1);
  const start=v55StartOfWeek(first);
  const days=[];
  for(let i=0;i<42;i++) days.push(v55AddDays(start,i));
  return `<div class="v55-calendar-grid">
    ${days.map(day=>{
      const key=v55DateKey(day);
      const evs=events.filter(e=>e.event_date===key);
      const other=day.getMonth()!==v55CalDate.getMonth();
      return `<div class="v55-day-card ${other?'other':''}">
        <div class="v55-day-number">${day.getDate()}</div>
        ${evs.map(e=>`<span class="v55-event ${e.source==='google'?'google':'local'} ${e.status==='realizado'?'done':''} ${e.status==='cancelado'?'cancel':''}" onclick="${e.source==='google' && e.htmlLink ? `window.open('${e.htmlLink}','_blank')` : `openEventDetail(${e.id})`}">${e.source==='google'?'🔵':'⚫'} ${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function v55RenderWeekAuto(events){
  const start=v55StartOfWeek(v55CalDate);
  const days=[0,1,2,3,4,5,6].map(i=>v55AddDays(start,i));
  return `<div class="v55-week-grid">
    ${days.map(day=>{
      const key=v55DateKey(day);
      const evs=events.filter(e=>e.event_date===key);
      return `<div class="v55-day-card">
        <div class="v55-day-number">${day.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</div>
        ${evs.map(e=>`<span class="v55-event ${e.source==='google'?'google':'local'}" onclick="${e.source==='google' && e.htmlLink ? `window.open('${e.htmlLink}','_blank')` : `openEventDetail(${e.id})`}">${e.source==='google'?'🔵':'⚫'} ${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('') || '<p class="muted">Sin eventos</p>'}
      </div>`;
    }).join('')}
  </div>`;
}

function v55RenderDayAuto(events){
  const key=v55DateKey(v55CalDate);
  const evs=events.filter(e=>e.event_date===key);
  return `<div class="v55-day-view">
    ${Array.from({length:24}).map((_,h)=>{
      const hh=String(h).padStart(2,'0');
      const hourEvents=evs.filter(e=>String(e.start_time||'').startsWith(hh+':'));
      return `<div class="v55-hour">
        <div class="v55-hour-time">${hh}:00</div>
        <div class="v55-hour-events">${hourEvents.map(e=>`<span class="v55-event ${e.source==='google'?'google':'local'}" onclick="${e.source==='google' && e.htmlLink ? `window.open('${e.htmlLink}','_blank')` : `openEventDetail(${e.id})`}">${e.source==='google'?'🔵':'⚫'} ${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`).join('')}</div>
      </div>`;
    }).join('')}
  </div>`;
}


// ---------- V55.5 OPERARIOS PRO FRONTEND ----------
function resizeImageV555(file, maxSize=420, quality=.78){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if(w > h && w > maxSize){ h = Math.round(h * maxSize / w); w = maxSize; }
      else if(h >= w && h > maxSize){ w = Math.round(w * maxSize / h); h = maxSize; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    reader.readAsDataURL(file);
  });
}

function operatorAvatarV555(u, cls='operator-avatar'){
  return u.photo_url 
    ? `<img class="${cls}" src="${esc(u.photo_url)}" alt="">`
    : `<span class="${cls}" style="display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#667085">${esc((u.first_name||'?').slice(0,1))}</span>`;
}

function operatorDisplayNameV555(u){
  const base = `${u.first_name||''} ${u.last_name||''}`.trim() || u.email || u.phone || 'Operario';
  return `${esc(base)} ${u.nickname ? `<span class="operator-nickname">${esc(u.nickname)}</span>` : ''}`;
}

async function viewUsers(){
  const users = await api('/api/users');
  $('#content').innerHTML = `
    <div class="card">
      <h3>Crear operario · ficha completa</h3>
      <form id="userForm" class="grid">
        <input class="field" name="first_name" placeholder="Nombre">
        <input class="field" name="last_name" placeholder="Apellidos">
        <input class="field" name="nickname" placeholder="Apodo / mote">
        <input class="field" name="dni" placeholder="DNI / NIE">
        <input class="field" name="phone" placeholder="Teléfono">
        <input class="field" name="email" placeholder="Email">
        <input class="field" name="birth_date" type="date" title="Fecha nacimiento">
        <select class="field" name="role">
          <option value="operario">Operario</option>
          <option value="jefe">Jefe equipo</option>
        </select>
        <input class="field" name="services" placeholder="Servicios / cargo principal">
        <input class="field" name="skills" placeholder="Skills: carga, sonido, luces, runner...">
        <input class="field" name="address" placeholder="Dirección">
        <input class="field" name="city" placeholder="Ciudad">
        <input class="field" name="province" placeholder="Provincia">
        <input class="field" name="postal_code" placeholder="Código postal">
        <input class="field" name="emergency_contact" placeholder="Contacto emergencia">
        <input class="field" name="emergency_phone" placeholder="Teléfono emergencia">
        <input class="field" name="shirt_size" placeholder="Talla camiseta">
        <input class="field" name="shoe_size" placeholder="Número calzado">
        <input class="field" name="vehicle" placeholder="Vehículo propio / matrícula">
        <input class="field" name="license_type" placeholder="Carnet / permisos">
        <input class="field" name="iban" placeholder="IBAN">
        <input class="field" name="internal_hour_cost" type="number" step="0.01" placeholder="Coste interno hora">
        <input class="field" name="internal_night_cost" type="number" step="0.01" placeholder="Coste interno nocturno">
        <input class="field" id="operatorPhotoNew" type="file" accept="image/*">
        <textarea class="field" name="notes" placeholder="Notas internas" style="grid-column:1/-1"></textarea>
        <button style="grid-column:1/-1">Crear operario</button>
      </form>
    </div>

    <div class="card">
      <h3>Operarios</h3>
      <table class="table">
        <thead><tr><th>Operario</th><th>Contacto</th><th>Rol / Skills</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.filter(u=>u.role!=='admin').map(u=>`
            <tr>
              <td>
                <div class="operator-name-line">
                  ${operatorAvatarV555(u)}
                  <div><b>${operatorDisplayNameV555(u)}</b><br><span class="muted">${esc(u.dni||'')}</span></div>
                </div>
              </td>
              <td>${esc(u.phone||'')}<br><span class="muted">${esc(u.email||'')}</span></td>
              <td>${esc(u.role||'')}<br><span class="muted">${esc(u.services||u.skills||'')}</span></td>
              <td>${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                ? '<span class="status-badge status-bad">Suspendido</span>'
                : '<span class="status-badge status-ok">Activo</span>'}</td>
              <td>
                <button onclick="openOperatorFolderV555(${u.id})">Carpeta</button>
                ${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                  ? `<button class="ok" onclick="suspendUserV531(${u.id},0)">Reactivar</button>`
                  : `<button class="secondary" onclick="suspendUserV531(${u.id},1)">Suspender</button>`}
                <button class="danger" onclick="deleteUserV531(${u.id}, '${esc((u.first_name||'Operario')).replace(/'/g, "\\'")}')">Borrar</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5">Sin operarios.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  const f=$('#userForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const payload={...Object.fromEntries(new FormData(e.target)), active:1, availability:'disponible'};
    const created = await api('/api/users',{method:'POST',body:JSON.stringify(payload)});
    const file=$('#operatorPhotoNew').files[0];
    if(file && (created.id || created.user_id)){
      const dataUrl=await resizeImageV555(file);
      await api('/api/users/'+(created.id||created.user_id)+'/photo',{method:'POST',body:JSON.stringify({dataUrl})});
    }
    v534Toast ? v534Toast('Operario creado correctamente') : alert('Operario creado correctamente');
    viewUsers();
  };
}

async function openOperatorFolderV555(id){
  const data = await api('/api/users/'+id+'/folder');
  const u = data.user;
  const docs = data.docs || [];
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal">
        <div class="modal-head">
          <h2>Carpeta operario</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <div class="operator-folder-head">
          ${operatorAvatarV555(u,'operator-avatar-lg')}
          <div>
            <h2>${operatorDisplayNameV555(u)}</h2>
            <p class="muted">${esc(u.phone||'')} · ${esc(u.email||'')}</p>
            <p>${esc(u.services||'')} ${u.skills ? '· '+esc(u.skills) : ''}</p>
          </div>
        </div>

        <hr>

        <h3>Subir / cambiar fotografía</h3>
        <input id="operatorPhotoEdit" class="field" type="file" accept="image/*">
        <button onclick="uploadOperatorPhotoV555(${u.id})">Guardar fotografía</button>

        <hr>

        <h3>Datos completos</h3>
        <div class="grid">
          <p><b>DNI/NIE:</b><br>${esc(u.dni||'—')}</p>
          <p><b>Dirección:</b><br>${esc(u.address||'—')}</p>
          <p><b>Ciudad:</b><br>${esc(u.city||'—')}</p>
          <p><b>Provincia:</b><br>${esc(u.province||'—')}</p>
          <p><b>Emergencia:</b><br>${esc(u.emergency_contact||'—')} · ${esc(u.emergency_phone||'')}</p>
          <p><b>Tallas:</b><br>Camiseta ${esc(u.shirt_size||'—')} · Calzado ${esc(u.shoe_size||'—')}</p>
          <p><b>Vehículo:</b><br>${esc(u.vehicle||'—')}</p>
          <p><b>Carnet:</b><br>${esc(u.license_type||'—')}</p>
        </div>

        <hr>

        <h3>Documentos subidos</h3>
        ${docs.map(d=>`
          <div class="v53-doc-card">
            <b>${esc(d.title||'Documento')}</b><br>
            ${esc(d.doc_type||'')} · Validez: ${esc(d.expiry_date||'—')} · Estado: ${esc(d.computed_status||'')}<br><br>
            ${d.file_url ? `<a target="_blank" href="${esc(d.file_url)}"><button>Ver documento</button></a>` : ''}
            <button class="secondary" onclick="printDocA4(${d.id})">PDF A4</button>
          </div>
        `).join('') || '<p class="muted">Este operario todavía no tiene documentos subidos.</p>'}
      </div>
    </div>
  `;
}

async function uploadOperatorPhotoV555(id){
  const file = $('#operatorPhotoEdit').files[0];
  if(!file){ alert('Selecciona una imagen.'); return; }
  const dataUrl = await resizeImageV555(file);
  await api('/api/users/'+id+'/photo',{method:'POST',body:JSON.stringify({dataUrl})});
  v534Toast ? v534Toast('Fotografía guardada y redimensionada') : alert('Fotografía guardada');
  openOperatorFolderV555(id);
}


// ---------- V55.6 OPERARIOS UX CLIENTE STYLE ----------
async function viewUsers(){
  const users = await api('/api/users');

  $('#content').innerHTML = `
    <div class="card">
      <div class="operator-list-head">
        <div>
          <h3>Crear operario</h3>
          <p class="operator-form-help">Ficha organizada por bloques, igual que clientes: datos claros, lectura rápida y creación sencilla.</p>
        </div>
      </div>

      <form id="userForm" class="operator-create-layout">

        <div class="operator-section">
          <h4>1. Datos principales</h4>
          <div class="grid">
            <input class="field" name="first_name" placeholder="Nombre">
            <input class="field" name="last_name" placeholder="Apellidos">
            <input class="field" name="nickname" placeholder="Apodo / mote">
            <input class="field" name="dni" placeholder="DNI / NIE">
            <input class="field" name="birth_date" type="date" title="Fecha nacimiento">
            <input class="field" id="operatorPhotoNew" type="file" accept="image/*" title="Fotografía">
          </div>
        </div>

        <div class="operator-section">
          <h4>2. Contacto</h4>
          <div class="grid">
            <input class="field" name="phone" placeholder="Teléfono">
            <input class="field" name="email" placeholder="Email">
            <input class="field" name="address" placeholder="Dirección">
            <input class="field" name="city" placeholder="Ciudad">
            <input class="field" name="province" placeholder="Provincia">
            <input class="field" name="postal_code" placeholder="Código postal">
          </div>
        </div>

        <div class="operator-section">
          <h4>3. Perfil laboral</h4>
          <div class="grid">
            <select class="field" name="role">
              <option value="operario">Operario</option>
              <option value="jefe">Jefe equipo</option>
            </select>
            <input class="field" name="services" placeholder="Cargo principal">
            <input class="field" name="skills" placeholder="Skills / especialidades">
            <input class="field" name="vehicle" placeholder="Vehículo propio / matrícula">
            <input class="field" name="license_type" placeholder="Carnet / permisos">
            <select class="field" name="availability">
              <option value="disponible">Disponible</option>
              <option value="parcial">Parcial</option>
              <option value="no_disponible">No disponible</option>
            </select>
          </div>
        </div>

        <div class="operator-section">
          <h4>4. Costes internos</h4>
          <div class="grid">
            <input class="field" name="internal_hour_cost" type="number" step="0.01" placeholder="Coste interno hora">
            <input class="field" name="internal_night_cost" type="number" step="0.01" placeholder="Coste interno nocturno">
            <input class="field" name="iban" placeholder="IBAN">
          </div>
        </div>

        <div class="operator-section">
          <h4>5. Emergencias y equipación</h4>
          <div class="grid">
            <input class="field" name="emergency_contact" placeholder="Contacto emergencia">
            <input class="field" name="emergency_phone" placeholder="Teléfono emergencia">
            <input class="field" name="shirt_size" placeholder="Talla camiseta">
            <input class="field" name="shoe_size" placeholder="Número calzado">
          </div>
        </div>

        <div class="operator-section">
          <h4>6. Notas internas</h4>
          <textarea class="field" name="notes" placeholder="Notas internas del operario"></textarea>
        </div>

        <div class="operator-form-actions">
          <button type="reset" class="secondary">Limpiar</button>
          <button>Guardar operario</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="operator-list-head">
        <h3>Listado de operarios</h3>
        <span class="badge">${users.filter(u=>u.role!=='admin').length} operarios</span>
      </div>

      <table class="table">
        <thead><tr><th>Operario</th><th>Contacto</th><th>Perfil</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.filter(u=>u.role!=='admin').map(u=>`
            <tr>
              <td>
                <div class="operator-name-line">
                  ${operatorAvatarV555(u)}
                  <div>
                    <b>${operatorDisplayNameV555(u)}</b><br>
                    <span class="muted">${esc(u.dni||'')}</span>
                  </div>
                </div>
              </td>
              <td>${esc(u.phone||'')}<br><span class="muted">${esc(u.email||'')}</span></td>
              <td>${esc(u.role||'')}<br><span class="muted">${esc(u.services||u.skills||'')}</span></td>
              <td>${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                ? '<span class="status-badge status-bad">Suspendido</span>'
                : '<span class="status-badge status-ok">Activo</span>'}</td>
              <td>
                <button onclick="openOperatorFolderV555(${u.id})">Carpeta</button>
                ${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                  ? `<button class="ok" onclick="suspendUserV531(${u.id},0)">Reactivar</button>`
                  : `<button class="secondary" onclick="suspendUserV531(${u.id},1)">Suspender</button>`}
                <button class="danger" onclick="deleteUserV531(${u.id}, '${esc((u.first_name||'Operario')).replace(/'/g, "\\'")}')">Borrar</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5">Sin operarios.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const f=$('#userForm');
  if(f) f.onsubmit=async e=>{
    e.preventDefault();
    const payload={...Object.fromEntries(new FormData(e.target)), active:1};
    const created = await api('/api/users',{method:'POST',body:JSON.stringify(payload)});
    const file=$('#operatorPhotoNew').files[0];
    if(file && (created.id || created.user_id)){
      const dataUrl=await resizeImageV555(file);
      await api('/api/users/'+(created.id||created.user_id)+'/photo',{method:'POST',body:JSON.stringify({dataUrl})});
    }
    if(typeof v534Toast==='function') v534Toast('Operario creado correctamente');
    else alert('Operario creado correctamente');
    viewUsers();
  };
}


// ---------- V55.7 GOOGLE AUTO CONNECT FRONTEND ----------
let v557AutoTried = sessionStorage.getItem('v557_google_auto_tried') === '1';

async function v557GoogleStatus(){
  try { return await api('/api/google/status-v557'); }
  catch(e) { return {configured:false,connected:false,error:e.message,target_calendar_name:'MARFAN'}; }
}

// override calendar to auto connect if configured but disconnected
const __v553ViewCalendar = typeof viewCalendar === 'function' ? viewCalendar : null;
viewCalendar = async function(){
  const st = await v557GoogleStatus();

  if(st.configured && !st.connected && !v557AutoTried){
    sessionStorage.setItem('v557_google_auto_tried','1');
    v557AutoTried = true;
    $('#content').innerHTML = `
      <div class="card">
        <h3>Conectando automáticamente Google Calendar MARFAN…</h3>
        <p class="muted">Solo tendrás que aceptar permisos si Google todavía no tiene token guardado.</p>
        <p><span class="status-badge status-warn">Estado: conectando OAuth</span></p>
      </div>
    `;
    setTimeout(()=>{ window.location.href='/auth/google-auto'; },700);
    return;
  }

  if(__v553ViewCalendar) {
    await __v553ViewCalendar();
    setTimeout(()=>{
      const panel = document.querySelector('.v553-sync-info');
      if(panel){
        panel.innerHTML = st.connected
          ? `✅ Google MARFAN conectado automáticamente. Token persistente: ${st.token_file_exists ? 'OK' : 'pendiente'}`
          : `⚠️ Google MARFAN no conectado. Estado: ${st.configured ? 'OAuth pendiente' : 'faltan variables Railway'}`;
      }
    },100);
    return;
  }

  $('#content').innerHTML = '<div class="card"><h3>Calendario</h3><p>No se pudo cargar la vista calendario.</p></div>';
};


// ---------- V55.8 OPERARIOS REDESIGN PRO FRONTEND ----------
async function viewUsers(){
  const users = await api('/api/users');

  $('#content').innerHTML = `
    <div class="card">
      <div class="operator-toolbar-v558">
        <div>
          <h3>Operarios</h3>
          <p class="muted">Gestión de personal, documentos, EPIs, PRL, tallas y carpeta individual.</p>
        </div>
        <button onclick="openCreateOperatorV558()">+ Crear operario</button>
      </div>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Operario</th>
            <th>Contacto</th>
            <th>Perfil laboral</th>
            <th>EPIs / PRL</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${users.filter(u=>u.role!=='admin').map(u=>`
            <tr>
              <td>
                <div class="operator-card-v558">
                  ${operatorAvatarV555(u)}
                  <div>
                    <b>${operatorDisplayNameV555(u)}</b><br>
                    <span class="operator-small-v558">DNI: ${esc(u.dni||'—')}</span>
                  </div>
                </div>
              </td>
              <td>
                ${esc(u.phone||'—')}<br>
                <span class="muted">${esc(u.email||'')}</span>
              </td>
              <td>
                ${esc(u.services||u.role||'—')}<br>
                <span class="muted">${esc(u.vehicle_licenses||u.license_type||'')}</span>
              </td>
              <td>
                ${Number(u.epis_delivered)?'<span class="status-badge status-ok">EPIs</span>':'<span class="status-badge status-warn">Sin EPIs</span>'}
                ${Number(u.prl_completed)?'<span class="status-badge status-ok">PRL</span>':'<span class="status-badge status-warn">Sin PRL</span>'}
              </td>
              <td>
                ${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                  ? '<span class="status-badge status-bad">Suspendido</span>'
                  : '<span class="status-badge status-ok">Activo</span>'}
              </td>
              <td>
                <button onclick="openOperatorFolderV555(${u.id})">Carpeta</button>
                ${Number(u.active)===0 || String(u.availability||'').toLowerCase()==='suspendido'
                  ? `<button class="ok" onclick="suspendUserV531(${u.id},0)">Reactivar</button>`
                  : `<button class="secondary" onclick="suspendUserV531(${u.id},1)">Suspender</button>`}
                <button class="danger" onclick="deleteUserV531(${u.id}, '${esc((u.first_name||'Operario')).replace(/'/g, "\\'")}')">Borrar</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="6">Sin operarios.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function openCreateOperatorV558(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal operator-modal-v558">
        <div class="modal-head">
          <h2>Crear operario</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="operatorFormV558" class="operator-form-v558">

          <div class="operator-block-v558">
            <h4>Datos principales</h4>
            <div class="operator-grid-v56">
              <input class="field span-3" name="first_name" placeholder="Nombre" required>
              <input class="field span-4" name="last_name" placeholder="Apellidos" required>
              <input class="field span-2" name="nickname" placeholder="Apodo / mote">
              <input class="field span-3" name="dni" placeholder="DNI / NIE">

              <input class="field span-3" name="birth_date" type="date" title="Fecha de nacimiento">
              <input class="field span-3" name="phone" placeholder="Teléfono">
              <input class="field span-6" name="email" placeholder="Email">

              <input class="field span-9" name="full_address" placeholder="Dirección completa">
              <input class="field span-3" id="operatorPhotoV558" type="file" accept="image/*" title="Fotografía">
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>Datos bancarios</h4>
            <div class="operator-grid-v56">
              <input class="field span-4" name="bank_name" placeholder="Nombre del banco">
              <input class="field span-8" name="iban" placeholder="Número de cuenta / IBAN">
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>Perfil laboral</h4>
            <div class="operator-grid-v56">
              <select class="field span-3" name="role">
                <option value="operario">Operario</option>
                <option value="jefe">Jefe de equipo</option>
              </select>
              <input class="field span-4" name="services" placeholder="Cargo / servicios principales">
              <input class="field span-5" name="skills" placeholder="Skills / especialidades">
              <input class="field span-12" name="vehicle_licenses" placeholder="Carnets: coche, camión, carretilla, plataforma...">
              <input class="field span-6" name="vehicle" placeholder="Vehículo propio / matrícula">
              <select class="field span-3" name="availability">
                <option value="disponible">Disponible</option>
                <option value="parcial">Parcial</option>
                <option value="no_disponible">No disponible</option>
              </select>
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>Contacto de emergencia</h4>
            <div class="operator-grid-v56">
              <input class="field span-8" name="emergency_contact" placeholder="Contacto de emergencia">
              <input class="field span-4" name="emergency_phone" placeholder="Teléfono de emergencia">
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>Tallas</h4>
            <div class="operator-grid-v56">
              <input class="field span-4" name="shirt_size" placeholder="Talla camiseta">
              <input class="field span-4" name="pants_size" placeholder="Talla pantalón">
              <input class="field span-4" name="shoe_size" placeholder="Talla zapatos">
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>EPIs y Prevención de Riesgos Laborales</h4>
            <div class="operator-checks-v558">
              <label class="operator-check-v558">
                <input type="checkbox" name="epis_delivered" value="1">
                EPIs entregados
              </label>
              <label class="operator-check-v558">
                <input type="checkbox" name="prl_completed" value="1">
                Tiene riesgos laborales / PRL
              </label>
            </div>
            <br>
            <div class="operator-grid-v56">
              <select class="field span-3" name="doc_type">
                <option value="PRL">PRL / Riesgos laborales</option>
                <option value="EPIs">Entrega EPIs</option>
                <option value="DNI/NIE">DNI/NIE</option>
                <option value="Carretilla">Carretilla</option>
                <option value="Plataforma">Plataforma elevadora</option>
                <option value="Carnet">Carnet vehículo/camión</option>
                <option value="Otros">Otros</option>
              </select>
              <input class="field span-5" name="doc_title" placeholder="Título del documento">
              <input class="field span-2" name="doc_expiry_date" type="date" title="Fecha validez / caducidad">
              <input class="field span-12" id="operatorDocV558" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx">
            </div>
            <p class="muted">El documento se subirá automáticamente a la carpeta personal del operario.</p>
          </div>

          <div class="operator-block-v558">
            <h4>Costes internos</h4>
            <div class="operator-grid-v56">
              <input class="field span-6" name="internal_hour_cost" type="number" step="0.01" placeholder="Coste interno hora">
              <input class="field span-6" name="internal_night_cost" type="number" step="0.01" placeholder="Coste interno nocturno">
            </div>
          </div>

          <div class="operator-block-v558">
            <h4>Notas internas</h4>
            <textarea class="field span-12" name="notes" placeholder="Notas internas"></textarea>
          </div>

          <div class="operator-action-row-v558">
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
            <button>Guardar operario</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#operatorFormV558').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const payload = {
      first_name: fd.get('first_name') || '',
      last_name: fd.get('last_name') || '',
      nickname: fd.get('nickname') || '',
      dni: fd.get('dni') || '',
      birth_date: fd.get('birth_date') || '',
      phone: fd.get('phone') || '',
      email: fd.get('email') || '',
      full_address: fd.get('full_address') || '',
      address: fd.get('full_address') || '',
      bank_name: fd.get('bank_name') || '',
      iban: fd.get('iban') || '',
      role: fd.get('role') || 'operario',
      services: fd.get('services') || '',
      skills: fd.get('skills') || '',
      vehicle_licenses: fd.get('vehicle_licenses') || '',
      license_type: fd.get('vehicle_licenses') || '',
      vehicle: fd.get('vehicle') || '',
      availability: fd.get('availability') || 'disponible',
      emergency_contact: fd.get('emergency_contact') || '',
      emergency_phone: fd.get('emergency_phone') || '',
      shirt_size: fd.get('shirt_size') || '',
      pants_size: fd.get('pants_size') || '',
      shoe_size: fd.get('shoe_size') || '',
      epis_delivered: fd.get('epis_delivered') ? 1 : 0,
      prl_completed: fd.get('prl_completed') ? 1 : 0,
      internal_hour_cost: fd.get('internal_hour_cost') || 0,
      internal_night_cost: fd.get('internal_night_cost') || 0,
      notes: fd.get('notes') || '',
      active: 1
    };

    const created = await api('/api/users',{method:'POST',body:JSON.stringify(payload)});
    const userId = created.id || created.user_id || created.lastInsertRowid;

    const photo = $('#operatorPhotoV558').files[0];
    if(photo && userId){
      const dataUrl = await resizeImageV555(photo);
      await api('/api/users/'+userId+'/photo',{method:'POST',body:JSON.stringify({dataUrl})});
    }

    const doc = $('#operatorDocV558').files[0];
    if(doc && userId){
      const dataUrl = await fileToDataUrl(doc);
      await api('/api/users/'+userId+'/document-from-operator-form',{
        method:'POST',
        body:JSON.stringify({
          dataUrl,
          file_name:doc.name,
          doc_type:fd.get('doc_type') || 'PRL',
          title:fd.get('doc_title') || doc.name,
          expiry_date:fd.get('doc_expiry_date') || '',
          notes:'Subido desde creación de operario'
        })
      });
    }

    if(typeof v534Toast==='function') v534Toast('Operario creado correctamente');
    else alert('Operario creado correctamente');
    closeWizard();
    viewUsers();
  };
}


// ---------- V55.9 CALENDAR POPUP + EVENT MODAL V46 ----------
function v559OpenGooglePopup(){
  const w = 520, h = 720;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
  const popup = window.open('/auth/google-safe', 'googleCalendarAuth', `width=${w},height=${h},left=${left},top=${top}`);
  if(!popup){
    alert('El navegador ha bloqueado la ventana emergente. Permite popups para esta web.');
    return;
  }
}

window.addEventListener('message', (ev)=>{
  if(ev.data && ev.data.type === 'GOOGLE_CALENDAR_CONNECTED'){
    if(typeof v534Toast === 'function') v534Toast('Google Calendar MARFAN conectado');
    setTimeout(()=>viewCalendar(),500);
  }
});

function openCreateEventV559(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-modal-v559">
        <div class="modal-head">
          <h2>Crear evento</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="eventFormV559" class="event-form-v559">

          <div class="event-block-v559">
            <h4>1. Datos principales</h4>
            <div class="grid">
              <input class="field" name="name" placeholder="Nombre del evento" required>
              <input class="field" name="client" placeholder="Cliente">
              <input class="field" name="contact_name" placeholder="Responsable / contacto">
              <input class="field" name="contact_phone" placeholder="Teléfono contacto">
              <input class="field" name="contact_email" placeholder="Email contacto">
              <select class="field" name="status">
                <option value="programado">Programado</option>
                <option value="confirmado">Confirmado</option>
                <option value="pendiente">Pendiente</option>
                <option value="realizado">Realizado</option>
              </select>
            </div>
          </div>

          <div class="event-block-v559">
            <h4>2. Fecha, horario y ubicación</h4>
            <div class="grid">
              <input class="field" name="event_date" type="date" value="${v55DateKey ? v55DateKey(v55CalDate || new Date()) : new Date().toISOString().slice(0,10)}" required>
              <input class="field" name="start_time" type="time" value="09:00">
              <input class="field" name="end_time" type="time" value="10:00">
              <input class="field" name="location" placeholder="Ubicación / recinto">
              <input class="field" name="address" placeholder="Dirección completa">
              <input class="field" name="load_in_time" type="time" title="Hora carga / entrada">
              <input class="field" name="load_out_time" type="time" title="Hora salida / desmontaje">
            </div>
          </div>

          <div class="event-block-v559">
            <h4>3. Crew y operación</h4>
            <div class="grid">
              <input class="field" name="required_workers" type="number" placeholder="Operarios necesarios">
              <input class="field" name="required_team_leads" type="number" placeholder="Jefes de equipo" value="1">
              <select class="field" name="operational_status">
                <option value="borrador">Borrador</option>
                <option value="crew_parcial">Crew parcial</option>
                <option value="crew_completo">Crew completo</option>
                <option value="produccion">Producción</option>
              </select>
              <input class="field" name="service_type" placeholder="Tipo de servicio">
              <input class="field" name="material_notes" placeholder="Material / notas técnicas">
              <input class="field" name="access_notes" placeholder="Accesos / carga y descarga">
            </div>
          </div>

          <div class="event-block-v559">
            <h4>4. Tarifas y facturación</h4>
            <div class="grid">
              <input class="field" name="hourly_rate" type="number" step="0.01" placeholder="Tarifa hora">
              <input class="field" name="night_rate" type="number" step="0.01" placeholder="Tarifa nocturna">
              <input class="field" name="diet_price" type="number" step="0.01" placeholder="Dieta">
              <input class="field" name="km_amount" type="number" step="0.01" placeholder="Kilometraje / transporte">
              <select class="field" name="payment_status">
                <option value="pendiente">Pendiente</option>
                <option value="facturado">Facturado</option>
                <option value="cobrado">Cobrado</option>
              </select>
            </div>
          </div>

          <div class="event-block-v559">
            <h4>5. Notas internas</h4>
            <textarea class="field" name="notes" placeholder="Notas internas del evento"></textarea>
          </div>

          <div class="event-actions-v559">
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
            <button>Guardar evento</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#eventFormV559').onsubmit = async e => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target));
    const created = await api('/api/events',{method:'POST',body:JSON.stringify(payload)});
    if(typeof v534Toast === 'function') v534Toast('Evento creado correctamente');
    const googleStatus = await api('/api/google/status-v557').catch(()=>({connected:false}));
    if(googleStatus.connected){
      try { await v55ExportOne(created.id || created.event_id); } catch(err){}
    }
    closeWizard();
    viewCalendar();
  };
}

// Override calendar again: no external full page OAuth, popup only + create event modal.
const __v559BaseCalendar = typeof viewCalendar === 'function' ? viewCalendar : null;
viewCalendar = async function(){
  const localEvents = await api('/api/events');
  const googleStatus = await api('/api/google/status-v557').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));
  const googleData = await api('/api/google/marfan-events').catch(()=>({connected:false,events:[]}));
  const googleEvents = googleData.events || [];
  const events = [...localEvents.map(e=>({...e,source:'local'})), ...googleEvents];

  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Vista tipo Google Calendar integrada. La app principal no se cierra.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google MARFAN conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>`}
          <button class="secondary" onclick="v55ImportGoogle()">Importar MARFAN</button>
          <button class="secondary" onclick="v55ExportAll()">Exportar a MARFAN</button>
        </div>
      </div>
      <div class="google-popup-note-v559">
        ${googleStatus.connected
          ? `Sincronización activa con calendario MARFAN.`
          : `Pulsa “Conectar Google”: se abrirá una ventana emergente y volverás automáticamente a esta app.`}
      </div>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
};


// ---------- V56.1 GOOGLE CALENDAR SYNC FIX FRONTEND ----------
async function v561GetGoogleEvents(){
  const data = await api('/api/google/marfan-events-v561').catch(e=>({ok:false,connected:false,events:[],error:e.message}));
  return data;
}

async function v561GetCalendarsDebug(){
  return await api('/api/google/calendars-v561').catch(e=>({ok:false,error:e.message,calendars:[]}));
}

async function viewCalendar(){
  const localEvents = await api('/api/events');
  const googleStatus = await api('/api/google/status-v557').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));
  const googleData = await v561GetGoogleEvents();

  const googleEvents = googleData.events || [];
  const events = [
    ...localEvents.map(e=>({...e,source:'local'})),
    ...googleEvents
  ];

  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Vista tipo Google Calendar integrada. Deben aparecer eventos locales y los eventos reales del calendario MARFAN.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>`}
          <button class="secondary" onclick="viewCalendar()">Actualizar</button>
          <button class="secondary" onclick="v55ImportGoogle()">Importar MARFAN</button>
          <button class="secondary" onclick="v55ExportAll()">Exportar a MARFAN</button>
        </div>
      </div>

      ${googleData.ok
        ? `<div class="google-sync-debug-v561 ok">Google MARFAN OK · Calendario: ${esc((googleData.calendar||{}).summary||'MARFAN')} · Eventos Google leídos: ${Number(googleData.count||0)} · Match: ${esc(googleData.match||'')}</div>`
        : `<div class="google-sync-debug-v561 bad">Google conectado, pero no se pueden leer eventos: ${esc(googleData.error||'Error desconocido')}</div>`}
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
}


// ---------- V56.2 INFORMES PDF PRO A4 FRONTEND ----------
async function viewReportsV562(){
  const events = await api('/api/events');
  const users = await api('/api/users');

  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Informes PDF Pro</h3>
          <p class="muted">Informe interno A4 vertical de costes reales para la empresa por empleado.</p>
        </div>
      </div>
    </div>

    <div class="card report-panel-v562">
      <div class="report-tabs-v562">
        <span>1. Seleccionar evento</span>
        <span>2. Seleccionar personal</span>
        <span>3. Costes empresa</span>
        <span>4. Generar PDF A4</span>
      </div>

      <form id="reportFormV562" class="report-selector-v562">
        <h4>Evento</h4>
        <select class="field" name="event_id" required>
          <option value="">Selecciona evento</option>
          ${events.map(e=>`<option value="${e.id}">${esc(e.event_date||'')} · ${esc(e.name||'Evento')} · ${esc(e.client||'')}</option>`).join('')}
        </select>

        <br><br>
        <h4>Personal</h4>
        <select class="field" name="user_ids" multiple size="7">
          <option value="0">TODOS LOS ASIGNADOS AL EVENTO</option>
          ${users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${esc((u.first_name||'')+' '+(u.last_name||''))} ${u.nickname ? '('+esc(u.nickname)+')' : ''}</option>`).join('')}
        </select>
        <p class="muted">Mantén pulsado CTRL/CMD para seleccionar varios. Si eliges “TODOS”, calcula todos los asignados al evento.</p>

        <br>
        <h4>Costes empresa</h4>
        <div class="operator-grid-v56">
          <input class="field span-3" name="default_hour_cost" type="number" step="0.01" value="0" placeholder="Coste hora defecto">
          <input class="field span-3" name="social_security_percent" type="number" step="0.01" value="32" placeholder="% Seguridad Social">
          <input class="field span-3" name="gestoria_cost" type="number" step="0.01" value="0" placeholder="Gastos gestoría">
          <input class="field span-3" name="transport_cost" type="number" step="0.01" value="0" placeholder="Transporte / taxi">
          <input class="field span-3" name="diet_cost" type="number" step="0.01" value="0" placeholder="Dietas empresa">
          <input class="field span-3" name="extra_cost" type="number" step="0.01" value="0" placeholder="Extras">
        </div>

        <br>
        <button>Generar informe</button>
      </form>
    </div>

    <div id="reportResultV562"></div>
  `;

  $('#reportFormV562').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const selected = [...e.target.querySelector('[name="user_ids"]').selectedOptions].map(o=>Number(o.value));
    const payload = {
      event_id:Number(fd.get('event_id')),
      user_ids:selected,
      default_hour_cost:Number(fd.get('default_hour_cost')||0),
      social_security_percent:Number(fd.get('social_security_percent')||32),
      gestoria_cost:Number(fd.get('gestoria_cost')||0),
      transport_cost:Number(fd.get('transport_cost')||0),
      diet_cost:Number(fd.get('diet_cost')||0),
      extra_cost:Number(fd.get('extra_cost')||0)
    };
    const report = await api('/api/reports/employee-costs',{method:'POST',body:JSON.stringify(payload)});
    renderReportV562(report);
  };
}

function euroV562(n){ return Number(n||0).toFixed(2)+' €'; }

function renderReportV562(report){
  const e = report.event;
  const rows = report.rows || [];
  const t = report.totals || {};

  $('#reportResultV562').innerHTML = `
    <div class="card no-print">
      <h3>Informe generado</h3>
      <div class="actions">
        <button onclick="window.print()">Descargar / Imprimir PDF A4</button>
      </div>
    </div>

    <div id="reportPrintAreaV562" class="report-a4-v562">
      <div class="report-a4-head-v562">
        <div>
          <div class="report-a4-title-v562">MARFAN CREW</div>
          <div>Informe interno de costes de personal</div>
        </div>
        <div>
          <b>A4 Vertical</b><br>
          ${new Date(report.generated_at).toLocaleString('es-ES')}
        </div>
      </div>

      <h1>Costes empresa por empleado</h1>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <tr><td><b>Evento</b></td><td>${esc(e.name||'')}</td></tr>
        <tr><td><b>Fecha</b></td><td>${esc(e.event_date||'')}</td></tr>
        <tr><td><b>Horario</b></td><td>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</td></tr>
        <tr><td><b>Cliente</b></td><td>${esc(e.client||'')}</td></tr>
        <tr><td><b>Ubicación</b></td><td>${esc(e.location||'')}</td></tr>
      </table>

      <div class="report-kpis-v562">
        <div class="report-kpi-v562"><span>Horas</span><b>${Number(t.hours||0).toFixed(2)}</b></div>
        <div class="report-kpi-v562"><span>Coste base</span><b>${euroV562(t.base_cost)}</b></div>
        <div class="report-kpi-v562"><span>Seguridad Social</span><b>${euroV562(t.social_security_cost)}</b></div>
        <div class="report-kpi-v562"><span>Total empresa</span><b>${euroV562(t.total_cost)}</b></div>
      </div>

      <h2>Desglose por empleado</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th style="border-bottom:1px solid #111;text-align:left;padding:6px">Empleado</th>
            <th style="border-bottom:1px solid #111;text-align:left;padding:6px">Rol</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Horas</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">€/h</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Base</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">SS</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Gestoría</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Transp.</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Dietas</th>
            <th style="border-bottom:1px solid #111;text-align:right;padding:6px">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td style="border-bottom:1px solid #ddd;padding:6px"><b>${esc(r.name)}</b>${r.nickname?'<br><small>'+esc(r.nickname)+'</small>':''}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px">${esc(r.role||'')}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${Number(r.hours||0).toFixed(2)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.hour_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.base_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.social_security_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.gestoria_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.transport_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${euroV562(r.diet_cost)}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px;text-align:right"><b>${euroV562(r.total_cost)}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h2>Totales</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td>Coste base empleados</td><td style="text-align:right">${euroV562(t.base_cost)}</td></tr>
        <tr><td>Seguridad Social</td><td style="text-align:right">${euroV562(t.social_security_cost)}</td></tr>
        <tr><td>Gestoría</td><td style="text-align:right">${euroV562(t.gestoria_cost)}</td></tr>
        <tr><td>Transporte / taxi</td><td style="text-align:right">${euroV562(t.transport_cost)}</td></tr>
        <tr><td>Dietas</td><td style="text-align:right">${euroV562(t.diet_cost)}</td></tr>
        <tr><td>Extras</td><td style="text-align:right">${euroV562(t.extra_cost)}</td></tr>
        <tr><td style="border-top:2px solid #111;padding-top:8px"><b>TOTAL COSTE EMPRESA</b></td><td style="border-top:2px solid #111;padding-top:8px;text-align:right"><b>${euroV562(t.total_cost)}</b></td></tr>
      </table>

      <p style="font-size:11px;color:#666;margin-top:24px">
        Documento interno generado por Marfan Crew Hours. Informe orientado a control interno de costes empresa.
      </p>
    </div>
  `;
}


// ---------- V56.3 CALENDAR FORCE SYNC + EVENT V46 FULL FRONTEND ----------
async function forceSyncGoogleMarfanV563(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal sync-modal-v563">
        <div class="modal-head">
          <h2>Sincronizando Google Calendar MARFAN</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="sync-box-v563">
          <b>Procesando…</b><br>
          Leyendo eventos del calendario MARFAN y guardándolos en la app.
        </div>
      </div>
    </div>
  `;

  try{
    const r = await api('/api/google/force-sync-marfan-v563',{method:'POST'});
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Sincronización terminada ✅</h2>
            <button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button>
          </div>
          <div class="sync-box-v563 sync-ok-v563">
            <b>Calendario:</b> ${esc((r.calendar||{}).summary||'MARFAN')}<br>
            <b>Eventos leídos:</b> ${r.google_events_read}<br>
            <b>Creados en la app:</b> ${r.created}<br>
            <b>Actualizados:</b> ${r.updated}<br>
            <b>Errores:</b> ${r.errors}
          </div>
          <button onclick="closeWizard();viewCalendar()">Ver calendario actualizado</button>
        </div>
      </div>
    `;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Error de sincronización</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-box-v563 sync-bad-v563">
            ${esc(e.message)}
          </div>
        </div>
      </div>
    `;
  }
}

function openCreateEventV559(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-modal-v563">
        <div class="modal-head">
          <h2>Crear evento</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="eventFormV563" class="event-form-v563">

          <div class="event-block-v563">
            <h4>1. Datos principales</h4>
            <div class="event-grid-v563">
              <input class="field span-6" name="name" placeholder="Nombre del evento" required>
              <input class="field span-3" name="event_code" placeholder="Código / referencia">
              <select class="field span-3" name="status">
                <option value="programado">Programado</option>
                <option value="confirmado">Confirmado</option>
                <option value="pendiente">Pendiente</option>
                <option value="realizado">Realizado</option>
                <option value="cancelado">Cancelado</option>
              </select>
              <input class="field span-4" name="client" placeholder="Cliente">
              <input class="field span-4" name="legal_name" placeholder="Razón social">
              <input class="field span-4" name="cif" placeholder="CIF/NIF">
            </div>
          </div>

          <div class="event-block-v563">
            <h4>2. Contacto cliente / responsable</h4>
            <div class="event-grid-v563">
              <input class="field span-4" name="contact_name" placeholder="Responsable">
              <input class="field span-3" name="contact_phone" placeholder="Teléfono">
              <input class="field span-5" name="contact_email" placeholder="Email">
              <input class="field span-12" name="client_notes" placeholder="Notas del cliente">
            </div>
          </div>

          <div class="event-block-v563">
            <h4>3. Fecha, horario y localización</h4>
            <div class="event-grid-v563">
              <input class="field span-3" name="event_date" type="date" value="${v55DateKey ? v55DateKey(v55CalDate || new Date()) : new Date().toISOString().slice(0,10)}" required>
              <input class="field span-2" name="start_time" type="time" value="09:00">
              <input class="field span-2" name="end_time" type="time" value="10:00">
              <input class="field span-2" name="load_in_time" type="time" title="Hora entrada/carga">
              <input class="field span-3" name="load_out_time" type="time" title="Hora salida/desmontaje">
              <input class="field span-5" name="location" placeholder="Recinto / ubicación">
              <input class="field span-7" name="address" placeholder="Dirección completa">
              <input class="field span-6" name="access_notes" placeholder="Acceso carga/descarga">
              <input class="field span-6" name="parking_notes" placeholder="Parking / vehículos">
            </div>
          </div>

          <div class="event-block-v563">
            <h4>4. Operación y personal</h4>
            <div class="event-grid-v563">
              <input class="field span-3" name="required_workers" type="number" placeholder="Operarios necesarios">
              <input class="field span-3" name="required_team_leads" type="number" value="1" placeholder="Jefes equipo">
              <select class="field span-3" name="operational_status">
                <option value="borrador">Borrador</option>
                <option value="crew_parcial">Crew parcial</option>
                <option value="crew_completo">Crew completo</option>
                <option value="produccion">Producción</option>
                <option value="finalizado">Finalizado</option>
              </select>
              <input class="field span-3" name="service_type" placeholder="Tipo servicio">
              <input class="field span-6" name="crew_notes" placeholder="Notas para crew">
              <input class="field span-6" name="team_lead_notes" placeholder="Notas jefe de equipo">
            </div>
          </div>

          <div class="event-block-v563">
            <h4>5. Producción técnica</h4>
            <div class="event-grid-v563">
              <input class="field span-6" name="material_notes" placeholder="Material / técnica">
              <input class="field span-6" name="provider_notes" placeholder="Proveedores / subcontratas">
              <input class="field span-4" name="sound_notes" placeholder="Sonido">
              <input class="field span-4" name="lighting_notes" placeholder="Iluminación">
              <input class="field span-4" name="video_notes" placeholder="Vídeo / LED">
              <input class="field span-12" name="production_notes" placeholder="Notas producción">
            </div>
          </div>

          <div class="event-block-v563">
            <h4>6. Tarifas y facturación</h4>
            <div class="event-grid-v563">
              <input class="field span-3" name="hourly_rate" type="number" step="0.01" placeholder="Tarifa hora">
              <input class="field span-3" name="night_rate" type="number" step="0.01" placeholder="Tarifa nocturna">
              <input class="field span-3" name="diet_price" type="number" step="0.01" placeholder="Dieta">
              <input class="field span-3" name="km_amount" type="number" step="0.01" placeholder="Kilometraje/transporte">
              <input class="field span-3" name="estimated_external_cost" type="number" step="0.01" placeholder="Costes externos">
              <input class="field span-3" name="estimated_transport_cost" type="number" step="0.01" placeholder="Coste transporte">
              <input class="field span-3" name="estimated_other_cost" type="number" step="0.01" placeholder="Otros costes">
              <select class="field span-3" name="payment_status">
                <option value="pendiente">Pendiente</option>
                <option value="facturado">Facturado</option>
                <option value="cobrado">Cobrado</option>
                <option value="impagado">Impagado</option>
              </select>
            </div>
          </div>

          <div class="event-block-v563">
            <h4>7. Notas internas</h4>
            <textarea class="field span-12" name="notes" placeholder="Notas internas del evento"></textarea>
          </div>

          <div class="event-actions-v559">
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
            <button>Guardar evento</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#eventFormV563').onsubmit = async e => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target));
    const created = await api('/api/events',{method:'POST',body:JSON.stringify(payload)});
    if(typeof v534Toast === 'function') v534Toast('Evento creado correctamente');
    try { await api('/api/google/export-event-v563/'+(created.id || created.event_id),{method:'POST'}); } catch(err){}
    closeWizard();
    viewCalendar();
  };
}

async function viewCalendar(){
  const localEvents = await api('/api/events');
  const googleStatus = await api('/api/google/status-v557').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));
  const googleData = await v561GetGoogleEvents().catch(()=>({ok:false,events:[],error:'No se pudieron leer eventos Google'}));
  const googleEvents = googleData.events || [];
  const events = [...localEvents.map(e=>({...e,source:'local'})), ...googleEvents];

  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Si los eventos no aparecen, pulsa “Forzar sincronización” y se guardarán en la app.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>`}
          <button onclick="forceSyncGoogleMarfanV563()">Forzar sincronización</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      ${googleData.ok
        ? `<div class="google-sync-debug-v561 ok">Calendario: ${esc((googleData.calendar||{}).summary||'MARFAN')} · Eventos Google leídos: ${Number(googleData.count||0)}</div>`
        : `<div class="google-sync-debug-v561 bad">Google conectado pero no lee eventos: ${esc(googleData.error||'Error desconocido')}</div>`}
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
}


// ---------- V56.4 INFORMES PDF MULTI-TIPO FRONTEND ----------
async function viewReportsV562(){
  const events = await api('/api/events');
  const users = await api('/api/users');

  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Informes PDF Pro</h3>
          <p class="muted">Selecciona el tipo de informe y genera PDF A4 vertical con el mismo formato profesional.</p>
        </div>
      </div>
    </div>

    <div class="card report-panel-v562">
      <div class="report-tabs-v562">
        <span>1. Tipo de informe</span>
        <span>2. Evento / Personal</span>
        <span>3. Parámetros</span>
        <span>4. PDF A4 vertical</span>
      </div>

      <form id="reportFormV562" class="report-selector-v562">
        <h4>Tipo de informe</h4>
        <select class="field" name="report_type" id="reportTypeV564" onchange="toggleReportFieldsV564()">
          <option value="employee_costs">Costes empresa por empleado</option>
          <option value="event_summary">Resumen general del evento</option>
          <option value="staff_hours">Horas de personal por evento</option>
          <option value="delivery_notes">Albaranes del evento</option>
          <option value="documents">Documentación del personal</option>
        </select>

        <br><br>
        <div id="eventSelectBoxV564">
          <h4>Evento</h4>
          <select class="field" name="event_id">
            <option value="">Selecciona evento</option>
            ${events.map(e=>`<option value="${e.id}">${esc(e.event_date||'')} · ${esc(e.name||'Evento')} · ${esc(e.client||'')}</option>`).join('')}
          </select>
        </div>

        <br>
        <h4>Personal</h4>
        <select class="field" name="user_ids" multiple size="7">
          <option value="0">TODOS LOS ASIGNADOS / TODOS</option>
          ${users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${esc((u.first_name||'')+' '+(u.last_name||''))} ${u.nickname ? '('+esc(u.nickname)+')' : ''}</option>`).join('')}
        </select>

        <div id="costParamsV564">
          <br>
          <h4>Costes empresa</h4>
          <div class="operator-grid-v56">
            <input class="field span-3" name="default_hour_cost" type="number" step="0.01" value="0" placeholder="Coste hora defecto">
            <input class="field span-3" name="social_security_percent" type="number" step="0.01" value="32" placeholder="% Seguridad Social">
            <input class="field span-3" name="gestoria_cost" type="number" step="0.01" value="0" placeholder="Gastos gestoría">
            <input class="field span-3" name="transport_cost" type="number" step="0.01" value="0" placeholder="Transporte / taxi">
            <input class="field span-3" name="diet_cost" type="number" step="0.01" value="0" placeholder="Dietas empresa">
            <input class="field span-3" name="extra_cost" type="number" step="0.01" value="0" placeholder="Extras">
          </div>
        </div>

        <br>
        <button>Generar informe</button>
      </form>
    </div>

    <div id="reportResultV562"></div>
  `;

  toggleReportFieldsV564();

  $('#reportFormV562').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const type = fd.get('report_type');
    const selected = [...e.target.querySelector('[name="user_ids"]').selectedOptions].map(o=>Number(o.value)).filter(Boolean);
    const payload = {
      report_type:type,
      event_id:Number(fd.get('event_id')||0),
      user_ids:selected,
      default_hour_cost:Number(fd.get('default_hour_cost')||0),
      social_security_percent:Number(fd.get('social_security_percent')||32),
      gestoria_cost:Number(fd.get('gestoria_cost')||0),
      transport_cost:Number(fd.get('transport_cost')||0),
      diet_cost:Number(fd.get('diet_cost')||0),
      extra_cost:Number(fd.get('extra_cost')||0)
    };

    if(type === 'employee_costs'){
      const report = await api('/api/reports/employee-costs',{method:'POST',body:JSON.stringify(payload)});
      renderReportV562(report);
    }else{
      const report = await api('/api/reports/multi',{method:'POST',body:JSON.stringify(payload)});
      renderReportMultiV564(report);
    }
  };
}

function toggleReportFieldsV564(){
  const type = $('#reportTypeV564') ? $('#reportTypeV564').value : 'employee_costs';
  const cost = $('#costParamsV564');
  const eventBox = $('#eventSelectBoxV564');
  if(cost) cost.style.display = type === 'employee_costs' ? 'block' : 'none';
  if(eventBox) eventBox.style.display = type === 'documents' ? 'none' : 'block';
}

function renderReportMultiV564(report){
  if(report.type === 'event_summary') return renderEventSummaryV564(report);
  if(report.type === 'staff_hours') return renderStaffHoursV564(report);
  if(report.type === 'delivery_notes') return renderDeliveryNotesV564(report);
  if(report.type === 'documents') return renderDocumentsReportV564(report);
}

function reportShellV564(title, subtitle, body){
  $('#reportResultV562').innerHTML = `
    <div class="card no-print">
      <h3>Informe generado</h3>
      <div class="actions"><button onclick="window.print()">Descargar / Imprimir PDF A4</button></div>
    </div>
    <div id="reportPrintAreaV562" class="report-a4-v562">
      <div class="report-a4-head-v562">
        <div>
          <div class="report-a4-title-v562">MARFAN CREW</div>
          <div>${esc(subtitle)}</div>
        </div>
        <div><b>A4 Vertical</b><br>${new Date().toLocaleString('es-ES')}</div>
      </div>
      <h1>${esc(title)}</h1>
      ${body}
      <p style="font-size:11px;color:#666;margin-top:24px">Documento generado por Marfan Crew Hours.</p>
    </div>
  `;
}

function renderEventSummaryV564(r){
  const e = r.event;
  const rows = r.assignments || [];
  reportShellV564('Resumen general del evento','Informe operativo',`
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td><b>Evento</b></td><td>${esc(e.name||'')}</td></tr>
      <tr><td><b>Fecha</b></td><td>${esc(e.event_date||'')}</td></tr>
      <tr><td><b>Horario</b></td><td>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</td></tr>
      <tr><td><b>Cliente</b></td><td>${esc(e.client||'')}</td></tr>
      <tr><td><b>Ubicación</b></td><td>${esc(e.location||'')}</td></tr>
      <tr><td><b>Estado</b></td><td>${esc(e.status||'')}</td></tr>
    </table>
    <h2>Personal asignado</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Operario</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Rol</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Teléfono</th></tr></thead>
      <tbody>${rows.map(a=>`<tr><td style="border-bottom:1px solid #ddd;padding:6px">${esc((a.first_name||'')+' '+(a.last_name||''))}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.service_role||'')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.phone||'')}</td></tr>`).join('')}</tbody>
    </table>
  `);
}

function renderStaffHoursV564(r){
  const e = r.event;
  const rows = r.rows || [];
  const total = rows.reduce((a,x)=>a+Number(x.hours||0),0);
  reportShellV564('Horas de personal por evento','Informe de horas',`
    <p><b>${esc(e.name||'')}</b> · ${esc(e.event_date||'')}</p>
    <div class="report-kpis-v562"><div class="report-kpi-v562"><span>Total horas</span><b>${total.toFixed(2)}</b></div><div class="report-kpi-v562"><span>Operarios</span><b>${rows.length}</b></div></div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Empleado</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Inicio</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Fin</th><th style="text-align:right;border-bottom:1px solid #111;padding:6px">Horas</th></tr></thead>
      <tbody>${rows.map(x=>`<tr><td style="border-bottom:1px solid #ddd;padding:6px">${esc((x.first_name||'')+' '+(x.last_name||''))}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(x.start||'')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(x.end||'')}</td><td style="border-bottom:1px solid #ddd;padding:6px;text-align:right">${Number(x.hours||0).toFixed(2)}</td></tr>`).join('')}</tbody>
    </table>
  `);
}

function renderDeliveryNotesV564(r){
  const e = r.event;
  const notes = r.notes || [];
  reportShellV564('Albaranes del evento','Informe de albaranes',`
    <p><b>${esc(e.name||'')}</b> · ${esc(e.event_date||'')}</p>
    ${notes.map(n=>`<div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin:8px 0"><b>${esc(n.title||'Albarán')}</b><br>Creado: ${esc(n.created_at||'')}<br>Firmado: ${Number(n.signed)?'Sí':'No'}</div>`).join('') || '<p>No hay albaranes para este evento.</p>'}
  `);
}

function renderDocumentsReportV564(r){
  const rows = r.rows || [];
  reportShellV564('Documentación del personal','Informe documental',`
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Operario</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Documento</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Caducidad</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Estado</th></tr></thead>
      <tbody>${rows.map(d=>`<tr><td style="border-bottom:1px solid #ddd;padding:6px">${esc((d.first_name||'')+' '+(d.last_name||''))}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(d.doc_type||'')} · ${esc(d.title||'')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(d.expiry_date||'—')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(d.computed_status||'')}</td></tr>`).join('')}</tbody>
    </table>
  `);
}


// ---------- V56.5 CALENDAR SYNC HARD FIX FRONTEND ----------
async function forceSyncGoogleV565(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal sync-modal-v563">
        <div class="modal-head">
          <h2>Forzar sincronización Google MARFAN</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="sync-hard-v565">
          <b>1/2 Diagnosticando conexión…</b><br>
          Comprobando token, calendario MARFAN y permisos.
        </div>
      </div>
    </div>
  `;

  try{
    const diag = await api('/api/google/sync-diagnose-v565');
    if(!diag.ok){
      $('#modalRoot').innerHTML = `
        <div class="modal-back">
          <div class="modal sync-modal-v563">
            <div class="modal-head">
              <h2>Error de diagnóstico</h2>
              <button class="secondary" onclick="closeWizard()">Cerrar</button>
            </div>
            <div class="sync-hard-v565 bad">
              <b>No se puede sincronizar.</b><br>
              ${esc(diag.error || 'Error desconocido')}
              <pre>${esc(JSON.stringify(diag,null,2))}</pre>
            </div>
          </div>
        </div>
      `;
      return;
    }

    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Sincronizando Google MARFAN</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-hard-v565 ok">
            <b>Calendario encontrado:</b> ${esc((diag.calendar||{}).summary||'MARFAN')}<br>
            <b>Permiso:</b> ${esc((diag.calendar||{}).accessRole||'')}<br>
            <b>2/2 Leyendo y guardando eventos…</b>
          </div>
        </div>
      </div>
    `;

    const r = await api('/api/google/force-sync-v565',{method:'POST'});

    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Sincronización completada ✅</h2>
            <button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button>
          </div>
          <div class="sync-hard-v565 ok">
            <b>Calendario:</b> ${esc((r.calendar||{}).summary||'MARFAN')}<br>
            <b>Eventos leídos:</b> ${r.read}<br>
            <b>Creados:</b> ${r.created}<br>
            <b>Actualizados:</b> ${r.updated}<br>
            <b>Errores:</b> ${r.errors}
          </div>
          ${r.errors ? `<div class="sync-hard-v565 bad"><pre>${esc(JSON.stringify(r.results.filter(x=>x.action==='error'),null,2))}</pre></div>` : ''}
          <button onclick="closeWizard();viewCalendar()">Ver calendario actualizado</button>
        </div>
      </div>
    `;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Error sincronizando</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-hard-v565 bad">
            ${esc(e.message)}
          </div>
        </div>
      </div>
    `;
  }
}

async function viewCalendar(){
  const localEvents = await api('/api/events');
  const googleStatus = await api('/api/google/status-v557').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));

  const events = localEvents.map(e=>({...e,source:e.operational_status==='google_marfan'?'google':'local'}));
  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Pulsa “Forzar sincronización” para traer los eventos reales de Google MARFAN a la app.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>`}
          <button onclick="forceSyncGoogleV565()">Forzar sincronización</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">
        Vista local actual: ${events.length} eventos cargados. Google se sincroniza con botón para evitar fallos silenciosos.
      </div>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
}


// ---------- V56.6 V46 EVENT MODAL + TARIFAS ROLES PRO FRONTEND ----------
let v566RatesCache = [];

async function loadRatesV566(){
  v566RatesCache = await api('/api/rates-pro').catch(()=>[]);
  return v566RatesCache;
}

function rateOptionsV566(){
  return v566RatesCache.map(r=>`<option value="${r.id}" data-day="${Number(r.hourly_rate||0)}" data-night="${Number(r.night_rate||0)}" data-diet="${Number(r.diet||0)}" data-role="${esc(r.role||r.name||'')}">${esc(r.role||r.name||'')}</option>`).join('');
}

function calcRoleLineV566(row){
  const sel = row.querySelector('[name="rate_id"]');
  const opt = sel.options[sel.selectedIndex];
  const type = row.querySelector('[name="rate_type"]').value;
  const qty = Number(row.querySelector('[name="quantity"]').value||1);
  const hours = Number(row.querySelector('[name="hours"]').value||4);
  const price = type === 'N' ? Number(opt.dataset.night||0) : Number(opt.dataset.day||0);
  const diet = Number(opt.dataset.diet||0);
  row.querySelector('[name="unit_price"]').value = price.toFixed(2);
  row.querySelector('[name="diet"]').value = diet.toFixed(2);
  row.querySelector('.line-total-v566').innerHTML = ((qty*hours*price)+(qty*diet)).toFixed(2)+' €';
}

function addRoleLineV566(){
  const box = $('#roleLinesV566');
  const div = document.createElement('div');
  div.className = 'role-line-v566';
  div.innerHTML = `
    <select class="field" name="rate_id" onchange="calcRoleLineV566(this.closest('.role-line-v566'))">${rateOptionsV566()}</select>
    <input class="field" name="quantity" type="number" value="1" min="1" onchange="calcRoleLineV566(this.closest('.role-line-v566'))" placeholder="Ud.">
    <input class="field" name="hours" type="number" value="4" step="0.25" min="4" onchange="calcRoleLineV566(this.closest('.role-line-v566'))" placeholder="Horas">
    <select class="field" name="rate_type" onchange="calcRoleLineV566(this.closest('.role-line-v566'))"><option value="D">D</option><option value="N">N</option></select>
    <input class="field" name="unit_price" readonly placeholder="€/h">
    <input class="field" name="diet" readonly placeholder="Dieta">
    <div><b class="line-total-v566">0 €</b><br><button type="button" class="danger" onclick="this.closest('.role-line-v566').remove()">Quitar</button></div>
  `;
  box.appendChild(div);
  calcRoleLineV566(div);
}

async function openCreateEventV559(){
  await loadRatesV566();

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal v46-event-modal-v566">
        <div class="modal-head">
          <h2>Crear evento</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="eventFormV566" class="v46-event-form-v566">

          <div class="v46-event-block-v566">
            <h4>1. Datos del evento</h4>
            <div class="v46-grid-v566">
              <input class="field span-6" name="name" placeholder="Nombre del evento" required>
              <input class="field span-3" name="event_code" placeholder="Referencia">
              <select class="field span-3" name="status"><option value="programado">Programado</option><option value="confirmado">Confirmado</option><option value="pendiente">Pendiente</option><option value="realizado">Realizado</option></select>
              <input class="field span-4" name="client" placeholder="Cliente">
              <input class="field span-4" name="legal_name" placeholder="Razón social">
              <input class="field span-4" name="cif" placeholder="CIF/NIF">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>2. Responsable y contacto</h4>
            <div class="v46-grid-v566">
              <input class="field span-4" name="contact_name" placeholder="Responsable del evento">
              <input class="field span-3" name="contact_phone" placeholder="Teléfono">
              <input class="field span-5" name="contact_email" placeholder="Email">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>3. Fecha, horarios y ubicación</h4>
            <div class="v46-grid-v566">
              <input class="field span-3" name="event_date" type="date" value="${v55DateKey ? v55DateKey(v55CalDate || new Date()) : new Date().toISOString().slice(0,10)}" required>
              <input class="field span-2" name="start_time" type="time" value="09:00">
              <input class="field span-2" name="end_time" type="time" value="10:00">
              <input class="field span-2" name="load_in_time" type="time" title="Hora entrada">
              <input class="field span-3" name="load_out_time" type="time" title="Hora salida">
              <input class="field span-5" name="location" placeholder="Recinto / ubicación">
              <input class="field span-7" name="address" placeholder="Dirección completa">
              <input class="field span-6" name="access_notes" placeholder="Accesos / carga y descarga">
              <input class="field span-6" name="parking_notes" placeholder="Parking / vehículos">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>4. Personal y tarifas automáticas</h4>
            <p class="muted">El precio se toma automáticamente del tipo de operario configurado en Tarifas, como en V46.</p>
            <div id="roleLinesV566"></div>
            <button type="button" onclick="addRoleLineV566()">+ Añadir tipo de operario</button>
          </div>

          <div class="v46-event-block-v566">
            <h4>5. Producción y operación</h4>
            <div class="v46-grid-v566">
              <input class="field span-4" name="service_type" placeholder="Tipo de servicio">
              <input class="field span-4" name="required_workers" type="number" placeholder="Operarios necesarios">
              <input class="field span-4" name="required_team_leads" type="number" value="1" placeholder="Jefes de equipo">
              <input class="field span-6" name="material_notes" placeholder="Material / técnica">
              <input class="field span-6" name="crew_notes" placeholder="Notas para crew">
              <textarea class="field span-12" name="production_notes" placeholder="Notas producción"></textarea>
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>6. Facturación y costes</h4>
            <div class="v46-grid-v566">
              <select class="field span-3" name="payment_status"><option value="pendiente">Pendiente</option><option value="facturado">Facturado</option><option value="cobrado">Cobrado</option><option value="impagado">Impagado</option></select>
              <input class="field span-3" name="estimated_external_cost" type="number" step="0.01" placeholder="Coste externo">
              <input class="field span-3" name="estimated_transport_cost" type="number" step="0.01" placeholder="Transporte">
              <input class="field span-3" name="estimated_other_cost" type="number" step="0.01" placeholder="Otros">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>7. Notas internas</h4>
            <textarea class="field span-12" name="notes" placeholder="Notas internas del evento"></textarea>
          </div>

          <div class="event-actions-v559">
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
            <button>Guardar evento</button>
          </div>
        </form>
      </div>
    </div>
  `;

  addRoleLineV566();

  $('#eventFormV566').onsubmit = async e => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target));
    const created = await api('/api/events',{method:'POST',body:JSON.stringify(payload)});
    const eventId = created.id || created.event_id || created.lastInsertRowid;

    const lines = [...document.querySelectorAll('.role-line-v566')];
    for(const row of lines){
      const sel = row.querySelector('[name="rate_id"]');
      const opt = sel.options[sel.selectedIndex];
      await api('/api/event-role-lines',{
        method:'POST',
        body:JSON.stringify({
          event_id:eventId,
          rate_id:Number(sel.value),
          role_name:opt.dataset.role,
          quantity:Number(row.querySelector('[name="quantity"]').value||1),
          hours:Number(row.querySelector('[name="hours"]').value||4),
          rate_type:row.querySelector('[name="rate_type"]').value,
          unit_price:Number(row.querySelector('[name="unit_price"]').value||0),
          diet:Number(row.querySelector('[name="diet"]').value||0)
        })
      });
    }

    if(typeof v534Toast === 'function') v534Toast('Evento creado correctamente');
    try { await api('/api/google/export-event-v563/'+eventId,{method:'POST'}); } catch(err){}
    closeWizard();
    viewCalendar();
  };
}

async function viewRates(){
  const rates = await api('/api/rates-pro').catch(()=>[]);
  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Tarifas y roles de operarios</h3>
          <p class="muted">Roles claros para administración. Estos precios se usan automáticamente al crear eventos.</p>
        </div>
        <button class="secondary" onclick="resetRatesV566()">Restaurar roles V46 Pro</button>
      </div>
      <div class="v53-rate-help">
        <div class="v53-help-chip"><b>D</b>Tarifa diurna</div>
        <div class="v53-help-chip"><b>N</b>Tarifa nocturna</div>
        <div class="v53-help-chip"><b>Dieta</b>Importe por operario</div>
        <div class="v53-help-chip"><b>Activo</b>Disponible al crear evento</div>
      </div>
    </div>

    <div class="card">
      <table class="table">
        <thead><tr><th>Rol administración</th><th>Descripción</th><th>D / Diurno</th><th>N / Nocturno</th><th>Dieta</th><th>Estado</th></tr></thead>
        <tbody>${rates.map(r=>`
          <tr>
            <td><b>${esc(r.role||r.name||'')}</b></td>
            <td>${esc(r.notes||'')}</td>
            <td>${Number(r.hourly_rate||0).toFixed(2)} €</td>
            <td>${Number(r.night_rate||0).toFixed(2)} €</td>
            <td>${Number(r.diet||0).toFixed(2)} €</td>
            <td>${Number(r.active)!==0?'<span class="status-badge status-ok">Activo</span>':'<span class="status-badge status-bad">Inactivo</span>'}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>`;
}

async function resetRatesV566(){
  if(!confirm('¿Restaurar roles/tarifas profesionales por defecto?')) return;
  await api('/api/rates-pro/seed',{method:'POST'});
  viewRates();
}


// ---------- V56.7 CALENDAR SYNC FINAL FIX FRONTEND ----------
async function forceSyncGoogleFinalV567(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal sync-modal-v563">
        <div class="modal-head">
          <h2>Forzar sincronización Google MARFAN</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="sync-final-v567">
          <b>Diagnosticando…</b><br>
          Comprobando token, OAuth, calendario MARFAN y permisos.
        </div>
      </div>
    </div>
  `;

  try {
    const diag = await api('/api/google/final-diagnose-v567');

    if(!diag.ok){
      $('#modalRoot').innerHTML = `
        <div class="modal-back">
          <div class="modal sync-modal-v563">
            <div class="modal-head">
              <h2>No se puede sincronizar</h2>
              <button class="secondary" onclick="closeWizard()">Cerrar</button>
            </div>
            <div class="sync-final-v567 bad">
              <b>Error:</b> ${esc(diag.error || 'Error desconocido')}<br><br>
              <b>Qué revisar:</b><br>
              1. Que Google esté conectado.<br>
              2. Que exista calendario llamado MARFAN.<br>
              3. Que el usuario tenga permiso para leer ese calendario.<br>
              4. Si el calendario tiene otro ID, añade GOOGLE_TARGET_CALENDAR_ID en Railway.<br>
              <pre>${esc(JSON.stringify(diag,null,2))}</pre>
            </div>
          </div>
        </div>
      `;
      return;
    }

    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Calendario encontrado ✅</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-final-v567 ok">
            <b>Calendario:</b> ${esc((diag.calendar||{}).summary||'MARFAN')}<br>
            <b>Permiso:</b> ${esc((diag.calendar||{}).accessRole||'')}<br>
            <b>Coincidencia:</b> ${esc(diag.match||'')}<br><br>
            Leyendo eventos de Google y guardándolos en la app…
          </div>
        </div>
      </div>
    `;

    const r = await api('/api/google/final-force-sync-v567', {method:'POST'});

    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Sincronización completada ✅</h2>
            <button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button>
          </div>
          <div class="sync-final-v567 ok">
            <b>Calendario:</b> ${esc((r.calendar||{}).summary||'MARFAN')}<br>
            <b>Eventos Google leídos:</b> ${r.read}<br>
            <b>Creados en la app:</b> ${r.created}<br>
            <b>Actualizados:</b> ${r.updated}<br>
            <b>Errores:</b> ${r.errors}
          </div>
          ${r.errors ? `<div class="sync-final-v567 bad"><b>Errores:</b><pre>${esc(JSON.stringify((r.results||[]).filter(x=>x.action==='error'),null,2))}</pre></div>` : ''}
          <button onclick="closeWizard();viewCalendar()">Ver calendario actualizado</button>
        </div>
      </div>
    `;
  } catch(e) {
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-v563">
          <div class="modal-head">
            <h2>Error sincronizando</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-final-v567 bad">
            ${esc(e.message)}
          </div>
        </div>
      </div>
    `;
  }
}

// Esta función queda al final para ganar a cualquier override anterior.
async function viewCalendar(){
  const localEvents = await api('/api/events').catch(()=>[]);
  const googleStatus = await api('/api/google/status-v557').catch(()=>({configured:false,connected:false,target_calendar_name:'MARFAN'}));

  const events = localEvents.map(e => ({
    ...e,
    source: e.operational_status === 'google_marfan' ? 'google' : 'local'
  }));

  const body = v55CalView === 'week'
    ? v55RenderWeekAuto(events)
    : v55CalView === 'day'
      ? v55RenderDayAuto(events)
      : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Sincronización final: pulsa el botón rojo para traer eventos de Google MARFAN y guardarlos en la app.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected
            ? `<span class="status-badge status-ok">Google conectado</span>`
            : `<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>`}
          <button class="force-sync-btn-v567" onclick="forceSyncGoogleFinalV567()">FORZAR SINCRONIZACIÓN GOOGLE MARFAN</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">
        Eventos en app: ${events.length}. Los eventos de Google aparecen aquí después de forzar sincronización.
      </div>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
}


// ---------- V56.8 OPERARIOS ROLES + ASIGNACIONES FRONTEND ----------
let v568RolesCache = [];
let v568UsersCache = [];

async function loadRolesV568(){
  v568RolesCache = await api('/api/operator-roles').catch(()=>[]);
  return v568RolesCache;
}
async function loadUsersV568(){
  v568UsersCache = await api('/api/users').catch(()=>[]);
  return v568UsersCache;
}
function roleOptionsV568(selected=''){
  return v568RolesCache.map(r=>`<option value="${r.id}" ${String(selected)===String(r.id)?'selected':''}>${esc(r.role||r.name||'')}</option>`).join('');
}
function usersOptionsV568(selected=''){
  return v568UsersCache.filter(u=>u.role!=='admin' && Number(u.active)!==0).map(u=>`<option value="${u.id}" ${String(selected)===String(u.id)?'selected':''}>${esc((u.first_name||'')+' '+(u.last_name||''))}${u.nickname?' · '+esc(u.nickname):''}${u.operator_role_name?' · '+esc(u.operator_role_name):''}</option>`).join('');
}

function v568PatchOperatorFormRole(){
  setTimeout(async ()=>{
    await loadRolesV568();
    const form = document.querySelector('#operatorFormV558, #operatorFormV566, #operatorFormV568');
    if(!form || form.querySelector('[name="operator_role_id"]')) return;
    const perfilBlock = [...form.querySelectorAll('.operator-block-v558,.operator-section')].find(b => (b.textContent||'').toLowerCase().includes('perfil laboral'));
    if(perfilBlock){
      const targetGrid = perfilBlock.querySelector('.operator-grid-v56,.grid') || perfilBlock;
      const wrap = document.createElement('div');
      wrap.className = 'operator-grid-v56';
      wrap.innerHTML = `
        <select class="field span-6" name="operator_role_id" onchange="syncOperatorRoleNameV568(this)">
          <option value="">Rol de operario</option>
          ${roleOptionsV568()}
        </select>
        <input class="field span-6" name="operator_role_name" placeholder="Rol seleccionado" readonly>
      `;
      targetGrid.prepend(wrap);
    }
  },300);
}
function syncOperatorRoleNameV568(sel){
  const opt = sel.options[sel.selectedIndex];
  const input = sel.closest('form').querySelector('[name="operator_role_name"]');
  if(input) input.value = opt ? opt.textContent : '';
}

const __openCreateOperatorV558 = typeof openCreateOperatorV558 === 'function' ? openCreateOperatorV558 : null;
if(__openCreateOperatorV558){
  openCreateOperatorV558 = function(){
    __openCreateOperatorV558();
    v568PatchOperatorFormRole();
  };
}

function addAssignmentRowV568(userId='', serviceRole='', start='', end=''){
  const box = $('#assignmentsBoxV568');
  const div = document.createElement('div');
  div.className = 'assignment-row-v568';
  div.innerHTML = `
    <select class="field" name="user_id">${usersOptionsV568(userId)}</select>
    <input class="field" name="service_role" placeholder="Rol en este evento" value="${esc(serviceRole||'')}">
    <input class="field" name="planned_start" type="time" value="${esc(start||'')}">
    <input class="field" name="planned_end" type="time" value="${esc(end||'')}">
    <button type="button" class="danger" onclick="this.closest('.assignment-row-v568').remove()">Quitar</button>
  `;
  box.appendChild(div);
}

async function enhanceEventModalAssignmentsV568(eventId=null){
  await loadUsersV568();
  await loadRolesV568();

  const form = document.querySelector('#eventFormV566, #eventFormV563, #eventFormV559');
  if(!form || form.querySelector('#assignmentsBoxV568')) return;

  const block = document.createElement('div');
  block.className = 'v46-event-block-v566';
  block.innerHTML = `
    <h4>Operarios asignados al evento</h4>
    <p class="muted">Selecciona operarios concretos. La asignación queda guardada y se mantiene al editar el evento.</p>
    <div id="assignmentsBoxV568" class="assignment-box-v568"></div>
    <button type="button" onclick="addAssignmentRowV568()">+ Añadir operario</button>
  `;

  const actions = form.querySelector('.event-actions-v559') || form.lastElementChild;
  form.insertBefore(block, actions);

  if(eventId){
    const existing = await api('/api/events/'+eventId+'/assignments-full').catch(()=>[]);
    existing.forEach(a=>addAssignmentRowV568(a.user_id,a.service_role || a.operator_role_name,a.planned_start,a.planned_end));
    if(!existing.length) addAssignmentRowV568();
  }else{
    addAssignmentRowV568();
  }
}

const __openCreateEventV559_v568 = typeof openCreateEventV559 === 'function' ? openCreateEventV559 : null;
if(__openCreateEventV559_v568){
  openCreateEventV559 = async function(){
    await __openCreateEventV559_v568();
    await enhanceEventModalAssignmentsV568();
    const form = document.querySelector('#eventFormV566, #eventFormV563, #eventFormV559');
    if(form && !form.dataset.v568Assignments){
      form.dataset.v568Assignments = '1';
      const oldSubmit = form.onsubmit;
      form.onsubmit = async e => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.target));
        const created = await api('/api/events',{method:'POST',body:JSON.stringify(payload)});
        const eventId = created.id || created.event_id || created.lastInsertRowid;
        await saveAssignmentsV568(eventId);
        if(typeof v534Toast === 'function') v534Toast('Evento creado con operarios asignados');
        try { await api('/api/google/export-event-v563/'+eventId,{method:'POST'}); } catch(err){}
        closeWizard();
        viewCalendar();
      };
    }
  };
}

async function saveAssignmentsV568(eventId){
  const rows = [...document.querySelectorAll('#assignmentsBoxV568 .assignment-row-v568')].map(r=>({
    user_id:Number(r.querySelector('[name="user_id"]').value || 0),
    service_role:r.querySelector('[name="service_role"]').value || '',
    planned_start:r.querySelector('[name="planned_start"]').value || '',
    planned_end:r.querySelector('[name="planned_end"]').value || '',
    status:'asignado'
  })).filter(r=>r.user_id);
  await api('/api/events/'+eventId+'/assignments-save',{method:'POST',body:JSON.stringify({assignments:rows})});
}

async function editEventAssignmentsV568(eventId){
  const event = (await api('/api/events')).find(e=>Number(e.id)===Number(eventId));
  if(!event){ alert('Evento no encontrado'); return; }
  await loadUsersV568();
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal v46-event-modal-v566">
        <div class="modal-head">
          <h2>Editar operarios del evento</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="v46-event-block-v566">
          <h4>${esc(event.name||'Evento')}</h4>
          <p class="muted">${esc(event.event_date||'')} · ${esc(event.start_time||'')} - ${esc(event.end_time||'')}</p>
          <div id="assignmentsBoxV568" class="assignment-box-v568"></div>
          <button onclick="addAssignmentRowV568()">+ Añadir operario</button>
        </div>
        <div class="event-actions-v559">
          <button class="secondary" onclick="closeWizard()">Cancelar</button>
          <button onclick="saveAssignmentsV568(${eventId}); if(typeof v534Toast==='function')v534Toast('Asignaciones guardadas'); closeWizard(); viewCalendar();">Guardar cambios</button>
        </div>
      </div>
    </div>
  `;
  const existing = await api('/api/events/'+eventId+'/assignments-full').catch(()=>[]);
  existing.forEach(a=>addAssignmentRowV568(a.user_id,a.service_role || a.operator_role_name,a.planned_start,a.planned_end));
  if(!existing.length) addAssignmentRowV568();
}

const __openEventDetail_v568 = typeof openEventDetail === 'function' ? openEventDetail : null;
if(__openEventDetail_v568){
  openEventDetail = async function(id){
    await __openEventDetail_v568(id);
    setTimeout(()=>{
      const box = document.querySelector('.modal .actions, .modal .event-actions-v559, .modal .modal-head');
      if(box && !document.getElementById('editAssignmentsBtnV568')){
        const b = document.createElement('button');
        b.id='editAssignmentsBtnV568';
        b.innerText='Editar operarios';
        b.onclick=()=>editEventAssignmentsV568(id);
        box.appendChild(b);
      }
    },250);
  };
}

async function viewRates(){
  const rates = await api('/api/rates-pro').catch(()=>[]);
  $('#content').innerHTML = `
    <div class="card">
      <div class="v52-head">
        <div>
          <h3>Tarifas y roles de operarios</h3>
          <p class="muted">Añade, edita o elimina roles. Estos roles aparecen en Crear Operario y Crear Evento.</p>
        </div>
        <button class="secondary" onclick="resetRatesFullV568()">Restaurar roles completos</button>
      </div>
    </div>

    <div class="card">
      <h3>Añadir nuevo rol</h3>
      <form id="rateAddFormV568" class="rate-edit-row-v568">
        <input class="field" name="role" placeholder="Nombre rol">
        <input class="field" name="notes" placeholder="Descripción para administración">
        <input class="field" name="hourly_rate" type="number" step="0.01" placeholder="D">
        <input class="field" name="night_rate" type="number" step="0.01" placeholder="N">
        <input class="field" name="diet" type="number" step="0.01" placeholder="Dieta">
        <select class="field" name="active"><option value="1">Activo</option><option value="0">Inactivo</option></select>
        <button>Añadir</button>
      </form>
    </div>

    <div class="card">
      <h3>Roles actuales</h3>
      ${rates.map(r=>`
        <form class="rate-edit-row-v568" onsubmit="saveRateRowV568(event,${r.id})">
          <input class="field" name="role" value="${esc(r.role||r.name||'')}">
          <input class="field" name="notes" value="${esc(r.notes||'')}">
          <input class="field" name="hourly_rate" type="number" step="0.01" value="${Number(r.hourly_rate||0)}">
          <input class="field" name="night_rate" type="number" step="0.01" value="${Number(r.night_rate||0)}">
          <input class="field" name="diet" type="number" step="0.01" value="${Number(r.diet||0)}">
          <select class="field" name="active"><option value="1" ${Number(r.active)!==0?'selected':''}>Activo</option><option value="0" ${Number(r.active)===0?'selected':''}>Inactivo</option></select>
          <div><button>Guardar</button><button type="button" class="danger" onclick="deleteRateV568(${r.id})">Quitar</button></div>
        </form>
      `).join('')}
    </div>
  `;
  $('#rateAddFormV568').onsubmit = async e=>{
    e.preventDefault();
    await api('/api/rates-pro/add',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    viewRates();
  };
}

async function saveRateRowV568(e,id){
  e.preventDefault();
  await api('/api/rates-pro/'+id,{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
  if(typeof v534Toast==='function') v534Toast('Rol guardado');
  viewRates();
}

async function deleteRateV568(id){
  if(!confirm('¿Quitar este rol de operario?')) return;
  await api('/api/rates-pro/'+id,{method:'DELETE'});
  viewRates();
}

async function resetRatesFullV568(){
  if(!confirm('¿Restaurar todos los roles profesionales por defecto?')) return;
  await api('/api/rates-pro/seed-full-v568',{method:'POST'});
  viewRates();
}


// ---------- V56.9 REAL CALENDAR FIX FRONTEND ----------
async function forceSyncGoogleV569(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal">
        <div class="modal-head">
          <h2>Sincronización Google MARFAN</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="sync-final-v567">
          Conectando y leyendo eventos...
        </div>
      </div>
    </div>
  `;

  try{
    const dbg = await api('/api/google/debug-calendars-v569');

    if(!dbg.ok){
      $('#modalRoot').innerHTML = `
        <div class="modal-back">
          <div class="modal">
            <div class="modal-head">
              <h2>Error Google Calendar</h2>
              <button class="secondary" onclick="closeWizard()">Cerrar</button>
            </div>
            <div class="sync-final-v567 bad">
              ${esc(dbg.error||'Error')}
            </div>
          </div>
        </div>
      `;
      return;
    }

    const sync = await api('/api/google/manual-force-sync-v569',{method:'POST'});

    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal">
          <div class="modal-head">
            <h2>Sincronización completada</h2>
            <button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button>
          </div>
          <div class="sync-final-v567 ok">
            <b>Calendarios detectados:</b> ${dbg.total}<br>
            <b>Eventos Google:</b> ${sync.total_google}<br>
            <b>Creados:</b> ${sync.created}<br>
            <b>Actualizados:</b> ${sync.updated}
          </div>
          <div class="sync-final-v567">
            <pre>${esc(JSON.stringify(dbg.calendars,null,2))}</pre>
          </div>
        </div>
      </div>
    `;

    setTimeout(()=>viewCalendar(),1200);

  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal">
          <div class="modal-head">
            <h2>Error sincronizando</h2>
            <button class="secondary" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="sync-final-v567 bad">
            ${esc(e.message)}
          </div>
        </div>
      </div>
    `;
  }
}

// override definitivo
const __viewCalendarV569 = viewCalendar;
viewCalendar = async function(){
  await __viewCalendarV569();

  setTimeout(()=>{
    const toolbar = document.querySelector('.v55-google-panel');
    if(toolbar && !document.getElementById('forceSyncV569')){
      const btn = document.createElement('button');
      btn.id='forceSyncV569';
      btn.className='force-sync-btn-v567';
      btn.innerText='FORZAR SINCRONIZACIÓN';
      btn.onclick=forceSyncGoogleV569;
      toolbar.prepend(btn);
    }
  },150);
};

// roles dinámicos por evento
function calcRolePriceDynamicV569(row){
  const roleSel = row.querySelector('[name="service_role_rate"]');
  const opt = roleSel.options[roleSel.selectedIndex];
  const type = row.querySelector('[name="service_shift"]').value;
  const price = type === 'N'
    ? Number(opt.dataset.night||0)
    : Number(opt.dataset.day||0);

  row.querySelector('[name="service_price"]').value = price.toFixed(2);
}

function addAssignmentRowV569(userId='', roleId=''){
  const box = document.querySelector('#assignmentsBoxV568');
  if(!box) return;

  const div = document.createElement('div');
  div.className='assignment-row-v568';

  div.innerHTML = `
    <select class="field" name="user_id">${usersOptionsV568(userId)}</select>

    <select class="field" name="service_role_rate" onchange="calcRolePriceDynamicV569(this.closest('.assignment-row-v568'))">
      ${v568RolesCache.map(r=>`
        <option 
          value="${r.id}" 
          data-day="${Number(r.hourly_rate||0)}"
          data-night="${Number(r.night_rate||0)}"
          ${String(roleId)===String(r.id)?'selected':''}
        >
          ${esc(r.role||r.name||'')}
        </option>
      `).join('')}
    </select>

    <select class="field" name="service_shift" onchange="calcRolePriceDynamicV569(this.closest('.assignment-row-v568'))">
      <option value="D">D</option>
      <option value="N">N</option>
    </select>

    <input class="field" readonly name="service_price" placeholder="Tarifa">

    <button type="button" class="danger" onclick="this.closest('.assignment-row-v568').remove()">Quitar</button>
  `;

  box.appendChild(div);
  calcRolePriceDynamicV569(div);
}


// ---------- V57 PDF A4 BUTTONS + FRONTEND AUTOBACKUP ----------
async function autoBackupV57(reason='frontend-change'){
  try{ await api('/api/backup/manual-v57',{method:'POST',body:JSON.stringify({reason})}); }catch(e){}
}

// refuerzo frontend: cada POST/PUT/DELETE crea copia después
if(!window.__v57ApiWrapped && typeof api === 'function'){
  window.__v57ApiWrapped = true;
  const __apiV57 = api;
  api = async function(url, opts={}){
    const r = await __apiV57(url, opts);
    const method = String((opts||{}).method||'GET').toUpperCase();
    if(['POST','PUT','DELETE'].includes(method) && !String(url).includes('/backup/') && !String(url).includes('/login') && !String(url).includes('/google/')){
      setTimeout(()=>autoBackupV57(method+'_'+String(url).replace(/[^a-zA-Z0-9]/g,'_')),250);
    }
    return r;
  };
}

function printHtmlV57(title, subtitle, body){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal" style="max-width:980px">
        <div class="modal-head no-print">
          <h2>${esc(title)}</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="no-print actions" style="margin-bottom:12px">
          <button class="pdf-btn-v57" onclick="window.print()">Descargar / Imprimir PDF A4</button>
        </div>
        <div id="printAreaV57" class="a4-print-v57">
          <div class="a4-head-v57">
            <div>
              <div class="a4-title-v57">MARFAN CREW</div>
              <div>${esc(subtitle||'')}</div>
            </div>
            <div>${new Date().toLocaleString('es-ES')}</div>
          </div>
          ${body}
        </div>
      </div>
    </div>
  `;
}

async function printOperatorDocumentV57(userId, docId=null){
  const data = await api('/api/users/'+userId+'/folder');
  const u = data.user;
  const docs = data.docs || [];
  const list = docId ? docs.filter(d=>Number(d.id)===Number(docId)) : docs;
  printHtmlV57('Carpeta documentos operario','Base de datos documental del operario',`
    <h1>${esc((u.first_name||'')+' '+(u.last_name||''))} ${u.nickname?'· '+esc(u.nickname):''}</h1>
    <p><b>DNI:</b> ${esc(u.dni||'—')}<br><b>Teléfono:</b> ${esc(u.phone||'—')}<br><b>Email:</b> ${esc(u.email||'—')}</p>
    <h2>Documentación</h2>
    ${list.map(d=>`
      <div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin:8px 0">
        <b>${esc(d.title||'Documento')}</b><br>
        Tipo: ${esc(d.doc_type||'')}<br>
        Validez: ${esc(d.expiry_date||'—')}<br>
        Estado: ${esc(d.computed_status||'')}<br>
        ${d.file_url?`Archivo: ${esc(d.file_url)}`:''}
      </div>
    `).join('') || '<p>Sin documentos.</p>'}
  `);
}

async function printDeliveryNoteV57(eventId){
  let event = (await api('/api/events')).find(e=>Number(e.id)===Number(eventId));
  let notes = [];
  try{ notes = await api('/api/delivery-notes?event_id='+eventId); }catch(e){}
  printHtmlV57('Albarán de evento','Documento de servicio realizado',`
    <h1>${esc(event?.name||'Evento')}</h1>
    <p><b>Fecha:</b> ${esc(event?.event_date||'')}<br>
    <b>Horario:</b> ${esc(event?.start_time||'')} - ${esc(event?.end_time||'')}<br>
    <b>Cliente:</b> ${esc(event?.client||'')}<br>
    <b>Ubicación:</b> ${esc(event?.location||'')}</p>
    <h2>Albaranes / notas</h2>
    ${(Array.isArray(notes)?notes:[]).map(n=>`
      <div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin:8px 0">
        <b>${esc(n.title||'Albarán')}</b><br>
        ${esc(n.content||n.notes||'')}
      </div>
    `).join('') || '<p>Albarán generado automáticamente al finalizar evento.</p>'}
  `);
}

async function printFinanceEventV57(eventId){
  let event = (await api('/api/events')).find(e=>Number(e.id)===Number(eventId));
  let fin = null;
  try{ fin = await api('/api/finance/event/'+eventId); }catch(e){}
  printHtmlV57('Finanzas Pro · Evento','Informe financiero interno',`
    <h1>${esc(event?.name||'Evento')}</h1>
    <p><b>Fecha:</b> ${esc(event?.event_date||'')}<br><b>Cliente:</b> ${esc(event?.client||'')}</p>
    <h2>Resumen financiero</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td>Ingresos</td><td style="text-align:right">${Number(fin?.revenue||event?.total_amount||0).toFixed(2)} €</td></tr>
      <tr><td>Costes</td><td style="text-align:right">${Number(fin?.totalCost||0).toFixed(2)} €</td></tr>
      <tr><td><b>Beneficio</b></td><td style="text-align:right"><b>${Number(fin?.profit||0).toFixed(2)} €</b></td></tr>
      <tr><td>Margen</td><td style="text-align:right">${Number(fin?.margin||0).toFixed(2)} %</td></tr>
    </table>
  `);
}

// Añadir botones PDF a carpeta de operario
const __openOperatorFolderV555_V57 = typeof openOperatorFolderV555 === 'function' ? openOperatorFolderV555 : null;
if(__openOperatorFolderV555_V57){
  openOperatorFolderV555 = async function(id){
    await __openOperatorFolderV555_V57(id);
    setTimeout(()=>{
      const modal = document.querySelector('.modal');
      if(modal && !document.getElementById('printOperatorFolderV57')){
        const btn = document.createElement('button');
        btn.id='printOperatorFolderV57';
        btn.className='pdf-btn-v57';
        btn.innerText='Descargar / Imprimir carpeta PDF A4';
        btn.onclick=()=>printOperatorDocumentV57(id);
        const head = modal.querySelector('.modal-head') || modal;
        head.appendChild(btn);
      }
      document.querySelectorAll('.v53-doc-card').forEach(card=>{
        if(!card.querySelector('.pdf-btn-v57')){
          const b=document.createElement('button');
          b.className='pdf-btn-v57';
          b.innerText='Descargar / Imprimir PDF A4';
          b.onclick=()=>printOperatorDocumentV57(id);
          card.appendChild(b);
        }
      });
    },300);
  };
}

// Añadir botón PDF en detalle evento/albarán
const __openEventDetail_V57 = typeof openEventDetail === 'function' ? openEventDetail : null;
if(__openEventDetail_V57){
  openEventDetail = async function(id){
    await __openEventDetail_V57(id);
    setTimeout(()=>{
      const box = document.querySelector('.modal .actions, .modal .modal-head, .modal');
      if(box && !document.getElementById('printDeliveryV57')){
        const btn = document.createElement('button');
        btn.id='printDeliveryV57';
        btn.className='pdf-btn-v57';
        btn.innerText='Descargar / Imprimir albarán PDF A4';
        btn.onclick=()=>printDeliveryNoteV57(id);
        box.appendChild(btn);
      }
      if(box && !document.getElementById('printFinanceV57')){
        const btn2 = document.createElement('button');
        btn2.id='printFinanceV57';
        btn2.className='pdf-btn-v57';
        btn2.innerText='Finanzas Pro PDF A4';
        btn2.onclick=()=>printFinanceEventV57(id);
        box.appendChild(btn2);
      }
    },300);
  };
}

async function backupCenterV57(){
  const d = await api('/api/backup/list-v57');
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal" style="max-width:980px">
        <div class="modal-head">
          <h2>Copias de seguridad completas</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="backup-box-v57">
          <b>Ruta:</b> ${esc(d.dir||'')}<br>
          <button onclick="manualBackupV57()">Generar copia completa ahora</button>
          <button onclick="downloadBackupV57()">Descargar copia completa</button>
        </div>
        ${(d.files||[]).map(f=>`
          <div class="backup-box-v57">
            <b>${esc(f.filename)}</b><br>
            ${new Date(f.created_at).toLocaleString('es-ES')} · ${(f.size_bytes/1024).toFixed(1)} KB<br>
            <button onclick="restoreBackupV57('${esc(f.filename).replace(/'/g,"\\'")}')">Restaurar esta copia</button>
          </div>
        `).join('') || '<p>No hay copias todavía.</p>'}
      </div>
    </div>
  `;
}

async function manualBackupV57(){
  await api('/api/backup/manual-v57',{method:'POST'});
  if(typeof v534Toast==='function') v534Toast('Copia creada');
  backupCenterV57();
}
function downloadBackupV57(){
  window.open('/api/backup/export-v57','_blank');
}
async function restoreBackupV57(filename){
  if(!confirm('¿Restaurar esta copia? Reemplazará la información actual.')) return;
  await api('/api/backup/restore-v57',{method:'POST',body:JSON.stringify({filename})});
  alert('Copia restaurada. Recarga la app.');
  location.reload();
}

// Botón backup en Ajustes si existe
const __viewConfigV57 = typeof viewConfig === 'function' ? viewConfig : null;
if(__viewConfigV57){
  viewConfig = async function(){
    await __viewConfigV57();
    const c = document.querySelector('#content');
    if(c && !document.getElementById('backupCenterV57Btn')){
      const div = document.createElement('div');
      div.className='card';
      div.innerHTML = `<h3>Copias de seguridad V57</h3><p class="muted">Copia completa automática en cada cambio y restauración manual.</p><button id="backupCenterV57Btn" onclick="backupCenterV57()">Abrir centro de backups</button>`;
      c.appendChild(div);
    }
  };
}


// ---------- V57.1 BACKUP AUTO-CLEAN UI ----------
async function cleanupBackupsV571(){
  const r = await api('/api/backup/cleanup-v571',{method:'POST'});
  alert(`Limpieza realizada.\nMáximo permitido: ${r.max}\nBorrados: ${r.deleted}\nConservados: ${r.kept}`);
  if(typeof backupCenterV57 === 'function') backupCenterV57();
}

const __backupCenterV57_571 = typeof backupCenterV57 === 'function' ? backupCenterV57 : null;
if(__backupCenterV57_571){
  backupCenterV57 = async function(){
    await __backupCenterV57_571();
    setTimeout(async ()=>{
      const modal = document.querySelector('.modal');
      if(modal && !document.getElementById('cleanupBackupsV571')){
        const st = await api('/api/backup/status-v571').catch(()=>null);
        const div = document.createElement('div');
        div.className = 'backup-box-v57';
        div.innerHTML = `
          <b>Limpieza automática V57.1</b><br>
          Máximo backups guardados: ${st ? st.max : 10}<br>
          Backups actuales: ${st ? st.current : '—'}<br>
          LATEST.json: ${st && st.latest_exists ? 'OK' : '—'}<br><br>
          <button id="cleanupBackupsV571" onclick="cleanupBackupsV571()">Limpiar backups antiguos ahora</button>
        `;
        modal.appendChild(div);
      }
    },200);
  };
}


// ---------- V57.2 CALENDAR SYNC + EVENT SUBMENU FINAL ----------
async function fetchJsonV572(url, opts={}){
  const headers = {'Content-Type':'application/json'};
  if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, {...opts, headers:{...headers, ...(opts.headers||{})}});
  const text = await res.text();
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data = {error:text}; }
  if(!res.ok) throw new Error(data.error || text || 'Error HTTP '+res.status);
  return data;
}

async function forceGoogleSyncV572(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back"><div class="modal">
      <div class="modal-head"><h2>Forzar sincronización Google MARFAN</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
      <div class="sync-v572">Diagnosticando Google Calendar...</div>
    </div></div>`;

  try{
    const diag = await fetchJsonV572('/api/google/diagnose-v572');
    if(!diag.ok){
      $('#modalRoot').innerHTML = `
        <div class="modal-back"><div class="modal">
          <div class="modal-head"><h2>No se puede sincronizar</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
          <div class="sync-v572 bad"><b>Error:</b> ${esc(diag.error||'Error desconocido')}<pre>${esc(JSON.stringify(diag,null,2))}</pre></div>
        </div></div>`;
      return;
    }

    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Calendario encontrado</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
        <div class="sync-v572 ok">
          <b>${esc((diag.calendar||{}).summary||'MARFAN')}</b><br>
          Permiso: ${esc((diag.calendar||{}).accessRole||'')}<br>
          Sincronizando eventos...
        </div>
      </div></div>`;

    const r = await fetchJsonV572('/api/google/force-sync-v572',{method:'POST'});
    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Sincronización completada ✅</h2><button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button></div>
        <div class="sync-v572 ok">
          <b>Calendario:</b> ${esc((r.calendar||{}).summary||'MARFAN')}<br>
          <b>Eventos leídos:</b> ${r.read}<br>
          <b>Creados:</b> ${r.created}<br>
          <b>Actualizados:</b> ${r.updated}<br>
          <b>Errores:</b> ${r.errors}
        </div>
        ${r.errors ? `<div class="sync-v572 bad"><pre>${esc(JSON.stringify((r.results||[]).filter(x=>x.action==='error'),null,2))}</pre></div>` : ''}
        <button onclick="closeWizard();viewCalendar()">Ver calendario actualizado</button>
      </div></div>`;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Error sincronizando</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
        <div class="sync-v572 bad">${esc(e.message)}</div>
      </div></div>`;
  }
}

async function loadEventModalDataV572(){
  const users = await fetchJsonV572('/api/users').catch(()=>[]);
  const roles = await fetchJsonV572('/api/operator-roles').catch(()=>[]);
  return {users:users.filter(u=>u.role!=='admin' && Number(u.active)!==0), roles};
}
function userOptionsV572(users){
  return users.map(u=>`<option value="${u.id}">${esc((u.first_name||'')+' '+(u.last_name||''))}${u.nickname?' · '+esc(u.nickname):''}</option>`).join('');
}
function roleOptionsV572(roles){
  return roles.map(r=>`<option value="${r.id}" data-name="${esc(r.role||r.name||'')}" data-day="${Number(r.hourly_rate||0)}" data-night="${Number(r.night_rate||0)}">${esc(r.role||r.name||'')}</option>`).join('');
}
function calcAssignV572(row){
  const opt = row.querySelector('[name="role_id"]').options[row.querySelector('[name="role_id"]').selectedIndex];
  const shift = row.querySelector('[name="shift"]').value;
  const price = shift === 'N' ? Number(opt.dataset.night||0) : Number(opt.dataset.day||0);
  row.querySelector('[name="price"]').value = price.toFixed(2);
}
function addAssignmentV572(users, roles){
  const box = $('#assignmentsBoxV572');
  const row = document.createElement('div');
  row.className='assignment-row-v572';
  row.innerHTML = `
    <select class="field" name="user_id">${userOptionsV572(users)}</select>
    <select class="field" name="role_id" onchange="calcAssignV572(this.closest('.assignment-row-v572'))">${roleOptionsV572(roles)}</select>
    <select class="field" name="shift" onchange="calcAssignV572(this.closest('.assignment-row-v572'))"><option value="D">D</option><option value="N">N</option></select>
    <input class="field" name="planned_start" type="time">
    <input class="field" name="price" readonly placeholder="€/h">
    <button type="button" class="danger" onclick="this.closest('.assignment-row-v572').remove()">Quitar</button>
  `;
  box.appendChild(row);
  calcAssignV572(row);
}

// Sobrescribe crear evento definitivamente
async function openCreateEventV559(){
  const {users, roles} = await loadEventModalDataV572();

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal v46-event-modal-v566">
        <div class="modal-head"><h2>Crear evento</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
        <form id="eventFormV572" class="v46-event-form-v566">

          <div class="v46-event-block-v566">
            <h4>1. Datos del evento</h4>
            <div class="v46-grid-v566">
              <input class="field span-6" name="name" placeholder="Nombre del evento" required>
              <input class="field span-3" name="event_code" placeholder="Referencia">
              <select class="field span-3" name="status"><option value="programado">Programado</option><option value="confirmado">Confirmado</option><option value="pendiente">Pendiente</option><option value="realizado">Realizado</option></select>
              <input class="field span-4" name="client" placeholder="Cliente">
              <input class="field span-4" name="legal_name" placeholder="Razón social">
              <input class="field span-4" name="cif" placeholder="CIF/NIF">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>2. Responsable y contacto</h4>
            <div class="v46-grid-v566">
              <input class="field span-4" name="contact_name" placeholder="Responsable">
              <input class="field span-3" name="contact_phone" placeholder="Teléfono">
              <input class="field span-5" name="contact_email" placeholder="Email">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>3. Fecha, horarios y ubicación</h4>
            <div class="v46-grid-v566">
              <input class="field span-3" name="event_date" type="date" value="${v55DateKey ? v55DateKey(v55CalDate || new Date()) : new Date().toISOString().slice(0,10)}" required>
              <input class="field span-2" name="start_time" type="time" value="09:00">
              <input class="field span-2" name="end_time" type="time" value="10:00">
              <input class="field span-2" name="load_in_time" type="time">
              <input class="field span-3" name="load_out_time" type="time">
              <input class="field span-5" name="location" placeholder="Recinto / ubicación">
              <input class="field span-7" name="address" placeholder="Dirección completa">
              <input class="field span-6" name="access_notes" placeholder="Accesos / carga y descarga">
              <input class="field span-6" name="parking_notes" placeholder="Parking / vehículos">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>4. Operarios del evento</h4>
            <p class="muted">Aquí eliges el operario y el rol que hace EN ESTE EVENTO. Un mismo chico puede ser carga hoy y limpieza mañana.</p>
            <div id="assignmentsBoxV572"></div>
            <button type="button" onclick='addAssignmentV572(window.__usersV572, window.__rolesV572)'>+ Añadir operario</button>
          </div>

          <div class="v46-event-block-v566">
            <h4>5. Producción y operación</h4>
            <div class="v46-grid-v566">
              <input class="field span-4" name="service_type" placeholder="Tipo de servicio">
              <input class="field span-4" name="required_workers" type="number" placeholder="Operarios necesarios">
              <input class="field span-4" name="required_team_leads" type="number" value="1" placeholder="Jefes de equipo">
              <input class="field span-6" name="material_notes" placeholder="Material / técnica">
              <input class="field span-6" name="crew_notes" placeholder="Notas para crew">
              <textarea class="field span-12" name="production_notes" placeholder="Notas producción"></textarea>
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>6. Facturación y costes</h4>
            <div class="v46-grid-v566">
              <select class="field span-3" name="payment_status"><option value="pendiente">Pendiente</option><option value="facturado">Facturado</option><option value="cobrado">Cobrado</option></select>
              <input class="field span-3" name="estimated_external_cost" type="number" step="0.01" placeholder="Coste externo">
              <input class="field span-3" name="estimated_transport_cost" type="number" step="0.01" placeholder="Transporte">
              <input class="field span-3" name="estimated_other_cost" type="number" step="0.01" placeholder="Otros">
            </div>
          </div>

          <div class="v46-event-block-v566">
            <h4>7. Notas internas</h4>
            <textarea class="field span-12" name="notes" placeholder="Notas internas"></textarea>
          </div>

          <div class="event-actions-v559">
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
            <button>Guardar evento</button>
          </div>
        </form>
      </div>
    </div>`;

  window.__usersV572 = users;
  window.__rolesV572 = roles;
  addAssignmentV572(users, roles);

  $('#eventFormV572').onsubmit = async e=>{
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target));
    const created = await fetchJsonV572('/api/events',{method:'POST',body:JSON.stringify(payload)});
    const eventId = created.id || created.event_id || created.lastInsertRowid;

    const assignments = [...document.querySelectorAll('.assignment-row-v572')].map(row=>{
      const roleSel = row.querySelector('[name="role_id"]');
      const opt = roleSel.options[roleSel.selectedIndex];
      return {
        user_id:Number(row.querySelector('[name="user_id"]').value),
        service_role:opt.dataset.name || opt.textContent,
        planned_start:row.querySelector('[name="planned_start"]').value || payload.start_time || '',
        planned_end:payload.end_time || '',
        status:'asignado'
      };
    }).filter(x=>x.user_id);

    await fetchJsonV572('/api/events/'+eventId+'/assignments-save',{method:'POST',body:JSON.stringify({assignments})});
    if(typeof v534Toast === 'function') v534Toast('Evento creado con operarios asignados');
    closeWizard();
    viewCalendar();
  };
}

// Sobrescribe calendario y mete botón real siempre visible
async function viewCalendar(){
  const eventsLocal = await fetchJsonV572('/api/events').catch(()=>[]);
  const googleStatus = await fetchJsonV572('/api/google/status-v557').catch(()=>({connected:false}));
  const events = eventsLocal.map(e=>({...e, source:e.operational_status==='google_marfan'?'google':'local'}));
  const body = v55CalView==='week' ? v55RenderWeekAuto(events) : v55CalView==='day' ? v55RenderDayAuto(events) : v55RenderMonthAuto(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">Pulsa el botón rojo para sincronizar manualmente con Google.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>'}
          <button class="force-sync-v572" onclick="forceGoogleSyncV572()">FORZAR SINCRONIZACIÓN GOOGLE</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">Eventos cargados en app: ${events.length}</div>
    </div>
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${v55CalendarTitle()}</h2>
        <div class="v55-view-tabs">
          <button class="${v55CalView==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${v55CalView==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${v55CalView==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>${body}
    </div>`;
}


// ---------- V57.3 PDF A4 VER + IMPRIMIR ----------
function buildA4ModalV573(title, subtitle, body, autoPrint=false){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal" style="max-width:980px">
        <div class="modal-head no-print">
          <h2>${esc(title)}</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <div class="no-print pdf-actions-v573">
          <button class="btn-print-pdf-v573" onclick="window.print()">Imprimir PDF A4</button>
        </div>

        <div id="printAreaV57" class="a4-print-v57">
          <div class="a4-head-v57">
            <div>
              <div class="a4-title-v57">MARFAN CREW</div>
              <div>${esc(subtitle||'')}</div>
            </div>
            <div>${new Date().toLocaleString('es-ES')}</div>
          </div>
          ${body}
        </div>
      </div>
    </div>
  `;
  if(autoPrint) setTimeout(()=>window.print(),350);
}

async function viewOperatorPdfA4V573(userId){
  const data = await api('/api/users/'+userId+'/folder');
  const u = data.user;
  const docs = data.docs || [];

  buildA4ModalV573('PDF A4 · Carpeta operario','Base documental del operario',`
    <h1>${esc((u.first_name||'')+' '+(u.last_name||''))} ${u.nickname?'· '+esc(u.nickname):''}</h1>
    <p>
      <b>DNI:</b> ${esc(u.dni||'—')}<br>
      <b>Teléfono:</b> ${esc(u.phone||'—')}<br>
      <b>Email:</b> ${esc(u.email||'—')}<br>
      <b>Rol:</b> ${esc(u.operator_role_name||u.services||'—')}
    </p>
    <h2>Documentos</h2>
    ${docs.map(d=>`
      <div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin:8px 0">
        <b>${esc(d.title||'Documento')}</b><br>
        Tipo: ${esc(d.doc_type||'')}<br>
        Validez: ${esc(d.expiry_date||'—')}<br>
        Estado: ${esc(d.computed_status||'')}<br>
        ${d.file_url ? `Archivo: ${esc(d.file_url)}` : ''}
      </div>
    `).join('') || '<p>Sin documentos.</p>'}
  `);
}

async function printOperatorPdfA4V573(userId){
  await viewOperatorPdfA4V573(userId);
  setTimeout(()=>window.print(),450);
}

async function viewDeliveryPdfA4V573(eventId){
  const events = await api('/api/events').catch(()=>[]);
  const event = events.find(e=>Number(e.id)===Number(eventId)) || {};
  let assignments = [];
  try{ assignments = await api('/api/events/'+eventId+'/assignments-full'); }catch(e){}

  buildA4ModalV573('PDF A4 · Albarán evento','Albarán de servicio realizado',`
    <h1>${esc(event.name||'Evento')}</h1>
    <p>
      <b>Fecha:</b> ${esc(event.event_date||'')}<br>
      <b>Horario:</b> ${esc(event.start_time||'')} - ${esc(event.end_time||'')}<br>
      <b>Cliente:</b> ${esc(event.client||'')}<br>
      <b>Ubicación:</b> ${esc(event.location||event.address||'')}
    </p>
    <h2>Personal asignado</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Operario</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Rol</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Entrada</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Salida</th>
        </tr>
      </thead>
      <tbody>
        ${assignments.map(a=>`
          <tr>
            <td style="border-bottom:1px solid #ddd;padding:6px">${esc((a.first_name||'')+' '+(a.last_name||''))}${a.nickname?' · '+esc(a.nickname):''}</td>
            <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.service_role||a.operator_role_name||'')}</td>
            <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.planned_start||'')}</td>
            <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.planned_end||'')}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" style="padding:6px">Sin operarios asignados.</td></tr>'}
      </tbody>
    </table>
    <h2>Notas</h2>
    <p>${esc(event.notes||event.production_notes||'')}</p>
  `);
}

async function printDeliveryPdfA4V573(eventId){
  await viewDeliveryPdfA4V573(eventId);
  setTimeout(()=>window.print(),450);
}

async function viewFinancePdfA4V573(eventId){
  const events = await api('/api/events').catch(()=>[]);
  const event = events.find(e=>Number(e.id)===Number(eventId)) || {};
  let fin = {};
  try{ fin = await api('/api/finance/event/'+eventId); }catch(e){}

  buildA4ModalV573('PDF A4 · Finanzas Pro','Informe financiero interno del evento',`
    <h1>${esc(event.name||'Evento')}</h1>
    <p>
      <b>Fecha:</b> ${esc(event.event_date||'')}<br>
      <b>Cliente:</b> ${esc(event.client||'')}<br>
      <b>Ubicación:</b> ${esc(event.location||event.address||'')}
    </p>
    <h2>Resumen económico</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:7px;border-bottom:1px solid #ddd">Ingresos</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.revenue||event.total_amount||0).toFixed(2)} €</td></tr>
      <tr><td style="padding:7px;border-bottom:1px solid #ddd">Costes reales</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.totalCost||0).toFixed(2)} €</td></tr>
      <tr><td style="padding:7px;border-bottom:1px solid #ddd"><b>Beneficio</b></td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right"><b>${Number(fin.profit||0).toFixed(2)} €</b></td></tr>
      <tr><td style="padding:7px;border-bottom:1px solid #ddd">Margen</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.margin||0).toFixed(2)} %</td></tr>
    </table>
    <p style="font-size:11px;color:#666;margin-top:22px">Documento interno de administración. No entregar al cliente salvo autorización.</p>
  `);
}

async function printFinancePdfA4V573(eventId){
  await viewFinancePdfA4V573(eventId);
  setTimeout(()=>window.print(),450);
}

function addPdfButtonsV573(container, buttons){
  if(!container) return;
  const wrap = document.createElement('div');
  wrap.className = 'pdf-actions-v573';
  buttons.forEach(b=>{
    if(document.getElementById(b.id)) return;
    const btn = document.createElement('button');
    btn.id = b.id;
    btn.className = b.print ? 'btn-print-pdf-v573' : 'btn-view-pdf-v573';
    btn.innerText = b.label;
    btn.onclick = b.onclick;
    wrap.appendChild(btn);
  });
  if(wrap.children.length) container.appendChild(wrap);
}

// Operarios: carpeta documental
const __openOperatorFolderV573 = typeof openOperatorFolderV555 === 'function' ? openOperatorFolderV555 : null;
if(__openOperatorFolderV573){
  openOperatorFolderV555 = async function(id){
    await __openOperatorFolderV573(id);
    setTimeout(()=>{
      const modal = document.querySelector('.modal');
      const head = modal ? (modal.querySelector('.modal-head') || modal) : null;
      addPdfButtonsV573(head, [
        {id:'viewOperatorPdfA4V573', label:'Ver PDF A4', onclick:()=>viewOperatorPdfA4V573(id)},
        {id:'printOperatorPdfA4V573', label:'Imprimir PDF A4', print:true, onclick:()=>printOperatorPdfA4V573(id)}
      ]);
    },300);
  };
}

// Eventos: albarán y finanzas
const __openEventDetailV573 = typeof openEventDetail === 'function' ? openEventDetail : null;
if(__openEventDetailV573){
  openEventDetail = async function(id){
    await __openEventDetailV573(id);
    setTimeout(()=>{
      const modal = document.querySelector('.modal');
      const box = modal ? (modal.querySelector('.actions') || modal.querySelector('.modal-head') || modal) : null;
      addPdfButtonsV573(box, [
        {id:'viewDeliveryPdfA4V573', label:'Ver PDF A4 Albarán', onclick:()=>viewDeliveryPdfA4V573(id)},
        {id:'printDeliveryPdfA4V573', label:'Imprimir PDF A4 Albarán', print:true, onclick:()=>printDeliveryPdfA4V573(id)},
        {id:'viewFinancePdfA4V573', label:'Ver PDF A4 Finanzas', onclick:()=>viewFinancePdfA4V573(id)},
        {id:'printFinancePdfA4V573', label:'Imprimir PDF A4 Finanzas', print:true, onclick:()=>printFinancePdfA4V573(id)}
      ]);
    },300);
  };
}


// ---------- V57.4 CALENDAR SYNC NO PATTERN FIX FRONTEND ----------
async function forceGoogleSyncNoPatternV574(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back"><div class="modal">
      <div class="modal-head"><h2>Forzar sincronización Google MARFAN</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
      <div class="sync-v574">Sincronizando sin filtros de fecha para evitar error de patrón...</div>
    </div></div>`;

  try{
    const headers = {'Content-Type':'application/json'};
    if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch('/api/google/sync-no-pattern-v574', {method:'POST', headers});
    const txt = await res.text();
    let data;
    try{ data = JSON.parse(txt); }catch(e){ data = {ok:false,error:txt}; }

    if(!res.ok || !data.ok){
      $('#modalRoot').innerHTML = `
        <div class="modal-back"><div class="modal">
          <div class="modal-head"><h2>Error sincronizando</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
          <div class="sync-v574 bad">
            <b>${esc(data.error || 'Error desconocido')}</b>
            <pre>${esc(JSON.stringify(data.debug || data,null,2))}</pre>
          </div>
        </div></div>`;
      return;
    }

    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Sincronización completada ✅</h2><button class="secondary" onclick="closeWizard();viewCalendar()">Cerrar</button></div>
        <div class="sync-v574 ok">
          <b>Calendario:</b> ${esc((data.debug.calendar||{}).summary || 'MARFAN')}<br>
          <b>Eventos leídos:</b> ${data.read}<br>
          <b>Creados:</b> ${data.created}<br>
          <b>Actualizados:</b> ${data.updated}<br>
          <b>Errores:</b> ${data.errors}
        </div>
        <div class="sync-v574"><pre>${esc(JSON.stringify(data.debug,null,2))}</pre></div>
        <button onclick="closeWizard();viewCalendar()">Ver calendario actualizado</button>
      </div></div>`;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Error sincronizando</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
        <div class="sync-v574 bad">${esc(e.message)}</div>
      </div></div>`;
  }
}

// override final para que el botón aparezca SIEMPRE
const __viewCalendarBeforeV574 = typeof viewCalendar === 'function' ? viewCalendar : null;
viewCalendar = async function(){
  if(__viewCalendarBeforeV574) await __viewCalendarBeforeV574();

  setTimeout(()=>{
    const panel = document.querySelector('.v55-google-panel');
    if(panel && !document.getElementById('forceGoogleSyncNoPatternV574')){
      const btn = document.createElement('button');
      btn.id = 'forceGoogleSyncNoPatternV574';
      btn.className = 'force-sync-v574';
      btn.innerText = 'FORZAR SINCRONIZACIÓN GOOGLE SIN ERROR';
      btn.onclick = forceGoogleSyncNoPatternV574;
      panel.prepend(btn);
    }
  },200);
};


// ---------- V57.5 PDF A4 GLOBAL VIEWER ----------
function openPdfA4SubmenuV575({title='Documento PDF A4', subtitle='Documento generado por Marfan Crew Hours', body='', autoPrint=false} = {}){
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal" style="max-width:1080px">
        <div class="modal-head no-print">
          <div>
            <h2>${esc(title)}</h2>
            <p class="muted">${esc(subtitle)}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <div class="pdf-global-actions-v575 no-print">
          <button class="pdf-global-view-v575" onclick="document.getElementById('globalPdfPrintAreaV575').scrollIntoView({behavior:'smooth'})">Visualizar PDF A4</button>
          <button class="pdf-global-print-v575" onclick="window.print()">Imprimir PDF A4</button>
        </div>

        <div id="globalPdfPrintAreaV575" class="pdf-a4-wrapper-v575">
          <div class="pdf-a4-header-v575">
            <div>
              <div class="pdf-a4-brand-v575">MARFAN CREW</div>
              <div>${esc(subtitle)}</div>
            </div>
            <div>${new Date().toLocaleString('es-ES')}</div>
          </div>
          <div class="pdf-a4-content-v575">
            ${body}
          </div>
        </div>
      </div>
    </div>
  `;
  if(autoPrint) setTimeout(()=>window.print(),400);
}

// Compatibilidad: cualquier función vieja que llamara a printHtmlV57 ahora abre el submenú global.
function printHtmlV57(title, subtitle, body){
  openPdfA4SubmenuV575({title, subtitle, body});
}

// Compatibilidad con V57.3
function buildA4ModalV573(title, subtitle, body, autoPrint=false){
  openPdfA4SubmenuV575({title, subtitle, body, autoPrint});
}

async function globalOperatorPdfA4V575(userId){
  const data = await api('/api/users/'+userId+'/folder');
  const u = data.user;
  const docs = data.docs || [];
  openPdfA4SubmenuV575({
    title:'Carpeta documental operario',
    subtitle:'Base de datos documental del operario',
    body:`
      <h1>${esc((u.first_name||'')+' '+(u.last_name||''))} ${u.nickname?'· '+esc(u.nickname):''}</h1>
      <p>
        <b>DNI:</b> ${esc(u.dni||'—')}<br>
        <b>Teléfono:</b> ${esc(u.phone||'—')}<br>
        <b>Email:</b> ${esc(u.email||'—')}<br>
        <b>Rol:</b> ${esc(u.operator_role_name||u.services||'—')}
      </p>
      <h2>Documentos</h2>
      ${docs.map(d=>`
        <div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin:8px 0">
          <b>${esc(d.title||'Documento')}</b><br>
          Tipo: ${esc(d.doc_type||'')}<br>
          Validez: ${esc(d.expiry_date||'—')}<br>
          Estado: ${esc(d.computed_status||'')}<br>
          ${d.file_url ? `Archivo: ${esc(d.file_url)}` : ''}
        </div>
      `).join('') || '<p>Sin documentos.</p>'}
    `
  });
}

async function globalEventDeliveryPdfA4V575(eventId){
  const events = await api('/api/events').catch(()=>[]);
  const event = events.find(e=>Number(e.id)===Number(eventId)) || {};
  let assignments = [];
  try{ assignments = await api('/api/events/'+eventId+'/assignments-full'); }catch(e){}
  openPdfA4SubmenuV575({
    title:'Albarán de evento',
    subtitle:'Documento de servicio realizado',
    body:`
      <h1>${esc(event.name||'Evento')}</h1>
      <p>
        <b>Fecha:</b> ${esc(event.event_date||'')}<br>
        <b>Horario:</b> ${esc(event.start_time||'')} - ${esc(event.end_time||'')}<br>
        <b>Cliente:</b> ${esc(event.client||'')}<br>
        <b>Ubicación:</b> ${esc(event.location||event.address||'')}
      </p>
      <h2>Personal asignado</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Operario</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Rol</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Entrada</th>
          <th style="text-align:left;border-bottom:1px solid #111;padding:6px">Salida</th>
        </tr></thead>
        <tbody>
          ${assignments.map(a=>`
            <tr>
              <td style="border-bottom:1px solid #ddd;padding:6px">${esc((a.first_name||'')+' '+(a.last_name||''))}${a.nickname?' · '+esc(a.nickname):''}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.service_role||a.operator_role_name||'')}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.planned_start||'')}</td>
              <td style="border-bottom:1px solid #ddd;padding:6px">${esc(a.planned_end||'')}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" style="padding:6px">Sin operarios asignados.</td></tr>'}
        </tbody>
      </table>
      <h2>Notas</h2>
      <p>${esc(event.notes||event.production_notes||'')}</p>
    `
  });
}

async function globalFinancePdfA4V575(eventId){
  const events = await api('/api/events').catch(()=>[]);
  const event = events.find(e=>Number(e.id)===Number(eventId)) || {};
  let fin = {};
  try{ fin = await api('/api/finance/event/'+eventId); }catch(e){}
  openPdfA4SubmenuV575({
    title:'Finanzas Pro · Evento',
    subtitle:'Informe financiero interno A4',
    body:`
      <h1>${esc(event.name||'Evento')}</h1>
      <p>
        <b>Fecha:</b> ${esc(event.event_date||'')}<br>
        <b>Cliente:</b> ${esc(event.client||'')}<br>
        <b>Ubicación:</b> ${esc(event.location||event.address||'')}
      </p>
      <h2>Resumen financiero</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:7px;border-bottom:1px solid #ddd">Ingresos</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.revenue||event.total_amount||0).toFixed(2)} €</td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #ddd">Costes</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.totalCost||0).toFixed(2)} €</td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #ddd"><b>Beneficio</b></td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right"><b>${Number(fin.profit||0).toFixed(2)} €</b></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #ddd">Margen</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right">${Number(fin.margin||0).toFixed(2)} %</td></tr>
      </table>
    `
  });
}

function attachGlobalPdfButtonsV575(container, items){
  if(!container) return;
  let wrap = container.querySelector('.pdf-global-actions-v575.injected-v575');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.className = 'pdf-global-actions-v575 injected-v575';
    container.appendChild(wrap);
  }
  items.forEach(item=>{
    if(document.getElementById(item.id)) return;
    const btn = document.createElement('button');
    btn.id = item.id;
    btn.className = item.print ? 'pdf-global-print-v575' : 'pdf-global-view-v575';
    btn.innerText = item.label;
    btn.onclick = item.onclick;
    wrap.appendChild(btn);
  });
}

// Inyección global en carpetas de operario
const __openOperatorFolderV575 = typeof openOperatorFolderV555 === 'function' ? openOperatorFolderV555 : null;
if(__openOperatorFolderV575){
  openOperatorFolderV555 = async function(id){
    await __openOperatorFolderV575(id);
    setTimeout(()=>{
      const modal = document.querySelector('.modal');
      const head = modal ? (modal.querySelector('.modal-head') || modal) : null;
      attachGlobalPdfButtonsV575(head, [
        {id:'globalViewOperatorPdfV575', label:'Visualizar PDF A4', onclick:()=>globalOperatorPdfA4V575(id)},
        {id:'globalPrintOperatorPdfV575', label:'Imprimir PDF A4', print:true, onclick:async()=>{await globalOperatorPdfA4V575(id); setTimeout(()=>window.print(),400);}}
      ]);
    },350);
  };
}

// Inyección global en eventos/albaranes/finanzas
const __openEventDetailV575 = typeof openEventDetail === 'function' ? openEventDetail : null;
if(__openEventDetailV575){
  openEventDetail = async function(id){
    await __openEventDetailV575(id);
    setTimeout(()=>{
      const modal = document.querySelector('.modal');
      const box = modal ? (modal.querySelector('.actions') || modal.querySelector('.modal-head') || modal) : null;
      attachGlobalPdfButtonsV575(box, [
        {id:'globalViewDeliveryPdfV575', label:'Visualizar PDF A4 Albarán', onclick:()=>globalEventDeliveryPdfA4V575(id)},
        {id:'globalPrintDeliveryPdfV575', label:'Imprimir PDF A4 Albarán', print:true, onclick:async()=>{await globalEventDeliveryPdfA4V575(id); setTimeout(()=>window.print(),400);}},
        {id:'globalViewFinancePdfV575', label:'Visualizar PDF A4 Finanzas', onclick:()=>globalFinancePdfA4V575(id)},
        {id:'globalPrintFinancePdfV575', label:'Imprimir PDF A4 Finanzas', print:true, onclick:async()=>{await globalFinancePdfA4V575(id); setTimeout(()=>window.print(),400);}}
      ]);
    },350);
  };
}

// Utilidad global para otros menús futuros: cualquier módulo puede llamar a esto.
window.openPdfA4SubmenuV575 = openPdfA4SubmenuV575;


// ---------- V57.6 CALENDAR EVENT ACTIONS FRONTEND ----------
async function openCalendarEventActionsV576(id){
  const data = await api('/api/events/'+id+'/full-v576');
  const e = data.event || {};
  const assignments = data.assignments || [];

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-actions-modal-v576">
        <div class="modal-head">
          <div>
            <h2>${esc(e.name || 'Evento')}</h2>
            <p class="muted">${esc(e.event_date||'')} · ${esc(e.start_time||'')} - ${esc(e.end_time||'')}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <div class="event-actions-section-v576">
          <h3>Acciones del evento</h3>
          <div class="actions">
            <button class="event-edit-v576" onclick="editCalendarEventV576(${id})">Editar evento</button>
            <button class="event-delete-v576" onclick="deleteCalendarEventV576(${id}, '${esc((e.name||'Evento')).replace(/'/g, "\\'")}')">Borrar evento</button>
            <button class="secondary" onclick="globalEventDeliveryPdfA4V575 ? globalEventDeliveryPdfA4V575(${id}) : null">Visualizar PDF A4</button>
          </div>
        </div>

        <div class="event-actions-section-v576">
          <h3>Información</h3>
          <div class="event-actions-grid-v576">
            <p class="span-6"><b>Cliente</b><br>${esc(e.client||'—')}</p>
            <p class="span-6"><b>Ubicación</b><br>${esc(e.location||e.address||'—')}</p>
            <p class="span-3"><b>Estado</b><br>${esc(e.status||'—')}</p>
            <p class="span-3"><b>Producción</b><br>${esc(e.operational_status||'—')}</p>
            <p class="span-6"><b>Contacto</b><br>${esc(e.contact_name||'—')} · ${esc(e.contact_phone||'')}</p>
            <p class="span-12"><b>Notas</b><br>${esc(e.notes||e.production_notes||'—')}</p>
          </div>
        </div>

        <div class="event-actions-section-v576">
          <h3>Operarios asignados</h3>
          ${assignments.map(a=>`
            <div style="border-bottom:1px solid #e5e7eb;padding:8px 0">
              <b>${esc((a.first_name||'')+' '+(a.last_name||''))}${a.nickname?' · '+esc(a.nickname):''}</b><br>
              ${esc(a.service_role||'')} · ${esc(a.planned_start||'')} - ${esc(a.planned_end||'')}
            </div>
          `).join('') || '<p class="muted">Sin operarios asignados.</p>'}
        </div>
      </div>
    </div>
  `;
}

async function editCalendarEventV576(id){
  const data = await api('/api/events/'+id+'/full-v576');
  const e = data.event || {};

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-actions-modal-v576">
        <div class="modal-head">
          <h2>Editar evento</h2>
          <button class="secondary" onclick="openCalendarEventActionsV576(${id})">Volver</button>
        </div>

        <form id="editEventFormV576">
          <div class="event-actions-section-v576">
            <h3>Datos principales</h3>
            <div class="event-actions-grid-v576">
              <input class="field span-6" name="name" value="${esc(e.name||'')}" placeholder="Nombre evento">
              <input class="field span-3" name="event_date" type="date" value="${esc(e.event_date||'')}">
              <select class="field span-3" name="status">
                ${['programado','confirmado','pendiente','realizado','cancelado'].map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
              <input class="field span-3" name="start_time" type="time" value="${esc(e.start_time||'')}">
              <input class="field span-3" name="end_time" type="time" value="${esc(e.end_time||'')}">
              <input class="field span-6" name="client" value="${esc(e.client||'')}" placeholder="Cliente">
              <input class="field span-6" name="location" value="${esc(e.location||'')}" placeholder="Ubicación">
              <input class="field span-6" name="address" value="${esc(e.address||'')}" placeholder="Dirección">
              <input class="field span-4" name="contact_name" value="${esc(e.contact_name||'')}" placeholder="Contacto">
              <input class="field span-4" name="contact_phone" value="${esc(e.contact_phone||'')}" placeholder="Teléfono">
              <input class="field span-4" name="contact_email" value="${esc(e.contact_email||'')}" placeholder="Email">
              <textarea class="field span-12" name="notes" placeholder="Notas">${esc(e.notes||'')}</textarea>
            </div>
          </div>

          <div class="actions">
            <button class="event-edit-v576">Guardar cambios</button>
            <button type="button" class="secondary" onclick="openCalendarEventActionsV576(${id})">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#editEventFormV576').onsubmit = async ev => {
    ev.preventDefault();
    await api('/api/events/'+id+'/update-v576',{
      method:'PUT',
      body:JSON.stringify(Object.fromEntries(new FormData(ev.target)))
    });
    if(typeof v534Toast === 'function') v534Toast('Evento actualizado');
    await openCalendarEventActionsV576(id);
    setTimeout(()=>viewCalendar(),350);
  };
}

async function deleteCalendarEventV576(id, name='Evento'){
  const ok = confirm(`Vas a borrar definitivamente el evento:\n\n${name}\n\nEsta acción también eliminará sus asignaciones y enlaces internos. ¿Confirmas?`);
  if(!ok) return;

  await api('/api/events/'+id+'/delete-v576',{method:'DELETE'});
  if(typeof v534Toast === 'function') v534Toast('Evento borrado correctamente');
  closeWizard();
  await viewCalendar();
}

// Override del click del calendario para abrir subventana de acciones.
async function openEventDetail(id){
  return openCalendarEventActionsV576(id);
}


// ---------- V57.7 CALENDAR CLICK FIX ----------
function v577SafeEventId(id){
  return String(id || '').replace(/^g_/, '').replace(/[^0-9]/g,'');
}

// Convierte cualquier evento del calendario en clicable aunque el onclick anterior falle.
function bindCalendarEventClicksV577(){
  document.querySelectorAll('.v55-event').forEach(el=>{
    if(el.dataset.v577Bound === '1') return;

    let id = '';
    const onclick = el.getAttribute('onclick') || '';
    const m1 = onclick.match(/openEventDetail\((\d+)\)/);
    const m2 = onclick.match(/openCalendarEventActionsV576\((\d+)\)/);
    if(m1) id = m1[1];
    if(m2) id = m2[1];

    // Si no hay id en onclick, intenta leerlo desde atributos ya existentes.
    if(!id && el.dataset.eventId) id = el.dataset.eventId;

    if(id){
      el.dataset.eventId = id;
      el.classList.add('calendar-event-click-v577');
      el.removeAttribute('onclick');
      el.addEventListener('click', ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        openCalendarEventActionsV576(Number(id));
      });
      el.dataset.v577Bound = '1';
    }
  });
}

// Override final de render mensual/semana/día para que el evento salga con data-event-id directo.
function v577EventHtml(e){
  const id = v577SafeEventId(e.id);
  const cls = `v55-event calendar-event-click-v577 ${e.source==='google'?'google':'local'} ${e.status==='realizado'?'done':''} ${e.status==='cancelado'?'cancel':''}`;
  if(!id){
    return `<span class="${cls}" title="Evento Google no importado">${e.source==='google'?'🔵':'⚫'} ${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`;
  }
  return `<span class="${cls}" data-event-id="${id}" onclick="openCalendarEventActionsV576(${id})">${e.source==='google'?'🔵':'⚫'} ${esc(e.start_time||'')} ${esc(e.name||'Evento')}</span>`;
}

function v55RenderMonthAuto(events){
  const first = new Date(v55CalDate.getFullYear(), v55CalDate.getMonth(), 1);
  const start = v55StartOfWeek(first);
  const days = [];
  for(let i=0;i<42;i++) days.push(v55AddDays(start,i));

  return `<div class="v55-calendar-grid">
    ${days.map(day=>{
      const key = v55DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      const other = day.getMonth()!==v55CalDate.getMonth();
      return `<div class="v55-day-card ${other?'other':''}">
        <div class="v55-day-number">${day.getDate()}</div>
        ${evs.map(v577EventHtml).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function v55RenderWeekAuto(events){
  const start = v55StartOfWeek(v55CalDate);
  const days = [0,1,2,3,4,5,6].map(i=>v55AddDays(start,i));

  return `<div class="v55-week-grid">
    ${days.map(day=>{
      const key = v55DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      return `<div class="v55-day-card">
        <div class="v55-day-number">${day.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</div>
        ${evs.map(v577EventHtml).join('') || '<p class="muted">Sin eventos</p>'}
      </div>`;
    }).join('')}
  </div>`;
}

function v55RenderDayAuto(events){
  const key = v55DateKey(v55CalDate);
  const evs = events.filter(e=>e.event_date===key);

  return `<div class="v55-day-view">
    ${Array.from({length:24}).map((_,h)=>{
      const hh = String(h).padStart(2,'0');
      const hourEvents = evs.filter(e=>String(e.start_time||'').startsWith(hh+':'));
      return `<div class="v55-hour">
        <div class="v55-hour-time">${hh}:00</div>
        <div class="v55-hour-events">${hourEvents.map(v577EventHtml).join('')}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// Delegación global: aunque el HTML sea re-renderizado, el click funcionará.
if(!window.__v577CalendarDelegation){
  window.__v577CalendarDelegation = true;
  document.addEventListener('click', ev=>{
    const el = ev.target.closest && ev.target.closest('.calendar-event-click-v577, .v55-event[data-event-id]');
    if(!el) return;
    const id = v577SafeEventId(el.dataset.eventId);
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    openCalendarEventActionsV576(Number(id));
  }, true);
}

// Reenganchar después de cada viewCalendar.
const __viewCalendarV577 = typeof viewCalendar === 'function' ? viewCalendar : null;
if(__viewCalendarV577){
  viewCalendar = async function(){
    await __viewCalendarV577();
    setTimeout(bindCalendarEventClicksV577, 150);
    setTimeout(bindCalendarEventClicksV577, 600);
  };
}


// ---------- V57.8 CALENDAR CLICK HARD FIX ----------
function calV578DateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function calV578StartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setDate(x.getDate()-day);
  return x;
}
function calV578AddDays(d,n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function calV578EventHtml(e){
  const id = Number(e.id);
  if(!id) return '';
  const cls = `cal-event-v578 ${e.operational_status==='google_marfan'?'google':''} ${e.status==='realizado'?'done':''} ${e.status==='cancelado'?'cancel':''}`;
  return `<button type="button" class="${cls}" data-cal-event-id="${id}">
    ${esc(e.start_time||'')} ${esc(e.name||'Evento')}
  </button>`;
}
function calV578Title(){
  if(typeof v55CalendarTitle === 'function') return v55CalendarTitle();
  const d = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  return d.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
}
function calV578RenderMonth(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = calV578StartOfWeek(first);
  const days = [];
  for(let i=0;i<42;i++) days.push(calV578AddDays(start,i));

  return `<div class="v55-calendar-grid">
    ${days.map(day=>{
      const key = calV578DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      const other = day.getMonth()!==date.getMonth();
      return `<div class="v55-day-card ${other?'other':''}">
        <div class="v55-day-number">${day.getDate()}</div>
        ${evs.map(calV578EventHtml).join('')}
      </div>`;
    }).join('')}
  </div>`;
}
function calV578RenderWeek(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const start = calV578StartOfWeek(date);
  const days = [0,1,2,3,4,5,6].map(i=>calV578AddDays(start,i));
  return `<div class="v55-week-grid">
    ${days.map(day=>{
      const key = calV578DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      return `<div class="v55-day-card">
        <div class="v55-day-number">${day.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</div>
        ${evs.map(calV578EventHtml).join('') || '<p class="muted">Sin eventos</p>'}
      </div>`;
    }).join('')}
  </div>`;
}
function calV578RenderDay(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const key = calV578DateKey(date);
  const evs = events.filter(e=>e.event_date===key);
  return `<div class="v55-day-view">
    ${Array.from({length:24}).map((_,h)=>{
      const hh = String(h).padStart(2,'0');
      const hourEvents = evs.filter(e=>String(e.start_time||'').startsWith(hh+':'));
      return `<div class="v55-hour">
        <div class="v55-hour-time">${hh}:00</div>
        <div class="v55-hour-events">${hourEvents.map(calV578EventHtml).join('')}</div>
      </div>`;
    }).join('')}
  </div>`;
}

if(!window.__calV578ClickInstalled){
  window.__calV578ClickInstalled = true;
  document.addEventListener('click', function(ev){
    const btn = ev.target.closest && ev.target.closest('[data-cal-event-id]');
    if(!btn) return;
    const id = Number(btn.dataset.calEventId);
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if(typeof openCalendarEventActionsV576 === 'function'){
      openCalendarEventActionsV576(id);
    }else if(typeof openEventDetail === 'function'){
      openEventDetail(id);
    }else{
      alert('Evento ID: '+id);
    }
  }, true);
}

async function viewCalendar(){
  const events = await api('/api/events').catch(()=>[]);
  const googleStatus = await api('/api/google/status-v557').catch(()=>({connected:false}));

  const view = (typeof v55CalView !== 'undefined' && v55CalView) ? v55CalView : 'month';
  const body = view === 'week' ? calV578RenderWeek(events) : view === 'day' ? calV578RenderDay(events) : calV578RenderMonth(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">V57.8: los eventos son botones reales. Pulsa cualquier evento para editarlo o borrarlo.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>'}
          <button class="force-sync-v574" onclick="forceGoogleSyncNoPatternV574()">FORZAR SINCRONIZACIÓN GOOGLE</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">Eventos cargados: ${events.length}. Click activo V57.8.</div>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${calV578Title()}</h2>
        <div class="v55-view-tabs">
          <button class="${view==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${view==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${view==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;
}


// ---------- V57.9 CALENDAR CLICK FINAL FIX ----------
window.__calendarEventsCacheV579 = [];

async function getEventsCacheV579(){
  try{
    const events = await api('/api/events');
    window.__calendarEventsCacheV579 = Array.isArray(events) ? events : [];
    return window.__calendarEventsCacheV579;
  }catch(e){
    return window.__calendarEventsCacheV579 || [];
  }
}

function normalizeTextV579(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}

function findEventIdFromElementV579(el){
  if(!el) return null;

  const attrs = [
    el.dataset?.calEventId,
    el.dataset?.eventId,
    el.getAttribute?.('data-cal-event-id'),
    el.getAttribute?.('data-event-id')
  ].filter(Boolean);

  for(const a of attrs){
    const id = Number(String(a).replace(/^g_/,'').replace(/[^0-9]/g,''));
    if(id) return id;
  }

  const onclick = el.getAttribute?.('onclick') || '';
  const m = onclick.match(/(?:openEventDetail|openCalendarEventActionsV576)\((\d+)\)/);
  if(m) return Number(m[1]);

  const text = normalizeTextV579(el.innerText || el.textContent || '');
  if(text){
    const found = (window.__calendarEventsCacheV579||[]).find(e=>{
      const name = normalizeTextV579(e.name || '');
      const time = normalizeTextV579(e.start_time || '');
      return name && text.includes(name) || (name && time && text.includes(time) && text.includes(name.slice(0, Math.min(8,name.length))));
    });
    if(found) return Number(found.id);
  }

  return null;
}

async function openCalendarEventFinalV579(id){
  id = Number(id);
  if(!id){
    alert('No puedo identificar el ID del evento. Actualiza la vista y prueba otra vez.');
    return;
  }
  if(typeof openCalendarEventActionsV576 === 'function'){
    return openCalendarEventActionsV576(id);
  }
  if(typeof openEventDetail === 'function'){
    return openEventDetail(id);
  }
  alert('Evento ID: '+id);
}

function bindEveryCalendarEventV579(){
  const selectors = [
    '[data-cal-event-id]',
    '[data-event-id]',
    '.cal-event-v578',
    '.v55-event',
    '.calendar-event-click-v577'
  ].join(',');

  document.querySelectorAll(selectors).forEach(el=>{
    if(el.dataset.v579Bound === '1') return;

    const id = findEventIdFromElementV579(el);
    if(id){
      el.dataset.calEventId = String(id);
      el.classList.add('cal-clickable-v579');
      el.removeAttribute('onclick');
      el.addEventListener('click', ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        openCalendarEventFinalV579(id);
      }, true);
      el.dataset.v579Bound = '1';
    }
  });
}

// Captura total: aunque otro listener lo bloquee, este va primero.
if(!window.__v579CaptureInstalled){
  window.__v579CaptureInstalled = true;
  document.addEventListener('pointerdown', function(ev){
    const el = ev.target.closest && ev.target.closest('[data-cal-event-id],[data-event-id],.cal-event-v578,.v55-event,.calendar-event-click-v577');
    if(!el) return;
    const id = findEventIdFromElementV579(el);
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    openCalendarEventFinalV579(id);
  }, true);

  document.addEventListener('click', function(ev){
    const el = ev.target.closest && ev.target.closest('[data-cal-event-id],[data-event-id],.cal-event-v578,.v55-event,.calendar-event-click-v577');
    if(!el) return;
    const id = findEventIdFromElementV579(el);
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    openCalendarEventFinalV579(id);
  }, true);
}

// Mutation observer: cuando se repinta el calendario, reengancha eventos.
if(!window.__v579ObserverInstalled){
  window.__v579ObserverInstalled = true;
  const obs = new MutationObserver(()=>{
    bindEveryCalendarEventV579();
  });
  obs.observe(document.body, {childList:true, subtree:true});
}

// Render nuevo real, y además fuerza cache de eventos.
async function viewCalendarV579Final(){
  const events = await getEventsCacheV579();
  const googleStatus = await api('/api/google/status-v557').catch(()=>({connected:false}));

  const view = (typeof v55CalView !== 'undefined' && v55CalView) ? v55CalView : 'month';
  const body = view === 'week'
    ? calV578RenderWeek(events)
    : view === 'day'
      ? calV578RenderDay(events)
      : calV578RenderMonth(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">V57.9: click final activo. Pulsa directamente sobre el evento para editar/borrar.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>'}
          <button class="force-sync-v574" onclick="forceGoogleSyncNoPatternV574()">FORZAR SINCRONIZACIÓN GOOGLE</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">Eventos cargados: ${events.length}. Click final V57.9 activo.</div>
    </div>

    <div class="card" id="calendarCardV579">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <h2 style="text-transform:capitalize">${calV578Title()}</h2>
        <div class="v55-view-tabs">
          <button class="${view==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${view==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${view==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>
  `;

  setTimeout(bindEveryCalendarEventV579, 50);
  setTimeout(bindEveryCalendarEventV579, 300);
}

// Sobrescribe función global y también posibles mapas de rutas.
viewCalendar = viewCalendarV579Final;

try{
  if(typeof routes !== 'undefined' && routes){
    routes.calendario = viewCalendarV579Final;
    routes.calendar = viewCalendarV579Final;
    routes.eventos = viewCalendarV579Final;
  }
}catch(e){}

try{
  if(typeof views !== 'undefined' && views){
    views.calendario = viewCalendarV579Final;
    views.calendar = viewCalendarV579Final;
    views.eventos = viewCalendarV579Final;
  }
}catch(e){}

// Parchea v55SetView para que siempre llame a la vista final.
if(typeof v55SetView === 'function' && !window.__v579SetViewPatched){
  window.__v579SetViewPatched = true;
  const oldSetView = v55SetView;
  v55SetView = function(v){
    try{ oldSetView(v); }catch(e){ if(typeof v55CalView !== 'undefined') v55CalView = v; }
    setTimeout(viewCalendarV579Final, 50);
  };
}

// Primera activación cuando ya esté la app cargada.
setTimeout(async ()=>{
  await getEventsCacheV579();
  bindEveryCalendarEventV579();
}, 800);


// ---------- V58 CALENDAR EVENT EDIT DELETE DIRECT FRONTEND ----------
async function openCalendarEventV58(id){
  const data = await api('/api/events/'+id+'/detail-v58');
  const e = data.event || {};
  const assignments = data.assignments || [];

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-v58-modal">
        <div class="modal-head">
          <div>
            <h2>${esc(e.name||'Evento')}</h2>
            <p class="muted">${esc(e.event_date||'')} · ${esc(e.start_time||'')} - ${esc(e.end_time||'')}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <div class="event-v58-section">
          <h3>¿Qué quieres hacer?</h3>
          <div class="event-v58-actions">
            <button class="event-v58-edit" onclick="editCalendarEventV58(${id})">Editar evento</button>
            <button class="event-v58-delete" onclick="deleteCalendarEventV58(${id}, '${esc((e.name||'Evento')).replace(/'/g, "\\'")}')">Borrar evento</button>
            <button class="secondary" onclick="closeWizard()">Cancelar</button>
          </div>
        </div>

        <div class="event-v58-section">
          <h3>Información del evento</h3>
          <div class="event-v58-grid">
            <p class="span-6"><b>Cliente</b><br>${esc(e.client||'—')}</p>
            <p class="span-6"><b>Ubicación</b><br>${esc(e.location||e.address||'—')}</p>
            <p class="span-3"><b>Estado</b><br>${esc(e.status||'—')}</p>
            <p class="span-3"><b>Producción</b><br>${esc(e.operational_status||'—')}</p>
            <p class="span-6"><b>Contacto</b><br>${esc(e.contact_name||'—')} · ${esc(e.contact_phone||'')}</p>
            <p class="span-12"><b>Notas</b><br>${esc(e.notes||e.production_notes||'—')}</p>
          </div>
        </div>

        <div class="event-v58-section">
          <h3>Operarios asignados</h3>
          ${assignments.map(a=>`
            <div style="border-bottom:1px solid #e5e7eb;padding:8px 0">
              <b>${esc((a.first_name||'')+' '+(a.last_name||''))}${a.nickname?' · '+esc(a.nickname):''}</b><br>
              ${esc(a.service_role||'')} · ${esc(a.planned_start||'')} - ${esc(a.planned_end||'')}
            </div>
          `).join('') || '<p class="muted">Sin operarios asignados.</p>'}
        </div>
      </div>
    </div>
  `;
}

async function editCalendarEventV58(id){
  const data = await api('/api/events/'+id+'/detail-v58');
  const e = data.event || {};

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-v58-modal">
        <div class="modal-head">
          <h2>Editar evento</h2>
          <button class="secondary" onclick="openCalendarEventV58(${id})">Volver</button>
        </div>

        <form id="editEventFormV58">
          <div class="event-v58-section">
            <div class="event-v58-grid">
              <input class="field span-6" name="name" value="${esc(e.name||'')}" placeholder="Nombre">
              <input class="field span-3" name="event_date" type="date" value="${esc(e.event_date||'')}">
              <select class="field span-3" name="status">
                ${['programado','confirmado','pendiente','realizado','cancelado'].map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
              <input class="field span-3" name="start_time" type="time" value="${esc(e.start_time||'')}">
              <input class="field span-3" name="end_time" type="time" value="${esc(e.end_time||'')}">
              <input class="field span-6" name="client" value="${esc(e.client||'')}" placeholder="Cliente">
              <input class="field span-6" name="location" value="${esc(e.location||'')}" placeholder="Ubicación">
              <input class="field span-6" name="address" value="${esc(e.address||'')}" placeholder="Dirección">
              <input class="field span-4" name="contact_name" value="${esc(e.contact_name||'')}" placeholder="Contacto">
              <input class="field span-4" name="contact_phone" value="${esc(e.contact_phone||'')}" placeholder="Teléfono">
              <input class="field span-4" name="contact_email" value="${esc(e.contact_email||'')}" placeholder="Email">
              <textarea class="field span-12" name="notes" placeholder="Notas">${esc(e.notes||'')}</textarea>
            </div>
          </div>
          <div class="event-v58-actions">
            <button class="event-v58-edit">Guardar cambios</button>
            <button type="button" class="secondary" onclick="openCalendarEventV58(${id})">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#editEventFormV58').onsubmit = async ev=>{
    ev.preventDefault();
    await api('/api/events/'+id+'/save-v58',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(ev.target)))});
    if(typeof v534Toast==='function') v534Toast('Evento actualizado');
    closeWizard();
    await viewCalendar();
  };
}

async function deleteCalendarEventV58(id, name='Evento'){
  if(!confirm(`¿Seguro que quieres borrar este evento?\n\n${name}\n\nEsta acción no se puede deshacer.`)) return;
  await api('/api/events/'+id+'/remove-v58',{method:'DELETE'});
  if(typeof v534Toast==='function') v534Toast('Evento borrado');
  closeWizard();
  await viewCalendar();
}

// Forzar todas las funciones antiguas hacia V58.
openEventDetail = async function(id){ return openCalendarEventV58(id); };
openCalendarEventActionsV576 = async function(id){ return openCalendarEventV58(id); };
openCalendarEventFinalV579 = async function(id){ return openCalendarEventV58(id); };

// Reforzar listener directo.
if(!window.__v58EventClickInstalled){
  window.__v58EventClickInstalled = true;
  document.addEventListener('click', ev=>{
    const el = ev.target.closest && ev.target.closest('[data-cal-event-id],[data-event-id],.cal-event-v578,.v55-event,.calendar-event-click-v577');
    if(!el) return;
    const raw = el.dataset.calEventId || el.dataset.eventId || '';
    const id = Number(String(raw).replace(/[^0-9]/g,''));
    if(!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    openCalendarEventV58(id);
  }, true);
}


// ---------- V58.1 CALENDAR VISIBLE EDIT DELETE ACTIONS ----------
function v581DateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function v581StartOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setDate(x.getDate()-day);
  return x;
}
function v581AddDays(d,n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function v581EventCard(e){
  const id = Number(e.id);
  if(!id) return '';
  const cls = `cal-card-v581 ${e.operational_status==='google_marfan'?'google':''}`;
  return `
    <div class="${cls}">
      <div class="cal-title-v581">${esc(e.start_time||'')} ${esc(e.name||'Evento')}</div>
      <div class="cal-actions-v581">
        <button type="button" class="cal-edit-v581" onclick="event.stopPropagation(); editCalendarEventV58(${id})">Editar</button>
        <button type="button" class="cal-delete-v581" onclick="event.stopPropagation(); deleteCalendarEventV58(${id}, '${esc((e.name||'Evento')).replace(/'/g, "\\'")}')">Borrar</button>
      </div>
    </div>`;
}
function v581RenderMonth(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = v581StartOfWeek(first);
  const days = [];
  for(let i=0;i<42;i++) days.push(v581AddDays(start,i));
  return `<div class="v55-calendar-grid">
    ${days.map(day=>{
      const key = v581DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      const other = day.getMonth()!==date.getMonth();
      return `<div class="v55-day-card ${other?'other':''}">
        <div class="v55-day-number">${day.getDate()}</div>
        ${evs.map(v581EventCard).join('')}
      </div>`;
    }).join('')}
  </div>`;
}
function v581RenderWeek(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const start = v581StartOfWeek(date);
  const days = [0,1,2,3,4,5,6].map(i=>v581AddDays(start,i));
  return `<div class="v55-week-grid">
    ${days.map(day=>{
      const key = v581DateKey(day);
      const evs = events.filter(e=>e.event_date===key);
      return `<div class="v55-day-card">
        <div class="v55-day-number">${day.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'})}</div>
        ${evs.map(v581EventCard).join('') || '<p class="muted">Sin eventos</p>'}
      </div>`;
    }).join('')}
  </div>`;
}
function v581RenderDay(events){
  const date = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const key = v581DateKey(date);
  const evs = events.filter(e=>e.event_date===key);
  return `<div class="v55-day-view">
    ${Array.from({length:24}).map((_,h)=>{
      const hh = String(h).padStart(2,'0');
      const hourEvents = evs.filter(e=>String(e.start_time||'').startsWith(hh+':'));
      return `<div class="v55-hour">
        <div class="v55-hour-time">${hh}:00</div>
        <div class="v55-hour-events">${hourEvents.map(v581EventCard).join('')}</div>
      </div>`;
    }).join('')}
  </div>`;
}
function v581Title(){
  if(typeof v55CalendarTitle === 'function') return v55CalendarTitle();
  const d = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  return d.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
}
function v581EventsList(events){
  const sorted = [...events].sort((a,b)=>String(a.event_date||'').localeCompare(String(b.event_date||'')) || String(a.start_time||'').localeCompare(String(b.start_time||'')));
  return `
    <div class="card">
      <h3>Acciones rápidas de eventos</h3>
      <p class="muted">Si el click del calendario falla, usa estos botones directos.</p>
      <div class="event-list-v581">
        ${sorted.map(e=>`
          <div class="event-list-row-v581">
            <div><b>${esc(e.event_date||'')}</b><br>${esc(e.start_time||'')} - ${esc(e.end_time||'')}</div>
            <div><b>${esc(e.name||'Evento')}</b><br><span class="muted">${esc(e.client||'')} · ${esc(e.location||'')}</span></div>
            <div>${e.operational_status==='google_marfan' ? '<span class="status-badge status-ok">Google</span>' : '<span class="status-badge">Local</span>'}</div>
            <div class="cal-actions-v581">
              <button class="cal-edit-v581" onclick="editCalendarEventV58(${Number(e.id)})">Editar</button>
              <button class="cal-delete-v581" onclick="deleteCalendarEventV58(${Number(e.id)}, '${esc((e.name||'Evento')).replace(/'/g, "\\'")}')">Borrar</button>
            </div>
          </div>
        `).join('') || '<p class="muted">No hay eventos.</p>'}
      </div>
    </div>`;
}

async function viewCalendar(){
  const events = await api('/api/events').catch(()=>[]);
  const googleStatus = await api('/api/google/status-v557').catch(()=>({connected:false}));
  const view = (typeof v55CalView !== 'undefined' && v55CalView) ? v55CalView : 'month';

  const body = view === 'week' ? v581RenderWeek(events) : view === 'day' ? v581RenderDay(events) : v581RenderMonth(events);

  $('#content').innerHTML = `
    <div class="card">
      <div class="v55-calendar-toolbar">
        <div>
          <h3>Calendario eventos · MARFAN</h3>
          <p class="v52-sub">V58.1: cada evento tiene botones visibles Editar/Borrar.</p>
        </div>
        <div class="v55-google-panel">
          ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span><button onclick="v559OpenGooglePopup()">Conectar Google</button>'}
          <button class="force-sync-v574" onclick="forceGoogleSyncNoPatternV574()">FORZAR SINCRONIZACIÓN GOOGLE</button>
          <button class="secondary" onclick="viewCalendar()">Actualizar vista</button>
        </div>
      </div>
      <div class="google-sync-debug-v561 ok">Eventos cargados: ${events.length}. Acciones visibles V58.1.</div>
    </div>

    <div class="card">
      <div class="v55-calendar-toolbar">
        <div class="actions">
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="secondary" onclick="v55MoveCalendar(-1)">← Anterior</button>
          <button onclick="v55CalDate=new Date();viewCalendar()">Hoy</button>
          <button class="secondary" onclick="v55MoveCalendar(1)">Siguiente →</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 style="text-transform:capitalize;margin:0">${v581Title()}</h2>
          <input type="month" id="calendarMonthPickerV6244" class="field" style="max-width:180px;font-weight:900"
            value="${v55CalDate.getFullYear()}-${String(v55CalDate.getMonth()+1).padStart(2,'0')}"
            onchange="if(this.value){v55CalDate=new Date(Number(this.value.slice(0,4)), Number(this.value.slice(5,7))-1, 1); viewCalendar();}">
        </div>
        <div class="v55-view-tabs">
          <button class="${view==='month'?'active':''}" onclick="v55SetView('month')">Mes</button>
          <button class="${view==='week'?'active':''}" onclick="v55SetView('week')">Semana</button>
          <button class="${view==='day'?'active':''}" onclick="v55SetView('day')">Día</button>
        </div>
      </div>
      <br>
      ${body}
    </div>

    ${v581EventsList(events)}
  `;
}

if(typeof v55SetView === 'function' && !window.__v581SetViewPatched){
  window.__v581SetViewPatched = true;
  const old = v55SetView;
  v55SetView = function(v){
    try{ old(v); }catch(e){ if(typeof v55CalView !== 'undefined') v55CalView = v; }
    setTimeout(viewCalendar, 50);
  };
}


// ---------- V58.2 CALENDAR OVERRIDE REAL ----------
window.__MARFAN_V582_LOADED = true;

async function apiV582(url, opts={}){
  if(typeof api === 'function') return api(url, opts);
  const headers = {'Content-Type':'application/json'};
  if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer '+token;
  const r = await fetch(url, {...opts, headers:{...headers, ...(opts.headers||{})}});
  const t = await r.text();
  let j = {};
  try{ j = t ? JSON.parse(t) : {}; }catch(e){ j = {error:t}; }
  if(!r.ok) throw new Error(j.error || t || 'HTTP '+r.status);
  return j;
}

function escV582(s){
  if(typeof esc === 'function') return esc(s);
  return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function dateKeyV582(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function startWeekV582(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7;
  x.setDate(x.getDate()-day);
  return x;
}
function addDaysV582(d,n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

async function editEventV582(id){
  if(typeof editCalendarEventV58 === 'function') return editCalendarEventV58(id);
  alert('Editar evento '+id);
}
async function deleteEventV582(id, name){
  if(typeof deleteCalendarEventV58 === 'function') return deleteCalendarEventV58(id, name);
  if(!confirm('¿Borrar evento? '+name)) return;
  await apiV582('/api/events/'+id+'/remove-v58',{method:'DELETE'});
  await showCalendarV582();
}

async function openEventV582(id){
  if(typeof openCalendarEventV58 === 'function') return openCalendarEventV58(id);
  if(typeof openCalendarEventActionsV576 === 'function') return openCalendarEventActionsV576(id);
  return editEventV582(id);
}

function eventPillV582(e){
  const id = Number(e.id);
  if(!id) return '';
  const google = e.operational_status === 'google_marfan';
  return `<button class="v582-event-pill ${google?'google':''}" data-v582-event="${id}" type="button">
    ${escV582(e.start_time||'')} ${escV582(e.name||'Evento')}
  </button>
  <div class="v582-event-actions">
    <button class="v582-edit" type="button" onclick="editEventV582(${id})">Editar</button>
    <button class="v582-delete" type="button" onclick="deleteEventV582(${id}, '${escV582((e.name||'Evento')).replace(/'/g,"\\'")}')">Borrar</button>
  </div>`;
}

function renderMonthV582(events){
  const calDate = (typeof v55CalDate !== 'undefined' && v55CalDate) ? v55CalDate : new Date();
  const first = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const start = startWeekV582(first);
  const days = Array.from({length:42}, (_,i)=>addDaysV582(start,i));
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">
    ${days.map(day=>{
      const key = dateKeyV582(day);
      const evs = events.filter(e=>e.event_date===key);
      return `<div class="v582-day">
        <b>${day.getDate()}</b>
        ${evs.map(eventPillV582).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function renderEventRowsV582(events){
  const sorted = [...events].sort((a,b)=>String(a.event_date||'').localeCompare(String(b.event_date||'')) || String(a.start_time||'').localeCompare(String(b.start_time||'')));
  return `<div class="card">
    <h3>Eventos · acciones directas</h3>
    ${sorted.map(e=>`
      <div class="v582-event-row">
        <div><b>${escV582(e.event_date||'')}</b><br>${escV582(e.start_time||'')} - ${escV582(e.end_time||'')}</div>
        <div><b>${escV582(e.name||'Evento')}</b><br><span class="muted">${escV582(e.client||'')} · ${escV582(e.location||'')}</span></div>
        <div>${e.operational_status==='google_marfan' ? '<span class="status-badge status-ok">Google</span>' : '<span class="status-badge">Local</span>'}</div>
        <div class="v582-event-actions">
          <button class="v582-edit" onclick="editEventV582(${Number(e.id)})">Editar</button>
          <button class="v582-delete" onclick="deleteEventV582(${Number(e.id)}, '${escV582((e.name||'Evento')).replace(/'/g,"\\'")}')">Borrar</button>
        </div>
      </div>
    `).join('') || '<p class="muted">No hay eventos.</p>'}
  </div>`;
}

async function showCalendarV582(){
  const events = await apiV582('/api/events').catch(()=>[]);
  const googleStatus = await apiV582('/api/google/status-v557').catch(()=>({connected:false}));
  const content = document.getElementById('content') || document.querySelector('#main') || document.body;

  content.innerHTML = `
    <div class="v582-calendar-force-banner">
      <div>
        <h2 style="margin:0">Calendario eventos · V58.2</h2>
        <div>Vista forzada real con botones Editar/Borrar visibles.</div>
      </div>
      <div class="v582-event-actions">
        <button onclick="showCalendarV582()">Actualizar calendario</button>
        <button onclick="openCreateEventV559()">+ Crear evento</button>
        ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span>'}
      </div>
    </div>

    <div class="card v582-calendar-card">
      <h3>Vista mensual</h3>
      ${renderMonthV582(events)}
    </div>

    ${renderEventRowsV582(events)}
  `;

  document.querySelectorAll('[data-v582-event]').forEach(btn=>{
    btn.addEventListener('click', ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openEventV582(Number(btn.dataset.v582Event));
    });
  });
}

// Alias por todos los nombres posibles.
window.viewCalendar = showCalendarV582;
window.viewCalendarV579Final = showCalendarV582;
window.viewCalendarV582Final = showCalendarV582;

try{
  if(typeof routes !== 'undefined' && routes){
    routes.calendario = showCalendarV582;
    routes.calendar = showCalendarV582;
    routes.eventos = showCalendarV582;
  }
}catch(e){}
try{
  if(typeof views !== 'undefined' && views){
    views.calendario = showCalendarV582;
    views.calendar = showCalendarV582;
    views.eventos = showCalendarV582;
  }
}catch(e){}

// Intercepta clics del menú que digan calendario/eventos.
if(!window.__v582MenuInterceptor){
  window.__v582MenuInterceptor = true;
  document.addEventListener('click', ev=>{
    const el = ev.target.closest && ev.target.closest('button,a,[data-view],[data-section],[onclick]');
    if(!el) return;
    const txt = (el.textContent || '').toLowerCase();
    const attrs = [el.getAttribute('data-view'), el.getAttribute('data-section'), el.getAttribute('onclick'), el.getAttribute('href')].join(' ').toLowerCase();
    if(txt.includes('calendario') || attrs.includes('calendario') || attrs.includes('calendar')){
      ev.preventDefault();
      ev.stopPropagation();
      setTimeout(showCalendarV582, 10);
    }
  }, true);
}

// Si ya estamos en calendario viejo, añade botón de forzado arriba.
setInterval(()=>{
  const content = document.getElementById('content');
  if(!content) return;
  const txt = (content.textContent||'').toLowerCase();
  if(txt.includes('calendario eventos') && !document.getElementById('forceCalendarV582')){
    const btn = document.createElement('button');
    btn.id = 'forceCalendarV582';
    btn.className = 'v582-edit';
    btn.textContent = 'ABRIR CALENDARIO V58.2 CON EDITAR/BORRAR';
    btn.onclick = showCalendarV582;
    content.prepend(btn);
  }
}, 1000);

console.log('V58.2 Calendar Override Real loaded');


// ---------- V58.3 CALENDAR SYNC RESTORED + EDIT FIX FRONTEND ----------
async function forceGoogleSyncV583(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back"><div class="modal">
      <div class="modal-head"><h2>Sincronización Google MARFAN</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
      <div class="v583-sync">Sincronizando con Google Calendar...</div>
    </div></div>`;

  try{
    const r = await api('/api/google/sync-calendar-v583',{method:'POST'});
    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Sincronización completada ✅</h2><button class="secondary" onclick="closeWizard();showCalendarV582()">Cerrar</button></div>
        <div class="v583-sync ok">
          <b>Calendario:</b> ${escV582((r.calendar||{}).summary||'MARFAN')}<br>
          <b>Eventos leídos:</b> ${r.read}<br>
          <b>Creados:</b> ${r.created}<br>
          <b>Actualizados:</b> ${r.updated}<br>
          <b>Errores:</b> ${r.errors}
        </div>
        ${r.errors ? `<div class="v583-sync bad"><pre>${escV582(JSON.stringify((r.results||[]).filter(x=>x.action==='error'),null,2))}</pre></div>` : ''}
      </div></div>`;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back"><div class="modal">
        <div class="modal-head"><h2>Error sincronizando</h2><button class="secondary" onclick="closeWizard()">Cerrar</button></div>
        <div class="v583-sync bad">${escV582(e.message)}</div>
      </div></div>`;
  }
}

async function editEventV582(id){
  const data = await api('/api/events/'+id+'/detail-v583');
  const e = data.event || {};

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-v58-modal">
        <div class="modal-head">
          <h2>Editar evento</h2>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="editEventFormV583">
          <div class="event-v58-section">
            <div class="event-v58-grid">
              <input class="field span-6" name="name" value="${escV582(e.name||'')}" placeholder="Nombre evento">
              <input class="field span-3" name="event_date" type="date" value="${escV582(e.event_date||'')}">
              <select class="field span-3" name="status">
                ${['programado','confirmado','pendiente','realizado','cancelado'].map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
              <input class="field span-3" name="start_time" type="time" value="${escV582(e.start_time||'')}">
              <input class="field span-3" name="end_time" type="time" value="${escV582(e.end_time||'')}">
              <input class="field span-6" name="client" value="${escV582(e.client||'')}" placeholder="Cliente">
              <input class="field span-6" name="location" value="${escV582(e.location||'')}" placeholder="Ubicación">
              <input class="field span-6" name="address" value="${escV582(e.address||'')}" placeholder="Dirección">
              <input class="field span-4" name="contact_name" value="${escV582(e.contact_name||'')}" placeholder="Contacto">
              <input class="field span-4" name="contact_phone" value="${escV582(e.contact_phone||'')}" placeholder="Teléfono">
              <input class="field span-4" name="contact_email" value="${escV582(e.contact_email||'')}" placeholder="Email">
              <input class="field span-3" name="load_in_time" type="time" value="${escV582(e.load_in_time||'')}">
              <input class="field span-3" name="load_out_time" type="time" value="${escV582(e.load_out_time||'')}">
              <input class="field span-6" name="service_type" value="${escV582(e.service_type||'')}" placeholder="Tipo de servicio">
              <textarea class="field span-12" name="notes" placeholder="Notas">${escV582(e.notes||'')}</textarea>
            </div>
          </div>

          <div class="event-v58-actions">
            <button class="v583-edit">Guardar cambios</button>
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
          </div>
        </form>
      </div>
    </div>`;

  $('#editEventFormV583').onsubmit = async ev=>{
    ev.preventDefault();
    await api('/api/events/'+id+'/save-v583',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(ev.target)))});
    if(typeof v534Toast==='function') v534Toast('Evento editado correctamente');
    closeWizard();
    await showCalendarV582();
  };
}

async function deleteEventV582(id, name){
  if(!confirm(`¿Seguro que quieres borrar este evento?\n\n${name}\n\nEsta acción no se puede deshacer.`)) return;
  await api('/api/events/'+id+'/remove-v583',{method:'DELETE'});
  if(typeof v534Toast==='function') v534Toast('Evento borrado');
  closeWizard();
  await showCalendarV582();
}

async function openEventV582(id){
  const data = await api('/api/events/'+id+'/detail-v583');
  const e = data.event || {};
  const assignments = data.assignments || [];
  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-v58-modal">
        <div class="modal-head">
          <div><h2>${escV582(e.name||'Evento')}</h2><p class="muted">${escV582(e.event_date||'')} · ${escV582(e.start_time||'')} - ${escV582(e.end_time||'')}</p></div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <div class="event-v58-section">
          <h3>Acciones</h3>
          <div class="v582-event-actions">
            <button class="v583-edit" onclick="editEventV582(${id})">Editar evento</button>
            <button class="v583-delete" onclick="deleteEventV582(${id}, '${escV582((e.name||'Evento')).replace(/'/g,"\\'")}')">Borrar evento</button>
          </div>
        </div>
        <div class="event-v58-section">
          <h3>Información</h3>
          <p><b>Cliente:</b> ${escV582(e.client||'—')}</p>
          <p><b>Ubicación:</b> ${escV582(e.location||e.address||'—')}</p>
          <p><b>Estado:</b> ${escV582(e.status||'—')}</p>
          <p><b>Notas:</b> ${escV582(e.notes||'—')}</p>
        </div>
        <div class="event-v58-section">
          <h3>Operarios</h3>
          ${assignments.map(a=>`<div style="border-bottom:1px solid #e5e7eb;padding:8px 0"><b>${escV582((a.first_name||'')+' '+(a.last_name||''))}${a.nickname?' · '+escV582(a.nickname):''}</b><br>${escV582(a.service_role||'')} · ${escV582(a.planned_start||'')} - ${escV582(a.planned_end||'')}</div>`).join('') || '<p class="muted">Sin operarios asignados.</p>'}
        </div>
      </div>
    </div>`;
}

// Reescribe la vista V58.2 para recuperar botón sync y usar edit corregido.
const __oldShowCalendarV582 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
showCalendarV582 = async function(){
  const events = await apiV582('/api/events').catch(()=>[]);
  const googleStatus = await apiV582('/api/google/status-v557').catch(()=>({connected:false}));
  const content = document.getElementById('content') || document.querySelector('#main') || document.body;

  content.innerHTML = `
    <div class="v582-calendar-force-banner">
      <div>
        <h2 style="margin:0">Calendario eventos · V58.3</h2>
        <div>Vista con Google Sync restaurado y edición corregida.</div>
      </div>
      <div class="v582-event-actions">
        <button onclick="showCalendarV582()">Actualizar calendario</button>
        <button onclick="openCreateEventV559()">+ Crear evento</button>
        <button class="v583-sync-btn" onclick="forceGoogleSyncV583()">FORZAR SINCRONIZACIÓN GOOGLE</button>
        ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span>'}
      </div>
    </div>

    <div class="card v582-calendar-card">
      <h3>Vista mensual</h3>
      ${renderMonthV582(events)}
    </div>

    ${renderEventRowsV582(events)}
  `;

  document.querySelectorAll('[data-v582-event]').forEach(btn=>{
    btn.addEventListener('click', ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openEventV582(Number(btn.dataset.v582Event));
    });
  });
};

window.viewCalendar = showCalendarV582;


// ---------- V58.4 CALENDAR MENU ACTIVE STATE ----------
function setCalendarMenuActiveV584(){
  const candidates = document.querySelectorAll('button,a,[data-view],[data-section],[onclick]');
  candidates.forEach(el=>{
    const txt = (el.textContent || '').toLowerCase();
    const attrs = [
      el.getAttribute('data-view'),
      el.getAttribute('data-section'),
      el.getAttribute('onclick'),
      el.getAttribute('href'),
      el.id,
      el.className
    ].join(' ').toLowerCase();

    const isCalendar = txt.includes('calendario') || attrs.includes('calendario') || attrs.includes('calendar');
    if(isCalendar){
      el.classList.add('menu-active-calendar-v584');
      el.classList.add('active');
      el.setAttribute('aria-current','page');
    }else{
      // solo quitamos nuestra clase, no rompemos otras activaciones propias
      el.classList.remove('menu-active-calendar-v584');
    }
  });
}

const __showCalendarV582_v584 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v584){
  showCalendarV582 = async function(){
    await __showCalendarV582_v584();
    setCalendarMenuActiveV584();
    setTimeout(setCalendarMenuActiveV584, 150);
    setTimeout(setCalendarMenuActiveV584, 600);
  };
  window.viewCalendar = showCalendarV582;
}

const __viewCalendar_v584 = typeof viewCalendar === 'function' ? viewCalendar : null;
if(__viewCalendar_v584){
  viewCalendar = async function(){
    await __viewCalendar_v584();
    setCalendarMenuActiveV584();
    setTimeout(setCalendarMenuActiveV584, 150);
    setTimeout(setCalendarMenuActiveV584, 600);
  };
}

// Intercepta clicks del menú calendario para dejarlo activo al momento.
if(!window.__v584CalendarActiveClick){
  window.__v584CalendarActiveClick = true;
  document.addEventListener('click', ev=>{
    const el = ev.target.closest && ev.target.closest('button,a,[data-view],[data-section],[onclick]');
    if(!el) return;
    const txt = (el.textContent || '').toLowerCase();
    const attrs = [
      el.getAttribute('data-view'),
      el.getAttribute('data-section'),
      el.getAttribute('onclick'),
      el.getAttribute('href')
    ].join(' ').toLowerCase();

    if(txt.includes('calendario') || attrs.includes('calendario') || attrs.includes('calendar')){
      setTimeout(setCalendarMenuActiveV584, 20);
      setTimeout(setCalendarMenuActiveV584, 250);
    }
  }, true);
}

setTimeout(setCalendarMenuActiveV584, 800);


// ---------- V58.5 GOOGLE SYNC MODAL CLOSE FIX ----------
window.__syncAbortV585 = false;

function closeSyncModalV585(){
  window.__syncAbortV585 = true;
  try { closeWizard(); } catch(e) {
    const modal = document.getElementById('modalRoot');
    if(modal) modal.innerHTML = '';
  }
}

function syncModalV585(title, body, closable=true){
  $('#modalRoot').innerHTML = `
    <div class="modal-back" onclick="if(event.target===this) closeSyncModalV585()">
      <div class="modal sync-modal-safe-v585" onclick="event.stopPropagation()">
        <div class="sync-modal-head-v585">
          <h2>${escV582 ? escV582(title) : title}</h2>
          ${closable ? `<button class="sync-close-v585" onclick="closeSyncModalV585()">Cerrar</button>` : ''}
        </div>
        ${body}
        <div class="actions">
          <button class="sync-cancel-v585" onclick="closeSyncModalV585()">Cancelar / cerrar ventana</button>
        </div>
      </div>
    </div>
  `;
}

// Escape cierra cualquier modal de sync
if(!window.__v585EscapeClose){
  window.__v585EscapeClose = true;
  window.addEventListener('keydown', e=>{
    if(e.key === 'Escape'){
      const m = document.querySelector('.sync-modal-safe-v585');
      if(m) closeSyncModalV585();
    }
  });
}

// Sobrescribe la sincronización para que NUNCA se quede bloqueada.
async function forceGoogleSyncV583(){
  window.__syncAbortV585 = false;

  syncModalV585('Sincronización Google MARFAN', `
    <div class="sync-status-v585">
      <b>Sincronizando…</b><br>
      Puedes cerrar esta ventana cuando quieras. La app no quedará bloqueada.
    </div>
  `);

  const timeout = setTimeout(()=>{
    if(!window.__syncAbortV585){
      const box = document.querySelector('.sync-status-v585');
      if(box){
        box.classList.add('bad');
        box.innerHTML = `
          <b>La sincronización está tardando demasiado.</b><br>
          Puedes cerrar esta ventana y volver a intentarlo.
        `;
      }
    }
  }, 25000);

  try{
    const r = await api('/api/google/sync-calendar-v583',{method:'POST'});
    if(window.__syncAbortV585) return;

    syncModalV585('Sincronización completada ✅', `
      <div class="sync-status-v585 ok">
        <b>Calendario:</b> ${escV582((r.calendar||{}).summary||'MARFAN')}<br>
        <b>Eventos leídos:</b> ${r.read}<br>
        <b>Creados:</b> ${r.created}<br>
        <b>Actualizados:</b> ${r.updated}<br>
        <b>Errores:</b> ${r.errors}
      </div>
      ${r.errors ? `<div class="sync-status-v585 bad"><pre>${escV582(JSON.stringify((r.results||[]).filter(x=>x.action==='error'),null,2))}</pre></div>` : ''}
      <div class="actions">
        <button onclick="closeSyncModalV585(); showCalendarV582();">Cerrar y actualizar calendario</button>
      </div>
    `);
  }catch(e){
    if(window.__syncAbortV585) return;

    syncModalV585('Error sincronizando Google', `
      <div class="sync-status-v585 bad">
        ${escV582(e.message || 'Error desconocido')}
      </div>
      <div class="actions">
        <button onclick="closeSyncModalV585(); showCalendarV582();">Cerrar y volver al calendario</button>
      </div>
    `);
  }finally{
    clearTimeout(timeout);
    window.__syncAbortV585 = false;
    try { document.body.classList.remove('loading'); } catch(e){}
  }
}

// Alias para otros botones antiguos de sincronización
if(typeof forceGoogleSyncNoPatternV574 === 'function'){
  forceGoogleSyncNoPatternV574 = forceGoogleSyncV583;
}
if(typeof forceGoogleSyncV572 === 'function'){
  forceGoogleSyncV572 = forceGoogleSyncV583;
}
if(typeof forceSyncGoogleV569 === 'function'){
  forceSyncGoogleV569 = forceGoogleSyncV583;
}

// Reforzar botón de calendario para llamar al sync seguro
const __showCalendarV582_v585 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v585){
  showCalendarV582 = async function(){
    await __showCalendarV582_v585();
    setTimeout(()=>{
      document.querySelectorAll('button').forEach(btn=>{
        const t = (btn.textContent||'').toLowerCase();
        if(t.includes('sincronización google') || t.includes('sincronizar google') || t.includes('forzar sincronización')){
          btn.onclick = forceGoogleSyncV583;
        }
      });
    },150);
  };
  window.viewCalendar = showCalendarV582;
}


// ---------- V58.6 CALENDAR ACTIVE MENU FIX ----------
function normalizeMenuTextV586(el){
  return [
    el.textContent || '',
    el.getAttribute('data-view') || '',
    el.getAttribute('data-section') || '',
    el.getAttribute('onclick') || '',
    el.getAttribute('href') || '',
    el.id || '',
    typeof el.className === 'string' ? el.className : ''
  ].join(' ').toLowerCase();
}

function setActiveMenuV586(target){
  const all = document.querySelectorAll('.sidebar button,.sidebar a,nav button,nav a,[data-view],[data-section]');
  document.body.classList.remove('dashboard-view-active-v586','calendar-view-active-v586');

  all.forEach(el=>{
    const txt = normalizeMenuTextV586(el);
    const isDashboard = txt.includes('dashboard') || txt.includes('inicio') || txt.includes('panel');
    const isCalendar = txt.includes('calendario') || txt.includes('calendar') || txt.includes('eventos');

    el.classList.remove('active','menu-active-calendar-v584','menu-calendar-active-v586','dashboard-active-v586');
    el.removeAttribute('aria-current');

    if(isDashboard) el.classList.add('dashboard-active-v586');

    if(target === 'calendar' && isCalendar){
      el.classList.add('active','menu-calendar-active-v586');
      el.setAttribute('aria-current','page');
    }

    if(target === 'dashboard' && isDashboard && !isCalendar){
      el.classList.add('active');
      el.setAttribute('aria-current','page');
    }
  });

  if(target === 'calendar') document.body.classList.add('calendar-view-active-v586');
  if(target === 'dashboard') document.body.classList.add('dashboard-view-active-v586');
}

// Desactiva Dashboard y activa Calendario después de cargar calendario.
const __showCalendarV582_v586 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v586){
  showCalendarV582 = async function(){
    await __showCalendarV582_v586();
    setActiveMenuV586('calendar');
    setTimeout(()=>setActiveMenuV586('calendar'), 100);
    setTimeout(()=>setActiveMenuV586('calendar'), 500);
  };
  window.viewCalendar = showCalendarV582;
}

const __viewCalendar_v586 = typeof viewCalendar === 'function' ? viewCalendar : null;
if(__viewCalendar_v586){
  viewCalendar = async function(){
    await __viewCalendar_v586();
    setActiveMenuV586('calendar');
    setTimeout(()=>setActiveMenuV586('calendar'), 100);
    setTimeout(()=>setActiveMenuV586('calendar'), 500);
  };
}

// Intercepta clics de menú: si es Calendario, limpia Dashboard inmediatamente.
if(!window.__v586MenuClickFix){
  window.__v586MenuClickFix = true;
  document.addEventListener('click', ev=>{
    const el = ev.target.closest && ev.target.closest('.sidebar button,.sidebar a,nav button,nav a,[data-view],[data-section],[onclick],a,button');
    if(!el) return;
    const txt = normalizeMenuTextV586(el);

    const isCalendar = txt.includes('calendario') || txt.includes('calendar');
    const isDashboard = txt.includes('dashboard') || txt.includes('inicio') || txt.includes('panel');

    if(isCalendar){
      setActiveMenuV586('calendar');
      setTimeout(()=>setActiveMenuV586('calendar'), 80);
      setTimeout(()=>setActiveMenuV586('calendar'), 400);
    }else if(isDashboard && !isCalendar){
      setActiveMenuV586('dashboard');
    }
  }, true);
}

// Si el contenido muestra calendario, corrige estado aunque haya entrado por ruta antigua.
setInterval(()=>{
  const content = document.getElementById('content') || document.querySelector('#main');
  if(!content) return;
  const txt = (content.textContent || '').toLowerCase();
  if(txt.includes('calendario eventos') || txt.includes('vista mensual') || txt.includes('google conectado')){
    setActiveMenuV586('calendar');
  }
}, 1000);


// ---------- V58.7 CALENDAR EDIT FIX FRONTEND ----------
async function editEventV587(id){
  id = Number(id);
  if(!id){
    alert('No se ha podido identificar el evento para editar.');
    return;
  }

  const data = await api('/api/events/'+id+'/edit-data-v587');
  const e = data.event || {};

  $('#modalRoot').innerHTML = `
    <div class="modal-back">
      <div class="modal event-edit-modal-v587">
        <div class="modal-head">
          <div>
            <h2>Editar evento</h2>
            <p class="muted">${escV582 ? escV582(e.name||'Evento') : (e.name||'Evento')}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="eventEditFormV587">
          <div class="event-edit-section-v587">
            <h3>Datos principales</h3>
            <div class="event-edit-grid-v587">
              <input class="field span-6" name="name" value="${escV582(e.name||'')}" placeholder="Nombre del evento">
              <input class="field span-3" name="event_code" value="${escV582(e.event_code||'')}" placeholder="Referencia">
              <select class="field span-3" name="status">
                ${['programado','confirmado','pendiente','realizado','cancelado'].map(s=>`<option value="${s}" ${String(e.status||'')===s?'selected':''}>${s}</option>`).join('')}
              </select>

              <input class="field span-4" name="client" value="${escV582(e.client||'')}" placeholder="Cliente">
              <input class="field span-4" name="legal_name" value="${escV582(e.legal_name||'')}" placeholder="Razón social">
              <input class="field span-4" name="cif" value="${escV582(e.cif||'')}" placeholder="CIF/NIF">
            </div>
          </div>

          <div class="event-edit-section-v587">
            <h3>Responsable y contacto</h3>
            <div class="event-edit-grid-v587">
              <input class="field span-4" name="contact_name" value="${escV582(e.contact_name||'')}" placeholder="Responsable">
              <input class="field span-4" name="contact_phone" value="${escV582(e.contact_phone||'')}" placeholder="Teléfono">
              <input class="field span-4" name="contact_email" value="${escV582(e.contact_email||'')}" placeholder="Email">
            </div>
          </div>

          <div class="event-edit-section-v587">
            <h3>Fecha, horarios y ubicación</h3>
            <div class="event-edit-grid-v587">
              <input class="field span-3" name="event_date" type="date" value="${escV582(e.event_date||'')}">
              <input class="field span-2" name="start_time" type="time" value="${escV582(e.start_time||'')}">
              <input class="field span-2" name="end_time" type="time" value="${escV582(e.end_time||'')}">
              <input class="field span-2" name="load_in_time" type="time" value="${escV582(e.load_in_time||'')}">
              <input class="field span-3" name="load_out_time" type="time" value="${escV582(e.load_out_time||'')}">

              <input class="field span-5" name="location" value="${escV582(e.location||'')}" placeholder="Recinto / ubicación">
              <input class="field span-7" name="address" value="${escV582(e.address||'')}" placeholder="Dirección completa">
              <input class="field span-6" name="access_notes" value="${escV582(e.access_notes||'')}" placeholder="Accesos / carga y descarga">
              <input class="field span-6" name="parking_notes" value="${escV582(e.parking_notes||'')}" placeholder="Parking / vehículos">
            </div>
          </div>

          <div class="event-edit-section-v587">
            <h3>Producción y operación</h3>
            <div class="event-edit-grid-v587">
              <input class="field span-4" name="service_type" value="${escV582(e.service_type||'')}" placeholder="Tipo de servicio">
              <input class="field span-4" name="required_workers" type="number" value="${escV582(e.required_workers||'')}" placeholder="Operarios necesarios">
              <input class="field span-4" name="required_team_leads" type="number" value="${escV582(e.required_team_leads||'')}" placeholder="Jefes de equipo">
              <input class="field span-6" name="material_notes" value="${escV582(e.material_notes||'')}" placeholder="Material / técnica">
              <input class="field span-6" name="crew_notes" value="${escV582(e.crew_notes||'')}" placeholder="Notas para crew">
              <textarea class="field span-12" name="production_notes" placeholder="Notas producción">${escV582(e.production_notes||'')}</textarea>
            </div>
          </div>

          <div class="event-edit-section-v587">
            <h3>Facturación y costes</h3>
            <div class="event-edit-grid-v587">
              <select class="field span-3" name="payment_status">
                ${['pendiente','facturado','cobrado','impagado'].map(s=>`<option value="${s}" ${String(e.payment_status||'')===s?'selected':''}>${s}</option>`).join('')}
              </select>
              <input class="field span-3" name="estimated_external_cost" type="number" step="0.01" value="${escV582(e.estimated_external_cost||'')}" placeholder="Coste externo">
              <input class="field span-3" name="estimated_transport_cost" type="number" step="0.01" value="${escV582(e.estimated_transport_cost||'')}" placeholder="Transporte">
              <input class="field span-3" name="estimated_other_cost" type="number" step="0.01" value="${escV582(e.estimated_other_cost||'')}" placeholder="Otros">
            </div>
          </div>

          <div class="event-edit-section-v587">
            <h3>Notas internas</h3>
            <textarea class="field" name="notes" placeholder="Notas internas">${escV582(e.notes||'')}</textarea>
          </div>

          <div class="actions">
            <button class="event-edit-save-v587">Guardar cambios</button>
            <button type="button" class="event-edit-cancel-v587" onclick="closeWizard()">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#eventEditFormV587').onsubmit = async ev=>{
    ev.preventDefault();
    const payload = Object.fromEntries(new FormData(ev.target));
    await api('/api/events/'+id+'/edit-save-v587',{
      method:'POST',
      body:JSON.stringify(payload)
    });
    if(typeof v534Toast === 'function') v534Toast('Evento editado correctamente');
    closeWizard();
    if(typeof showCalendarV582 === 'function') await showCalendarV582();
    else if(typeof viewCalendar === 'function') await viewCalendar();
  };
}

// Redirigir todos los botones antiguos de editar a la corrección V58.7
editEventV582 = editEventV587;
editCalendarEventV58 = editEventV587;
editCalendarEventV576 = editEventV587;
editCalendarEventV58 = editEventV587;

// Reforzar botones ya renderizados
function patchEditButtonsV587(){
  document.querySelectorAll('button').forEach(btn=>{
    const txt = (btn.textContent||'').toLowerCase().trim();
    if(txt === 'editar' || txt === 'editar evento'){
      const onclick = btn.getAttribute('onclick') || '';
      let id = null;
      const m = onclick.match(/\((\d+)\)/);
      if(m) id = Number(m[1]);
      if(!id){
        const row = btn.closest('[data-v582-event],[data-cal-event-id],[data-event-id]');
        if(row) id = Number(row.dataset.v582Event || row.dataset.calEventId || row.dataset.eventId || 0);
      }
      if(id){
        btn.onclick = function(ev){
          ev.preventDefault();
          ev.stopPropagation();
          editEventV587(id);
        };
      }
    }
  });
}

setInterval(patchEditButtonsV587, 1000);

const __showCalendarV582_v587 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v587){
  showCalendarV582 = async function(){
    await __showCalendarV582_v587();
    setTimeout(patchEditButtonsV587, 150);
    setTimeout(patchEditButtonsV587, 600);
  };
  window.viewCalendar = showCalendarV582;
}


// ---------- V58.8 CALENDAR DELETE SYNC FIX FRONTEND ----------
async function forceGoogleSyncV583(){
  $('#modalRoot').innerHTML = `
    <div class="modal-back" onclick="if(event.target===this) closeSyncModalV585 && closeSyncModalV585()">
      <div class="modal sync-modal-safe-v585" onclick="event.stopPropagation()">
        <div class="sync-modal-head-v585">
          <h2>Sincronización Google MARFAN</h2>
          <button class="sync-close-v585" onclick="closeSyncModalV585 && closeSyncModalV585()">Cerrar</button>
        </div>
        <div class="v583-sync">Sincronizando y respetando eventos borrados...</div>
      </div>
    </div>`;

  try{
    const r = await api('/api/google/sync-calendar-v588',{method:'POST'});
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-safe-v585">
          <div class="sync-modal-head-v585">
            <h2>Sincronización completada ✅</h2>
            <button class="sync-close-v585" onclick="closeWizard(); showCalendarV582 && showCalendarV582()">Cerrar</button>
          </div>
          <div class="v583-sync ok">
            <b>Calendario:</b> ${escV582((r.calendar||{}).summary||'MARFAN')}<br>
            <b>Eventos leídos:</b> ${r.read}<br>
            <b>Saltados porque fueron borrados:</b> ${r.skipped_deleted}<br>
            <b>Creados:</b> ${r.created}<br>
            <b>Actualizados:</b> ${r.updated}<br>
            <b>Errores:</b> ${r.errors}
          </div>
          ${r.skipped_deleted ? `<div class="v583-sync"><b>No reimportados:</b><pre>${escV582(JSON.stringify(r.skipped_deleted_examples||[],null,2))}</pre></div>` : ''}
        </div>
      </div>`;
  }catch(e){
    $('#modalRoot').innerHTML = `
      <div class="modal-back">
        <div class="modal sync-modal-safe-v585">
          <div class="sync-modal-head-v585">
            <h2>Error sincronizando</h2>
            <button class="sync-close-v585" onclick="closeWizard()">Cerrar</button>
          </div>
          <div class="v583-sync bad">${escV582(e.message)}</div>
        </div>
      </div>`;
  }
}

async function deleteEventV582(id, name){
  if(!confirm(`¿Seguro que quieres borrar este evento?\n\n${name}\n\nTambién se bloqueará para que NO vuelva a importarse desde Google Calendar.`)) return;
  await api('/api/events/'+id+'/remove-v588',{method:'DELETE'});
  if(typeof v534Toast==='function') v534Toast('Evento borrado y bloqueado para no reimportarse');
  closeWizard();
  await showCalendarV582();
}

// Alias para todos los borrados
deleteCalendarEventV58 = deleteEventV582;
deleteCalendarEventV576 = deleteEventV582;
deleteCalendarEventV588 = deleteEventV582;

// Reforzar botones de sincronización a la versión v588
if(typeof forceGoogleSyncNoPatternV574 === 'function') forceGoogleSyncNoPatternV574 = forceGoogleSyncV583;
if(typeof forceGoogleSyncV572 === 'function') forceGoogleSyncV572 = forceGoogleSyncV583;
if(typeof forceSyncGoogleV569 === 'function') forceSyncGoogleV569 = forceGoogleSyncV583;


// ---------- V58.9 SYNC MODAL HARD CLOSE FIX ----------
function hardCloseModalV589(){
  try { window.__syncAbortV585 = true; } catch(e){}
  try { document.body.classList.remove('loading'); } catch(e){}
  try { document.documentElement.classList.remove('loading'); } catch(e){}
  try {
    const root = document.getElementById('modalRoot');
    if(root) root.innerHTML = '';
  } catch(e){}
  try {
    document.querySelectorAll('.modal-back,.modal-overlay,.sync-modal-safe-v585,.sync-modal-v589').forEach(el=>{
      if(el && el.parentNode) el.parentNode.removeChild(el);
    });
  } catch(e){}
}

function syncModalV589(title, body){
  const safeEsc = (typeof escV582 === 'function') ? escV582 : (v=>String(v||''));
  const root = document.getElementById('modalRoot') || document.body;
  root.innerHTML = `
    <div class="modal-back" onclick="if(event.target===this) hardCloseModalV589()">
      <div class="modal sync-modal-v589" onclick="event.stopPropagation()">
        <div class="sync-modal-head-v589">
          <h2>${safeEsc(title)}</h2>
          <button type="button" class="sync-hard-close-v589" onclick="hardCloseModalV589()">Cerrar</button>
        </div>
        ${body}
        <div class="actions">
          <button type="button" class="sync-hard-close-v589" onclick="hardCloseModalV589()">Cerrar ventana</button>
          <button type="button" class="secondary" onclick="hardCloseModalV589(); if(typeof showCalendarV582==='function') showCalendarV582();">Cerrar y volver al calendario</button>
        </div>
      </div>
    </div>
  `;
}

// Escape siempre cierra modal, incluso si closeWizard falla.
if(!window.__v589HardEscape){
  window.__v589HardEscape = true;
  window.addEventListener('keydown', e=>{
    if(e.key === 'Escape') hardCloseModalV589();
  }, true);
}

// Sobrescribe closeWizard para que también cierre overlays atascados.
if(typeof closeWizard === 'function' && !window.__v589CloseWizardWrapped){
  window.__v589CloseWizardWrapped = true;
  const oldCloseWizardV589 = closeWizard;
  closeWizard = function(){
    try { oldCloseWizardV589(); } catch(e){}
    hardCloseModalV589();
  };
}

// Versión segura definitiva de sincronización: siempre usa hard close.
async function forceGoogleSyncV583(){
  syncModalV589('Sincronización Google MARFAN', `
    <div class="sync-status-v589">
      <b>Sincronizando…</b><br>
      Puedes cerrar esta ventana en cualquier momento con Cerrar, Escape o click fuera.
    </div>
  `);

  let timeout = setTimeout(()=>{
    const box = document.querySelector('.sync-status-v589');
    if(box){
      box.classList.add('bad');
      box.innerHTML = '<b>Google está tardando demasiado.</b><br>Puedes cerrar esta ventana sin bloquear la app.';
    }
  }, 25000);

  try{
    const r = await api('/api/google/sync-calendar-v588',{method:'POST'});
    clearTimeout(timeout);

    syncModalV589('Sincronización completada ✅', `
      <div class="sync-status-v589 ok">
        <b>Calendario:</b> ${escV582((r.calendar||{}).summary||'MARFAN')}<br>
        <b>Eventos leídos:</b> ${r.read}<br>
        <b>Saltados porque fueron borrados:</b> ${r.skipped_deleted}<br>
        <b>Creados:</b> ${r.created}<br>
        <b>Actualizados:</b> ${r.updated}<br>
        <b>Errores:</b> ${r.errors}
      </div>
    `);
  }catch(e){
    clearTimeout(timeout);
    syncModalV589('Error sincronizando Google', `
      <div class="sync-status-v589 bad">
        ${escV582(e.message || 'Error desconocido')}
      </div>
    `);
  }finally{
    try { document.body.classList.remove('loading'); } catch(e){}
  }
}

// Todos los botones antiguos de sync apuntan aquí.
forceGoogleSyncNoPatternV574 = forceGoogleSyncV583;
forceGoogleSyncV572 = forceGoogleSyncV583;
forceSyncGoogleV569 = forceGoogleSyncV583;

// Reenganchar los botones visibles tras pintar calendario.
function patchSyncButtonsV589(){
  document.querySelectorAll('button').forEach(btn=>{
    const t = (btn.textContent||'').toLowerCase();
    if(t.includes('sincronización google') || t.includes('sincronizar google') || t.includes('forzar sincronización')){
      btn.onclick = function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        forceGoogleSyncV583();
      };
    }
  });
}

setInterval(patchSyncButtonsV589, 1000);

const __showCalendarV582_v589 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v589){
  showCalendarV582 = async function(){
    await __showCalendarV582_v589();
    setTimeout(patchSyncButtonsV589, 100);
    setTimeout(patchSyncButtonsV589, 500);
  };
  window.viewCalendar = showCalendarV582;
}


// ---------- V61.1 EMERGENCY STABLE ROLLBACK ----------
window.__MARFAN_SAFE_VERSION = '61.1.0';
console.log('MARFAN V61.1 Emergency Stable Rollback loaded');


// ---------- V61.2 SAFE V46 EVENT FORM FRONTEND ----------
function v612Esc(v){
  if(typeof escV582 === 'function') return escV582(v);
  if(typeof esc === 'function') return esc(v);
  return String(v ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
async function v612Fetch(path, opts={}){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer '+token;
    if(window.token) headers.Authorization = 'Bearer '+window.token;
  }catch(e){}
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...headers, ...(opts.headers||{})},
    body:opts.body,
    credentials:'same-origin',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML. No está entrando en la ruta V61.2.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data = {ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}
function v612ExtractGoogleMaps(){
  const link = document.querySelector('#v612EventForm [name="google_maps_link"]')?.value || '';
  const addressInput = document.querySelector('#v612EventForm [name="address"]');
  const latInput = document.querySelector('#v612EventForm [name="lat"]');
  const lngInput = document.querySelector('#v612EventForm [name="lng"]');
  const geoInput = document.querySelector('#v612EventForm [name="geo_source"]');
  const note = document.getElementById('v612GeoNote');
  const text = decodeURIComponent(link);
  let found = false;
  let m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if(!m) m = text.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if(!m) m = text.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if(m){ latInput.value=m[1]; lngInput.value=m[2]; geoInput.value='google_maps_link'; found=true; }
  let q = text.match(/[?&]q=([^&]+)/);
  if(q && addressInput && !addressInput.value){ addressInput.value=q[1].replace(/\+/g,' '); found=true; }
  if(note) note.innerHTML = found ? 'Datos extraídos del link Google Maps.' : 'No se detectaron coordenadas. Puedes usar Detectar ubicación.';
  v612TransportSuggest();
}
function v612DetectGeo(){
  if(!navigator.geolocation){ alert('Este navegador no permite geolocalización.'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    document.querySelector('#v612EventForm [name="lat"]').value = pos.coords.latitude.toFixed(6);
    document.querySelector('#v612EventForm [name="lng"]').value = pos.coords.longitude.toFixed(6);
    document.querySelector('#v612EventForm [name="geo_source"]').value = 'navigator.geolocation';
    v612TransportSuggest();
    if(typeof v534Toast === 'function') v534Toast('Ubicación detectada');
  }, err=>alert('No se pudo detectar ubicación: '+err.message), {enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
function v612TransportSuggest(){
  const address = document.querySelector('#v612EventForm [name="address"]')?.value || '';
  const lat = document.querySelector('#v612EventForm [name="lat"]')?.value || '';
  const lng = document.querySelector('#v612EventForm [name="lng"]')?.value || '';
  const req = document.querySelector('#v612EventForm [name="transport_required"]');
  const charge = document.querySelector('#v612EventForm [name="transport_charge"]');
  const note = document.getElementById('v612TransportNote');
  const t = address.toLowerCase();
  const local = ['cartama','cártama','estacion de cartama','estación de cártama','malaga','málaga'].some(x=>t.includes(x));
  if(!address && !lat && !lng){ if(note) note.innerHTML='Sin ubicación: revisar transporte manualmente.'; return; }
  if(local){ if(req) req.value=0; if(charge && !Number(charge.value)) charge.value=0; if(note) note.innerHTML='Zona local detectada: sin cargo automático.'; }
  else { if(req) req.value=1; if(charge && !Number(charge.value)) charge.value=25; if(note) note.innerHTML='Fuera de zona local: revisar cargo de transporte.'; }
}
function v612UserOptions(users, selected=''){
  return users.map(u=>`<option value="${u.id}" ${String(selected)===String(u.id)?'selected':''}>${v612Esc((u.first_name||'')+' '+(u.last_name||''))}${u.nickname?' · '+v612Esc(u.nickname):''}</option>`).join('');
}
function v612RoleName(r){ return r.role || r.name || r.title || 'Rol'; }
function v612RoleOptions(roles, selected=''){
  return roles.map(r=>`<option value="${r.id}" data-day="${Number(r.hourly_rate||r.day_rate||r.rate||0)}" data-night="${Number(r.night_rate||r.rate_night||0)}" data-name="${v612Esc(v612RoleName(r))}" ${String(selected)===String(r.id)?'selected':''}>${v612Esc(v612RoleName(r))}</option>`).join('');
}
function v612CalcAssignment(row){
  const roleSel = row.querySelector('[name="role_id"]');
  const shift = row.querySelector('[name="shift_type"]')?.value || 'D';
  const opt = roleSel ? roleSel.options[roleSel.selectedIndex] : null;
  const rate = opt ? (shift === 'N' ? Number(opt.dataset.night||0) : Number(opt.dataset.day||0)) : 0;
  const rateInput = row.querySelector('[name="hourly_rate"]');
  const roleName = row.querySelector('[name="service_role"]');
  if(rateInput) rateInput.value = rate.toFixed(2);
  if(roleName && opt) roleName.value = opt.dataset.name || opt.textContent;
  row.classList.toggle('v612-teamlead', !!row.querySelector('[name="is_team_lead"]')?.checked);
}
function v612AddAssignment(users, roles, a={}){
  const box = document.getElementById('v612Assignments');
  if(!box) return;
  const row = document.createElement('div');
  row.className = 'v612-assignment';
  row.innerHTML = `
    <select class="field" name="user_id">${v612UserOptions(users, a.user_id)}</select>
    <select class="field" name="role_id" onchange="v612CalcAssignment(this.closest('.v612-assignment'))">${v612RoleOptions(roles, a.role_id)}</select>
    <select class="field" name="shift_type" onchange="v612CalcAssignment(this.closest('.v612-assignment'))"><option value="D" ${a.shift_type==='D'?'selected':''}>D</option><option value="N" ${a.shift_type==='N'?'selected':''}>N</option></select>
    <input class="field" name="planned_start" type="time" value="${v612Esc(a.planned_start||'')}">
    <input class="field" name="planned_end" type="time" value="${v612Esc(a.planned_end||'')}">
    <input class="field" name="hourly_rate" readonly value="${v612Esc(a.hourly_rate||'')}">
    <button type="button" class="danger" onclick="this.closest('.v612-assignment').remove()">Quitar</button>
    <label style="grid-column:1/-1"><input type="checkbox" name="is_team_lead" ${Number(a.is_team_lead||0)===1?'checked':''} onchange="v612CalcAssignment(this.closest('.v612-assignment'))"> Jefe de equipo</label>
    <input type="hidden" name="service_role" value="${v612Esc(a.service_role||'')}">
  `;
  box.appendChild(row);
  v612CalcAssignment(row);
}
function v612CollectAssignments(){
  return [...document.querySelectorAll('#v612Assignments .v612-assignment')].map(row=>({
    user_id:Number(row.querySelector('[name="user_id"]').value || 0),
    role_id:row.querySelector('[name="role_id"]').value || '',
    service_role:row.querySelector('[name="service_role"]').value || '',
    shift_type:row.querySelector('[name="shift_type"]').value || 'D',
    planned_start:row.querySelector('[name="planned_start"]').value || '',
    planned_end:row.querySelector('[name="planned_end"]').value || '',
    hourly_rate:Number(row.querySelector('[name="hourly_rate"]').value || 0),
    is_team_lead:row.querySelector('[name="is_team_lead"]').checked ? 1 : 0,
    status:'asignado'
  })).filter(x=>x.user_id);
}
async function openV612EventForm(id=0){
  id = Number(id || 0);
  let data;
  try{ data = await v612Fetch('/api/v612/event-form-data' + (id ? '?id='+encodeURIComponent(id) : '')); }
  catch(e){ alert('Error abriendo formulario de evento: '+e.message); return; }
  const e = data.event || {};
  const users = data.users || [];
  const roles = data.roles || [];
  const assignments = data.assignments || [];
  const root = document.getElementById('modalRoot') || document.body;
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal v612-modal">
        <div class="modal-head">
          <div><h2>${id?'Editar evento':'Crear evento'} · Formulario V46</h2><p class="muted">Google Maps · operarios · jefe de equipo · roles</p></div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>
        <form id="v612EventForm">
          <div class="v612-section"><h3>1. Datos del evento</h3><div class="v612-grid">
            <input class="field span-6" name="name" value="${v612Esc(e.name||'')}" placeholder="Nombre del evento" required>
            <input class="field span-3" name="event_code" value="${v612Esc(e.event_code||'')}" placeholder="Referencia">
            <select class="field span-3" name="status">${['programado','confirmado','pendiente','realizado','cancelado'].map(s=>`<option value="${s}" ${String(e.status||'programado')===s?'selected':''}>${s}</option>`).join('')}</select>
            <input class="field span-4" name="client" value="${v612Esc(e.client||'')}" placeholder="Cliente">
            <input class="field span-4" name="legal_name" value="${v612Esc(e.legal_name||'')}" placeholder="Razón social">
            <input class="field span-4" name="cif" value="${v612Esc(e.cif||'')}" placeholder="CIF/NIF">
          </div></div>
          <div class="v612-section"><h3>2. Contacto</h3><div class="v612-grid">
            <input class="field span-4" name="contact_name" value="${v612Esc(e.contact_name||'')}" placeholder="Responsable">
            <input class="field span-4" name="contact_phone" value="${v612Esc(e.contact_phone||'')}" placeholder="Teléfono">
            <input class="field span-4" name="contact_email" value="${v612Esc(e.contact_email||'')}" placeholder="Email">
          </div></div>
          <div class="v612-section"><h3>3. Fecha, horarios y ubicación</h3><div class="v612-grid">
            <input class="field span-3" name="event_date" type="date" value="${v612Esc(e.event_date||'')}" required>
            <input class="field span-2" name="start_time" type="time" value="${v612Esc(e.start_time||'')}">
            <input class="field span-2" name="end_time" type="time" value="${v612Esc(e.end_time||'')}">
            <input class="field span-2" name="load_in_time" type="time" value="${v612Esc(e.load_in_time||'')}">
            <input class="field span-3" name="load_out_time" type="time" value="${v612Esc(e.load_out_time||'')}">
            <input class="field span-5" name="location" value="${v612Esc(e.location||'')}" placeholder="Recinto / ubicación">
            <input class="field span-7" name="address" value="${v612Esc(e.address||'')}" placeholder="Dirección completa" oninput="v612TransportSuggest()">
            <input class="field span-9" name="google_maps_link" value="${v612Esc(e.google_maps_link||'')}" placeholder="Pegar link de Google Maps">
            <button type="button" class="v612-link span-3" onclick="v612ExtractGoogleMaps()">Leer link Google</button>
            <input class="field span-6" name="access_notes" value="${v612Esc(e.access_notes||'')}" placeholder="Accesos / carga y descarga">
            <input class="field span-6" name="parking_notes" value="${v612Esc(e.parking_notes||'')}" placeholder="Parking / vehículos">
          </div></div>
          <div class="v612-section"><h3>4. Geolocalización y transporte</h3><div class="v612-grid">
            <input class="field span-3" name="lat" value="${v612Esc(e.lat||'')}" placeholder="Latitud">
            <input class="field span-3" name="lng" value="${v612Esc(e.lng||'')}" placeholder="Longitud">
            <input class="field span-3" name="geo_source" value="${v612Esc(e.geo_source||'')}" placeholder="Fuente">
            <button type="button" class="v612-geo span-3" onclick="v612DetectGeo()">Detectar ubicación</button>
            <select class="field span-3" name="transport_required"><option value="0" ${Number(e.transport_required||0)===0?'selected':''}>Sin cargo transporte</option><option value="1" ${Number(e.transport_required||0)===1?'selected':''}>Con cargo transporte</option></select>
            <input class="field span-3" name="transport_charge" type="number" step="0.01" value="${v612Esc(e.transport_charge||0)}" placeholder="Cargo transporte €">
            <div class="v612-warning span-3" id="v612GeoNote">Pega un link de Google Maps para leer coordenadas.</div>
            <div class="v612-warning span-3" id="v612TransportNote">Revisión transporte pendiente.</div>
          </div></div>
          <div class="v612-section"><h3>5. Operarios y jefe de equipo</h3>
            <div id="v612Assignments"></div>
            <button type="button" class="v612-add" onclick="v612AddAssignment(window.__v612Users, window.__v612Roles)">+ Añadir operario</button>
          </div>
          <div class="v612-section"><h3>6. Producción</h3><div class="v612-grid">
            <input class="field span-4" name="service_type" value="${v612Esc(e.service_type||'')}" placeholder="Tipo de servicio">
            <input class="field span-4" name="required_workers" type="number" value="${v612Esc(e.required_workers||'')}" placeholder="Operarios necesarios">
            <input class="field span-4" name="required_team_leads" type="number" value="${v612Esc(e.required_team_leads||'')}" placeholder="Jefes de equipo">
            <input class="field span-6" name="material_notes" value="${v612Esc(e.material_notes||'')}" placeholder="Material / técnica">
            <input class="field span-6" name="crew_notes" value="${v612Esc(e.crew_notes||'')}" placeholder="Notas para crew">
            <textarea class="field span-12" name="production_notes" placeholder="Notas producción">${v612Esc(e.production_notes||'')}</textarea>
          </div></div>
          <div class="v612-section"><h3>7. Costes y notas</h3><div class="v612-grid">
            <select class="field span-3" name="payment_status">${['pendiente','facturado','cobrado','impagado'].map(s=>`<option value="${s}" ${String(e.payment_status||'pendiente')===s?'selected':''}>${s}</option>`).join('')}</select>
            <input class="field span-3" name="estimated_external_cost" type="number" step="0.01" value="${v612Esc(e.estimated_external_cost||0)}" placeholder="Coste externo">
            <input class="field span-3" name="estimated_transport_cost" type="number" step="0.01" value="${v612Esc(e.estimated_transport_cost||0)}" placeholder="Transporte">
            <input class="field span-3" name="estimated_other_cost" type="number" step="0.01" value="${v612Esc(e.estimated_other_cost||0)}" placeholder="Otros">
            <textarea class="field span-12" name="notes" placeholder="Notas internas">${v612Esc(e.notes||'')}</textarea>
          </div></div>
          <div class="actions"><button class="v612-save" type="submit">Guardar evento</button><button type="button" class="secondary" onclick="closeWizard()">Cancelar</button></div>
        </form>
      </div>
    </div>`;
  window.__v612Users = users; window.__v612Roles = roles;
  if(assignments.length) assignments.forEach(a=>v612AddAssignment(users, roles, a));
  else v612AddAssignment(users, roles, {});
  v612TransportSuggest();
  document.getElementById('v612EventForm').onsubmit = async ev=>{
    ev.preventDefault();
    const event = Object.fromEntries(new FormData(ev.target));
    try{
      await v612Fetch('/api/v612/event-form-save' + (id ? '?id='+encodeURIComponent(id) : ''), {method:'POST', body:JSON.stringify({event, assignments:v612CollectAssignments()})});
      if(typeof v534Toast === 'function') v534Toast(id?'Evento editado correctamente':'Evento creado correctamente');
      try{ closeWizard(); }catch(e){ root.innerHTML=''; }
      if(typeof showCalendarV582 === 'function') await showCalendarV582();
      else if(typeof viewCalendar === 'function') await viewCalendar();
    }catch(err){ alert('Error guardando evento: '+err.message); }
  };
}
window.openV612EventForm = openV612EventForm;
window.openCreateEventV559 = function(){ return openV612EventForm(0); };
window.openCreateEventV566 = function(){ return openV612EventForm(0); };
window.openCreateEventV563 = function(){ return openV612EventForm(0); };
window.openEditEventV60 = openV612EventForm;
window.editEventV582 = openV612EventForm;
window.editEventV587 = openV612EventForm;
window.editEventV593 = openV612EventForm;
window.editCalendarEventV58 = openV612EventForm;
window.editCalendarEventV576 = openV612EventForm;

function patchV612Buttons(){
  document.querySelectorAll('button').forEach(btn=>{
    const txt=(btn.textContent||'').toLowerCase().trim();
    if(txt === 'editar' || txt === 'editar evento'){
      let id=null;
      const old=btn.getAttribute('onclick')||'';
      const m=old.match(/\((\d+)\)/);
      if(m) id=Number(m[1]);
      if(!id){
        const row=btn.closest('[data-v582-event],[data-cal-event-id],[data-event-id],[data-edit-event-id-v60]');
        if(row) id=Number(row.dataset.v582Event||row.dataset.calEventId||row.dataset.eventId||row.dataset.editEventIdV60||0);
      }
      if(id){ btn.removeAttribute('onclick'); btn.onclick=(ev)=>{ev.preventDefault();ev.stopPropagation();openV612EventForm(id);}; }
    }
    if(txt.includes('crear evento') || txt.includes('+ crear evento')){
      btn.onclick=(ev)=>{ev.preventDefault();openV612EventForm(0);};
    }
  });
}
setInterval(patchV612Buttons, 800);
const __showCalendarV582_v612 = typeof showCalendarV582 === 'function' ? showCalendarV582 : null;
if(__showCalendarV582_v612){
  showCalendarV582 = async function(){
    await __showCalendarV582_v612();
    setTimeout(patchV612Buttons,50);
    setTimeout(patchV612Buttons,400);
  };
  window.viewCalendar = showCalendarV582;
}


// ---------- V61.3 SOLO LOGIN FIX FRONTEND ----------
// No toca calendario V61.2. Solo evita entrada directa sin sesión real.

window.__v613LoginSubmitted = false;
window.__v613LoginCheckDone = false;

function v613HasStoredAuth(){
  try{
    if(typeof token !== 'undefined' && token) return true;
    if(window.token) return true;
    if(localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('marfan_token')) return true;
    if(sessionStorage.getItem('token') || sessionStorage.getItem('authToken')) return true;
  }catch(e){}
  return false;
}

function v613LoginVisible(){
  const hasPass = !!document.querySelector('input[type="password"]');
  const txt = (document.body.textContent || '').toLowerCase();
  return hasPass && (txt.includes('entrar') || txt.includes('usuario') || txt.includes('contraseña') || txt.includes('login'));
}

function v613LooksInsideApp(){
  const txt = (document.body.textContent || '').toLowerCase();
  const side = document.querySelector('.sidebar') || document.querySelector('aside') || document.querySelector('nav');
  return !!side && (
    txt.includes('dashboard') ||
    txt.includes('calendario eventos') ||
    txt.includes('operarios') ||
    txt.includes('finanzas') ||
    txt.includes('crear evento')
  );
}

function v613RenderLoginFallback(){
  const root = document.getElementById('app') || document.body;
  root.innerHTML = `
    <div class="v613-login-lock">
      <div class="v613-login-card">
        <h2>Acceso requerido</h2>
        <p>Por seguridad tienes que iniciar sesión para entrar en la aplicación.</p>
        <button onclick="location.reload()">Volver al login</button>
      </div>
    </div>
  `;
}

async function v613ServerSession(){
  try{
    const r = await fetch('/api/v613-session', {
      credentials:'same-origin',
      cache:'no-store',
      headers:{'Accept':'application/json'}
    });
    const txt = await r.text();
    if(txt.trim().startsWith('<')) return false;
    const j = JSON.parse(txt || '{}');
    return !!(j.ok || j.authenticated);
  }catch(e){
    return false;
  }
}

async function v613EnforceLoginOnce(){
  // Si ya se ve login, no tocar nada.
  if(v613LoginVisible()) return;

  // Si acaba de pulsar Entrar, dar margen al login original.
  if(window.__v613LoginSubmitted) return;

  // Si hay token local, no bloquear.
  if(v613HasStoredAuth()) return;

  // Comprobar cookie/sesión de servidor. Si existe, no bloquear.
  const serverOk = await v613ServerSession();
  if(serverOk) return;

  // Si no hay sesión y está dentro de app, mandar a login sin romper el login real.
  if(v613LooksInsideApp()){
    try{
      if(typeof logout === 'function'){
        logout();
        return;
      }
      if(typeof showLogin === 'function'){
        showLogin();
        return;
      }
      if(typeof renderLogin === 'function'){
        renderLogin();
        return;
      }
    }catch(e){}
    v613RenderLoginFallback();
  }
}

if(!window.__v613LoginListeners){
  window.__v613LoginListeners = true;

  document.addEventListener('submit', ev=>{
    if(ev.target && ev.target.querySelector && ev.target.querySelector('input[type="password"]')){
      window.__v613LoginSubmitted = true;
      setTimeout(()=>{ window.__v613LoginSubmitted = false; }, 10000);
    }
  }, true);

  document.addEventListener('click', ev=>{
    const btn = ev.target.closest && ev.target.closest('button,input[type="submit"]');
    if(!btn) return;
    const form = btn.closest && btn.closest('form');
    const txt = (btn.textContent || btn.value || '').toLowerCase();
    if((form && form.querySelector('input[type="password"]')) || txt.includes('entrar') || txt.includes('acceder')){
      window.__v613LoginSubmitted = true;
      setTimeout(()=>{ window.__v613LoginSubmitted = false; }, 10000);
    }
  }, true);
}

// Ejecutar después de que la app haya intentado pintar su vista inicial.
setTimeout(v613EnforceLoginOnce, 900);
setTimeout(v613EnforceLoginOnce, 2200);

// No se ejecuta en bucle agresivo para no bloquear calendario ni login.


// ---------- V61.4 GOOGLE CALENDAR PUSH FIX FRONTEND ----------
// Mantiene el formulario V61.2, pero cambia el guardado a /api/v614/event-form-save para crear/actualizar Google Calendar.

async function v614Fetch(path, opts={}){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer '+token;
    if(window.token) headers.Authorization = 'Bearer '+window.token;
  }catch(e){}
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...headers, ...(opts.headers||{})},
    body:opts.body,
    credentials:'same-origin',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML. No está entrando en la ruta V61.4.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data = {ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}

// Reabre el formulario V61.2 y sustituye SOLO el submit para que empuje a Google.
const __openV612EventForm_v614 = typeof openV612EventForm === 'function' ? openV612EventForm : null;
if(__openV612EventForm_v614){
  openV612EventForm = async function(id=0){
    await __openV612EventForm_v614(id);
    setTimeout(()=>{
      const form = document.getElementById('v612EventForm');
      if(!form || form.__v614Patched) return;
      form.__v614Patched = true;

      const info = document.createElement('div');
      info.className = 'v614-google-status';
      info.innerHTML = 'Al guardar, este evento se creará/actualizará también en Google Calendar MARFAN.';
      form.querySelector('.actions')?.prepend(info);

      form.onsubmit = async ev=>{
        ev.preventDefault();
        const event = Object.fromEntries(new FormData(ev.target));
        try{
          const saved = await v614Fetch('/api/v614/event-form-save' + (Number(id) ? '?id='+encodeURIComponent(Number(id)) : ''), {
            method:'POST',
            body:JSON.stringify({event, assignments: typeof v612CollectAssignments === 'function' ? v612CollectAssignments() : []})
          });

          if(saved.google && saved.google.ok){
            if(typeof v534Toast === 'function') v534Toast(Number(id) ? 'Evento editado y sincronizado con Google' : 'Evento creado y sincronizado con Google');
          }else{
            alert('Evento guardado en la app, pero Google no se pudo sincronizar: ' + ((saved.google && (saved.google.error || saved.google.reason)) || 'sin detalle'));
          }

          try{ closeWizard(); }catch(e){ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; }
          if(typeof showCalendarV582 === 'function') await showCalendarV582();
          else if(typeof viewCalendar === 'function') await viewCalendar();
        }catch(err){
          alert('Error guardando evento: '+err.message);
        }
      };
    }, 80);
  };

  window.openV612EventForm = openV612EventForm;
  window.openCreateEventV559 = function(){ return openV612EventForm(0); };
  window.openCreateEventV566 = function(){ return openV612EventForm(0); };
  window.openCreateEventV563 = function(){ return openV612EventForm(0); };
  window.openEditEventV60 = openV612EventForm;
  window.editEventV582 = openV612EventForm;
  window.editEventV587 = openV612EventForm;
  window.editEventV593 = openV612EventForm;
  window.editCalendarEventV58 = openV612EventForm;
  window.editCalendarEventV576 = openV612EventForm;
}

async function pushEventToGoogleV614(id){
  try{
    const r = await v614Fetch('/api/v614/events/'+Number(id)+'/push-google',{method:'POST'});
    if(r.ok) alert('Evento sincronizado con Google correctamente.');
    else alert('No se pudo sincronizar con Google: '+(r.error || r.reason || 'sin detalle'));
  }catch(e){
    alert('Error sincronizando con Google: '+e.message);
  }
}










// ---------- V62.4 SIDEBAR INSTANT NAVIGATION ----------
// Elimina sensación lenta: NO hace click en el menú original al navegar.
// Construye una vez y usa funciones directas del ERP.
// No toca calendario, Google Sync, login, formularios ni eventos.

(function(){
  const MENU = [
    {g:'OPERATIVA', l:'Dashboard', k:['dashboard'], f:['viewDashboard','dashboard','showDashboard']},
    {g:'OPERATIVA', l:'Calendario de Eventos', k:['calendario'], f:['viewCalendar','showCalendarV582','showCalendar']},
    {g:'OPERATIVA', l:'Control Diario', k:['control diario'], f:['viewDailyControl','viewControlDiario','showDailyControl']},
    {g:'OPERATIVA', l:'GPS Live', k:['gps'], f:['viewGpsLive','viewGPSLive','showGpsLive']},

    {g:'GESTIÓN', l:'Clientes', k:['cliente'], f:['viewClients','showClients']},
    {g:'GESTIÓN', l:'Operarios', k:['operario'], f:['viewUsers','viewOperators','viewOperarios','showUsers']},
    {g:'GESTIÓN', l:'Documentación', k:['document'], f:['viewDocuments','viewDocumentation','showDocumentation']},
    {g:'GESTIÓN', l:'Tarifas', k:['tarifa'], f:['viewRates','viewTarifas','showRates']},

    {g:'ADMINISTRACIÓN', l:'Albaranes Evento', k:['albaran','albarán'], f:['viewDeliveryNotes','viewEventDeliveryNotes','viewAlbaranes','showDeliveryNotes']},
    {g:'ADMINISTRACIÓN', l:'Finanzas Pro', k:['finanza'], f:['viewFinancePro','viewFinance','showFinance']},
    {g:'ADMINISTRACIÓN', l:'Informes PDF', k:['informe','pdf'], f:['viewReportsV562','viewReports','viewInformesPDF','showReports']},
    {g:'ADMINISTRACIÓN', l:'Vista Operario', k:['vista operario'], f:['viewWorkerPortal','viewVistaOperario','showWorkerPortal']},
    {g:'ADMINISTRACIÓN', l:'Contraseñas', k:['contraseña','contrasena','password'], f:['viewPasswords','viewContrasenas','showPasswords']},

    {g:'SISTEMA', l:'Ajustes ERP', k:['ajuste','config','erp'], f:['viewConfig','viewSettings','viewAjustes','showSettings']}
  ];

  const FORBIDDEN = ['operaciones','produccion live','producción live','produccion','producción','eventos realizados'];

  function n(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
  function loginVisible(){
    const t=n(document.body.textContent);
    return !!document.querySelector('input[type="password"]') && (t.includes('entrar') || t.includes('login') || t.includes('contrasena'));
  }
  function sidebar(){
    const cs=[
      document.querySelector('.sidebar'),
      document.querySelector('aside.sidebar'),
      document.querySelector('[class*="sidebar"]'),
      document.querySelector('aside'),
      document.querySelector('nav')
    ].filter(Boolean);
    return cs.find(el=>{
      const t=n(el.textContent);
      return t.includes('dashboard') && (t.includes('calendario') || t.includes('operario') || t.includes('finanza'));
    }) || null;
  }

  function textOf(el){
    return n([
      el.textContent,
      el.getAttribute && el.getAttribute('onclick'),
      el.getAttribute && el.getAttribute('data-view'),
      el.getAttribute && el.getAttribute('data-section'),
      el.getAttribute && el.getAttribute('href'),
      el.id,
      typeof el.className === 'string' ? el.className : ''
    ].filter(Boolean).join(' '));
  }

  function originalMap(side){
    const els=[...side.querySelectorAll('button,a,[onclick],[data-view],[data-section]')];
    const map={};
    MENU.forEach(spec=>{
      const found=els.find(el=>{
        const t=textOf(el);
        return spec.k.some(key=>t.includes(n(key)));
      });
      if(found) map[spec.l]=found;
    });
    return map;
  }

  function keepHeader(side){
    const keep=[];
    for(const ch of [...side.children]){
      const t=n(ch.textContent);
      const isMenu=['dashboard','calendario','control diario','operaciones','clientes','informes','operario','gps','finanza','document','tarifa','albaran','contrasena','produccion','eventos realizados'].some(k=>t.includes(k));
      if(isMenu) break;
      keep.push(ch.cloneNode(true));
    }
    return keep;
  }

  function callDirect(spec){
    // Directo primero: evita click del menú original y por tanto evita flash/re-render lateral.
    for(const fn of spec.f || []){
      try{
        if(typeof window[fn] === 'function'){
          window[fn]();
          return true;
        }
        if(typeof globalThis[fn] === 'function'){
          globalThis[fn]();
          return true;
        }
      }catch(e){}
    }

    // Último recurso: elemento original, pero sin usar salvo que no exista función.
    const original = window.__v624Originals && window.__v624Originals[spec.l];
    if(original){
      try{ original.click(); return true; }catch(e){}
    }
    return false;
  }

  function active(label){
    document.querySelectorAll('.v624-menu-btn').forEach(btn=>{
      btn.classList.toggle('v624-active', btn.dataset.label === label);
    });
    window.__v624Active = label;
  }

  function build(){
    if(loginVisible()) return false;
    const side=sidebar();
    if(!side) return false;
    if(side.dataset.v624Instant === '1') return true;

    window.__v624Originals = originalMap(side);

    const header=keepHeader(side);
    side.innerHTML='';
    header.forEach(h=>side.appendChild(h));

    const root=document.createElement('div');
    root.className='v624-menu-root';

    const groups={};
    ['OPERATIVA','GESTIÓN','ADMINISTRACIÓN','SISTEMA'].forEach(g=>{
      const wrap=document.createElement('div');
      wrap.className='v624-menu-group';

      const title=document.createElement('div');
      title.className='v624-menu-title';
      title.textContent=g;

      const body=document.createElement('div');
      body.className='v624-menu-body';

      wrap.appendChild(title);
      wrap.appendChild(body);
      root.appendChild(wrap);
      groups[g]=body;
    });

    MENU.forEach(spec=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='v624-menu-btn';
      btn.textContent=spec.l;
      btn.dataset.label=spec.l;
      btn.addEventListener('click', ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        active(spec.l); // instantáneo antes de cargar vista
        callDirect(spec);
      });
      groups[spec.g].appendChild(btn);
    });

    side.appendChild(root);
    side.dataset.v624Instant='1';

    detectActive();
    return true;
  }

  function detectActive(){
    const content=document.getElementById('content') || document.querySelector('#main') || document.body;
    const t=n(content.textContent);

    if(t.includes('calendario')) return active('Calendario de Eventos');
    if(t.includes('albaran')) return active('Albaranes Evento');
    if(t.includes('control diario')) return active('Control Diario');
    if(t.includes('gps')) return active('GPS Live');
    if(t.includes('cliente')) return active('Clientes');
    if(t.includes('operario')) return active('Operarios');
    if(t.includes('document')) return active('Documentación');
    if(t.includes('tarifa')) return active('Tarifas');
    if(t.includes('finanza')) return active('Finanzas Pro');
    if(t.includes('informe')) return active('Informes PDF');
    if(t.includes('vista operario')) return active('Vista Operario');
    if(t.includes('contrasena') || t.includes('password')) return active('Contraseñas');
    if(t.includes('ajuste') || t.includes('config')) return active('Ajustes ERP');
    if(t.includes('dashboard')) return active('Dashboard');
  }

  // Construcción inicial solamente.
  setTimeout(build, 250);
  setTimeout(build, 900);
  setTimeout(build, 1800);

  // Si login crea sidebar nuevo, construir una vez. No reconstruye en cada click.
  if(!window.__v624Observer){
    window.__v624Observer=true;
    const obs=new MutationObserver(()=>{
      const side=sidebar();
      if(side && side.dataset.v624Instant !== '1' && !loginVisible()){
        setTimeout(build, 80);
      }
    });
    obs.observe(document.body,{childList:true,subtree:true});
  }

  // Detectar activo solo tras navegación, con bajo impacto.
  document.addEventListener('click', ()=>{
    setTimeout(detectActive, 350);
  }, true);
})();


// ---------- V62.5 SIDEBAR SINGLE ACTIVE FIX ----------
// Solo corrige estado visual: un único menú activo/blanco cada vez.
// No toca navegación, calendario, login, sync ni formularios.

(function(){
  function cleanActiveV625(){
    const selectors = [
      '.v624-menu-btn',
      '.v623-menu-btn',
      '.v622-menu-btn',
      '.v621-menu-btn',
      '.v620-menu-item',
      '.sidebar button',
      '.sidebar a',
      'aside button',
      'aside a',
      'nav button',
      'nav a'
    ].join(',');

    document.querySelectorAll(selectors).forEach(el=>{
      el.classList.remove(
        'v624-active',
        'v623-active',
        'v622-active',
        'v621-active',
        'v620-active',
        'active',
        'selected',
        'current',
        'menu-active-calendar-v584',
        'menu-calendar-active-v586',
        'dashboard-active-v586',
        'v591-menu-active',
        'v591-menu-inactive',
        'v59-menu-active'
      );
      el.removeAttribute('aria-current');

      // Limpia estilos inline que puedan dejar blanco otro botón.
      try{
        if(!el.dataset.v625KeepStyle){
          el.style.background = '';
          el.style.color = '';
          el.style.boxShadow = '';
        }
      }catch(e){}
    });
  }

  function setOneActiveV625(btn){
    cleanActiveV625();
    if(!btn) return;

    btn.classList.add('v625-active');

    // Mantener compatibilidad con el menú actual V62.4.
    if(btn.classList.contains('v624-menu-btn')) btn.classList.add('v624-active');

    btn.setAttribute('aria-current','page');
  }

  if(!window.__v625SingleActiveClick){
    window.__v625SingleActiveClick = true;
    document.addEventListener('click', ev=>{
      const btn = ev.target.closest && ev.target.closest('.v624-menu-btn,.v623-menu-btn,.v622-menu-btn,.v621-menu-btn,.v620-menu-item,.sidebar button,.sidebar a,aside button,aside a,nav button,nav a');
      if(!btn) return;

      const text = (btn.textContent || '').toLowerCase();
      const isMenu = [
        'dashboard','calendario','albaranes','control diario','gps','clientes','operarios',
        'documentación','documentacion','tarifas','finanzas','informes','vista operario',
        'contraseñas','contrasenas','ajustes'
      ].some(k=>text.includes(k));

      if(!isMenu) return;

      setOneActiveV625(btn);

      // Refuerzo después de que la vista pinte y otros scripts intenten marcar otro menú.
      setTimeout(()=>setOneActiveV625(btn), 80);
      setTimeout(()=>setOneActiveV625(btn), 300);
    }, true);
  }

  // Corrige cualquier doble activo que quede ya pintado.
  setTimeout(()=>{
    const active = document.querySelector('.v624-menu-btn.v624-active,.v623-menu-btn.v623-active,.v622-menu-btn.v622-active,.v625-active');
    if(active) setOneActiveV625(active);
  }, 800);
})();


// ---------- V62.6 SIDEBAR GLOBAL SINGLE ACTIVE ----------
// Corrige TODOS los menús: nunca puede quedar más de un botón blanco/activo.
// No toca navegación, calendario, login, sync ni formularios.

(function(){
  const MENU_WORDS_V626 = [
    'dashboard',
    'calendario',
    'albaranes',
    'albaran',
    'control diario',
    'gps',
    'clientes',
    'cliente',
    'operarios',
    'operario',
    'documentación',
    'documentacion',
    'document',
    'tarifas',
    'tarifa',
    'finanzas',
    'finanza',
    'informes',
    'informe',
    'vista operario',
    'contraseñas',
    'contrasenas',
    'password',
    'ajustes',
    'ajuste',
    'erp'
  ];

  function norm626(v){
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  }

  function sidebar626(){
    return document.querySelector('.v624-menu-root')
      || document.querySelector('.v623-menu-root')
      || document.querySelector('.v622-menu-root')
      || document.querySelector('.sidebar')
      || document.querySelector('[class*="sidebar"]')
      || document.querySelector('aside')
      || document.querySelector('nav');
  }

  function isMenuButton626(el){
    if(!el) return false;
    const t = norm626(el.textContent);
    if(!t) return false;
    return MENU_WORDS_V626.some(w => t.includes(norm626(w)));
  }

  function allSidebarItems626(){
    const side = sidebar626();
    if(!side) return [];
    return [...side.querySelectorAll('button,a,[role="button"],.v624-menu-btn,.v623-menu-btn,.v622-menu-btn,.v621-menu-btn,.v620-menu-item')]
      .filter(isMenuButton626);
  }

  function hardClear626(){
    allSidebarItems626().forEach(el=>{
      el.classList.remove(
        'v626-active',
        'v625-active',
        'v624-active',
        'v623-active',
        'v622-active',
        'v621-active',
        'v620-active',
        'active',
        'selected',
        'current',
        'is-active',
        'router-link-active',
        'menu-active-calendar-v584',
        'menu-calendar-active-v586',
        'dashboard-active-v586',
        'v591-menu-active',
        'v59-menu-active'
      );
      el.removeAttribute('aria-current');
      try{
        el.style.background = '';
        el.style.color = '';
        el.style.boxShadow = '';
        el.style.filter = '';
      }catch(e){}
    });
  }

  function setOnly626(el){
    if(!el) return;
    hardClear626();
    el.classList.add('v626-active');

    // compatibilidad con el sidebar actual
    if(el.classList.contains('v624-menu-btn')) el.classList.add('v624-active');
    if(el.classList.contains('v623-menu-btn')) el.classList.add('v623-active');
    if(el.classList.contains('v622-menu-btn')) el.classList.add('v622-active');

    el.setAttribute('aria-current','page');
    window.__v626Current = norm626(el.textContent);
  }

  function findByText626(label){
    const n = norm626(label);
    return allSidebarItems626().find(el => norm626(el.textContent) === n)
      || allSidebarItems626().find(el => norm626(el.textContent).includes(n));
  }

  function fixFromContent626(){
    const txt = norm626((document.getElementById('content') || document.querySelector('#main') || document.body).textContent);
    let label = null;

    if(txt.includes('calendario')) label = 'Calendario de Eventos';
    else if(txt.includes('albaran')) label = 'Albaranes Evento';
    else if(txt.includes('control diario')) label = 'Control Diario';
    else if(txt.includes('gps')) label = 'GPS Live';
    else if(txt.includes('cliente')) label = 'Clientes';
    else if(txt.includes('operario')) label = 'Operarios';
    else if(txt.includes('document')) label = 'Documentación';
    else if(txt.includes('tarifa')) label = 'Tarifas';
    else if(txt.includes('finanza')) label = 'Finanzas Pro';
    else if(txt.includes('informe')) label = 'Informes PDF';
    else if(txt.includes('vista operario')) label = 'Vista Operario';
    else if(txt.includes('contrasena') || txt.includes('password')) label = 'Contraseñas';
    else if(txt.includes('ajuste') || txt.includes('erp') || txt.includes('config')) label = 'Ajustes ERP';
    else if(txt.includes('dashboard')) label = 'Dashboard';

    const el = label ? findByText626(label) : null;
    if(el) setOnly626(el);
  }

  if(!window.__v626ClickInstalled){
    window.__v626ClickInstalled = true;

    document.addEventListener('pointerdown', ev=>{
      const el = ev.target.closest && ev.target.closest('button,a,[role="button"],.v624-menu-btn,.v623-menu-btn,.v622-menu-btn,.v621-menu-btn,.v620-menu-item');
      if(!isMenuButton626(el)) return;
      setOnly626(el);
    }, true);

    document.addEventListener('click', ev=>{
      const el = ev.target.closest && ev.target.closest('button,a,[role="button"],.v624-menu-btn,.v623-menu-btn,.v622-menu-btn,.v621-menu-btn,.v620-menu-item');
      if(!isMenuButton626(el)) return;

      setOnly626(el);

      // después de que otros scripts intenten marcar otro, lo limpiamos otra vez
      setTimeout(()=>setOnly626(el), 20);
      setTimeout(()=>setOnly626(el), 120);
      setTimeout(()=>setOnly626(el), 350);
    }, true);
  }

  // Limpia estados heredados al cargar
  setTimeout(fixFromContent626, 800);
  setTimeout(fixFromContent626, 1800);

})();


// ---------- V62.7 PERSISTENT DATA FRONTEND ----------
async function checkPersistentDataV627(){
  try{
    const r = await fetch('/api/v627-data-status', {credentials:'same-origin', cache:'no-store', headers:{'Accept':'application/json'}});
    const j = await r.json();
    alert('Estado datos persistentes:\n\nDB: ' + j.db_path + '\nExiste: ' + j.exists + '\nTamaño: ' + j.size + ' bytes');
  }catch(e){
    alert('No se pudo comprobar persistencia: ' + e.message);
  }
}
async function backupNowV627(){
  try{
    const r = await fetch('/api/v627-backup-now', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Accept':'application/json'}});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'Error backup');
    alert('Backup creado correctamente:\n' + j.backup);
  }catch(e){
    alert('Error creando backup: ' + e.message);
  }
}


// ---------- V62.8 REAL OPERATORS IMPORT FRONTEND ----------
async function importRealOperatorsV628(){
  try{
    const r = await fetch('/api/v628/import-real-operators', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Accept':'application/json'}});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'Error importando operarios');
    alert(`Operarios reales importados.\n\nDemos borrados: ${j.deleted_demo}\nNuevos: ${j.imported}\nActualizados: ${j.updated}\nTotal plantilla: ${j.total}`);
    if(typeof viewUsers === 'function') viewUsers();
    else if(typeof viewOperators === 'function') viewOperators();
  }catch(e){
    alert('Error importando operarios reales: ' + e.message);
  }
}


// ---------- V62.9 REAL CLIENTS IMPORT FRONTEND ----------
async function importRealClientsV629(){
  try{
    const r = await fetch('/api/v629/import-real-clients', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Accept':'application/json'}});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'Error importando clientes');
    alert(`Clientes reales importados.\n\nDemos borrados: ${j.deleted_demo}\nNuevos: ${j.imported}\nActualizados: ${j.updated}\nTotal Excel: ${j.total}`);
    if(typeof viewClients === 'function') viewClients();
  }catch(e){
    alert('Error importando clientes reales: ' + e.message);
  }
}


// ---------- V62.10 OPERATOR EDIT BUTTON FRONTEND ----------
function v6210Esc(v){
  if(typeof escV582 === 'function') return escV582(v);
  if(typeof esc === 'function') return esc(v);
  return String(v ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

async function v6210Fetch(path, opts={}){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer '+token;
    if(window.token) headers.Authorization = 'Bearer '+window.token;
  }catch(e){}
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...headers, ...(opts.headers||{})},
    body:opts.body,
    credentials:'same-origin',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML. No está entrando en la ruta de edición de operario.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data={ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}

function v6210RoleOptions(roles, selectedId, selectedName){
  const opts = ['<option value="">Sin rol fijo</option>'];
  roles.forEach(r=>{
    const id = r.id;
    const name = r.role || r.name || r.title || '';
    const selected = String(selectedId||'') === String(id) || (!selectedId && selectedName && String(selectedName).toLowerCase() === String(name).toLowerCase());
    opts.push(`<option value="${v6210Esc(id)}" data-name="${v6210Esc(name)}" ${selected?'selected':''}>${v6210Esc(name)}</option>`);
  });
  return opts.join('');
}

async function openOperatorEditV6210(id){
  id = Number(id || 0);
  if(!id){
    alert('No se ha podido identificar el operario.');
    return;
  }

  let data;
  try{
    data = await v6210Fetch('/api/v6210/operators/'+id+'/edit');
  }catch(e){
    alert('Error abriendo edición de operario: '+e.message);
    return;
  }

  const o = data.operator || {};
  const roles = data.roles || [];
  const fullAddress = o.full_address || o.address || '';
  const iban = o.iban || o.bank_iban || '';

  const root = document.getElementById('modalRoot') || document.body;
  root.innerHTML = `
    <div class="modal-back">
      <div class="modal v6210-operator-modal">
        <div class="modal-head">
          <div>
            <h2>Editar operario</h2>
            <p class="muted">${v6210Esc((o.first_name||'')+' '+(o.last_name||''))}${o.nickname ? ' · '+v6210Esc(o.nickname) : ''}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="operatorEditFormV6210">
          <div class="v6210-section">
            <h3>Datos principales</h3>
            <div class="v6210-grid">
              <input class="field span-4" name="first_name" value="${v6210Esc(o.first_name||'')}" placeholder="Nombre" required>
              <input class="field span-4" name="last_name" value="${v6210Esc(o.last_name||'')}" placeholder="Apellidos" required>
              <input class="field span-4" name="nickname" value="${v6210Esc(o.nickname||'')}" placeholder="Apodo / mote">
              <input class="field span-3" name="dni" value="${v6210Esc(o.dni||'')}" placeholder="DNI / NIE">
              <input class="field span-3" name="phone" value="${v6210Esc(o.phone||'')}" placeholder="Teléfono">
              <input class="field span-4" name="email" value="${v6210Esc(o.email||'')}" placeholder="Email">
              <select class="field span-2" name="active">
                <option value="1" ${Number(o.active ?? 1)===1?'selected':''}>Activo</option>
                <option value="0" ${Number(o.active ?? 1)===0?'selected':''}>Inactivo</option>
              </select>
              <input class="field span-12" name="full_address" value="${v6210Esc(fullAddress)}" placeholder="Dirección completa">
            </div>
          </div>

          <div class="v6210-section">
            <h3>Datos laborales y bancarios</h3>
            <div class="v6210-grid">
              <input class="field span-4" name="social_security_number" value="${v6210Esc(o.social_security_number||'')}" placeholder="Nº Seguridad Social">
              <input class="field span-4" name="bank_name" value="${v6210Esc(o.bank_name||'')}" placeholder="Nombre del banco">
              <input class="field span-4" name="iban" value="${v6210Esc(iban)}" placeholder="IBAN">
              <select class="field span-6" name="operator_role_id" onchange="this.form.operator_role_name.value=this.options[this.selectedIndex].dataset.name||''">
                ${v6210RoleOptions(roles, o.operator_role_id, o.operator_role_name)}
              </select>
              <input class="field span-6" name="operator_role_name" value="${v6210Esc(o.operator_role_name||'')}" placeholder="Rol de operario">
            </div>
          </div>

          <div class="v6210-section">
            <h3>EPIs, PRL y tallas</h3>
            <div class="v6210-grid">
              <input class="field span-3" name="shirt_size" value="${v6210Esc(o.shirt_size||'')}" placeholder="Talla camiseta">
              <input class="field span-3" name="pants_size" value="${v6210Esc(o.pants_size||'')}" placeholder="Talla pantalón">
              <input class="field span-3" name="shoe_size" value="${v6210Esc(o.shoe_size||'')}" placeholder="Talla zapatos">
              <div class="field span-3" style="display:flex;gap:14px;align-items:center">
                <label><input type="checkbox" name="epis_delivered" value="1" ${Number(o.epis_delivered||0)===1?'checked':''}> EPIs entregados</label>
                <label><input type="checkbox" name="has_prl" value="1" ${Number(o.has_prl||0)===1?'checked':''}> PRL</label>
              </div>
            </div>
          </div>

          <div class="v6210-section">
            <h3>Contacto emergencia</h3>
            <div class="v6210-grid">
              <input class="field span-6" name="emergency_contact_name" value="${v6210Esc(o.emergency_contact_name||'')}" placeholder="Contacto emergencia">
              <input class="field span-6" name="emergency_contact_phone" value="${v6210Esc(o.emergency_contact_phone||'')}" placeholder="Teléfono emergencia">
            </div>
          </div>

          <div class="v6210-section">
            <h3>Notas internas</h3>
            <textarea class="field" name="internal_notes" placeholder="Notas internas">${v6210Esc(o.internal_notes || o.notes || '')}</textarea>
          </div>

          <div class="actions">
            <button class="v6210-save" type="submit">Guardar cambios</button>
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('operatorEditFormV6210').onsubmit = async ev=>{
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const payload = Object.fromEntries(fd);
    payload.epis_delivered = ev.target.epis_delivered.checked ? 1 : 0;
    payload.has_prl = ev.target.has_prl.checked ? 1 : 0;

    try{
      await v6210Fetch('/api/v6210/operators/'+id+'/edit', {
        method:'POST',
        body:JSON.stringify(payload)
      });
      if(typeof v534Toast === 'function') v534Toast('Operario actualizado correctamente');
      try{ closeWizard(); }catch(e){ root.innerHTML=''; }
      if(typeof viewUsers === 'function') viewUsers();
      else if(typeof viewOperators === 'function') viewOperators();
    }catch(e){
      alert('Error guardando operario: '+e.message);
    }
  };
}

function v6210ExtractOperatorIdFromElement(el){
  if(!el) return 0;
  const attrs = [
    el.dataset && (el.dataset.userId || el.dataset.operatorId || el.dataset.id),
    el.getAttribute && el.getAttribute('data-user-id'),
    el.getAttribute && el.getAttribute('data-operator-id'),
    el.getAttribute && el.getAttribute('data-id'),
    el.getAttribute && el.getAttribute('onclick')
  ].filter(Boolean).join(' ');

  let m = attrs.match(/(?:user|operator|id)?[^\d]*(\d+)/i);
  if(m) return Number(m[1]);

  const row = el.closest && el.closest('[data-user-id],[data-operator-id],[data-id],tr,.card,.operator-card,.user-card');
  if(row){
    const rowAttrs = [
      row.dataset && (row.dataset.userId || row.dataset.operatorId || row.dataset.id),
      row.getAttribute && row.getAttribute('data-user-id'),
      row.getAttribute && row.getAttribute('data-operator-id'),
      row.getAttribute && row.getAttribute('data-id'),
      row.innerHTML
    ].filter(Boolean).join(' ');
    m = rowAttrs.match(/(?:user|operator|operario|id)[^\d]{0,20}(\d+)/i) || rowAttrs.match(/\/users\/(\d+)/i) || rowAttrs.match(/\/operators\/(\d+)/i);
    if(m) return Number(m[1]);
  }
  return 0;
}

function v6210PatchOperatorButtons(){
  const possibleContainers = [...document.querySelectorAll('tr,.card,.operator-card,.user-card,tbody > tr')];

  possibleContainers.forEach(row=>{
    const txt = (row.textContent || '').toLowerCase();
    if(!txt || !(txt.includes('operario') || txt.includes('dni') || txt.includes('iban') || txt.includes('documentos') || txt.includes('acciones'))) return;
    if(row.querySelector('.v6210-edit-operator-btn')) return;

    let id = v6210ExtractOperatorIdFromElement(row);
    if(!id){
      const btnWithId = [...row.querySelectorAll('button,a')].find(b=>v6210ExtractOperatorIdFromElement(b));
      id = v6210ExtractOperatorIdFromElement(btnWithId);
    }
    if(!id) return;

    const actionsCell = [...row.querySelectorAll('td,div')].reverse().find(c=>{
      const t = (c.textContent||'').toLowerCase();
      return t.includes('document') || t.includes('acciones') || c.querySelector('button,a');
    }) || row;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v6210-edit-operator-btn';
    btn.textContent = 'Editar';
    btn.onclick = ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openOperatorEditV6210(id);
    };
    actionsCell.appendChild(btn);
  });

  // También añade editar junto a botones existentes de documentos/carpeta si encuentra ID.
  document.querySelectorAll('button,a').forEach(b=>{
    const t = (b.textContent||'').toLowerCase();
    if(!(t.includes('document') || t.includes('carpeta'))) return;
    const parent = b.parentElement;
    if(!parent || parent.querySelector('.v6210-edit-operator-btn')) return;
    const id = v6210ExtractOperatorIdFromElement(b);
    if(!id) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v6210-edit-operator-btn';
    btn.textContent = 'Editar';
    btn.onclick = ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openOperatorEditV6210(id);
    };
    parent.insertBefore(btn, b);
  });
}

setInterval(v6210PatchOperatorButtons, 1200);

const __viewUsers_v6210 = typeof viewUsers === 'function' ? viewUsers : null;
if(__viewUsers_v6210){
  viewUsers = async function(){
    const r = await __viewUsers_v6210.apply(this, arguments);
    setTimeout(v6210PatchOperatorButtons, 200);
    setTimeout(v6210PatchOperatorButtons, 800);
    return r;
  };
}

const __viewOperators_v6210 = typeof viewOperators === 'function' ? viewOperators : null;
if(__viewOperators_v6210){
  viewOperators = async function(){
    const r = await __viewOperators_v6210.apply(this, arguments);
    setTimeout(v6210PatchOperatorButtons, 200);
    setTimeout(v6210PatchOperatorButtons, 800);
    return r;
  };
}


// ---------- V62.11 CLIENT EDIT BUTTON FIX FRONTEND ----------
function v6211Esc(v){
  if(typeof escV582 === 'function') return escV582(v);
  if(typeof esc === 'function') return esc(v);
  return String(v ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

async function v6211Fetch(path, opts={}){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    if(typeof token !== 'undefined' && token) headers.Authorization = 'Bearer '+token;
    if(window.token) headers.Authorization = 'Bearer '+window.token;
  }catch(e){}
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...headers, ...(opts.headers||{})},
    body:opts.body,
    credentials:'same-origin',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML. No está entrando en la ruta de edición de cliente.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data={ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}

async function openClientEditV6211(id){
  id = Number(id || 0);
  if(!id){
    alert('No se ha podido identificar el cliente.');
    return;
  }

  let data;
  try{
    data = await v6211Fetch('/api/v6211/clients/'+id+'/edit');
  }catch(e){
    alert('Error abriendo edición de cliente: '+e.message);
    return;
  }

  const c = data.client || {};
  const root = document.getElementById('modalRoot') || document.body;

  root.innerHTML = `
    <div class="modal-back">
      <div class="modal v6211-client-modal">
        <div class="modal-head">
          <div>
            <h2>Editar cliente</h2>
            <p class="muted">${v6211Esc(c.name || 'Cliente')}</p>
          </div>
          <button class="secondary" onclick="closeWizard()">Cerrar</button>
        </div>

        <form id="clientEditFormV6211">
          <div class="v6211-section">
            <h3>Datos del cliente</h3>
            <div class="v6211-grid">
              <input class="field span-4" name="name" value="${v6211Esc(c.name||'')}" placeholder="Cliente" required>
              <input class="field span-4" name="legal_name" value="${v6211Esc(c.legal_name||'')}" placeholder="Razón social">
              <input class="field span-4" name="cif" value="${v6211Esc(c.cif||'')}" placeholder="CIF/NIF">
              <input class="field span-4" name="contact_name" value="${v6211Esc(c.contact_name||'')}" placeholder="Persona contacto">
              <input class="field span-4" name="email" value="${v6211Esc(c.email||'')}" placeholder="Email">
              <input class="field span-4" name="phone" value="${v6211Esc(c.phone||'')}" placeholder="Teléfono">
              <input class="field span-8" name="address" value="${v6211Esc(c.address||'')}" placeholder="Dirección">
              <input class="field span-2" name="province" value="${v6211Esc(c.province||'')}" placeholder="Provincia">
              <select class="field span-2" name="active">
                <option value="1" ${Number(c.active ?? 1)===1?'selected':''}>Activo</option>
                <option value="0" ${Number(c.active ?? 1)===0?'selected':''}>Inactivo</option>
              </select>
            </div>
          </div>

          <div class="v6211-section">
            <h3>Observaciones</h3>
            <textarea class="field" name="notes" placeholder="Observaciones">${v6211Esc(c.notes||'')}</textarea>
          </div>

          <div class="actions">
            <button class="v6211-save" type="submit">Guardar cambios</button>
            <button type="button" class="secondary" onclick="closeWizard()">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('clientEditFormV6211').onsubmit = async ev=>{
    ev.preventDefault();
    const payload = Object.fromEntries(new FormData(ev.target));

    try{
      await v6211Fetch('/api/v6211/clients/'+id+'/edit', {
        method:'POST',
        body:JSON.stringify(payload)
      });
      if(typeof v534Toast === 'function') v534Toast('Cliente actualizado correctamente');
      try{ closeWizard(); }catch(e){ root.innerHTML=''; }
      if(typeof viewClients === 'function') viewClients();
    }catch(e){
      alert('Error guardando cliente: '+e.message);
    }
  };
}

function v6211ExtractClientId(el){
  if(!el) return 0;

  const attrs = [
    el.dataset && (el.dataset.clientId || el.dataset.id),
    el.getAttribute && el.getAttribute('data-client-id'),
    el.getAttribute && el.getAttribute('data-id'),
    el.getAttribute && el.getAttribute('onclick'),
    el.getAttribute && el.getAttribute('href')
  ].filter(Boolean).join(' ');

  let m = attrs.match(/(?:client|cliente|id)?[^\d]*(\d+)/i);
  if(m) return Number(m[1]);

  const row = el.closest && el.closest('[data-client-id],[data-id],tr,.card,.client-card,.cliente-card');
  if(row){
    const rowAttrs = [
      row.dataset && (row.dataset.clientId || row.dataset.id),
      row.getAttribute && row.getAttribute('data-client-id'),
      row.getAttribute && row.getAttribute('data-id'),
      row.innerHTML
    ].filter(Boolean).join(' ');
    m = rowAttrs.match(/(?:client|cliente|id)[^\d]{0,20}(\d+)/i) || rowAttrs.match(/\/clients\/(\d+)/i);
    if(m) return Number(m[1]);
  }

  return 0;
}

function v6211PatchClientEditButtons(){
  // Solo actuar cuando estamos en pantalla de Clientes.
  const bodyTxt = (document.body.textContent || '').toLowerCase();
  if(!bodyTxt.includes('cliente')) return;

  // Botones editar existentes dentro de clientes: forzar a cliente, no a evento.
  document.querySelectorAll('button,a').forEach(btn=>{
    const txt = (btn.textContent || '').toLowerCase().trim();
    if(txt !== 'editar' && txt !== 'editar cliente') return;

    const context = btn.closest('tr,.card,.client-card,.cliente-card,[data-client-id],[data-id]');
    if(!context) return;
    const ctxTxt = (context.textContent || '').toLowerCase();

    // Evita tocar botones de evento si por algún motivo se mezclan.
    const looksClient = ctxTxt.includes('cif') || ctxTxt.includes('razón') || ctxTxt.includes('razon') || ctxTxt.includes('cliente') || ctxTxt.includes('@') || context.closest('#clients,#clientes,.clients,.clientes');
    if(!looksClient) return;

    const id = v6211ExtractClientId(btn) || v6211ExtractClientId(context);
    if(!id) return;

    btn.removeAttribute('onclick');
    btn.href = 'javascript:void(0)';
    btn.classList.add('v6211-edit-client-btn');
    btn.textContent = 'Editar';
    btn.onclick = ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openClientEditV6211(id);
    };
  });

  // Si hay acciones pero falta botón editar, añadirlo.
  document.querySelectorAll('tr,.card,.client-card,.cliente-card,[data-client-id]').forEach(row=>{
    const txt = (row.textContent || '').toLowerCase();
    if(!txt || row.querySelector('.v6211-edit-client-btn')) return;
    const looksClient = txt.includes('cif') || txt.includes('razón') || txt.includes('razon') || txt.includes('cliente') || txt.includes('@');
    if(!looksClient) return;

    const id = v6211ExtractClientId(row);
    if(!id) return;

    const actions = [...row.querySelectorAll('td,div')].reverse().find(c=>c.querySelector('button,a') || (c.textContent||'').toLowerCase().includes('acciones')) || row;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'v6211-edit-client-btn';
    btn.textContent = 'Editar';
    btn.onclick = ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openClientEditV6211(id);
    };
    actions.prepend(btn);
  });
}

setInterval(v6211PatchClientEditButtons, 1200);

const __viewClients_v6211 = typeof viewClients === 'function' ? viewClients : null;
if(__viewClients_v6211){
  viewClients = async function(){
    const r = await __viewClients_v6211.apply(this, arguments);
    setTimeout(v6211PatchClientEditButtons, 200);
    setTimeout(v6211PatchClientEditButtons, 800);
    return r;
  };
}


// ---------- V62.12 OPERATOR EDIT ID FIX FRONTEND ----------
function v6212RowPayload(row, id){
  const text = row ? (row.textContent || '') : '';
  const html = row ? (row.innerHTML || '') : '';

  const dni = (text.match(/\b[XYZ]?\d{7,8}[A-Z]\b/i) || [])[0] || '';
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
  const phones = text.match(/(?:\+34\s*)?(?:\d[\s.-]*){9,}/g) || [];
  const phone = phones.map(p=>p.trim()).find(p=>p.replace(/\D/g,'').length >= 9) || '';

  return {
    id:Number(id||0),
    dni,
    email,
    phone,
    name:text.trim().replace(/\s+/g,' ').slice(0,300)
  };
}

async function openOperatorEditV6212FromPayload(payload){
  let data;
  try{
    data = await v6210Fetch('/api/v6212/operators/find-edit', {
      method:'POST',
      body:JSON.stringify(payload || {})
    });
  }catch(e){
    alert('Error abriendo edición de operario: '+e.message);
    return;
  }

  // Reutiliza el modal original V62.10, pero con el ID correcto encontrado por backend.
  const realId = Number((data.operator || {}).id || 0);
  if(!realId){
    alert('Error abriendo edición de operario: Operario no encontrado');
    return;
  }

  // Inyectamos una cache temporal para evitar que el endpoint antiguo falle por ID equivocado.
  try{
    window.__v6212LastOperatorData = data;
  }catch(e){}

  await openOperatorEditV6210(realId);
}

function v6212ExtractSafeId(el){
  if(!el) return 0;

  // Solo aceptar IDs de atributos explícitos. No coger DNI/teléfono del HTML.
  const explicit = [
    el.dataset && (el.dataset.userId || el.dataset.operatorId),
    el.getAttribute && el.getAttribute('data-user-id'),
    el.getAttribute && el.getAttribute('data-operator-id')
  ].filter(Boolean).join(' ');

  let m = explicit.match(/\b(\d{1,6})\b/);
  if(m) return Number(m[1]);

  const onclick = el.getAttribute && (el.getAttribute('onclick') || '');
  m = onclick.match(/(?:edit|operator|user|operario)[^\d]{0,40}(\d{1,6})/i);
  if(m) return Number(m[1]);

  const row = el.closest && el.closest('[data-user-id],[data-operator-id],tr,.card,.operator-card,.user-card');
  if(row){
    const rowExplicit = [
      row.dataset && (row.dataset.userId || row.dataset.operatorId),
      row.getAttribute && row.getAttribute('data-user-id'),
      row.getAttribute && row.getAttribute('data-operator-id')
    ].filter(Boolean).join(' ');
    m = rowExplicit.match(/\b(\d{1,6})\b/);
    if(m) return Number(m[1]);
  }

  return 0;
}

// Sobrescribir el extractor anterior para que no confunda DNI/teléfono con ID.
v6210ExtractOperatorIdFromElement = v6212ExtractSafeId;

// Repatch fuerte de botones editar de operarios.
function v6212PatchOperatorEditButtons(){
  const bodyTxt = (document.body.textContent || '').toLowerCase();
  if(!bodyTxt.includes('operario')) return;

  document.querySelectorAll('.v6210-edit-operator-btn, button, a').forEach(btn=>{
    const txt = (btn.textContent || '').toLowerCase().trim();
    if(txt !== 'editar' && !btn.classList.contains('v6210-edit-operator-btn')) return;

    const row = btn.closest && btn.closest('tr,.card,.operator-card,.user-card,[data-user-id],[data-operator-id]');
    if(!row) return;

    const rowText = (row.textContent || '').toLowerCase();
    const looksOperator = rowText.includes('dni') || rowText.includes('iban') || rowText.includes('seguridad social') || rowText.includes('operario') || rowText.includes('@marfancrew.local') || row.closest('#users,#operators,#operarios,.users,.operators,.operarios');
    if(!looksOperator) return;

    const safeId = v6212ExtractSafeId(btn) || v6212ExtractSafeId(row);
    const payload = v6212RowPayload(row, safeId);

    btn.removeAttribute('onclick');
    btn.href = 'javascript:void(0)';
    btn.classList.add('v6210-edit-operator-btn');
    btn.textContent = 'Editar';
    btn.onclick = ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      openOperatorEditV6212FromPayload(payload);
    };
  });
}

setInterval(v6212PatchOperatorEditButtons, 900);

const __viewUsers_v6212 = typeof viewUsers === 'function' ? viewUsers : null;
if(__viewUsers_v6212){
  viewUsers = async function(){
    const r = await __viewUsers_v6212.apply(this, arguments);
    setTimeout(v6212PatchOperatorEditButtons, 150);
    setTimeout(v6212PatchOperatorEditButtons, 700);
    return r;
  };
}

const __viewOperators_v6212 = typeof viewOperators === 'function' ? viewOperators : null;
if(__viewOperators_v6212){
  viewOperators = async function(){
    const r = await __viewOperators_v6212.apply(this, arguments);
    setTimeout(v6212PatchOperatorEditButtons, 150);
    setTimeout(v6212PatchOperatorEditButtons, 700);
    return r;
  };
}


// ---------- V62.13 EVENT SAVE ADMIN AUTH FIX FRONTEND ----------
function v6213AuthHeaders(){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    const keys = ['token','authToken','marfan_token','adminToken','jwt'];
    let t = '';
    if(typeof token !== 'undefined' && token) t = token;
    if(window.token) t = window.token;
    for(const k of keys){
      if(!t && localStorage.getItem(k)) t = localStorage.getItem(k);
      if(!t && sessionStorage.getItem(k)) t = sessionStorage.getItem(k);
    }
    if(t){
      headers.Authorization = 'Bearer ' + t;
      headers['X-Admin-Token'] = t;
      headers['X-Auth-Token'] = t;
    }
  }catch(e){}
  return headers;
}

async function v6213Fetch(path, opts={}){
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...v6213AuthHeaders(), ...(opts.headers||{})},
    body:opts.body,
    credentials:'include',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data={ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}

function patchEventSaveV6213(){
  const form = document.getElementById('v612EventForm') || document.getElementById('v61EventForm') || document.getElementById('v60EditForm');
  if(!form || form.__v6213Patched) return;

  form.__v6213Patched = true;

  let id = Number(window.__lastEditingEventIdV6213 || 0);

  form.onsubmit = async ev=>{
    ev.preventDefault();

    const event = Object.fromEntries(new FormData(ev.target));
    const assignments = typeof v612CollectAssignments === 'function' ? v612CollectAssignments() : [];

    const possibleId = Number(event.id || event.event_id || id || window.__lastEditingEventIdV6213 || 0);
    const qs = possibleId ? '?id=' + encodeURIComponent(possibleId) : '';

    try{
      const saved = await v6213Fetch('/api/v6213/event-form-save' + qs, {
        method:'POST',
        body:JSON.stringify({event, assignments})
      });

      if(saved.google && saved.google.ok){
        if(typeof v534Toast === 'function') v534Toast('Evento guardado y sincronizado con Google');
      }else{
        if(typeof v534Toast === 'function') v534Toast('Evento guardado');
      }

      try{ closeWizard(); }catch(e){ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; }
      if(typeof showCalendarV582 === 'function') await showCalendarV582();
      else if(typeof viewCalendar === 'function') await viewCalendar();
    }catch(err){
      alert('Error guardando evento: ' + err.message);
    }
  };
}

if(typeof openV612EventForm === 'function' && !openV612EventForm.__v6213Wrapped){
  const oldOpenV612V6213 = openV612EventForm;
  openV612EventForm = async function(id=0){
    window.__lastEditingEventIdV6213 = Number(id || 0);
    const r = await oldOpenV612V6213.apply(this, arguments);
    setTimeout(patchEventSaveV6213, 100);
    setTimeout(patchEventSaveV6213, 500);
    return r;
  };
  openV612EventForm.__v6213Wrapped = true;

  window.openV612EventForm = openV612EventForm;
  window.openEditEventV60 = openV612EventForm;
  window.editEventV582 = openV612EventForm;
  window.editEventV587 = openV612EventForm;
  window.editEventV593 = openV612EventForm;
  window.editCalendarEventV58 = openV612EventForm;
  window.editCalendarEventV576 = openV612EventForm;
}

setInterval(patchEventSaveV6213, 1000);


// ---------- V62.14 OPERATOR PHOTO DOCS TEAM LEAD FRONTEND ----------
async function v6214UploadOperatorPhoto(id){
  const input = document.getElementById('operatorPhotoInputV6214');
  if(!input || !input.files || !input.files[0]) return;
  const fd = new FormData();
  fd.append('photo', input.files[0]);
  const r = await fetch('/api/v6214/operators/'+Number(id)+'/photo', {method:'POST', body:fd, credentials:'include'});
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || 'Error subiendo foto');
  const img = document.getElementById('operatorPhotoPreviewV6214');
  if(img) img.src = j.photo_url + '?v=' + Date.now();
  return j;
}
async function v6214UploadOperatorDocs(id){
  const input = document.getElementById('operatorDocsInputV6214');
  if(!input || !input.files || !input.files.length) return;
  const fd = new FormData();
  [...input.files].forEach(f=>fd.append('documents', f));
  fd.append('doc_type', document.getElementById('operatorDocTypeV6214')?.value || '');
  const r = await fetch('/api/v6214/operators/'+Number(id)+'/documents', {method:'POST', body:fd, credentials:'include'});
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || 'Error subiendo documentos');
  await v6214LoadOperatorDocs(id);
  return j;
}
async function v6214LoadOperatorDocs(id){
  const box = document.getElementById('operatorDocsListV6214');
  if(!box) return;
  try{
    const r = await fetch('/api/v6214/operators/'+Number(id)+'/documents', {credentials:'include', cache:'no-store'});
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || 'Error');
    const docs = j.documents || [];
    box.innerHTML = docs.length ? docs.map(d=>`
      <div class="v6214-doc-item">
        <div><b>${v6210Esc(d.original_name || d.filename || 'Documento')}</b><br><small>${v6210Esc(d.doc_type || '')} · ${v6210Esc(d.uploaded_at || '')}</small></div>
        <div style="display:flex;gap:8px">
          <a class="secondary" href="${v6210Esc(d.url)}" target="_blank">Ver</a>
          <button type="button" class="danger" onclick="v6214DeleteOperatorDoc(${Number(d.id)}, ${Number(id)})">Borrar</button>
        </div>
      </div>`).join('') : '<p class="muted">Sin documentos subidos.</p>';
  }catch(e){ box.innerHTML = '<p class="muted">No se pudieron cargar documentos.</p>'; }
}
async function v6214DeleteOperatorDoc(docId, operatorId){
  if(!confirm('¿Borrar este documento?')) return;
  const r = await fetch('/api/v6214/operator-documents/'+Number(docId), {method:'DELETE', credentials:'include'});
  const j = await r.json();
  if(!j.ok) return alert(j.error || 'Error borrando documento');
  await v6214LoadOperatorDocs(operatorId);
}

const __openOperatorEditV6210_v6214 = typeof openOperatorEditV6210 === 'function' ? openOperatorEditV6210 : null;
if(__openOperatorEditV6210_v6214 && !openOperatorEditV6210.__v6214Wrapped){
  openOperatorEditV6210 = async function(id){
    await __openOperatorEditV6210_v6214.apply(this, arguments);
    setTimeout(async ()=>{
      const form = document.getElementById('operatorEditFormV6210');
      if(!form || form.__v6214Enhanced) return;
      form.__v6214Enhanced = true;
      let op = {};
      try{ op = (await v6210Fetch('/api/v6210/operators/'+Number(id)+'/edit')).operator || {}; }catch(e){}
      const firstSection = form.querySelector('.v6210-section');
      if(firstSection){
        const block = document.createElement('div');
        block.className = 'v6210-section';
        block.innerHTML = `<h3>Fotografía del operario</h3>
          <div class="v6214-photo-box">
            <img id="operatorPhotoPreviewV6214" class="v6214-photo-preview" src="${op.photo_url ? v6210Esc(op.photo_url) : ''}" alt="Foto operario">
            <div><input class="field" id="operatorPhotoInputV6214" type="file" accept="image/*"><p class="muted">Sube una fotografía del operario.</p></div>
          </div>`;
        form.insertBefore(block, firstSection);
      }
      const laboral = [...form.querySelectorAll('.v6210-section')].find(s=>(s.textContent||'').toLowerCase().includes('datos laborales'));
      if(laboral && !laboral.querySelector('[name="is_team_lead"]')){
        const div = document.createElement('div');
        div.className = 'v6214-teamlead';
        div.innerHTML = `<label><input type="checkbox" name="is_team_lead" value="1" ${Number(op.is_team_lead || op.team_lead || 0)===1?'checked':''}> Puede ser / es Jefe de equipo</label>`;
        laboral.appendChild(div);
      }
      const docs = document.createElement('div');
      docs.className = 'v6210-section';
      docs.innerHTML = `<h3>Documentos del operario</h3>
        <div class="v6210-grid">
          <select class="field span-3" id="operatorDocTypeV6214"><option value="DNI/NIE">DNI/NIE</option><option value="Seguridad Social">Seguridad Social</option><option value="PRL">PRL</option><option value="EPIs">EPIs</option><option value="Contrato">Contrato</option><option value="Otros">Otros</option></select>
          <input class="field span-7" id="operatorDocsInputV6214" type="file" multiple>
          <button class="secondary span-2" type="button" onclick="v6214UploadOperatorDocs(${Number(id)}).catch(e=>alert(e.message))">Subir documentos</button>
        </div><div id="operatorDocsListV6214" class="v6214-doc-list"><p class="muted">Cargando documentos...</p></div>`;
      form.insertBefore(docs, form.querySelector('.actions'));
      await v6214LoadOperatorDocs(id);
      form.onsubmit = async ev=>{
        ev.preventDefault();
        const fd = new FormData(form);
        const payload = Object.fromEntries(fd);
        payload.epis_delivered = form.epis_delivered && form.epis_delivered.checked ? 1 : 0;
        payload.has_prl = form.has_prl && form.has_prl.checked ? 1 : 0;
        payload.is_team_lead = form.is_team_lead && form.is_team_lead.checked ? 1 : 0;
        payload.team_lead = payload.is_team_lead;
        try{
          await v6210Fetch('/api/v6210/operators/'+Number(id)+'/edit', {method:'POST', body:JSON.stringify(payload)});
          await v6214UploadOperatorPhoto(id);
          await v6214UploadOperatorDocs(id);
          if(typeof v534Toast === 'function') v534Toast('Operario actualizado correctamente');
          try{ closeWizard(); }catch(e){ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; }
          if(typeof viewUsers === 'function') viewUsers(); else if(typeof viewOperators === 'function') viewOperators();
        }catch(e){ alert('Error guardando operario: '+e.message); }
      };
    }, 250);
  };
  openOperatorEditV6210.__v6214Wrapped = true;
  window.openOperatorEditV6210 = openOperatorEditV6210;
}
function patchCreateOperatorPhotoDocsV6214(){
  const form = document.querySelector('form');
  if(!form || form.__v6214CreatePatched) return;
  const txt = (document.body.textContent||'').toLowerCase();
  if(!(txt.includes('crear operario') || txt.includes('nuevo operario'))) return;
  form.__v6214CreatePatched = true;
  const block = document.createElement('div');
  block.className = 'v6210-section';
  block.innerHTML = `<h3>Fotografía y documentos</h3><p class="muted">Primero guarda el operario. Después podrás subir fotografía y documentos desde Editar.</p><div class="v6214-teamlead"><label><input type="checkbox" name="is_team_lead" value="1"> Puede ser / es Jefe de equipo</label></div>`;
  const actions = form.querySelector('.actions');
  if(actions) form.insertBefore(block, actions); else form.appendChild(block);
}
setInterval(patchCreateOperatorPhotoDocsV6214, 1500);


// ---------- V62.15 PHOTO ICON + EVENT PERSISTENCE HARD FIX FRONTEND ----------
function v6215OperatorRowMatches(row, id){
  if(!row) return false;
  const html = row.innerHTML || '';
  const text = row.textContent || '';
  if(String(html).includes('data-user-id="'+id+'"') || String(html).includes("data-user-id='"+id+"'")) return true;
  if(String(html).includes('/operators/'+id) || String(html).includes('/users/'+id)) return true;
  return false;
}

async function v6215RefreshOperatorPhotoIcon(id, photoUrl){
  if(!id || !photoUrl) return;

  // Actualiza preview dentro del modal.
  const preview = document.getElementById('operatorPhotoPreviewV6214');
  if(preview) preview.src = photoUrl + '?v=' + Date.now();

  // Actualiza filas/listados visibles.
  const rows = [...document.querySelectorAll('tr,.card,.operator-card,.user-card,[data-user-id],[data-operator-id]')];
  rows.forEach(row=>{
    const dataId = row.dataset && (row.dataset.userId || row.dataset.operatorId);
    const match = String(dataId||'') === String(id) || v6215OperatorRowMatches(row, id);
    if(!match) return;

    let img = row.querySelector('img.v6215-operator-avatar,img.operator-avatar,img.user-avatar');
    if(!img){
      img = document.createElement('img');
      img.className = 'v6215-operator-avatar';
      const firstCell = row.querySelector('td,div') || row;
      firstCell.prepend(img);
    }
    img.src = photoUrl + '?v=' + Date.now();
  });
}

// Sobrescribir subida de foto para actualizar icono automáticamente.
const __v6214UploadOperatorPhoto_old_v6215 = typeof v6214UploadOperatorPhoto === 'function' ? v6214UploadOperatorPhoto : null;
if(__v6214UploadOperatorPhoto_old_v6215){
  v6214UploadOperatorPhoto = async function(id){
    const result = await __v6214UploadOperatorPhoto_old_v6215(id);
    if(result && result.photo_url){
      await v6215RefreshOperatorPhotoIcon(id, result.photo_url);
    }
    return result;
  };
  window.v6214UploadOperatorPhoto = v6214UploadOperatorPhoto;
}

async function v6215Fetch(path, opts={}){
  const headers = {'Content-Type':'application/json','Accept':'application/json'};
  try{
    const keys = ['token','authToken','marfan_token','adminToken','jwt'];
    let t = '';
    if(typeof token !== 'undefined' && token) t = token;
    if(window.token) t = window.token;
    for(const k of keys){
      if(!t && localStorage.getItem(k)) t = localStorage.getItem(k);
      if(!t && sessionStorage.getItem(k)) t = sessionStorage.getItem(k);
    }
    if(t){
      headers.Authorization = 'Bearer ' + t;
      headers['X-Admin-Token'] = t;
      headers['X-Auth-Token'] = t;
    }
  }catch(e){}
  const r = await fetch(new URL(path, window.location.origin).toString(), {
    method:opts.method || 'GET',
    headers:{...headers, ...(opts.headers||{})},
    body:opts.body,
    credentials:'include',
    cache:'no-store'
  });
  const text = await r.text();
  if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML.');
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch(e){ data={ok:false,error:text}; }
  if(!r.ok || data.ok === false) throw new Error(data.error || text || 'HTTP '+r.status);
  return data;
}

// Guardado hard de evento: guarda en events + event_extra_data + Google.
function patchEventSaveV6215(){
  const form = document.getElementById('v612EventForm') || document.getElementById('v61EventForm') || document.getElementById('v60EditForm');
  if(!form || form.__v6215Patched) return;
  form.__v6215Patched = true;

  let id = Number(window.__lastEditingEventIdV6213 || window.__lastEditingEventIdV6215 || 0);

  form.onsubmit = async ev=>{
    ev.preventDefault();
    const event = Object.fromEntries(new FormData(ev.target));
    const assignments = typeof v612CollectAssignments === 'function' ? v612CollectAssignments() : [];

    const possibleId = Number(event.id || event.event_id || id || window.__lastEditingEventIdV6213 || window.__lastEditingEventIdV6215 || 0);
    const qs = possibleId ? '?id=' + encodeURIComponent(possibleId) : '';

    try{
      const saved = await v6215Fetch('/api/v6215/event-form-save-hard' + qs, {
        method:'POST',
        body:JSON.stringify({event, assignments})
      });

      if(typeof v534Toast === 'function'){
        v534Toast(saved.google && saved.google.ok ? 'Evento guardado, persistido y sincronizado' : 'Evento guardado y persistido');
      }

      try{ closeWizard(); }catch(e){ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; }
      if(typeof showCalendarV582 === 'function') await showCalendarV582();
      else if(typeof viewCalendar === 'function') await viewCalendar();
    }catch(err){
      alert('Error guardando evento: ' + err.message);
    }
  };
}

// Captura ID de evento y restaura extra al abrir.
if(typeof openV612EventForm === 'function' && !openV612EventForm.__v6215Wrapped){
  const oldOpenV612V6215 = openV612EventForm;
  openV612EventForm = async function(id=0){
    window.__lastEditingEventIdV6215 = Number(id || 0);
    if(Number(id)){
      try{ await v6215Fetch('/api/v6215/event-extra/'+Number(id)); }catch(e){}
    }
    const r = await oldOpenV612V6215.apply(this, arguments);
    setTimeout(patchEventSaveV6215, 100);
    setTimeout(patchEventSaveV6215, 500);
    return r;
  };
  openV612EventForm.__v6215Wrapped = true;

  window.openV612EventForm = openV612EventForm;
  window.openEditEventV60 = openV612EventForm;
  window.editEventV582 = openV612EventForm;
  window.editEventV587 = openV612EventForm;
  window.editEventV593 = openV612EventForm;
  window.editCalendarEventV58 = openV612EventForm;
  window.editCalendarEventV576 = openV612EventForm;
}

setInterval(patchEventSaveV6215, 1000);


// ---------- V62.16 AUTOMATIC RESTORE FRONTEND ----------
async function checkAutoRestoreV6216(){
  try{
    const r = await fetch('/api/v6216-auto-restore-status', {credentials:'include', cache:'no-store', headers:{'Accept':'application/json'}});
    const j = await r.json();
    alert(
      'Auto-restore V62.16\n\n' +
      'DB: ' + j.db_path + '\n' +
      'Data: ' + j.data_dir + '\n' +
      'Uploads: ' + j.uploads_dir + '\n' +
      'Backups: ' + (j.backups ? j.backups.length : 0) + '\n\n' +
      'Estado: ' + JSON.stringify(j.status || {}, null, 2)
    );
  }catch(e){
    alert('No se pudo comprobar auto-restore: ' + e.message);
  }
}



// [V62.35] Bloque problemático de calendario desactivado.


// [V62.35] Bloque problemático de calendario desactivado.

// ---------- V62.19 EVENT OPERATORS ROLES HARD SAVE FRONTEND ----------
function v6219AssignmentRows(){
  return [...document.querySelectorAll('#v612Assignments .v612-assignment,.v612-assignment,#v61Assignments .v61-assignment,.v61-assignment,[data-assignment-row]')];
}
function v6219CollectAssignmentsHard(){
  const rows = v6219AssignmentRows();
  return rows.map(row=>{
    const get = names => {
      for(const n of names){
        const el = row.querySelector(`[name="${n}"],[data-field="${n}"]`);
        if(el) return el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
      }
      return '';
    };
    const roleSel = row.querySelector('[name="role_id"],[data-field="role_id"]');
    const roleOpt = roleSel && roleSel.options ? roleSel.options[roleSel.selectedIndex] : null;
    const serviceRole = get(['service_role','role_name','operator_role_name']) || (roleOpt ? (roleOpt.dataset.name || roleOpt.textContent || '') : '');
    return {
      user_id: Number(get(['user_id','operator_id','worker_id']) || 0),
      role_id: get(['role_id']) ? Number(get(['role_id'])) : null,
      service_role: String(serviceRole || '').trim(),
      shift_type: get(['shift_type','shift']) || 'D',
      planned_start: get(['planned_start','start_time','start']) || '',
      planned_end: get(['planned_end','end_time','end']) || '',
      hourly_rate: Number(get(['hourly_rate','rate','price']) || (roleOpt ? roleOpt.dataset.day || roleOpt.dataset.rate || 0 : 0) || 0),
      is_team_lead: Number(get(['is_team_lead','team_lead','lead']) || 0),
      status: 'asignado'
    };
  }).filter(a=>a.user_id);
}
async function v6219Fetch(path, opts={}){
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  try{ let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||''; if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;} }catch(e){}
  const r=await fetch(new URL(path,window.location.origin).toString(),{method:opts.method||'GET',headers:{...headers,...(opts.headers||{})},body:opts.body,credentials:'include',cache:'no-store'});
  const text=await r.text(); if(text.trim().startsWith('<')) throw new Error('La API ha devuelto HTML.');
  let data={}; try{data=text?JSON.parse(text):{}}catch(e){data={ok:false,error:text}}
  if(!r.ok||data.ok===false) throw new Error(data.error||text||'HTTP '+r.status); return data;
}
async function v6219SaveAssignmentsHard(eventId){
  const assignments = v6219CollectAssignmentsHard();
  if(!eventId) return {ok:false,count:assignments.length};
  return await v6219Fetch('/api/v6219/events/'+Number(eventId)+'/assignments-hard-save', {
    method:'POST',
    body:JSON.stringify({assignments})
  });
}
async function v6219LoadAssignmentsIntoForm(eventId){
  if(!eventId || typeof v612AddAssignment !== 'function') return;
  try{
    const data = await v6219Fetch('/api/v6219/events/'+Number(eventId)+'/assignments-full');
    const assignments = data.assignments || [];
    if(!assignments.length) return;
    const box = document.getElementById('v612Assignments');
    if(box) box.innerHTML = '';
    const users = window.__v612Users || [];
    const roles = window.__v612Roles || [];
    assignments.forEach(a=>{
      v612AddAssignment(users, roles, {
        user_id: a.user_id,
        role_id: a.role_id,
        service_role: a.service_role || a.resolved_role || '',
        shift_type: a.shift_type || 'D',
        planned_start: a.planned_start || '',
        planned_end: a.planned_end || '',
        hourly_rate: a.hourly_rate || 0,
        is_team_lead: a.is_team_lead || 0,
        status: a.status || 'asignado'
      });
    });
  }catch(e){ console.warn('[V62.19] load assignments', e.message); }
}
function patchEventSaveV6219(){
  const form=document.getElementById('v612EventForm')||document.getElementById('v61EventForm')||document.getElementById('v60EditForm');
  if(!form || form.__v6219Patched) return;
  form.__v6219Patched = true;
  const previousSubmit = form.onsubmit;
  form.onsubmit = async ev=>{
    ev.preventDefault();
    const eventId = Number(window.__lastEditingEventIdV6218 || window.__lastEditingEventIdV6217 || window.__lastEditingEventIdV6215 || window.__lastEditingEventIdV6213 || 0);
    const event = Object.fromEntries(new FormData(form));
    const assignments = v6219CollectAssignmentsHard();
    try{
      // Guardado completo de evento si existe la ruta V62.18
      const possibleId = Number(event.id || event.event_id || eventId || 0);
      let saved = null;
      if(possibleId){
        saved = await v6219Fetch('/api/v6218/event-save-real?id='+encodeURIComponent(possibleId), {method:'POST', body:JSON.stringify({event, assignments})});
        await v6219SaveAssignmentsHard(possibleId);
      }else{
        saved = await v6219Fetch('/api/v6218/event-save-real', {method:'POST', body:JSON.stringify({event, assignments})});
        if(saved && saved.event_id) await v6219SaveAssignmentsHard(saved.event_id);
      }
      if(typeof v534Toast === 'function') v534Toast('Evento guardado con operarios y roles');
      try{ closeWizard(); }catch(e){ const root=document.getElementById('modalRoot'); if(root) root.innerHTML=''; }
      if(typeof showCalendarV582 === 'function') await showCalendarV582(); else if(typeof viewCalendar === 'function') await viewCalendar();
    }catch(err){
      alert('Error guardando evento: '+err.message);
    }
  };
}
if(typeof openV612EventForm === 'function' && !openV612EventForm.__v6219Wrapped){
  const oldOpen = openV612EventForm;
  openV612EventForm = async function(id=0){
    window.__lastEditingEventIdV6219 = Number(id||0);
    const r = await oldOpen.apply(this, arguments);
    setTimeout(()=>v6219LoadAssignmentsIntoForm(id), 450);
    setTimeout(patchEventSaveV6219, 500);
    setTimeout(patchEventSaveV6219, 1000);
    return r;
  };
  openV612EventForm.__v6219Wrapped = true;
  window.openV612EventForm=openV612EventForm; window.openEditEventV60=openV612EventForm; window.editEventV582=openV612EventForm; window.editEventV587=openV612EventForm; window.editEventV593=openV612EventForm; window.editCalendarEventV58=openV612EventForm; window.editCalendarEventV576=openV612EventForm;
}
setInterval(patchEventSaveV6219, 1000);


// ---------- V62.20 PASSWORDS EASY EDIT FRONTEND ----------
function v6220Esc(v){if(typeof escV582==='function')return escV582(v);if(typeof esc==='function')return esc(v);return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
async function v6220Fetch(path,opts={}){const headers={'Content-Type':'application/json','Accept':'application/json'};try{let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||'';if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;}}catch(e){} const r=await fetch(new URL(path,window.location.origin).toString(),{method:opts.method||'GET',headers:{...headers,...(opts.headers||{})},body:opts.body,credentials:'include',cache:'no-store'});const text=await r.text();if(text.trim().startsWith('<'))throw new Error('La API ha devuelto HTML.');let data={};try{data=text?JSON.parse(text):{}}catch(e){data={ok:false,error:text}}if(!r.ok||data.ok===false)throw new Error(data.error||text||'HTTP '+r.status);return data;}
function v6220Copy(txt){navigator.clipboard?.writeText(txt||'').then(()=>{if(typeof v534Toast==='function')v534Toast('Copiado');}).catch(()=>alert(txt||''));}
function v6220Masked(p){return p?'••••••••••':'';}
async function viewPasswordsV6220(){
  if(typeof v6218SetPageTitle==='function')v6218SetPageTitle('Contraseñas');
  const root=document.getElementById('content')||document.querySelector('#main')||document.getElementById('app'); if(!root)return;
  root.innerHTML=`<div class="page"><div class="v6220-toolbar"><div><h1>Contraseñas</h1><p class="muted">Usuarios, contraseñas y accesos internos editables.</p></div><div style="display:flex;gap:10px;align-items:center"><input id="v6220Search" class="field v6220-search" placeholder="Buscar acceso, usuario, categoría..."><button class="v6220-primary" onclick="openPasswordEditV6220()">+ Añadir acceso</button></div></div><div id="v6220List"><p class="muted">Cargando contraseñas...</p></div></div>`;
  await loadPasswordsV6220(); document.getElementById('v6220Search').addEventListener('input',loadPasswordsV6220);
}
async function loadPasswordsV6220(){
  const box=document.getElementById('v6220List'); if(!box)return; let rows=[];
  try{rows=(await v6220Fetch('/api/v6220/passwords')).rows||[]}catch(e){box.innerHTML='<p class="muted">Error cargando: '+v6220Esc(e.message)+'</p>';return}
  const q=(document.getElementById('v6220Search')?.value||'').toLowerCase(); if(q)rows=rows.filter(r=>[r.title,r.service,r.category,r.username,r.url,r.notes].join(' ').toLowerCase().includes(q));
  box.innerHTML=rows.length?`<div class="v6220-grid">${rows.map(r=>`<div class="v6220-card"><h3>${v6220Esc(r.title)}</h3><div class="v6220-meta">${v6220Esc(r.category||'Sin categoría')} · ${v6220Esc(r.service||'')}</div><div class="v6220-row"><span>Usuario</span><code>${v6220Esc(r.username||'')}</code></div><div class="v6220-row"><span>Contraseña</span><code id="pass-${r.id}" data-pass="${v6220Esc(r.password||'')}">${v6220Esc(v6220Masked(r.password))}</code></div>${r.url?`<div class="v6220-row"><span>URL</span><a href="${v6220Esc(r.url)}" target="_blank">Abrir</a></div>`:''}${r.notes?`<p class="muted">${v6220Esc(r.notes)}</p>`:''}<div class="v6220-actions"><button class="v6220-edit" onclick="openPasswordEditV6220(${r.id})">Editar</button><button class="v6220-copy" onclick="v6220Copy('${String(r.username||'').replace(/'/g,"\\'")}')">Copiar usuario</button><button class="v6220-copy" onclick="v6220Copy(document.getElementById('pass-${r.id}').dataset.pass)">Copiar contraseña</button><button class="secondary" onclick="togglePasswordV6220(${r.id})">Mostrar/Ocultar</button><button class="danger" onclick="deletePasswordV6220(${r.id})">Borrar</button></div></div>`).join('')}</div>`:'<p class="muted">No hay accesos guardados todavía.</p>';
}
function togglePasswordV6220(id){const el=document.getElementById('pass-'+id);if(!el)return;const showing=el.dataset.showing==='1';el.textContent=showing?'••••••••••':el.dataset.pass;el.dataset.showing=showing?'0':'1';}
async function openPasswordEditV6220(id=0){
  let r={title:'',service:'',category:'',username:'',password:'',url:'',notes:'',active:1}; if(id){try{r=(await v6220Fetch('/api/v6220/passwords/'+id)).row}catch(e){return alert('Error abriendo acceso: '+e.message)}}
  const root=document.getElementById('modalRoot')||document.body; root.innerHTML=`<div class="modal-back"><div class="modal v6220-modal"><div class="modal-head"><div><h2>${id?'Editar acceso':'Añadir acceso'}</h2><p class="muted">Edita usuarios y contraseñas fácilmente.</p></div><button class="secondary" onclick="closeWizard()">Cerrar</button></div><form id="passwordFormV6220"><div class="v6220-form-grid"><input class="field span-6" name="title" value="${v6220Esc(r.title||'')}" placeholder="Nombre del acceso" required><input class="field span-3" name="service" value="${v6220Esc(r.service||'')}" placeholder="Servicio"><input class="field span-3" name="category" value="${v6220Esc(r.category||'')}" placeholder="Categoría"><input class="field span-6" name="username" value="${v6220Esc(r.username||'')}" placeholder="Usuario / email"><div class="span-6" style="display:flex;gap:8px"><input class="field" style="flex:1" id="v6220PasswordInput" type="password" name="password" value="${v6220Esc(r.password||'')}" placeholder="Contraseña"><button type="button" class="secondary" onclick="const i=document.getElementById('v6220PasswordInput');i.type=i.type==='password'?'text':'password'">Ver</button></div><input class="field span-12" name="url" value="${v6220Esc(r.url||'')}" placeholder="URL / enlace"><textarea class="field span-12" name="notes" placeholder="Notas">${v6220Esc(r.notes||'')}</textarea><select class="field span-3" name="active"><option value="1" ${Number(r.active??1)===1?'selected':''}>Activo</option><option value="0" ${Number(r.active??1)===0?'selected':''}>Inactivo</option></select></div><div class="actions"><button class="v6220-primary" type="submit">Guardar</button><button class="secondary" type="button" onclick="closeWizard()">Cancelar</button></div></form></div></div>`;
  document.getElementById('passwordFormV6220').onsubmit=async ev=>{ev.preventDefault();const payload=Object.fromEntries(new FormData(ev.target));try{await v6220Fetch('/api/v6220/passwords'+(id?'/'+id:''),{method:'POST',body:JSON.stringify(payload)});if(typeof v534Toast==='function')v534Toast('Acceso guardado');try{closeWizard()}catch(e){root.innerHTML=''}await viewPasswordsV6220();}catch(e){alert('Error guardando acceso: '+e.message)}};
}
async function deletePasswordV6220(id){if(!confirm('¿Borrar este acceso?'))return;try{await v6220Fetch('/api/v6220/passwords/'+id,{method:'DELETE'});await loadPasswordsV6220();}catch(e){alert('Error borrando: '+e.message)}}
window.viewPasswords=viewPasswordsV6220; window.viewContrasenas=viewPasswordsV6220;
document.addEventListener('click',ev=>{const btn=ev.target.closest&&ev.target.closest('button,a,.v624-menu-btn,.v623-menu-btn');if(!btn)return;const t=(btn.textContent||'').toLowerCase();if(t.includes('contraseña')||t.includes('contrasena')||t.includes('password'))setTimeout(viewPasswordsV6220,80);},true);


// ---------- V62.21 MAKE ADMIN FUNCTION FRONTEND ----------
async function v6221Fetch(path,opts={}){
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  try{let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||'';if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;}}catch(e){}
  const r=await fetch(new URL(path,window.location.origin).toString(),{method:opts.method||'GET',headers:{...headers,...(opts.headers||{})},body:opts.body,credentials:'include',cache:'no-store'});
  const text=await r.text();if(text.trim().startsWith('<'))throw new Error('La API ha devuelto HTML.');
  let data={};try{data=text?JSON.parse(text):{}}catch(e){data={ok:false,error:text}}
  if(!r.ok||data.ok===false)throw new Error(data.error||text||'HTTP '+r.status);return data;
}
async function v6221SaveAdminRole(id){
  const cb=document.getElementById('operatorIsAdminV6221'); if(!cb)return;
  await v6221Fetch('/api/v6221/users/'+Number(id)+'/admin-role',{method:'POST',body:JSON.stringify({is_admin:cb.checked?1:0})});
}
async function v6221EnhanceOperatorAdmin(id){
  const form=document.getElementById('operatorEditFormV6210'); if(!form||form.__v6221AdminEnhanced)return;
  form.__v6221AdminEnhanced=true;
  let data;try{data=await v6221Fetch('/api/v6221/users/'+Number(id)+'/admin-role')}catch(e){return}
  const laboral=[...form.querySelectorAll('.v6210-section')].find(s=>(s.textContent||'').toLowerCase().includes('datos laborales'))||form.querySelector('.v6210-section');
  if(laboral && !document.getElementById('operatorIsAdminV6221')){
    const box=document.createElement('div'); box.className='v6221-admin-box';
    box.innerHTML=`<label><input type="checkbox" id="operatorIsAdminV6221" name="is_admin" value="1" ${Number(data.is_admin||0)===1?'checked':''}> Hacer administrador del sistema</label><span class="v6221-admin-warning">El administrador puede entrar al ERP y modificar datos sensibles.</span>`;
    laboral.appendChild(box);
  }
  const previous=form.onsubmit;
  form.onsubmit=async ev=>{
    ev.preventDefault();
    try{
      const fd=new FormData(form); const payload=Object.fromEntries(fd);
      payload.epis_delivered=form.epis_delivered&&form.epis_delivered.checked?1:0;
      payload.has_prl=form.has_prl&&form.has_prl.checked?1:0;
      payload.is_team_lead=form.is_team_lead&&form.is_team_lead.checked?1:0;
      payload.team_lead=payload.is_team_lead;
      if(typeof v6210Fetch==='function') await v6210Fetch('/api/v6210/operators/'+Number(id)+'/edit',{method:'POST',body:JSON.stringify(payload)});
      if(typeof v6214UploadOperatorPhoto==='function') await v6214UploadOperatorPhoto(id);
      if(typeof v6214UploadOperatorDocs==='function') await v6214UploadOperatorDocs(id);
      await v6221SaveAdminRole(id);
      if(typeof v534Toast==='function')v534Toast('Operario actualizado correctamente');
      try{closeWizard()}catch(e){const root=document.getElementById('modalRoot');if(root)root.innerHTML='';}
      if(typeof viewUsers==='function')viewUsers();else if(typeof viewOperators==='function')viewOperators();
    }catch(e){alert('Error guardando operario: '+e.message);}
  };
}
if(typeof openOperatorEditV6210==='function'&&!openOperatorEditV6210.__v6221Wrapped){
  const old=openOperatorEditV6210;
  openOperatorEditV6210=async function(id){const r=await old.apply(this,arguments);setTimeout(()=>v6221EnhanceOperatorAdmin(id),350);setTimeout(()=>v6221EnhanceOperatorAdmin(id),900);return r;};
  openOperatorEditV6210.__v6221Wrapped=true; window.openOperatorEditV6210=openOperatorEditV6210;
}


// ---------- V62.22 PASSWORDS RESTORE ADMIN FIX FRONTEND ----------
async function restorePasswordsV6222(){
  try{
    const r = await v6220Fetch('/api/v6222/passwords-restore', {method:'POST'});
    if(typeof v534Toast === 'function') v534Toast('Contraseñas restauradas: ' + (r.total || 0));
    if(typeof loadPasswordsV6220 === 'function') await loadPasswordsV6220();
    return r;
  }catch(e){
    alert('Error restaurando contraseñas: ' + e.message);
  }
}
if(typeof viewPasswordsV6220 === 'function' && !viewPasswordsV6220.__v6222Wrapped){
  const oldViewPasswordsV6222 = viewPasswordsV6220;
  viewPasswordsV6220 = async function(){
    const r = await oldViewPasswordsV6222.apply(this, arguments);
    try{
      const status = await v6220Fetch('/api/v6222/passwords-restore-status');
      if(!status.total){
        await restorePasswordsV6222();
      }
      const toolbar = document.querySelector('.v6220-toolbar > div:last-child');
      if(toolbar && !document.getElementById('restorePasswordsBtnV6222')){
        const btn = document.createElement('button');
        btn.id = 'restorePasswordsBtnV6222';
        btn.className = 'secondary';
        btn.textContent = 'Restaurar accesos antiguos';
        btn.onclick = restorePasswordsV6222;
        toolbar.appendChild(btn);
      }
    }catch(e){}
    return r;
  };
  viewPasswordsV6220.__v6222Wrapped = true;
  window.viewPasswordsV6220 = viewPasswordsV6220;
  window.viewPasswords = viewPasswordsV6220;
  window.viewContrasenas = viewPasswordsV6220;
}



// [V62.35] Bloque problemático de calendario desactivado.

// ---------- V62.24 PASSWORD EDIT ISOLATION FIX ----------
// Evita que los botones Editar del menú Contraseñas llamen al editor de eventos.

(function(){
  function v6224IsPasswordsPage(){
    const txt = (document.body.textContent || '').toLowerCase();
    return !!document.querySelector('#v6220List,.v6220-grid,.v6220-card') || 
      (txt.includes('contraseñas') && txt.includes('usuarios, contraseñas'));
  }

  function v6224PatchPasswordEditButtons(){
    if(!v6224IsPasswordsPage()) return;

    document.querySelectorAll('.v6220-card').forEach(card=>{
      const editBtn = [...card.querySelectorAll('button,a')].find(b => (b.textContent || '').trim().toLowerCase() === 'editar');
      if(!editBtn) return;

      // Sacar ID del onclick original tipo openPasswordEditV6220(123)
      let id = 0;
      const html = editBtn.getAttribute('onclick') || '';
      let m = html.match(/openPasswordEditV6220\((\d+)\)/);
      if(m) id = Number(m[1]);

      if(!id){
        const pass = card.querySelector('[id^="pass-"]');
        if(pass){
          m = String(pass.id || '').match(/pass-(\d+)/);
          if(m) id = Number(m[1]);
        }
      }

      if(!id) return;

      editBtn.removeAttribute('onclick');
      editBtn.href = 'javascript:void(0)';
      editBtn.dataset.passwordId = String(id);
      editBtn.classList.add('v6224-password-edit-isolated');

      editBtn.onclick = function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if(typeof openPasswordEditV6220 === 'function'){
          openPasswordEditV6220(id);
        }else{
          alert('Editor de contraseñas no disponible');
        }
        return false;
      };
    });
  }

  // Captura antes que cualquier handler global de eventos.
  document.addEventListener('click', function(ev){
    const btn = ev.target.closest && ev.target.closest('.v6224-password-edit-isolated,.v6220-card button,.v6220-card a');
    if(!btn || !v6224IsPasswordsPage()) return;

    const txt = (btn.textContent || '').trim().toLowerCase();
    const card = btn.closest('.v6220-card');

    if(card && txt === 'editar'){
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      let id = Number(btn.dataset.passwordId || 0);
      if(!id){
        const pass = card.querySelector('[id^="pass-"]');
        const m = pass && String(pass.id || '').match(/pass-(\d+)/);
        if(m) id = Number(m[1]);
      }

      if(id && typeof openPasswordEditV6220 === 'function') openPasswordEditV6220(id);
      else alert('No se ha podido identificar esta contraseña');
      return false;
    }
  }, true);

  // Reforzar después de cargar/listar contraseñas.
  const oldLoadV6224 = typeof loadPasswordsV6220 === 'function' ? loadPasswordsV6220 : null;
  if(oldLoadV6224 && !loadPasswordsV6220.__v6224Wrapped){
    loadPasswordsV6220 = async function(){
      const r = await oldLoadV6224.apply(this, arguments);
      setTimeout(v6224PatchPasswordEditButtons, 50);
      setTimeout(v6224PatchPasswordEditButtons, 250);
      return r;
    };
    loadPasswordsV6220.__v6224Wrapped = true;
    window.loadPasswordsV6220 = loadPasswordsV6220;
  }

  const oldViewV6224 = typeof viewPasswordsV6220 === 'function' ? viewPasswordsV6220 : null;
  if(oldViewV6224 && !viewPasswordsV6220.__v6224Wrapped){
    viewPasswordsV6220 = async function(){
      const r = await oldViewV6224.apply(this, arguments);
      setTimeout(v6224PatchPasswordEditButtons, 80);
      setTimeout(v6224PatchPasswordEditButtons, 400);
      return r;
    };
    viewPasswordsV6220.__v6224Wrapped = true;
    window.viewPasswordsV6220 = viewPasswordsV6220;
    window.viewPasswords = viewPasswordsV6220;
    window.viewContrasenas = viewPasswordsV6220;
  }

  setInterval(v6224PatchPasswordEditButtons, 1000);
})();



// [V62.35] Bloque problemático de calendario desactivado.

// ---------- V62.26 ADMIN AUTH REPAIR + PASSWORD ACCESS FIX FRONTEND ----------
async function v6226Fetch(path,opts={}){
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  try{let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||localStorage.getItem('adminToken')||'';if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;}}catch(e){}
  const r=await fetch(new URL(path,window.location.origin).toString(),{method:opts.method||'GET',headers:{...headers,...(opts.headers||{})},body:opts.body,credentials:'include',cache:'no-store'});
  const text=await r.text();if(text.trim().startsWith('<'))throw new Error('La API ha devuelto HTML.');
  let data={};try{data=text?JSON.parse(text):{}}catch(e){data={ok:false,error:text}}
  if(!r.ok||data.ok===false)throw new Error(data.error||text||'HTTP '+r.status);return data;
}
async function loadPasswordsV6226(){
  const box=document.getElementById('v6220List');if(!box)return;let rows=[];
  try{rows=(await v6226Fetch('/api/v6226/passwords')).rows||[];}catch(e){box.innerHTML='<p class="muted">Error cargando: '+v6220Esc(e.message)+'</p>';return;}
  const q=(document.getElementById('v6220Search')?.value||'').toLowerCase();
  if(q)rows=rows.filter(r=>[r.title,r.service,r.category,r.username,r.url,r.notes].join(' ').toLowerCase().includes(q));
  box.innerHTML=rows.length?`<div class="v6220-grid">${rows.map(r=>`<div class="v6220-card"><h3>${v6220Esc(r.title)}</h3><div class="v6220-meta">${v6220Esc(r.category||'Sin categoría')} · ${v6220Esc(r.service||'')}</div><div class="v6220-row"><span>Usuario</span><code>${v6220Esc(r.username||'')}</code></div><div class="v6220-row"><span>Contraseña</span><code id="pass-${r.id}" data-pass="${v6220Esc(r.password||'')}">${v6220Esc(v6220Masked(r.password))}</code></div>${r.url?`<div class="v6220-row"><span>URL</span><a href="${v6220Esc(r.url)}" target="_blank">Abrir</a></div>`:''}${r.notes?`<p class="muted">${v6220Esc(r.notes)}</p>`:''}<div class="v6220-actions"><button class="v6220-edit v6224-password-edit-isolated" data-password-id="${r.id}" onclick="event.preventDefault();event.stopPropagation();openPasswordEditV6226(${r.id});return false;">Editar</button><button class="v6220-copy" onclick="v6220Copy('${String(r.username||'').replace(/'/g,"\\'")}')">Copiar usuario</button><button class="v6220-copy" onclick="v6220Copy(document.getElementById('pass-${r.id}').dataset.pass)">Copiar contraseña</button><button class="secondary" onclick="togglePasswordV6220(${r.id})">Mostrar/Ocultar</button><button class="danger" onclick="deletePasswordV6226(${r.id})">Borrar</button></div></div>`).join('')}</div>`:'<p class="muted">No hay accesos guardados todavía.</p>';
}
async function openPasswordEditV6226(id=0){
  let r={title:'',service:'',category:'',username:'',password:'',url:'',notes:'',active:1};
  if(id){try{r=(await v6226Fetch('/api/v6226/passwords/'+id)).row}catch(e){return alert('Error abriendo acceso: '+e.message)}}
  const root=document.getElementById('modalRoot')||document.body;
  root.innerHTML=`<div class="modal-back"><div class="modal v6220-modal"><div class="modal-head"><div><h2>${id?'Editar acceso':'Añadir acceso'}</h2><p class="muted">Edita usuarios y contraseñas fácilmente.</p></div><button class="secondary" onclick="closeWizard()">Cerrar</button></div><form id="passwordFormV6226"><div class="v6220-form-grid"><input class="field span-6" name="title" value="${v6220Esc(r.title||'')}" placeholder="Nombre del acceso" required><input class="field span-3" name="service" value="${v6220Esc(r.service||'')}" placeholder="Servicio"><input class="field span-3" name="category" value="${v6220Esc(r.category||'')}" placeholder="Categoría"><input class="field span-6" name="username" value="${v6220Esc(r.username||'')}" placeholder="Usuario / email"><div class="span-6" style="display:flex;gap:8px"><input class="field" style="flex:1" id="v6226PasswordInput" type="password" name="password" value="${v6220Esc(r.password||'')}" placeholder="Contraseña"><button type="button" class="secondary" onclick="const i=document.getElementById('v6226PasswordInput');i.type=i.type==='password'?'text':'password'">Ver</button></div><input class="field span-12" name="url" value="${v6220Esc(r.url||'')}" placeholder="URL / enlace"><textarea class="field span-12" name="notes" placeholder="Notas">${v6220Esc(r.notes||'')}</textarea><select class="field span-3" name="active"><option value="1" ${Number(r.active??1)===1?'selected':''}>Activo</option><option value="0" ${Number(r.active??1)===0?'selected':''}>Inactivo</option></select></div><div class="actions"><button class="v6220-primary" type="submit">Guardar</button><button class="secondary" type="button" onclick="closeWizard()">Cancelar</button></div></form></div></div>`;
  document.getElementById('passwordFormV6226').onsubmit=async ev=>{ev.preventDefault();const payload=Object.fromEntries(new FormData(ev.target));try{await v6226Fetch('/api/v6226/passwords'+(id?'/'+id:''),{method:'POST',body:JSON.stringify(payload)});if(typeof v534Toast==='function')v534Toast('Acceso guardado');try{closeWizard()}catch(e){root.innerHTML=''}await viewPasswordsV6226();}catch(e){alert('Error guardando acceso: '+e.message)}};
}
async function deletePasswordV6226(id){if(!confirm('¿Borrar este acceso?'))return;try{await v6226Fetch('/api/v6226/passwords/'+id,{method:'DELETE'});await loadPasswordsV6226();}catch(e){alert('Error borrando: '+e.message)}}
async function viewPasswordsV6226(){
  if(typeof v6218SetPageTitle==='function')v6218SetPageTitle('Contraseñas');
  const root=document.getElementById('content')||document.querySelector('#main')||document.getElementById('app');if(!root)return;
  root.innerHTML=`<div class="page"><div class="v6220-toolbar"><div><h1>Contraseñas</h1><p class="muted">Usuarios, contraseñas y accesos internos editables.</p></div><div style="display:flex;gap:10px;align-items:center"><input id="v6220Search" class="field v6220-search" placeholder="Buscar acceso, usuario, categoría..."><button class="secondary" onclick="v6226Fetch('/api/v6226-admin-repair-now',{method:'POST'}).then(()=>alert('Admin revisado correctamente')).catch(e=>alert(e.message))">Reparar admin</button><button class="v6220-primary" onclick="openPasswordEditV6226()">+ Añadir acceso</button></div></div><div id="v6220List"><p class="muted">Cargando contraseñas...</p></div></div>`;
  await loadPasswordsV6226();document.getElementById('v6220Search').addEventListener('input',loadPasswordsV6226);
}
window.loadPasswordsV6220=loadPasswordsV6226;window.openPasswordEditV6220=openPasswordEditV6226;window.deletePasswordV6220=deletePasswordV6226;window.viewPasswordsV6220=viewPasswordsV6226;window.viewPasswords=viewPasswordsV6226;window.viewContrasenas=viewPasswordsV6226;
document.addEventListener('click',ev=>{const btn=ev.target.closest&&ev.target.closest('button,a,.v624-menu-btn,.v623-menu-btn,.v622-menu-btn');if(!btn)return;const t=(btn.textContent||'').toLowerCase();if(t.includes('contraseña')||t.includes('contrasena')||t.includes('password')){ev.stopPropagation();setTimeout(viewPasswordsV6226,80);}},true);
setTimeout(()=>{v6226Fetch('/api/v6226-admin-repair-status').catch(()=>{});},2000);


// ---------- V62.27 USER ROLE SELECTOR FRONTEND ----------
async function v6227Fetch(path,opts={}){
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  try{let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||localStorage.getItem('adminToken')||'';if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;}}catch(e){}
  const r=await fetch(new URL(path,window.location.origin).toString(),{method:opts.method||'GET',headers:{...headers,...(opts.headers||{})},body:opts.body,credentials:'include',cache:'no-store'});
  const text=await r.text();if(text.trim().startsWith('<'))throw new Error('La API ha devuelto HTML.');
  let data={};try{data=text?JSON.parse(text):{}}catch(e){data={ok:false,error:text}}
  if(!r.ok||data.ok===false)throw new Error(data.error||text||'HTTP '+r.status);return data;
}
async function v6227EnhanceRoleSelector(id){
  const form=document.getElementById('operatorEditFormV6210'); if(!form||form.__v6227RoleEnhanced)return;
  form.__v6227RoleEnhanced=true;
  let data;try{data=await v6227Fetch('/api/v6227/users/'+Number(id)+'/role')}catch(e){return}
  const current=data.role||'operario';
  const laboral=[...form.querySelectorAll('.v6210-section')].find(s=>(s.textContent||'').toLowerCase().includes('datos laborales'))||form.querySelector('.v6210-section')||form;
  if(!document.getElementById('userRoleSelectorV6227')){
    const box=document.createElement('div');
    box.className='v6227-role-box';
    box.innerHTML=`<label>Rol del usuario en el ERP</label>
      <select id="userRoleSelectorV6227" name="system_role" class="field">
        <option value="operario" ${current==='operario'?'selected':''}>Operario</option>
        <option value="admin" ${current==='admin'?'selected':''}>Administrador</option>
      </select>
      <span class="v6227-role-help">Administrador: acceso completo. Operario: acceso limitado.</span>`;
    laboral.appendChild(box);
  }
  form.onsubmit=async ev=>{
    ev.preventDefault();
    try{
      const fd=new FormData(form); const payload=Object.fromEntries(fd);
      payload.epis_delivered=form.epis_delivered&&form.epis_delivered.checked?1:0;
      payload.has_prl=form.has_prl&&form.has_prl.checked?1:0;
      payload.is_team_lead=form.is_team_lead&&form.is_team_lead.checked?1:0;
      payload.team_lead=payload.is_team_lead;
      if(typeof v6210Fetch==='function') await v6210Fetch('/api/v6210/operators/'+Number(id)+'/edit',{method:'POST',body:JSON.stringify(payload)});
      if(typeof v6214UploadOperatorPhoto==='function') await v6214UploadOperatorPhoto(id);
      if(typeof v6214UploadOperatorDocs==='function') await v6214UploadOperatorDocs(id);
      const role=document.getElementById('userRoleSelectorV6227')?.value||'operario';
      await v6227Fetch('/api/v6227/users/'+Number(id)+'/role',{method:'POST',body:JSON.stringify({role})});
      if(typeof v534Toast==='function')v534Toast('Usuario actualizado con rol '+(role==='admin'?'Administrador':'Operario'));
      try{closeWizard()}catch(e){const root=document.getElementById('modalRoot');if(root)root.innerHTML='';}
      if(typeof viewUsers==='function')viewUsers();else if(typeof viewOperators==='function')viewOperators();
    }catch(e){alert('Error guardando usuario: '+e.message);}
  };
}
if(typeof openOperatorEditV6210==='function'&&!openOperatorEditV6210.__v6227Wrapped){
  const old=openOperatorEditV6210;
  openOperatorEditV6210=async function(id){
    const r=await old.apply(this,arguments);
    setTimeout(()=>v6227EnhanceRoleSelector(id),350);
    setTimeout(()=>v6227EnhanceRoleSelector(id),900);
    return r;
  };
  openOperatorEditV6210.__v6227Wrapped=true;window.openOperatorEditV6210=openOperatorEditV6210;
}


// ---------- V62.35 SAFE CALENDAR RESTORE ----------
(function(){
  window.__MARFAN_DISABLE_CALENDAR_AUTOSYNC__ = true;

  function ensureMenuVisibleV6235(){
    document.querySelectorAll('aside,.sidebar,nav').forEach(el => {
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
  }

  function closeOnlySyncPopupV6235(){
    const roots = document.querySelectorAll('#modalRoot,.modal,.modal-back,[role="dialog"]');
    roots.forEach(el => {
      const txt = (el.textContent || '').toLowerCase();
      if(
        txt.includes('sincronización completada') ||
        txt.includes('sincronizacion completada') ||
        txt.includes('sincronizando calendario') ||
        txt.includes('calendario entero') ||
        txt.includes('eventos leídos') ||
        txt.includes('eventos leidos')
      ){
        if(el.id === 'modalRoot') el.innerHTML = '';
        else el.remove();
      }
    });
  }

  document.addEventListener('click', ev => {
    const el = ev.target.closest && ev.target.closest('button,a,.v624-menu-btn,.v623-menu-btn,.v622-menu-btn');
    if(!el) return;
    const t = (el.textContent || '').toLowerCase();
    if(t.includes('calendario')){
      setTimeout(ensureMenuVisibleV6235, 300);
      setTimeout(closeOnlySyncPopupV6235, 800);
    }
  }, true);

  setInterval(() => {
    ensureMenuVisibleV6235();
    closeOnlySyncPopupV6235();
  }, 2000);
})();


// ---------- V62.44 REAL FIX FRONTEND ----------
(function(){
  async function v6244Restore(){
    try{
      const headers={'Content-Type':'application/json'};
      let t=(typeof token!=='undefined'&&token)||window.token||localStorage.getItem('token')||localStorage.getItem('authToken')||localStorage.getItem('marfan_token')||sessionStorage.getItem('token')||'';
      if(t){headers.Authorization='Bearer '+t;headers['X-Admin-Token']=t;headers['X-Auth-Token']=t;}
      await fetch('/api/v6244/restore-all',{method:'POST',headers,credentials:'include',cache:'no-store'});
    }catch(e){}
  }
  document.addEventListener('click',ev=>{
    const el=ev.target.closest&&ev.target.closest('button,a');
    if(!el)return;
    const t=(el.textContent||'').toLowerCase();
    if(t.includes('sincron')&&t.includes('google')&&ev.isTrusted){
      setTimeout(v6244Restore,1600);
      setTimeout(async()=>{try{if(typeof load==='function')await load(); if(typeof viewCalendar==='function')await viewCalendar();}catch(e){}},2600);
    }
  },true);
  setTimeout(v6244Restore,2500);
})();



// [V62.48] Override V62.47 sustituido por versión con botones de mes funcionales.



// ---------- V62.48 CALENDAR BUTTONS FIX ----------
(function(){
  function v6248EnsureDate(){
    try{
      if(typeof v55CalDate === 'undefined' || !v55CalDate || !(v55CalDate instanceof Date)){
        window.v55CalDate = new Date();
        try{ v55CalDate = window.v55CalDate; }catch(e){}
      }
      return v55CalDate;
    }catch(e){
      window.v55CalDate = new Date();
      return window.v55CalDate;
    }
  }

  function v6248SetDate(d){
    window.v55CalDate = d;
    try{ v55CalDate = d; }catch(e){}
  }

  function v6248MonthValue(d){
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  function v6248MonthTitle(d){
    return d.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  }

  window.v6248CalendarPrevMonth = async function(){
    const d = new Date(v6248EnsureDate());
    d.setDate(1);
    d.setMonth(d.getMonth()-1);
    v6248SetDate(d);
    await window.showCalendarV582();
  };

  window.v6248CalendarToday = async function(){
    v6248SetDate(new Date());
    await window.showCalendarV582();
  };

  window.v6248CalendarNextMonth = async function(){
    const d = new Date(v6248EnsureDate());
    d.setDate(1);
    d.setMonth(d.getMonth()+1);
    v6248SetDate(d);
    await window.showCalendarV582();
  };

  window.v6248CalendarPickMonth = async function(value){
    if(!value) return;
    const y = Number(String(value).slice(0,4));
    const m = Number(String(value).slice(5,7));
    if(!Number.isFinite(y) || !Number.isFinite(m)) return;
    v6248SetDate(new Date(y, m-1, 1));
    await window.showCalendarV582();
  };

  window.editEventV582 = async function(id){
    if(typeof openV612EventForm === 'function'){
      window.__lastEditingEventIdV6218 = Number(id);
      window.__lastEditingEventIdV6219 = Number(id);
      await openV612EventForm(Number(id));
      try{
        if(typeof v6219LoadAssignmentsIntoForm === 'function'){
          setTimeout(()=>v6219LoadAssignmentsIntoForm(Number(id)),250);
          setTimeout(()=>v6219LoadAssignmentsIntoForm(Number(id)),900);
        }
        if(typeof patchEventSaveV6219 === 'function'){
          setTimeout(patchEventSaveV6219,350);
          setTimeout(patchEventSaveV6219,1000);
        }
      }catch(e){}
      return;
    }
    alert('No está disponible el formulario moderno de edición.');
  };

  window.showCalendarV582 = async function(){
    const allEvents = await apiV582('/api/events').catch(()=>[]);
    const googleStatus = await apiV582('/api/google/status-v557').catch(()=>({connected:false}));
    const d = v6248EnsureDate();
    const currentMonth = d.getMonth();
    const currentYear = d.getFullYear();

    const events = allEvents.filter(e=>{
      const ds = String(e.event_date || '').slice(0,10);
      if(!ds) return false;
      const p = ds.split('-').map(Number);
      return p[0] === currentYear && (p[1]-1) === currentMonth;
    });

    const content = document.getElementById('content') || document.querySelector('#main') || document.body;

    content.innerHTML = `
      <div class="v582-calendar-force-banner">
        <div>
          <h2 style="margin:0">Calendario eventos</h2>
          <div>Vista mensual operativa con edición completa de evento, personal y roles.</div>
        </div>
        <div class="v582-event-actions">
          <button onclick="showCalendarV582()">Actualizar calendario</button>
          <button onclick="openCreateEventV559()">+ Crear evento</button>
          <button class="v583-sync-btn" onclick="forceGoogleSyncV583()">FORZAR SINCRONIZACIÓN GOOGLE</button>
          ${googleStatus.connected ? '<span class="status-badge status-ok">Google conectado</span>' : '<span class="status-badge status-warn">Google no conectado</span>'}
        </div>
      </div>

      <div class="card v582-calendar-card">
        <div class="top" style="align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0;text-transform:capitalize">${v6248MonthTitle(d)}</h3>
            <p class="muted">Selecciona mes igual que en Albaranes evento</p>
          </div>
          <div class="actions">
            <button type="button" class="secondary" onclick="v6248CalendarPrevMonth()">← Mes anterior</button>
            <button type="button" onclick="v6248CalendarToday()">Hoy</button>
            <button type="button" class="secondary" onclick="v6248CalendarNextMonth()">Mes siguiente →</button>
            <input class="field" type="month" value="${v6248MonthValue(d)}" onchange="v6248CalendarPickMonth(this.value)" style="max-width:190px;font-weight:900">
          </div>
        </div>
        ${renderMonthV582(allEvents)}
      </div>

      ${renderEventRowsV582(events)}
    `;

    document.querySelectorAll('[data-v582-event]').forEach(btn=>{
      btn.addEventListener('click', ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        openEventV582(Number(btn.dataset.v582Event));
      });
    });
  };

  window.viewCalendar = window.showCalendarV582;
  window.viewCalendarV579Final = window.showCalendarV582;
  window.viewCalendarV582Final = window.showCalendarV582;

  try{
    if(typeof routes !== 'undefined' && routes){
      routes.eventos = window.showCalendarV582;
      routes.calendario = window.showCalendarV582;
      routes.calendar = window.showCalendarV582;
    }
  }catch(e){}
})();

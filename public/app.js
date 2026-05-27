

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
  operaciones:'Operaciones',
  gps:'GPS Live',
  produccion:'Producción Live',
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
  const routes={dashboard:viewDashboard,control:viewDailyControl,operaciones:viewOperations,clientes:viewClients,informes:viewReports,eventos:viewCalendar,realizados:viewRealizados,operarios:viewUsers,tarifas:viewRates,gps:viewGpsLive,produccion:viewProductionLive,finanzas:viewFinancePro,documentacion:viewDocuments,operario:viewOperario,albaranes:viewNotes,passwords:viewPasswords,config:viewConfig};
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
  $('#content').innerHTML = `${cards}<div class="card"><div class="v52-head"><div><h3>Operaciones</h3><p class="v52-sub">Control de estados, crew incompleto y eventos en riesgo.</p></div><button onclick="go('eventos')">Ir a calendario</button></div></div><div class="card"><table class="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Estado</th><th>Crew</th><th>Acción</th></tr></thead><tbody>${rows||'<tr><td>No hay eventos activos.</td></tr>'}</tbody></table></div>`;
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

  $('#content').innerHTML = `<div class="card"><div class="v52-head"><div><h3>Producción Live</h3><p class="v52-sub">Timeline operativo por evento, checklist e incidencias.</p></div><button onclick="go('gps')">Ver GPS Live</button></div><form id="prodTaskForm" class="grid" style="margin-top:12px"><select class="col-3" name="event_id">${events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><select class="col-2" name="phase">${phases.map(p=>`<option value="${p}">${p}</option>`).join('')}</select><input class="col-4" name="title" placeholder="Nueva tarea" required><select class="col-2" name="priority"><option value="normal">Normal</option><option value="media">Media</option><option value="alta">Alta</option></select><button class="col-1">Añadir</button></form></div><div class="card"><h3>Fases operativas</h3>${phases.map(p=>`<div class="production-phase"><h4>${p}</h4>${tasks.filter(t=>t.phase===p).map(t=>`<p><span class="status-badge ${t.priority==='alta'?'status-bad':t.priority==='media'?'status-warn':'status-blue'}">${esc(t.priority)}</span> ${esc(t.title)} <button class="secondary" onclick="toggleProdTask(${t.id},${t.completed?0:1})">${t.completed?'Reabrir':'Completar'}</button></p>`).join('')||'<p class="muted">Sin tareas.</p>'}</div>`).join('')}</div><div class="card"><h3>Incidencias</h3>${incidents.map(i=>`<p><span class="status-badge status-warn">${esc(i.severity)}</span> ${esc(i.title)} · ${esc(i.status)}</p>`).join('')||'<p class="muted">Sin incidencias abiertas.</p>'}</div>`;

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

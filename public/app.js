
const API = {
  token: localStorage.getItem('marfan_token') || '',
  user: JSON.parse(localStorage.getItem('marfan_user') || 'null'),
  async request(path, options = {}) {
    const headers = options.headers || {};
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (API.token) headers.Authorization = 'Bearer ' + API.token;
    const res = await fetch(path, { ...options, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Error API');
    return json;
  },
  get(path) { return API.request(path); },
  post(path, body) { return API.request(path, { method:'POST', body: JSON.stringify(body || {}) }); },
  put(path, body) { return API.request(path, { method:'PUT', body: JSON.stringify(body || {}) }); },
  del(path) { return API.request(path, { method:'DELETE' }); }
};

const state = { db:null, view:'dashboard' };

const menu = [
  ['OPERATIVA','dashboard','Dashboard'],
  ['OPERATIVA','calendar','Calendario de Eventos'],
  ['OPERATIVA','operations','Centro de Operaciones'],
  ['OPERATIVA','daily','Control Diario'],
  ['OPERATIVA','active','Operarios Activos'],
  ['OPERATIVA','planner','Planificador Inteligente'],
  ['OPERATIVA','incidents','Incidencias Pro'],
  ['GESTIÓN','clients','Clientes'],
  ['GESTIÓN','users','Operarios'],
  ['GESTIÓN','assign','Asignaciones'],
  ['GESTIÓN','documents','Documentación'],
  ['GESTIÓN','rates','Tarifas'],
  ['ADMINISTRACIÓN','admins','Administradores'],
  ['ADMINISTRACIÓN','delivery','Albaranes A4'],
  ['ADMINISTRACIÓN','finance','Finanzas Pro'],
  ['ADMINISTRACIÓN','reports','Informes PDF'],
  ['ADMINISTRACIÓN','portal','Vista Operario'],
  ['SISTEMA','settings','Ajustes / Backup']
];

function euro(n){return Number(n||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'});}
function today(){return new Date().toISOString().slice(0,10);}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function app(){return document.getElementById('app');}
function setTitle(title){const h=document.getElementById('pageTitle'); if(h) h.textContent=title; document.title='MARFAN · '+title;}
function setActive(view){state.view=view;document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));}

function renderLogin(){
  app().innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="logo-box">M</div>
        <h1>MARFAN CLEAN</h1>
        <p class="muted">Gestión limpia de personal para eventos.</p>
        <input id="loginUser" placeholder="Usuario / email / teléfono" value="admin@marfancrew.com">
        <input id="loginPass" placeholder="Contraseña" type="password" value="admin123">
        <button onclick="login()">Entrar</button>
        <p class="muted">Demo admin: admin@marfancrew.com / admin123<br>Demo operario: 600000000 / 1234</p>
      </div>
    </div>`;
}

async function login(){
  try{
    const r=await API.post('/api/login',{user:document.getElementById('loginUser').value,password:document.getElementById('loginPass').value});
    API.token=r.token; API.user=r.user;
    localStorage.setItem('marfan_token',r.token);
    localStorage.setItem('marfan_user',JSON.stringify(r.user));
    renderShell();
  }catch(e){alert(e.message);}
}

function logout(){
  localStorage.removeItem('marfan_token');localStorage.removeItem('marfan_user');API.token='';API.user=null;renderLogin();
}

async function loadDb(){
  const r=await API.get('/api/db');
  state.db=r.db;
  return state.db;
}

function renderShell(){
  app().innerHTML=`
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">M</div>
          <div><h2>MARFAN CREW</h2><small>${esc(API.user?.name||'')}</small></div>
        </div>
        <div class="nav">${renderMenu()}</div>
      </aside>
      <main class="main">
        <div class="header">
          <h1 id="pageTitle">Dashboard</h1>
          <button class="secondary no-print" onclick="logout()">Cerrar sesión</button>
        </div>
        <div id="content"></div>
      </main>
    </div>`;
  go('dashboard');
}

function renderMenu(){
  let html='', last='';
  menu.forEach(([group,view,label])=>{
    if(group!==last){html+=`<div class="group">${group}</div>`;last=group;}
    html+=`<button data-view="${view}" onclick="go('${view}')">${label}</button>`;
  });
  return html;
}

async function go(view){
  setActive(view);
  const map={
    dashboard:viewDashboard, calendar:viewCalendar, operations:viewOperations, daily:viewDaily, active:viewActive,
    planner:viewPlanner, incidents:viewIncidents, clients:()=>viewCrud('clients','Clientes'), users:viewUsers,
    assign:viewAssignments, documents:viewDocuments, rates:viewRates, admins:viewAdmins, delivery:viewDelivery,
    finance:viewFinance, reports:viewReports, portal:viewPortal, settings:viewSettings
  };
  try{ await map[view](); }catch(e){content(`<div class="card"><h2>Error</h2><p>${esc(e.message)}</p></div>`);}
}

function content(html){document.getElementById('content').innerHTML=html;}

function kpi(label,value){return `<div class="kpi"><small>${label}</small><b>${value}</b></div>`;}

async function viewDashboard(){
  setTitle('Dashboard');
  const r=await API.get('/api/dashboard');
  const d=r.dashboard;
  content(`
    <div class="grid">
      ${kpi('Eventos hoy',d.events_today)}
      ${kpi('Asignados',d.assigned_today)}
      ${kpi('Fichados',d.checked_today)}
      ${kpi('Pendientes',d.pending_today)}
      ${kpi('Incidencias abiertas',d.open_incidents)}
      ${kpi('Ingresos hoy',euro(d.revenue_today))}
      ${kpi('Coste hoy',euro(d.cost_today))}
      ${kpi('Margen hoy',euro(d.margin_today))}
    </div>
    <div class="card">
      <h2>Accesos rápidos</h2>
      <button onclick="go('calendar')">Crear evento</button>
      <button onclick="go('assign')">Asignar personal</button>
      <button onclick="go('daily')">Control diario</button>
      <button onclick="go('active')">Operarios activos</button>
      <button onclick="go('incidents')">Incidencias</button>
    </div>`);
}

async function viewCalendar(){
  setTitle('Calendario de Eventos');
  const db=await loadDb();
  const month=new Date().toISOString().slice(0,7);
  content(`
    <div class="card">
      <h2>Eventos</h2>
      <button onclick="eventForm()">+ Crear evento</button>
    </div>
    <div class="card">
      ${db.events.length?db.events.map(e=>`
        <div class="row">
          <div><b>${esc(e.name)}</b><br><span class="muted">${esc(e.date)} · ${esc(e.start)}-${esc(e.end)} · ${esc(e.location||'')}</span><br><span class="pill">${Number(e.required_workers||0)} necesarios</span></div>
          <div><button onclick="eventForm(${e.id})">Editar</button><button class="red" onclick="removeItem('events',${e.id},'calendar')">Borrar</button></div>
        </div>`).join(''):'<p>No hay eventos.</p>'}
    </div>`);
}

function eventForm(id){
  const e=id?state.db.events.find(x=>x.id===id):{};
  modal(`
    <h2>${id?'Editar':'Crear'} evento</h2>
    <input id="f_name" placeholder="Nombre" value="${esc(e.name||'')}">
    <input id="f_client" placeholder="Cliente" value="${esc(e.client||'')}">
    <input id="f_date" type="date" value="${esc(e.date||today())}">
    <input id="f_start" type="time" value="${esc(e.start||'09:00')}">
    <input id="f_end" type="time" value="${esc(e.end||'18:00')}">
    <input id="f_location" placeholder="Ubicación" value="${esc(e.location||'')}">
    <input id="f_required" type="number" placeholder="Operarios necesarios" value="${esc(e.required_workers||0)}">
    <input id="f_budget" type="number" step="0.01" placeholder="Presupuesto venta" value="${esc(e.budget||0)}">
    <textarea id="f_notes" placeholder="Notas">${esc(e.notes||'')}</textarea>
    <button onclick="saveEvent(${id||0})">Guardar</button>
  `);
}

async function saveEvent(id){
  const body={name:v('f_name'),client:v('f_client'),date:v('f_date'),start:v('f_start'),end:v('f_end'),location:v('f_location'),required_workers:Number(v('f_required')),budget:Number(v('f_budget')),notes:v('f_notes')};
  if(id) await API.put('/api/events/'+id,body); else await API.post('/api/events',body);
  closeModal();go('calendar');
}

async function viewOperations(){
  setTitle('Centro de Operaciones');
  const d=(await API.get('/api/control-diario?date='+today()));
  const c=d.cards;
  content(`
    <div class="grid">
      ${kpi('Eventos hoy',c.events)}
      ${kpi('Asignados',c.assigned)}
      ${kpi('Fichados',c.checked)}
      ${kpi('Pendientes',c.pending)}
      ${kpi('Sin personal',c.without_staff)}
      ${kpi('Sin jefe',c.without_lead)}
    </div>
    <div class="card"><h2>Alertas</h2>
      ${c.without_staff?`<div class="pill bad">${c.without_staff} eventos sin personal</div>`:''}
      ${c.without_lead?`<div class="pill bad">${c.without_lead} eventos sin jefe</div>`:''}
      ${!c.without_staff&&!c.without_lead?'<div class="pill ok">Sin alertas críticas</div>':''}
    </div>
    <div class="card"><h2>Timeline del día</h2>
      ${d.events.length?d.events.map(e=>`<div class="row"><div><b>${esc(e.name)}</b><br><span class="muted">${esc(e.start)}-${esc(e.end)} · ${esc(e.location||'')}</span></div><div><span class="pill">${e.checked}/${e.assigned} fichados</span></div></div>`).join(''):'<p>No hay eventos hoy.</p>'}
    </div>`);
}

async function viewDaily(date=today()){
  setTitle('Control Diario');
  const d=await API.get('/api/control-diario?date='+date);
  content(`
    <div class="card"><input type="date" id="dailyDate" value="${date}"><button onclick="viewDaily(v('dailyDate'))">Actualizar</button></div>
    <div class="grid">${kpi('Eventos',d.cards.events)}${kpi('Asignados',d.cards.assigned)}${kpi('Fichados',d.cards.checked)}${kpi('Pendientes',d.cards.pending)}</div>
    <div class="card">
      ${d.events.map(e=>`<div class="card"><h3>${esc(e.name)}</h3><p>${esc(e.start)}-${esc(e.end)} · ${esc(e.location||'')}</p>
        ${e.assignments.map(a=>`<div class="row"><div>${a.checked_in?'✅':'⏳'} <b>${esc(a.user_name)}</b><br><span class="muted">${esc(a.role_name)}</span></div><button onclick="checkin(${a.user_id},${e.id})">Fichar</button></div>`).join('')||'<p>Sin personal asignado.</p>'}
      </div>`).join('')||'<p>No hay eventos.</p>'}
    </div>`);
}

async function viewActive(date=today()){
  setTitle('Operarios Activos');
  const d=await API.get('/api/operarios-activos?date='+date);
  content(`
    <div class="card"><input type="date" id="activeDate" value="${date}"><button onclick="viewActive(v('activeDate'))">Actualizar</button></div>
    <div class="grid">${kpi('Total',d.cards.total)}${kpi('Trabajando',d.cards.trabajando)}${kpi('Pendientes',d.cards.pendientes)}${kpi('Incidencias',d.cards.incidencias)}${kpi('Sin teléfono',d.cards.sin_telefono)}</div>
    <div class="card">
      ${d.operators.length?d.operators.map(o=>`
        <div class="row">
          <div><b>${esc(o.user_name)}</b><br><span class="muted">${esc(o.event_name)} · ${esc(o.event_start)}-${esc(o.event_end)}</span><br><span class="pill ${o.status==='trabajando'?'ok':o.status==='incidencia'?'bad':'warn'}">${esc(o.status)}</span></div>
          <div class="actions">
            <button onclick="openPortal(${o.user_id})">Ver portal</button>
            ${o.user_phone?`<a class="btn blue" href="tel:${esc(o.user_phone)}">Llamar</a><a class="btn green" href="https://wa.me/34${esc(String(o.user_phone).replace(/^34/,'').replace(/\s/g,''))}" target="_blank">WhatsApp</a>`:''}
            <button class="red" onclick="incidentForm(${o.event_id},${o.user_id})">Incidencia</button>
          </div>
        </div>`).join(''):'<p>No hay operarios activos.</p>'}
    </div>`);
}

async function viewPlanner(){
  setTitle('Planificador Inteligente');
  const d=await API.get('/api/planner?days=7');
  content(`
    <div class="card"><h2>Próximos 7 días</h2></div>
    <div class="card">${d.days.map(x=>`<div class="row"><div><b>${x.date}</b><br><span class="muted">Eventos: ${x.events} · Necesarios: ${x.needed} · Asignados: ${x.assigned}</span></div><span class="pill ${x.status==='completo'?'ok':x.status==='casi'?'warn':'bad'}">Faltan ${x.missing}</span></div>`).join('')}</div>`);
}

async function viewIncidents(){
  setTitle('Incidencias Pro');
  const db=await loadDb();
  content(`
    <div class="card"><button onclick="incidentForm()">+ Nueva incidencia</button></div>
    <div class="grid">${kpi('Total',db.incidents.length)}${kpi('Abiertas',db.incidents.filter(i=>i.status!=='resuelta').length)}${kpi('Críticas',db.incidents.filter(i=>i.priority==='critica').length)}${kpi('Resueltas',db.incidents.filter(i=>i.status==='resuelta').length)}</div>
    <div class="card">${db.incidents.length?db.incidents.map(i=>`<div class="row"><div><b>${esc(i.title||i.type)}</b><br><span>${esc(i.description||'')}</span><br><span class="pill ${i.priority==='critica'?'bad':'warn'}">${esc(i.priority||'media')}</span><span class="pill">${esc(i.status||'abierta')}</span></div><div>${i.status!=='resuelta'?`<button class="green" onclick="resolveIncident(${i.id})">Resolver</button>`:''}</div></div>`).join(''):'<p>Sin incidencias.</p>'}</div>`);
}

function incidentForm(eventId='',userId=''){
  modal(`<h2>Nueva incidencia</h2>
    <input id="i_title" placeholder="Título">
    <select id="i_type"><option>ausencia</option><option>retraso</option><option>accidente</option><option>cliente</option><option>horas_extra</option><option>otro</option></select>
    <select id="i_priority"><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option><option value="baja">Baja</option></select>
    <input id="i_event" placeholder="ID evento" value="${eventId||''}">
    <input id="i_user" placeholder="ID operario" value="${userId||''}">
    <textarea id="i_description" placeholder="Descripción"></textarea>
    <button onclick="saveIncident()">Guardar</button>`);
}

async function saveIncident(){
  await API.post('/api/incidents',{title:v('i_title'),type:v('i_type'),priority:v('i_priority'),event_id:v('i_event')||null,user_id:v('i_user')||null,description:v('i_description'),status:'abierta'});
  closeModal();go('incidents');
}

async function resolveIncident(id){await API.put('/api/incidents/'+id,{status:'resuelta',resolved_at:new Date().toISOString()});go('incidents');}

async function viewCrud(key,title){
  setTitle(title);
  const db=await loadDb();
  const rows=db[key]||[];
  content(`<div class="card"><button onclick="${key}Form()">+ Crear</button></div><div class="card">${rows.map(r=>`<div class="row"><div><b>${esc(r.name||r.title||r.email||('#'+r.id))}</b><br><span class="muted">${esc(r.phone||r.email||r.notes||'')}</span></div><div><button onclick="${key}Form(${r.id})">Editar</button><button class="red" onclick="removeItem('${key}',${r.id},'${state.view}')">Borrar</button></div></div>`).join('')||'<p>Sin datos.</p>'}</div>`);
}

function clientsForm(id){genericForm('clients',id,['name','phone','email','address','notes']);}
function usersForm(id){genericForm('users',id,['name','phone','email','password','role','dni','notes']);}

async function viewUsers(){setTitle('Operarios'); const db=await loadDb(); content(`<div class="card"><button onclick="usersForm()">+ Crear operario</button></div><div class="card">${db.users.filter(u=>u.role!=='admin').map(u=>`<div class="row"><div><b>${esc(u.name)}</b><br><span>${esc(u.phone||'')} · ${esc(u.email||'')}</span><br><span class="pill">${esc(u.role)}</span>${u.team_lead?'<span class="pill ok">Jefe</span>':''}</div><div><button onclick="usersForm(${u.id})">Editar</button></div></div>`).join('')}</div>`);}

async function viewAssignments(){
  setTitle('Asignaciones');
  const db=await loadDb();
  content(`<div class="card"><button onclick="assignmentForm()">+ Asignar operario</button></div><div class="card">${db.assignments.map(a=>`<div class="row"><div><b>${esc(a.user_name)}</b><br><span>${esc(a.event_name)} · ${esc(a.event_date)}</span><br><span class="pill">${esc(a.role_name)}</span>${a.team_lead?'<span class="pill ok">Jefe</span>':''}</div><button class="red" onclick="removeItem('assignments',${a.id},'assign')">Borrar</button></div>`).join('')||'<p>Sin asignaciones.</p>'}</div>`);
}

function assignmentForm(){
  const db=state.db;
  modal(`<h2>Asignar personal</h2>
    <select id="a_event">${db.events.map(e=>`<option value="${e.id}">${esc(e.name)} · ${esc(e.date)}</option>`).join('')}</select>
    <select id="a_user">${db.users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
    <select id="a_rate">${db.rates.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    <label><input id="a_lead" type="checkbox" style="width:auto"> Jefe de equipo</label>
    <input id="a_hours" type="number" step="0.25" placeholder="Horas manuales opcional">
    <button onclick="saveAssignment()">Guardar</button>`);
}

async function saveAssignment(){
  try{
    await API.post('/api/assignments',{event_id:v('a_event'),user_id:v('a_user'),rate_id:v('a_rate'),team_lead:document.getElementById('a_lead').checked,hours:Number(v('a_hours')||0)});
    closeModal();go('assign');
  }catch(e){alert(e.message);}
}

async function viewDocuments(){setTitle('Documentación');await viewCrud('documents','Documentación');}
async function viewRates(){setTitle('Tarifas'); const db=await loadDb(); content(`<div class="card"><button onclick="rateForm()">+ Crear tarifa</button></div><div class="card">${db.rates.map(r=>`<div class="row"><div><b>${esc(r.name)}</b><br>Venta ${euro(r.sell)} · Coste ${euro(r.cost)} · Dieta ${euro(r.diet)}</div><button onclick="rateForm(${r.id})">Editar</button></div>`).join('')}</div>`);}
function rateForm(id){genericForm('rates',id,['name','sell','cost','diet']);}


async function viewAdmins(){
  setTitle('Administradores');
  const db=await loadDb();
  const admins=db.users.filter(u=>u.role==='admin');
  content(`
    <div class="card">
      <h2>Administradores</h2>
      <p class="muted">Crea usuarios con acceso total a la aplicación. Los datos se guardan en /data y no se pierden al actualizar.</p>
      <button onclick="adminForm()">+ Crear administrador</button>
    </div>
    <div class="card">
      ${admins.length?admins.map(u=>`
        <div class="row">
          <div>
            <b>${esc(u.name)}</b><br>
            <span class="muted">${esc(u.email||'')} · ${esc(u.phone||'')}</span><br>
            <span class="pill ok">admin</span>
          </div>
          <div>
            <button onclick="adminForm(${u.id})">Editar</button>
            ${u.id!==1?`<button class="red" onclick="removeItem('users',${u.id},'admins')">Borrar</button>`:''}
          </div>
        </div>
      `).join(''):'<p>No hay administradores.</p>'}
    </div>`);
}

function adminForm(id){
  const row=id?(state.db.users||[]).find(x=>x.id===id):{};
  modal(`
    <h2>${id?'Editar':'Crear'} administrador</h2>
    <input id="ad_name" placeholder="Nombre" value="${esc(row?.name||'')}">
    <input id="ad_email" placeholder="Email / usuario" value="${esc(row?.email||'')}">
    <input id="ad_phone" placeholder="Teléfono" value="${esc(row?.phone||'')}">
    <input id="ad_password" placeholder="Contraseña" value="${esc(row?.password||'admin123')}">
    <textarea id="ad_notes" placeholder="Notas">${esc(row?.notes||'')}</textarea>
    <button onclick="saveAdmin(${id||0})">Guardar administrador</button>
  `);
}

async function saveAdmin(id){
  const body={
    name:v('ad_name'),
    email:v('ad_email'),
    phone:v('ad_phone'),
    password:v('ad_password'),
    role:'admin',
    active:true,
    notes:v('ad_notes')
  };
  if(id) await API.put('/api/users/'+id, body);
  else await API.post('/api/admins', body);
  closeModal();
  go('admins');
}


async function viewDelivery(){
  setTitle('Albaranes A4');
  const db=await loadDb();
  content(`<div class="card"><h2>Albaranes únicos por evento</h2><p>Selecciona evento para imprimir A4.</p></div><div class="card">${db.events.map(e=>`<div class="row"><div><b>${esc(e.name)}</b><br>${esc(e.date)} · ${esc(e.location||'')}</div><button onclick="printDelivery(${e.id})">PDF / Imprimir A4</button></div>`).join('')||'<p>No hay eventos.</p>'}</div>`);
}

async function printDelivery(id){
  const r=await API.get('/api/report/event?id='+id);
  const html=`<div class="card"><h1>Albarán de evento</h1><h2>${esc(r.event.name)}</h2><p>${esc(r.event.date)} · ${esc(r.event.start)}-${esc(r.event.end)} · ${esc(r.event.location||'')}</p><table class="table"><tr><th>Operario</th><th>Rol</th><th>Horas</th></tr>${r.assignments.map(a=>`<tr><td>${esc(a.user_name)}</td><td>${esc(a.role_name)}</td><td>${a.hours||''}</td></tr>`).join('')}</table><br><br><p>Firma cliente: __________________________</p></div>`;
  content(html + `<button class="no-print" onclick="window.print()">Imprimir / Guardar PDF</button>`);
}

async function viewFinance(){
  setTitle('Finanzas Pro');
  const db=await loadDb();
  const rows=db.events.map(e=>{
    const a=db.assignments.filter(x=>String(x.event_id)===String(e.id));
    const cost=a.reduce((s,x)=>s+(Number(x.cost_rate||0)*Number(x.hours||0))+Number(x.diet||0),0);
    const revenue=Number(e.budget||0);
    return {e,cost,revenue,margin:revenue-cost};
  });
  content(`<div class="grid">${kpi('Ingresos',euro(rows.reduce((s,r)=>s+r.revenue,0)))}${kpi('Costes',euro(rows.reduce((s,r)=>s+r.cost,0)))}${kpi('Beneficio',euro(rows.reduce((s,r)=>s+r.margin,0)))}</div><div class="card">${rows.map(r=>`<div class="row"><div><b>${esc(r.e.name)}</b><br>${esc(r.e.date)}</div><div>${euro(r.revenue)} / ${euro(r.cost)} / <b>${euro(r.margin)}</b></div></div>`).join('')}</div>`);
}

function viewReports(){setTitle('Informes PDF');content(`<div class="card"><h2>Informes</h2><button onclick="window.print()">Imprimir / Guardar PDF</button><button onclick="go('finance')">Informe financiero</button><button onclick="go('daily')">Informe diario</button></div>`);}
async function viewPortal(){setTitle('Vista Operario'); const db=await loadDb(); content(`<div class="card"><h2>Portal operario</h2>${db.users.filter(u=>u.role!=='admin').map(u=>`<div class="row"><div><b>${esc(u.name)}</b><br>${esc(u.phone||'')}</div><button onclick="openPortal(${u.id})">Ver portal</button></div>`).join('')}</div><div id="portalBox"></div>`);}

async function openPortal(userId){
  const db=await loadDb();
  const u=db.users.find(x=>String(x.id)===String(userId));
  const a=db.assignments.filter(x=>String(x.user_id)===String(userId));
  document.getElementById('portalBox')?.remove();
  content(`<div class="card"><h2>${esc(u?.name||'Operario')}</h2>${a.map(x=>`<div class="row"><div><b>${esc(x.event_name)}</b><br>${esc(x.event_date)} · ${esc(x.role_name)}</div><button onclick="checkin(${userId},${x.event_id})">Fichar</button></div>`).join('')||'<p>Sin eventos asignados.</p>'}</div>`);
}

async function viewSettings(){
  setTitle('Ajustes / Backup');
  const db=await loadDb();
  content(`<div class="card"><h2>Ajustes / Persistencia</h2><p><b>Base de datos:</b> /data/marfan-clean-db.json</p><p class="muted">Mientras Railway tenga el volumen montado en /data, las actualizaciones de código no borran clientes, eventos, operarios, fichajes, incidencias ni administradores.</p><button onclick="backup()">Guardar backup</button><button onclick="downloadDb()">Descargar JSON</button></div>`);
}

async function backup(){const r=await API.post('/api/backup',{});alert('Backup creado: '+r.file);}
async function downloadDb(){const r=await API.get('/api/db'); const blob=new Blob([JSON.stringify(r.db,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='marfan-backup.json'; a.click();}

function genericForm(key,id,fields){
  const row=id?(state.db[key]||[]).find(x=>x.id===id):{};
  modal(`<h2>${id?'Editar':'Crear'}</h2>${fields.map(f=>`<input id="g_${f}" placeholder="${f}" value="${esc(row?.[f]||'')}">`).join('')}<button onclick="saveGeneric('${key}',${id||0},${JSON.stringify(fields).replace(/"/g,'&quot;')})">Guardar</button>`);
}

async function saveGeneric(key,id,fields){
  const body={}; fields.forEach(f=>body[f]=v('g_'+f));
  if(['sell','cost','diet'].includes('x')){}
  ['sell','cost','diet'].forEach(f=>{if(body[f]!==undefined)body[f]=Number(body[f]||0);});
  if(id) await API.put('/api/'+key+'/'+id,body); else await API.post('/api/'+key,body);
  closeModal(); go(state.view);
}

async function removeItem(key,id,view){if(!confirm('¿Borrar?'))return; await API.del('/api/'+key+'/'+id); go(view);}
async function checkin(userId,eventId){await API.post('/api/checkin',{user_id:userId,event_id:eventId,type:'entrada'});alert('Fichaje registrado');go(state.view);}
function v(id){return document.getElementById(id)?.value||'';}
function modal(html){document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><div class="modal-card"><button class="secondary" onclick="closeModal()">Cerrar</button>${html}</div></div>`);}
function closeModal(){document.getElementById('modal')?.remove();}

if(API.token) renderShell(); else renderLogin();

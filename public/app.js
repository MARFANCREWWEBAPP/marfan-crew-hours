
const $ = (s)=>document.querySelector(s);
const state = { user:null, view:'dashboard', data:{} };

async function api(url, opts={}) {
  const res = await fetch(url, {
    credentials:'include',
    headers:{'Content-Type':'application/json', ...(opts.headers||{})},
    ...opts
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Error');
  return data;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function fullName(u){return `${u.first_name||''} ${u.last_name||''}`.trim() || u.email || u.phone || 'Usuario'}
function logo(){return `<div class="logo-text">MARFAN CREW</div>`}

async function init(){
  try {
    const me = await api('/api/me');
    state.user = me.user;
    render();
  } catch(e) {
    state.user = null;
    renderLogin();
  }
}
function render(){
  if(!state.user) return renderLogin();
  if(state.user.role !== 'admin') state.view='operario';
  $('#app').innerHTML = `
  <div class="layout">
    <aside>
      ${logo()}
      <div class="muted small">${esc(state.user.email||state.user.phone||'')}</div>
      <nav>${menu()}</nav>
      <button class="secondary" onclick="logout()">Salir</button>
    </aside>
    <main>
      <div class="top"><h1>${label(state.view)}</h1><span class="badge">${esc(state.user.role)}</span></div>
      <div id="content"></div>
    </main>
  </div>`;
  route();
}
function renderLogin(){
  $('#app').innerHTML = `
  <div class="login">
    <div class="login-card">
      ${logo()}
      <p class="sub">Control profesional de crew, producción, GPS y albaranes</p>
      <div class="hint">Admin: <b>admin@marfancrew.local</b> · <b>Admin1234*</b></div>
      <div class="card">
        <h3>Administrador</h3>
        <form id="loginForm">
          <input name="email" value="admin@marfancrew.local" placeholder="Email">
          <input name="password" type="password" placeholder="Contraseña">
          <button>Entrar</button>
        </form>
      </div>
      <div class="card">
        <h3>Operario / Jefe</h3>
        <form id="phoneForm">
          <input name="phone" placeholder="Teléfono">
          <button class="ok">Entrar con teléfono</button>
        </form>
      </div>
    </div>
  </div>`;
  $('#loginForm').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.user=r.user;state.view='dashboard';render()}catch(err){alert(err.message)}};
  $('#phoneForm').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/login-phone',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});state.user=r.user;state.view='operario';render()}catch(err){alert(err.message)}};
}
async function logout(){await api('/api/logout',{method:'POST'});state.user=null;renderLogin()}
function menu(){
  const items = state.user.role==='admin'
    ? ['dashboard','eventos','operarios','clientes','gps','produccion','finanzas','documentacion']
    : ['operario'];
  return items.map(i=>`<button class="${state.view===i?'active':''}" onclick="go('${i}')">${label(i)}</button>`).join('');
}
function label(v){return {dashboard:'Dashboard',eventos:'Eventos',operarios:'Operarios',clientes:'Clientes',gps:'GPS Live',produccion:'Producción Live',finanzas:'Finanzas Pro',documentacion:'Documentación',operario:'Mi zona'}[v]||v}
function go(v){state.view=v;render()}
function route(){
  ({dashboard,eventos,operarios,clientes,gps,produccion,finanzas,documentacion,operario}[state.view]||dashboard)().catch(e=>{$('#content').innerHTML=`<div class="card"><h3>Error</h3><p>${esc(e.message)}</p></div>`});
}

async function dashboard(){
  const d=await api('/api/dashboard');
  $('#content').innerHTML=`
  <div class="cards">
    <div class="card"><div class="muted">Eventos</div><div class="kpi">${d.events_count}</div></div>
    <div class="card"><div class="muted">Operarios</div><div class="kpi">${d.users_count}</div></div>
    <div class="card"><div class="muted">Clientes</div><div class="kpi">${d.clients_count}</div></div>
    <div class="card"><div class="muted">Facturación</div><div class="kpi">${Number(d.revenue||0).toFixed(2)} €</div></div>
  </div>
  <div class="card"><h3>Accesos rápidos</h3><button onclick="go('eventos')">Crear evento</button> <button onclick="go('operarios')">Operarios</button> <button onclick="go('gps')">GPS Live</button></div>`;
}
async function eventos(){
  const events=await api('/api/events');
  const clients=await api('/api/clients');
  const rows=events.map(e=>`<tr><td>${esc(e.event_date)}<br>${esc(e.start_time)}-${esc(e.end_time)}</td><td><b>${esc(e.name)}</b><br>${esc(e.client)}</td><td>${esc(e.location)}</td><td>${esc(e.operational_status)}</td><td><button onclick="delEvent(${e.id})">Borrar</button></td></tr>`).join('');
  $('#content').innerHTML=`
  <div class="card"><h3>Crear evento</h3>
    <form id="eventForm" class="grid">
      <input name="name" placeholder="Nombre evento" required>
      <select name="client_id"><option value="">Cliente</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <input name="location" placeholder="Localización">
      <input name="event_date" type="date" value="${today()}" required>
      <input name="start_time" type="time">
      <input name="end_time" type="time">
      <input name="required_workers" type="number" placeholder="Operarios requeridos">
      <input name="required_team_leads" type="number" value="1" placeholder="Jefes requeridos">
      <button>Guardar evento</button>
    </form>
  </div>
  <div class="card"><h3>Eventos</h3><table>${rows||'<tr><td>No hay eventos</td></tr>'}</table></div>`;
  $('#eventForm').onsubmit=async e=>{e.preventDefault();await api('/api/events',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});eventos()};
}
async function delEvent(id){if(confirm('¿Borrar evento?')){await api('/api/events/'+id,{method:'DELETE'});eventos()}}

async function operarios(){
  const users=await api('/api/users');
  const rows=users.map(u=>`<tr><td>${esc(fullName(u))}<br>${esc(u.phone)}</td><td>${esc(u.role)}</td><td>${esc(u.services)}</td><td>${esc(u.availability)}</td></tr>`).join('');
  $('#content').innerHTML=`
  <div class="card"><h3>Crear operario</h3><form id="userForm" class="grid">
    <input name="first_name" placeholder="Nombre">
    <input name="last_name" placeholder="Apellidos">
    <input name="phone" placeholder="Teléfono">
    <select name="role"><option value="operario">Operario</option><option value="jefe">Jefe equipo</option></select>
    <input name="services" placeholder="Servicios / skills">
    <button>Guardar</button>
  </form></div>
  <div class="card"><h3>Operarios</h3><table>${rows||'<tr><td>No hay operarios</td></tr>'}</table></div>`;
  $('#userForm').onsubmit=async e=>{e.preventDefault();await api('/api/users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});operarios()};
}
async function clientes(){
  const clients=await api('/api/clients');
  const rows=clients.map(c=>`<tr><td><b>${esc(c.name)}</b><br>${esc(c.legal_name)}</td><td>${esc(c.cif)}</td><td>${esc(c.phone)}</td></tr>`).join('');
  $('#content').innerHTML=`
  <div class="card"><h3>Crear cliente</h3><form id="clientForm" class="grid">
    <input name="name" placeholder="Cliente" required>
    <input name="legal_name" placeholder="Razón social">
    <input name="cif" placeholder="CIF/NIF">
    <input name="phone" placeholder="Teléfono">
    <input name="email" placeholder="Email">
    <button>Guardar</button>
  </form></div>
  <div class="card"><h3>Clientes</h3><table>${rows||'<tr><td>No hay clientes</td></tr>'}</table></div>`;
  $('#clientForm').onsubmit=async e=>{e.preventDefault();await api('/api/clients',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});clientes()};
}
async function gps(){
  const d=today();
  const data=await api('/api/gps/live?date='+d);
  const rows=data.rows.map(r=>`<tr><td>${esc(r.worker_name)}<br>${esc(r.phone)}</td><td>${esc(r.event_name)}</td><td>${esc(r.gps_status)}</td><td>${r.distance_m??'—'} m</td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>GPS Live</h3><table>${rows||'<tr><td>Sin datos GPS hoy</td></tr>'}</table></div>`;
}
async function produccion(){
  const data=await api('/api/production/events?date='+today());
  const rows=data.map(r=>`<tr><td>${esc(r.event.name)}</td><td>${r.progress}%</td><td>${r.done}/${r.total}</td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Producción Live</h3><table>${rows||'<tr><td>No hay eventos hoy</td></tr>'}</table></div>`;
}
async function finanzas(){
  const data=await api('/api/finance/events');
  const rows=data.rows.map(r=>`<tr><td>${esc(r.event_name)}<br>${esc(r.event_date)}</td><td>${Number(r.revenue_base||0).toFixed(2)} €</td><td>${Number(r.profit||0).toFixed(2)} €</td><td>${Number(r.margin||0).toFixed(2)}%</td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Finanzas Pro</h3><table>${rows||'<tr><td>Sin datos</td></tr>'}</table></div>`;
}
async function documentacion(){
  const docs=await api('/api/documents');
  const users=await api('/api/users');
  const rows=docs.map(d=>`<tr><td>${esc(d.first_name)} ${esc(d.last_name)}</td><td>${esc(d.title)}</td><td>${esc(d.expiry_date)}</td><td>${esc(d.computed_status)}</td></tr>`).join('');
  $('#content').innerHTML=`
  <div class="card"><h3>Subir documento</h3><form id="docForm" class="grid">
    <select name="user_id">${users.map(u=>`<option value="${u.id}">${esc(fullName(u))}</option>`).join('')}</select>
    <input name="title" placeholder="Título">
    <select name="doc_type"><option value="prl">PRL</option><option value="dni">DNI/NIE</option><option value="carretilla">Carretilla</option><option value="otros">Otros</option></select>
    <input name="expiry_date" type="date">
    <button>Guardar</button>
  </form></div>
  <div class="card"><h3>Documentación</h3><table>${rows||'<tr><td>Sin documentos</td></tr>'}</table></div>`;
  $('#docForm').onsubmit=async e=>{e.preventDefault();await api('/api/documents',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});documentacion()};
}
async function operario(){
  const events=await api('/api/events');
  const rows=events.map(e=>`<tr><td>${esc(e.event_date)} ${esc(e.start_time)}</td><td>${esc(e.name)}</td><td><button onclick="clock(${e.id},'entrada')">Entrada</button><button onclick="clock(${e.id},'salida')">Salida</button></td></tr>`).join('');
  $('#content').innerHTML=`<div class="card"><h3>Mi calendario</h3><table>${rows||'<tr><td>Sin eventos asignados</td></tr>'}</table></div>`;
}
async function clock(event_id,type){
  const send=(coords={})=>api('/api/time-log',{method:'POST',body:JSON.stringify({event_id,type,latitude:coords.latitude,longitude:coords.longitude})}).then(()=>alert('Fichaje guardado'));
  if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>send({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>send({}));
  else send({});
}
init();

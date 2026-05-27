
let mode = 'admin';
const ADMIN_EMAIL = 'admin@marfancrew.local';
const ADMIN_PASS = 'Admin1234*';
const EMPLOYEE_DEMO = '666111222';

function setMode(next){
  mode = next;
  renderLogin();
}

function renderLogin(){
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <img class="logo" src="/logo-marfan.png" alt="Marfan Crew">
        <h1 class="title">MARFAN CREW HOURS</h1>
        <p class="subtitle">Crew · Producción técnica · GPS · Eventos</p>

        <div class="credentials">
          <b>Acceso administrador</b><br>
          Usuario: <b>${ADMIN_EMAIL}</b><br>
          Contraseña: <b>${ADMIN_PASS}</b><br><br>
          <b>Operario demo</b>: <b>${EMPLOYEE_DEMO}</b>
        </div>

        <div class="tabs">
          <button class="tab ${mode==='admin'?'active':''}" onclick="setMode('admin')">ADMIN</button>
          <button class="tab ${mode==='employee'?'active':''}" onclick="setMode('employee')">OPERARIO</button>
        </div>

        ${mode === 'admin' ? `
          <div class="form">
            <input id="adminEmail" value="${ADMIN_EMAIL}" placeholder="Usuario admin">
            <input id="adminPass" type="password" placeholder="Contraseña admin">
            <button class="primary" onclick="loginAdmin()">Entrar como admin</button>
          </div>
        ` : `
          <div class="form">
            <input id="employeePhone" value="${EMPLOYEE_DEMO}" placeholder="Teléfono operario">
            <button class="primary" onclick="loginEmployee()">Entrar como operario</button>
          </div>
        `}
        <div id="result" class="result"></div>
      </div>
    </section>
  `;
}

async function loginAdmin(){
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPass').value;
  const result = document.getElementById('result');

  try{
    const res = await fetch('/api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Error');
    renderAdmin(data.user);
  }catch(e){
    result.innerHTML = `<span class="bad">❌ ${e.message}</span>`;
  }
}

async function loginEmployee(){
  const phone = document.getElementById('employeePhone').value.trim();
  const result = document.getElementById('result');

  try{
    const res = await fetch('/api/login-phone',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phone})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Error');
    renderEmployee(data.user);
  }catch(e){
    result.innerHTML = `<span class="bad">❌ ${e.message}</span>`;
  }
}

function renderAdmin(user){
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <img class="side-logo" src="/logo-marfan.png" alt="Marfan Crew">
        <div style="text-align:center;margin-bottom:20px;color:#aaa">${user.email}</div>
        <div class="nav">
          <button>Dashboard</button>
          <button>Eventos</button>
          <button>Operarios</button>
          <button>Clientes</button>
          <button>GPS Live</button>
          <button>Producción Live</button>
          <button>Finanzas Pro</button>
          <button onclick="renderLogin()">Salir</button>
        </div>
      </aside>
      <main class="content">
        <div class="card">
          <h1>Dashboard Admin</h1>
          <p>Login administrador correcto. Base Railway estable.</p>
        </div>
        <div class="grid">
          <div class="card"><div>Eventos</div><div class="kpi">0</div></div>
          <div class="card"><div>Operarios</div><div class="kpi">0</div></div>
          <div class="card"><div>Clientes</div><div class="kpi">0</div></div>
          <div class="card"><div>GPS Live</div><div class="kpi">OK</div></div>
        </div>
      </main>
    </div>
  `;
}

function renderEmployee(user){
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <img class="side-logo" src="/logo-marfan.png" alt="Marfan Crew">
        <div style="text-align:center;margin-bottom:20px;color:#aaa">${user.name}</div>
        <div class="nav">
          <button>Mi calendario</button>
          <button>Fichaje GPS</button>
          <button>Contactar oficina</button>
          <button onclick="renderLogin()">Salir</button>
        </div>
      </aside>
      <main class="content">
        <div class="card">
          <h1>Panel Operario</h1>
          <p>Login operario correcto. Teléfono: ${user.phone}</p>
        </div>
      </main>
    </div>
  `;
}

renderLogin();

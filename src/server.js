const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();
const { migrate, run, get, all } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error: 'Token inválido' }); }
}
function allow(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Permiso denegado' });
}
const adminRoles = ['super_admin', 'admin'];

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  const user = await get('SELECT * FROM users WHERE (email=? OR phone=?) AND active=1', [login, login]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Credenciales incorrectas' });
  res.json({ token: sign(user), user: { id: user.id, name: user.name, role: user.role, email: user.email, phone: user.phone } });
});

app.get('/api/me', auth, async (req, res) => {
  const user = await get('SELECT id,name,email,phone,role,position,active FROM users WHERE id=?', [req.user.id]);
  res.json(user);
});

app.get('/api/dashboard', auth, allow(...adminRoles, 'team_lead'), async (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const [users, operators, clients, eventsToday, openEntries, monthRevenue] = await Promise.all([
    get('SELECT COUNT(*) total FROM users WHERE active=1'),
    get("SELECT COUNT(*) total FROM users WHERE role IN ('operator','team_lead') AND active=1"),
    get('SELECT COUNT(*) total FROM clients'),
    get('SELECT COUNT(*) total FROM events WHERE date=?', [today]),
    get('SELECT COUNT(*) total FROM time_entries WHERE check_in IS NOT NULL AND check_out IS NULL'),
    get("SELECT COALESCE(SUM(budget),0) total FROM events WHERE substr(date,1,7)=substr(date('now'),1,7)")
  ]);
  const nextEvents = await all(`SELECT e.*, c.name client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.date>=? ORDER BY e.date,e.start_time LIMIT 8`, [today]);
  res.json({ users: users.total, operators: operators.total, clients: clients.total, eventsToday: eventsToday.total, activeWorkers: openEntries.total, monthRevenue: monthRevenue.total, nextEvents });
});

app.get('/api/users', auth, allow(...adminRoles), async (req, res) => {
  const rows = await all('SELECT id,name,email,phone,role,active,hourly_rate,position,created_at FROM users ORDER BY role,name');
  res.json(rows);
});
app.post('/api/users', auth, allow('super_admin'), async (req, res) => {
  const { name, email, phone, password, role, hourly_rate = 0, position = '' } = req.body;
  if (!name || !password || !role) return res.status(400).json({ error: 'Nombre, contraseña y rol son obligatorios' });
  const allowed = ['super_admin','admin','team_lead','operator','client'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  const hash = await bcrypt.hash(password, 10);
  const r = await run('INSERT INTO users(name,email,phone,password_hash,role,hourly_rate,position) VALUES(?,?,?,?,?,?,?)', [name, email || null, phone || null, hash, role, hourly_rate, position]);
  res.status(201).json(await get('SELECT id,name,email,phone,role,active,hourly_rate,position FROM users WHERE id=?', [r.id]));
});
app.put('/api/users/:id', auth, allow('super_admin'), async (req, res) => {
  const { name, email, phone, role, active = 1, hourly_rate = 0, position = '' } = req.body;
  await run('UPDATE users SET name=?,email=?,phone=?,role=?,active=?,hourly_rate=?,position=? WHERE id=?', [name, email || null, phone || null, role, active ? 1 : 0, hourly_rate, position, req.params.id]);
  res.json(await get('SELECT id,name,email,phone,role,active,hourly_rate,position FROM users WHERE id=?', [req.params.id]));
});
app.post('/api/users/:id/reset-password', auth, allow('super_admin'), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' });
  await run('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(password, 10), req.params.id]);
  res.json({ ok: true });
});

app.get('/api/clients', auth, allow(...adminRoles, 'team_lead'), async (req, res) => res.json(await all('SELECT * FROM clients ORDER BY name')));
app.post('/api/clients', auth, allow(...adminRoles), async (req, res) => {
  const { name, cif='', contact_name='', email='', phone='', address='', notes='' } = req.body;
  const r = await run('INSERT INTO clients(name,cif,contact_name,email,phone,address,notes) VALUES(?,?,?,?,?,?,?)', [name,cif,contact_name,email,phone,address,notes]);
  res.status(201).json(await get('SELECT * FROM clients WHERE id=?', [r.id]));
});
app.put('/api/clients/:id', auth, allow(...adminRoles), async (req, res) => {
  const { name, cif='', contact_name='', email='', phone='', address='', notes='' } = req.body;
  await run('UPDATE clients SET name=?,cif=?,contact_name=?,email=?,phone=?,address=?,notes=? WHERE id=?', [name,cif,contact_name,email,phone,address,notes,req.params.id]);
  res.json(await get('SELECT * FROM clients WHERE id=?', [req.params.id]));
});

app.get('/api/events', auth, async (req, res) => {
  const rows = await all(`SELECT e.*, c.name client_name, COUNT(a.id) assigned_count FROM events e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN event_assignments a ON a.event_id=e.id GROUP BY e.id ORDER BY e.date DESC,e.start_time DESC`);
  res.json(rows);
});
app.post('/api/events', auth, allow(...adminRoles, 'team_lead'), async (req, res) => {
  const { title, client_id=null, location='', date, start_time, end_time, status='planned', budget=0, notes='', assignments=[] } = req.body;
  const r = await run('INSERT INTO events(title,client_id,location,date,start_time,end_time,status,budget,notes) VALUES(?,?,?,?,?,?,?,?,?)', [title, client_id || null, location, date, start_time, end_time, status, budget, notes]);
  for (const userId of assignments) await run('INSERT OR IGNORE INTO event_assignments(event_id,user_id) VALUES(?,?)', [r.id, userId]);
  res.status(201).json(await get('SELECT * FROM events WHERE id=?', [r.id]));
});
app.get('/api/events/:id/assignments', auth, async (req, res) => res.json(await all(`SELECT a.*, u.name, u.role, u.phone FROM event_assignments a JOIN users u ON u.id=a.user_id WHERE event_id=? ORDER BY u.name`, [req.params.id])));
app.post('/api/events/:id/assignments', auth, allow(...adminRoles, 'team_lead'), async (req, res) => {
  const { user_ids=[] } = req.body;
  await run('DELETE FROM event_assignments WHERE event_id=?', [req.params.id]);
  for (const userId of user_ids) await run('INSERT OR IGNORE INTO event_assignments(event_id,user_id) VALUES(?,?)', [req.params.id, userId]);
  res.json({ ok: true });
});

app.post('/api/time/check-in', auth, async (req, res) => {
  const { event_id, lat=null, lng=null, notes='' } = req.body;
  const existing = await get('SELECT id FROM time_entries WHERE event_id=? AND user_id=? AND check_out IS NULL', [event_id, req.user.id]);
  if (existing) return res.status(409).json({ error: 'Ya tienes un fichaje abierto en este evento' });
  const r = await run('INSERT INTO time_entries(event_id,user_id,check_in,check_in_lat,check_in_lng,notes) VALUES(?,?,datetime("now"),?,?,?)', [event_id, req.user.id, lat, lng, notes]);
  res.status(201).json(await get('SELECT * FROM time_entries WHERE id=?', [r.id]));
});
app.post('/api/time/check-out', auth, async (req, res) => {
  const { entry_id, lat=null, lng=null, break_minutes=0, notes='', client_signature_name='', client_signature_dni='' } = req.body;
  await run('UPDATE time_entries SET check_out=datetime("now"),check_out_lat=?,check_out_lng=?,break_minutes=?,notes=?,client_signature_name=?,client_signature_dni=? WHERE id=? AND user_id=?', [lat,lng,break_minutes,notes,client_signature_name,client_signature_dni,entry_id,req.user.id]);
  res.json(await get('SELECT * FROM time_entries WHERE id=?', [entry_id]));
});
app.get('/api/time/entries', auth, allow(...adminRoles, 'team_lead'), async (req, res) => {
  res.json(await all(`SELECT t.*, u.name user_name, e.title event_title, e.date FROM time_entries t JOIN users u ON u.id=t.user_id JOIN events e ON e.id=t.event_id ORDER BY t.created_at DESC LIMIT 200`));
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Marfan Crew 2.0', clean: true }));

migrate().then(async () => {
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@marfan.local';
  const pass = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin1234!';
  const exists = await get('SELECT id FROM users WHERE email=?', [email]);
  if (!exists) await run('INSERT INTO users(name,email,password_hash,role,active,position) VALUES(?,?,?,?,?,?)', ['Super Admin', email, await bcrypt.hash(pass, 10), 'super_admin', 1, 'Dirección']);
  app.listen(PORT, () => console.log(`Marfan Crew 2.0 running on http://localhost:${PORT}`));
}).catch(err => { console.error(err); process.exit(1); });

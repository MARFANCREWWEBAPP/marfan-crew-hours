
const express = require('express');
const path = require('path');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: false }));

app.get('/health', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

app.get('/api/version', (req, res) => {
  res.json({
    ok: true,
    version: '48.2.7',
    admin_user: 'admin@marfancrew.local',
    admin_password: 'Admin1234*',
    employee_demo: '666111222'
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email === 'admin@marfancrew.local' && password === 'Admin1234*') {
    return res.json({
      ok: true,
      user: {
        role: 'admin',
        email: 'admin@marfancrew.local',
        name: 'Administrador Marfan'
      }
    });
  }
  return res.status(401).json({ error: 'Credenciales admin incorrectas' });
});

app.post('/api/login-phone', (req, res) => {
  const phone = String((req.body || {}).phone || '').replace(/\D/g, '');
  if (phone === '666111222' || phone.length >= 6) {
    return res.json({
      ok: true,
      user: {
        role: 'operario',
        phone,
        name: phone === '666111222' ? 'Operario Demo' : 'Operario'
      }
    });
  }
  return res.status(401).json({ error: 'Teléfono no válido' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API no encontrada' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Marfan Crew Hours V48.2.7 Premium Login listening on 0.0.0.0:${PORT}`);
});

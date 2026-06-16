require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const dirs = ['uploads','signatures','documents','exports','backups','logs'];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dirs.forEach(d => fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true }));
} catch (e) {
  console.warn('Persistent data dir warning:', e.message);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'Marfan Crew', version: '2.1.1', railway: true, data_dir: DATA_DIR });
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: '2.1.1',
    mode: 'railway-enterprise-stable',
    persistence: DATA_DIR,
    modules: ['auth','roles','events','calendar','assignments','checkins','pdf','backups']
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Marfan Crew V2.1.1 Railway Enterprise Stable running on port ${PORT}`);
  console.log(`Persistent data dir: ${DATA_DIR}`);
});

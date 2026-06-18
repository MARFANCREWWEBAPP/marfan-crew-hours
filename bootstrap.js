const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status || 1);
}

try {
  require.resolve('express');
  console.log('[bootstrap] express OK');
} catch (e) {
  console.log('[bootstrap] express missing, installing dependencies...');
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--legacy-peer-deps']);
}

require('./server.js');

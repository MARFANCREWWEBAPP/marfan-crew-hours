const bcrypt = require('bcryptjs');
require('dotenv').config();
const { migrate, run, get } = require('./db');

(async () => {
  await migrate();
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@marfan.local';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin1234!';
  const exists = await get('SELECT id FROM users WHERE email=?', [email]);
  if (!exists) {
    const hash = await bcrypt.hash(password, 10);
    await run('INSERT INTO users(name,email,password_hash,role,active,position) VALUES(?,?,?,?,?,?)', ['Super Admin', email, hash, 'super_admin', 1, 'Dirección']);
  }
  const demoClient = await get('SELECT id FROM clients WHERE name=?', ['Marquee Producciones']);
  if (!demoClient) await run('INSERT INTO clients(name,contact_name,email,phone,notes) VALUES(?,?,?,?,?)', ['Marquee Producciones', 'Germán', 'info@marquee.es', '', 'Cliente interno / demo']);
  console.log(`OK. Admin: ${email} / ${password}`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });

const bcrypt = require('bcryptjs');
const clients = require('./clients');
const operators = require('./operators');

function normalPhone(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function operatorEmail(w){
  const e = String(w.email||'').trim().toLowerCase();
  if(e && e.includes('@')) return e;
  const dni = String(w.dni||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  if(dni) return `${dni}@marfancrew.local`;
  const name = `${w.first_name||''}.${w.last_name||''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
  return `${name||('operario.'+Date.now())}@marfancrew.local`;
}
async function importLegacyData({get, run}){
  const defaultPassword = process.env.DEFAULT_OPERATOR_PASSWORD || 'Marfan1234*';
  const hash = await bcrypt.hash(defaultPassword, 10);
  let clientsImported=0, clientsUpdated=0, operatorsImported=0, operatorsUpdated=0;

  for(const c of clients){
    const name=String(c.name||'').trim(); if(!name) continue;
    const existing = await get('SELECT id FROM clients WHERE lower(name)=lower(?) OR (cif<>\'\' AND cif=?) OR (email<>\'\' AND lower(email)=lower(?))',[name, c.cif||'', String(c.email||'').trim().toLowerCase()]);
    if(existing){
      await run('UPDATE clients SET name=?, legal_name=?, cif=?, contact_name=?, email=?, phone=?, address=?, province=?, notes=?, active=1 WHERE id=?',[name,c.legal_name||'',c.cif||'',c.contact_name||'',c.email||'',c.phone||'',c.address||'',c.province||'',c.notes||'',existing.id]);
      clientsUpdated++;
    }else{
      await run('INSERT INTO clients(name,legal_name,cif,contact_name,email,phone,address,province,notes,active) VALUES(?,?,?,?,?,?,?,?,?,1)',[name,c.legal_name||'',c.cif||'',c.contact_name||'',c.email||'',c.phone||'',c.address||'',c.province||'',c.notes||'']);
      clientsImported++;
    }
  }

  for(const w of operators){
    const first=String(w.first_name||'').trim(); const last=String(w.last_name||'').trim();
    const name=`${first} ${last}`.trim(); if(!name) continue;
    const email=operatorEmail(w); const phone=normalPhone(w.phone); const dni=String(w.dni||'').trim();
    const existing = await get('SELECT id, role, password_hash FROM users WHERE (dni<>\'\' AND dni=?) OR lower(email)=lower(?) OR (phone<>\'\' AND phone=?)',[dni,email,phone]);
    const notes='Importado desde V62.49. Login por teléfono o email. Contraseña inicial: Marfan1234*';
    if(existing){
      // V2.0.9: NO machacar rol ni contraseña al actualizar la app.
      // Si un operario se marca como Jefe de equipo, se mantiene para siempre.
      await run(`UPDATE users SET name=?,email=?,phone=?,active=1,hourly_rate=COALESCE(hourly_rate,12),position=COALESCE(NULLIF(position,''),'Operario'),dni=?,social_security_number=?,iban=?,bank_iban=?,first_name=?,last_name=?,notes=COALESCE(NULLIF(notes,''),?) WHERE id=?`,[name,email,phone,dni,w.social_security_number||'',w.iban||'',w.iban||'',first,last,notes,existing.id]);
      operatorsUpdated++;
    }else{
      const params=[name,email,phone,hash,'operator',1,12,'Operario',dni,w.social_security_number||'',w.iban||'',w.iban||'',first,last,notes];
      await run('INSERT INTO users(name,email,phone,password_hash,role,active,hourly_rate,position,dni,social_security_number,iban,bank_iban,first_name,last_name,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',params);
      operatorsImported++;
    }
  }
  return {clientsImported,clientsUpdated,totalClients:clients.length,operatorsImported,operatorsUpdated,totalOperators:operators.length, defaultOperatorPassword:defaultPassword};
}
module.exports={importLegacyData};

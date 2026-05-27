
function showAdmin(){
  document.getElementById('adminBox').style.display='block';
  document.getElementById('employeeBox').style.display='none';
}

function showEmployee(){
  document.getElementById('adminBox').style.display='none';
  document.getElementById('employeeBox').style.display='block';
}

function loginAdmin(){
  const email=document.getElementById('adminEmail').value;
  const pass=document.getElementById('adminPass').value;

  if(email==='admin@marfancrew.local' && pass==='Admin1234*'){
    document.getElementById('result').innerHTML='✅ LOGIN ADMIN CORRECTO';
  }else{
    document.getElementById('result').innerHTML='❌ Credenciales incorrectas';
  }
}

function loginEmployee(){
  const phone=document.getElementById('employeePhone').value;

  if(phone.length>=6){
    document.getElementById('result').innerHTML='✅ LOGIN OPERARIO CORRECTO';
  }else{
    document.getElementById('result').innerHTML='❌ Teléfono incorrecto';
  }
}

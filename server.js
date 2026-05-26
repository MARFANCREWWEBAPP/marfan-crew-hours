
const express = require('express');
const path = require('path');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req,res)=>res.send('OK'));

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Marfan Crew Hours V48.2.5 listening on 0.0.0.0:${PORT}`);
});

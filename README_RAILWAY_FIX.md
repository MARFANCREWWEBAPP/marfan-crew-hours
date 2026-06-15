# Marfan Crew 2.0.1 - Fix Railway

Esta versión corrige el error:

`Cannot find module 'express-session'`

Incluye dos protecciones:

1. `express-session` añadido en `package.json`.
2. `server.js` en la raíz como lanzador seguro hacia `src/server.js`, por si Railway tiene configurado `node server.js`.

## Qué subir a GitHub

Sube TODO el contenido de esta carpeta a la raíz del repositorio, sustituyendo los archivos anteriores.

La raíz del repositorio debe quedar así:

```txt
package.json
server.js
railway.json
src/server.js
src/db.js
src/seed.js
public/index.html
public/app.js
public/styles.css
```

## En Railway

Si puedes tocar Settings > Start Command, pon:

```bash
node src/server.js
```

Si no sabes tocarlo, no pasa nada: esta versión también funciona aunque Railway ejecute:

```bash
node server.js
```

## Usuario inicial

```txt
admin@marfan.local
Admin1234!
```

Si no existe el usuario, ejecuta localmente o en Railway:

```bash
npm run seed
```

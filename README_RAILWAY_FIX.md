# Railway Fix

Esta versión no usa `express-session`.

Si Railway muestra `Cannot find module express-session`, estás desplegando una versión antigua o Railway está arrancando otro repositorio.

Comprueba:

- `package.json` debe tener `start: node src/server.js`.
- `server.js` de la raíz existe y redirige a `src/server.js`.
- Haz Commit + Push desde GitHub Desktop.
- En Railway, redeploy desde el último commit.

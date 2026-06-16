# Marfan Crew V2.1.1 Railway Enterprise Stable

Esta versión corrige el error de Railway:

`npm ci can only install packages when package.json and package-lock.json are in sync`

Incluye `package-lock.json` sincronizado y arranque real en `src/server.js`.

## Railway
Start command:

```bash
npm start
```

Healthcheck:

```txt
/health
```

## Persistencia
Railway Volume recomendado en `/data`.

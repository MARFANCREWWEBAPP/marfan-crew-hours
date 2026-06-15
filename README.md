# Marfan Crew 2.0.2 Enterprise Menus

Versión limpia desde cero, preparada para Railway, sin `express-session` y sin depender del `server.js` antiguo.

## Incluye

- Diseño Apple style.
- Login JWT.
- Menús completos migrados de la V62.49:
  - Dashboard
  - Calendario eventos
  - Control diario
  - GPS Live
  - Vista operario
  - Clientes
  - Eventos
  - Eventos realizados
  - Operarios
  - Usuarios admin
  - Tarifas
  - Documentación
  - Albaranes evento
  - Finanzas Pro
  - Informes PDF
  - Contraseñas
  - Ajustes ERP
- Backend limpio con SQLite.
- Railway fallback `server.js` en raíz.

## Arranque

```bash
npm install
npm start
```

Usuario inicial:

```txt
admin@marfan.local
Admin1234!
```

## Nota

Esta versión reconstruye los menús y módulos principales en base limpia 2.0. No arrastra el `server.js` antiguo de 385k líneas ni sus parches V52-V62.

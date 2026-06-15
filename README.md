# Marfan Crew 2.0.3 Enterprise Data

Versión limpia tipo Apple para Railway, sin express-session y con datos reales migrados desde V62.49.

## Incluye

- Menús completos de la versión 2.0.2.
- Importación automática de clientes reales V62.49.
- Importación automática de operarios reales V62.49.
- Login de operarios por teléfono o email.
- Contraseña inicial de operarios importados: `Marfan1234*`.
- Super Admin inicial: `admin@marfan.local` / `Admin1234!`.
- Campos ampliados de operarios: DNI/NIE, Seguridad Social, IBAN, dirección, tallas, PRL, EPIs y emergencia.
- Sin `express-session`. Preparada para Railway.

## Railway

Start command recomendado:

```bash
npm start
```

También incluye `server.js` en la raíz para evitar errores si Railway intenta ejecutar `node server.js`.

## Variables opcionales

```env
DEFAULT_ADMIN_EMAIL=admin@marfan.local
DEFAULT_ADMIN_PASSWORD=Admin1234!
DEFAULT_OPERATOR_PASSWORD=Marfan1234*
JWT_SECRET=cambia_esto
AUTO_IMPORT_LEGACY_DATA=true
DATABASE_FILE=./data/marfan.sqlite
```

## Importación manual

Desde Super Admin puedes llamar a:

```txt
POST /api/legacy/import-data
GET /api/legacy/status
```

Por defecto la importación se ejecuta automáticamente al arrancar, sin duplicar datos.

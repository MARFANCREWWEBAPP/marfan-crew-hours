# MARFAN CREW ERP

ERP SaaS para empresas de personal auxiliar de eventos: eventos, clientes, operarios, asignaciones, fichajes GPS, incidencias, documentación, finanzas, informes y backups.

## Arranque local

```bash
npm start
```

Abrir:

```text
http://localhost:3000
```

## Usuario inicial de produccion

En Railway, con `NODE_ENV=production`, `MARFAN_SEED_DEMO_DATA=false` y `MARFAN_SEED_REAL_DATA=true`, una base nueva arranca con la base recuperada incluida en el proyecto:

- Super Admin: `info@marquee.es` / `Marquee2026!`
- Datos iniciales recuperados: 27 operarios, 125 clientes, 22 eventos, 28 asignaciones y fichajes/incidencias existentes desde `seed/production-data.json`
- Acceso inicial operarios: email o telefono importado / `Marfan2026!`

Cambia `MARFAN_SUPERADMIN_PASSWORD` en Railway antes de abrir la app a mas usuarios. Para operarios, cambia las contrasenas desde `Administradores` o pide que las actualicen en su perfil.

## Demo desechable

Para una demo local se puede arrancar con `MARFAN_SEED_DEMO_DATA=true`.

La pantalla de acceso no muestra ni rellena estas credenciales en un entorno real. Para una demo desechable se puede arrancar con `APP_DEMO_MODE=true`.

## Preparar base real

Este comando deja la base local lista para pruebas reales: crea/actualiza a German como superadministrador, crea un backup de seguridad y cierra sesiones antiguas. No borra eventos, clientes ni operarios; si detecta que baja algun conteo de negocio, falla.

```bash
npm run prepare:production
```

## Precios operativos

La app incluye un menu `Configuracion` para cambiar:

- Base: `Calle Ciro Alegría 89, Málaga`
- Km incluidos antes de cobrar desplazamiento: `20`
- Precio por kilometro y vehiculo: `0.37`
- Roles de trabajo con precio base/hora y precio nocturno/hora

Al crear un evento, el precio se calcula con roles requeridos, horario, nocturnidad, distancia a la base y numero de vehiculos. Si se pega un enlace largo de Google Maps con coordenadas, la app rellena latitud y longitud del recinto.

## Importar datos reales

El importador es idempotente: actualiza por DNI/CIF/email/telefono y no duplica filas si se ejecuta otra vez.

```bash
/Users/marquee/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/import_real_data.py \
  --db data/marfan.sqlite \
  --employees "/Users/marquee/Downloads/DATOS PERSONALES TRABAJADORES (1).xlsx" \
  --clients "/Users/marquee/Downloads/CLIENTES_MARCREW_2026 (1).xlsx"
```

## Pruebas

```bash
npm test
```

La app no usa dependencias externas: Node 24, servidor HTTP nativo y SQLite nativo.

## Persistencia

La base SQLite vive por defecto en:

```text
data/marfan.sqlite
```

Regla importante:

- Si la base ya existe, no se sobrescribe.
- Las migraciones se aplican de forma incremental.
- Las semillas solo se crean en una instalación nueva.
- Los backups se guardan en `backups/` o en `BACKUP_DIR`, con verificacion de integridad, descarga protegida y restauracion solo para super admin.
- Para preparar una restauracion hay que escribir `RESTAURAR`; antes de aplicarla se genera siempre un backup de seguridad.

## Railway

Variables recomendadas:

```text
NODE_ENV=production
DATA_DIR=/data
BACKUP_DIR=/data/backups
SQLITE_PATH=/data/marfan.sqlite
AUTO_BACKUP_ON_START=true
APP_DEMO_MODE=false
MARFAN_SEED_DEMO_DATA=false
MARFAN_SEED_REAL_DATA=true
MARFAN_SUPERADMIN_NAME=German
MARFAN_SUPERADMIN_EMAIL=info@marquee.es
MARFAN_SUPERADMIN_PASSWORD=Marquee2026!
GOOGLE_CALENDAR_ID=21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37@group.calendar.google.com
```

En Railway, montar un volumen persistente en `/data`. Sin volumen, cualquier servicio con SQLite acabará dependiendo del disco efímero del despliegue.
El ZIP no debe subir `data/` ni `backups/`; en una base nueva Railway carga la semilla real incluida en `seed/production-data.json`.

Para conectar Google Calendar con OAuth, usa un cliente OAuth de Google de tipo `Web application` y anade la URI exacta que muestra MARFAN en `Configuracion > Google Calendar`.

En local suele ser:

```text
http://localhost:3010/api/calendar/google-oauth/callback
```

En Railway, sustituyendo el dominio por el de Railway:

```text
https://TU-DOMINIO.up.railway.app/api/calendar/google-oauth/callback
```

Si Google muestra `redirect_uri_mismatch`, la URI autorizada en Google Cloud no coincide exactamente con la que esta usando la app.

## Módulos incluidos

- Dashboard operativo
- Búsqueda global de eventos, operarios y clientes
- Centro Live
- Calendario Pro
- Eventos con duplicado operativo de servicio, requisitos y equipo asignado validado; los efectuados quedan en solo revision
- Clientes
- Operarios
- Asignaciones con recomendaciones y prevalidacion visible de bloqueos
- Planificador con rol sugerido, distancia, carga reciente, disponibilidad, descanso y documentacion
- Fichajes geolocalizados con secuencia entrada/salida, evidencia GPS/dispositivo y trazabilidad de correcciones
- Portal empleado con confirmacion de asistencia a servicios
- Portal empleado con checklist operativo real y botones de oficina configurables
- Calendario personal del empleado con vistas mes, semana, dia y agenda
- Incidencias con deteccion, resolucion, nota de cierre e informes
- Documentación RRHH con archivos protegidos, tipos/tamaños validados, trazabilidad de aperturas, pestaña Docs en portal empleado, subida de documentos y revisión desde oficina
- Finanzas con pluses por evento: kilometros, dietas, nocturnidad y extras por operario
- Informes JSON/CSV/Excel/PDF
- Dossier cliente por evento con equipo asignado y estado documental
- Albarán A4 imprimible con precio, firma cliente y bloqueo
- Configuracion editable de base, kilometraje y roles
- Backups manuales y automáticos con verificacion, descarga y restauracion segura
- Super Admin para usuarios y permisos
- Recuperación de acceso sin exponer códigos en público y reset seguro por Super Admin
- Sesiones con cookies HttpOnly/SameSite solo para lecturas seguras, tokens hasheados, limite de intentos de login y cabeceras HTTP defensivas
- Auditoria Super Admin de accesos, cambios sensibles, backups y exportacion CSV

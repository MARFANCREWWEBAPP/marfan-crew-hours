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
- Acceso inicial operarios: telefono limpio como usuario y contrasena, sin espacios y omitiendo `+34`.
- Operarios creados desde el menu: por defecto telefono como usuario y contrasena, sin espacios y omitiendo `+34`. Ejemplo `+34 600 111 000` entra con `600111000` / `600111000`.
- Al arrancar con la base recuperada, la app crea una copia de seguridad y normaliza una sola vez los operarios existentes para dejarlos activos con ese mismo acceso por telefono.

Si se pierde el acceso, deja `MARFAN_SUPERADMIN_PASSWORD=Marquee2026!` y activa `MARFAN_RECOVER_SUPERADMIN_ON_START=true` durante un solo despliegue. La app creara un backup y restaurara solo el acceso de German sin borrar clientes, operarios, eventos ni usuarios. Despues vuelve a dejar `MARFAN_RECOVER_SUPERADMIN_ON_START=false`.

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

Al crear un evento, el precio se calcula con roles requeridos, horario, nocturnidad, distancia a la base y numero de vehiculos. Si se pega un enlace largo de Google Maps con coordenadas, la app rellena latitud y longitud del recinto. Si un evento queda con coordenada de emergencia de la base, el portal del operario bloquea el fichaje hasta completar la ubicacion GPS real.

## Importar datos reales

El importador es idempotente: actualiza por DNI/CIF/email/telefono y no duplica filas si se ejecuta otra vez. Desde la app se pueden subir archivos `.xlsx`, `.csv` o `.tsv` en `Importaciones`, `Operarios` o `Clientes`.

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

En produccion la app usa `/data/marfan.sqlite` por defecto para que Railway pueda conservar la base en un volumen persistente.

Regla importante:

- Si la base ya existe, no se sobrescribe.
- Las migraciones se aplican de forma incremental.
- Las semillas solo se crean en una instalación nueva.
- Usuarios, contrasenas de operarios, fotos, documentos y asignaciones viven en la base persistente; actualizar el ZIP no los reemplaza.
- Las actualizaciones de codigo no deben subir ni reemplazar `data/`, `backups/`, `tmp/`, `outputs/` ni `node_modules/`.
- Los backups se guardan en `backups/` o en `BACKUP_DIR`, con verificacion de integridad, descarga protegida y restauracion solo para super admin. Cada copia SQLite incluye tambien los archivos subidos de documentacion RRHH para poder restaurarlos junto a la base.
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
MARFAN_RECOVER_SUPERADMIN_ON_START=false
GOOGLE_CALENDAR_ID=21102c189e2a9f5fb7072b9475554e93ae0b5124176fdfaa3da9470149b39e37@group.calendar.google.com
```

En Railway, montar un volumen persistente en `/data`. Sin volumen, cualquier servicio con SQLite acabara dependiendo del disco efimero del despliegue y los datos podrian desaparecer al redeplegar.
El ZIP no debe subir `data/` ni `backups/`; en una base nueva Railway carga la semilla real incluida en `seed/production-data.json`.

Para recuperar el acceso sin borrar datos:

```text
MARFAN_RECOVER_SUPERADMIN_ON_START=true
MARFAN_SUPERADMIN_EMAIL=info@marquee.es
MARFAN_SUPERADMIN_PASSWORD=Marquee2026!
```

Despues de entrar, volver a dejar `MARFAN_RECOVER_SUPERADMIN_ON_START=false`.

Para conectar Google Calendar con OAuth, usa un cliente OAuth de Google de tipo `Web application` y anade la URI exacta que muestra MARFAN en `Configuracion > Google Calendar`.
No uses un cliente `Desktop app`/`Installed`; Google lo rechazara con `redirect_uri_mismatch` en esta aplicacion.

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
- Google Calendar con sincronización de horario, ubicación, descripción operativa y metadatos privados de equipo/requisitos
- Eventos con duplicado operativo de servicio, requisitos y equipo asignado validado; los efectuados quedan en solo revision y el borrado queda reservado al Super Admin
- Clientes
- Operarios con acceso al portal por email o telefono, contrasena manual desde oficina o telefono como usuario/contrasena sin espacios y sin `+34`
- Fotos identificativas de operarios subidas desde admin/superadmin y visibles junto al nombre en listados y ficha
- Asignaciones con recomendaciones y prevalidacion visible de bloqueos
- Planificador con rol sugerido, distancia, carga reciente, disponibilidad, descanso y documentacion obligatoria por rol critico
- Fichajes geolocalizados con secuencia entrada/salida, evidencia GPS/dispositivo, bloqueo si falta ubicacion real del recinto y trazabilidad de correcciones
- Portal empleado con confirmacion de asistencia a servicios
- Portal empleado con checklist operativo real y botones de oficina configurables
- Calendario personal del empleado con vistas mes, semana, dia y agenda
- Histórico del empleado con horas, eventos, kilómetros, dietas, nocturnidad e incidencias sin costes internos
- Perfil del empleado con actualización de contacto, contraseña y foto subida de forma persistente
- Incidencias con deteccion automatica de retrasos/ausencias, resolucion, nota de cierre e informes
- Documentación RRHH con archivos protegidos, tipos/tamaños validados, trazabilidad de aperturas, pestaña Docs en portal empleado, subida de documentos y revisión desde oficina
- Documentos operativos por evento con visibilidad para operarios asignados y copia incluida en backups
- Importaciones centralizadas de operarios y clientes desde Excel/CSV/TSV con historial y conteo de cambios
- Finanzas con pluses por evento: kilometros, dietas, nocturnidad y extras por operario
- Informes JSON/CSV/Excel/PDF
- Dossier cliente por evento con equipo asignado y estado documental
- Albarán A4 imprimible con precio, base/kilometraje configurable, firma cliente y bloqueo
- Configuracion editable de base, kilometraje y roles
- Backups manuales y automáticos con verificacion, descarga y restauracion segura
- Super Admin para usuarios y permisos
- Recuperación de acceso sin exponer códigos en público, aviso pendiente en Administradores y reset seguro por Super Admin
- Sesiones con cookies HttpOnly/SameSite solo para lecturas seguras, tokens hasheados, limite de intentos de login y cabeceras HTTP defensivas
- Auditoria Super Admin de accesos, cambios sensibles, backups y exportacion CSV

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

## Usuarios demo

- Super Admin: `super@marfancrew.test` / `super123`
- Admin: `admin@marfancrew.test` / `admin123`
- Empleado: `empleado@marfancrew.test` / `empleado123`
- Empleados importados: usar email o telefono importado / `Marfan2026!`

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

## Railway

Variables recomendadas:

```text
DATA_DIR=/data
BACKUP_DIR=/data/backups
SQLITE_PATH=/data/marfan.sqlite
AUTO_BACKUP_ON_START=true
```

En Railway, montar un volumen persistente en `/data`. Sin volumen, cualquier servicio con SQLite acabará dependiendo del disco efímero del despliegue.

## Módulos incluidos

- Dashboard operativo
- Búsqueda global de eventos, operarios y clientes
- Centro Live
- Calendario Pro
- Eventos
- Clientes
- Operarios
- Asignaciones con recomendaciones y prevalidacion visible de bloqueos
- Fichajes geolocalizados con secuencia entrada/salida y bloqueo de duplicados
- Portal empleado con confirmacion de asistencia a servicios
- Calendario personal del empleado con vistas mes, semana, dia y agenda
- Incidencias
- Documentación RRHH con archivos protegidos y pestaña Docs en portal empleado
- Finanzas
- Informes JSON/CSV/Excel/PDF
- Dossier cliente por evento con equipo asignado y estado documental
- Albarán A4 imprimible con precio, firma cliente y bloqueo
- Configuracion editable de base, kilometraje y roles
- Backups manuales y automáticos con verificacion, descarga y restauracion segura
- Super Admin para usuarios y permisos
- Auditoria Super Admin de accesos, cambios sensibles, backups y exportacion CSV

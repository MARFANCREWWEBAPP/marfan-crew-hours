# Marfan Crew Hours V52 - V46 A4 Vertical + Auditoría completa

## Base
Esta versión SÍ parte directamente de:
`marfan-crew-hours-v46-a4-vertical-pdf.zip`

## Se mantiene de V46
- Diseño original V46.
- Dashboard original.
- Menú Tarifas original.
- Calendario eventos.
- Eventos realizados.
- Operarios.
- Clientes.
- Albaranes A4 vertical.
- Vista operario/jefe equipo.
- Firma cliente.
- Informes PDF.
- Lógica de fichajes, nocturnidad, mínimo 4h y A4 vertical.

## Añadido auditoría
- Operaciones.
- GPS Live.
- Producción Live funcional.
- Finanzas Pro.
- Documentación RRHH.
- Estados operativos.
- Costes y margen por evento.
- Alertas de crew incompleto.
- Documentos con caducidad.
- Producción por fases.

## Admin
Se mantiene el sistema de admin de la V46.

## Railway
/health debe devolver OK.


# V52.1 Hotfix Startup
Corrige el error:
`ReferenceError: addDaysJS is not defined`

Mantiene base V46 A4 Vertical + módulos auditoría.


# V52.2 Hotfix Admin Access

## Credenciales garantizadas
Usuario: admin@marfancrew.local
Contraseña: Admin1234*

Esta versión fuerza el acceso admin aunque exista una base SQLite anterior con otra contraseña.


# V53 Enterprise Stable Build

## Implementado
- Tarifas con explicación visual:
  - 18,5 = operario estándar diurno
  - 23,5 = nocturno/especial
  - 15 = dieta
  - 0 = sin extra
  - N = nocturno
  - D = diurno

- Dashboard compacto:
  - ingresos
  - beneficio
  - eventos activos
  - operarios
  - clientes
  - albaranes sin firma
  - gráfico anual con tooltip flotante corregido

- GPS Live:
  - radios 50m, 100m, 200m, 300m, 500m

- Finanzas Pro:
  - coste operarios
  - seguridad social
  - gestoría
  - costes fijos
  - transporte
  - taxi
  - hotel
  - horas extra
  - otros costes

- Documentación:
  - subida de PDF/JPG/PNG/WEBP/DOCX
  - fecha emisión
  - fecha validez/caducidad
  - estado automático
  - vista de documentos en menú operario

- PDFs:
  - documentos y vistas A4 vertical estilo albarán


# V53.1 Backup + Delete + Suspend

## Añadido
- Borrar eventos con aviso de confirmación.
- Borrar operarios con aviso de confirmación.
- Suspender/reactivar operarios.
- Operario suspendido no puede entrar a su panel.
- Ajustes > Copia de seguridad:
  - Descargar backup completo JSON.
  - Restaurar backup completo JSON.


# V53.2 Dashboard Graph Hotfix
- Restaura la gráfica de progresión anual del dashboard.
- Añade `/api/dashboard-graph`.
- Tooltip flotante corregido para que no se corte.


# V53.3 Backup Center + Calendar Restore
- Corrige descarga de backup completo.
- Permite restaurar backup completo desde JSON.
- Añade backup online interno en servidor:
  - guardar backup
  - listar backups
  - restaurar backup
- Restaura calendario tipo Google Calendar.
- Nota: para persistencia real en Railway, activar volumen/persistent storage.


# V53.5 Persistent Backup Ready

## Objetivo
Que al subir nuevas versiones sigan apareciendo las copias de seguridad y se pueda recuperar la información.

## Importante Railway
Debes crear un Volume/Persistent Storage montado en:

/data

La app usa:
- Datos persistentes: /data
- Backups online: /data/backups

## Variables opcionales
PERSISTENT_DATA_DIR=/data
BACKUP_DIR=/data/backups

## En Ajustes
Aparecerá:
- Descargar backup completo.
- Cargar backup JSON.
- Guardar backup online.
- Lista de backups online disponibles.
- Restaurar cualquier backup guardado.

# V54 Enterprise Full Ops Backup Pro
- Backup con progreso y descarga automática.
- Control diario KPIs compactos.
- Calendario limpio + botón Google Calendar.
- Eventos realizados: albarán con proceso visual.
- Operarios avanzados con foto reescalada.
- Tarifas completas restauradas.
- GPS Live por colores.
- Finanzas Pro con buscador por fechas y PDF A4.
- Documentación en operario/jefe.
- Ajustes ERP con backup persistente.

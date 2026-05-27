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


# V55 Google Sync Full

## Incluye
- OAuth Google Calendar real.
- Endpoint /auth/google.
- Callback /auth/google/callback.
- Estado de conexión Google.
- Calendario visual tipo Google:
  - Mes
  - Semana
  - Día
- Exportar evento individual a Google.
- Exportar todos los eventos activos.
- Importar próximos eventos desde Google Calendar.
- Guardado de tokens en SQLite.
- Compatible con Railway Variables:
  - GOOGLE_CLIENT_ID
  - GOOGLE_CLIENT_SECRET
  - GOOGLE_CALLBACK_URL

## Redirect URI
https://marfan-crew-hours-production-ef76.up.railway.app/auth/google/callback


# V55.1 MARFAN Calendar Only

## Cambio importante
La sincronización Google Calendar queda limitada al calendario llamado:

MARFAN

## Variables opcionales en Railway
GOOGLE_TARGET_CALENDAR_NAME=MARFAN

Si quieres máxima precisión, puedes usar el ID exacto del calendario MARFAN:
GOOGLE_TARGET_CALENDAR_ID=<id_del_calendario_marfan>

## Comportamiento
- Exportar eventos: solo al calendario MARFAN.
- Importar eventos: solo desde el calendario MARFAN.
- No aparecerán eventos de otros calendarios personales.


# V55.2 Persistent Recovery Lock

## Objetivo
Que al actualizar la app NO desaparezcan:
- Copias online.
- Base de datos.
- Configuración Google Calendar MARFAN.

## Requisitos Railway
Volume montado en:
/data

## Rutas internas
- Backups online: /data/backups
- Estado persistencia: /api/backup/status-v552
- Listado robusto: /api/backup/list-online-v552
- Guardar backup: /api/backup/save-online-v552
- Restaurar backup: /api/backup/restore-online-v552

## Google Calendar
Mantiene por variables:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_CALLBACK_URL
- GOOGLE_TARGET_CALENDAR_NAME=MARFAN


# V55.3 Calendar Auto View

## Cambio principal
Se elimina la confusión del botón de vinculación dentro del calendario.

## Comportamiento
Al entrar en Calendario eventos:
- Aparece directamente la vista tipo Google.
- Carga eventos locales.
- Si Google está conectado, carga también eventos del calendario MARFAN.
- Al crear evento en la app, se exporta automáticamente al calendario MARFAN.
- No se muestran eventos de otros calendarios.

## Requisito
GOOGLE_TARGET_CALENDAR_NAME=MARFAN


# V55.4 OAuth Fix

## Usa esta URL para conectar Google
https://marfan-crew-hours-production-ef76.up.railway.app/auth/google-safe

## Diagnóstico
/api/google/debug-v554

## Railway Variables obligatorias
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALLBACK_URL=https://marfan-crew-hours-production-ef76.up.railway.app/auth/google/callback
GOOGLE_TARGET_CALENDAR_NAME=MARFAN


# V55.5 Operarios Pro

## Añadido
- Ficha completa de operario.
- Apodo / mote.
- Fotografía del operario.
- Redimensionado automático en navegador antes de subir.
- Listado con foto, nombre y mote.
- Botón Carpeta por operario.
- Carpeta con datos completos y documentos del operario.


# V55.6 Operarios UX Cliente Style

## Cambio principal
La creación de operarios se rediseña visualmente como el menú de clientes:
- bloques claros
- lectura más cómoda
- formulario menos saturado
- apodo/mote mantenido
- fotografía mantenida
- carpeta de documentos mantenida


# V55.7 Google Calendar Auto Connect

## Cambio principal
Al entrar en Calendario, la app intenta conectar automáticamente Google MARFAN si está configurado.

## Persistencia
El token se guarda en:
- SQLite
- /data/google-token.json

Esto evita repetir el proceso tras actualizar versión, siempre que Railway tenga Volume en /data.

## Estado
El calendario seguirá mostrando el estado:
- Google MARFAN conectado automáticamente
- OAuth pendiente
- Faltan variables Railway


# V55.8 Operarios Redesign Pro

## Rediseño menú Operarios
- Crear operario pasa a ventana modal/submenú.
- Datos principales:
  - Nombre
  - Apellidos
  - Apodo/mote
  - DNI
  - Fecha nacimiento
  - Teléfono
  - Email
  - Dirección completa
- Banco:
  - Nombre del banco
  - IBAN
- Perfil laboral:
  - Carnets vehículo/camión/carretilla/plataforma
- Emergencia:
  - Contacto
  - Teléfono
- Tallas:
  - Camiseta
  - Pantalón
  - Zapatos
- EPIs entregados.
- PRL/Riesgos laborales.
- Carga directa de documentos a carpeta personal.
- Notas internas.


# V55.9 Calendar UX + Evento Modal V46

## Cambios
- Conectar Google abre popup, no saca al usuario de la app principal.
- La app escucha la conexión y refresca calendario automáticamente.
- Crear evento pasa a ventana modal completa estilo V46.
- Formulario de evento con:
  - Datos principales
  - Fecha/horario/ubicación
  - Crew/operación
  - Tarifas/facturación
  - Notas internas


# V56.1 Google Calendar Sync Fix

## Corrige
- Si pone conectado, ahora lee eventos reales con `/api/google/marfan-events-v561`.
- Busca calendario MARFAN por:
  - GOOGLE_TARGET_CALENDAR_ID si existe
  - nombre exacto MARFAN
  - coincidencia flexible que contenga marfan
- Muestra diagnóstico visible en Calendario:
  - calendario encontrado
  - número de eventos leídos
  - error si no puede leer

## Endpoint diagnóstico
/api/google/calendars-v561
/api/google/marfan-events-v561


# V56.2 Informes PDF Pro A4

## Añadido en menú Informes PDF
- Selector de evento.
- Selector de personal.
- Informe interno de costes empresa por empleado.
- Coste hora empleado.
- Seguridad Social %.
- Gastos de gestoría.
- Transporte/taxi.
- Dietas.
- Extras.
- PDF A4 vertical mediante impresión/guardar PDF.


# V56.3 Calendar Force Sync + Evento V46 Full

## Calendario
- Añade botón Forzar sincronización.
- Lee eventos reales de Google MARFAN.
- Guarda/actualiza eventos en la base local.
- Muestra popup con eventos leídos, creados y actualizados.

## Crear evento
- Modal ampliado estilo V46.
- Datos principales, cliente, contacto, horarios, ubicación, operación, producción, tarifas, costes, notas.


# V56.4 Informes PDF Multi-Tipo

## Añadido
Mantiene el informe perfecto de V56.2 y añade selector de tipo:
- Costes empresa por empleado.
- Resumen general del evento.
- Horas de personal por evento.
- Albaranes del evento.
- Documentación del personal.

Todos en formato A4 vertical.

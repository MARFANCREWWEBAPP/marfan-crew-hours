
# V57.2 Calendar Sync Pattern Fix + Event Dynamic Roles

## Arregla calendario
- Nuevo botón real: FORZAR SINCRONIZACIÓN GOOGLE.
- Corrige error: "The string did not match the expected pattern".
- Usa fechas RFC3339 válidas.
- Diagnóstico antes de sincronizar.
- Importa eventos Google MARFAN a base local.

## Arregla crear evento
- Sobrescribe definitivamente el submenú.
- Seleccionas operario + rol del evento + turno.
- El precio cambia según rol y D/N.
- El mismo operario puede trabajar en roles distintos por evento.


# V57.3 PDF A4 Ver e Imprimir

## Cambios
- Botones separados:
  - Ver PDF A4
  - Imprimir PDF A4
- Operarios: carpeta documental.
- Eventos: albarán.
- Finanzas Pro: informe financiero interno.


# V57.4 Calendar Sync No Pattern Fix

## Corrección del error:
"The string did not match the expected pattern"

Esta versión crea un endpoint nuevo:
POST /api/google/sync-no-pattern-v574

No usa:
- timeMin
- timeMax
- orderBy

Así evitamos el error de patrón en Google Calendar API y sincronizamos de forma simple.


# V57.5 PDF A4 Global Viewer

## Objetivo
Cualquier documento PDF/A4 generado desde cualquier menú debe abrirse como submenú/modal.

## Acciones estándar
- Visualizar PDF A4
- Imprimir PDF A4

## Implementación
Función global:
openPdfA4SubmenuV575({title, subtitle, body, autoPrint})

Aplicado a:
- carpeta documental de operarios
- albarán de evento
- Finanzas Pro
- compatibilidad con funciones antiguas printHtmlV57 y buildA4ModalV573


# V57.6 Calendar Event Actions

## Calendario
Al pulsar un evento:
- abre subventana/modal
- muestra datos del evento
- permite editar
- permite borrar

## Borrar
- pide confirmación
- elimina evento
- elimina asignaciones
- elimina líneas de roles
- elimina enlaces Google internos
- refresca calendario


# V57.7 Calendar Click Fix

## Corrige
- Eventos del calendario sin respuesta al click.
- Añade delegación global de clicks.
- Renderiza eventos con data-event-id.
- Al pulsar evento abre subventana editar/borrar.


# V57.8 Calendar Click Hard Fix

## Cambio crítico
Reemplaza completamente el render del calendario:
- eventos como botones reales con data-cal-event-id
- listener global en captura
- no depende de onclick antiguos
- al pulsar evento abre subventana editar/borrar


# V57.9 Calendar Click Final Fix

## Solución
- Sobrescribe viewCalendar.
- Reengancha routes/views si existen.
- Listener en pointerdown y click, fase captura.
- MutationObserver para repintados.
- Si no hay data-id, intenta resolver evento por texto/nombre/hora.


# V58 Calendar Event Edit/Delete Direct

Al pulsar evento:
- abre subventana
- opción Editar evento
- opción Borrar evento
- confirmación antes de borrar
- refresco calendario

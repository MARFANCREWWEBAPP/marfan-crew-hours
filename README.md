
# V58.8 Calendar Delete Sync Fix

## Problema corregido
Al borrar eventos sincronizados, al volver a sincronizar Google Calendar reaparecían.

## Solución
- Al borrar evento con enlace Google, se guarda una marca en `deleted_google_events`.
- La sincronización ignora eventos marcados como borrados.
- Además intenta borrar el evento en Google Calendar si hay permisos.
- El modal de sync muestra cuántos eventos ha saltado por estar borrados.

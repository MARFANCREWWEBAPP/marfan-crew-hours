
# V62.15 Photo Icon + Event Persistence Hard Fix

Corrige:
- Al subir foto en edición de operario, ahora actualiza el avatar/icono automáticamente.
- Al editar evento, los datos extra se guardan doble:
  - tabla events
  - tabla event_extra_data
- Al abrir evento, restaura datos extra persistentes.
- Evita pérdida de localización, operarios, notas y datos extendidos tras actualización o resincronización.

No toca:
- Clientes
- Operarios importados
- Google Sync existente
- Login

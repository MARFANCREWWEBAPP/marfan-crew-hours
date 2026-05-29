
# V62.13 Event Save Admin Auth Fix

Corrige:
- Al editar evento y guardar salía "Solo administrador" aunque el usuario estuviera logueado como administrador.

Solución:
- Nueva ruta de guardado: POST /api/v6213/event-form-save
- Valida sesión admin de forma más compatible.
- Frontend envía credentials include + token/localStorage si existe.
- Mantiene Google Calendar push si está disponible.

No toca:
- Clientes
- Operarios
- Calendario visual
- Persistencia

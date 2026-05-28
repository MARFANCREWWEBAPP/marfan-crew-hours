
# V60 Edit Event Direct Real Fix

Objetivo:
- Solucionar definitivamente que Editar evento no funcione.

Cambios:
- Botón Editar pasa a data-edit-event-id-v60.
- Listener real por addEventListener en captura.
- Formulario de edición tipo V46.
- Endpoint nuevo independiente:
  - GET /api/events/:id/v60-edit
  - POST /api/events/:id/v60-edit
- Geolocalización y sugerencia de transporte.
- Mantiene:
  - login fix
  - Google Sync
  - borrar eventos
  - eventos borrados no se reimportan


# V62.11 Client Edit Button Fix

Corrige:
- En Clientes, algunos botones Editar abrían formulario de evento y daban:
  "Error abriendo formulario de evento: Evento no encontrado"

Añade:
- Formulario propio "Editar cliente".
- Endpoint separado de eventos:
  - GET /api/v6211/clients/:id/edit
  - POST /api/v6211/clients/:id/edit
- Fuerza botones Editar de clientes a abrir cliente, no evento.

No toca:
- Eventos
- Calendario
- Google Sync
- Operarios
- Persistencia

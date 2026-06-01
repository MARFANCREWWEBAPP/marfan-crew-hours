# V62.24 Password Edit Isolation Fix

Corrige:
- En Contraseñas, al pulsar Editar se abría el formulario de evento y salía:
  "Error abriendo formulario de evento: Evento no encontrado".

Solución:
- Aísla los botones Editar del menú Contraseñas.
- Bloquea la propagación hacia handlers globales de edición de eventos.
- Fuerza que Editar abra openPasswordEditV6220(id).

No toca:
- Eventos
- Calendario
- Operarios
- Usuarios/admins
- Persistencia

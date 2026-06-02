# V62.44 Real Calendar and Persistence Fix

Base: V62.35 estable.

Cambios reales, sin capas visuales:
- Modifica la vista real de calendario activa para añadir selector de mes junto al título del mes.
- Modifica /api/v612/event-form-save para persistir evento + localización + personal + roles + jefe de equipo.
- Modifica /api/v612/event-form-data para restaurar la información antes de abrir edición.
- Restaura automáticamente la persistencia al arrancar la versión.
- Restaura tras sincronización manual Google.

No añade vistas nuevas.

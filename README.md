# V62.46 Real Files Final Fix

Hecho sobre los archivos reales subidos por el usuario.

Correcciones:
1. DB real persistente: abre /data/marfan-crew-hours.sqlite, no __dirname/data/marfan.db.
2. La ruta activa de guardado /api/v6218/event-save-real persiste evento + localización + personal + roles + jefe de equipo en event_persist_v6246.
3. /api/events restaura persistencia antes de listar calendario.
4. /api/v612/event-form-data restaura persistencia antes de abrir edición.
5. Google description incluye localización, personal, roles y jefe de equipo.
6. El calendario activo V55/v561 incluye selector de mes en la vista real.

Importante: Railway debe tener Volume montado en /data.


# V62.16 Automatic Restore On Startup

Objetivo:
- Cualquier dato añadido debe recuperarse automáticamente al iniciar una nueva versión.
- No hay que pulsar nada.

Recupera automáticamente:
- Base de datos persistente /data/marfan-crew-hours.sqlite.
- Último backup si la DB no existe.
- Datos extra de eventos guardados en event_extra_data.
- Asignaciones de operarios guardadas con eventos.
- Fotos de operarios desde /data/uploads/operators.
- Documentos subidos en /data/uploads/operators.

También:
- Crea backup automático de arranque.
- Mantiene máximo 10 backups.
- Expone diagnóstico:
  GET /api/v6216-auto-restore-status
- Permite restauración manual si se necesita:
  POST /api/v6216-auto-restore-now

Muy importante:
- Railway debe tener volumen persistente montado en /data.


# V62.7 Persistent Data Fix

Corrige:
- Al actualizar versión, los datos editados de eventos podían desaparecer.

Solución:
- Base de datos en ruta persistente:
  DATA_DIR / PERSISTENT_DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH / /data
- Fuerza DB_PATH y SQLITE_PATH a /data/marfan-crew-hours.sqlite si no hay variable.
- Copia automáticamente una DB local existente al volumen si este aún está vacío.
- Añade diagnóstico:
  GET /api/v627-data-status
- Añade backup manual:
  POST /api/v627-backup-now
- Mantiene máximo 10 backups.

IMPORTANTE:
En Railway debes tener volumen persistente montado en /data.

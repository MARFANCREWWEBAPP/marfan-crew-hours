# V62.23 Users Persistence + Calendar AutoLoad Fix

Corrige:
- Usuarios/operarios/admins se exportan automáticamente a /data/json-backups/users-*.json.
- Si en una actualización falta la tabla/usuarios, se restauran automáticamente desde último JSON.
- Hace backup automático de usuarios al iniciar y al entrar en Operarios.
- Calendario intenta cargarse/restaurarse automáticamente al entrar y pulsa/lanza sincronización Google si existe botón.

Importante:
Railway debe mantener volumen persistente /data.

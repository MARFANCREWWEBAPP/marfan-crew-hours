# V62.45 Real DB Persistence Fix

Corrección real detectada en archivos subidos:
1. La app preparaba /data pero abría __dirname/data/marfan.db. Ahora abre DB_PATH_V627 en /data.
2. El formulario activo guardaba por /api/v614/event-form-save y esa ruta no persistía v6244. Ahora sí.
3. /api/events restaura datos persistidos antes de devolver listado.
4. Google Calendar recibe descripción con localización, personal, roles y jefe de equipo.
5. Calendario real tiene selector de mes igual estilo albaranes.

IMPORTANTE:
Para conservar datos entre versiones en Railway, el Volume debe estar montado en /data.

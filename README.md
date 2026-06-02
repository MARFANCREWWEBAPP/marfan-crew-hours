# V62.47 Fix Real V582/V583

Corrección hecha sobre los archivos reales.

Qué corrige:
1. La vista real del calendario es showCalendarV582. Ahora tiene:
   - Mes anterior
   - Hoy
   - Mes siguiente
   - selector type=month estilo Albaranes
2. El botón Editar evento del calendario V582 ya NO abre el formulario viejo V583.
   Abre openV612EventForm(id), que sí tiene personal, roles y jefe de equipo.
3. Se mantiene compatibilidad con save-v583 por si se usara.
4. No se toca el resto de módulos.

Causa real:
El formulario editEventFormV583 no tenía campos de operarios ni roles, y guardaba solo /api/events/:id/save-v583.

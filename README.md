# V62.48 Calendar Buttons Fix

Base: V62.47.

Corrige solo:
- Botón Mes anterior.
- Botón Hoy.
- Botón Mes siguiente.
- Selector de mes.

Motivo:
Los botones V62.47 dependían de modificar v55CalDate directamente desde onclick.
V62.48 usa funciones globales dedicadas:
- v6248CalendarPrevMonth()
- v6248CalendarToday()
- v6248CalendarNextMonth()
- v6248CalendarPickMonth(value)

No toca:
- edición moderna del evento
- personal asignado
- roles
- jefe de equipo
- Google Sync
- base de datos

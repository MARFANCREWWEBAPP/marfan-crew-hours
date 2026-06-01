# V62.37 Calendar Clean Stable

Base: V62.35 estable.

Cambios:
- Mantiene el calendario original de la app.
- Mantiene los botones originales Mes anterior / Hoy / Mes siguiente.
- No añade barras ni vistas nuevas.
- No filtra eventos.
- Desactiva restos de autosync/autoload automático que provocaban pantallas blancas o desaparición de eventos.
- Google Sync queda manual.
- No toca operarios, clientes, contraseñas, roles ni login.

Nota técnica:
viewCalendar() original ya contiene la navegación mensual con state.calendarMonth.

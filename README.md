
# V61.4 Google Calendar Push Fix

Base: V61.3.

Corrige:
- Crear/editar evento en la app no aparecía en Google Calendar.

Añade:
- Al guardar desde el formulario V61.2, crea/actualiza evento en Google Calendar MARFAN.
- Si ya existe enlace google_event_links, actualiza el evento Google.
- Si no existe, crea evento nuevo y guarda enlace.
- Mantiene calendario, login y formulario V46 intactos.

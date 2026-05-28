
# V60.1 Edit Fetch Pattern Fix

Corrige:
- Error al editar: "The string did not match the expected pattern".

Causa probable:
- Wrapper api() antiguo/rutas dinámicas del frontend.

Solución:
- Editar usa fetch directo con URL absoluta.
- Endpoint simple por query:
  - GET /api/event-v601-edit?id=ID
  - POST /api/event-v601-edit?id=ID
- Mantiene formulario V46, geolocalización y transporte.

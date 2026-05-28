
# V60.2 Edit API Route Order Fix

Corrige:
- Editar devolvía index.html en lugar de JSON.
- Causa: endpoint definido después del fallback SPA.

Solución:
- Nuevos endpoints tempranos ANTES de express.static/fallback:
  - GET /api/event-v602-edit?id=ID
  - POST /api/event-v602-edit?id=ID
- Frontend usa Accept: application/json.
- Si vuelve HTML, muestra diagnóstico claro.

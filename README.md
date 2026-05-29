
# V62.9 Real Clients Import

Base: V62.8.

Hace:
- Borra clientes demo.
- Importa 109 clientes reales desde CLIENTES_MARCREW_2026.xlsx.
- Guarda:
  - Cliente
  - Razón social
  - Persona contacto
  - Dirección
  - Provincia
  - CIF
  - Mail
  - Teléfono
  - Observaciones
- Upsert por CIF, email o nombre.
- No duplica si vuelves a desplegar.

Endpoints:
- POST /api/v629/import-real-clients
- GET /api/v629/real-clients-preview

Mantiene:
- Operarios reales V62.8
- Persistencia V62.7
- Calendario
- Google Sync
- Formularios V46

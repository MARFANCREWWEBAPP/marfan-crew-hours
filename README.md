
# V62.8 Real Operators Import

Base: V62.7 Persistent Data Fix.

Hace:
- Borra operarios demo conocidos.
- Desactiva la creación automática de demos en initDb.
- Importa 14 operarios reales desde Excel:
  - Nombre
  - Apellidos
  - Teléfono
  - Email
  - DNI
  - Nº Seguridad Social
  - IBAN
- Crea email interno si el Excel no trae correo: DNI@marfancrew.local
- Upsert por DNI/email para no duplicar.
- Endpoint manual:
  - POST /api/v628/import-real-operators
- Preview:
  - GET /api/v628/real-operators-preview

Contraseña inicial para nuevos operarios:
- Marfan1234*

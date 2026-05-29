
# V62.12 Operator Edit ID Fix

Corrige:
- En Operarios, algunos botones Editar abrían con un ID incorrecto y daban:
  "Operario no encontrado".

Causa:
- El extractor cogía números de DNI/teléfono/IBAN como si fueran ID.

Solución:
- Solo usa ID si está en data-user-id / data-operator-id / onclick claro.
- Si no, busca el operario por DNI, email, teléfono o nombre visible de la fila.
- Reutiliza el modal de edición V62.10 cuando encuentra el ID real.

No toca:
- Clientes
- Eventos
- Calendario
- Google Sync
- Persistencia

# V62.49 Calendar Buttons Use Picker

Base: V62.48.

Corrige:
- Mes anterior.
- Hoy.
- Mes siguiente.

Cambio:
Los botones ya no dependen del scope de v55CalDate.
Ahora leen el valor real del input type=month, calculan el mes y llaman al mismo flujo que ya funciona cuando se cambia el selector manualmente.

No toca edición, personal, roles ni Google Sync.

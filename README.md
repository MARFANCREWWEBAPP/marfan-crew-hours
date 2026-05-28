
# V59.2 Login Gate Fix

Corrige:
- La V59.1 podía entrar directamente en la app sin pasar por login.
- Ahora las vistas internas quedan bloqueadas si no existe token/sesión local.
- No toca el login si ya está visible.
- Mantiene base V58.9 + menú seguro.

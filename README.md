
# V58.9 Sync Modal Hard Close Fix

Corrige definitivamente:
- El modal de sincronización se queda bloqueado.
- Botón Cerrar no responde.
- Overlay no se libera.

Solución:
- hardCloseModalV589 elimina modalRoot directamente.
- Cierra con botón Cerrar.
- Cierra con botón Cerrar ventana.
- Cierra con Escape.
- Cierra con click fuera.
- Limpia clases loading.
- Reengancha todos los botones de sincronización.

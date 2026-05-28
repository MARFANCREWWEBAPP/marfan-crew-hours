
# V61.3 Solo Login Fix

Base: V61.2, calendario y formulario V46 intactos.

Corrige solo:
- Evitar entrada directa a la app sin sesión real.
- No toca calendario.
- No toca crear/editar evento.
- No bloquea submit del login.

Estrategia:
- Si ya se ve login, no hace nada.
- Si el usuario acaba de pulsar Entrar, no bloquea.
- Si hay token/sesión, no bloquea.
- Si no hay sesión y detecta que está dentro de la app, fuerza login/logout.

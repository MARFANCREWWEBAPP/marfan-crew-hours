# Marfan Crew 2.0 — Clean Rebuild

Versión limpia creada desde cero. No contiene código heredado de V62/V63.

## Arranque local

```bash
cp .env.example .env
npm install
npm start
```

Abrir: http://localhost:3000

Usuario inicial:
- admin@marfan.local
- Admin1234!

## Incluye

- Login JWT.
- Roles: Super Admin, Admin, Jefe de equipo, Operario, Cliente.
- Menú de usuarios admin.
- Crear/editar usuarios.
- Reset de contraseña.
- Clientes.
- Eventos.
- Asignación de equipo.
- Fichajes con estructura GPS.
- Dashboard operativo.
- Diseño Apple-style responsive.
- Base de datos SQLite local para pruebas.

## Próximo salto recomendado

Para producción real:
- PostgreSQL.
- Prisma.
- Migraciones versionadas.
- PDFs de albaranes.
- Firma digital canvas.
- PWA móvil.
- Permisos por módulo.
- Auditoría de cambios.
- Backups automáticos.

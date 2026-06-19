
# MARFAN CLEAN 1

App nueva desde cero para gestión de personal de eventos.

## Objetivo

Eliminar el caos de versiones anteriores y arrancar con una base limpia, estable y funcional.

## Importante

Esta app NO usa Express ni dependencias externas. Solo Node.js nativo.

Esto evita errores como:
- Cannot find module 'express'
- package-lock desincronizado
- npm install roto
- dependencias nativas de SQLite

## Persistencia

Usa JSON persistente en:

`/data/marfan-clean-db.json`

Si no existe, arranca desde:

`data/db.seed.json`

## Railway

Incluye:
- package.json sin dependencias
- railway.json
- nixpacks.toml
- server.js

## Login

Admin:
- usuario: `admin@marfancrew.com`
- contraseña: `admin123`

Operario demo:
- usuario: `600000000`
- contraseña: `1234`

## Módulos incluidos

- Dashboard
- Calendario de Eventos
- Centro de Operaciones
- Control Diario
- Operarios Activos
- Planificador Inteligente
- Incidencias Pro
- Clientes
- Operarios
- Asignaciones con bloqueo de solapamientos
- Documentación
- Tarifas
- Albaranes A4
- Finanzas Pro
- Informes / imprimir PDF desde navegador
- Vista Operario
- Backup JSON

## Siguiente paso

Cambiar logo, colores, textos y formularios concretos sobre esta base limpia.

# Marfan Crew Hours V52 - V46 A4 Vertical + Auditoría completa

## Base
Esta versión SÍ parte directamente de:
`marfan-crew-hours-v46-a4-vertical-pdf.zip`

## Se mantiene de V46
- Diseño original V46.
- Dashboard original.
- Menú Tarifas original.
- Calendario eventos.
- Eventos realizados.
- Operarios.
- Clientes.
- Albaranes A4 vertical.
- Vista operario/jefe equipo.
- Firma cliente.
- Informes PDF.
- Lógica de fichajes, nocturnidad, mínimo 4h y A4 vertical.

## Añadido auditoría
- Operaciones.
- GPS Live.
- Producción Live funcional.
- Finanzas Pro.
- Documentación RRHH.
- Estados operativos.
- Costes y margen por evento.
- Alertas de crew incompleto.
- Documentos con caducidad.
- Producción por fases.

## Admin
Se mantiene el sistema de admin de la V46.

## Railway
/health debe devolver OK.


# V52.1 Hotfix Startup
Corrige el error:
`ReferenceError: addDaysJS is not defined`

Mantiene base V46 A4 Vertical + módulos auditoría.


# V52.2 Hotfix Admin Access

## Credenciales garantizadas
Usuario: admin@marfancrew.local
Contraseña: Admin1234*

Esta versión fuerza el acceso admin aunque exista una base SQLite anterior con otra contraseña.


# V53 Enterprise Stable Build

## Implementado
- Tarifas con explicación visual:
  - 18,5 = operario estándar diurno
  - 23,5 = nocturno/especial
  - 15 = dieta
  - 0 = sin extra
  - N = nocturno
  - D = diurno

- Dashboard compacto:
  - ingresos
  - beneficio
  - eventos activos
  - operarios
  - clientes
  - albaranes sin firma
  - gráfico anual con tooltip flotante corregido

- GPS Live:
  - radios 50m, 100m, 200m, 300m, 500m

- Finanzas Pro:
  - coste operarios
  - seguridad social
  - gestoría
  - costes fijos
  - transporte
  - taxi
  - hotel
  - horas extra
  - otros costes

- Documentación:
  - subida de PDF/JPG/PNG/WEBP/DOCX
  - fecha emisión
  - fecha validez/caducidad
  - estado automático
  - vista de documentos en menú operario

- PDFs:
  - documentos y vistas A4 vertical estilo albarán

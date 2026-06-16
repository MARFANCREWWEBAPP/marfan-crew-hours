# Marfan Crew 2.0.5 Enterprise Operations

Versión limpia 2.0 con operativa replicada desde V62.49 sin `express-session` y preparada para Railway.

## Incluye

- Diseño Apple limpio.
- Login admin y login operarios por teléfono/email.
- Clientes reales importados.
- Operarios reales importados.
- Calendario de eventos.
- Control diario.
- Fichaje entrada/salida con GPS.
- Vista operario móvil.
- Firma/validación de cliente en salida y albaranes.
- Asignación de operarios a eventos.
- Eventos realizados.
- Tarifas y roles operativos.
- Finanzas Pro: presupuesto, costes y margen.
- Informes: semanal, clientes y horas de operarios.
- Documentación.
- Caja de contraseñas.
- Backup export JSON.
- Ajustes ERP: IVA, dietas, kilometraje, nocturnidad y empresa.

## Arranque local

```bash
cp .env.example .env
npm install
npm start
```

## Login inicial

```txt
admin@marfan.local
Admin1234!
```

## Login operarios importados

Pueden entrar con teléfono o email. Contraseña inicial:

```txt
Marfan1234*
```

## V2.0.5 PDF A4 PRO

Esta revisión mantiene la base V2.0.5 y añade generación real de PDF A4 profesional para albaranes.

### Nuevo
- Botón `Descargar PDF A4` dentro de Albaranes.
- Endpoint seguro: `GET /api/event-delivery-notes/:id/pdf`.
- PDF A4 con cliente, evento, operarios, fichajes, horas normales, horas nocturnas, dietas, km, IVA, total y validación cliente.
- Dependencia nueva: `pdfkit`.

### Railway
Railway instalará `pdfkit` automáticamente al desplegar porque está en `package.json`.

# Propuesta Marfan Crew 2.0 Enterprise

## Objetivo
Convertir Marfan Crew en una plataforma operativa completa para cargas, descargas, personal técnico, limpieza, auxiliares, eventos, albaranes y control económico.

## Módulos prioritarios
1. Dashboard dirección: facturación, costes, margen, eventos del día, operarios activos.
2. Calendario tipo Google: eventos por día, semana y mes.
3. Eventos: cliente, ubicación, equipo, horarios, notas internas, material asociado.
4. Operarios: tarifa, cargo, documentación, disponibilidad, historial.
5. Clientes: datos fiscales, firma, contactos, histórico de eventos.
6. Fichajes: entrada/salida, GPS, validación por evento del día.
7. Albaranes PDF: A4, firma, DNI, IVA, resumen de horas y extras.
8. Finanzas: dietas, nocturnidad, kilometraje, descuentos, márgenes.
9. WhatsApp: avisos de equipo y envío de albarán.
10. Multiempresa: Marfan Crew y Marquee Producciones.

## Mejoras visuales
- Interfaz Apple: tarjetas limpias, blur, sidebar sobria, responsive iPhone/iPad.
- Modo oscuro.
- Acciones rápidas por evento.
- Vista móvil específica para operario.

## Arquitectura producción recomendada
- Frontend: Next.js.
- Backend: API Node.js.
- Base de datos: PostgreSQL.
- ORM: Prisma.
- Auth: JWT + refresh tokens.
- Deploy: Hetzner / Railway / VPS Docker.
- Backups: diario automático.

## Fases
### Fase 1 — MVP estable
Usuarios, roles, clientes, eventos, asignaciones, fichajes.

### Fase 2 — Operación real
PDFs, firma, calendario avanzado, WhatsApp, permisos granulares.

### Fase 3 — Dirección
Costes, márgenes, dashboard anual, exportaciones Excel, informes por cliente/operario.

### Fase 4 — App móvil PWA
Acceso operario ultra simple: evento de hoy, fichar, firmar, contactar.

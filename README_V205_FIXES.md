# Marfan Crew 2.0.5 Enterprise Fix

Versión post-auditoría sobre V2.0.4 PDF A4.

## Correcciones principales

- Vista operario limitada a eventos asignados.
- Fichaje con validación de asignación.
- Geocerca configurable por evento si el evento tiene lat/lng.
- Bloqueo de fichaje duplicado abierto.
- Pausas/descansos en salida.
- Corrección administrativa de fichajes con motivo y auditoría.
- Albarán A4 Pro con líneas por operario.
- Cálculo por operario: horas normales, nocturnas exactas minuto a minuto, tarifa, dieta y total de línea.
- Firma manuscrita con canvas desde la interfaz.
- Bloqueo del albarán tras firma.
- Firma insertada en PDF A4.
- Documentación con subida real de archivo en base64 desde interfaz.
- Caja de contraseñas cifrada en base de datos con AES-256-GCM.
- Registro de auditoría de acciones críticas.
- Menú de auditoría.
- Ajustes nuevos: geocerca, prefijo de albarán, datos fiscales empresa.

## Variables recomendadas en Railway

```env
JWT_SECRET=pon_una_clave_larga_y_segura
VAULT_SECRET=pon_otra_clave_larga_para_cifrar_contrasenas
DATABASE_FILE=/data/marfan.sqlite
AUTO_IMPORT_LEGACY_DATA=false
```

## Login inicial

```txt
admin@marfan.local
Admin1234!
```

## Importante

Si el evento no tiene coordenadas `lat/lng`, la app permite fichar pero no aplica geocerca. Para control GPS real, añade coordenadas al evento.

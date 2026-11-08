# Estado del proyecto — Plant Health Application

## Fase actual
**Fase 4 — Interfaz y backend (en progreso; despliegue no verificado)**

## Funciones implementadas
- **Plataforma exclusiva de café (Coffea spp.):** cilantro eliminado por completo (UI, adaptador `mock-cilantro`, imagen pública y migración `009_coffee_only_platform.sql`); el envío de fotos exige dos categorías — planta completa + primeros planos de hojas.
- **Integración de código del modelo real (noviembre 2026):** adaptador `lib/models/coffee-real.ts` que llama al servicio de inferencia Python (`model-service/`, FastAPI): envía los bytes originales por multipart a `POST /predict`, aplica los umbrales localmente (minador 0.31, roya 0.42, phoma 0.21, cercospora 0.31), calcula la confianza (máxima probabilidad disparada; 1 − máxima cuando nada dispara) y mapea las salidas a la predicción en español con lenguaje cauteloso y no diagnóstico. Activación env-gated: solo con `COFFEE_MODEL_ENDPOINT` configurada; sin ella sigue activo `mock-coffee` (respaldo documentado con su etiqueta "resultado simulado"). **El código de integración NO equivale a un modelo operativo** — falta trasladar el checkpoint y alojar el servicio (ver Pendientes).
- Página pública en español, inicio de sesión, recuperación de contraseña por correo, actualización de contraseña y cierre de sesión.
- Panel administrativo protegido y creación de cuentas de agricultores desde servidor.
- Gestión de plantas de café (Coffea spp.; cultivo único soportado) con propiedad por agricultor.
- Carga privada de imágenes JPEG, PNG y WebP, con límite de 10 MB, comprobación del encabezado binario, verificación de propiedad y metadatos.
- Historial privado de fotos con enlaces firmados y estados de evaluación.
- Cola administrativa para revisión humana de fotos. Las revisiones quedan identificadas como `human-review`; alta o crítica severidad exige recomendar seguimiento experto.

## Stack actual
- Node.js 24.19.0 en Windows y 22.22.1 en WSL Linux; ambos superan el mínimo declarado (>=20.9.0). El build OpenNext verificado se ejecutó con Node Linux 22.22.1.
- Next.js 16.4.3, React 19.3.1, Supabase SSR 0.12.7, Zod 4.6.7.
- Vitest 5.0.5, Vite 8.3.5, ESLint 10.14.0.
- Cloudflare OpenNext 1.20.15 y Wrangler 4.156.1 para vista previa local y un posible despliegue en Workers.

## Verificaciones
- **Integración del modelo real — fase 2 TypeScript (noviembre 2026):** Vitest PASS (31 archivos / 231 pruebas, incluye `coffee-real.test.ts` con `fetch` simulado: contratos /health y /predict, umbrales límite inclusivo, regla de confianza, respuestas inválidas, timeout y fallos de red), TypeScript PASS, ESLint PASS. NO se probó contra el modelo real: el checkpoint no está en el repositorio y el servicio no está alojado — el resultado real queda como contrato probado, no como funcionamiento verificado.
- **Refactor coffee-only (noviembre 2026):** TypeScript PASS, ESLint PASS, Vitest PASS (30 archivos / 208 pruebas), `npm run build` PASS. Sin referencias de cilantro en el activo (solo migración histórica 001, migración de eliminación 009 y la prueba que verifica el rechazo de 'cilantro'). Contrato de aprendizaje profundo documentado en `docs/deep-learning.md`.
- TypeScript (`tsc --noEmit --incremental false`): PASS.
- ESLint (`npm run lint`): PASS, sin advertencias.
- Pruebas locales (`npm run test`): PASS, 28 pruebas en 9 archivos, incluyendo límites multipart/JSON sin `Content-Length` y autorización/auditoría del endpoint de revisión.
- Build estándar (`npm run build`): PASS; incluye revisión manual y recuperación de contraseña.
- Build OpenNext con Node Linux en WSL: PASS; se generó `.open-next/worker.js` y Next.js compiló las 22 rutas. El envoltorio `opennextjs-cloudflare preview` en WSL falla por `SQLITE_IOERR_SHMOPEN` en `/mnt/c`; Wrangler Linux directo con persistencia en `/tmp` sí arrancó. El preview Windows también arrancó, con la advertencia de OpenNext sobre compatibilidad Windows. En el Worker actualizado: `/` → 200, `/api/admin/analyses` y `/api/plants` sin sesión → 401, `/api/auth/reset-password` con cuerpo JSON de 70 KB → 413, y en `POST /api/images` 12 peticiones sin sesión → 401 y la 13.ª → 429. No se probaron sesiones reales, correo ni acceso autenticado a Supabase desde este preview.
- Simulación de publicación (`wrangler deploy --dry-run`): PASS, 8,291.10 KiB sin comprimir frente al límite actual de 64 MiB; no se publicó. El plan gratuito permite 100 000 solicitudes al día y limita cada solicitud a 10 ms de CPU.
- Supabase local principal: historial 001–003; migración 003 aplicada y registrada. Bucket `plant-images` confirmado privado, con límite de 10 MB y tipos permitidos JPEG/PNG/WebP. La migración 004 todavía no se aplicó a esta base.
- PostgreSQL de prueba aislado: replay limpio de migraciones 001–004 PASS con un shim de Auth/Storage; 9 tablas públicas con RLS, 28 políticas públicas, 5 políticas de Storage, aislamiento de perfiles/plantas, rechazo de auto-promoción y auto-democión, bloqueo de escrituras admin directas, rechazo de cambios multi-fila que eliminan administradores, escrituras de revisión/auditoría vía service role y protección/consistencia del contador comprobados. El shim no sustituye la integración con Supabase alojado. La base temporal se eliminó al terminar; los scripts reproducibles están en `supabase/tests/`.
- PostgreSQL local previo: pruebas transaccionales con rollback bloquearon autopromoción, lectura de una planta de otro propietario y actualización de análisis por agricultor; Storage permitió una ruta propia y rechazó una ajena. Estas pruebas se hicieron antes de la migración 004.
- Estas verificaciones locales no sustituyen una revisión completa de todas las políticas con varias cuentas de agricultor.
- Auditoría de producción (`npm audit --omit=dev --audit-level=moderate`, verificada de nuevo): 0 vulnerabilidades. Auditoría completa tras añadir OpenNext: 19 hallazgos moderados en herramientas de desarrollo, sin hallazgos altos o críticos; el hallazgo alto de `glob` se resolvió con un override fijado en `package.json` y `package-lock.json`.

## Pendientes antes de lanzamiento
1. Configurar `NEXT_PUBLIC_APP_URL`, el dominio de redirección permitido y SMTP/correo de Supabase; verificar inicio de sesión, alta, recuperación y carga en staging.
2. Aplicar la migración `004_server_only_admin_writes.sql` en staging antes de validar el flujo de revisión y confirmar que las escrituras directas de admin reciben cero filas.
3. No hay modelo operativo aún: existe el código de integración (`coffee-real.ts` + registro env-gated + servicio Python listo en `model-service/`), pero falta (a) trasladar el checkpoint `coffee_efficientnetb0_finetuned_best.keras` a `model-service/checkpoints/`, (b) alojar el FastAPI en Python 3.10–3.13 y verificar `GET /health` → 200, y (c) configurar `COFFEE_MODEL_ENDPOINT`. Hasta entonces el lanzamiento se presenta como revisión manual, con el flujo simulado etiquetado como tal.
4. Definir el responsable agrícola que revisará la cola y validar sus recomendaciones antes de habilitar usuarios reales.
5. Para Cloudflare se usa el middleware Edge de Next (`middleware.ts`), que compiló y funcionó en el preview local. Next.js 16 lo depreca; hay que planificar otra estrategia cuando Next lo retire. `/admin` y `/dashboard` también comprueban sesión y rol dentro de sus páginas. Faltan pruebas con sesiones reales en staging.
6. El plan gratuito de Workers limita CPU por solicitud a 10 ms; medir SSR y rutas autenticadas bajo carga real. Si excede el límite, cambiar a un plan compatible o una plataforma con capacidad suficiente.
7. Configurar variables y secretos en Workers y en las variables de compilación si se usa CI; ajustar el dominio HTTPS, redirect allowlist y correo de Supabase.
8. Los límites locales están configurados para login (10/min), registro (3/min), recuperación (3/min) y carga (12/min), por IP y ruta. Verificar los bindings en Workers desplegado y completar pruebas con al menos dos agricultores y una cuenta administrativa en staging.
9. Mantener el producto descrito como revisión manual hasta conectar un modelo probado y asignar al responsable agrícola.
10. `workers.dev` sirve para una demo personal/de hobby; no está recomendado para uso crítico de negocio. Confirmar dominio y condiciones de alojamiento según el tipo de lanzamiento.













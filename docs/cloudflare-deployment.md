# Guía de despliegue — Cloudflare Workers

## Estado actual

La configuración de Cloudflare/OpenNext está preparada en `wrangler.jsonc`, `open-next.config.ts`, `next.config.mjs` y `package.json`. Next genera salida `standalone` para que OpenNext la empaquete. El build de OpenNext con Node Linux en WSL terminó correctamente. El Worker actualizado respondió 200 en `/`, 401 en rutas protegidas sin sesión, 413 para un JSON de recuperación de 70 KB y 429 en la 13.ª solicitud de `POST /api/images`.

`wrangler deploy --dry-run` empaquetó correctamente el Worker actualizado: 8,291.10 KiB sin comprimir y 1,716.93 KiB gzip. La documentación actual de Cloudflare establece un máximo de 64 MiB sin comprimir para Workers Free y Paid; este artefacto queda dentro del límite. El comando fue solo una simulación y no publicó la aplicación.

El comando envoltorio `opennextjs-cloudflare preview` desde WSL sobre `/mnt/c` falla al iniciar SQLite (`SQLITE_IOERR_SHMOPEN`), incluso con `--persist-to`. Wrangler directo sí inicia si se guarda su estado en el filesystem Linux. Después del build, usar:

```sh
/usr/bin/node ./node_modules/wrangler/bin/wrangler.js dev --local --port 8788 --persist-to /tmp/agritech-wrangler-state
```

El preview Windows también funciona, aunque OpenNext advierte que Windows no es su entorno recomendado.

No se ha desplegado a una cuenta Cloudflare ni se han configurado variables de producción. Las sesiones autenticadas, recuperación de correo, carga de imágenes conectada a Supabase, latencia y límites de CPU requieren staging.

## Límites que condicionan el lanzamiento

- [OpenNext](https://opennext.js.org/cloudflare/get-started) soporta middleware Edge, pero no middleware Node. Por eso el proyecto usa `middleware.ts` para renovar sesiones y redirigir, en lugar del `proxy.ts` Node; Next.js 16 depreca el convenio `middleware.ts`, así que habrá que migrarlo antes de una versión que lo retire. `/admin` y `/dashboard` además comprueban sesión y rol en sus páginas. El preview con Edge middleware compiló y verificó redirects, pero las sesiones reales todavía requieren staging.
- Según los [límites actuales de Workers](https://developers.cloudflare.com/workers/platform/limits/), el plan Free incluye 100 000 solicitudes por día y 10 ms de CPU por solicitud. No se ha medido si el renderizado de AgriTech queda por debajo de ese límite. La API limita las fotos a 10 MB; validar ese flujo con Supabase en staging.
- La cola de revisión humana funciona como proceso manual. No hay modelo automático conectado.
- El Worker incluye bindings para login (10/min), registro (3/min), recuperación (3/min) y carga (12/min), por IP y ruta. El preview local verificó que la 13.ª petición de carga recibe 429. Confirmar su comportamiento después de publicar. Los límites son aproximados por ubicación, no son una cuota global estricta. El conteo por IP también puede afectar a varias personas que compartan la misma red; revisar estos umbrales según el uso real. Consulta la [documentación de rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) para sus límites de consistencia.
- Las rutas JSON limitan el cuerpo a 64 KiB por stream; el preview respondió 413 a un cuerpo de 70 KB incluso sin autenticación en la ruta de recuperación.

Los identificadores de namespace en `wrangler.jsonc` deben ser únicos en tu cuenta de Cloudflare; cámbialos si ya están asignados a otros bindings.

## URL de prueba y uso previsto

El dominio `workers.dev` permite una URL pública sin comprar un dominio. Cloudflare lo describe como adecuado para proyectos personales o de hobby, no para aplicaciones críticas de negocio; revisar ese límite antes de usarlo como lanzamiento comercial. Consulta la [documentación de workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Variables necesarias

Configurar en el entorno de compilación las variables públicas necesarias para Next.js y en Workers runtime variables/secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL` — origen HTTPS del sitio final.

### Secreto de servidor: `SUPABASE_SECRET_KEY`

`SUPABASE_SECRET_KEY` es el nuevo secreto de runtime del servidor. Corresponde a una
clave Secret API de Supabase (que actúa con el rol `service_role`) y sustituye a la
antigua `SUPABASE_SERVICE_ROLE_KEY` del JWT heredado. Reglas:

- Nunca publicar este valor ni incluirlo en el código de cliente; solo lo lee
  `lib/supabase/service.ts`, que está protegido con `import 'server-only'`.
- En producción de Cloudflare, configurar el valor como **runtime secret** del Worker
  (dashboard de Cloudflare o `wrangler secret put SUPABASE_SECRET_KEY`); las claves
  Secret no se pueden leer de vuelta.
- En el preview local del Worker (`opennextjs-cloudflare preview` / `wrangler dev`),
  recibir el valor por medio de un archivo `.dev.vars` (cubierto por `.gitignore`):
  nunca se confirma en el repositorio ni se compila en el artefacto generado.
- **No** colocar el valor en ningún archivo `.env*` al ejecutar `opennextjs-cloudflare
  build`: OpenNext incrusta los valores de los archivos `.env*` del proyecto en el
  artefacto generado (`.open-next/cloudflare/next-env.mjs`) y, en runtime, solo los usa
  como reserva si falta el binding. Las variables públicas (`NEXT_PUBLIC_*`) sí pueden
  usarse en el entorno de compilación, porque Next.js las necesita para el inlining.
- Histórico: las versiones anteriores de este proyecto leían
  `SUPABASE_SERVICE_ROLE_KEY`; esa variable ya no se usa en el código.

Configurar también el mismo dominio exacto en Supabase Auth como Site URL y redirect permitido, y disponer de entrega de correo para recuperación de contraseña. No guardar valores reales en este documento ni en el repositorio.

## Validación local

Desde la carpeta del proyecto:

```sh
npm install
npm run lint
npm run test
npx tsc --noEmit --incremental false
npm run preview
```

El preview usa el puerto local 8788 con la configuración actual. Para cerrarlo, detener el proceso con `Ctrl+C`.

## Publicación

Antes de validar staging/producción, aplicar las migraciones 001–004 en Supabase y verificar que la API de revisión funcione mientras las escrituras directas de administrador estén denegadas.

Después de configurar y verificar las variables, ejecutar `npm run deploy` desde un entorno autenticado con Wrangler. Esa acción sí publica la app; no se ha ejecutado.

Al terminar, probar registro, inicio y cierre de sesión, panel administrativo, alta de planta, carga JPEG/PNG/WebP hasta 10 MB, historial privado, recuperación de contraseña y revisión humana. Confirmar que agricultor A no puede acceder a datos de agricultor B. No habilitar usuarios reales hasta completar estas verificaciones y definir quién revisa las fotos.





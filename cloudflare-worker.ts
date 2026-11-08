// OpenNext generates this module during `opennextjs-cloudflare build`.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- OpenNext generates this module during build.
// @ts-ignore Generated module is unavailable before the OpenNext build.
import handler from './.open-next/worker.js'

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

type Env = {
  LOGIN_RATE_LIMIT: RateLimiter
  REGISTER_RATE_LIMIT: RateLimiter
  RECOVERY_RATE_LIMIT: RateLimiter
  IMAGE_UPLOAD_RATE_LIMIT: RateLimiter
}

const rateLimitedRoutes: Record<string, keyof Env> = {
  'POST /api/auth/login': 'LOGIN_RATE_LIMIT',
  'POST /api/auth/register': 'REGISTER_RATE_LIMIT',
  'POST /api/auth/reset-password': 'RECOVERY_RATE_LIMIT',
  'POST /api/auth/update-password': 'RECOVERY_RATE_LIMIT',
  'POST /api/images': 'IMAGE_UPLOAD_RATE_LIMIT',
}

const worker = {
  async fetch(request: Request, env: Env, context: unknown): Promise<Response> {
    const url = new URL(request.url)
    const bindingName = rateLimitedRoutes[`${request.method} ${url.pathname}`]

    if (bindingName) {
      const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
      const { success } = await env[bindingName].limit({ key: `${url.pathname}:${clientIp}` })
      if (!success) {
        return Response.json(
          { error: 'Demasiadas solicitudes. Inténtalo de nuevo en un minuto.' },
          {
            status: 429,
            headers: { 'cache-control': 'no-store', 'retry-after': '60' },
          },
        )
      }
    }

    return handler.fetch(request, env, context)
  },
}

export default worker



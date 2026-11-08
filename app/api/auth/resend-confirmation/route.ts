import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { readBoundedJson } from '@/lib/http/read-bounded-json'
import { createRateLimiter } from '@/lib/http/rate-limiter'

/**
 * Re-sends the Supabase signup confirmation email for a pending farmer
 * account. Reachable without a session, with server-side rate limiting.
 *
 * Anti-enumeration: the response is always success, even when the account is
 * unknown or already confirmed — it never reveals whether an email exists.
 * Supabase's own auth rate limiting provides a second layer.
 */

// 1 resend per 60 s per email; 8 per hour per connection.
const perEmailLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 1 })
const perIpLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 8 })

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || 'unknown'
}

export async function POST(request: Request) {
  try {
    return await resendConfirmation(request)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function resendConfirmation(request: Request): Promise<NextResponse> {
  const ip = clientIp(request)

  const body = await readBoundedJson(request)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const emailResult = z.string().trim().email().max(254).transform((value) => value.toLowerCase()).safeParse(
    (body.value as { email?: unknown })?.email,
  )
  if (!emailResult.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const email = emailResult.data

  if (!perIpLimiter.check(ip)) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes desde esta conexión. Inténtalo de nuevo más tarde.' },
      { status: 429 },
    )
  }
  if (!perEmailLimiter.check(email)) {
    return NextResponse.json(
      { error: 'Acabamos de enviar un correo de confirmación. Inténtalo de nuevo en un minuto.' },
      { status: 429 },
    )
  }

  // Uses the existing cookie-based anon server client: resend only works for
  // a sign-up-flow pending account, otherwise Supabase reports an error that
  // we deliberately swallow to avoid account enumeration.
  const supabase = await createClient()
  let resendError
  try {
    const result = await supabase.auth.resend({ type: 'signup', email })
    resendError = result.error
  } catch (reason) {
    resendError = reason
  }

  // Whether Supabase succeeded, the account is unknown, or the email is
  // already confirmed: the public answer is identical.
  void resendError
  return NextResponse.json({ success: true })
}

import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { createPublicAuthClient } from '@/lib/supabase/public-auth'
import { createAuditLog } from '@/lib/audit'
import { readBoundedJson } from '@/lib/http/read-bounded-json'
import { verifyTurnstile } from '@/lib/turnstile'
import { createRateLimiter } from '@/lib/http/rate-limiter'

/**
 * Public farmer self-registration.
 *
 * Security model:
 * - Reachable without a session (see middleware publicPaths) ONLY because the
 *   endpoint itself enforces Cloudflare Turnstile + strict validation.
 * - The role is decided here, server-side: the schema below does not accept a
 *   `role` key and zod strips unknown keys, so a client can never submit or
 *   escalate its role. `farmer` is the only role this endpoint can assign.
 * - Account creation uses the standard Supabase Auth `signUp()` flow through
 *   the anon public-auth client. CRITICAL: `auth.admin.createUser()` does NOT
 *   send a confirmation email (documented Supabase behavior); signUp() does,
 *   it preserves the password the farmer chose, and with "Confirm email"
 *   enabled it returns `session: null` — no session exists in the browser
 *   until the emailed confirmation link is used (`/auth/callback`).
 * - The public-auth client is deliberately non-cookie-based: even a
 *   misconfigured Supabase project could never persist a session here.
 * - Profile and audit rows are written with the existing service client
 *   (same pattern as the administrator-provisioned flow). If profile or audit
 *   fails, the just-created auth user is rolled back (rolled back users make
 *   the emailed link inert; see docs/farmer-registration.md for the orphan
 *   recovery strategy).
 */

const registerSchema = z
  .object({
    full_name: z.string().trim().min(1, 'Nombre requerido').max(120),
    email: z.string().trim().email('Correo electrónico no válido').max(254),
    password: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres').max(128),
    confirm_password: z.string().max(128),
    captcha_token: z.string().min(1, 'Falta la verificación anti-bots').max(2048),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm_password'],
  })

// Throttle per request origin as auxiliary defense in depth (Turnstile
// remains the first line). 3 attempts per 10 minutes per IP.
const perIpLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 3 })

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || 'unknown'
}

/**
 * Redirect stored with Supabase for the signup flow. With the token-hash
 * confirmation template this value has no functional role in the farmer's
 * confirmation (the email links to /auth/confirm directly), but Supabase
 * validates it against the project's Redirect URL allow-list, so it must be a
 * real, allow-listed first-party route. It points at the confirmation route so
 * any `{{ .RedirectTo }}` usage in a template lands in the right place.
 */
function confirmationRedirectUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const base = (configured || new URL(request.url).origin).replace(/\/+$/, '')
  return `${base}/auth/confirm`
}

const DUPLICATE_EMAIL_MESSAGE =
  'Ya existe una cuenta con este correo. Puedes iniciar sesión o solicitar la recuperación de contraseña.'

export async function POST(request: Request) {
  try {
    return await registerFarmerPublic(request)
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function registerFarmerPublic(request: Request): Promise<Response> {
  if (!perIpLimiter.check(clientIp(request))) {
    return Response.json(
      { error: 'Demasiados intentos de registro desde esta conexión. Inténtalo de nuevo más tarde.' },
      { status: 429 },
    )
  }

  const serviceClient = createServiceClient()

  const body = await readBoundedJson(request)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return Response.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const validated = registerSchema.safeParse(body.value)
  if (!validated.success) {
    // Farmer-facing message for the most common failure (missing widget token).
    const captchaIssue = validated.error.issues.some((issue) => issue.path[0] === 'captcha_token')
    return Response.json(
      {
        error: captchaIssue
          ? 'Completa la verificación anti-bots antes de continuar.'
          : validated.error.issues[0]?.message || 'Invalid request',
      },
      { status: 400 },
    )
  }

  // Cloudflare Turnstile — verified server-side with the secret key. The
  // client-side widget only produces a one-time token; it is never trusted.
  const captcha = await verifyTurnstile(validated.data.captcha_token, clientIp(request))
  if (!captcha.ok) {
    if (captcha.reason === 'not-configured') {
      return Response.json(
        { error: 'La verificación anti-bots no está disponible en este momento.' },
        { status: 503 },
      )
    }
    return Response.json(
      { error: 'Verificación anti-bots inválida o expirada. Recarga el widget e inténtalo de nuevo.' },
      { status: 400 },
    )
  }

  // Standard signup flow: this is the operation that actually sends the
  // signup confirmation email. Only farmer-role fields are ever sent — the
  // client's shape is irrelevant from here on.
  const { full_name, email, password } = validated.data
  const publicSupabase = createPublicAuthClient()
  const { data: signupData, error: signupError } = await publicSupabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
        role: 'farmer',
      },
      emailRedirectTo: confirmationRedirectUrl(request),
    },
  })

  if (signupError) {
    const message = signupError.message || ''
    if (
      signupError.code === 'signup_disabled' ||
      signupError.code === 'signups_not_allowed' ||
      /not allowed|disable[dD]/i.test(message)
    ) {
      return Response.json(
        { error: 'El registro público está deshabilitado temporalmente. Contacta al administrador del sistema.' },
        { status: 503 },
      )
    }
    const isDuplicateEmail =
      signupError.code === 'email_exists' ||
      signupError.code === 'user_already_exists' ||
      /email_exists|already (exists|registered)/i.test(message)
    if (isDuplicateEmail) {
      return Response.json({ error: DUPLICATE_EMAIL_MESSAGE }, { status: 409 })
    }
    if (signupError.code === 'over_email_send_rate_limit' || /over_email_send_rate_limit/i.test(message)) {
      return Response.json(
        { error: 'Se ha alcanzado el límite de envíos de correo. Inténtalo de nuevo en un minuto.' },
        { status: 429 },
      )
    }
    return Response.json({ error: 'No se pudo crear la cuenta.' }, { status: 400 })
  }

  const newUser = signupData?.user

  // Anti-enumeration duplicate detection: when the email is already
  // registered (and Confirm email is enabled), Supabase answers `error: null`
  // with a synthetic user whose `identities` array is empty — and sends NO
  // email. Treat exactly that shape as a duplicate; never proceed with a
  // synthetic id.
  if (!newUser || (newUser.identities?.length ?? 0) === 0) {
    return Response.json({ error: DUPLICATE_EMAIL_MESSAGE }, { status: 409 })
  }

  const newUserId = newUser.id

  // Profile row exists immediately, but the account cannot sign in until the
  // email is confirmed (no session exists — middleware and RLS enforce this).
  const { error: profileError } = await serviceClient.from('profiles').insert({
    id: newUserId,
    email,
    full_name,
    role: 'farmer',
  })

  if (profileError) {
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(newUserId)
    if (cleanupError) {
      console.error('Failed to roll back self-registered farmer after profile creation failed')
      return Response.json(
        {
          error: 'Could not complete farmer account setup',
          warning: 'No se pudo revertir el acceso temporal. Informe al responsable del sistema para completar la limpieza.',
        },
        { status: 500 },
      )
    }
    return Response.json({ error: 'Could not complete farmer account setup' }, { status: 500 })
  }

  try {
    await createAuditLog(serviceClient, newUserId, 'farmer_self_registered', 'profiles', newUserId, {
      farmer_email: email,
      self_registered: true,
    })
  } catch {
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(newUserId)
    if (cleanupError) {
      console.error('Failed to roll back self-registered farmer after audit logging failed')
      return Response.json(
        {
          error: 'Could not complete farmer account setup',
          warning: 'No se pudo revertir el acceso temporal. Informe al responsable del sistema para completar la limpieza.',
        },
        { status: 500 },
      )
    }
    return Response.json({ error: 'Could not complete farmer account setup' }, { status: 500 })
  }

  return Response.json(
    {
      success: true,
      message: 'Revisa tu correo electrónico: debes confirmar tu cuenta antes de iniciar sesión.',
    },
    { status: 201 },
  )
}

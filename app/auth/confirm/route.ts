import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * First-party email-confirmation route for the token-hash signup flow.
 *
 * Why this route exists: the public farmer registration initiates `signUp()`
 * server-side (a flow the user agent never participates in), so the PKCE code
 * verifier can never be present in the farmer's browser when they later click
 * the confirmation link — `exchangeCodeForSession()` is structurally impossible
 * for this flow (see docs/farmer-registration.md). Instead, the Confirm signup
 * email template links here with the Supabase `{{ .TokenHash }}` variable, and
 * this route completes the confirmation with `verifyOtp({ token_hash, type })`,
 * which does not depend on any client-side verifier.
 *
 * Security:
 * - Only token-hash signup confirmations are accepted. GoTrue issues signup
 *   confirmation OTCs under the generic `email` type and marks `signup` as its
 *   legacy alias, so exactly those two values are accepted (everything else is
 *   rejected before any Supabase call).
 * - `token_hash` is validated for shape before use and is never echoed back,
 *   never logged, and never embedded in a redirect target. Supabase's own
 *   error text is never surfaced to the farmer — all failures land on the
 *   same generic login notice that the existing callback route uses.
 * - The route performs its own redirect target decision (dashboard when a
 *   real session exists, login otherwise); it does not trust any query
 *   parameter for the destination, so no open-redirect surface is introduced.
 * - Cookie handling mirrors the existing `/auth/callback` route: the inline
 *   SSR client writes session cookies through `setAll`, which are copied onto
 *   the redirect response so the farmer is signed in only on real success.
 */

// GoTrue issues signup-confirmation OTCs with the generic `email` type
// (see the Supabase Email Templates reference: a signup ConfirmationURL
// contains `token_hash=...&type=email`); `signup` is kept as the documented
// legacy alias. No other type is meaningful for this route.
const ALLOWED_CONFIRMATION_TYPES = new Set(['email', 'signup'])

function loginWithErrorUrl(origin: string, code: 'invalid_code' | 'missing_code'): URL {
  const loginUrl = new URL('/auth/login', origin)
  loginUrl.searchParams.set('error', code)
  return loginUrl
}

export async function GET(request: Request) {
  const cookieStore = await cookies()
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => {
            cookieStore.set({ name, value })
          })

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  const copyCookiesToResponse = (newResponse: NextResponse): NextResponse => {
    const cookies = response.cookies.getAll()
    cookies.forEach(({ name, value, ...options }) => {
      newResponse.cookies.set({ name, value, ...options })
    })
    return newResponse
  }

  const requestUrl = new URL(request.url)
  const tokenHash = requestUrl.searchParams.get('token_hash')?.trim() ?? ''
  const confirmationType = requestUrl.searchParams.get('type')

  // Parameter gate: both parameters must be present, well-shaped, and of the
  // expected signup-confirmation type. No Supabase call is made otherwise.
  // Both accepted values are fixed route constants (never crafted client
  // input): `email` is the OTC type GoTrue issues for signup confirmations
  // today, `signup` is its documented legacy alias. GoTrue performs the
  // authoritative token/type matching; any mismatch simply surfaces as the
  // generic failure redirect below.
  if (!tokenHash || tokenHash.length < 16 || tokenHash.length > 256 || !/^[A-Za-z0-9_-]+$/.test(tokenHash)) {
    return copyCookiesToResponse(NextResponse.redirect(loginWithErrorUrl(requestUrl.origin, 'invalid_code')))
  }
  if (!confirmationType || !ALLOWED_CONFIRMATION_TYPES.has(confirmationType)) {
    return copyCookiesToResponse(NextResponse.redirect(loginWithErrorUrl(requestUrl.origin, 'invalid_code')))
  }

  let verificationError = false
  let receivedSession = false
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: confirmationType as 'email' | 'signup',
    })
    verificationError = Boolean(error) || !data
    receivedSession = Boolean(data?.session)
  } catch {
    verificationError = true
  }

  // Invalid, expired, already-used, malformed, or network-failed tokens all
  // land on the same generic login notice. The supplementable message on the
  // login page comes from the application's own 'invalid_code' marker — never
  // from Supabase's error text, and never containing the token hash.
  if (verificationError) {
    return copyCookiesToResponse(NextResponse.redirect(loginWithErrorUrl(requestUrl.origin, 'invalid_code')))
  }

  if (!receivedSession) {
    // Confirmation succeeded but Supabase granted no session (e.g. no
    // auto-sign-in): the farmer signs in with the password they chose.
    return copyCookiesToResponse(NextResponse.redirect(new URL('/auth/login', requestUrl.origin)))
  }

  // The session belongs to the just-confirmed account; middleware and RLS
  // continue to enforce which pages it may open. No role or profile mutation
  // happens here — server-side role assignment, profile creation, and audit
  // behavior all remain in the registration endpoint.
  return copyCookiesToResponse(NextResponse.redirect(new URL('/dashboard', requestUrl.origin)))
}

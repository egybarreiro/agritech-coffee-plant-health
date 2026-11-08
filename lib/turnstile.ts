/**
 * Cloudflare Turnstile server-side verification.
 *
 * The browser only gives us the widget token; trust is established here by
 * exchanging the token with the Turnstile siteverify endpoint using the
 * server-only TURNSTILE_SECRET_KEY. A missing secret ⇒ every token fails
 * (fail closed). Client presence is checked via x-forwarded-for's first hop
 * when available (informational only — Cloudflare also validates IP client).
 */
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileFailureReason = 'not-configured' | 'network' | 'rejected'

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; reason: TurnstileFailureReason }

export async function verifyTurnstile(
  rawToken: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    // Fail closed: without a secret key the widget cannot be verified at all.
    return { ok: false, reason: 'not-configured' }
  }

  const token = rawToken.trim()
  if (!token) {
    return { ok: false, reason: 'rejected' }
  }

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
    })
    // siteverify answers 200 even for failed challenges; parse defensively.
    const text = await response.text()
    if (!response.ok || !text.trim()) return { ok: false, reason: 'network' }

    const result = JSON.parse(text) as { success?: boolean }
    if (result.success !== true) return { ok: false, reason: 'rejected' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

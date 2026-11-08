import { createClient } from '@/lib/supabase/server'

/**
 * Resolves what the landing page (app/page.tsx) must display for the current
 * request. The authenticated user and role are resolved on the server with the
 * existing cookie-based Supabase server client (`lib/supabase/server.ts`) and
 * the same `profiles.role` check used by `middleware.ts` and the protected
 * pages — no second or weaker role mechanism, no client-supplied values.
 *
 * Fail-safe: if the session or profile cannot be verified, the result is the
 * unauthenticated landing experience. This module never signs out and never
 * writes or clears cookies.
 */
export type LandingAccess =
  | { authenticated: false }
  | { authenticated: true; role: 'farmer' | 'administrator' }

export const LANDING_ACTIONS = {
  unauthenticated: {
    label: 'Iniciar sesión',
    ctaLabel: 'Entrar a mi espacio',
    href: '/auth/login',
  },
  farmer: {
    label: 'Ir a mi espacio',
    ctaLabel: 'Ir a mi espacio',
    href: '/dashboard',
  },
  administrator: {
    label: 'Ir a administración',
    ctaLabel: 'Ir a administración',
    href: '/admin',
  },
} as const

export async function getLandingAccess(): Promise<LandingAccess> {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { authenticated: false }
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError || !profile) {
      return { authenticated: false }
    }

    if (profile.role === 'farmer' || profile.role === 'administrator') {
      return { authenticated: true, role: profile.role }
    }

    // Unknown role value — fail safe to the public experience.
    return { authenticated: false }
  } catch {
    // Session could not be verified (e.g., Supabase unreachable) — fail safe.
    return { authenticated: false }
  }
}

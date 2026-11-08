import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { createServiceClient } from './service'

/**
 * Server-side Supabase client.
 * Uses cookies from the Next.js request/response cycle.
 * Memoized per request via React's cache().
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set({ name, value, ...options })
            } catch {
              // Cookie writes may fail in read-only Server Component contexts
              // (e.g., after the response has started). This is expected and
              // safe to ignore; reads remain functional.
            }
          }
        },
      },
    }
  )
})

/**
 * Admin Supabase client using the service role key.
 * SERVER-SIDE ONLY. Never expose to the browser.
 * Bypasses RLS — use only for administrative operations and audit logging.
 *
 * Delegates to createServiceClient() in lib/supabase/service.ts, which uses
 * @supabase/supabase-js directly (not @supabase/ssr createServerClient).
 */
export function createAdminClient() {
  return createServiceClient()
}

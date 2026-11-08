import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Standalone ANON (public) Supabase client for the public self-registration
 * flow, used exclusively in server route handlers.
 *
 * Why not reuse the cookie-based client from `lib/supabase/server.ts`?
 * `auth.signUp()` is the one Supabase operation that sends the real signup
 * confirmation email, and with "Confirm email" enabled it returns
 * `session: null`. But if a Supabase project were misconfigured with
 * confirmations disabled, signUp would return a live session — a cookie-backed
 * client would then silently persist it into the response cookies and sign the
 * farmer in. This client sets `persistSession: false`, so no session can ever
 * leak into the request/response cookie cycle: confirmation (via the emailed
 * link and `/auth/callback`) remains the only way to obtain a session.
 */
export function createPublicAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

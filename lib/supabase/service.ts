import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Standalone Supabase client authenticated with the Supabase Secret API key
 * for use in API routes and background jobs (not tied to Next.js cookies).
 * The key operates as the service_role role.
 * SERVER-SIDE ONLY. Never expose to the browser.
 * The 'server-only' import above ensures this module cannot be imported
 * in browser/client components, preventing accidental leakage of the
 * server-side secret to the frontend.
 * Historical note: this module previously read SUPABASE_SERVICE_ROLE_KEY
 * (legacy JWT service_role secret); the runtime variable was renamed to
 * SUPABASE_SECRET_KEY for the new Supabase Secret API key.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

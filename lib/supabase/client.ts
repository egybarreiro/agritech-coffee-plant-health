import { createBrowserClient } from '@supabase/ssr'

/**
 * Client-side Supabase client for browser use.
 * Safe to expose NEXT_PUBLIC_* keys to the frontend.
 * Never include the service_role key here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

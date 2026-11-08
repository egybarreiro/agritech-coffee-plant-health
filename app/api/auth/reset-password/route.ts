import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { passwordResetRequestSchema } from '@/lib/auth/password'
import { readBoundedJson } from '@/lib/http/read-bounded-json'

export async function POST(request: Request) {
  const body = await readBoundedJson(request)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Ingresa un correo electrónico válido.' }, { status: 400 })
  }
  const parsed = passwordResetRequestSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'Ingresa un correo electrónico válido.' }, { status: 400 })

  let appOrigin: string
  try {
    const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || '')
    if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('Invalid app URL')
    if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') throw new Error('HTTPS is required in production')
    appOrigin = appUrl.origin
  } catch {
    return NextResponse.json({ error: 'La recuperación no está configurada. Contacta al administrador.' }, { status: 503 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set({ name, value, ...options }))
        },
      },
    }
  )

  const callback = new URL('/auth/callback', appOrigin)
  callback.searchParams.set('redirectTo', '/auth/update-password')
  let requestFailed = false
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: callback.toString(),
    })
    requestFailed = Boolean(error)
  } catch {
    requestFailed = true
  }

  if (requestFailed) console.error('Supabase password reset request failed')
  // Keep the response identical for known and unknown accounts.
  return NextResponse.json({ success: true })
}




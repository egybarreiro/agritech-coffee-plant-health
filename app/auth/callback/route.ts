import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { safeInternalRedirect } from '@/lib/security/redirect'

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
  const code = requestUrl.searchParams.get('code')
  const redirectTo = requestUrl.searchParams.get('redirectTo')

  if (!code) {
    const loginUrl = new URL('/auth/login', requestUrl)
    loginUrl.searchParams.set('error', 'missing_code')
    return copyCookiesToResponse(NextResponse.redirect(loginUrl))
  }

  let exchangeError
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    exchangeError = error
  } catch (err) {
    exchangeError = err
  }

  if (exchangeError) {
    const loginUrl = new URL('/auth/login', requestUrl)
    loginUrl.searchParams.set('error', 'invalid_code')
    return copyCookiesToResponse(NextResponse.redirect(loginUrl))
  }

  const safeRedirect = safeInternalRedirect(redirectTo, requestUrl.origin)
  const redirectResponse = copyCookiesToResponse(NextResponse.redirect(new URL(safeRedirect, requestUrl.origin)))
  if (safeRedirect === '/auth/update-password') {
    redirectResponse.cookies.set('agritech-password-recovery', '1', {
      httpOnly: true,
      secure: requestUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/auth/update-password',
      maxAge: 10 * 60,
    })
  }
  return redirectResponse
}




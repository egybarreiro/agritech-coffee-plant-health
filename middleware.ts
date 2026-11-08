import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // 1. Create the initial response and Supabase client
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
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          // Step A: Update incoming request cookies so Supabase sees refreshed values
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set({ name, value })
          })

          // Step B: Recreate the response with updated request cookies
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })

          // Step C: Apply all updated cookies to the recreated response
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  // Helper: copy all cookies from the current response to a new response
  const copyCookiesToResponse = (newResponse: NextResponse): NextResponse => {
    const cookies = response.cookies.getAll()
    cookies.forEach(({ name, value, ...options }) => {
      newResponse.cookies.set({ name, value, ...options })
    })
    return newResponse
  }

  // 2. Get authenticated user with explicit error handling
  let user
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      user = null
    } else {
      user = data.user
    }
  } catch {
    // Supabase error - fail closed by treating as unauthenticated
    user = null
  }

  const { pathname } = request.nextUrl

  // 3. Public routes - no authentication required
  const publicPaths = [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/callback',
    // First-party token-hash signup confirmation (verifies the emailed link).
    '/auth/confirm',
    '/auth/reset-password',
    '/api/auth/login',
    '/api/auth/register',
    // Public farmer self-registration (captcha + validation enforced inside).
    '/api/auth/register-public',
    // Email-confirmation resend (rate limited inside).
    '/api/auth/resend-confirmation',
    '/api/auth/reset-password',
    '/api/auth/logout',
    '/api/health',
  ]

  if (publicPaths.includes(pathname)) {
    return copyCookiesToResponse(response)
  }

  // 4. Static assets and Next.js internals - let them pass through untouched
  // Only exclude actual static resource paths, not arbitrary pathnames with periods
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname.startsWith('/images/') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg'
  ) {
    return response
  }

  // 5. API routes - require authentication for non-public endpoints
  if (pathname.startsWith('/api/')) {
    if (!user) {
      return copyCookiesToResponse(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    // Protect both /api/admin and /api/admin/...
    if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
      let profile
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        if (error || !data) {
          profile = null
        } else {
          profile = data
        }
      } catch {
        profile = null
      }

      if (!profile || profile.role !== 'administrator') {
        return copyCookiesToResponse(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
      }
    }
    return copyCookiesToResponse(response)
  }

  // 6. Protected page routes - require authentication
  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return copyCookiesToResponse(NextResponse.redirect(loginUrl))
  }

  // 7. Admin page routes - require administrator role
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    let profile
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (error || !data) {
        profile = null
      } else {
        profile = data
      }
    } catch {
      profile = null
    }

    if (!profile || profile.role !== 'administrator') {
      return copyCookiesToResponse(NextResponse.redirect(new URL('/dashboard', request.url)))
    }
    return copyCookiesToResponse(response)
  }

  return copyCookiesToResponse(response)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|images/).*)'],
}



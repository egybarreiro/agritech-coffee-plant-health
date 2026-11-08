// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))

import { middleware } from './middleware'
import { NextRequest } from 'next/server'

function request(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`))
}

function stubAuth(user: { id: string } | null, profileRole: string | null = null) {
  mocks.createServerClient.mockReturnValue({
    auth: {
      getUser: async () =>
        user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'session expired' } },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profileRole ? { role: profileRole } : null, error: profileRole ? null : { message: 'no profile' } }),
        }),
      }),
    }),
  })
}

beforeEach(() => {
  mocks.createServerClient.mockClear()
})

describe('middleware — protected-route access after logout', () => {
  it('redirects an unauthenticated (logged-out) page request to /auth/login preserving redirectTo', async () => {
    stubAuth(null)

    const response = await middleware(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/auth/login?redirectTo=%2Fdashboard')
  })

  it('blocks non-public API routes for logged-out requests', async () => {
    stubAuth(null)

    const response = await middleware(request('/api/plants'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('protects the farmer detail and admin routes for logged-out requests', async () => {
    stubAuth(null)

    for (const pathname of ['/dashboard/plants', '/dashboard/units/1', '/admin']) {
      const page = await middleware(request(pathname))
      expect(page.headers.get('location')).toContain('/auth/login')
    }
    const api = await middleware(request('/api/health')) // public
    expect(api.status).toBe(200)
  })

  it('is the credential check alone: a stale session (null user) never reaches protected pages', async () => {
    // After logout the cookie is gone; even a bogus leftover token fails
    // getUser and the request is treated as unauthenticated.
    stubAuth(null)

    const response = await middleware(request('/admin'))

    expect(response.headers.get('location')).toContain('/auth/login?redirectTo=%2Fadmin')
  })

  it('keeps public routes public and authenticated routes reachable with a valid session', async () => {
    stubAuth({ id: 'u1' }, 'farmer')

    expect((await middleware(request('/'))).status).toBe(200)
    expect((await middleware(request('/dashboard'))).status).toBe(200)
    expect((await middleware(request('/auth/login'))).status).toBe(200)
  })

  it('keeps the public registration page and its captcha-enforced endpoints public', async () => {
    stubAuth(null)

    expect((await middleware(request('/auth/register'))).status).toBe(200)
    expect((await middleware(request('/auth/confirm'))).status).toBe(200)
    expect((await middleware(request('/api/auth/register-public'))).status).toBe(200)
    expect((await middleware(request('/api/auth/resend-confirmation'))).status).toBe(200)
    // Non-public auth endpoints remain protected without a session:
    const otherApi = await middleware(request('/api/auth/update-password'))
    expect(otherApi.status).toBe(401)
  })

  it('keeps administrator-only pages closed to farmers and open to administrators', async () => {
    stubAuth({ id: 'u1' }, 'farmer')
    const farmerResponse = await middleware(request('/admin'))
    expect(farmerResponse.headers.get('location')).toBe('http://localhost/dashboard')

    stubAuth({ id: 'u1' }, 'administrator')
    expect((await middleware(request('/admin'))).status).toBe(200)
  })
})

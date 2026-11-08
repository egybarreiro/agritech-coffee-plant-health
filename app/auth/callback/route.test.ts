// @vitest-environment node
//
// Regression guard for the existing PKCE callback route (used by password
// recovery and other user-agent-initiated flows): its behavior must remain
// intact now that signup confirmation moved to the token-hash /auth/confirm
// route. Supabase and cookies are mocked; nothing real is exchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))

import { GET } from './route'

let exchangeMock: ReturnType<typeof vi.fn>
let capturedSetAll: ((cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void) | null

beforeEach(() => {
  const store: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []
  mocks.cookies.mockResolvedValue({
    getAll: () => store.map(({ name, value }) => ({ name, value })),
    set: (cookie: { name: string; value: string; options?: Record<string, unknown> }) => {
      store.push(cookie)
    },
  })
  capturedSetAll = null

  exchangeMock = vi.fn(async () => {
    if (capturedSetAll) {
      capturedSetAll([{ name: 'sb-pkce-auth-token', value: 'pkce-session', options: { path: '/' } }])
    }
    return { error: null }
  })

  mocks.createServerClient.mockImplementation(
    (
      _url: string,
      _key: string,
      config: {
        cookies: {
          getAll: () => Array<{ name: string; value: string }>
          setAll: (cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void
        }
      },
    ) => {
      capturedSetAll = config.cookies.setAll
      return { auth: { exchangeCodeForSession: exchangeMock } }
    },
  )
})

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL('http://localhost/auth/callback')
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return new Request(url)
}

describe('GET /auth/callback — PKCE exchange route (password recovery flows)', () => {
  it('exchanges a present code, persists the session cookie, and redirects to dashboard', async () => {
    const response = await GET(makeRequest({ code: 'one-time-code' }))

    expect(exchangeMock).toHaveBeenCalledWith('one-time-code')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/dashboard')
    expect(response.cookies.get('sb-pkce-auth-token')?.value).toBe('pkce-session')
  })

  it('redirects to login with missing_code when no code param exists', async () => {
    const response = await GET(makeRequest())

    expect(exchangeMock).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=missing_code')
  })

  it('redirects to login with invalid_code when the exchange fails', async () => {
    exchangeMock = vi.fn(async () => ({ error: { message: 'PKCE code verifier not found' } }))
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        config: { cookies: { getAll: () => unknown[]; setAll: () => void } },
      ) => {
        capturedSetAll = config.cookies.setAll as typeof capturedSetAll
        return { auth: { exchangeCodeForSession: exchangeMock } }
      },
    )

    const response = await GET(makeRequest({ code: 'bad-code' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(response.headers.get('location')).not.toContain('verifier')
  })

  it('redirects unauthenticated recovery users to update-password and sets the recovery marker cookie', async () => {
    const response = await GET(makeRequest({ code: 'one-time-code', redirectTo: '/auth/update-password' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/update-password')
    expect(response.cookies.get('agritech-password-recovery')).toBeTruthy()
  })

  it('still blocks unsafe external redirect targets (open-redirect protection intact)', async () => {
    const external = await GET(makeRequest({ code: 'one-time-code', redirectTo: '//evil.example.com' }))
    expect(external.headers.get('location')).toBe('http://localhost/dashboard')

    const weird = await GET(makeRequest({ code: 'one-time-code', redirectTo: '/\\evil' }))
    expect(weird.headers.get('location')).toBe('http://localhost/dashboard')

    const relative = await GET(makeRequest({ code: 'one-time-code', redirectTo: '/dashboard' }))
    expect(relative.headers.get('location')).toBe('http://localhost/dashboard')
  })
})

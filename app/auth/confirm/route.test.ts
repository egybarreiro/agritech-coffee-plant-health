// @vitest-environment node
//
// SUPABASE AND COOKIES ARE MOCKED HERE. These tests prove the route calls
// `verifyOtp({ token_hash, type })` with validated parameters, copies session
// cookies onto the redirect, and never leaks the token hash or Supabase error
// details. They do NOT verify a real confirmation email or a real Supabase
// session: that requires the manual end-to-end check in
// docs/farmer-registration.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))

import { GET } from './route'

let verifyOtpMock: ReturnType<typeof vi.fn>
let capturedSetAll: ((cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void) | null

function configureVerification(result: {
  data: { user: Record<string, unknown> | null; session: Record<string, unknown> | null }
  error: { message: string; code?: string } | null
  throws?: boolean
}) {
  verifyOtpMock = vi.fn(async () => {
    if (!result.error && result.data.session && capturedSetAll) {
      // Emulate the real SSR client writing the session it just established.
      capturedSetAll([{ name: 'sb-test-auth-token', value: 'session-cookie-value', options: { path: '/' } }])
    }
    return result
  })
  if (result.throws) {
    verifyOtpMock.mockRejectedValue(new Error('network down'))
  }

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
      return { auth: { verifyOtp: verifyOtpMock } }
    },
  )
}

function cookieStore() {
  const store: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []
  return { store, getAll: () => store.map(({ name, value }) => ({ name, value })), set: (cookie: { name: string; value: string; options?: Record<string, unknown> }) => { store.push(cookie) } }
}

let store: ReturnType<typeof cookieStore>

function makeRequest(query: Record<string, string> | null) {
  const url = new URL('http://localhost/auth/confirm')
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  return new Request(url)
}

const validTokenHash = 'a'.repeat(64)
const confirmedResult = {
  data: { user: { id: '00000000-0000-4000-8000-000000000001' }, session: { access_token: 'at' } },
  error: null,
}

beforeEach(() => {
  store = cookieStore()
  mocks.cookies.mockResolvedValue(store)
  capturedSetAll = null
  configureVerification(confirmedResult)
})

describe('GET /auth/confirm — token-hash signup confirmation route', () => {
  it('verifies a valid signup token hash with params straight from the link', async () => {
    const response = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: validTokenHash, type: 'email' })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/dashboard')
  })

  it('accepts the documented legacy alias type=signup and forwards it to verifyOtp', async () => {
    await GET(makeRequest({ token_hash: validTokenHash, type: 'signup' }))

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: validTokenHash, type: 'signup' })
  })

  it('redirects to login with a generic error when the token hash is missing', async () => {
    const response = await GET(makeRequest({ type: 'email' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('redirects to login with a generic error for an unsupported confirmation type', async () => {
    const recovery = await GET(makeRequest({ token_hash: validTokenHash, type: 'recovery' }))
    expect(recovery.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(verifyOtpMock).not.toHaveBeenCalled()

    const missingType = await GET(makeRequest({ token_hash: validTokenHash }))
    expect(missingType.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed token hash before contacting Supabase', async () => {
    const shaped = await GET(makeRequest({ token_hash: 'short', type: 'email' }))
    expect(shaped.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(verifyOtpMock).not.toHaveBeenCalled()

    const injected = await GET(makeRequest({ token_hash: `${validTokenHash}%20malicious`, type: 'email' }))
    expect(injected.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('redirects to login with a generic error for invalid, expired, or already-used tokens', async () => {
    configureVerification({
      data: { user: null, session: null },
      error: { message: 'Email link is invalid or has expired', code: 'otp_expired' },
    })

    const response = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(response.headers.get('location')).not.toContain(validTokenHash)
    expect(response.cookies.get('sb-test-auth-token')).toBeUndefined()
  })

  it('redirects to login with a generic error when verification throws', async () => {
    configureVerification({ data: { user: null, session: null }, error: null, throws: true })

    const response = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(response.cookies.get('sb-test-auth-token')).toBeUndefined()
  })

  it('sends the farmer to sign in when Supabase confirms the user but returns no session', async () => {
    configureVerification({
      data: { user: { id: '00000000-0000-4000-8000-000000000001' }, session: null },
      error: null,
    })

    const response = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login')
    expect(response.cookies.get('sb-test-auth-token')).toBeUndefined()
  })

  it('persists the session Supabase returned onto the redirect response (successful cookie handling)', async () => {
    const response = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    expect(verifyOtpMock).toHaveBeenCalledTimes(1)
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('session-cookie-value')
    expect(response.headers.get('location')).toBe('http://localhost/dashboard')
  })

  it('never leaks the token hash in any response (redirect headers or page body)', async () => {
    // Happy path
    const success = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))
    expect(success.headers.get('location')).toBe('http://localhost/dashboard')
    expect(success.headers.get('location')).not.toContain(validTokenHash)
    expect((await success.text()).length).toBe(0)

    // Failure path
    configureVerification({
      data: { user: null, session: null },
      error: { message: `Email link is invalid or has expired: ${validTokenHash}` },
    })
    const failure = await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))
    expect(failure.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(failure.headers.get('location')).not.toContain(validTokenHash)
    expect((await failure.text()).trim()).toBe('')
  })

  it('does not log the token hash or the Supabase error text (coarse logging only)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    configureVerification({
      data: { user: null, session: null },
      error: { message: `Email link is invalid or has expired: ${validTokenHash}` },
    })
    await GET(makeRequest({ token_hash: validTokenHash, type: 'email' }))

    const allCalls = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls, ...consoleWarnSpy.mock.calls]
    const flat = allCalls.map((call) => call.join(' ')).join('\n')
    expect(flat).not.toContain(validTokenHash)
    expect(flat).not.toContain('Email link is invalid or has expired')

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('redirects malformed confirmation requests without echoing query parameters', async () => {
    const response = await GET(makeRequest({ token_hash: `${validTokenHash}-x`, type: 'email&token_hash=evil' }))

    expect(response.headers.get('location')).toBe('http://localhost/auth/login?error=invalid_code')
    expect(response.headers.get('location')).not.toContain('evil')
  })
})

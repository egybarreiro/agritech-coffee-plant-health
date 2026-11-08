// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))

import { POST } from './route'

type CookieWrite = { name: string; value: string; options?: Record<string, unknown>; maxAge?: number }

let signOutImpl: () => Promise<{ error: { message: string } | null }>
let cookieWrites: CookieWrite[]

beforeEach(() => {
  cookieWrites = []
  signOutImpl = async () => ({ error: null })
  mocks.cookies.mockReturnValue({
    getAll: () => [],
    set: (write: CookieWrite) => cookieWrites.push(write),
  })
  mocks.createServerClient.mockImplementation(
    (
      _url: string,
      _key: string,
      options: { cookies: { setAll: (cookiesToSet: CookieWrite[]) => void } },
    ) => ({
      auth: {
        signOut: async () => {
          // Mirrors @supabase/ssr: clears the auth cookies via the configured adapter.
          options.cookies.setAll([
            { name: 'sb-access-token', value: '', options: { maxAge: 0 } },
            { name: 'sb-refresh-token', value: '', options: { maxAge: 0 } },
          ])
          return await signOutImpl()
        },
      },
    }),
  )
})

describe('POST /api/auth/logout — session invalidation', () => {
  it('signs the session out and answers JSON success', async () => {
    const response = await POST()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ success: true })
  })

  it('invalidates the session cookies through the route\u2019s cookie adapter', async () => {
    await POST()

    const names = cookieWrites.map((write) => write.name)
    expect(names).toEqual(['sb-access-token', 'sb-refresh-token'])
    for (const write of cookieWrites) {
      expect(write.value).toBe('')
      expect(write.maxAge).toBe(0)
    }
  })

  it('answers JSON 500 when Supabase reports a sign-out error', async () => {
    signOutImpl = async () => ({ error: { message: 'sign out failed' } })

    const response = await POST()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'Failed to sign out' })
  })

  it('answers JSON 500 (never an empty body) when signing out throws', async () => {
    signOutImpl = async () => {
      throw new Error('network down')
    }

    const response = await POST()

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'Failed to sign out' })
  })
})

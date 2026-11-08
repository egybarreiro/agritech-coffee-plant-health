// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstile } from './turnstile'

const validToken = 'test-turnstile-token'

function siteverifyBody(result: { success: boolean; 'error-codes'?: string[] }) {
  return JSON.stringify(result)
}

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = 'server-only-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TURNSTILE_SECRET_KEY
})

describe('verifyTurnstile', () => {
  it('exchanges the token with siteverify and accepts on success', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValue(new Response(siteverifyBody({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstile(validToken, '203.0.113.7')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    const body = init.body as URLSearchParams
    expect(body.get('response')).toBe(validToken)
    expect(body.get('secret')).toBe('server-only-secret')
    expect(body.get('remoteip')).toBe('203.0.113.7')
  })

  it('rejects when Cloudflare answers success=false (invalid/expired token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(siteverifyBody({ success: false, 'error-codes': ['timeout-or-duplicate'] }), { status: 200 }),
      ),
    )

    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'rejected' })
  })

  it('fails closed and answers rejected when siteverify network status is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":true}', { status: 503 })))

    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'network' })
  })

  it('fails closed when the siteverify body is empty or non-JSON (previously "Unexpected end of JSON input")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'network' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', { status: 200 })))
    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'network' })
  })

  it('fails closed when the siteverify call throws (network down)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'network' })
  })

  it('rejects an empty token without calling siteverify', async () => {
    const fetchMock = vi.fn(async () => new Response(siteverifyBody({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await verifyTurnstile('   ')).toEqual({ ok: false, reason: 'rejected' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed without any network call when the secret key is not configured', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const fetchMock = vi.fn(async () => new Response(siteverifyBody({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await verifyTurnstile(validToken)).toEqual({ ok: false, reason: 'not-configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

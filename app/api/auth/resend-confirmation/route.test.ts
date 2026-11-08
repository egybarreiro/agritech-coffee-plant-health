// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { POST } from './route'

let resendMock: ReturnType<typeof vi.fn>

function makeRequest(body: unknown, ip: string) {
  return new Request('http://localhost/api/auth/resend-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// Per-IP limiter is module state; use unique IPs per test except in the
// explicit per-IP throttling test (8/hour).
let ipCounter = 0
const nextIp = () => `192.0.2.${++ipCounter}`

beforeEach(() => {
  vi.clearAllMocks()
  resendMock = vi.fn(async () => ({ data: {}, error: null }))
  mocks.createClient.mockResolvedValue({ auth: { resend: resendMock } })
})

describe('POST /api/auth/resend-confirmation', () => {
  it('re-sends the signup confirmation email with a lowercased, validated address', async () => {
    const response = await POST(makeRequest({ email: 'Farmer@Example.TEST' }, nextIp()))
    const json = (await response.json()) as { success?: boolean }

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.success).toBe(true)
    expect(resendMock).toHaveBeenCalledWith({ type: 'signup', email: 'farmer@example.test' })
  })

  it('answers identical success without calling Supabase rejections (anti-enumeration)', async () => {
    resendMock = vi.fn(async () => ({ data: {}, error: { code: 'user_not_found', message: 'not found', status: 404 } }))
    mocks.createClient.mockResolvedValue({ auth: { resend: resendMock } })

    const response = await POST(makeRequest({ email: 'ghost@example.test' }, nextIp()))

    expect(response.status).toBe(200)
    expect((await response.json())).toEqual({ success: true })
  })

  it('answers the same success even when resend throws (no account disclosure)', async () => {
    resendMock = vi.fn(async () => {
      throw new Error('network down')
    })
    mocks.createClient.mockResolvedValue({ auth: { resend: resendMock } })

    const response = await POST(makeRequest({ email: 'throwing@example.test' }, nextIp()))

    expect(response.status).toBe(200)
    expect((await response.json())).toEqual({ success: true })
  })

  it('rejects invalid email and malformed bodies with JSON 400 without resending', async () => {
    const invalidEmail = await POST(makeRequest({ email: 'not-an-email' }, nextIp()))
    expect(invalidEmail.status).toBe(400)
    expect(invalidEmail.headers.get('content-type')).toContain('application/json')

    const missingField = await POST(makeRequest({}, nextIp()))
    expect(missingField.status).toBe(400)

    const malformed = await POST(makeRequest('{nope', nextIp()))
    expect(malformed.status).toBe(400)

    expect(resendMock).not.toHaveBeenCalled()
  })

  it('limits resends to one per 60 s per email address', async () => {
    const sharedIp = nextIp()

    const first = await POST(makeRequest({ email: 'limited@example.test' }, sharedIp))
    expect(first.status).toBe(200)

    const second = await POST(makeRequest({ email: 'limited@example.test' }, sharedIp))
    const json = (await second.json()) as { error?: string }

    expect(second.status).toBe(429)
    expect(json.error).toContain('un minuto')
    expect(resendMock).toHaveBeenCalledTimes(1)
  })

  it('limits repeated resends per connection (8 per hour)', async () => {
    const sharedIp = '192.0.2.99'

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(makeRequest({ email: `ip-limit-${attempt}@example.test` }, sharedIp))
      expect(response.status).toBe(200)
    }
    const ninth = await POST(makeRequest({ email: 'ip-limit-8@example.test' }, sharedIp))
    const json = (await ninth.json()) as { error?: string }

    expect(ninth.status).toBe(429)
    expect(json.error).toContain('Demasiadas solicitudes')
  })

  it('answers JSON 500 when the server client itself throws', async () => {
    mocks.createClient.mockRejectedValue(new Error('client failed'))

    const response = await POST(makeRequest({ email: 'client-error@example.test' }, nextIp()))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.error).toBe('Internal server error')
    expect(resendMock).not.toHaveBeenCalled()
  })
})

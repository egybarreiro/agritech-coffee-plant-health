// @vitest-environment node
//
// SUPABASE PROVIDERS ARE MOCKED HERE. These tests prove the application
// invokes `auth.signUp()` — the Supabase operation that actually sends the
// signup confirmation email — and that `admin.createUser()` is never used.
// They do NOT verify real email delivery: that requires the manual
// end-to-end check described in docs/farmer-registration.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  createServiceClient: vi.fn(),
  createPublicAuthClient: vi.fn(),
  createAuditLog: vi.fn(),
}))

vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: mocks.verifyTurnstile }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/lib/supabase/public-auth', () => ({ createPublicAuthClient: mocks.createPublicAuthClient }))
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }))

import { POST } from './route'

const newUserId = '77777777-7777-4777-8777-777777777777'

// Anon signUp client: exactly one operation under test.
let signUpMock: ReturnType<typeof vi.fn>

// Service client (profile insert, user rollback, audit).
let createUserMock: ReturnType<typeof vi.fn>
let deleteUserMock: ReturnType<typeof vi.fn>
const profileInserts: Array<Record<string, unknown>> = []

// Configurable service-client behavior (reset in beforeEach).
let cleanupDeleteResult: { error: { message: string } } | null
let profileInsertError: { message: string } | null

function makeServiceClient() {
  createUserMock = vi.fn()
  deleteUserMock = vi.fn(async () => ({ error: cleanupDeleteResult }))
  return {
    from: (table: string) => {
      if (table !== 'profiles') return {}
      return {
        insert: (payload: Record<string, unknown>) => {
          profileInserts.push(payload)
          return { error: profileInsertError }
        },
      }
    },
    auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
  }
}

type SignUpResult = {
  data: {
    user: { id: string; identities?: Array<Record<string, unknown>> } | null
    session: unknown
  } | null
  error: { code?: string; message: string; status?: number } | null
}

function signUpSuccess(email: string): SignUpResult {
  return {
    data: {
      user: { id: newUserId, identities: [{ provider: 'email', id: email }] },
      session: null, // "Confirm email" enabled ⇒ no session until confirmation.
    },
    error: null,
  }
}

// Per-IP throttling state is in-process; every test uses a unique
// x-forwarded-for so they don't interfere, except the explicit 429 test.
let ipCounter = 0
function makeRequest(body: unknown, ip?: string) {
  ipCounter += 1
  return new Request('http://localhost/api/auth/register-public', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? `198.51.100.${ipCounter}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = {
  full_name: 'Ana Pérez',
  email: 'farmer@example.test',
  password: 'colombia-cafe-2026',
  confirm_password: 'colombia-cafe-2026',
  captcha_token: 'valid-token',
}

beforeEach(() => {
  vi.clearAllMocks()
  profileInserts.length = 0
  cleanupDeleteResult = null
  profileInsertError = null

  signUpMock = vi.fn(async () => signUpSuccess(validBody.email))
  mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

  mocks.verifyTurnstile.mockResolvedValue({ ok: true })
  mocks.createServiceClient.mockReturnValue(makeServiceClient())
  mocks.createAuditLog.mockResolvedValue(undefined)
})

describe('POST /api/auth/register-public — public farmer self-registration', () => {
  it('uses the standard signUp flow (the operation that sends the confirmation email) and never admin.createUser', async () => {
    // The client attempts to smuggle a role: it must be ignored.
    const response = await POST(makeRequest({ ...validBody, role: 'administrator' }))
    const json = (await response.json()) as { success?: boolean; message?: string }

    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.success).toBe(true)
    expect(json.message).toContain('confirmar')

    // SUPABASE email-confirmation contract: signUp sends the real email.
    expect(signUpMock).toHaveBeenCalledWith({
      email: 'farmer@example.test',
      password: 'colombia-cafe-2026',
      options: {
        data: { full_name: 'Ana Pérez', role: 'farmer' },
        emailRedirectTo: expect.stringMatching(/\/auth\/confirm$/),
      },
    })
    // The admin endpoint that never sends confirmation emails must not run.
    expect(createUserMock).not.toHaveBeenCalled()

    expect(profileInserts).toEqual([
      expect.objectContaining({ id: newUserId, role: 'farmer' }),
    ])
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      newUserId,
      'farmer_self_registered',
      'profiles',
      newUserId,
      expect.objectContaining({ self_registered: true }),
    )
  })

  it('stores the farmer role server-side only and never accepts a client role', async () => {
    await POST(makeRequest({ ...validBody, role: 'administrator' }))

    const call = signUpMock.mock.calls[0][0] as {
      options: { data: Record<string, unknown> }
    }
    expect(call.options.data.role).toBe('farmer')
    expect(profileInserts[0]?.role).toBe('farmer')
  })

  it('blocks submission when the CAPTCHA token is missing', async () => {
    mocks.verifyTurnstile.mockClear()

    const body: Record<string, unknown> = { ...validBody }
    delete body.captcha_token

    const response = await POST(makeRequest(body))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(json.error).toContain('verificación anti-bots')
    expect(signUpMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('rejects an invalid or expired CAPTCHA token with a safe JSON 400', async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'rejected' })

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.error).toContain('Verificación anti-bots')
    expect(signUpMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('answers JSON 503 when the Turnstile secret is not configured (fail closed)', async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: false, reason: 'not-configured' })

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.error).toContain('anti-bots')
    expect(signUpMock).not.toHaveBeenCalled()
  })

  it('rejects mismatched password confirmation', async () => {
    const response = await POST(makeRequest({ ...validBody, confirm_password: 'different-password' }))

    expect(response.status).toBe(400)
    expect((await response.json() as { error?: string }).error).toContain('no coinciden')
    expect(signUpMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('rejects an invalid password and an invalid email', async () => {
    const shortPassword = await POST(makeRequest({ ...validBody, password: 'x', confirm_password: 'x' }))
    expect(shortPassword.status).toBe(400)
    expect(signUpMock).not.toHaveBeenCalled()

    const invalidEmail = await POST(makeRequest({ ...validBody, email: 'not-an-email' }))
    expect(invalidEmail.status).toBe(400)
    expect(signUpMock).not.toHaveBeenCalled()
  })

  it('rejects requests with missing fields or malformed JSON bodies', async () => {
    const body: Record<string, unknown> = { ...validBody }
    delete body.full_name
    const missingField = await POST(makeRequest(body))
    expect(missingField.status).toBe(400)
    expect((await missingField.json() as { error?: string }).error).toBeTruthy()

    const malformed = await POST(makeRequest('{truncated-json'))
    expect(malformed.status).toBe(400)
    expect(malformed.headers.get('content-type')).toContain('application/json')

    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers JSON 409 for the synthetic-user duplicate response (empty identities ⇒ no email sent)', async () => {
    // Supabase anti-enumeration behavior: `error: null` + synthetic user with
    // empty identities, and no confirmation email is sent.
    signUpMock = vi.fn(async () => ({
      data: {
        user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', identities: [] },
        session: null,
      },
      error: null,
    }))
    mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.error).toContain('Ya existe una cuenta con este correo')
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers JSON 409 when Supabase reports an explicit duplicate-email error', async () => {
    signUpMock = vi.fn(async () => ({
      data: { user: null, session: null },
      error: { code: 'email_exists', message: 'User already registered', status: 422 },
    }))
    mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(409)
    expect(json.error).toContain('Ya existe una cuenta con este correo')
    expect(profileInserts).toHaveLength(0)
  })

  it('answers JSON 503 with a config message when public signup is disabled on Supabase', async () => {
    signUpMock = vi.fn(async () => ({
      data: { user: null, session: null },
      error: { code: 'signup_disabled', message: 'Signups not allowed for this instance', status: 403 },
    }))
    mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(503)
    expect(json.error).toContain('registro público está deshabilitado')
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers JSON 400 and creates nothing on a generic Supabase signup error', async () => {
    signUpMock = vi.fn(async () => ({
      data: { user: null, session: null },
      error: { code: 'weak_password', message: 'Password is too weak', status: 422 },
    }))
    mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

    const response = await POST(makeRequest({ ...validBody, email: 'other@example.test' }))
    const json = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers JSON 500 (no partial account) when the signup call throws', async () => {
    signUpMock = vi.fn(async () => {
      throw new Error('network down')
    })
    mocks.createPublicAuthClient.mockReturnValue({ auth: { signUp: signUpMock } })

    const response = await POST(makeRequest({ ...validBody, email: 'throwing@example.test' }))

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(((await response.json()) as { error?: string }).error).toBe('Internal server error')
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('rolls the auth user back when the profile insert fails (emailed link becomes inert, documented)', async () => {
    profileInsertError = { message: 'insert failed' }

    const response = await POST(makeRequest({ ...validBody, email: 'rollback@example.test' }))
    const json = (await response.json()) as { error?: string; warning?: string }

    expect(response.status).toBe(500)
    expect(json.error).toBe('Could not complete farmer account setup')
    expect(json.warning).toBeUndefined()
    expect(deleteUserMock).toHaveBeenCalledWith(newUserId)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('warns in the JSON response when the rollback itself fails', async () => {
    profileInsertError = { message: 'insert failed' }
    cleanupDeleteResult = { error: { message: 'delete failed' } }

    const response = await POST(makeRequest({ ...validBody, email: 'rollback-warn@example.test' }))
    const json = (await response.json()) as { warning?: string }

    expect(response.status).toBe(500)
    expect(json.warning).toContain('No se pudo revertir el acceso temporal')
  })

  it('rolls back and warns when audit logging fails after an email was already sent', async () => {
    mocks.createAuditLog.mockRejectedValue(new Error('audit write failed'))
    cleanupDeleteResult = { error: { message: 'delete failed' } }

    const response = await POST(makeRequest({ ...validBody, email: 'audit-rollback@example.test' }))
    const json = (await response.json()) as { warning?: string }

    expect(response.status).toBe(500)
    expect(deleteUserMock).toHaveBeenCalledWith(newUserId)
    expect(json.warning).toContain('No se pudo revertir el acceso temporal')
  })

  it('throttles repeated registrations from the same connection', async () => {
    const sharedIp = '192.0.2.77'

    for (let attempt = 0; attempt < 3; attempt += 1) {
      signUpMock.mockImplementation(async () => signUpSuccess(`throttle-${attempt}@example.test`))
      const response = await POST(makeRequest({ ...validBody, email: `throttle-${attempt}@example.test` }, sharedIp))
      expect(response.status).toBe(201)
    }
    const blocked = await POST(makeRequest({ ...validBody, email: 'throttle-3@example.test' }, sharedIp))
    const json = (await blocked.json()) as { error?: string }

    expect(blocked.status).toBe(429)
    expect(json.error).toContain('Demasiados intentos')
    // The 4th attempt never reaches Supabase: only the three earlier signups.
    expect(signUpMock).toHaveBeenCalledTimes(3)
  })
})

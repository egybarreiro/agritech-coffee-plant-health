// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
  createAuditLog: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }))

import { POST } from './route'

const adminId = '55555555-5555-4555-8555-555555555555'
const farmerId = '66666666-6666-4666-8666-666666666666'

let profileRoleResult: { data: unknown; error: { message: string } | null }
let adminDirectory: Array<{ id: string }> | null
let profileInsertError: { message: string } | null
const profileInserts: Array<Record<string, unknown>> = []

let createUserMock: ReturnType<typeof vi.fn>
let deleteUserMock: ReturnType<typeof vi.fn>

// Configurable service-client behavior for the new failure-mode tests.
let createUserThrows: string | null
let createUserResult: { data: { user: { id: string } | null }; error: { message: string } | null }
let cleanupDeleteResult: { error: { message: string } } | null
let getUserThrow: string | null

function makeServiceClient() {
  createUserMock = vi.fn(async () => {
    if (createUserThrows) {
      const throwing = createUserThrows
      throw new Error(throwing)
    }
    return { data: createUserResult.data, error: createUserResult.error }
  })
  deleteUserMock = vi.fn(async () => ({ error: cleanupDeleteResult }))
  return {
    from: (table: string) => {
      if (table !== 'profiles') return {}
      return {
        select: () => ({
          eq: () => ({
            // Covers both query shapes used in the route:
            // - `.single()` for the requesting administrator's role check
            // - awaiting the chain directly for the administrator directory
            single: () => Promise.resolve(profileRoleResult),
            then: (
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => Promise.resolve({ data: adminDirectory, error: null }).then(onFulfilled, onRejected),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          profileInserts.push(payload)
          return { error: profileInsertError }
        },
      }
    },
    auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = {
  email: 'farmer@example.test',
  password: 'colombia-cafe-2026',
  full_name: 'Ana Pérez',
}

describe('POST /api/auth/register — administrator-provisioned farmer accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profileInserts.length = 0
    profileRoleResult = { data: { role: 'administrator' }, error: null }
    adminDirectory = [{ id: adminId }]
    profileInsertError = null
    createUserThrows = null
    createUserResult = { data: { user: { id: farmerId } }, error: null }
    cleanupDeleteResult = null
    getUserThrow = null

    mocks.cookies.mockReturnValue({ getAll: () => [], set: vi.fn() })
    mocks.createServerClient.mockImplementation(() => {
      if (getUserThrow) {
        const throwing = getUserThrow
        return {
          auth: {
            getUser: async () => {
              throw new Error(throwing)
            },
          },
        }
      }
      return {
        auth: { getUser: async () => ({ data: { user: { id: adminId } }, error: null }) },
      }
    })
    mocks.createServiceClient.mockReturnValue(makeServiceClient())
    mocks.createAuditLog.mockResolvedValue(undefined)
  })

  it('rejects non-administrator callers before acting with the service client', async () => {
    profileRoleResult = { data: { role: 'farmer' }, error: null }

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden: administrator only' })
    expect(createUserMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('provisions the farmer account and profile row through the service-role client', async () => {
    const response = await POST(makeRequest(validBody))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'farmer@example.test',
        email_confirm: true,
        user_metadata: expect.objectContaining({ role: 'farmer' }),
      }),
    )
    expect(profileInserts).toEqual([
      expect.objectContaining({
        id: farmerId,
        email: 'farmer@example.test',
        role: 'farmer',
      }),
    ])
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      adminId,
      'admin_created_farmer',
      'profiles',
      farmerId,
      expect.objectContaining({ farmer_email: 'farmer@example.test' }),
    )
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('answers valid JSON with the json content-type on success', async () => {
    const response = await POST(makeRequest(validBody))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await JSON.parse(await response.text())).toEqual({
      success: true,
      userId: farmerId,
    })
  })

  it('rejects invalid registration input before creating any account', async () => {
    const response = await POST(makeRequest({ email: 'not-an-email', password: 'x' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request' })
    expect(createUserMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('answers valid JSON for a malformed request body', async () => {
    const response = await POST(makeRequest('{not-json'))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request' })
    expect(createUserMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('answers valid JSON for an empty request body', async () => {
    const response = await POST(makeRequest(''))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request' })
    expect(createUserMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('answers JSON 401 without touching accounts when unauthenticated', async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }) },
    })

    const response = await POST(makeRequest(validBody))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(profileInserts).toHaveLength(0)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('answers JSON 500 (fail closed) when the Supabase auth check itself throws', async () => {
    getUserThrow = 'network down'

    const response = await POST(makeRequest(validBody))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(500)
    expect(createUserMock).not.toHaveBeenCalled()
    expect(profileInserts).toHaveLength(0)
  })

  it('answers JSON 400 and creates nothing when Supabase reports an auth error', async () => {
    createUserResult = { data: { user: null }, error: { message: 'user already exists' } }

    const response = await POST(makeRequest(validBody))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Failed to create account' })
    expect(profileInserts).toHaveLength(0)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('answers JSON 500 (no partial account) when Supabase user creation throws', async () => {
    createUserThrows = 'network down'

    const response = await POST(makeRequest(validBody))

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.status).toBe(500)
    expect(profileInserts).toHaveLength(0)
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('rolls back the auth user when the profile insert fails', async () => {
    profileInsertError = { message: 'insert failed' }

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Could not complete farmer account setup' })
    expect(createUserMock).toHaveBeenCalledTimes(1)
    expect(deleteUserMock).toHaveBeenCalledWith(farmerId)
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('warns in the JSON response when rollback itself fails (incomplete account is visible)', async () => {
    profileInsertError = { message: 'insert failed' }
    cleanupDeleteResult = { error: { message: 'delete failed' } }

    const response = await POST(makeRequest(validBody))
    const json = (await response.json()) as { error?: string; warning?: string }

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(json.error).toBe('Could not complete farmer account setup')
    expect(json.warning).toContain('No se pudo revertir el acceso temporal')
    expect(mocks.createAuditLog).not.toHaveBeenCalled()
  })

  it('rolls back the auth user when audit logging fails', async () => {
    mocks.createAuditLog.mockRejectedValue(new Error('audit write failed'))

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(500)
    expect(deleteUserMock).toHaveBeenCalledWith(farmerId)
  })
})

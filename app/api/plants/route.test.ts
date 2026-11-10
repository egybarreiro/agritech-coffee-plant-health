// @vitest-environment node
//
// Covers POST /api/plants plant registration:
//  - INSERT without requesting returned rows (no `.select()`/RETURNING): the
//    plants_insert_own WITH CHECK policy's correlated subplan mis-evaluates at
//    execution time when the statement carries RETURNING (deterministic 42501).
//  - Client-generated UUID + separate RLS-bound read-back SELECT.
//  - Diagnostic logging of insert/read errors (metadata only, no secrets).
// All Supabase access is mocked; no real records are touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { POST } from './route'

const farmerId = 'e3ce33a2-d378-4311-9d20-c5e476e2da99'
const cropId = '94f26ad6-331e-4d96-b019-60afee78f403'
const cropRow = { id: cropId, name: 'coffee', scientific_name: 'Coffea spp.' }

type PostgrestError = {
  code?: string | null
  message: string
  details?: string | null
  hint?: string | null
}

type DbResult = { data: unknown; error: PostgrestError | null }

// 'db-row' = simulate the database faithfully: the read-back SELECT returns the
// row exactly as inserted (same id), as plants_select_own would allow.
let readResult: DbResult | 'db-row'

let authUser: { id: string } | { error: PostgrestError } | null
let profileResult: DbResult
let cropResult: DbResult
let insertResult: { data: null; error: PostgrestError | null }

// Spies over the mock client's interactions.
let insertCalls: Array<Record<string, unknown>>
let returningTrap: { requested: boolean }
let readSelectCalls: Array<{ id: unknown; farmer_id: unknown }>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function makeClient() {
  return {
    auth: {
      getUser: () => {
        if (authUser === null || 'error' in authUser) {
          return Promise.resolve({ data: { user: null }, error: authUser === null ? { message: 'no session' } : authUser.error })
        }
        return Promise.resolve({ data: { user: authUser }, error: null })
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(profileResult),
            }),
          }),
        }
      }
      if (table === 'crops') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve(cropResult),
              }),
            }),
          }),
        }
      }
      if (table === 'plants') {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertCalls.push(payload)
            // Thenable that resolves the insert result. Trap any attempt to
            // chain representation-returning methods (`.select()`/`.single()`).
            const builder = {
              then: (
                onFulfilled?: (value: { data: null; error: PostgrestError | null }) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) => Promise.resolve(insertResult).then(onFulfilled, onRejected),
            }
            Object.defineProperty(builder, 'select', {
              get: () => {
                returningTrap.requested = true
                return () => {
                  throw new Error('INSERT must not request returned rows')
                }
              },
            })
            Object.defineProperty(builder, 'single', {
              get: () => {
                returningTrap.requested = true
                return () => {
                  throw new Error('INSERT must not request returned rows')
                }
              },
            })
            return builder
          },
          select: () => ({
            eq: (idColumn: string, idValue: unknown) => ({
              eq: (farmerColumn: string, farmerValue: unknown) => ({
                maybeSingle: () => {
                  readSelectCalls.push({ [idColumn]: idValue, [farmerColumn]: farmerValue } as { id: unknown; farmer_id: unknown })
                  const result: DbResult =
                    readResult === 'db-row'
                      ? {
                          data: {
                            id: insertCalls[0]?.id ?? 'pending',
                            name: 'Prueba 001',
                            crop_id: cropId,
                            created_at: '2026-11-10T21:00:00.000Z',
                          },
                          error: null,
                        }
                      : readResult
                  return Promise.resolve(result)
                },
              }),
            }),
          }),
        }
      }
      return {}
    },
  }
}

function jsonRequest(body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }): Request {
  return new Request('http://localhost/api/plants', { method: 'POST', headers, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser = { id: farmerId }
  profileResult = { data: { role: 'farmer' }, error: null }
  cropResult = { data: cropRow, error: null }
  insertResult = { data: null, error: null }
  readResult = 'db-row'
  insertCalls = []
  returningTrap = { requested: false }
  readSelectCalls = []
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.createClient.mockReturnValue(makeClient())
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('POST /api/plants — insert without RETURNING, then RLS-bound read-back', () => {
  it('registers the plant with a generated UUID and never requests returned rows', async () => {
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(201)
    expect(returningTrap.requested).toBe(false)

    expect(insertCalls).toHaveLength(1)
    const payload = insertCalls[0]
    expect(payload.farmer_id).toBe(farmerId)
    expect(payload.crop_id).toBe(cropId)
    expect(payload.name).toBe('Prueba 001')
    expect(typeof payload.id).toBe('string')
    expect(payload.id as string).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('reads the created row back with a separate SELECT scoped to the same UUID and farmer', async () => {
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(201)
    expect(readSelectCalls).toHaveLength(1)
    expect(readSelectCalls[0].id).toBe(insertCalls[0].id)
    expect(readSelectCalls[0].farmer_id).toBe(farmerId)

    const body = await response.json()
    expect(body.plant.id).toBe(insertCalls[0].id)
    expect(body.plant.name).toBe('Prueba 001')
    expect(body.plant.crop_id).toBe(cropId)
    expect(body.plant.crop).toEqual(cropRow)
  })

  it('preserves the previous 201 response contract', async () => {
    readResult = { data: { id: '88888888-8888-4888-8888-888888888888', name: 'Prueba 001', crop_id: cropId, created_at: '2026-11-10T21:00:00.000Z' }, error: null }

    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      plant: {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Prueba 001',
        crop_id: cropId,
        created_at: '2026-11-10T21:00:00.000Z',
        crop: cropRow,
      },
    })
  })

  it('does not run the read-back SELECT when the INSERT is rejected (RLS 42501) and logs the error metadata', async () => {
    insertResult = {
      data: null,
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "plants"',
        details: null,
        hint: null,
      },
    }

    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'No se pudo registrar la planta.' })
    expect(readSelectCalls).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('[plants] insert rejected', {
      code: '42501',
      message: 'new row violates row-level security policy for table "plants"',
      details: null,
      hint: null,
    })
  })

  it('logs null for absent details and hint fields on insert errors', async () => {
    insertResult = { data: null, error: { code: '23503', message: 'foreign key violation' } }

    const response = (await POST(jsonRequest({ name: 'Otra planta', crop_id: cropId })))!

    expect(response.status).toBe(500)
    expect(consoleErrorSpy).toHaveBeenCalledWith('[plants] insert rejected', {
      code: '23503',
      message: 'foreign key violation',
      details: null,
      hint: null,
    })
  })

  it('never retries the INSERT when the read-back SELECT fails, and reports a distinct error', async () => {
    readResult = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "plants"', details: null, hint: null } }

    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'La planta se registró, pero no se pudo cargar su información.',
    })
    expect(insertCalls).toHaveLength(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('[plants] post-insert read failed', {
      code: '42501',
      message: 'new row violates row-level security policy for table "plants"',
      details: null,
      hint: null,
    })
  })

  it('also reports the distinct error when the created row is not visible on read-back', async () => {
    readResult = { data: null, error: null }

    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'La planta se registró, pero no se pudo cargar su información.',
    })
    expect(insertCalls).toHaveLength(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('keeps the diagnostic log free of JWTs, cookies, credentials, and personal data', async () => {
    insertResult = {
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy for table "plants"', details: null, hint: null },
    }

    await POST(
      jsonRequest(
        { name: 'Prueba 001', crop_id: cropId },
        {
          'Content-Type': 'application/json',
          Authorization: 'Bearer header.payload.signature',
          Cookie: 'sb-access-token=secret-token-value',
        },
      ),
    )

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logged = consoleErrorSpy.mock.calls[0]
    expect(logged).toHaveLength(2)
    expect(Object.keys(logged[1] as Record<string, unknown>)).toEqual(['code', 'message', 'details', 'hint'])
    const serialized = JSON.stringify(logged)
    expect(serialized).not.toContain('secret-token-value')
    expect(serialized).not.toContain('header.payload.signature')
    expect(serialized).not.toContain(farmerId)
  })
})

describe('POST /api/plants — existing authorization and validation behavior', () => {
  it('returns 401 without a session', async () => {
    authUser = null
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'No autorizado.' })
    expect(insertCalls).toHaveLength(0)
  })

  it('returns 403 for a non-farmer profile', async () => {
    profileResult = { data: { role: 'administrator' }, error: null }
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Esta acción está disponible para agricultores.' })
    expect(insertCalls).toHaveLength(0)
  })

  it('rejects an invalid body with 400', async () => {
    const response = (await POST(jsonRequest({ name: '', crop_id: 'not-a-uuid' })))!
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Revisa el nombre y el cultivo seleccionado.' })
    expect(insertCalls).toHaveLength(0)
  })

  it('keeps the active-crop validation and does not insert for an unavailable crop', async () => {
    cropResult = { data: null, error: null }
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'El cultivo seleccionado no está disponible.' })
    expect(insertCalls).toHaveLength(0)
  })

  it('returns 500 when the crop check errors', async () => {
    cropResult = { data: null, error: { code: '42501', message: 'crops read denied', details: null, hint: null } }
    const response = (await POST(jsonRequest({ name: 'Prueba 001', crop_id: cropId })))!
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'No se pudo verificar el cultivo.' })
    expect(insertCalls).toHaveLength(0)
  })
})

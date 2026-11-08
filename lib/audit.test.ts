import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuditLog } from './audit'

type AuditClient = Parameters<typeof createAuditLog>[0]

const insertSpy = vi.fn<(record: Record<string, unknown>) => Promise<{ data: null; error: Error | null }>>()
const fromSpy = vi.fn(() => ({ insert: insertSpy }))
const supabase = { from: fromSpy } as unknown as AuditClient

beforeEach(() => {
  fromSpy.mockClear()
  insertSpy.mockReset()
  insertSpy.mockResolvedValue({ data: null, error: null })
})

describe('createAuditLog', () => {
  it('inserts into audit_logs', async () => {
    await createAuditLog(supabase, 'user-123', 'plants.insert', 'plants', 'plant-456')

    expect(fromSpy).toHaveBeenCalledWith('audit_logs')
  })

  it('stores the actor, action, entity, and details', async () => {
    await createAuditLog(supabase, 'user-123', 'plants.insert', 'plants', 'plant-456', {
      name: 'Cafeto del patio',
    })

    expect(insertSpy).toHaveBeenCalledWith({
      actor_id: 'user-123',
      action: 'plants.insert',
      entity_type: 'plants',
      entity_id: 'plant-456',
      details: { name: 'Cafeto del patio' },
    })
  })

  it('uses an empty details object by default and preserves a null entity id', async () => {
    await createAuditLog(supabase, 'user-123', 'profiles.delete', 'profiles', null)

    expect(insertSpy).toHaveBeenCalledWith({
      actor_id: 'user-123',
      action: 'profiles.delete',
      entity_type: 'profiles',
      entity_id: null,
      details: {},
    })
  })

  it('throws when Supabase resolves with an error object', async () => {
    insertSpy.mockResolvedValue({ data: null, error: new Error('RLS policy violation') })

    await expect(createAuditLog(supabase, 'user-123', 'plants.insert', 'plants', 'plant-456'))
      .rejects.toThrow('Failed to write audit log')
  })

  it('propagates a rejected insert request', async () => {
    insertSpy.mockRejectedValue(new Error('connection lost'))

    await expect(createAuditLog(supabase, 'user-123', 'plants.insert', 'plants', 'plant-456'))
      .rejects.toThrow('connection lost')
  })
})

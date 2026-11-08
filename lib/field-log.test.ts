// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createFieldLogEntry,
  fieldLogStorageKey,
  FIELD_LOG_MAX_ENTRIES,
  FIELD_LOG_MAX_NOTE,
  isUnitId,
  parseFieldLog,
  serializeFieldLog,
  type FieldLogEntry,
} from './field-log'

const UNIT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function entry(overrides: Partial<FieldLogEntry> = {}): FieldLogEntry {
  return {
    id: 'entry-1',
    unitId: UNIT,
    type: 'watering',
    note: 'Riego ligero',
    createdAt: '2026-01-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('isUnitId / fieldLogStorageKey', () => {
  it('validates UUIDs strictly', () => {
    expect(isUnitId(UNIT)).toBe(true)
    expect(isUnitId('not-a-uuid')).toBe(false)
    expect(isUnitId('')).toBe(false)
  })

  it('returns a namespaced storage key for valid units and null otherwise', () => {
    expect(fieldLogStorageKey(UNIT)).toBe(`agritech.fieldlog.v1.${UNIT}`)
    expect(fieldLogStorageKey('garbage')).toBeNull()
  })
})

describe('parseFieldLog', () => {
  it('returns an empty list for null, empty, malformed or non-array values', () => {
    expect(parseFieldLog(null, UNIT)).toEqual([])
    expect(parseFieldLog('', UNIT)).toEqual([])
    expect(parseFieldLog('{not-json', UNIT)).toEqual([])
    expect(parseFieldLog('{"id":"x"}', UNIT)).toEqual([])
  })

  it('drops entries with an invalid type, oversize note or malformed date, and keeps valid ones', () => {
    const stored = JSON.stringify([
      entry(),
      { ...entry({ id: 'e2' }), type: 'analysis' } satisfies Record<string, unknown>,
      { ...entry({ id: 'e3', note: 'x'.repeat(FIELD_LOG_MAX_NOTE + 1) }) },
      { ...entry({ id: 'e4', createdAt: 'not-a-date' }) },
      { ...entry({ id: 'e5', type: 'pest', note: 'Mosca blanca', createdAt: '2026-01-02T11:00:00.000Z' }) },
    ])
    const result = parseFieldLog(stored, UNIT)
    expect(result.map((item) => item.id)).toEqual(['e5', 'entry-1'])
    for (const item of result) {
      expect(item.unitId).toBe(UNIT)
    }
  })

  it('orders newest-first and caps the list to the maximum size', () => {
    const stored = JSON.stringify(
      Array.from({ length: FIELD_LOG_MAX_ENTRIES + 25 }, (_, index) =>
        entry({ id: `e${index}`, createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString() }),
      ),
    )
    const result = parseFieldLog(stored, UNIT)
    expect(result).toHaveLength(FIELD_LOG_MAX_ENTRIES)
    // Newest-first order; the cap keeps the 200 newest (e224 … e25).
    expect(result[0].id).toBe(`e${FIELD_LOG_MAX_ENTRIES + 24}`)
    expect(result[FIELD_LOG_MAX_ENTRIES - 1].id).toBe('e25')
  })
})

describe('serializeFieldLog', () => {
  it('round-trips entries and enforces the cap', () => {
    const list = [entry(), entry({ id: 'e2', type: 'observation', note: '', createdAt: '2026-01-01T00:00:00.000Z' })]
    const parsed = parseFieldLog(serializeFieldLog(list), UNIT)
    expect(parsed).toEqual([...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)))

    const oversized = Array.from({ length: FIELD_LOG_MAX_ENTRIES + 10 }, (_, index) => entry({ id: `e${index}` }))
    expect(parseFieldLog(serializeFieldLog(oversized), UNIT)).toHaveLength(FIELD_LOG_MAX_ENTRIES)
  })

  it('rejects notes longer than the cap when parsing serialized data', () => {
    const longNote = 'x'.repeat(FIELD_LOG_MAX_NOTE + 1)
    expect(parseFieldLog(serializeFieldLog([entry({ note: longNote })]), UNIT)).toEqual([])
  })
})

describe('createFieldLogEntry', () => {
  it('creates a valid entry with a UUID id, given type and ISO timestamp', () => {
    const item = createFieldLogEntry({ unitId: UNIT, type: 'harvest', note: 'Primer corte' })
    expect(item.unitId).toBe(UNIT)
    expect(item.type).toBe('harvest')
    expect(item.note).toBe('Primer corte')
    expect(isUnitId(item.id)).toBe(true)
    expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false)
  })
})

/**
 * Field log (bitácora) — Sprint 1 PROTOTYPE storage.
 *
 * There is no backend table for farmer field-log entries in the current
 * schema (migrations 001–007), so this sprint keeps entries in the browser's
 * localStorage, clearly labeled as a prototype in the UI. Entries are strictly
 * separated from AI analyses: a field-log entry is a farmer-recorded activity
 * or observation, never a diagnosis.
 */

export const FIELD_LOG_ENTRY_TYPES = [
  'observation',
  'watering',
  'fertilization',
  'pruning',
  'harvest',
  'pest',
] as const

export type FieldLogEntryType = (typeof FIELD_LOG_ENTRY_TYPES)[number]

export const FIELD_LOG_ENTRY_LABELS: Record<FieldLogEntryType, string> = {
  observation: 'Observación',
  watering: 'Riego',
  fertilization: 'Fertilización o tratamiento',
  pruning: 'Poda',
  harvest: 'Cosecha',
  pest: 'Plaga',
}

export const FIELD_LOG_STORAGE_PREFIX = 'agritech.fieldlog.v1.'
export const FIELD_LOG_MAX_NOTE = 500
export const FIELD_LOG_MAX_ENTRIES = 200

export type FieldLogEntry = {
  id: string
  unitId: string
  type: FieldLogEntryType
  note: string
  createdAt: string
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isUnitId(value: string): boolean {
  return UUID_RE.test(value)
}

/** Storage key for a unit's field log, or null for an invalid unit id. */
export function fieldLogStorageKey(unitId: string): string | null {
  return isUnitId(unitId) ? `${FIELD_LOG_STORAGE_PREFIX}${unitId}` : null
}

function isStoredEntry(value: unknown): value is Omit<FieldLogEntry, 'unitId'> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.type === 'string' &&
    (FIELD_LOG_ENTRY_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.note === 'string' &&
    candidate.note.length <= FIELD_LOG_MAX_NOTE &&
    typeof candidate.createdAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.createdAt))
  )
}

/** Parses a stored JSON value into valid, chronologically-ordered entries. */
export function parseFieldLog(value: string | null, unitId: string): FieldLogEntry[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const entries: FieldLogEntry[] = []
  for (const item of parsed) {
    if (!isStoredEntry(item)) continue
    entries.push({
      id: item.id,
      unitId,
      type: item.type,
      note: item.note,
      createdAt: item.createdAt,
    })
  }
  return entries
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, FIELD_LOG_MAX_ENTRIES)
}

/** Serializes entries for storage; cap keeps the value bounded. */
export function serializeFieldLog(entries: FieldLogEntry[]): string {
  return JSON.stringify(entries.slice(0, FIELD_LOG_MAX_ENTRIES))
}

export function createFieldLogEntry(input: {
  unitId: string
  type: FieldLogEntryType
  note: string
}): FieldLogEntry {
  return {
    id: crypto.randomUUID(),
    unitId: input.unitId,
    type: input.type,
    note: input.note,
    createdAt: new Date().toISOString(),
  }
}

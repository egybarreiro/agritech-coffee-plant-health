'use client'

import { useSyncExternalStore, useState, useMemo, type FormEvent } from 'react'
import {
  createFieldLogEntry,
  fieldLogStorageKey,
  FIELD_LOG_ENTRY_LABELS,
  FIELD_LOG_ENTRY_TYPES,
  FIELD_LOG_MAX_NOTE,
  FIELD_LOG_STORAGE_PREFIX,
  parseFieldLog,
  serializeFieldLog,
  type FieldLogEntry,
  type FieldLogEntryType,
} from '@/lib/field-log'

type FieldLogProps = {
  /** Unit (plant) UUID — validated before use. */
  unitId: string
}

/**
 * Sprint 1 prototype: the field log (bitácora) stores entries in the
 * browser's localStorage under a namespaced key. The UI label makes the
 * prototype state explicit; entries are NEVER sent to the database and never
 * presented as AI analyses.
 *
 * localStorage is an external store, so the component reads it through
 * useSyncExternalStore instead of setState-in-effect. A module cache keeps
 * snapshots referentially stable; after a write the cache entry is dropped
 * and listeners notified.
 */

const UNREADABLE: Readonly<{ entries: readonly FieldLogEntry[]; readable: false }> = {
  entries: [],
  readable: false,
}
const EMPTY: Readonly<{ entries: readonly FieldLogEntry[]; readable: true }> = { entries: [], readable: true }

type CacheEntry = { raw: string | null; value: typeof EMPTY | { entries: FieldLogEntry[]; readable: true } }
const snapshotCache = new Map<string, CacheEntry>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Cross-tab updates (same key) also arrive via the storage event.
  window.addEventListener('storage', notify)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', notify)
  }
}

function readSnapshot(storageKey: string, unitId: string) {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(storageKey)
  } catch {
    // Storage blocked (e.g. privacy mode): report as unreadable.
    return UNREADABLE
  }
  const cached = snapshotCache.get(storageKey)
  if (cached && cached.raw === raw) return cached.value
  const value = { entries: parseFieldLog(raw, unitId), readable: true } as const
  snapshotCache.set(storageKey, { raw, value })
  return value
}

const typeAccent: Record<FieldLogEntryType, string> = {
  observation: 'bg-[#e4ecdf] text-[#3f6948]',
  watering: 'bg-[#e0ecf4] text-[#2f5a74]',
  fertilization: 'bg-[#f3ede1] text-[#725b2f]',
  pruning: 'bg-[#efe9f2] text-[#6a4d79]',
  harvest: 'bg-[#faeedd] text-[#8a5a30]',
  pest: 'bg-[#f9e6e6] text-[#96433c]',
}

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' })

export function FieldLog({ unitId }: FieldLogProps) {
  const [type, setType] = useState<FieldLogEntryType>('observation')
  const [note, setNote] = useState('')
  const [writeError, setWriteError] = useState('')

  const storageKey = fieldLogStorageKey(unitId)
  // useMemo keeps the second arg of readSnapshot stable across renders — the
  // cache key already encodes unitId, so this is purely a re-render guard.
  const snapshotCallbacks = useMemo(
    () => ({
      getSnapshot: () => (storageKey ? readSnapshot(storageKey, unitId) : UNREADABLE),
      getServerSnapshot: () => EMPTY as Readonly<{ entries: readonly FieldLogEntry[]; readable: true }>,
    }),
    [storageKey, unitId],
  )
  // useSyncExternalStore needs stable callback refs; bind via a stable object.
  const store = useSyncExternalStore(subscribe, snapshotCallbacks.getSnapshot, snapshotCallbacks.getServerSnapshot)

  function persist(next: FieldLogEntry[]) {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, serializeFieldLog(next))
      // Drop the cache so the next getSnapshot re-reads what we just wrote.
      snapshotCache.delete(storageKey)
      notify()
      setWriteError('')
    } catch {
      setWriteError('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado).')
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = note.trim()
    if (!storageKey) return
    if (!trimmed && type !== 'observation') {
      setWriteError('Añade una nota breve para el registro, o guarda observaciones sin nota.')
      return
    }
    const entry = createFieldLogEntry({ unitId, type, note: trimmed })
    persist([entry, ...store.entries])
    setNote('')
  }

  function removeEntry(entryId: string) {
    persist(store.entries.filter((entry) => entry.id !== entryId))
  }

  if (!storageKey || !store.readable) {
    return (
      <section className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-[#26392c]">Bitácora de campo</h2>
        <p className="mt-2 text-sm leading-6 text-[#68766b]">
          Esta bitácora usa el almacenamiento local del navegador, que no está disponible o está bloqueado en este
          momento. La persistencia en la base de datos llegará en el próximo sprint.
        </p>
      </section>
    )
  }

  const entries = store.entries

  return (
    <section className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[#26392c]">Bitácora de campo</h2>
        <span className="rounded-full bg-[#f3f0e6] px-3 py-1 text-xs font-semibold text-[#725b2f]">
          Prototipo · guardado solo en este navegador
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68766b]">
        Registra riegos, tratamientos, podas, cosechas, plagas y observaciones. Los registros de la bitácora
        son notas del agricultor: nunca se presentan como diagnósticos.
      </p>
      <p className="mt-3 rounded-xl bg-[#fbf6ea] px-4 py-3 text-xs leading-5 text-[#725b2f]">
        La persistencia en la base de datos (tabla de bitácora) está planificada para el próximo sprint; por ahora,
        solo la persistencia local del navegador.
      </p>

      <form onSubmit={save} className="mt-6 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-[#34473a]">Tipo de registro</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FIELD_LOG_ENTRY_TYPES.map((entryType) => (
              <button
                key={entryType}
                type="button"
                aria-pressed={type === entryType}
                onClick={() => setType(entryType)}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  type === entryType
                    ? 'border-[#244b34] bg-[#244b34] text-white'
                    : 'border-[#cbd6c9] bg-white text-[#244b34] hover:bg-[#f6f8f4]'
                }`}
              >
                {FIELD_LOG_ENTRY_LABELS[entryType]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium text-[#34473a]">
          Nota (opcional, máx. {FIELD_LOG_MAX_NOTE} caracteres)
          <textarea
            maxLength={FIELD_LOG_MAX_NOTE}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ej. Riego ligero temprano; follaje con manchas pequeñas en hoja inferior…"
            className="mt-2 w-full resize-y rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]"
          />
        </label>
        {writeError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {writeError}
          </p>
        )}
        <button
          type="submit"
          className="rounded-xl bg-[#244b34] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#193b28]"
        >
          Guardar registro
        </button>
      </form>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#26392c]">Historial cronológico</h3>
          <span className="rounded-full bg-[#e4ecdf] px-3 py-1 text-sm font-semibold text-[#3f6948]">{entries.length}</span>
        </div>
        {entries.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-[#cbd6c9] bg-white/70 p-6 text-center text-sm text-[#68766b]">
            Aún no hay registros en la bitácora de esta unidad.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#e0e7dc] bg-[#fafbf9] p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${typeAccent[entry.type]}`}>
                      {FIELD_LOG_ENTRY_LABELS[entry.type]}
                    </span>
                    <time dateTime={entry.createdAt} className="text-xs text-[#8a978a]">
                      {dateFormatter.format(new Date(entry.createdAt))}
                    </time>
                  </div>
                  {entry.note && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#34473a]">{entry.note}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  aria-label={`Eliminar registro de ${FIELD_LOG_ENTRY_LABELS[entry.type]}`}
                  className="rounded-lg border border-[#e0cfcf] px-2.5 py-1.5 text-xs font-semibold text-[#96433c] transition hover:bg-[#fdf3f3]"
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-4 text-xs text-[#a2ada3]">
        Almacenamiento local: clave{' '}
        <code className="rounded bg-[#f3f5f0] px-1.5 py-0.5 text-[#4b5a50]">
          {FIELD_LOG_STORAGE_PREFIX}&lt;unidad&gt;
        </code>
      </p>
    </section>
  )
}

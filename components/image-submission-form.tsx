'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react'
import { CropIllustration } from '@/components/crop-illustration'

type PlantOption = { id: string; name: string; crop_id: string; crop_name: string }
type Props = { plants: PlantOption[]; /** Optional preselected plant id (e.g. from /dashboard/units/<id> deep link). */ initialPlantId?: string }

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ACCEPTED_INPUT = 'image/jpeg,image/png,image/webp'

/** Validates one file against the project's image conventions; null = valid. */
function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) return 'Elige una imagen JPEG, PNG o WebP.'
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return 'La imagen debe tener un tamaño máximo de 10 MB.'
  return null
}

type PhotoSelection = { file: File; previewUrl: string }
type QueuedLeafPhoto = PhotoSelection & {
  key: string
  status: 'queued' | 'uploading' | 'done' | 'error'
  imageId?: string
  errorMessage?: string
}

/** Small persistent thumbnail with its stored state. */
function PhotoThumb({ photo, alt, onRemove, disabled }: { photo: PhotoSelection & { status?: QueuedLeafPhoto['status']; errorMessage?: string }; alt: string; onRemove?: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e0e7dc] bg-[#fafbf9] p-2">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
        <Image src={photo.previewUrl} alt={alt} fill sizes="64px" unoptimized className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[#788477]">{photo.file.name}</p>
        {photo.status === 'done' && <p className="text-xs font-semibold text-[#3f6948]">Subida ✓</p>}
        {photo.status === 'queued' && <p className="text-xs text-[#68766b]">Preparada para subir</p>}
        {photo.status === 'uploading' && <p className="text-xs text-[#68766b]">Subiendo…</p>}
        {photo.status === 'error' && <p className="text-xs text-red-600">{photo.errorMessage ?? 'No se pudo subir.'}</p>}
      </div>
      {onRemove && <button type="button" onClick={onRemove} disabled={disabled} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#4e7252] transition hover:bg-[#edf4e9] disabled:opacity-40">Quitar</button>}
    </div>
  )
}

/**
 * Primary monochrome AgriTech step badge: separates the two required photo
 * sections and doubles as the completion indicator ("Listo").
 */
function StepBadge({ step, title, done, doneLabel }: { step: number; title: string; done: boolean; doneLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#34473a]">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border border-[#244b34] text-xs font-bold text-[#244b34]">{step}</span>
        {title}
      </p>
      <span
        aria-label={done ? `${title}: completada` : `${title}: pendiente`}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${done ? 'bg-[#edf4e9] text-[#3f6948]' : 'bg-white text-[#68766b] border border-[#dfe5db]'}`}
      >
        {done ? `Listo · ${doneLabel}` : 'Pendiente'}
      </span>
    </div>
  )
}

/**
 * Simple framing example using the existing brand illustration (coffee).
 */
function CropIllustrationForExample() {
  return <CropIllustration className="h-16 w-16 shrink-0" />
}

export function ImageSubmissionForm({ plants, initialPlantId }: Props) {
  const initialPlant = initialPlantId ? plants.find((plant) => plant.id === initialPlantId) : undefined
  const [plantId, setPlantId] = useState(initialPlant?.id ?? plants[0]?.id ?? '')
  const [fullPlant, setFullPlant] = useState<PhotoSelection | null>(null)
  const [fullPlantImageId, setFullPlantImageId] = useState<string | null>(null)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [leafPhotos, setLeafPhotos] = useState<QueuedLeafPhoto[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fullInputRef = useRef<HTMLInputElement>(null)
  const leafInputRef = useRef<HTMLInputElement>(null)
  // Track every object URL created in this session so nothing leaks.
  const objectUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const created = objectUrlsRef.current
    return () => { for (const url of created) URL.revokeObjectURL(url) }
  }, [])

  function createPreview(file: File): string {
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.add(url)
    return url
  }

  function chooseFullPlant(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setError('')
    setMessage('')
    const validationError = validateFile(selected)
    if (validationError) { setError(validationError); return }
    // Replace is only possible before submission: the moment a photo is
    // uploaded it becomes an immutable record (retries never duplicate it).
    setFullPlant((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl)
      objectUrlsRef.current.delete(current?.previewUrl ?? '')
      return { file: selected, previewUrl: createPreview(selected) }
    })
  }

  function removeFullPlant() {
    setFullPlant((current) => {
      if (current) { URL.revokeObjectURL(current.previewUrl); objectUrlsRef.current.delete(current.previewUrl) }
      return null
    })
  }

  function chooseLeafPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length === 0) return
    setError('')
    const queued: QueuedLeafPhoto[] = []
    const rejected: string[] = []
    for (const file of selected) {
      const validationError = validateFile(file)
      if (validationError) { rejected.push(`${file.name}: ${validationError}`); continue }
      queued.push({
        file,
        previewUrl: createPreview(file),
        key: crypto.randomUUID(),
        status: 'queued',
      })
    }
    if (queued.length) setLeafPhotos((current) => [...current, ...queued])
    if (rejected.length) setError(`No se agregaron algunas fotos: ${rejected.join(' · ')}`)
  }

  function removeLeafPhoto(key: string) {
    setLeafPhotos((current) => {
      const target = current.find((item) => item.key === key)
      if (target) { URL.revokeObjectURL(target.previewUrl); objectUrlsRef.current.delete(target.previewUrl) }
      return current.filter((item) => item.key !== key)
    })
  }

  /** Uploads the full-plant photo exactly once, then the assessment exists.
   * Returns the assessment id so the caller never depends on stale state. */
  async function uploadFullPlant(): Promise<string | null> {
    if (!fullPlant || fullPlantImageId) return analysisId
    const formData = new FormData()
    formData.set('file', fullPlant.file)
    formData.set('plant_id', plantId)
    formData.set('image_role', 'full_plant')
    const response = await fetch('/api/images', { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok) {
      setError(result.error || 'No se pudo guardar la fotografía de la planta completa.')
      return null
    }
    setFullPlantImageId(result.image.id)
    if (result.analysis?.id) {
      setAnalysisId(result.analysis.id)
      return result.analysis.id
    }
    // Rare: the photo saved but its assessment could not be created. Recover
    // with the dedicated analyses endpoint instead of re-uploading (which
    // would duplicate the image record).
    const analysisResponse = await fetch('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plant_image_id: result.image.id }),
    })
    const analysisResult = await analysisResponse.json()
    if (!analysisResponse.ok || !analysisResult.analysis?.id) {
      setError(result.warning || 'La foto se guardó, pero no se pudo crear su evaluación. Intenta de nuevo.')
      return null
    }
    setAnalysisId(analysisResult.analysis.id)
    return analysisResult.analysis.id
  }

  /** Uploads every queued leaf photo; failed items stay in the queue with
   * their error visible, never silently discarded. Returns the keys that
   * still failed so the caller never relies on stale render state. */
  async function uploadLeafPhotos(onlyKeys: Set<string>, resolvedAnalysisId: string): Promise<Set<string>> {
    const targets = leafPhotos.filter((item) => item.status !== 'done' && onlyKeys.has(item.key))
    const failedKeys = new Set<string>()
    for (const target of targets) {
      setLeafPhotos((current) => current.map((item) => item.key === target.key ? { ...item, status: 'uploading', errorMessage: undefined } : item))
      try {
        const formData = new FormData()
        formData.set('file', target.file)
        formData.set('plant_id', plantId)
        formData.set('image_role', 'leaf_details')
        formData.set('analysis_id', resolvedAnalysisId)
        const response = await fetch('/api/images', { method: 'POST', body: formData })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar el primer plano de hojas.')
        setLeafPhotos((current) => current.map((item) => item.key === target.key ? { ...item, status: 'done', imageId: result.image.id } : item))
      } catch (reason) {
        // Keep the failed photo visible: the farmer can remove or retry it.
        failedKeys.add(target.key)
        setLeafPhotos((current) => current.map((item) => item.key === target.key
          ? { ...item, status: 'error', errorMessage: reason instanceof Error ? reason.message : 'No se pudo subir.' }
          : item))
      }
    }
    return failedKeys
  }

  async function submitPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fullPlant || leafPhotos.length === 0 || submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const resolvedAnalysisId = await uploadFullPlant()
      if (!resolvedAnalysisId) return

      const pendingKeys = new Set(leafPhotos.filter((item) => item.status !== 'done').map((item) => item.key))
      const failedKeys = await uploadLeafPhotos(pendingKeys, resolvedAnalysisId)
      if (pendingKeys.size === 0 || failedKeys.size === 0) {
        setMessage(`Evaluación registrada: foto de planta completa y ${pendingKeys.size} primer plano${pendingKeys.size === 1 ? '' : 's'} de hojas. El resultado aparecerá en el historial.`)
      } else {
        setError('Algunos primeros planos de hojas no se pudieron subir. Usa «Reintentar fotos pendientes»; tus fotos seleccionadas siguen aquí.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const hasFullPlant = fullPlant !== null
  const hasLeaf = leafPhotos.length > 0
  const fullPlantDone = fullPlantImageId !== null
  const leafDoneCount = leafPhotos.filter((item) => item.status === 'done').length
  const leafPendingCount = leafPhotos.length - leafDoneCount
  const allDone = hasLeaf && leafPendingCount === 0
  // Final submission is only enabled when at least one full-plant photo and
  // one leaf-detail photo have been provided.
  const submitEnabled = Boolean(plantId) && hasFullPlant && hasLeaf && !submitting
  const isRetry = fullPlantDone && leafDoneCount > 0 && leafPendingCount > 0

  return (
    <form onSubmit={submitPhotos} className="space-y-6">
      {/* Shared plant selector. */}
      <div className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-[#26392c]">Selecciona la planta</h2>
        <label className="mt-5 block text-sm font-medium text-[#34473a]">Planta
          <select
            required
            value={plantId}
            onChange={(event) => setPlantId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]"
          >
            {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </select>
        </label>
      </div>

      {/* Paso 1 — Planta completa (Required) */}
      <section aria-labelledby="full-plant-step" className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <StepBadge
          step={1}
          title="Planta completa — Obligatoria"
          done={fullPlantDone}
          doneLabel="foto guardada"
        />
        <p id="full-plant-step" className="mt-3 text-sm leading-6 text-[#68766b]">
          Toma una foto que muestre <strong className="font-semibold text-[#34473a]">toda la planta de café</strong>, incluida la maceta y la mayor parte posible de su estructura (no solo un primer plano de una hoja).
        </p>
        <div className="mt-4 flex items-center gap-4 rounded-2xl bg-[#f6f8f4] p-4">
          <CropIllustrationForExample />
          <p className="text-xs leading-5 text-[#68766b]">Encuadre de ejemplo: la silueta completa de la planta dentro de la foto.</p>
        </div>
        <input
          ref={fullInputRef}
          type="file"
          accept={ACCEPTED_INPUT}
          capture="environment"
          onChange={chooseFullPlant}
          className="sr-only"
          aria-label="Tomar o elegir la foto de la planta completa"
        />
        <button type="button" onClick={() => fullInputRef.current?.click()} disabled={!plantId || fullPlantDone} className="mt-4 w-full rounded-xl border border-[#cbd6c9] px-5 py-3.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4] disabled:opacity-40">
          {fullPlantDone ? 'Foto de planta completa guardada' : fullPlant ? 'Cambiar foto' : 'Tomar o elegir foto de la planta completa'}
        </button>
        {fullPlant && !fullPlantDone && (
          <div className="mt-4 space-y-3">
            <PhotoThumb photo={fullPlant} alt="Vista previa de la foto de la planta completa" onRemove={removeFullPlant} disabled={submitting} />
            {!fullPlantDone && <p className="text-xs text-[#788477]">Puedes reemplazarla o quitarla antes de enviar.</p>}
          </div>
        )}
      </section>

      {/* Paso 2 — Leaf close-ups (Required) */}
      <section aria-labelledby="leaf-step" className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <StepBadge
          step={2}
          title="Primeros planos de hojas — Obligatorios"
          done={allDone}
          doneLabel={`${leafDoneCount} ${leafDoneCount === 1 ? 'foto' : 'fotos'}`}
        />
        <p id="leaf-step" className="mt-3 text-sm leading-6 text-[#68766b]">
          Toma <strong className="font-semibold text-[#34473a]">al menos una foto cercana de las hojas</strong>. Incluye manchas, decoloración, agujeros, rizado, zonas dañadas o crecimiento inusual cuando estén presentes. Si los síntomas aparecen en varias zonas, fotografía <strong className="font-semibold text-[#34473a]">hojas distintas</strong>.
        </p>
        <input
          ref={leafInputRef}
          type="file"
          accept={ACCEPTED_INPUT}
          capture="environment"
          multiple
          onChange={chooseLeafPhotos}
          className="sr-only"
          aria-label="Tomar o elegir uno o varios primeros planos de hojas"
        />
        <button type="button" onClick={() => leafInputRef.current?.click()} disabled={!plantId} className="mt-4 w-full rounded-xl border border-[#cbd6c9] px-5 py-3.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4] disabled:opacity-40">
          Tomar o elegir fotos de hojas (puedes subir varias)
        </button>
        {leafPhotos.length > 0 && (
          <ul className="mt-4 space-y-3">
            {leafPhotos.map((photo, index) => (
              <li key={photo.key}>
                <PhotoThumb
                  photo={photo}
                  alt={`Vista previa — primer plano de hoja ${index + 1}`}
                  onRemove={photo.status === 'done' ? undefined : () => removeLeafPhoto(photo.key)}
                  disabled={submitting || photo.status === 'uploading'}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Final submission — gated on both photo kinds. */}
      <div className="rounded-3xl border border-[#244b34] bg-white p-6 shadow-sm sm:p-7">
        {!hasFullPlant && <p className="text-sm text-[#68766b]">Necesitas la foto de la planta completa y al menos un primer plano de hojas antes de enviar.</p>}
        {hasFullPlant && !hasLeaf && <p className="text-sm text-[#68766b]">Falta el paso 2: agrega al menos un primer plano de hojas antes de enviar.</p>}
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mb-4 rounded-xl bg-[#edf4e9] px-4 py-3 text-sm leading-6 text-[#3f6948]">{message}</p>}
        <p className="mb-3 text-xs leading-5 text-[#849084]">
          La foto de la planta completa crea tu evaluación y los primeros planos se asocian a la misma evaluación. Las imágenes se guardan en almacenamiento privado y solo son visibles para tu cuenta y el personal autorizado.
        </p>
        {!allDone && (
          <button type="submit" disabled={!submitEnabled} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#244b34]">
            {submitting ? 'Subiendo fotos…' : isRetry ? 'Reintentar fotos pendientes' : 'Guardar y enviar evaluación'}
          </button>
        )}
        {allDone && fullPlantDone && (
          <Link href="/dashboard/history" className="block rounded-xl bg-[#244b34] px-5 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-[#193b28]">
            Ver historial de evaluaciones
          </Link>
        )}
      </div>
    </form>
  )
}

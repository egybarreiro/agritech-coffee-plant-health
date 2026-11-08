'use client'

import Image from 'next/image'
import { useEffect, useState, type FormEvent } from 'react'

type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'unknown'
type ReviewItem = {
  id: string
  status: 'pending' | 'processing'
  submitted_at: string
  image_url: string | null
  filename: string | null
  mime_type: string | null
  plant_name: string | null
  crop_name: string | null
  farmer_name: string | null
  /** Complementary leaf close-ups attached to this same assessment. */
  leaf_images?: Array<{ id: string; image_url: string | null; filename: string; mime_type: string }>
}
type ReviewDraft = {
  general_health_assessment: string
  estimated_severity: Severity
  detected_symptoms: string
  recommended_preventive_actions: string
  recommended_corrective_actions: string
  follow_up_instructions: string
  expert_inspection_recommended: boolean
}

const initialDraft: ReviewDraft = {
  general_health_assessment: '',
  estimated_severity: 'unknown',
  detected_symptoms: '',
  recommended_preventive_actions: '',
  recommended_corrective_actions: '',
  follow_up_instructions: '',
  expert_inspection_recommended: false,
}

const fieldClass = 'mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-3 py-2.5 text-sm text-[#26392c] outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]'
const labelClass = 'block text-sm font-medium text-[#34473a]'

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function AdminAnalysisReview() {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function loadQueue() {
      try {
        const response = await fetch('/api/admin/analyses', { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'No se pudo cargar la cola de revisión.')
        setItems(result.analyses ?? [])
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la cola de revisión.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadQueue()
    return () => controller.abort()
  }, [])

  function updateDraft(id: string, field: keyof ReviewDraft, value: string | boolean) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...initialDraft, ...current[id], [field]: value },
    }))
  }

  async function submitReview(event: FormEvent<HTMLFormElement>, item: ReviewItem) {
    event.preventDefault()
    setBusyId(item.id)
    setError('')
    setNotice('')
    const draft = { ...initialDraft, ...drafts[item.id] }

    try {
      const response = await fetch('/api/admin/analyses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: item.id,
          general_health_assessment: draft.general_health_assessment,
          estimated_severity: draft.estimated_severity,
          detected_symptoms: lines(draft.detected_symptoms),
          recommended_preventive_actions: lines(draft.recommended_preventive_actions),
          recommended_corrective_actions: lines(draft.recommended_corrective_actions),
          follow_up_instructions: draft.follow_up_instructions,
          expert_inspection_recommended: draft.expert_inspection_recommended,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar la revisión.')
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setNotice(result.audit_warning
        ? 'La revisión se guardó, pero falló su registro de auditoría. Informa al responsable del sistema.'
        : 'Revisión guardada. El agricultor ya puede consultar el resultado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error al guardar la revisión.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-10" aria-labelledby="review-queue-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#648066]">Atención de fotografías</p>
          <h2 id="review-queue-title" className="mt-1 text-2xl font-semibold text-[#26392c]">Revisión humana</h2>
        </div>
        <p className="text-sm text-[#68766b]">{loading ? 'Cargando…' : `${items.length} pendientes`}</p>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#68766b]">
        Los resultados de esta pantalla los redacta un administrador; la aplicación todavía no cuenta con diagnóstico automático. Registra observaciones verificadas y deriva los casos graves a un especialista agrícola.
      </p>

      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-xl bg-[#edf4e9] px-4 py-3 text-sm text-[#3f6948]">{notice}</p>}
      {!loading && !error && items.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-[#cbd7c8] bg-white p-7 text-sm text-[#68766b]">
          No hay fotografías pendientes de revisión.
        </div>
      )}

      <div className="mt-5 space-y-6">
        {items.map((item) => {
          const draft = { ...initialDraft, ...drafts[item.id] }
          return (
            <article key={item.id} className="overflow-hidden rounded-3xl border border-[#e0e7dc] bg-white shadow-sm">
              <div className="grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="bg-[#f4f7f1] p-5 sm:p-6">
                  {item.image_url
                    ? <a href={item.image_url} target="_blank" rel="noreferrer" className="block"><div className="relative h-64 sm:h-[28rem]"><Image src={item.image_url} alt={`Fotografía de planta completa de ${item.plant_name || 'la planta'}`} fill sizes="(max-width: 768px) 100vw, 40vw" unoptimized className="rounded-2xl object-contain" /></div></a>
                    : <div className="grid min-h-64 place-items-center rounded-2xl bg-[#e8ede4] px-5 text-center text-sm text-[#68766b]">No se pudo generar un enlace para esta fotografía.</div>}
                  <p className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#648066]">
                    <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#244b34]" /> Planta completa (foto principal)
                  </p>
                  {item.leaf_images && item.leaf_images.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#648066]">Fotos de hojas ({item.leaf_images.length})</p>
                      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {item.leaf_images.map((leaf, index) => (
                          <li key={leaf.id}>
                            {leaf.image_url
                              ? <a href={leaf.image_url} target="_blank" rel="noreferrer" className="block"><div className="relative aspect-square rounded-xl overflow-hidden ring-1 ring-[#dfe5db]"><Image src={leaf.image_url} alt={`Primer plano de hoja ${index + 1}`} fill sizes="96px" unoptimized className="object-cover" /></div></a>
                              : <div className="grid aspect-square place-items-center rounded-xl bg-[#e8ede4] px-1 text-center text-[10px] leading-3 text-[#68766b]">Sin enlace</div>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-[#788477]">Planta</dt><dd className="font-medium text-[#26392c]">{item.plant_name || 'Sin nombre'}{item.crop_name ? ` · ${item.crop_name}` : ''}</dd>
                    <dt className="text-[#788477]">Agricultor</dt><dd className="font-medium text-[#26392c]">{item.farmer_name || 'Sin nombre'}</dd>
                    <dt className="text-[#788477]">Enviada</dt><dd className="text-[#34473a]">{new Date(item.submitted_at).toLocaleString()}</dd>
                    <dt className="text-[#788477]">Archivo</dt><dd className="break-all text-[#34473a]">{item.filename || 'Fotografía'}</dd>
                  </dl>
                </div>

                <form onSubmit={(event) => void submitReview(event, item)} className="space-y-4 p-5 sm:p-6">
                  <label className={labelClass}>Observación general <span className="text-[#788477]">(mínimo 20 caracteres)</span>
                    <textarea required minLength={20} maxLength={2000} rows={3} value={draft.general_health_assessment} onChange={(event) => updateDraft(item.id, 'general_health_assessment', event.target.value)} className={fieldClass} placeholder="Describe lo que observas en la imagen." />
                  </label>
                  <label className={labelClass}>Severidad
                    <select value={draft.estimated_severity} onChange={(event) => updateDraft(item.id, 'estimated_severity', event.target.value)} className={fieldClass}>
                      <option value="unknown">No determinada</option><option value="none">Sin daño visible</option><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option>
                    </select>
                  </label>
                  <label className={labelClass}>Síntomas observados <span className="font-normal text-[#788477]">(uno por línea)</span>
                    <textarea rows={2} maxLength={3000} value={draft.detected_symptoms} onChange={(event) => updateDraft(item.id, 'detected_symptoms', event.target.value)} className={fieldClass} placeholder="Manchas, marchitez…" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={labelClass}>Acciones preventivas <span className="font-normal text-[#788477]">(una por línea)</span>
                      <textarea rows={3} maxLength={3000} value={draft.recommended_preventive_actions} onChange={(event) => updateDraft(item.id, 'recommended_preventive_actions', event.target.value)} className={fieldClass} />
                    </label>
                    <label className={labelClass}>Acciones correctivas <span className="font-normal text-[#788477]">(una por línea)</span>
                      <textarea rows={3} maxLength={3000} value={draft.recommended_corrective_actions} onChange={(event) => updateDraft(item.id, 'recommended_corrective_actions', event.target.value)} className={fieldClass} />
                    </label>
                  </div>
                  <label className={labelClass}>Seguimiento sugerido
                    <textarea rows={2} maxLength={1000} value={draft.follow_up_instructions} onChange={(event) => updateDraft(item.id, 'follow_up_instructions', event.target.value)} className={fieldClass} placeholder="Cuándo volver a revisar o qué información solicitar." />
                  </label>
                  <label className="flex items-start gap-3 text-sm leading-5 text-[#34473a]">
                    <input type="checkbox" checked={draft.expert_inspection_recommended} onChange={(event) => updateDraft(item.id, 'expert_inspection_recommended', event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#244b34]" />
                    Recomendar inspección por un especialista agrícola (obligatoria para severidad alta o crítica).
                  </label>
                  <button disabled={busyId !== null || !item.image_url} className="w-full rounded-xl bg-[#244b34] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-not-allowed disabled:opacity-50">
                    {busyId === item.id ? 'Guardando revisión…' : 'Guardar revisión humana'}
                  </button>
                </form>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}


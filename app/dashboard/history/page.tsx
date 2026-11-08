import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isMockProvider } from '@/lib/models/registry'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'

type AnalysisRow = {
  id: string
  plant_image_id: string
  status: string
  model_provider: string | null
  model_version: string | null
  confidence_score: number | null
  detected_symptoms: string[] | null
  potential_explanations: string[] | null
  recommended_preventive_actions: string[] | null
  recommended_corrective_actions: string[] | null
  follow_up_instructions: string | null
  expert_inspection_recommended: boolean | null
  estimated_severity: string | null
  general_health_assessment: string | null
  error_message: string | null
  submitted_at: string
  completed_at: string | null
}

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'En proceso',
  completed: 'Completada',
  failed: 'No completada',
}

/** Severity chip presentation — farmer-friendly health-status wording.
 * Maps model output onto the responsible-diagnosis vocabulary:
 * Sana (healthy) / Potencialmente enferma (potentially unhealthy) /
 * Resultado incierto (uncertain) — never a definitive diagnosis. */
const severityLabels: Record<string, { label: string; className: string }> = {
  none: { label: 'Sana · sin señales de enfermedad', className: 'bg-[#eaf4e4] text-[#3f6948]' },
  low: { label: 'Potencialmente enferma · severidad baja', className: 'bg-[#f2f6e8] text-[#5b6f34]' },
  medium: { label: 'Potencialmente enferma · severidad media', className: 'bg-[#fdf3df] text-[#8a6420]' },
  high: { label: 'Potencialmente enferma · severidad alta', className: 'bg-red-50 text-red-700' },
  critical: { label: 'Potencialmente enferma · severidad crítica', className: 'bg-red-100 text-red-800' },
  unknown: { label: 'Resultado incierto · severidad no determinada', className: 'bg-[#eef1ee] text-[#5d6a5f]' },
}

/** Confidence presentation: percentage plus an honest low-certainty course of action. */
function confidencePresentation(score: number | null): { text: string; lowCertainty: boolean } | null {
  if (score === null || Number.isNaN(score)) return null
  const percent = Math.round(score * 100)
  return {
    text: `Certeza del resultado: ${percent}%`,
    lowCertainty: percent < 60,
  }
}

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const { data: rows, error } = await supabase
    .from('analyses')
    .select('id, plant_image_id, status, model_provider, model_version, confidence_score, estimated_severity, general_health_assessment, detected_symptoms, potential_explanations, recommended_preventive_actions, recommended_corrective_actions, follow_up_instructions, expert_inspection_recommended, error_message, submitted_at, completed_at')
    .order('submitted_at', { ascending: false })
    .limit(100)
  const analyses: AnalysisRow[] = rows ?? []
  const imageIds = [...new Set(analyses.map((analysis) => analysis.plant_image_id))]
  const { data: images } = imageIds.length
    ? await supabase.from('plant_images').select('id, plant_id, filename, storage_bucket, storage_path').in('id', imageIds)
    : { data: [] }
  const imageRows = images ?? []
  const plantIds = [...new Set(imageRows.map((image) => image.plant_id))]
  const { data: plants } = plantIds.length
    ? await supabase.from('plants').select('id, name').in('id', plantIds)
    : { data: [] }
  const signedResult = imageRows.length
    ? await supabase.storage.from('plant-images').createSignedUrls(imageRows.map((image) => image.storage_path), 3600)
    : { data: [] }
  const imageById = new Map(imageRows.map((image) => [image.id, image]))
  const plantById = new Map((plants ?? []).map((plant) => [plant.id, plant]))
  const signedByPath = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]))

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Historial</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/submit" className="text-sm font-semibold text-[#4e7252] hover:underline">Nueva fotografía</Link>
            <SignOutButton />
          </div>
        </header>
        <section className="py-10">
          <Link href="/dashboard" className="text-sm font-semibold text-[#4e7252] hover:underline">← Volver al panel</Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Historial de evaluaciones</h1>
          <p className="mt-2 max-w-3xl leading-7 text-[#68766b]">Tus fotografías y el estado de cada evaluación.</p>
        </section>

        <div className="mb-6 rounded-2xl border border-[#eadfc9] bg-[#fbf6ea] p-4 text-sm leading-6 text-[#725b2f]">
          Cada fotografía se evalúa de forma automática y su resultado se muestra aquí con un nivel de certeza.
          Mientras el modelo definitivo de cada cultivo se integra, algunas evaluaciones provienen de un modelo de
          prueba y aparecen claramente marcadas como <strong>resultados simulados</strong>. Estas evaluaciones son
          orientativas: no sustituyen la revisión de un administrador ni la consulta con un especialista agrícola.
        </div>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">No se pudo cargar el historial.</p> : analyses.length === 0 ? <div className="rounded-3xl border border-dashed border-[#cbd6c9] bg-white/70 p-8 text-center"><p className="font-medium text-[#34473a]">Aún no tienes evaluaciones</p><Link href="/dashboard/submit" className="mt-4 inline-block text-sm font-semibold text-[#4e7252] hover:underline">Enviar una fotografía →</Link></div> : <ul className="grid gap-5 md:grid-cols-2">{analyses.map((analysis) => {
          const image = imageById.get(analysis.plant_image_id)
          const plant = image ? plantById.get(image.plant_id) : null
          const imageUrl = image ? signedByPath.get(image.storage_path) : null
          return <li key={analysis.id} className="overflow-hidden rounded-3xl border border-[#e0e7dc] bg-white shadow-sm">
            {imageUrl && <Image src={imageUrl} alt={image?.filename ?? 'Fotografía de una planta'} width={900} height={600} unoptimized className="h-56 w-full bg-[#f3f5f0] object-cover" />}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[#26392c]">{plant?.name ?? 'Planta'}</h2><p className="mt-1 text-sm text-[#68766b]">{image?.filename ?? 'Fotografía'}</p></div><span className="rounded-full bg-[#f3f0e6] px-3 py-1 text-xs font-semibold text-[#725b2f]">{statusLabels[analysis.status] ?? analysis.status}</span></div>
              <p className="mt-4 text-xs text-[#8a978a]">Enviada el {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(analysis.submitted_at))}</p>
              {analysis.status === 'completed' && (() => {
                const confidence = confidencePresentation(analysis.confidence_score)
                const severity = analysis.estimated_severity ? severityLabels[analysis.estimated_severity] ?? severityLabels.unknown : null
                const isMock = isMockProvider(analysis.model_provider)
                return <div className="mt-4 space-y-3 rounded-xl bg-[#edf4e9] p-4 text-sm leading-6 text-[#34473a]">
                  {isMock && <p className="font-semibold text-[#a05a13]">⚠️ Resultado simulado — generado por un modelo de prueba, no por el modelo real de diagnóstico.</p>}
                  {analysis.model_provider === 'human-review' && <p className="font-semibold text-[#3f6948]">Revisión humana · no es un diagnóstico automático</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {severity && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severity.className}`}>{severity.label}</span>}
                    {confidence && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#34473a]" title={`Modelo ${analysis.model_provider ?? 'desconocido'} ${analysis.model_version ?? ''}`}>{confidence.text}</span>}
                  </div>
                  {confidence?.lowCertainty && <p className="text-xs font-medium text-[#725b2f]">Certeza baja: toma una nueva fotografía en mejor iluminación antes de tomar decisiones.</p>}
                  {analysis.general_health_assessment && <p>{analysis.general_health_assessment}</p>}
                {!!analysis.detected_symptoms?.length && <div><p className="font-semibold">Observaciones</p><ul className="list-disc pl-5">{analysis.detected_symptoms.map((item, index) => <li key={`symptom-${index}`}>{item}</li>)}</ul></div>}
                {!!analysis.potential_explanations?.length && <div><p className="font-semibold">Posibles explicaciones</p><ul className="list-disc pl-5">{analysis.potential_explanations.map((item, index) => <li key={`explanation-${index}`}>{item}</li>)}</ul></div>}
                {!!analysis.recommended_preventive_actions?.length && <div><p className="font-semibold">Acciones preventivas</p><ul className="list-disc pl-5">{analysis.recommended_preventive_actions.map((item, index) => <li key={`preventive-${index}`}>{item}</li>)}</ul></div>}
                {!!analysis.recommended_corrective_actions?.length && <div><p className="font-semibold">Acciones correctivas</p><ul className="list-disc pl-5">{analysis.recommended_corrective_actions.map((item, index) => <li key={`corrective-${index}`}>{item}</li>)}</ul></div>}
                {analysis.follow_up_instructions && <p><span className="font-semibold">Seguimiento:</span> {analysis.follow_up_instructions}</p>}
                {analysis.expert_inspection_recommended && <p className="font-semibold text-[#725b2f]">Se recomienda consultar a un especialista agrícola.</p>}
                <p className="text-xs text-[#8a978a]">Evaluación orientativa; confirma decisiones importantes con un especialista.</p>
              </div>})()}
              {(analysis.status === 'pending' || analysis.status === 'processing') && <p className="mt-4 rounded-xl bg-[#f3f6f2] p-4 text-sm leading-6 text-[#5d6a5f]">La evaluación automática está en proceso. Actualiza esta página en unos segundos para ver el resultado.</p>}
              {analysis.status === 'failed' && analysis.error_message && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{analysis.error_message}</p>}
            </div>
          </li>
        })}</ul>}
      </div>
    </main>
  )
}


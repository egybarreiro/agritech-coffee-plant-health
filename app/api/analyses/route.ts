import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getFarmerContext } from '@/lib/supabase/farmer'
import { readBoundedJson } from '@/lib/http/read-bounded-json'
import { createServiceClient } from '@/lib/supabase/service'
import { runPendingAnalysisPipeline } from '@/lib/models/pipeline'

const createAnalysisSchema = z.object({ plant_image_id: z.string().uuid() })

export async function GET() {
  const auth = await getFarmerContext()
  if ('response' in auth) return auth.response

  const { data: analyses, error } = await auth.supabase
    .from('analyses')
    .select('id, plant_image_id, status, model_provider, confidence_score, estimated_severity, general_health_assessment, detected_symptoms, potential_explanations, recommended_preventive_actions, recommended_corrective_actions, follow_up_instructions, expert_inspection_recommended, error_message, submitted_at, completed_at')
    .order('submitted_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: 'No se pudo cargar el historial.' }, { status: 500 })
  if (!analyses?.length) return NextResponse.json({ analyses: [] })

  const imageIds = [...new Set(analyses.map((analysis) => analysis.plant_image_id))]
  const { data: images, error: imageError } = await auth.supabase
    .from('plant_images')
    .select('id, plant_id, filename, storage_bucket, storage_path, submitted_at')
    .in('id', imageIds)

  if (imageError) return NextResponse.json({ error: 'No se pudo cargar el historial.' }, { status: 500 })
  const imageRows = images ?? []
  const plantIds = [...new Set(imageRows.map((image) => image.plant_id))]
  const { data: plants, error: plantError } = plantIds.length
    ? await auth.supabase.from('plants').select('id, name').in('id', plantIds)
    : { data: [], error: null }

  if (plantError) return NextResponse.json({ error: 'No se pudo cargar el historial.' }, { status: 500 })
  const [signedResult] = imageRows.length
    ? await Promise.all([auth.supabase.storage.from('plant-images').createSignedUrls(imageRows.map((image) => image.storage_path), 3600)])
    : [{ data: [], error: null }]

  const imageById = new Map(imageRows.map((image) => [image.id, image]))
  const plantById = new Map((plants ?? []).map((plant) => [plant.id, plant]))
  const signedByPath = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]))

  return NextResponse.json({
    analyses: analyses.map((analysis) => {
      const image = imageById.get(analysis.plant_image_id)
      const plant = image ? plantById.get(image.plant_id) : null
      return {
        ...analysis,
        filename: image?.filename ?? null,
        image_url: image ? signedByPath.get(image.storage_path) ?? null : null,
        plant_name: plant?.name ?? null,
      }
    }),
  })
}

export async function POST(request: Request) {
  const auth = await getFarmerContext()
  if ('response' in auth) return auth.response

  const body = await readBoundedJson(request)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'La solicitud supera el tamaño permitido.' : 'La solicitud no tiene un formato válido.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    )
  }
  const parsed = createAnalysisSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: 'La imagen no es válida.' }, { status: 400 })

  const { data: image, error: imageError } = await auth.supabase
    .from('plant_images')
    .select('id')
    .eq('id', parsed.data.plant_image_id)
    .eq('submitted_by', auth.user.id)
    .maybeSingle()

  if (imageError) return NextResponse.json({ error: 'No se pudo verificar la fotografía.' }, { status: 500 })
  if (!image) return NextResponse.json({ error: 'No se encontró esa fotografía en tu cuenta.' }, { status: 404 })

  const { data: existing, error: existingError } = await auth.supabase
    .from('analyses')
    .select('id, status, submitted_at')
    .eq('plant_image_id', image.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) return NextResponse.json({ error: 'No se pudo consultar el estado de la evaluación.' }, { status: 500 })
  if (existing) return NextResponse.json({ analysis: existing, status: 'existing' })

  const { data: analysis, error: insertError } = await auth.supabase
    .from('analyses')
    .insert({ plant_image_id: image.id, status: 'pending' })
    .select('id, status, submitted_at')
    .single()

  if (insertError || !analysis) {
    return NextResponse.json({ error: 'La fotografía se guardó, pero la evaluación no pudo registrarse.' }, { status: 500 })
  }

  // Run the model-inference pipeline for the freshly created pending row.
  // Writes go through the service-role client (farmers cannot UPDATE
  // analyses); a failure only flips the row to `failed` — never the request.
  const outcome = await runPendingAnalysisPipeline(createServiceClient(), analysis.id)
  const finalAnalysis =
    outcome.status === 'completed' || outcome.status === 'failed'
      ? { ...analysis, status: outcome.status }
      : analysis

  return NextResponse.json({ analysis: finalAnalysis, status: 'created' }, { status: 202 })
}

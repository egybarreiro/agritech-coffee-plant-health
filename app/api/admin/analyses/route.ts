import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { adminAnalysisReviewSchema, toAnalysisUpdate } from '@/lib/admin/analysis-review'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { createServiceClient } from '@/lib/supabase/service'
import { readBoundedJson } from '@/lib/http/read-bounded-json'

export async function GET() {
  const auth = await getAdminContext()
  if ('response' in auth) return auth.response

  const { data: analyses, error: analysesError } = await auth.supabase
    .from('analyses')
    .select('id, plant_image_id, status, submitted_at')
    .in('status', ['pending', 'processing'])
    .order('submitted_at', { ascending: true })
    .limit(100)

  if (analysesError) return NextResponse.json({ error: 'No se pudo cargar la cola de revisión.' }, { status: 500 })
  if (!analyses?.length) return NextResponse.json({ analyses: [] })

  const imageIds = [...new Set(analyses.map((analysis) => analysis.plant_image_id))]
  const analysisIds = analyses.map((analysis) => analysis.id)
  const [imagesResult, leafImagesResult] = await Promise.all([
    auth.supabase
      .from('plant_images')
      .select('id, plant_id, submitted_by, storage_bucket, storage_path, filename, mime_type, submitted_at')
      .in('id', imageIds),
    // Complementary leaf-detail close-ups attached to an assessment
    // (coffee two-photo submissions; see plant_images.analysis_id).
    auth.supabase
      .from('plant_images')
      .select('id, analysis_id, storage_bucket, storage_path, filename, mime_type, image_role')
      .in('analysis_id', analysisIds)
      .eq('image_role', 'leaf_details'),
  ])

  const { data: images, error: imagesError } = imagesResult
  const { data: leafImages, error: leafImagesError } = leafImagesResult
  if (imagesError || leafImagesError) return NextResponse.json({ error: 'No se pudieron cargar las fotografías.' }, { status: 500 })
  const imageRows = images ?? []
  const leafRows = (leafImages ?? []).filter((row) => row.analysis_id !== null)
  const plantIds = [...new Set(imageRows.map((image) => image.plant_id))]
  const farmerIds = [...new Set(imageRows.map((image) => image.submitted_by))]

  const [plantResult, farmerResult, cropResult] = await Promise.all([
    plantIds.length
      ? auth.supabase.from('plants').select('id, name, crop_id').in('id', plantIds)
      : Promise.resolve({ data: [], error: null }),
    farmerIds.length
      ? auth.supabase.from('profiles').select('id, full_name').in('id', farmerIds)
      : Promise.resolve({ data: [], error: null }),
    auth.supabase.from('crops').select('id, name'),
  ])

  if (plantResult.error || farmerResult.error || cropResult.error) {
    return NextResponse.json({ error: 'No se pudieron cargar los datos relacionados.' }, { status: 500 })
  }

  const paths = [
    ...imageRows.filter((image) => image.storage_bucket === 'plant-images').map((image) => image.storage_path),
    ...leafRows.filter((image) => image.storage_bucket === 'plant-images').map((image) => image.storage_path),
  ]
  const signedResult = paths.length
    ? await auth.supabase.storage.from('plant-images').createSignedUrls(paths, 3600)
    : { data: [], error: null }
  if (signedResult.error) return NextResponse.json({ error: 'No se pudieron generar enlaces privados para las fotos.' }, { status: 500 })

  const imageById = new Map(imageRows.map((image) => [image.id, image]))
  const plantById = new Map((plantResult.data ?? []).map((plant) => [plant.id, plant]))
  const farmerById = new Map((farmerResult.data ?? []).map((farmer) => [farmer.id, farmer]))
  const cropById = new Map((cropResult.data ?? []).map((crop) => [crop.id, crop]))
  const signedByPath = new Map((signedResult.data ?? []).map((item) => [item.path, item.signedUrl]))
  // Group the complementary close-ups per assessment so the admin can view
  // the full-plant framing photo separately from the leaf evidence.
  type LeafImageSummary = { id: string; image_url: string | null; filename: string; mime_type: string }
  const leafByAnalysisId = new Map<string, LeafImageSummary[]>(
    leafRows.map((row) => [row.analysis_id, [] as LeafImageSummary[]]),
  )
  for (const row of leafRows) {
    leafByAnalysisId.get(row.analysis_id)?.push({
      id: row.id,
      image_url: row.storage_bucket === 'plant-images' ? signedByPath.get(row.storage_path) ?? null : null,
      filename: row.filename,
      mime_type: row.mime_type,
    })
  }

  return NextResponse.json({
    analyses: analyses.map((analysis) => {
      const image = imageById.get(analysis.plant_image_id)
      const plant = image ? plantById.get(image.plant_id) : null
      const farmer = image ? farmerById.get(image.submitted_by) : null
      const crop = plant ? cropById.get(plant.crop_id) : null
      return {
        ...analysis,
        filename: image?.filename ?? null,
        mime_type: image?.mime_type ?? null,
        image_url: image?.storage_bucket === 'plant-images' ? signedByPath.get(image.storage_path) ?? null : null,
        plant_name: plant?.name ?? null,
        crop_name: crop?.name ?? null,
        farmer_name: farmer?.full_name ?? null,
        leaf_images: leafByAnalysisId.get(analysis.id) ?? [],
      }
    }),
  })
}

export async function PATCH(request: Request) {
  const auth = await getAdminContext()
  if ('response' in auth) return auth.response

  const body = await readBoundedJson(request)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === 'too-large' ? 'La solicitud supera el tamaño permitido.' : 'La solicitud no tiene un formato válido.' },
      { status: body.reason === 'too-large' ? 413 : 400 },
    )
  }

  const parsed = adminAnalysisReviewSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Completa la revisión y el seguimiento requerido para severidad alta o crítica.' }, { status: 400 })
  }

  const completedAt = new Date().toISOString()
  const serviceClient = createServiceClient()
  const { data: analysis, error } = await serviceClient
    .from('analyses')
    .update(toAnalysisUpdate(parsed.data, completedAt))
    .eq('id', parsed.data.analysis_id)
    .in('status', ['pending', 'processing'])
    .select('id, status, completed_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'No se pudo guardar la revisión.' }, { status: 500 })
  if (!analysis) return NextResponse.json({ error: 'La revisión ya se completó o el registro no existe.' }, { status: 409 })

  let auditWarning = false
  try {
    await createAuditLog(serviceClient, auth.user.id, 'analysis.human_review_completed', 'analyses', analysis.id, {
      provider: 'human-review',
      severity: parsed.data.estimated_severity,
    })
  } catch {
    auditWarning = true
    console.error('Could not write audit log for completed human analysis review')
  }

  return NextResponse.json({ analysis, audit_warning: auditWarning })
}

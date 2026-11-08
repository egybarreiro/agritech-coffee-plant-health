import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getFarmerContext } from '@/lib/supabase/farmer'
import { createServiceClient } from '@/lib/supabase/service'
import { hasMatchingImageSignature } from '@/lib/images/validation'
import { readBodyWithinLimit } from '@/lib/http/read-limited-body'
import { runPendingAnalysisPipeline } from '@/lib/models/pipeline'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 256 * 1024
const BUCKET = 'plant-images'
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const plantIdSchema = z.string().uuid()
// Optional photo role: 'full_plant' is the assessment's framing photo and
// keeps the existing flow (whole coffee plant). 'leaf_details' is
// a complementary close-up that attaches to an existing assessment without
// creating a new one (required for the coffee two-photo submission).
const imageRoleSchema = z.enum(['full_plant', 'leaf_details']).optional()
const analysisIdSchema = z.string().uuid()

export async function POST(request: Request) {
  const auth = await getFarmerContext()
  if ('response' in auth) return auth.response

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
    }
  }

  const readResult = await readBodyWithinLimit(request.body, MAX_REQUEST_BYTES)
  if (!readResult.ok && readResult.reason === 'too-large') {
    return NextResponse.json({ error: 'La solicitud supera el tamaño permitido.' }, { status: 413 })
  }
  if (!readResult.ok) {
    return NextResponse.json({ error: 'No se pudo leer el archivo enviado.' }, { status: 400 })
  }

  let formData: FormData
  try {
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: new Blob([readResult.body.buffer as ArrayBuffer]),
    })
    formData = await boundedRequest.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo enviado.' }, { status: 400 })
  }

  const plantId = plantIdSchema.safeParse(formData.get('plant_id'))
  const imageRole = imageRoleSchema.safeParse(
    // Absent field stays "optional default"; an empty string also means the
    // historical default so older clients keep working unchanged.
    formData.get('image_role') || undefined,
  )
  // 'leaf_details' attachments must reference the assessment (analysis) they
  // belong to; 'full_plant' never receives one at insert time — its analysis
  // is created after this image row exists (unchanged pipeline trigger).
  const analysisId = analysisIdSchema.safeParse(formData.get('analysis_id') || undefined)
  const file = formData.get('file')

  if (!plantId.success || !imageRole.success || !(file instanceof File)) {
    return NextResponse.json({ error: 'Selecciona una planta y una fotografía.' }, { status: 400 })
  }
  if (imageRole.data === 'leaf_details' && !analysisId.success) {
    // A leaf close-up is complementary evidence: it must reference the
    // assessment (analysis) created for its full-plant photo.
    return NextResponse.json({ error: 'Falta el registro de evaluación para el primer plano de hojas.' }, { status: 409 })
  }
  if (!extensions[file.type] || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Usa una imagen JPEG, PNG o WebP de hasta 10 MB.' }, { status: 400 })
  }
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (!hasMatchingImageSignature(file.type, signature)) {
    return NextResponse.json({ error: 'El contenido no coincide con el formato de imagen indicado.' }, { status: 400 })
  }

  const { data: plant, error: plantError } = await auth.supabase
    .from('plants')
    .select('id')
    .eq('id', plantId.data)
    .eq('farmer_id', auth.user.id)
    .maybeSingle()

  if (plantError) return NextResponse.json({ error: 'No se pudo verificar la planta.' }, { status: 500 })
  if (!plant) return NextResponse.json({ error: 'No se encontró esa planta en tu cuenta.' }, { status: 404 })

  const filename = file.name.replace(/[/\\]/g, '_').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || `photo.${extensions[file.type]}`
  const storagePath = `${auth.user.id}/${plant.id}/${crypto.randomUUID()}.${extensions[file.type]}`

  // --------------------------------------------------------------------
  // Leaf details: attach evidence to an EXISTING assessment.
  // No analysis row is created and the inference pipeline is not re-run —
  // the assessment already exists for the 'full_plant' framing photo.
  // --------------------------------------------------------------------
  if (imageRole.data === 'leaf_details') {
    const serviceClient = createServiceClient()

    const { data: linkedAnalysis, error: linkedAnalysisError } = await serviceClient
      .from('analyses')
      .select('id, plant_image_id')
      .eq('id', analysisId.data ?? '')
      .maybeSingle()
    if (linkedAnalysisError) return NextResponse.json({ error: 'No se pudo verificar la evaluación.' }, { status: 500 })
    if (!linkedAnalysis) {
      return NextResponse.json({ error: 'No se encontró la evaluación para asociar la fotografía.' }, { status: 404 })
    }

    // Ownership chain: analysis → its primary 'full_plant' image → the same
    // plant the farmer claims. The service client bypasses RLS, so ownership
    // is verified explicitly (the farmer's plant was already authenticated
    // above; equality ties the linked analysis to that same plant).
    const { data: primaryImage, error: primaryImageError } = await serviceClient
      .from('plant_images')
      .select('id, plant_id, image_role')
      .eq('id', linkedAnalysis.plant_image_id)
      .maybeSingle()
    if (primaryImageError) return NextResponse.json({ error: 'No se pudo verificar la evaluación.' }, { status: 500 })
    if (!primaryImage || primaryImage.image_role !== 'full_plant' || primaryImage.plant_id !== plant.id) {
      return NextResponse.json({ error: 'La evaluación indicada no corresponde a esa planta.' }, { status: 403 })
    }

    const { error: leafUploadError } = await auth.supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false })
    if (leafUploadError) {
      return NextResponse.json({ error: 'No se pudo guardar la fotografía. Verifica que el almacenamiento esté configurado.' }, { status: 500 })
    }

    const { data: image, error: imageError } = await auth.supabase
      .from('plant_images')
      .insert({
        plant_id: plant.id,
        submitted_by: auth.user.id,
        storage_bucket: BUCKET,
        storage_path: storagePath,
        filename,
        mime_type: file.type,
        size_bytes: file.size,
        image_role: 'leaf_details',
        // One assessment, many complementary photos: every leaf close-up of
        // this submission points at the SAME analysis id.
        analysis_id: linkedAnalysis.id,
      })
      .select('id, plant_id, filename, mime_type, size_bytes, submitted_at')
      .single()

    if (imageError || !image) {
      // Storage and PostgreSQL do not share an atomic transaction: attempt
      // compensating cleanup with the service-role client only (the farmer's
      // Storage DELETE policy is gone since migration 005).
      const { error: cleanupError } = await serviceClient.storage
        .from(BUCKET)
        .remove([storagePath])
      if (cleanupError) {
        console.error(
          'Failed to remove the uploaded storage object after leaf-detail plant_images insert failed:',
          cleanupError.message,
        )
      }
      return NextResponse.json({ error: 'La fotografía no pudo registrarse.' }, { status: 500 })
    }

    // Deliberately no analysis INSERT and no pipeline run here: retrying a
    // failed leaf upload can therefore never create duplicate assessment
    // records.
    return NextResponse.json({
      image,
      analysis: null,
      linked_analysis_id: linkedAnalysis.id,
      warning: undefined,
    }, { status: 201 })
  }

  // --------------------------------------------------------------------
  // Full plant: primary flow of the coffee two-photo submission —
  // storage upload, metadata insert, server-controlled
  // analysis creation, inference pipeline.
  // --------------------------------------------------------------------
  const { error: uploadError } = await auth.supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: 'No se pudo guardar la fotografía. Verifica que el almacenamiento esté configurado.' }, { status: 500 })
  }

  const { data: image, error: imageError } = await auth.supabase
    .from('plant_images')
    .insert({
      plant_id: plant.id,
      submitted_by: auth.user.id,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      filename,
      mime_type: file.type,
      size_bytes: file.size,
      image_role: 'full_plant',
    })
    .select('id, plant_id, filename, mime_type, size_bytes, submitted_at')
    .single()

  if (imageError || !image) {
    // Storage and PostgreSQL do not share an atomic transaction: the object was
    // uploaded successfully, so attempt compensating cleanup before responding.
    // This deletion must use the server-only service-role client: migration 005
    // intentionally removed the farmer Storage DELETE policy, so the farmer's
    // SSR client can no longer delete. The cleanup is scoped to the exact
    // storagePath generated above from the authenticated farmer identity —
    // never a client-supplied path and never other farmer operations.
    const { error: cleanupError } = await createServiceClient()
      .storage
      .from(BUCKET)
      .remove([storagePath])
    if (cleanupError) {
      // Never expose secrets or internal details — log for operator triage only.
      console.error(
        'Failed to remove the uploaded storage object after plant_images insert failed:',
        cleanupError.message,
      )
    }
    return NextResponse.json({ error: 'La fotografía no pudo registrarse.' }, { status: 500 })
  }

  // Server-controlled analysis creation: the service-role client is used only
  // here, for the analyses INSERT. Status and all result fields are fixed
  // server-side; the farmer can never choose status, confidence scores, model
  // results, model identifiers, or any other analysis field. All other columns
  // fall back to safe database defaults (empty JSON arrays, pending state).
  const serviceClient = createServiceClient()
  const { data: analysis, error: analysisError } = await serviceClient
    .from('analyses')
    .insert({ plant_image_id: image.id, status: 'pending' })
    .select('id, status, submitted_at')
    .single()

  if (analysisError) {
    // The image and its metadata are valid records — keep them and surface a
    // warning in the existing response contract. Do not remove the uploaded
    // object; deleting Storage here would leave orphan database rows.
    console.error(
      'Failed to create the pending analysis record for the uploaded image:',
      analysisError.message,
    )
    return NextResponse.json({
      image,
      analysis: null,
      warning: 'La fotografía se guardó, pero no se pudo crear su evaluación.',
    }, { status: 201 })
  }

  // Run the model-inference pipeline (pending → processing → completed/failed).
  // The pipeline never throws and never exposes internal errors to the farmer;
  // a failure only degrades the response with a warning below. The inline,
  // synchronous execution is intentional for the current model contract: mock
  // inference is fast, and real adapters may swap this trigger point for a
  // queue/worker without changing the pipeline itself.
  const outcome = await runPendingAnalysisPipeline(serviceClient, analysis.id)
  const warning = outcome.status === 'failed'
    ? 'La fotografía se guardó, pero la evaluación automática no pudo completarse. Revisa el historial para más detalles.'
    : undefined

  // The recorded analysis row reflects its pre-pipeline insert state; report
  // the pipeline's actual outcome so the caller sees the true final status.
  const finalAnalysis =
    outcome.status === 'completed' || outcome.status === 'failed'
      ? { ...analysis, status: outcome.status }
      : analysis

  return NextResponse.json({
    image,
    analysis: finalAnalysis,
    warning,
  }, { status: 201 })
}

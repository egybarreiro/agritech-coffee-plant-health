import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapterForCrop, isMockProvider } from './registry'
import { sanitizePrediction } from './sanitize'
import type { PlantModelPrediction } from './types'

/**
 * Inference pipeline: drives one `analyses` row through the schema status
 * machine (pending → processing → completed | failed) and persists the
 * standardized prediction of the crop's registered model.
 *
 * Guarantees:
 * - Only transitions rows that are exactly `pending` (the `processing` claim
 *   is a conditional UPDATE, so two workers can never both claim a row and a
 *   row already completed/failed by another worker is left untouched).
 * - ALL writes run through the service-role client passed by the caller:
 *   RLS (migrations 004/005) intentionally denies farmers UPDATE on analyses.
 * - Model output is sanitized (`sanitizePrediction`) before persisting — the
 *   model layer is treated as an untrusted input at the database trust
 *   boundary.
 * - Failures never expose internal error text to farmers: the stored
 *   `error_message` is a fixed farmer-friendly sentence; the raw cause is
 *   only logged server-side for operators.
 * - The caller decides when to run this (currently inline right after the
 *   `pending` insert; with a slow real model the same call can be moved to a
 *   queue/worker without any other change).
 */

export type PipelineOutcome = {
  status: 'completed' | 'failed' | 'skipped'
  /** Provider id persisted (starts with 'mock-' for placeholder models). */
  modelProvider?: string
  /** Convenience flag mirroring `registry.isMockProvider`. */
  isMock?: boolean
  /** Internal reason for 'skipped'; never shown to farmers. */
  reason?: string
}

type DbError = { message: string } | null

const GENERIC_FAILURE_MESSAGE =
  'La evaluación automática no pudo completarse. La unidad quedó registrada; podrás reintentarla o solicitar su revisión.'

/**
 * Marks the analysis `failed` with a FIXED farmer-facing message: internal
 * causes are logged server-side and never written to `error_message`.
 */
async function markFailed(client: SupabaseClient, analysisId: string, message: string, cause?: unknown) {
  if (cause !== undefined) {
    // Server-side operator log only — no farmer-visible details.
    console.error(`Analysis pipeline failed for analysis ${analysisId}:`, cause instanceof Error ? cause.message : cause)
  }
  try {
    await client
      .from('analyses')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId)
  } catch (updateError) {
    console.error('Could not even mark the analysis as failed:', updateError instanceof Error ? updateError.message : updateError)
  }
}

/** Runs the pending analysis to completion/failure. Never throws. */
export async function runPendingAnalysisPipeline(
  client: SupabaseClient,
  analysisId: string,
): Promise<PipelineOutcome> {
  try {
    // 1. Claim: conditional UPDATE pending → processing. A null result means
    // the row is not claimable (already processed, failed, or deleted).
    const claim = (await client
      .from('analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId)
      .eq('status', 'pending')
      .select('id, plant_image_id')
      .maybeSingle()) as { data: { id: string; plant_image_id: string } | null; error: DbError }

    if (claim.error || !claim.data) {
      return { status: 'skipped', reason: 'analysis-not-claimable' }
    }

    // 2. Image record that owns this analysis.
    const imageResult = (await client
      .from('plant_images')
      .select('id, plant_id, storage_bucket, storage_path, mime_type, filename')
      .eq('id', claim.data.plant_image_id)
      .maybeSingle()) as {
      data: { id: string; plant_id: string; storage_bucket: string | null; storage_path: string; mime_type: string | null; filename: string | null } | null
      error: DbError
    }
    const image = imageResult.data
    if (imageResult.error || !image) {
      await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, imageResult.error ?? 'plant_images row not found')
      return { status: 'failed', reason: 'image-not-found' }
    }

    // 3. Plant → crop (crops.name drives adapter selection).
    const plantResult = (await client
      .from('plants')
      .select('id, crops(name)')
      .eq('id', image.plant_id)
      .maybeSingle()) as { data: { id: string; crops: { name: string } | null } | null; error: DbError }
    const plant = plantResult.data
    if (plantResult.error || !plant) {
      await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, plantResult.error ?? 'plant row not found')
      return { status: 'failed', reason: 'plant-not-found' }
    }
    const cropName = plant.crops?.name ?? null

    // 4. Adapter resolution — the ONLY crop-specific decision in the pipeline.
    const adapter = getAdapterForCrop(cropName)
    if (!adapter) {
      await markFailed(
        client,
        analysisId,
        'Todavía no hay un modelo disponible para este cultivo. La fotografía quedó guardada y podrá revisarse más adelante.',
      )
      return { status: 'failed', reason: 'no-adapter-for-crop' }
    }

    // 5. Fetch the image bytes from Storage (same bucket the upload wrote to).
    const bucket = image.storage_bucket || 'plant-images'
    const stored = await client.storage.from(bucket).download(image.storage_path)
    if (!stored.data) {
      await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, stored.error ?? 'storage download returned null')
      return { status: 'failed', reason: 'storage-download-failed' }
    }
    const imageBytes = new Uint8Array(await stored.data.arrayBuffer())
    if (imageBytes.length === 0) {
      await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, 'storage object is empty')
      return { status: 'failed', reason: 'empty-image-bytes' }
    }

    // 6. Inference + defensive normalization before persisting.
    const prediction: PlantModelPrediction = await adapter.predict({
      imageBytes,
      mimeType: image.mime_type || 'image/jpeg',
      filename: image.filename || '',
    })
    const sanitized = sanitizePrediction(prediction)

    // 7. Persist the completed result (all values server-controlled; the
    // farmer can never influence these fields).
    const completedAt = new Date().toISOString()
    const update = await client
      .from('analyses')
      .update({
        status: 'completed',
        model_provider: adapter.id,
        model_version: adapter.version,
        confidence_score: sanitized.confidence,
        estimated_severity: sanitized.estimatedSeverity,
        general_health_assessment: sanitized.generalHealthAssessment,
        detected_symptoms: sanitized.detectedSymptoms,
        potential_explanations: sanitized.potentialExplanations ?? [],
        recommended_preventive_actions: sanitized.recommendedPreventiveActions,
        recommended_corrective_actions: sanitized.recommendedCorrectiveActions,
        follow_up_instructions: sanitized.followUpInstructions ?? null,
        expert_inspection_recommended: sanitized.expertInspectionRecommended,
        analysis_timestamp: completedAt,
        completed_at: completedAt,
        error_message: null,
      })
      .eq('id', analysisId)
    const updateError = (update as { error: DbError }).error
    if (updateError) {
      // Persist failed after a successful inference — surface as failed with
      // the generic message; the prediction is logged for operator triage.
      await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, updateError)
      return { status: 'failed', reason: 'persist-failed' }
    }

    return {
      status: 'completed',
      modelProvider: adapter.id,
      isMock: isMockProvider(adapter.id) || adapter.isMock,
    }
  } catch (caught) {
    await markFailed(client, analysisId, GENERIC_FAILURE_MESSAGE, caught)
    return { status: 'failed', reason: 'unexpected-error' }
  }
}

/**
 * Model-integration interface contract.
 *
 * These types are the single seam between the application and the coffee
 * (Coffea spp.) plant-health model, which is developed and trained
 * independently. To integrate the REAL model, implement `PlantModelAdapter`
 * (see `mock-coffee.ts` as the reference implementation)
 * and register it in `registry.ts`. Nothing else in the application needs to
 * change: the inference pipeline (`pipeline.ts`) resolves the adapter by crop
 * name and persists the standardized prediction.
 *
 * Contract rules every adapter must honor:
 * - `predict()` receives already-validated image bytes (same signature
 *   validation the upload endpoint applies) and must resolve with a complete
 *   `PlantModelPrediction` — never with a partial object.
 * - Any failure (unsupported crop state, decode error, inference crash) must
 *   be thrown; the pipeline catches it and marks the analysis `failed`.
 *   Adapters must not attempt their own database or HTTP writes.
 * - Adapters are pure with respect to storage: same input ⇒ same prediction
 *   (mocks are deterministic on purpose so demos and tests are repeatable).
 * - Confidence is a probability in the [0, 1] interval; the pipeline clamps
 *   and validates it again before persisting (defense in depth).
 */

/** Crop supported by the application schema (`crops.name` CHECK constraint): coffee only. */
export type CropName = 'coffee'

/** Severity enum — mirrors `analyses.estimated_severity` CHECK in migration 001. */
export type EstimatedSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'unknown'

/** Normalized image input handed to every adapter. */
export interface PlantModelInput {
  /** Complete image bytes, already stored in Supabase Storage. */
  imageBytes: Uint8Array
  /** Validated MIME type ('image/jpeg' | 'image/png' | 'image/webp'). */
  mimeType: string
  /** Original filename as uploaded (may be empty; for logs/filenames only). */
  filename: string
}

/**
 * Standardized prediction written into the `analyses` row. Field semantics
 * match the database columns one-to-one (Spanish strings for farmer-facing
 * text fields — the UI renders them verbatim).
 */
export interface PlantModelPrediction {
  /**
   * Internal condition key, e.g. 'healthy' or 'foliar-disease-suspected'.
   * Machine-readable; not rendered directly to farmers.
   */
  conditionKey: string
  /** Farmer-facing summary of the plant's general state (Spanish). */
  generalHealthAssessment: string
  /** Probability the model assigns to its own conclusion, in [0, 1]. */
  confidence: number
  /** Coarse severity class; 'unknown' when the model cannot grade it. */
  estimatedSeverity: EstimatedSeverity
  /** Visible symptoms observed on the image (farmer-facing, Spanish). */
  detectedSymptoms: string[]
  /** Plausible explanations for the symptoms — hypotheses, not confirmed findings. */
  potentialExplanations?: string[]
  /** Preventive actions the farmer can take (Spanish). */
  recommendedPreventiveActions: string[]
  /** Corrective actions for the detected condition (Spanish). */
  recommendedCorrectiveActions: string[]
  /** Suggested follow-up cadence or observation instructions (Spanish). */
  followUpInstructions?: string | null
  /** True when the situation warrants a professional agronomist's visit. */
  expertInspectionRecommended: boolean
}

/** A registered model implementation for one crop. */
export interface PlantModelAdapter {
  /**
   * Stable provider identifier persisted to `analyses.model_provider`.
   * Mock/placeholder adapters MUST start with 'mock-' so every consumer
   * (UI, API audits) can identify simulated results unambiguously.
   */
  id: string
  /** Version string persisted to `analyses.model_version`. */
  version: string
  /** The single crop this adapter serves. */
  crop: CropName
  /** True only for placeholder implementations with no real trained model behind them. */
  isMock: boolean
  /** Human-readable description for docs and the model registry listing. */
  description: string
  predict(input: PlantModelInput): Promise<PlantModelPrediction>
}

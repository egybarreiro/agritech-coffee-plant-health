/**
 * Validation and clamping applied to every `PlantModelPrediction` before it is
 * persisted to the `analyses` table.
 *
 * The model layer is a trust boundary: the database has CHECK constraints
 * (confidence in [0,1], severity enum) and the farmer UI renders text
 * verbatim, so the pipeline normalizes adapter output defensively instead of
 * trusting it. Also caps list sizes/lengths so a misbehaving adapter cannot
 * flood the analysis row.
 */
import type { PlantModelPrediction } from './types'

const SEVERITIES = new Set(['none', 'low', 'medium', 'high', 'critical', 'unknown'] as const)
const MAX_LIST_ITEMS = 12
const MAX_ITEM_LENGTH = 240
const MAX_TEXT_LENGTH = 600

/** Clamps a confidence value into [0, 1]; non-numeric or NaN values collapse to a conservative low score. */
export function clampConfidence(value: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0.5
  let clamped = numeric < 0 ? 0 : numeric
  if (clamped > 1) clamped = 1
  return Math.round(clamped * 1000) / 1000
}

function cleanText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
  return text
}

export function sanitizeTextList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => cleanText(item, MAX_ITEM_LENGTH))
    .filter((item) => item.length > 0)
    .slice(0, MAX_LIST_ITEMS)
}

export function sanitizePrediction(prediction: PlantModelPrediction): PlantModelPrediction {
  const severity = SEVERITIES.has(prediction.estimatedSeverity as never)
    ? prediction.estimatedSeverity
    : 'unknown'
  const conditionKey = cleanText(prediction.conditionKey, 80) || 'unknown'
  return {
    conditionKey,
    generalHealthAssessment: cleanText(prediction.generalHealthAssessment, MAX_TEXT_LENGTH),
    confidence: clampConfidence(prediction.confidence),
    estimatedSeverity: severity,
    detectedSymptoms: sanitizeTextList(prediction.detectedSymptoms),
    potentialExplanations: prediction.potentialExplanations
      ? sanitizeTextList(prediction.potentialExplanations)
      : undefined,
    recommendedPreventiveActions: sanitizeTextList(prediction.recommendedPreventiveActions),
    recommendedCorrectiveActions: sanitizeTextList(prediction.recommendedCorrectiveActions),
    followUpInstructions: prediction.followUpInstructions
      ? cleanText(prediction.followUpInstructions, MAX_TEXT_LENGTH) || null
      : null,
    expertInspectionRecommended: Boolean(prediction.expertInspectionRecommended),
  }
}

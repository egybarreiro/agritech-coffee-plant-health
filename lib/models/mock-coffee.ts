/**
 * MOCK coffee model — clearly-labeled placeholder.
 *
 * ⚠️ THIS IS NOT A TRAINED MODEL AND PRODUCES SIMULATED RESULTS.
 * `model_provider` values generated here start with 'mock-', and every UI
 * surface that renders these analyses shows a "resultado simulado" notice.
 * Purpose: let the full upload-to-prediction workflow, the results UI, and
 * the tests be exercised end-to-end while the real coffee deep-learning
 * model (developed in a separate workstream) is not yet integrated.
 *
 * Determinism: predictions derive from a hash of the image bytes, so the same
 * photograph always yields the same simulated diagnosis (repeatable demos and
 * stable tests). It intentionally spreads across healthy and one foliar
 * condition so the UI can display both confidence levels and severities.
 */
import type { PlantModelAdapter, PlantModelInput, PlantModelPrediction } from './types'
import { clampConfidence, sanitizeTextList } from './sanitize'

/** FNV-1a hash of the image bytes — stable across runtimes. */
function hashImage(imageBytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < imageBytes.length; index += 1) {
    hash ^= imageBytes[index] ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function healthyPrediction(positive: boolean, confidence: number): PlantModelPrediction {
  const sharedPreventive = [
    'Mantén un riego constante sin encharcar la zona de la raíz.',
    'Revisa el envés (parte inferior) de las hojas nuevas cada semana.',
  ]
  return {
    conditionKey: 'healthy',
    generalHealthAssessment: positive
      ? 'La planta se ve vigorosa: hojas de color verde uniforme, sin manchas, deformaciones ni caída visible.'
      : 'La planta aparenta buena salud en general, aunque la imagen no permite afirmarlo con alta certeza.',
    confidence,
    estimatedSeverity: positive ? 'none' : 'unknown',
    detectedSymptoms: [],
    potentialExplanations: positive
      ? undefined
      : ['Si la revisión visual semanal lo confirma, no hay tratamiento pendiente.'],
    recommendedPreventiveActions: sharedPreventive,
    recommendedCorrectiveActions: [],
    followUpInstructions: positive
      ? 'Repite la evaluación con una fotografía nueva cada 2 semanas para dar seguimiento.'
      : 'Toma una nueva fotografía en mejor iluminación (luz indirecta, sin sombras) para confirmar el resultado.',
    expertInspectionRecommended: false,
  }
}

function foliarConditionPrediction(confidence: number): PlantModelPrediction {
  return {
    conditionKey: 'foliar-disease-suspected',
    generalHealthAssessment:
      'Se observan lesiones foliares que podrían corresponder a una enfermedad de hoja (por ejemplo, manchas o decoloración típicas de roya o mancha de hierro en café).',
    confidence,
    estimatedSeverity: 'medium',
    detectedSymptoms: sanitizeTextList([
      'Manchas o lesiones de color amarillo a marrón en las hojas.',
      'Pequeñas zonas decoloradas agrupadas en el envés de la hoja.',
    ]),
    potentialExplanations: sanitizeTextList([
      'Posible roya del café (Hemileia vastatrix) u otra mancha foliar.',
      'Ambientes con exceso de humedad o riego por aspersión en las hojas.',
    ]),
    recommendedPreventiveActions: sanitizeTextList([
      'Mejora la ventilación alrededor de la planta y evita mojar el follaje al regar.',
      'Retira y desecha las hojas afectadas que se desprendan con facilidad.',
    ]),
    recommendedCorrectiveActions: sanitizeTextList([
      'Aísla temporalmente la unidad de otras plantas de café hasta confirmar el diagnóstico.',
      'Consulta con un técnico agrícola el uso de un fungicida adecuado antes de aplicarlo.',
    ]),
    followUpInstructions:
      'Repite la evaluación en 7 días; si las manchas avanzan a hojas nuevas, solicita una revisión presencial.',
    expertInspectionRecommended: false,
  }
}

export const mockCoffeeAdapter: PlantModelAdapter = {
  id: 'mock-coffee',
  version: 'mock-1.0.0',
  crop: 'coffee',
  isMock: true,
  description:
    'SIMULACIÓN (no es un modelo entrenado): adapta la interfaz de modelos para café hasta recibir el modelo real de café.',
  async predict(input: PlantModelInput): Promise<PlantModelPrediction> {
    if (input.imageBytes.length === 0) throw new Error('mock-coffee: empty image input')
    const hash = hashImage(input.imageBytes)
    const roll = hash % 5

    // 3/5 healthy at high certainty, 1/5 healthy with low certainty, 1/5
    // foliar condition with moderate-to-good certainty.
    if (roll <= 2) return healthyPrediction(true, clampConfidence(0.82 + (hash % 100) / 800))
    if (roll === 3) return healthyPrediction(false, clampConfidence(0.5 + (hash % 100) / 1000))
    return foliarConditionPrediction(clampConfidence(0.62 + (hash % 100) / 500))
  },
}

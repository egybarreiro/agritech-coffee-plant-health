/**
 * REAL coffee model adapter — HTTP client for the Python FastAPI inference
 * service (`model-service/`, EfficientNetB0 checkpoints).
 *
 * ⚠️ Operational status requires BOTH of these; until then this adapter is
 * dormant (the registry only selects it when `COFFEE_MODEL_ENDPOINT` is set):
 *   1. The `.keras` checkpoints transferred into `model-service/checkpoints/`.
 *   2. The FastAPI service hosted and loading them (`/health` 200).
 * This adapter must never be presented as operational before those steps —
 * the mock adapter (`mock-coffee.ts`) remains the registered fallback.
 *
 * Two-stage design (see docs/models.md):
 * - Stage 1: the service's binary health model (EfficientNetB0, single
 *   sigmoid `p_unhealthy`, Healthy=0/Unhealthy=1) evaluates the image first.
 *   Routing threshold lives in the SERVICE (env `COFFEE_UNHEALTHY_THRESHOLD`,
 *   validation-selected default 0.2244) and is echoed in every response —
 *   this adapter trusts the service's stage decision, never re-thresholds it.
 *   When `stage === 'healthy'` the four-disease classifier was NOT run and
 *   the response carries `diseases: null`; the mapping below says exactly
 *   what that means (no signs of the FOUR modeled diseases — never a claim
 *   of complete health).
 * - Stage 2 (Unhealthy only): the existing four-disease classifier output
 *   (`probabilities` for miner/rust/phoma/cercospora) is mapped through the
 *   SAME pure mapping as before (`predictionFromProbabilities`), with a
 *   stage-1 context sentence prepended to the farmer-facing assessment.
 * - THRESHOLDS here remain authoritative for stage-2 disease decisions. The
 *   service's `fired` field is informational only and is deliberately NOT
 *   consumed.
 * - Confidence rule (stage 2): if one or more thresholds fire, the highest
 *   probability among fired classes; if none fires, 1 − highest probability.
 *   Stage-1 healthy confidence is `1 − p_unhealthy`.
 * - Farmer-facing language is cautious and NON-DIAGNOSTIC: patterns detected
 *   are described as possible causes that require direct inspection; never a
 *   definitive phytopathological diagnosis.
 * - Any failure throws — the pipeline marks the analysis `failed` with a
 *   fixed farmer-safe message and logs the cause server-side. The adapter
 *   never writes to the database and never exposes a deployed URL itself.
 */
import type { EstimatedSeverity, PlantModelAdapter, PlantModelInput, PlantModelPrediction } from './types'
import { clampConfidence, sanitizeTextList } from './sanitize'

/** Sigmoid class order of the trained checkpoint — fixed by the training specs. */
export const CLASS_ORDER = ['miner', 'rust', 'phoma', 'cercospora'] as const
export type CoffeeClass = (typeof CLASS_ORDER)[number]

/**
 * Classification thresholds, applied INCLUSIVELY (probability >= threshold).
 * These are the adapter's authoritative copy — document any change here AND
 * in docs/models.md. They may intentionally differ from the service's own
 * informational copy in model-service/app/inference.py.
 */
export const THRESHOLDS: Record<CoffeeClass, number> = {
  miner: 0.31,
  rust: 0.42,
  phoma: 0.21,
  cercospora: 0.31,
}

export const COFFEE_REAL_ADAPTER_ID = 'coffee-efficientnetb0'
export const COFFEE_MODEL_VERSION = '1.0.0'

/**
 * Per-request timeout for every call to the inference service. Generous
 * because the two-stage flow can run TWO EfficientNetB0 models on CPU (and
 * the first request of each process pays TensorFlow warm-up).
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000
const MIN_TIMEOUT_MS = 250

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Error raised for every failure of the service interaction. */
export class CoffeeModelServiceError extends Error {
  readonly code:
    | 'not-configured'
    | 'network-error'
    | 'timeout'
    | 'service-error'
    | 'invalid-response'

  constructor(code: CoffeeModelServiceError['code'], message: string) {
    super(message)
    this.name = 'CoffeeModelServiceError'
    this.code = code
  }
}

/** Reads and validates the configured service base URL; null when unset. */
export function configuredCoffeeModelEndpoint(): string | null {
  const raw = (process.env.COFFEE_MODEL_ENDPOINT ?? '').trim().replace(/\/+$/, '')
  // A URL without an http(s) scheme can never be a valid service address —
  // treating it as unconfigured keeps the mock fallback active on typos.
  return /^https?:\/\/\S{2,}$/i.test(raw) ? raw : null
}

/** True only when the real model service has a configured endpoint. */
export function isCoffeeModelServiceConfigured(): boolean {
  return configuredCoffeeModelEndpoint() !== null
}

/** Configured per-request timeout in milliseconds (min-bounded, fallback on garbage). */
export function requestTimeoutMs(): number {
  const raw = (process.env.COFFEE_MODEL_SERVICE_TIMEOUT_MS ?? '').trim()
  const parsed = raw.length > 0 ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed >= MIN_TIMEOUT_MS ? parsed : DEFAULT_REQUEST_TIMEOUT_MS
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Classes whose probability meets or exceeds its threshold, in declared order. */
export function applyCoffeeThresholds(probabilities: Record<CoffeeClass, number>): CoffeeClass[] {
  return CLASS_ORDER.filter((className) => probabilities[className] >= THRESHOLDS[className])
}

/** Confidence rule (documented): max fired probability, or 1 − max when healthy. */
export function coffeeConfidence(probabilities: Record<CoffeeClass, number>, fired: CoffeeClass[]): number {
  const highest = Math.max(...CLASS_ORDER.map((className) => probabilities[className]))
  return clampConfidence(fired.length > 0 ? highest : 1 - highest)
}

// ---------------------------------------------------------------------------
// Two-stage service payload (/predict-health)
// ---------------------------------------------------------------------------

/** Parsed and validated `/predict-health` response — never trusted blind. */
export interface CoffeeHealthStageResult {
  /** Stage-1 sigmoid output: probability of Unhealthy (positive class = 1). */
  probabilityUnhealthy: number
  /** Routing threshold the SERVICE applied (echoed back; informational). */
  threshold: number
  /** 'healthy' ⇒ stage 2 was NOT run (`diseases === null`). */
  stage: 'healthy' | 'unhealthy'
  /** Four-disease output; present ONLY when the service routed to stage 2. */
  diseases: Record<CoffeeClass, number> | null
}

/**
 * Shape-validates the two-stage response. Any missing/invalid field throws
 * `invalid-response` — the pipeline then marks the analysis failed through
 * the existing error-handling mechanism. Nothing is guessed or defaulted
 * into a fake result.
 */
export function parseHealthStagePayload(payload: unknown): CoffeeHealthStageResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new CoffeeModelServiceError('invalid-response', 'Model service returned a non-JSON-object response.')
  }
  const body = payload as {
    health?: unknown
    diseases?: unknown
  }
  if (typeof body.health !== 'object' || body.health === null) {
    throw new CoffeeModelServiceError('invalid-response', 'Model service response has no "health" stage-1 block.')
  }
  const health = body.health as {
    probability_unhealthy?: unknown
    threshold?: unknown
    classification?: unknown
  }
  const probability = health.probability_unhealthy
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new CoffeeModelServiceError(
      'invalid-response',
      'Model service stage-1 "probability_unhealthy" is missing or invalid.',
    )
  }
  if (typeof health.threshold !== 'number' || !Number.isFinite(health.threshold) || health.threshold <= 0 || health.threshold >= 1) {
    throw new CoffeeModelServiceError(
      'invalid-response',
      'Model service stage-1 "threshold" is missing or invalid.',
    )
  }
  if (health.classification !== 'healthy' && health.classification !== 'unhealthy') {
    throw new CoffeeModelServiceError(
      'invalid-response',
      'Model service stage-1 "classification" is missing or invalid.',
    )
  }
  // Cross-check: the classification must agree with the probability/threshold
  // the service itself applied (inclusive boundary). A mismatch means a broken
  // service contract — refuse it instead of mapping a wrong verdict.
  const expectedStage = probability >= health.threshold ? 'unhealthy' : 'healthy'
  if (health.classification !== expectedStage) {
    throw new CoffeeModelServiceError(
      'invalid-response',
      'Model service stage-1 classification contradicts its own probability and threshold.',
    )
  }

  let diseases: Record<CoffeeClass, number> | null = null
  if (health.classification === 'unhealthy') {
    if (typeof body.diseases !== 'object' || body.diseases === null) {
      throw new CoffeeModelServiceError(
        'invalid-response',
        'Model service routed to stage 2 but returned no "diseases" block.',
      )
    }
    const rawDiseases = (body.diseases as { probabilities?: unknown }).probabilities
    if (typeof rawDiseases !== 'object' || rawDiseases === null) {
      throw new CoffeeModelServiceError(
        'invalid-response',
        'Model service stage-2 response has no "probabilities" object.',
      )
    }
    const extracted = {} as Record<CoffeeClass, number>
    for (const className of CLASS_ORDER) {
      const value = (rawDiseases as Record<string, unknown>)[className]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new CoffeeModelServiceError(
          'invalid-response',
          `Model service probability for "${className}" is missing or invalid.`,
        )
      }
      extracted[className] = value
    }
    diseases = extracted
  } else if (body.diseases !== null && body.diseases !== undefined) {
    // Healthy stage MUST carry no disease results — anything else is a
    // contract violation (the classifier was not supposed to run).
    throw new CoffeeModelServiceError(
      'invalid-response',
      'Model service claims stage "healthy" but returned disease results.',
    )
  }

  return {
    probabilityUnhealthy: probability,
    threshold: health.threshold,
    stage: health.classification,
    diseases,
  }
}

/**
 * Stage-1 'Healthy' mapping. Communicates EXACTLY what the binary model can
 * and cannot claim: no signs of the FOUR modeled diseases — never "the plant
 * is completely healthy / free of all diseases".
 */
export function twoStageHealthyPrediction(
  probabilityUnhealthy: number,
  threshold: number,
): PlantModelPrediction {
  const percentUnhealthy = (probabilityUnhealthy * 100).toFixed(1)
  const percentThreshold = (threshold * 100).toFixed(1)
  return {
    conditionKey: 'healthy',
    generalHealthAssessment:
      `El modelo de salud (etapa 1) clasificó la imagen como sana: la probabilidad de enfermedad medida ` +
      `(${percentUnhealthy}%) quedó por debajo del umbral de referencia (${percentThreshold}%), por lo que no ` +
      `detectó señales de las cuatro enfermedades incluidas en su alcance (minador de hoja, roya, mancha de ` +
      `hierro/phoma y mancha ojo de perico). Este resultado NO certifica que la planta esté completamente sana ` +
      `ni libre de toda enfermedad: plagas, deficiencias nutricionales, estrés hídrico u otros problemas fuera ` +
      `del alcance del modelo pueden estar presentes sin ser detectados. Es un resultado orientativo que no ` +
      `sustituye la inspección directa.`,
    confidence: clampConfidence(1 - probabilityUnhealthy),
    estimatedSeverity: 'none',
    detectedSymptoms: [],
    potentialExplanations: [
      `El clasificador de enfermedades (etapa 2) no se ejecutó porque la probabilidad de enfermedad (${percentUnhealthy}%) quedó por debajo del umbral.`,
      'Si tu revisión visual semanal tampoco observa cambios, no hay tratamiento pendiente por ahora.',
    ],
    recommendedPreventiveActions: sanitizeTextList(SHARED_PREVENTIVE),
    recommendedCorrectiveActions: [],
    followUpInstructions:
      'Repite la evaluación con fotografías nuevas (planta completa + primer plano de hojas) en 2 semanas para dar seguimiento.',
    expertInspectionRecommended: false,
  }
}

/** Stage-1 context sentence prepended to the stage-2 disease assessment. */
function unhealthyStageContext(probabilityUnhealthy: number, threshold: number): string {
  const percentUnhealthy = (probabilityUnhealthy * 100).toFixed(1)
  const percentThreshold = (threshold * 100).toFixed(1)
  return (
    `El modelo de salud (etapa 1) clasificó la imagen como potencialmente enferma ` +
    `(probabilidad ${percentUnhealthy}%, umbral de referencia ${percentThreshold}%), por lo que se ejecutó el ` +
    `clasificador de enfermedades (etapa 2). `
  )
}

/**
 * Cautious, non-diagnostic Spanish text per class. Each symptom is phrased as
 * a PATTERN the model matched — never a confirmed finding — and every action
 * defers the treatment decision to direct inspection / a technical advisor.
 */
const CLASS_TEXT: Record<CoffeeClass, { label: string; symptom: string; explanation: string; corrective: string }> = {
  miner: {
    label: 'minador de hoja',
    symptom: 'Se observan patrones compatibles con minado de hoja: galerías o líneas serpenteantes dentro del tejido foliar.',
    explanation: 'Posible minador de la hoja u otro insecto cuyas larvas excavan galerías dentro de las hojas del café.',
    corrective: 'Fotografía las galerías observadas y consulta con un técnico agrícola el manejo antes de aplicar cualquier producto.',
  },
  rust: {
    label: 'roya del café',
    symptom: 'Se observan patrones compatibles con roya: puntos o pústulas amarillentas a anaranjadas, típicamente en el envés de la hoja.',
    explanation: 'Posible roya del café (Hemileia vastatrix), un hongo que forma pústulas polvosas bajo la hoja; inspección directa para confirmarla.',
    corrective: 'Revisa el envés de varias hojas y consulta con un técnico agrícola el uso de un fungicida adecuado antes de aplicarlo.',
  },
  phoma: {
    label: 'mancha de hierro o phoma',
    symptom: 'Se observan patrones compatibles con mancha de hierro o phoma: manchas oscuras con borde más claro en hojas y tallos.',
    explanation: 'Posible mancha de hierro o phoma, hongos favorecidos por el exceso de humedad y las heridas del tejido.',
    corrective: 'Retira con herramienta desinfectada las hojas con lesiones y consulta el manejo con un técnico agrícola.',
  },
  cercospora: {
    label: 'mancha ojo de perico (cercosporiosis)',
    symptom: 'Se observan patrones compatibles con cercosporiosis: manchas claras con borde marrón (ojo de perico) en las hojas.',
    explanation: 'Posible mancha ojo de perico o cercosporiosis, común cuando la planta recibe poca luz o hay estrés nutricional.',
    corrective: 'Mejora la luz y la ventilación de la planta si está en interior, y consulta el manejo con un técnico agrícola.',
  },
}

const SHARED_PREVENTIVE = [
  'Riega el sustrato sin mojar el follaje y mantiene ventilación alrededor de la planta.',
  'Revisa el envés de las hojas nuevas cada semana y retira las hojas con lesiones usando una herramienta desinfectada.',
]

function healthyPrediction(probabilities: Record<CoffeeClass, number>): PlantModelPrediction {
  return {
    conditionKey: 'healthy',
    generalHealthAssessment:
      'El modelo no detectó patrones de enfermedad foliar por encima de su umbral de referencia en esta imagen. El resultado es orientativo y no sustituye la inspección directa de la planta.',
    confidence: coffeeConfidence(probabilities, []),
    estimatedSeverity: 'none',
    detectedSymptoms: [],
    potentialExplanations: [
      'Si tu revisión visual semanal tampoco observa cambios, no hay tratamiento pendiente por ahora.',
    ],
    recommendedPreventiveActions: sanitizeTextList(SHARED_PREVENTIVE),
    recommendedCorrectiveActions: [],
    followUpInstructions:
      'Repite la evaluación con fotografías nuevas (planta completa + primer plano de hojas) en 2 semanas para dar seguimiento.',
    expertInspectionRecommended: false,
  }
}

/** Pure mapping of the four probabilities into the standardized prediction. */
export function predictionFromProbabilities(probabilities: Record<CoffeeClass, number>): PlantModelPrediction {
  const fired = applyCoffeeThresholds(probabilities)
  if (fired.length === 0) return healthyPrediction(probabilities)

  const labels = fired.map((className) => CLASS_TEXT[className].label)
  return {
    conditionKey: `coffee-foliar-disease:${fired.join('+')}`,
    generalHealthAssessment:
      `El modelo detectó patrones con probabilidad superior a su umbral de referencia para: ${labels.join(', ')}. ` +
      'Estos patrones son una señal, no un diagnóstico definitivo: son posibles causas que requieren inspección directa para confirmarse.',
    confidence: coffeeConfidence(probabilities, fired),
    // Four independent sigmoids grade class probability, NOT severity — the
    // honest value here is 'unknown' while one or more patterns are suspected.
    estimatedSeverity: 'unknown' as EstimatedSeverity,
    detectedSymptoms: sanitizeTextList(fired.map((className) => CLASS_TEXT[className].symptom)),
    potentialExplanations: sanitizeTextList(fired.map((className) => CLASS_TEXT[className].explanation)),
    recommendedPreventiveActions: sanitizeTextList(SHARED_PREVENTIVE),
    recommendedCorrectiveActions: sanitizeTextList(fired.map((className) => CLASS_TEXT[className].corrective)),
    followUpInstructions:
      'Repite la evaluación con fotografías nuevas en 7 días; si las señales avanzan a hojas nuevas, solicita una revisión presencial.',
    expertInspectionRecommended: true,
  }
}

/** Readiness probe of the inference service (ops tooling, demos and tests). */
export interface CoffeeModelServiceHealth {
  endpoint: string | null
  ready: boolean
  modelVersion: string | null
  classes: string[] | null
  error: string | null
}

export async function checkCoffeeModelService(): Promise<CoffeeModelServiceHealth> {
  const endpoint = configuredCoffeeModelEndpoint()
  if (!endpoint) {
    return {
      endpoint: null,
      ready: false,
      modelVersion: null,
      classes: null,
      error: 'COFFEE_MODEL_ENDPOINT no está configurada.',
    }
  }
  try {
    const response = await fetchWithTimeout(`${endpoint}/health`, { method: 'GET' }, requestTimeoutMs())
    if (!response.ok) {
      return {
        endpoint,
        ready: false,
        modelVersion: null,
        classes: null,
        error: `El servicio del modelo respondió ${response.status} en /health (no está listo).`,
      }
    }
    const payload = (await response.json()) as { status?: unknown; model_version?: unknown; classes?: unknown }
    const ready = payload.status === 'ready'
    return {
      endpoint,
      ready,
      modelVersion: typeof payload.model_version === 'string' ? payload.model_version : null,
      classes: Array.isArray(payload.classes) ? payload.classes.filter((item): item is string => typeof item === 'string') : null,
      error: ready ? null : 'El servicio del modelo no reporta estado "ready".',
    }
  } catch (error) {
    return {
      endpoint,
      ready: false,
      modelVersion: null,
      classes: null,
      error: error instanceof Error ? `No se pudo contactar el servicio del modelo: ${error.message}` : 'No se pudo contactar el servicio del modelo.',
    }
  }
}

async function predictViaCoffeeModelService(input: PlantModelInput): Promise<PlantModelPrediction> {
  const endpoint = configuredCoffeeModelEndpoint()
  if (!endpoint) {
    throw new CoffeeModelServiceError('not-configured', 'coffee-real: COFFEE_MODEL_ENDPOINT is not configured.')
  }
  if (input.imageBytes.length === 0) throw new Error('coffee-real: empty image input')

  // The service performs decode/RGB/resize/preprocess — original bytes only.
  // Copied into a plain ArrayBuffer-backed view (satisfies Blob typing and
  // decouples the request body from the upstream storage buffer).
  const imagePart = new Uint8Array(input.imageBytes.length)
  imagePart.set(input.imageBytes)
  const form = new FormData()
  const extension = EXTENSIONS[input.mimeType] ?? 'jpg'
  form.append('file', new Blob([imagePart], { type: input.mimeType }), `imagen.${extension}`)

  let response: Response
  try {
    response = await fetchWithTimeout(`${endpoint}/predict-health`, { method: 'POST', body: form }, requestTimeoutMs())
  } catch (error) {
    if (error instanceof Error && error.message.includes('aborted')) {
      throw new CoffeeModelServiceError('timeout', `Model service timed out after ${requestTimeoutMs()}ms.`)
    }
    throw new CoffeeModelServiceError(
      'network-error',
      `Model service unreachable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new CoffeeModelServiceError(
      'service-error',
      `Model service responded ${response.status} at ${endpoint}/predict-health.`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new CoffeeModelServiceError('invalid-response', 'Model service returned a non-JSON response body.')
  }
  const stage = parseHealthStagePayload(payload)

  if (stage.stage === 'healthy') {
    return twoStageHealthyPrediction(stage.probabilityUnhealthy, stage.threshold)
  }

  // Unhealthy: the existing four-disease mapping, unchanged, with the
  // stage-1 verdict prepended so the farmer sees the binary result first.
  const diseasePrediction = predictionFromProbabilities(stage.diseases!)
  return {
    ...diseasePrediction,
    generalHealthAssessment:
      unhealthyStageContext(stage.probabilityUnhealthy, stage.threshold) + diseasePrediction.generalHealthAssessment,
  }
}

export const coffeeRealAdapter: PlantModelAdapter = {
  id: COFFEE_REAL_ADAPTER_ID,
  version: COFFEE_MODEL_VERSION,
  crop: 'coffee',
  isMock: false,
  description:
    'Modelo real de dos etapas (EfficientNetB0, 224×224, píxeles 0–255): etapa 1 — modelo binario de salud ' +
    '(Healthy/Unhealthy, umbral 0.2244 seleccionado en validación); etapa 2 (solo si es potencialmente enferma) — ' +
    'clasificador de 4 salidas sigmoide (minador, roya, phoma, cercospora) servido por el servicio de inferencia Python (FastAPI).',
  predict: predictViaCoffeeModelService,
}

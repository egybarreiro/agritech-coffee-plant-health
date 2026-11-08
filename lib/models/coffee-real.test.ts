// @vitest-environment node
//
// coffee-real is tested entirely against a MOCKED global fetch: the real
// Python model service is never contacted from the test suite. These tests
// prove the HTTP contract, threshold application, confidence rule, mapping
// into PlantModelPrediction, and every failure mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLASS_ORDER,
  CoffeeModelServiceError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  THRESHOLDS,
  checkCoffeeModelService,
  coffeeRealAdapter,
  configuredCoffeeModelEndpoint,
  isCoffeeModelServiceConfigured,
  parseHealthStagePayload,
  predictionFromProbabilities,
  requestTimeoutMs,
  twoStageHealthyPrediction,
  type CoffeeClass,
} from './coffee-real'
import type { PlantModelInput } from './types'

const ENDPOINT = 'http://127.0.0.1:8100'

beforeEach(() => {
  vi.stubEnv('COFFEE_MODEL_ENDPOINT', ENDPOINT)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function imageInput(bytes: number[] = [0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]): PlantModelInput {
  return { imageBytes: new Uint8Array(bytes), mimeType: 'image/jpeg', filename: 'hoja.jpg' }
}

function probabilitiesOf(partial: Partial<Record<CoffeeClass, number>>): Record<CoffeeClass, number> {
  return { miner: 0, rust: 0, phoma: 0, cercospora: 0, ...partial }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type FetchInit = RequestInit & { body?: unknown }

function lastFetchCall(): { url: string; init: FetchInit } {
  const fetchMock = vi.mocked(globalThis.fetch)
  const call = fetchMock.mock.calls.at(-1)!
  return { url: String(call[0]), init: (call[1] ?? {}) as FetchInit }
}

/** Two-stage payload helpers mirroring the FastAPI /predict-health contract. */
function unhealthyPayload(
  probabilities: Record<string, number>,
  health?: Partial<{ probability_unhealthy: number; threshold: number }>,
) {
  return jsonResponse(200, {
    model_version: '1.0.0',
    stage: 'unhealthy',
    health: {
      probability_unhealthy: health?.probability_unhealthy ?? 0.87,
      threshold: health?.threshold ?? 0.2244,
      classification: 'unhealthy',
    },
    diseases: {
      classes: ['miner', 'rust', 'phoma', 'cercospora'],
      probabilities,
      fired: ['rust'],
      thresholds: { miner: 0.5, rust: 0.65, phoma: 0.1, cercospora: 0.3 },
    },
    processing_ms: 120.5,
  })
}

function healthyPayload(
  probabilityUnhealthy = 0.10,
  threshold = 0.2244,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(200, {
    model_version: '1.0.0',
    stage: 'healthy',
    health: {
      probability_unhealthy: probabilityUnhealthy,
      threshold,
      classification: 'healthy',
    },
    diseases: null,
    processing_ms: 80.1,
    ...extra,
  })
}

describe('threshold configuration (training specs, adapter-authoritative)', () => {
  it('declares the four sigmoid classes in the trained output order', () => {
    expect(CLASS_ORDER).toEqual(['miner', 'rust', 'phoma', 'cercospora'])
  })

  it('declares the configured thresholds', () => {
    expect(THRESHOLDS).toEqual({ miner: 0.31, rust: 0.42, phoma: 0.21, cercospora: 0.31 })
  })

  it('the adapter is registered as a real model (never simulated)', () => {
    expect(coffeeRealAdapter.isMock).toBe(false)
    expect(coffeeRealAdapter.id.startsWith('mock-')).toBe(false)
    expect(coffeeRealAdapter.crop).toBe('coffee')
  })
})

describe('endpoint configuration', () => {
  it('accepts a valid http(s) endpoint and trims trailing slashes', () => {
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', 'http://host:8100///')
    expect(configuredCoffeeModelEndpoint()).toBe('http://host:8100')
    expect(isCoffeeModelServiceConfigured()).toBe(true)
  })

  it('treats blank, scheme-less and non-http values as unconfigured', () => {
    for (const value of ['', '   ', 'not-a-url', 'ftp://host', 'javascript:alert(1)']) {
      vi.stubEnv('COFFEE_MODEL_ENDPOINT', value)
      expect(configuredCoffeeModelEndpoint()).toBeNull()
      expect(isCoffeeModelServiceConfigured()).toBe(false)
    }
  })

  it('times out with the configured value and falls back to a sane default', () => {
    vi.stubEnv('COFFEE_MODEL_SERVICE_TIMEOUT_MS', '4500')
    expect(requestTimeoutMs()).toBe(4500)
    vi.stubEnv('COFFEE_MODEL_SERVICE_TIMEOUT_MS', 'garbage')
    expect(requestTimeoutMs()).toBe(DEFAULT_REQUEST_TIMEOUT_MS)
    vi.stubEnv('COFFEE_MODEL_SERVICE_TIMEOUT_MS', '10')
    expect(requestTimeoutMs()).toBe(DEFAULT_REQUEST_TIMEOUT_MS) // below the minimum
  })
})

describe('successful two-stage prediction round-trip', () => {
  it('POSTs the original image bytes as multipart to <endpoint>/predict-health', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(unhealthyPayload(probabilitiesOf({ miner: 0.9 }), { probability_unhealthy: 0.91 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.conditionKey).toBe('coffee-foliar-disease:miner')
    expect(lastFetchCall().url).toBe(`${ENDPOINT}/predict-health`)
    const { init } = lastFetchCall()
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(init.body).toBeInstanceOf(FormData)
    const file = form.get('file') as File
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toBe('imagen.jpg')
    expect(file.size).toBe(8) // original bytes forwarded untouched
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps fired classes into cautious Spanish text (never a definitive diagnosis)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        unhealthyPayload(probabilitiesOf({ miner: 0.9, rust: 0.5 }), { probability_unhealthy: 0.92 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.confidence).toBe(0.9) // max among fired (miner 0.9)
    expect(prediction.estimatedSeverity).toBe('unknown')
    expect(prediction.expertInspectionRecommended).toBe(true)
    expect(prediction.detectedSymptoms).toHaveLength(2)
    for (const text of [...prediction.detectedSymptoms]) {
      expect(text).toMatch(/posible|compatible|orientativo|no un diagnóstico/i)
    }
    expect(prediction.generalHealthAssessment).toContain('minador')
    expect(prediction.recommendedCorrectiveActions.every((action) => action.includes('técnico agrícola'))).toBe(true)
  })

  it('prepends the binary health verdict to the stage-2 assessment (farmer sees stage 1 first)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(unhealthyPayload(probabilitiesOf({ miner: 0.9 }), { probability_unhealthy: 0.87 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    // Stage-1 context comes first in the farmer-facing text.
    expect(prediction.generalHealthAssessment.startsWith('El modelo de salud (etapa 1)')).toBe(true)
    expect(prediction.generalHealthAssessment).toContain('potencialmente enferma')
    expect(prediction.generalHealthAssessment).toContain('87.0%')
    expect(prediction.generalHealthAssessment).toContain('22.4%') // threshold echoed in %
    // Existing stage-2 content preserved after the context sentence.
    expect(prediction.generalHealthAssessment).toContain('minador')
  })

  it('routes a HEALTHY stage-1 verdict without disease results (classifier skipped)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(healthyPayload(0.08, 0.2244)))
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.conditionKey).toBe('healthy')
    expect(prediction.estimatedSeverity).toBe('none')
    expect(prediction.detectedSymptoms).toEqual([])
    expect(prediction.recommendedCorrectiveActions).toEqual([])
    expect(prediction.expertInspectionRecommended).toBe(false)
    expect(prediction.confidence).toBeCloseTo(1 - 0.08, 5)
    // Exactly one HTTP call: the disease classifier lives INSIDE the service;
    // the healthy payload proves it was not run (diseases === null).
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The scoped, honest limitation statement — never "completely healthy".
    expect(prediction.generalHealthAssessment).toContain('cuatro enfermedades')
    expect(prediction.generalHealthAssessment).toContain('minador de hoja, roya, mancha de hierro/phoma')
    expect(prediction.generalHealthAssessment).toMatch(/NO certifica que la planta esté completamente sana/i)
    expect(prediction.potentialExplanations?.join(' ')).toContain('no se ejecutó')
  })

  it('treats an exactly-at-threshold stage-1 verdict as Unhealthy (inclusive, service-decided)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(unhealthyPayload(probabilitiesOf({ rust: 0.9 }), { probability_unhealthy: 0.2244, threshold: 0.2244 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.conditionKey).toBe('coffee-foliar-disease:rust')
    expect(prediction.generalHealthAssessment).toContain('22.4%')
  })

  it('applies stage-2 thresholds locally with an inclusive boundary (>=)', async () => {
    // Exactly at each threshold → all four fire; confidence = max = 0.42 (rust).
    const allAtThreshold = predictionFromProbabilities(
      probabilitiesOf({ miner: 0.31, rust: 0.42, phoma: 0.21, cercospora: 0.31 }),
    )
    expect(allAtThreshold.conditionKey).toBe('coffee-foliar-disease:miner+rust+phoma+cercospora')
    expect(allAtThreshold.confidence).toBe(0.42)

    // Just below each threshold → nothing fires (stage-2 'healthy' mapping,
    // reached only when stage 1 already said Unhealthy).
    const noneFired = predictionFromProbabilities(
      probabilitiesOf({ miner: 0.30, rust: 0.41, phoma: 0.20, cercospora: 0.30 }),
    )
    expect(noneFired.conditionKey).toBe('healthy')
  })

  it('computes stage-2 healthy confidence as 1 − highest probability when nothing fires', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        unhealthyPayload(probabilitiesOf({ miner: 0.30, rust: 0.41, phoma: 0.20, cercospora: 0.30 })),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.confidence).toBeCloseTo(1 - 0.41, 5) // = 0.59
    expect(prediction.conditionKey).toBe('healthy')
    expect(prediction.estimatedSeverity).toBe('none')
    expect(prediction.detectedSymptoms).toEqual([])
    expect(prediction.recommendedCorrectiveActions).toEqual([])
    expect(prediction.expertInspectionRecommended).toBe(false)
    expect(prediction.confidence).toBeGreaterThanOrEqual(0)
    expect(prediction.confidence).toBeLessThanOrEqual(1)
  })

  it('ignores the service stage-2 `fired` field — the adapter thresholds are authoritative', async () => {
    // Service claims nothing fired; adapter's own rule must still fire on rust.
    const fetchMock = vi.fn(() =>
      Promise.resolve(unhealthyPayload(probabilitiesOf({ rust: 0.9 }), { probability_unhealthy: 0.90 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const prediction = await coffeeRealAdapter.predict(imageInput())

    expect(prediction.conditionKey).toBe('coffee-foliar-disease:rust')
    expect(prediction.confidence).toBe(0.9)
  })

  describe('pure stage-1 mapping helpers', () => {
    it('twoStageHealthyPrediction states the four-disease scope and the limitation', () => {
      const prediction = twoStageHealthyPrediction(0.15, 0.2244)
      expect(prediction.conditionKey).toBe('healthy')
      expect(prediction.estimatedSeverity).toBe('none')
      expect(prediction.detectedSymptoms).toEqual([])
      expect(prediction.expertInspectionRecommended).toBe(false)
      expect(prediction.generalHealthAssessment).toContain('cuatro enfermedades')
      expect(prediction.generalHealthAssessment).toMatch(/NO certifica/i)
      expect(prediction.generalHealthAssessment).toContain('15.0%')
      expect(prediction.generalHealthAssessment).toContain('22.4%')
      expect(prediction.potentialExplanations?.join(' ')).toContain('no se ejecutó')
    })

    it('parseHealthStagePayload validates and returns the parsed stages', () => {
      const unhealthy = parseHealthStagePayload({
        stage: 'unhealthy',
        health: { probability_unhealthy: 0.6, threshold: 0.2244, classification: 'unhealthy' },
        diseases: { probabilities: probabilitiesOf({ rust: 0.7 }) },
      })
      expect(unhealthy.stage).toBe('unhealthy')
      expect(unhealthy.probabilityUnhealthy).toBe(0.6)
      expect(unhealthy.diseases).toEqual(probabilitiesOf({ rust: 0.7 }))

      const healthy = parseHealthStagePayload({
        stage: 'healthy',
        health: { probability_unhealthy: 0.1, threshold: 0.2244, classification: 'healthy' },
        diseases: null,
      })
      expect(healthy.stage).toBe('healthy')
      expect(healthy.diseases).toBeNull()
    })
  })
})

describe('health check', () => {
  it('reports readiness and metadata on a 200 "ready" response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, { status: 'ready', model_version: '1.0.0', classes: ['miner', 'rust', 'phoma', 'cercospora'] }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const health = await checkCoffeeModelService()

    expect(health.ready).toBe(true)
    expect(health.modelVersion).toBe('1.0.0')
    expect(health.classes).toEqual(['miner', 'rust', 'phoma', 'cercospora'])
    expect(health.error).toBeNull()
    expect(lastFetchCall().url).toBe(`${ENDPOINT}/health`)
  })

  it('reports not-ready on a 503 without a configured checkpoint', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(503, { status: 'unavailable', error: 'Checkpoint not found at ...' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const health = await checkCoffeeModelService()

    expect(health.ready).toBe(false)
    expect(health.error).toContain('503')
  })
})

describe('service failures — clear errors, never fake results', () => {
  it('throws immediately when the endpoint is not configured', async () => {
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
      code: 'not-configured',
    } satisfies Partial<CoffeeModelServiceError>)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty image input without calling the service', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput([]))).rejects.toThrow('empty image input')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a 503 from /predict-health to a service-error', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(503, { detail: { error: 'Two-stage inference is unavailable.' } })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
      code: 'service-error',
      message: expect.stringContaining('503'),
    } satisfies Partial<CoffeeModelServiceError>)
  })

  it('maps a network failure to a network-error', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
      code: 'network-error',
      message: expect.stringContaining('ECONNREFUSED'),
    } satisfies Partial<CoffeeModelServiceError>)
  })

  it('aborts and maps to a timeout when the service never answers', async () => {
    vi.stubEnv('COFFEE_MODEL_SERVICE_TIMEOUT_MS', '300') // valid (≥250ms) short timeout
    const fetchMock = vi.fn((_url: unknown, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringContaining('timed out'),
    } satisfies Partial<CoffeeModelServiceError>)
  })

  it('rejects a malformed or out-of-range response as invalid', async () => {
    const invalidPayloads: unknown[] = [
      'not-json-at-all', // will come back non-object shape via a plain string body
      {}, // no stage-1 health block at all
      { health: null },
      { health: { threshold: 0.2244, classification: 'healthy' } }, // missing probability
      { health: { probability_unhealthy: '0.9', threshold: 0.2244, classification: 'unhealthy' } }, // not a number
      { health: { probability_unhealthy: 1.5, threshold: 0.2244, classification: 'unhealthy' } }, // out of [0,1]
      { health: { probability_unhealthy: 0.9, threshold: 1.5, classification: 'unhealthy' } }, // threshold out of range
      { health: { probability_unhealthy: 0.9, threshold: 0.2244 } }, // missing classification
      { health: { probability_unhealthy: 0.10, threshold: 0.2244, classification: 'unhealthy' } }, // contradicts p < threshold
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'healthy' } }, // contradicts p >= threshold
      // Stage 'unhealthy' without a diseases block — contract violation.
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'unhealthy' }, diseases: null },
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'unhealthy' }, diseases: {} },
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'unhealthy' }, diseases: { probabilities: { miner: 0.9 } } }, // missing rust/phoma/cercospora
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'unhealthy' }, diseases: { probabilities: { miner: 1.5, rust: 0, phoma: 0, cercospora: 0 } } }, // out of [0,1]
      { health: { probability_unhealthy: 0.90, threshold: 0.2244, classification: 'unhealthy' }, diseases: { probabilities: { miner: '0.9', rust: 0, phoma: 0, cercospora: 0 } } }, // not a number
      // Stage 'healthy' that still returns disease results — contract violation.
      { health: { probability_unhealthy: 0.10, threshold: 0.2244, classification: 'healthy' }, diseases: { probabilities: probabilitiesOf({ rust: 0.9 }) } },
    ]
    for (const payload of invalidPayloads) {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, payload)))
      vi.stubGlobal('fetch', fetchMock)
      await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
        code: 'invalid-response',
      } satisfies Partial<CoffeeModelServiceError>)
    }
  })

  it('rejects a non-JSON 200 body as invalid', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(coffeeRealAdapter.predict(imageInput())).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('non-JSON'),
    } satisfies Partial<CoffeeModelServiceError>)
  })
})

// @vitest-environment node
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { getAdapterForCrop, isMockProvider, listRegisteredModels } from './registry'
import type { PlantModelInput, PlantModelPrediction } from './types'

afterEach(() => {
  vi.unstubAllEnvs()
})

function imageInput(bytes: number[]): PlantModelInput {
  return {
    imageBytes: new Uint8Array(bytes),
    mimeType: 'image/jpeg',
    filename: 'hoja.jpg',
  }
}

describe('model registry — mock fallback when the model service is not configured', () => {
  beforeEach(() => {
    // Explicit: this suite section pins the UNCONFIGURED (default) state.
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', '')
  })

  it('resolves an adapter for coffee and nothing else (coffee-only platform)', () => {
    expect(getAdapterForCrop('coffee')?.crop).toBe('coffee')
    expect(getAdapterForCrop('cilantro')).toBeNull() // cilantro was removed
    expect(getAdapterForCrop('citrus')).toBeNull()
    expect(getAdapterForCrop('')).toBeNull()
    expect(getAdapterForCrop('Coffee')).toBeNull() // crops.name is lowercase in the schema
    expect(getAdapterForCrop(null)).toBeNull()
  })

  it('registers the clearly-labeled mock adapter until the service endpoint is configured', () => {
    for (const adapter of listRegisteredModels()) {
      expect(adapter.isMock).toBe(true)
      expect(adapter.id.startsWith('mock-')).toBe(true)
      expect(adapter.version).toBeTruthy()
      expect(isMockProvider(adapter.id)).toBe(true)
      expect(adapter.description).toContain('SIMULACIÓN')
    }
  })

  it('marks non-mock providers as not simulated', () => {
    expect(isMockProvider('coffee-efficientnetb0')).toBe(false)
    expect(isMockProvider('mock-coffee')).toBe(true)
    expect(isMockProvider(null)).toBe(false)
    expect(isMockProvider('')).toBe(false)
  })
})

describe('model registry — real adapter when COFFEE_MODEL_ENDPOINT is configured', () => {
  it('resolves the real EfficientNetB0 adapter for coffee', () => {
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', 'http://127.0.0.1:8100')
    const adapter = getAdapterForCrop('coffee')
    expect(adapter).not.toBeNull()
    expect(adapter?.id).toBe('coffee-efficientnetb0')
    expect(adapter?.isMock).toBe(false)
    expect(isMockProvider(adapter?.id)).toBe(false)
    expect(adapter?.version).toBeTruthy()
    expect(adapter?.crop).toBe('coffee')
  })

  it('listRegisteredModels mirrors the real adapter only while the endpoint stays configured', () => {
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', 'http://127.0.0.1:8100')
    expect(listRegisteredModels().map((adapter) => adapter.id)).toEqual(['coffee-efficientnetb0'])

    // Losing the configuration (deployment without the env var) must fall
    // back to the mock — never leave the crop without a model, never keep a
    // half-configured state.
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', '')
    expect(listRegisteredModels().map((adapter) => adapter.id)).toEqual(['mock-coffee'])
  })

  it('still refuses adapters for any other crop with the real service configured', () => {
    vi.stubEnv('COFFEE_MODEL_ENDPOINT', 'http://127.0.0.1:8100')
    expect(getAdapterForCrop('cilantro')).toBeNull()
    expect(getAdapterForCrop('citrus')).toBeNull()
    expect(getAdapterForCrop(null)).toBeNull()
  })
})

describe('mock coffee adapter (deterministic simulation)', () => {
  const adapter = getAdapterForCrop('coffee')!

  it('produces a valid, bounded prediction', async () => {
    const prediction: PlantModelPrediction = await adapter.predict(imageInput([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(Number.isFinite(prediction.confidence)).toBe(true)
    expect(prediction.confidence).toBeGreaterThanOrEqual(0)
    expect(prediction.confidence).toBeLessThanOrEqual(1)
    expect(['none', 'low', 'medium', 'high', 'critical', 'unknown']).toContain(prediction.estimatedSeverity)
    expect(prediction.generalHealthAssessment.length).toBeGreaterThan(0)
    expect(Array.isArray(prediction.detectedSymptoms)).toBe(true)
    expect(Array.isArray(prediction.recommendedPreventiveActions)).toBe(true)
    expect(typeof prediction.expertInspectionRecommended).toBe('boolean')
  })

  it('is deterministic: the same image always yields the same result', async () => {
    const input = imageInput([11, 22, 33])
    const first = await adapter.predict(input)
    const second = await adapter.predict(input)
    expect(second).toEqual(first)
  })

  it('spreads between healthy and foliar-condition simulations for varied inputs', async () => {
    const keys = new Set<string>()
    for (let seed = 0; seed < 24; seed += 1) {
      const prediction = await adapter.predict(imageInput(Array.from({ length: 16 }, (_, index) => (seed * 17 + index) % 251)))
      keys.add(prediction.conditionKey)
    }
    expect(keys.has('healthy')).toBe(true)
    expect(keys.has('foliar-disease-suspected')).toBe(true)
  })

  it('rejects empty image input', async () => {
    await expect(adapter.predict(imageInput([]))).rejects.toThrow()
  })
})

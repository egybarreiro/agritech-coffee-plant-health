const adapterPredict = vi.fn(() => Promise.resolve(validPrediction()))
// @vitest-environment node
//
// The inference pipeline is tested against a STUBBED service-role client that
// mirrors the exact PostgREST chain shapes the pipeline uses. Mock model
// results here prove orchestration and persistence behavior — no real model
// inference is exercised (that belongs to the model workstream).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const registryMocks = vi.hoisted(() => ({
  getAdapterForCrop: vi.fn(),
  isMockProvider: vi.fn(() => true),
}))

vi.mock('./registry', () => ({
  getAdapterForCrop: registryMocks.getAdapterForCrop,
  isMockProvider: registryMocks.isMockProvider,
}))

import { runPendingAnalysisPipeline } from './pipeline'
import type { PlantModelAdapter, PlantModelPrediction } from './types'

type DbError = { message: string } | null
type Row = Record<string, unknown>

const GENERIC_FAILURE = 'La evaluación automática no pudo completarse. La unidad quedó registrada; podrás reintentarla o solicitar su revisión.'
const NO_MODEL_FAILURE = 'Todavía no hay un modelo disponible para este cultivo. La fotografía quedó guardada y podrá revisarse más adelante.'

function validPrediction(overrides: Partial<PlantModelPrediction> = {}): PlantModelPrediction {
  return {
    conditionKey: 'foliar-disease-suspected',
    generalHealthAssessment: 'La hoja muestra lesiones compatibles con una mancha foliar.',
    confidence: 0.72,
    estimatedSeverity: 'medium',
    detectedSymptoms: ['Manchas marrones.'],
    potentialExplanations: ['Posible roya.'],
    recommendedPreventiveActions: ['Mejora la ventilación.'],
    recommendedCorrectiveActions: ['Aísla la planta.'],
    followUpInstructions: 'Repite en 7 días.',
    expertInspectionRecommended: false,
    ...overrides,
  }
}

const adapterMock: PlantModelAdapter = {
  id: 'mock-coffee',
  version: 'mock-1.0.0',
  crop: 'coffee',
  isMock: true,
  description: 'SIMULACIÓN de prueba',
  predict: adapterPredict,
}

interface StubConfig {
  claim?: { data: Row | null; error: DbError }
  image?: { data: Row | null; error: DbError }
  plant?: { data: Row | null; error: DbError }
  download?: { data: Blob | null; error: DbError }
  /** Result when an update chain is awaited directly (failed/completed writes). */
  updateResult?: { error: DbError }
}

type CapturedUpdate = { table: string; values: Row; eqFilters: string[] }
type CapturedDownload = { bucket: string; path: string }

const okRow = (data: Row) => ({ data, error: null })

function makeStubClient(config: StubConfig, capture: { updates: CapturedUpdate[]; downloads: CapturedDownload[] }) {
  const awaitedUpdateResult = (): { data: null; error: DbError } => ({ data: null, error: config.updateResult?.error ?? null })

  return {
    from(table: string) {
      const recordEq = (col: string, value: unknown) => {
        capture.updates[capture.updates.length - 1]?.eqFilters.push(`${col}=${String(value)}`)
      }
      return {
        update(values: Row) {
          capture.updates.push({ table, values, eqFilters: [] })
          const afterEqNode: () => {
            eq: (col: string, value: unknown) => ReturnType<typeof afterEqNode>
            select: () => { maybeSingle: () => Promise<NonNullable<StubConfig['claim']>> }
            then: (
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => Promise<unknown>
          } = () => ({
            eq: (col: string, value: unknown) => {
              recordEq(col, value)
              return afterEqNode()
            },
            select: () => ({ maybeSingle: () => Promise.resolve(config.claim ?? { data: null, error: null }) }),
            then: (onFulfilled, onRejected) => Promise.resolve(awaitedUpdateResult()).then(onFulfilled, onRejected),
          })
          return {
            eq: (col: string, value: unknown) => {
              recordEq(col, value)
              return afterEqNode()
            },
          }
        },
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              const result = table === 'plant_images' ? config.image : table === 'plants' ? config.plant : { data: null, error: null }
              return Promise.resolve(result ?? { data: null, error: null })
            },
          }),
        }),
      }
    },
    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            capture.downloads.push({ bucket, path })
            if (!config.download) return Promise.resolve({ data: null, error: null })
            return Promise.resolve({ data: config.download.data, error: config.download.error })
          },
        }
      },
    },
  }
}

function imageBlob(bytes: number[] = [1, 2, 3, 4]) {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
}

function defaultConfig(): StubConfig {
  return {
    claim: okRow({ id: 'aaaaaaaa-0000-4000-8000-000000000001', plant_image_id: 'bbbbbbbb-0000-4000-8000-000000000002' }),
    image: okRow({ id: 'bbbbbbbb-0000-4000-8000-000000000002', plant_id: 'cccccccc-0000-4000-8000-000000000003', storage_bucket: 'plant-images', storage_path: 'farmer/plant/photo.jpg', mime_type: 'image/jpeg', filename: 'photo.jpg' }),
    plant: okRow({ id: 'cccccccc-0000-4000-8000-000000000003', crops: { name: 'coffee' } }),
    download: { data: imageBlob(), error: null },
    updateResult: { error: null },
  }
}

const analysisId = 'aaaaaaaa-0000-4000-8000-000000000001'

let capture: { updates: CapturedUpdate[]; downloads: CapturedDownload[] }
let consoleErrorSpy: { mock: { calls: Array<unknown[]> }; mockRestore: () => void }

beforeEach(() => {
  vi.clearAllMocks()
  registryMocks.getAdapterForCrop.mockReturnValue(adapterMock)
  registryMocks.isMockProvider.mockReturnValue(true)
  adapterPredict.mockResolvedValue(validPrediction())
  capture = { updates: [], downloads: [] }
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('runPendingAnalysisPipeline — pending → completed', () => {
  it('claims a pending row, infers, and persists the completed prediction with server-controlled fields', async () => {
    const client = makeStubClient(defaultConfig(), capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome).toEqual({ status: 'completed', modelProvider: 'mock-coffee', isMock: true })

    // First write was the pending → processing claim guarded on status.
    expect(capture.updates[0]).toMatchObject({ table: 'analyses', eqFilters: ['id=' + analysisId, 'status=pending'] })
    expect(capture.updates[0]!.values.status).toBe('processing')

    // Final write persisted every standardized prediction field.
    const final = capture.updates[capture.updates.length - 1]!
    expect(final.table).toBe('analyses')
    expect(final.eqFilters).toEqual(['id=' + analysisId])
    expect(final.values).toMatchObject({
      status: 'completed',
      model_provider: 'mock-coffee',
      model_version: 'mock-1.0.0',
      confidence_score: 0.72,
      estimated_severity: 'medium',
      general_health_assessment: 'La hoja muestra lesiones compatibles con una mancha foliar.',
      detected_symptoms: ['Manchas marrones.'],
      recommended_preventive_actions: ['Mejora la ventilación.'],
      recommended_corrective_actions: ['Aísla la planta.'],
      follow_up_instructions: 'Repite en 7 días.',
      expert_inspection_recommended: false,
      error_message: null,
    })
    expect(final.values.completed_at).toEqual(final.values.analysis_timestamp)

    // Image bytes were fetched for the adapter from the row's own bucket/path.
    expect(capture.downloads).toEqual([{ bucket: 'plant-images', path: 'farmer/plant/photo.jpg' }])
    expect(adapterPredict).toHaveBeenCalledWith({
      imageBytes: expect.any(Uint8Array),
      mimeType: 'image/jpeg',
      filename: 'photo.jpg',
    })
  })

  it('sanitizes out-of-range and malformed model output before persisting', async () => {
    adapterPredict.mockResolvedValue(
      validPrediction({ confidence: 7, estimatedSeverity: 'catastrophic' as PlantModelPrediction['estimatedSeverity'], detectedSymptoms: 'x' as unknown as string[] }),
    )
    const client = makeStubClient(defaultConfig(), capture)

    await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    const final = capture.updates[capture.updates.length - 1]!
    expect(final.values.confidence_score).toBe(1)
    expect(final.values.estimated_severity).toBe('unknown')
    expect(final.values.detected_symptoms).toEqual([])
  })

  it('falls back to the default bucket when the image row lacks one', async () => {
    const config = defaultConfig()
    config.image = okRow({ ...config.image!.data, storage_bucket: null })
    const client = makeStubClient(config, capture)

    await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(capture.downloads[0]!.bucket).toBe('plant-images')
  })
})

describe('runPendingAnalysisPipeline — claim guard', () => {
  it('does nothing when the row is not claimable (already processed or deleted)', async () => {
    const config = { ...defaultConfig(), claim: { data: null, error: null } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome).toEqual({ status: 'skipped', reason: 'analysis-not-claimable' })
    expect(capture.updates).toHaveLength(1) // only the claim, never a failed/completed write
    expect(adapterPredict).not.toHaveBeenCalled()
  })

  it('does nothing when the claim update errors', async () => {
    const config = { ...defaultConfig(), claim: { data: null, error: { message: 'db down' } } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome.status).toBe('skipped')
    expect(capture.updates).toHaveLength(1)
  })
})

describe('runPendingAnalysisPipeline — deterministic farmer-safe failures', () => {
  it('fails with the farmer-friendly no-model message when the crop has no registered adapter', async () => {
    registryMocks.getAdapterForCrop.mockReturnValue(null)
    const client = makeStubClient(defaultConfig(), capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome).toEqual({ status: 'failed', reason: 'no-adapter-for-crop' })
    const failWrite = capture.updates[capture.updates.length - 1]!
    expect(failWrite.values).toMatchObject({ status: 'failed', error_message: NO_MODEL_FAILURE })
    expect(adapterPredict).not.toHaveBeenCalled()
    expect(capture.downloads).toHaveLength(0)
  })

  it('fails with the generic farmer message when the image row is missing (internal cause logged only)', async () => {
    const config = { ...defaultConfig(), image: { data: null, error: null } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome.status).toBe('failed')
    const failWrite = capture.updates[capture.updates.length - 1]!
    expect(failWrite.values.error_message).toBe(GENERIC_FAILURE)
    // Internal cause is logged server-side, never stored in error_message.
    expect(String(consoleErrorSpy.mock.calls.map((call) => call.join(' ')))).toContain('plant_images')
  })

  it('fails on a storage download error without leaking the cause into error_message', async () => {
    const config = { ...defaultConfig(), download: { data: null, error: { message: 'bucket auth failed' } } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome.status).toBe('failed')
    const failWrite = capture.updates[capture.updates.length - 1]!
    expect(failWrite.values.error_message).toBe(GENERIC_FAILURE)
    expect(failWrite.values.error_message).not.toContain('bucket auth failed')
  })

  it('fails when the adapter throws during inference', async () => {
    adapterPredict.mockRejectedValue(new Error('onnx runtime crashed'))
    const client = makeStubClient(defaultConfig(), capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome.status).toBe('failed')
    expect(capture.updates[capture.updates.length - 1]!.values).toMatchObject({ status: 'failed', error_message: GENERIC_FAILURE })
    expect(String(consoleErrorSpy.mock.calls)).toContain('onnx runtime crashed')
  })

  it('fails when the completed-result persistence errors', async () => {
    const config = { ...defaultConfig(), updateResult: { error: { message: 'constraint violated' } } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome).toEqual({ status: 'failed', reason: 'persist-failed' })
    // Both the completed attempt and the final failed write touched the row.
    expect(capture.updates[capture.updates.length - 1]!.values.status).toBe('failed')
  })

  it('fails on empty image bytes from storage', async () => {
    const config = { ...defaultConfig(), download: { data: imageBlob([]), error: null } }
    const client = makeStubClient(config, capture)

    const outcome = await runPendingAnalysisPipeline(client as unknown as SupabaseClient, analysisId)

    expect(outcome).toEqual({ status: 'failed', reason: 'empty-image-bytes' })
    expect(adapterPredict).not.toHaveBeenCalled()
  })
})

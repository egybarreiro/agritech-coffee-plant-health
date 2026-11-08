// @vitest-environment node
//
// Covers POST /api/analyses: ownership-checked re-analysis creation plus
// wiring of the model-inference pipeline. Inference itself is mocked (real
// model quality belongs to the model workstream).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFarmerContext: vi.fn(),
  createServiceClient: vi.fn(),
  runPendingAnalysisPipeline: vi.fn(),
}))

vi.mock('@/lib/supabase/farmer', () => ({ getFarmerContext: mocks.getFarmerContext }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/lib/models/pipeline', () => ({ runPendingAnalysisPipeline: mocks.runPendingAnalysisPipeline }))

import { GET, POST } from './route'

const farmerId = '55555555-5555-4555-8555-555555555555'
const imageId = '66666666-6666-4666-8666-666666666666'

type DbResult = { data: unknown; error: { message: string } | null }

let verifierResult: DbResult
let existingResult: DbResult
let insertResult: DbResult
const inserts: Array<Record<string, unknown>> = []
let fromCalls: string[] = []
const serviceClientMarker: Record<string, unknown> = { marker: 'service-client' }

function makeFarmerAuth() {
  return {
    user: { id: farmerId },
    supabase: {
      from: vi.fn((table: string) => {
        fromCalls.push(table)
        if (table === 'plant_images') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve(verifierResult),
                }),
              }),
            }),
          }
        }
        if (table === 'analyses') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve(existingResult),
                  }),
                }),
              }),
            }),
            insert: (payload: Record<string, unknown>) => {
              inserts.push(payload)
              return {
                select: () => ({
                  single: () => Promise.resolve(insertResult),
                }),
              }
            },
          }
        }
        return {}
      }),
    },
  }
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const pendingRow = { id: '77777777-7777-4777-8777-777777777777', status: 'pending', submitted_at: '2026-11-05T00:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  fromCalls = []
  verifierResult = okRow({ id: imageId })
  existingResult = { data: null, error: null }
  insertResult = okRow(pendingRow)

  mocks.getFarmerContext.mockResolvedValue(makeFarmerAuth())
  mocks.createServiceClient.mockReturnValue(serviceClientMarker)
  mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'skipped' })
})

function okRow(data: unknown): DbResult {
  return { data, error: null }
}

describe('POST /api/analyses — re-analysis creation and pipeline wiring', () => {
  it('rejects malformed bodies without touching the database', async () => {
    const invalid = await POST(jsonRequest({ plant_image_id: 'not-a-uuid' }))
    expect(invalid!.status).toBe(400)

    const missing = await POST(jsonRequest({}))
    expect(missing!.status).toBe(400)

    const tooLarge = new Request('http://localhost/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plant_image_id: 'x'.repeat(100000) }),
    })
    const bounded = await POST(tooLarge)
    expect(bounded!.status).toBe(413)

    expect(fromCalls).toEqual([])
  })

  it('refuses photographs not owned by the farmer', async () => {
    verifierResult = { data: null, error: null }

    const response = await POST(jsonRequest({ plant_image_id: imageId }))

    expect(response!.status).toBe(404)
    expect(inserts).toHaveLength(0)
    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
  })

  it('returns the existing analysis without creating a duplicate', async () => {
    existingResult = okRow({ id: '88888888-8888-4888-8888-888888888888', status: 'completed', submitted_at: '2026-11-04T00:00:00.000Z' })

    const response = await POST(jsonRequest({ plant_image_id: imageId }))
    const json = await response!.json()

    expect(response!.status).toBe(200)
    expect(json.status).toBe('existing')
    expect(json.analysis.id).toBe('88888888-8888-4888-8888-888888888888')
    expect(inserts).toHaveLength(0)
    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
  })

  it('creates the pending analysis and runs the inference pipeline with the service client', async () => {
    const response = await POST(jsonRequest({ plant_image_id: imageId }))
    const json = await response!.json()

    expect(response!.status).toBe(202)
    expect(json.status).toBe('created')
    expect(json.analysis.status).toBe('pending')
    expect(inserts).toEqual([{ plant_image_id: imageId, status: 'pending' }])

    expect(mocks.runPendingAnalysisPipeline).toHaveBeenCalledTimes(1)
    const [pipelineClient, pipelineAnalysisId] = mocks.runPendingAnalysisPipeline.mock.calls[0]!
    expect(pipelineClient).toBe(serviceClientMarker)
    expect(pipelineAnalysisId).toBe(pendingRow.id)
  })

  it('reports the pipeline outcome honestly in the created analysis', async () => {
    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'completed', modelProvider: 'mock-coffee', isMock: true })

    const response = await POST(jsonRequest({ plant_image_id: imageId }))
    const json = await response!.json()

    expect(json.analysis.status).toBe('completed')

    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'failed', reason: 'no-adapter-for-crop' })
    const failed = await POST(jsonRequest({ plant_image_id: imageId }))
    const failedJson = await failed!.json()
    expect(failedJson.analysis.status).toBe('failed')
    // Internal reasons are never echoed to the farmer.
    expect(JSON.stringify(failedJson)).not.toContain('no-adapter-for-crop')
  })

  it('returns a Spanish 500 when the insert itself fails', async () => {
    insertResult = { data: null, error: { message: 'db down' } }

    const response = await POST(jsonRequest({ plant_image_id: imageId }))
    const json = await response!.json()

    expect(response!.status).toBe(500)
    expect(json.error).toBe('La fotografía se guardó, pero la evaluación no pudo registrarse.')
    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
  })

  it('GET keeps returning the farmer-readable projection with enriched image/plant data', async () => {
    const analysisId = '99999999-9999-4999-8999-999999999999'
    const analysis = {
      id: analysisId,
      plant_image_id: imageId,
      status: 'completed',
      model_provider: 'mock-coffee',
      model_version: 'mock-1.0.0',
      confidence_score: 0.9,
      estimated_severity: 'none',
      general_health_assessment: 'Sana.',
      detected_symptoms: [],
      recommended_preventive_actions: ['Riego constante.'],
      recommended_corrective_actions: [],
      follow_up_instructions: null,
      expert_inspection_recommended: false,
      error_message: null,
      submitted_at: '2026-11-05T00:00:00.000Z',
      completed_at: '2026-11-05T00:01:00.000Z',
    }
    const supabase = {
      from: (table: string) => {
        fromCalls.push(table)
        if (table === 'analyses') {
          return {
            select: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [analysis], error: null }),
              }),
            }),
          }
        }
        if (table === 'plant_images') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
      },
      storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
    }
    mocks.getFarmerContext.mockResolvedValue({ user: { id: farmerId }, supabase })

    const response = await GET()
    const json = await response!.json()

    expect(response!.status).toBe(200)
    expect(json.analyses).toHaveLength(1)
    expect(json.analyses[0].model_provider).toBe('mock-coffee')
    expect(json.analyses[0].confidence_score).toBe(0.9)
  })
})

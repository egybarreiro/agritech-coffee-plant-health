// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFarmerContext: vi.fn(),
  createServiceClient: vi.fn(),
  runPendingAnalysisPipeline: vi.fn(),
}))

vi.mock('@/lib/supabase/farmer', () => ({ getFarmerContext: mocks.getFarmerContext }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/lib/models/pipeline', () => ({ runPendingAnalysisPipeline: mocks.runPendingAnalysisPipeline }))

import { POST } from './route'

const farmerId = '11111111-1111-4111-8111-111111111111'
const plantId = '22222222-2222-4222-8222-222222222222'
const imageId = '33333333-3333-4333-8333-333333333333'
const analysisId = '44444444-4444-4444-8444-444444444444'

type DbResult = { data: unknown; error: { message: string } | null }

let plantResult: DbResult
let imageResult: DbResult
let analysisResult: DbResult
let linkedAnalysisResult: DbResult
let primaryImageResult: DbResult
let storageUploadError: { message: string } | null
let farmerRemoveError: { message: string } | null
let serviceRemoveError: { message: string } | null

const plantImageInserts: Array<Record<string, unknown>> = []
const analysisInserts: Array<Record<string, unknown>> = []
const farmerStorageUploads: Array<{ path: string }> = []
const farmerStorageRemovals: string[][] = []
const serviceStorageRemovals: string[][] = []
let farmerFromCalls: string[] = []
let serviceFromCalls: string[] = []

function jpegBytes() {
  const buffer = new ArrayBuffer(12)
  const bytes = new Uint8Array(buffer)
  const values = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]
  values.forEach((value, index) => {
    bytes[index] = value
  })
  return bytes
}

function makeFarmerAuth() {
  return {
    user: { id: farmerId },
    supabase: {
      from: vi.fn((table: string) => {
        farmerFromCalls.push(table)
        if (table === 'plants') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve(plantResult),
                }),
              }),
            }),
          }
        }
        if (table === 'plant_images') {
          return {
            insert: (payload: Record<string, unknown>) => {
              plantImageInserts.push(payload)
              return {
                select: () => ({
                  single: () => Promise.resolve(imageResult),
                }),
              }
            },
          }
        }
        return {}
      }),
      storage: {
        from: () => ({
          upload: (path: string) => {
            farmerStorageUploads.push({ path })
            return Promise.resolve({ error: storageUploadError, data: null })
          },
          remove: (paths: string[]) => {
            farmerStorageRemovals.push(paths)
            return Promise.resolve({ error: farmerRemoveError, data: null })
          },
        }),
      },
    },
  }
}

function makeServiceClient() {
  return {
    from: (table: string) => {
      serviceFromCalls.push(table)
      if (table === 'analyses') {
        return {
          insert: (payload: Record<string, unknown>) => {
            analysisInserts.push(payload)
            return {
              select: () => ({
                single: () => Promise.resolve(analysisResult),
              }),
            }
          },
          // Leaf-branch lookup: verification of the linked assessment.
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(linkedAnalysisResult),
            }),
          }),
        }
      }
      if (table === 'plant_images') {
        // Leaf-branch lookup: the assessment's primary 'full_plant' image.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(primaryImageResult),
            }),
          }),
        }
      }
      return {}
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          serviceStorageRemovals.push(paths)
          return Promise.resolve({ error: serviceRemoveError, data: null })
        },
      }),
    },
  }
}

function makeRequest(): Request {
  const form = new FormData()
  form.append('plant_id', plantId)
  form.append('file', new File([jpegBytes()], 'hoja.jpg', { type: 'image/jpeg' }))
  return new Request('http://localhost/api/images', { method: 'POST', body: form })
}

function makeLeafRequest({ withAnalysisId = true }: { withAnalysisId?: boolean } = {}): Request {
  const form = new FormData()
  form.append('plant_id', plantId)
  form.append('image_role', 'leaf_details')
  if (withAnalysisId) form.append('analysis_id', analysisId)
  form.append('file', new File([jpegBytes()], 'primer-plano.jpg', { type: 'image/jpeg' }))
  return new Request('http://localhost/api/images', { method: 'POST', body: form })
}

describe('POST /api/images — farmer upload and server-controlled analysis creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    plantImageInserts.length = 0
    analysisInserts.length = 0
    farmerStorageUploads.length = 0
    farmerStorageRemovals.length = 0
    serviceStorageRemovals.length = 0
    farmerFromCalls = []
    serviceFromCalls = []

    plantResult = { data: { id: plantId }, error: null }
    imageResult = {
      data: { id: imageId, plant_id: plantId, filename: 'hoja.jpg', mime_type: 'image/jpeg', size_bytes: 12 },
      error: null,
    }
    analysisResult = {
      data: { id: analysisId, status: 'pending', submitted_at: '2026-11-02T00:00:00.000Z' },
      error: null,
    }
    linkedAnalysisResult = { data: { id: analysisId, plant_image_id: imageId }, error: null }
    primaryImageResult = { data: { id: imageId, plant_id: plantId, image_role: 'full_plant' }, error: null }
    storageUploadError = null
    farmerRemoveError = null
    serviceRemoveError = null

    mocks.getFarmerContext.mockResolvedValue(makeFarmerAuth())
    mocks.createServiceClient.mockReturnValue(makeServiceClient())
    // Default: pipeline finishes quietly so the response contract (analysis
    // row + no warning) is exercised. Pipeline-specific behavior is tested
    // in lib/models/pipeline.test.ts.
    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'skipped' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated requests before any operation', async () => {
    mocks.getFarmerContext.mockResolvedValue({
      response: Response.json({ error: 'No autorizado.' }, { status: 401 }),
    })

    const response = await POST(makeRequest())

    expect(response).toBeDefined()
    expect(response!.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(farmerStorageUploads).toHaveLength(0)
  })

  it('rejects uploads for plants the farmer does not own', async () => {
    plantResult = { data: null, error: null }

    const response = await POST(makeRequest())

    expect(response).toBeDefined()
    expect(response!.status).toBe(404)
    expect(farmerStorageUploads).toHaveLength(0)
    expect(plantImageInserts).toHaveLength(0)
    expect(analysisInserts).toHaveLength(0)
  })

  it('rejects unsupported mime types without touching storage', async () => {
    const form = new FormData()
    form.append('plant_id', plantId)
    form.append('file', new File([jpegBytes()], 'hoja.jpg', { type: 'text/plain' }))
    const response = await POST(new Request('http://localhost/api/images', { method: 'POST', body: form }))

    expect(response).toBeDefined()
    expect(response!.status).toBe(400)
    expect(farmerStorageUploads).toHaveLength(0)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('uploads through the SSR client, records plant_images there, and creates the analyses row via the service-role client', async () => {
    const response = await POST(makeRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(json.image.id).toBe(imageId)
    expect(json.analysis).toEqual(analysisResult.data)
    expect(json.warning).toBeUndefined()

    // Storage upload through the authenticated SSR client with the
    // farmer/plant scoped path convention.
    expect(farmerStorageUploads).toHaveLength(1)
    const uploadedPath = farmerStorageUploads[0]!.path
    expect(uploadedPath.startsWith(`${farmerId}/${plantId}/`)).toBe(true)
    expect(uploadedPath.endsWith('.jpg')).toBe(true)

    // plant_images INSERT performed with the authenticated SSR client.
    expect(plantImageInserts).toHaveLength(1)
    expect(plantImageInserts[0]).toEqual({
      plant_id: plantId,
      submitted_by: farmerId,
      storage_bucket: 'plant-images',
      storage_path: uploadedPath,
      filename: 'hoja.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      image_role: 'full_plant',
    })

    // analyses INSERT performed exclusively by the service-role client,
    // never through the farmer's SSR client.
    expect(mocks.createServiceClient).toHaveBeenCalledTimes(1)
    expect(serviceFromCalls).toEqual(['analyses'])
    expect(farmerFromCalls).toEqual(['plants', 'plant_images'])
    expect(analysisInserts).toEqual([{ plant_image_id: imageId, status: 'pending' }])

    // No compensating cleanup on success — neither client removes anything.
    expect(farmerStorageRemovals).toHaveLength(0)
    expect(serviceStorageRemovals).toHaveLength(0)
  })

  it('performs compensating cleanup with the service-role client, targeting exactly the request-generated path', async () => {
    imageResult = { data: null, error: { message: 'insert failed' } }

    const response = await POST(makeRequest())

    // Cleanup goes through the privileged service-role client...
    expect(serviceStorageRemovals).toEqual([[farmerStorageUploads[0]!.path]])
    // ...never through the farmer's SSR client (its DELETE policy is gone).
    expect(farmerStorageRemovals).toHaveLength(0)
    expect(response).toBeDefined()
    expect(response!.status).toBe(500)
    expect(analysisInserts).toHaveLength(0)
  })

  it('logs explicitly when service-role cleanup also fails', async () => {
    imageResult = { data: null, error: { message: 'insert failed' } }
    serviceRemoveError = { message: 'bucket access denied' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest())

    expect(response).toBeDefined()
    expect(response!.status).toBe(500)
    expect(serviceStorageRemovals).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(String(consoleError.mock.calls[0]?.[0])).toContain('Failed to remove the uploaded storage object')
  })

  it('never invokes the service-role client or database writes when the Storage upload fails', async () => {
    storageUploadError = { message: 'bucket unavailable' }

    const response = await POST(makeRequest())

    expect(response).toBeDefined()
    expect(response!.status).toBe(500)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(farmerStorageRemovals).toHaveLength(0)
    expect(serviceStorageRemovals).toHaveLength(0)
    expect(plantImageInserts).toHaveLength(0)
    expect(analysisInserts).toHaveLength(0)
  })

  it('keeps the uploaded image and returns a warning when the analyses insert fails', async () => {
    analysisResult = { data: null, error: { message: 'database unavailable' } }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(json.image.id).toBe(imageId)
    expect(json.analysis).toBeNull()
    expect(json.warning).toBe('La fotografía se guardó, pero no se pudo crear su evaluación.')

    // The uploaded image is valid evidence — do not remove it.
    expect(farmerStorageRemovals).toHaveLength(0)
    expect(serviceStorageRemovals).toHaveLength(0)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('runs the model-inference pipeline for the created analysis with the service-role client', async () => {
    const response = await POST(makeRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(mocks.runPendingAnalysisPipeline).toHaveBeenCalledTimes(1)
    const [pipelineClient, pipelineAnalysisId] = mocks.runPendingAnalysisPipeline.mock.calls[0]!
    // Same service client used for the analyses insert (no extra privilege grants).
    expect(pipelineClient).toBe(mocks.createServiceClient.mock.results[0]!.value)
    expect(pipelineAnalysisId).toBe(analysisId)
    expect(json.warning).toBeUndefined()
  })

  it('reflects a completed inference in the response analysis status', async () => {
    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'completed', modelProvider: 'mock-coffee', isMock: true })

    const response = await POST(makeRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(json.analysis.status).toBe('completed')
    expect(json.warning).toBeUndefined()
  })

  it('warns in Spanish without internal details when the pipeline fails', async () => {
    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'failed', reason: 'unexpected-error' })

    const response = await POST(makeRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(json.image.id).toBe(imageId)
    expect(json.analysis.status).toBe('failed')
    expect(json.warning).toBe('La fotografía se guardó, pero la evaluación automática no pudo completarse. Revisa el historial para más detalles.')
    expect(json.warning).not.toContain('unexpected-error')
  })

  it('does not run the pipeline when the analyses insert fails', async () => {
    analysisResult = { data: null, error: { message: 'database unavailable' } }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(makeRequest())

    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
  })
})

describe('POST /api/images — leaf_details complementary close-ups (coffee two-photo flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    plantImageInserts.length = 0
    analysisInserts.length = 0
    farmerStorageUploads.length = 0
    farmerStorageRemovals.length = 0
    serviceStorageRemovals.length = 0
    farmerFromCalls = []
    serviceFromCalls = []

    plantResult = { data: { id: plantId }, error: null }
    imageResult = {
      data: { id: imageId, plant_id: plantId, filename: 'primer-plano.jpg', mime_type: 'image/jpeg', size_bytes: 12 },
      error: null,
    }
    analysisResult = {
      data: { id: analysisId, status: 'pending', submitted_at: '2026-11-02T00:00:00.000Z' },
      error: null,
    }
    linkedAnalysisResult = { data: { id: analysisId, plant_image_id: imageId }, error: null }
    primaryImageResult = { data: { id: imageId, plant_id: plantId, image_role: 'full_plant' }, error: null }
    storageUploadError = null
    farmerRemoveError = null
    serviceRemoveError = null

    mocks.getFarmerContext.mockResolvedValue(makeFarmerAuth())
    mocks.createServiceClient.mockReturnValue(makeServiceClient())
    mocks.runPendingAnalysisPipeline.mockResolvedValue({ status: 'skipped' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a leaf close-up sent without its assessment id (409, before any write)', async () => {
    const response = await POST(makeLeafRequest({ withAnalysisId: false }))
    const json = await response!.json()

    expect(response!.status).toBe(409)
    expect(json.error).toContain('evaluación')
    expect(farmerStorageUploads).toHaveLength(0)
    expect(plantImageInserts).toHaveLength(0)
    expect(analysisInserts).toHaveLength(0)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('attaches the leaf photo to the SAME existing assessment without creating a new one', async () => {
    const response = await POST(makeLeafRequest())
    const json = await response!.json()

    expect(response!.status).toBe(201)
    expect(json.image.id).toBe(imageId)
    expect(json.analysis).toBeNull()
    expect(json.linked_analysis_id).toBe(analysisId)
    expect(json.warning).toBeUndefined()

    // Ownership chain verified through the service client:
    // analysis → primary full_plant image → same plant as the request.
    expect(serviceFromCalls).toEqual(['analyses', 'plant_images'])

    // plant_images INSERT tagged with the role and the linked assessment.
    expect(plantImageInserts).toHaveLength(1)
    expect(plantImageInserts[0]).toEqual(expect.objectContaining({
      plant_id: plantId,
      submitted_by: farmerId,
      image_role: 'leaf_details',
      analysis_id: analysisId,
    }))

    // NO analysis INSERT and NO pipeline run: a retry can never duplicate
    // the assessment record.
    expect(analysisInserts).toHaveLength(0)
    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
    expect(farmerStorageRemovals).toHaveLength(0)
    expect(serviceStorageRemovals).toHaveLength(0)
  })

  it('rejects a leaf attachment when the assessment belongs to a different plant (403)', async () => {
    primaryImageResult = { data: { id: imageId, plant_id: '99999999-9999-4999-8999-999999999999', image_role: 'full_plant' }, error: null }

    const response = await POST(makeLeafRequest())

    expect(response!.status).toBe(403)
    expect(farmerStorageUploads).toHaveLength(0)
    expect(plantImageInserts).toHaveLength(0)
    expect(analysisInserts).toHaveLength(0)
  })

  it('performs compensating service-role storage cleanup when the leaf metadata insert fails', async () => {
    imageResult = { data: null, error: { message: 'insert failed' } }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeLeafRequest())

    expect(response!.status).toBe(500)
    expect(serviceStorageRemovals).toEqual([[farmerStorageUploads[0]!.path]])
    expect(analysisInserts).toHaveLength(0)
    expect(mocks.runPendingAnalysisPipeline).not.toHaveBeenCalled()
  })
})

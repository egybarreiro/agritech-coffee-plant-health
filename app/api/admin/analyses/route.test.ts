import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  createServiceClient: vi.fn(),
  createAuditLog: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/admin-context', () => ({
  getAdminContext: mocks.getAdminContext,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: mocks.createAuditLog,
}))

import { GET, PATCH } from './route'

const adminId = '11111111-1111-4111-8111-111111111111'
const analysisId = '22222222-2222-4222-8222-222222222222'
const farmerId = '12121212-1212-4212-8212-121212121212'
const plantId = '13131313-1313-4313-8313-131313131313'
const imageId = '14141414-1414-4414-8414-141414141414'

const review = {
  analysis_id: analysisId,
  general_health_assessment: 'Se observan daños leves en algunas hojas.',
  estimated_severity: 'low',
  detected_symptoms: ['manchas pequeñas'],
  recommended_preventive_actions: ['observar hojas nuevas'],
  recommended_corrective_actions: [],
  follow_up_instructions: '',
  expert_inspection_recommended: false,
}

function makeRequest(body: unknown) {
  return new Request('https://example.test/api/admin/analyses', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/admin/analyses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.maybeSingle.mockResolvedValue({
      data: { id: analysisId, status: 'completed', completed_at: '2026-11-01T12:00:00.000Z' },
      error: null,
    })
    mocks.createAuditLog.mockResolvedValue(undefined)
  })

  it('requires administrator context before creating a service client', async () => {
    const denied = Response.json({ error: 'Unauthorized' }, { status: 401 })
    mocks.getAdminContext.mockResolvedValue({ response: denied })

    const response = await PATCH(makeRequest(review))

    expect(response).toBeDefined()
    expect(response!.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('updates the analysis and writes audit through the server service client', async () => {
    const inStatus = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ maybeSingle: mocks.maybeSingle }),
    })
    const eq = vi.fn().mockReturnValue({ in: inStatus })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    const serviceClient = { from }
    const sessionQuery = vi.fn()
    mocks.getAdminContext.mockResolvedValue({
      user: { id: adminId },
      supabase: { from: sessionQuery },
    })
    mocks.createServiceClient.mockReturnValue(serviceClient)

    const response = await PATCH(makeRequest(review))

    expect(response).toBeDefined()
    expect(response!.status).toBe(200)
    expect(from).toHaveBeenCalledWith('analyses')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      model_provider: 'human-review',
      confidence_score: null,
    }))
    expect(sessionQuery).not.toHaveBeenCalled()
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      serviceClient,
      adminId,
      'analysis.human_review_completed',
      'analyses',
      analysisId,
      { provider: 'human-review', severity: 'low' },
    )
  })

  it('rejects incomplete reviews before writing to the database', async () => {
    mocks.getAdminContext.mockResolvedValue({ user: { id: adminId }, supabase: {} })

    const response = await PATCH(makeRequest({ ...review, estimated_severity: 'critical' }))

    expect(response).toBeDefined()
    expect(response!.status).toBe(400)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })
})

type Rows = Array<Record<string, unknown>>

/** Chainable fake that actually applies `.in`/`.eq` filters so a table can be
 * queried with different columns (e.g. plant_images by `id` AND by
 * `analysis_id` + `image_role`). */
function tableClient(rows: Rows) {
  let filtered = rows
  const chain = {
    select: () => chain,
    in: (column: string, values: Array<string | number>) => {
      const wanted = new Set(values.map(String))
      filtered = filtered.filter((row) => wanted.has(String(row[column])))
      return chain
    },
    eq: (column: string, value: string | number) => {
      filtered = filtered.filter((row) => String(row[column]) === String(value))
      return chain
    },
    order: () => chain,
    limit: () => chain,
    then: (
      onFulfilled?: (value: { data: Rows; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected),
  }
  return chain
}

const cropId = '77777777-7777-4777-8777-777777777777'
const storagePath = `${farmerId}/88888888-8888-4888-8888-888888888888/photo.jpg`

const leafImageId = '15151515-1515-4515-8515-151515151515'
const leafStoragePath = `${farmerId}/88888888-8888-4888-8888-888888888888/leaf.jpg`

const adminGetFixture: Record<string, Rows> = {
  analyses: [
    { id: analysisId, plant_image_id: imageId, status: 'pending', submitted_at: '2026-11-02T00:00:00.000Z' },
  ],
  plant_images: [
    {
      id: imageId,
      plant_id: plantId,
      submitted_by: farmerId,
      storage_bucket: 'plant-images',
      storage_path: storagePath,
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      submitted_at: '2026-11-02T00:00:00.000Z',
    },
    {
      // Complementary leaf close-up attached to the same assessment.
      id: leafImageId,
      analysis_id: analysisId,
      plant_id: plantId,
      storage_bucket: 'plant-images',
      storage_path: leafStoragePath,
      filename: 'leaf.jpg',
      mime_type: 'image/jpeg',
      image_role: 'leaf_details',
      submitted_at: '2026-11-02T00:00:01.000Z',
    },
  ],
  plants: [{ id: plantId, name: 'Finca La Vega', crop_id: cropId }],
  profiles: [{ id: farmerId, full_name: 'Ana Pérez' }],
  crops: [{ id: cropId, name: 'coffee' }],
}

describe('GET /api/admin/analyses — administrator image access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAuditLog.mockResolvedValue(undefined)
  })

  it('requires administrator context', async () => {
    const denied = Response.json({ error: 'Unauthorized' }, { status: 401 })
    mocks.getAdminContext.mockResolvedValue({ response: denied })

    const response = await GET()

    expect(response).toBeDefined()
    expect(response!.status).toBe(401)
  })

  it('lists pending analyses with signed private image links and joined metadata', async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
      error: null,
    }))

    mocks.getAdminContext.mockResolvedValue({
      user: { id: adminId },
      supabase: {
        from: (table: string) => tableClient(adminGetFixture[table] ?? []),
        storage: { from: () => ({ createSignedUrls }) },
      },
    })

    const response = await GET()
    const json = await response!.json()

    expect(response!.status).toBe(200)
    expect(json.analyses).toHaveLength(1)
    expect(json.analyses[0]).toEqual(
      expect.objectContaining({
        id: analysisId,
        status: 'pending',
        filename: 'photo.jpg',
        image_url: `signed:${storagePath}`,
        plant_name: 'Finca La Vega',
        crop_name: 'coffee',
        farmer_name: 'Ana Pérez',
        // The admin queue distinguishes the assessment's framing photo from
        // the complementary leaf close-ups.
        leaf_images: [
          {
            id: leafImageId,
            image_url: `signed:${leafStoragePath}`,
            filename: 'leaf.jpg',
            mime_type: 'image/jpeg',
          },
        ],
      }),
    )
    expect(createSignedUrls).toHaveBeenCalledWith([storagePath, leafStoragePath], 3600)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('returns an empty leaf_images list for analyses without complementary close-ups', async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
      error: null,
    }))

    mocks.getAdminContext.mockResolvedValue({
      user: { id: adminId },
      supabase: {
        from: (table: string) => tableClient({ ...adminGetFixture, plant_images: [adminGetFixture.plant_images[0]!] }[table] ?? []),
        storage: { from: () => ({ createSignedUrls }) },
      },
    })

    const response = await GET()
    const json = await response!.json()

    expect(response!.status).toBe(200)
    expect(json.analyses[0].leaf_images).toEqual([])
  })
})

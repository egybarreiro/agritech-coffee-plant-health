import { describe, expect, it } from 'vitest'
import { adminAnalysisReviewSchema, toAnalysisUpdate } from './analysis-review'

const baseReview = {
  analysis_id: '00000000-0000-4000-8000-000000000001',
  general_health_assessment: 'Se observan daños leves en algunas hojas.',
  estimated_severity: 'low' as const,
  detected_symptoms: ['manchas pequeñas'],
  recommended_preventive_actions: ['observar hojas nuevas'],
  recommended_corrective_actions: [],
  follow_up_instructions: '',
  expert_inspection_recommended: false,
}

describe('human analysis review', () => {
  it('requires expert follow-up for high and critical severity', () => {
    expect(adminAnalysisReviewSchema.safeParse({ ...baseReview, estimated_severity: 'high' }).success).toBe(false)
    expect(adminAnalysisReviewSchema.safeParse({ ...baseReview, estimated_severity: 'critical' }).success).toBe(false)
    expect(adminAnalysisReviewSchema.safeParse({ ...baseReview, estimated_severity: 'critical', expert_inspection_recommended: true }).success).toBe(true)
  })

  it('records human provenance and does not invent model confidence', () => {
    const review = adminAnalysisReviewSchema.parse(baseReview)
    const update = toAnalysisUpdate(review, '2026-11-01T12:00:00.000Z')
    expect(update).toMatchObject({
      status: 'completed',
      model_provider: 'human-review',
      model_version: 'manual-review-v1',
      confidence_score: null,
      estimated_severity: 'low',
      analysis_timestamp: '2026-11-01T12:00:00.000Z',
    })
  })
})

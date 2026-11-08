import { z } from 'zod'

const notesSchema = z.array(z.string().trim().min(1).max(240)).max(12)

export const adminAnalysisReviewSchema = z.object({
  analysis_id: z.string().uuid(),
  general_health_assessment: z.string().trim().min(20).max(2000),
  estimated_severity: z.enum(['none', 'low', 'medium', 'high', 'critical', 'unknown']),
  detected_symptoms: notesSchema,
  recommended_preventive_actions: notesSchema,
  recommended_corrective_actions: notesSchema,
  follow_up_instructions: z.string().trim().max(1000),
  expert_inspection_recommended: z.boolean(),
}).superRefine((review, context) => {
  if (['high', 'critical'].includes(review.estimated_severity) && !review.expert_inspection_recommended) {
    context.addIssue({
      code: 'custom',
      path: ['expert_inspection_recommended'],
      message: 'High or critical severity requires expert follow-up.',
    })
  }
})

export type AdminAnalysisReview = z.infer<typeof adminAnalysisReviewSchema>

export function toAnalysisUpdate(review: AdminAnalysisReview, completedAt = new Date().toISOString()) {
  return {
    status: 'completed' as const,
    model_provider: 'human-review',
    model_version: 'manual-review-v1',
    confidence_score: null,
    estimated_severity: review.estimated_severity,
    general_health_assessment: review.general_health_assessment,
    detected_symptoms: review.detected_symptoms,
    recommended_preventive_actions: review.recommended_preventive_actions,
    recommended_corrective_actions: review.recommended_corrective_actions,
    follow_up_instructions: review.follow_up_instructions || null,
    expert_inspection_recommended: review.expert_inspection_recommended,
    analysis_timestamp: completedAt,
    completed_at: completedAt,
    error_message: null,
  }
}

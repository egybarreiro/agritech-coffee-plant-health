import { z } from 'zod'

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254),
})

export const passwordUpdateSchema = z.object({
  password: z.string().min(12).max(128),
})

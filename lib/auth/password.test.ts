import { describe, expect, it } from 'vitest'
import { passwordResetRequestSchema, passwordUpdateSchema } from './password'

describe('password recovery validation', () => {
  it('accepts valid reset emails and rejects malformed values', () => {
    expect(passwordResetRequestSchema.safeParse({ email: 'farmer@example.com' }).success).toBe(true)
    expect(passwordResetRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })

  it('requires new passwords to have at least 12 characters', () => {
    expect(passwordUpdateSchema.safeParse({ password: 'Short123!' }).success).toBe(false)
    expect(passwordUpdateSchema.safeParse({ password: 'LongerPass123!' }).success).toBe(true)
  })
})

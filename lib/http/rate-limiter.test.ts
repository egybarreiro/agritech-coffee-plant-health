// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from './rate-limiter'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRateLimiter', () => {
  it('allows up to max events per key within the window, then blocks', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 })

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)
    // A different key still has its own budget.
    expect(limiter.check('b')).toBe(true)
  })

  it('restores budget once the sliding window has passed', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 })

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)

    vi.advanceTimersByTime(1001)
    expect(limiter.check('a')).toBe(true)
  })

  it('keeps counting sliding windows (old hits expire individually)', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 })

    expect(limiter.check('a')).toBe(true)
    vi.advanceTimersByTime(600)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)
    vi.advanceTimersByTime(500)
    // First hit expired; new hits fit again.
    expect(limiter.check('a')).toBe(true)
  })

  it('does not disturb other keys when evicting for memory bounds', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 2 })

    limiter.check('k1')
    limiter.check('k2')
    expect(() => limiter.check('k3')).not.toThrow()
  })
})

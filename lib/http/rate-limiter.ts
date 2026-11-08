/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for a single-instance deployment: entries live per server process
 * and are NOT shared across instances or cold starts. For multi-instance
 * deployments a shared store (e.g. Redis/Durable Objects) would be required —
 * documented in docs/farmer-registration.md.
 */
export type RateLimiterOptions = {
  /** Sliding window length in milliseconds. */
  windowMs: number
  /** Maximum events accepted per key within the window. */
  max: number
  /** Upper bound on tracked keys to bound memory usage. */
  maxKeys?: number
}

export type RateLimiter = {
  /** Returns true when the key still has budget; records an otherwise-ignored hit. */
  check(key: string): boolean
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>()
  const maxKeys = options.maxKeys ?? 10_000

  return {
    check(key: string): boolean {
      const now = Date.now()
      const windowStart = now - options.windowMs

      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart)
      if (recent.length >= options.max) {
        hits.set(key, recent)
        return false
      }
      recent.push(now)

      if (hits.size >= maxKeys) {
        // Evict a key that currently has no recent hits to bound memory.
        for (const [candidate, timestamps] of hits) {
          if (timestamps.length === 0) {
            hits.delete(candidate)
            break
          }
        }
      }
      hits.set(key, recent)
      return true
    },
  }
}

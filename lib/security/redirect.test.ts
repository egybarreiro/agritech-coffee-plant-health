import { describe, expect, it } from 'vitest'
import { isSafeInternalRedirect, safeInternalRedirect } from './redirect'

describe('internal redirect validation', () => {
  const origin = 'https://agritech.example'

  it('allows local paths and query strings', () => {
    expect(isSafeInternalRedirect('/dashboard', origin)).toBe(true)
    expect(isSafeInternalRedirect('/dashboard/plants?crop=coffee', origin)).toBe(true)
  })

  it('rejects external, protocol-relative, backslash, and control-character paths', () => {
    expect(isSafeInternalRedirect('https://evil.example', origin)).toBe(false)
    expect(isSafeInternalRedirect('//evil.example', origin)).toBe(false)
    expect(isSafeInternalRedirect('/\\evil.example', origin)).toBe(false)
    expect(isSafeInternalRedirect('/dashboard\nhttps://evil.example', origin)).toBe(false)
  })

  it('uses the fallback for unsafe destinations', () => {
    expect(safeInternalRedirect('//evil.example', origin)).toBe('/dashboard')
    expect(safeInternalRedirect('/admin', origin, '/home')).toBe('/admin')
  })
})

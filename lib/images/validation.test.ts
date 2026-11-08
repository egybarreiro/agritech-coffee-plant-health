import { describe, expect, it } from 'vitest'
import { hasMatchingImageSignature } from './validation'

describe('image signature validation', () => {
  it('accepts matching JPEG, PNG, and WebP signatures', () => {
    expect(hasMatchingImageSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true)
    expect(hasMatchingImageSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(hasMatchingImageSignature('image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]))).toBe(true)
  })

  it('rejects spoofed MIME types, unsupported formats, and short headers', () => {
    expect(hasMatchingImageSignature('image/png', Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false)
    expect(hasMatchingImageSignature('image/svg+xml', Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBe(false)
    expect(hasMatchingImageSignature('image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBe(false)
  })
})

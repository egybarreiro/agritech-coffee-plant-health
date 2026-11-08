import { describe, expect, it } from 'vitest'
import { readBoundedJson } from './read-bounded-json'

describe('readBoundedJson', () => {
  it('parses JSON within the configured limit', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ name: 'coffee plant' }),
    })

    await expect(readBoundedJson(request)).resolves.toEqual({
      ok: true,
      value: { name: 'coffee plant' },
    })
  })

  it('rejects an oversized body while reading the stream', async () => {
    const request = new Request('https://example.test/api', {
      method: 'POST',
      body: JSON.stringify({ description: 'a'.repeat(32) }),
    })

    await expect(readBoundedJson(request, 16)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    })
  })

  it('rejects invalid JSON and invalid UTF-8', async () => {
    const invalidJson = new Request('https://example.test/api', { method: 'POST', body: '{' })
    const invalidUtf8 = new Request('https://example.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Blob([Uint8Array.of(0xff)]),
    })

    await expect(readBoundedJson(invalidJson)).resolves.toEqual({ ok: false, reason: 'invalid-json' })
    await expect(readBoundedJson(invalidUtf8)).resolves.toEqual({ ok: false, reason: 'invalid-json' })
  })
})

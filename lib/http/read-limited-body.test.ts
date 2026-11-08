import { describe, expect, it, vi } from 'vitest'
import { readBodyWithinLimit } from './read-limited-body'

describe('readBodyWithinLimit', () => {
  it('assembles a body that stays within the byte limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.enqueue(Uint8Array.of(3, 4))
        controller.close()
      },
    })

    await expect(readBodyWithinLimit(stream, 4)).resolves.toEqual({
      ok: true,
      body: Uint8Array.of(1, 2, 3, 4),
    })
  })

  it('cancels the stream as soon as an unknown-length body exceeds the limit', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4))
        controller.enqueue(new Uint8Array(3))
      },
      cancel,
    })

    await expect(readBodyWithinLimit(stream, 6)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('accepts an empty request body', async () => {
    await expect(readBodyWithinLimit(null, 1)).resolves.toEqual({
      ok: true,
      body: new Uint8Array(),
    })
  })

  it('preserves multipart fields when rebuilding a request without Content-Length', async () => {
    const formData = new FormData()
    formData.append('plant_id', 'plant-123')
    const request = new Request('https://example.test/api/images', {
      method: 'POST',
      body: formData,
    })
    expect(request.headers.has('content-length')).toBe(false)

    const result = await readBodyWithinLimit(request.body, 1024)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const headers = new Headers(request.headers)
    headers.delete('content-length')
    const rebuilt = new Request(request.url, {
      method: request.method,
      headers,
      body: new Blob([result.body.buffer as ArrayBuffer]),
    })
    const rebuiltFormData = await rebuilt.formData()
    expect(rebuiltFormData.get('plant_id')).toBe('plant-123')
  })
})

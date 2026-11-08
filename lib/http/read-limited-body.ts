export type LimitedBodyResult =
  | { ok: true; body: Uint8Array }
  | { ok: false; reason: 'too-large' | 'read-error' }

export async function readBodyWithinLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  if (!stream) return { ok: true, body: new Uint8Array() }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // The request is already rejected; cancellation is best effort.
        }
        return { ok: false, reason: 'too-large' }
      }

      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'read-error' }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { ok: true, body }
}

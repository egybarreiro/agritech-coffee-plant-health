import { readBodyWithinLimit } from './read-limited-body'

export const MAX_JSON_BODY_BYTES = 64 * 1024

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too-large' | 'invalid-json' }

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<BoundedJsonResult> {
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return { ok: false, reason: 'invalid-json' }
    }
    if (contentLength > maxBytes) return { ok: false, reason: 'too-large' }
  }

  const bodyResult = await readBodyWithinLimit(request.body, maxBytes)
  if (!bodyResult.ok) {
    return bodyResult.reason === 'too-large'
      ? { ok: false, reason: 'too-large' }
      : { ok: false, reason: 'invalid-json' }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bodyResult.body)
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
}

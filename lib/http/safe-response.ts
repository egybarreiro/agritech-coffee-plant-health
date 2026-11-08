/**
 * Client-safe response parsing for API calls.
 *
 * API routes always intend to return JSON, but network failures, proxies, or
 * unexpected server errors can produce empty or non-JSON bodies. Parsing those
 * with `response.json()` throws "Unexpected end of JSON input" and hides the
 * real problem, so call sites use this helper and fall back to null.
 */
export async function parseJsonResponse<T = Record<string, unknown>>(
  response: Response,
): Promise<T | null> {
  try {
    const text = await response.text()
    if (!text.trim()) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

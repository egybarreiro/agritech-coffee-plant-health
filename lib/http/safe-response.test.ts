// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseJsonResponse } from './safe-response'

function responseWith(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('parseJsonResponse', () => {
  it('parses a valid JSON body', async () => {
    expect(await parseJsonResponse(responseWith('{"success":true}'))).toEqual({ success: true })
  })

  it('returns null for an empty body (previously "Unexpected end of JSON input")', async () => {
    expect(await parseJsonResponse(responseWith(''))).toBeNull()
  })

  it('returns null for a malformed JSON body', async () => {
    expect(await parseJsonResponse(responseWith('{truncated'))).toBeNull()
  })

  it('returns null for a non-JSON (e.g. HTML error page) body', async () => {
    expect(await parseJsonResponse(responseWith('<html><body>error</body></html>'))).toBeNull()
  })

  it('parses bodies from error statuses too', async () => {
    const parsed = await parseJsonResponse(responseWith('{"error":"Invalid request"}', 400))
    expect(parsed).toEqual({ error: 'Invalid request' })
  })
})

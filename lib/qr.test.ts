// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildUnitLabelPayload, parseUnitScan } from './qr'

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('buildUnitLabelPayload', () => {
  it('builds an absolute URL when the app URL is configured', () => {
    const result = buildUnitLabelPayload('https://agritech.example.com', UUID)
    expect(result).toEqual({
      payload: `https://agritech.example.com/dashboard/units/${UUID}`,
      absolute: true,
    })
  })

  it('strips a single trailing slash from the app URL', () => {
    const result = buildUnitLabelPayload('https://agritech.example.com/', UUID)
    expect(result.payload).toBe(`https://agritech.example.com/dashboard/units/${UUID}`)
    expect(result.absolute).toBe(true)
  })

  it('falls back to a relative path and flags it non-absolute when unconfigured', () => {
    expect(buildUnitLabelPayload(undefined, UUID)).toEqual({
      payload: `/dashboard/units/${UUID}`,
      absolute: false,
    })
    expect(buildUnitLabelPayload('   ', UUID)).toEqual({
      payload: `/dashboard/units/${UUID}`,
      absolute: false,
    })
  })
})

describe('parseUnitScan', () => {
  const origin = 'https://agritech.example.com'

  it('accepts a bare unit UUID (manual entry fallback) and lowercases it', () => {
    expect(parseUnitScan(UUID.toUpperCase(), origin)).toBe(`/dashboard/units/${UUID}`)
  })

  it('accepts an absolute same-origin unit URL, with query and trailing slash', () => {
    expect(parseUnitScan(`https://agritech.example.com/dashboard/units/${UUID}?src=qr`, origin)).toBe(
      `/dashboard/units/${UUID}`,
    )
    expect(parseUnitScan(`https://agritech.example.com/dashboard/units/${UUID}/`, origin)).toBe(
      `/dashboard/units/${UUID}`,
    )
  })

  it('rejects a URL from a foreign origin', () => {
    expect(parseUnitScan(`https://evil.example.com/dashboard/units/${UUID}`, origin)).toBeNull()
    expect(parseUnitScan(`http://agritech.example.com/dashboard/units/${UUID}`, origin)).toBeNull()
  })

  it('rejects non-unit paths on the same origin', () => {
    expect(parseUnitScan(`${origin}/dashboard/plants`, origin)).toBeNull()
    expect(parseUnitScan(`${origin}/dashboard/units`, origin)).toBeNull()
    expect(parseUnitScan(`${origin}/admin`, origin)).toBeNull()
  })

  it('rejects a malformed UUID inside a unit path', () => {
    expect(parseUnitScan(`${origin}/dashboard/units/not-a-uuid`, origin)).toBeNull()
    expect(parseUnitScan(`${origin}/dashboard/units/1234`, origin)).toBeNull()
  })

  it('rejects every other free-form text and empty input', () => {
    expect(parseUnitScan('', origin)).toBeNull()
    expect(parseUnitScan('   ', origin)).toBeNull()
    expect(parseUnitScan('hola', origin)).toBeNull()
    expect(parseUnitScan('javascript:alert(1)', origin)).toBeNull()
    expect(parseUnitScan('https://evil.example.com', origin)).toBeNull()
  })
})

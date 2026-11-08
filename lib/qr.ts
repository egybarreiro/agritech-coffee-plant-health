import { z } from 'zod'

/**
 * QR-code helpers for cultivation-unit labels.
 *
 * Labels encode an absolute, same-origin application route for the unit
 * (`/dashboard/units/<unit-id>`). Scanning stays inside the authenticated
 * application: middleware.ts and the unit detail page still enforce
 * authentication and ownership, and the scanner rejects any code that does
 * not resolve to a unit route on this app's own origin.
 */

const uuidSchema = z.string().uuid()
const UNIT_PATH_RE = /^\/dashboard\/units\/([0-9a-fA-F-]{36})\/?$/

export type UnitLabelPayload = { payload: string; absolute: boolean }

/**
 * Builds the QR payload for a unit label. Uses the configured public app URL
 * when available; otherwise falls back to a relative path (callers should
 * surface a warning because most QR scanners require an absolute URL).
 */
export function buildUnitLabelPayload(appUrl: string | undefined, unitId: string): UnitLabelPayload {
  const unitPath = `/dashboard/units/${unitId}`
  const base = (appUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) {
    return { payload: unitPath, absolute: false }
  }
  return { payload: `${base}${unitPath}`, absolute: true }
}

/**
 * Validates a scanned/typed code and returns the in-app destination path.
 * Accepts:
 *  - a bare unit UUID (manual entry fallback),
 *  - an absolute URL to this app's own `/dashboard/units/<uuid>` route.
 * Rejects external origins, other paths, and every non-URL string — so a QR
 * sticker from another system can never redirect the farmer elsewhere.
 */
export function parseUnitScan(rawText: string, appOrigin: string): string | null {
  const text = rawText.trim()
  if (!text) return null

  if (uuidSchema.safeParse(text).success) {
    return `/dashboard/units/${text.toLowerCase()}`
  }

  try {
    const url = new URL(text)
    if (url.origin !== appOrigin) return null
    const match = UNIT_PATH_RE.exec(url.pathname)
    if (!match) return null
    const id = uuidSchema.safeParse(match[1])
    if (!id.success) return null
    return `/dashboard/units/${id.data.toLowerCase()}`
  } catch {
    return null
  }
}

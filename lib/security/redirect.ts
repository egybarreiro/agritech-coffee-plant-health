export function isSafeInternalRedirect(redirectTo: string | null, origin: string) {
  if (!redirectTo || !redirectTo.startsWith('/') || redirectTo.startsWith('//') || redirectTo.includes('\\')) {
    return false
  }
  if (/[\u0000-\u001f\u007f]/.test(redirectTo)) return false

  try {
    return new URL(redirectTo, origin).origin === new URL(origin).origin
  } catch {
    return false
  }
}

export function safeInternalRedirect(redirectTo: string | null, origin: string, fallback = '/dashboard') {
  return isSafeInternalRedirect(redirectTo, origin) ? redirectTo! : fallback
}

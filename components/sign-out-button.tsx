'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { parseJsonResponse } from '@/lib/http/safe-response'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signOut() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      // Logged-out cookies are applied by the server response headers, which
      // are independent of the JSON body: on success, navigate even if the
      // body is empty or malformed.
      const result = await parseJsonResponse<{ success?: boolean; error?: string }>(response)
      if (!response.ok) {
        throw new Error(result?.error || 'No se pudo cerrar la sesión.')
      }
      router.replace('/auth/login')
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-right">
      <button type="button" onClick={signOut} disabled={busy} className="rounded-full border border-[#cbd6c9] px-4 py-2 text-sm font-semibold text-[#244b34] transition hover:bg-white disabled:opacity-60">
        {busy ? 'Cerrando…' : 'Cerrar sesión'}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
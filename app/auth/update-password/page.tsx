'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la contraseña.')
      router.replace('/dashboard')
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error. Solicita un enlace nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f1] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-[#e0e7dc] bg-white p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Acceso seguro</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1e3025]">Crea una contraseña nueva</h1>
        <p className="mt-3 text-sm leading-6 text-[#68766b]">Usa al menos 12 caracteres. El enlace de recuperación solo funciona durante el periodo de validez configurado en Supabase.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-medium text-[#34473a]">Nueva contraseña<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" /></label>
          <label className="block text-sm font-medium text-[#34473a]">Confirma la contraseña<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" /></label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Actualizando…' : 'Actualizar contraseña'}</button>
        </form>
      </section>
    </main>
  )
}

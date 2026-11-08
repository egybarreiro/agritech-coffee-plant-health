'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo enviar el enlace.')
      setMessage('Si existe una cuenta para ese correo, recibirás un enlace para crear una contraseña nueva. Revisa también la carpeta de correo no deseado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f1] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-[#e0e7dc] bg-white p-7 shadow-sm sm:p-9">
        <Link href="/auth/login" className="text-sm font-semibold text-[#4e7252] hover:underline">← Volver a iniciar sesión</Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Recuperar acceso</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1e3025]">Restablece tu contraseña</h1>
        <p className="mt-3 text-sm leading-6 text-[#68766b]">Te enviaremos un enlace seguro al correo asociado a tu cuenta.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-medium text-[#34473a]">Correo electrónico<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" /></label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-[#edf4e9] px-4 py-3 text-sm leading-6 text-[#3f6948]">{message}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Enviando…' : 'Enviar enlace de recuperación'}</button>
        </form>
      </section>
    </main>
  )
}

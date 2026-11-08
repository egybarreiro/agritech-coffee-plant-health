'use client'

import { useState, type FormEvent } from 'react'
import { parseJsonResponse } from '@/lib/http/safe-response'

type RegisterResult = {
  error?: string
  warning?: string
}

export function FarmerRegistrationForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function createFarmer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    setBusy(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), password }),
      })
      // The API is expected to answer JSON, but an empty/malformed body
      // (e.g. a crashed request or proxy error) must not break parsing.
      const result: RegisterResult | null = await parseJsonResponse(response)

      if (!response.ok) {
        const serverMessage = result?.error || ''
        const fallback =
          response.status >= 500
            ? 'El servidor no pudo procesar la solicitud. Inténtalo de nuevo más tarde.'
            : 'No se pudo crear la cuenta.'
        throw new Error(
          [serverMessage || fallback, result?.warning].filter(Boolean).join(' — '),
        )
      }
      if (!result) {
        // A 2xx without a JSON body cannot confirm the account was created;
        // report it instead of pretending success.
        throw new Error('No se pudo confirmar la creación de la cuenta. Verifica la lista de agricultores.')
      }

      setFullName('')
      setEmail('')
      setPassword('')
      setMessage('La cuenta del agricultor se creó correctamente.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
      <h2 className="text-xl font-semibold text-[#26392c]">Crear cuenta de agricultor</h2>
      <p className="mt-2 text-sm leading-6 text-[#68766b]">La cuenta se habilitará al instante. Comparte las credenciales iniciales por un canal seguro.</p>
      <form onSubmit={createFarmer} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-[#34473a]">Nombre completo<input required maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" placeholder="Nombre del agricultor" /></label>
        <label className="block text-sm font-medium text-[#34473a]">Correo electrónico<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" placeholder="agricultor@correo.com" /></label>
        <label className="block text-sm font-medium text-[#34473a]">Contraseña inicial (mínimo 12 caracteres)<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" /></label>
        {message && <p role="status" className="rounded-xl bg-[#edf4e9] px-4 py-3 text-sm text-[#3f6948]">{message}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-wait disabled:opacity-60">{busy ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
    </section>
  )
}

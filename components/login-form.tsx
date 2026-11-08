'use client'

import Link from 'next/link'
import { safeInternalRedirect } from '@/lib/security/redirect'
import { AgritechLogo } from '@/components/agritech-mark'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export function LoginForm({ callbackError }: { callbackError: string | null }) {
  const router = useRouter()
  const callbackErrorMessage = callbackError === 'invalid_code' || callbackError === 'missing_code'
    ? 'El enlace de acceso o recuperación venció o ya se utilizó. Solicita uno nuevo.'
    : ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)


  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.')
      const requested = new URLSearchParams(window.location.search).get('redirectTo')
      const destination = safeInternalRedirect(requested, window.location.origin)
      router.replace(destination)
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen bg-[#f5f7f1] lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#244b34] p-12 text-white lg:flex">
        <Link href="/" aria-label="AgriTech — inicio" className="flex items-center">
          {/* Inverse tone-on-tone for the dark brand panel (docs/brand.md) */}
          <AgritechLogo size={40} variant="inverse" />
        </Link>
        <div className="max-w-lg"><p className="text-sm font-medium text-[#c9dec8]">Tu cultivo, mejor acompañado</p><h1 className="mt-4 text-5xl font-semibold leading-tight">Cada planta cuenta su propia historia.</h1><p className="mt-5 leading-7 text-[#d5e2d4]">Accede para registrar tus plantas y consultar sus evaluaciones.</p></div>
        <p className="text-sm text-[#c9dec8]">Café (Coffea spp.)</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link href="/" aria-label="AgriTech — inicio" className="mb-12 inline-flex items-center">
            {/* Primary badge for the light mobile surface */}
            <AgritechLogo size={40} />
          </Link>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Bienvenido</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Inicia sesión</h2>
          <p className="mt-2 text-sm leading-6 text-[#68766b]">Ingresa con la cuenta que te proporcionó el administrador.</p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <label className="block text-sm font-medium text-[#34473a]">Correo electrónico<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none transition placeholder:text-[#9ba69b] focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" placeholder="tu@correo.com" /></label>
            <label className="block text-sm font-medium text-[#34473a]">Contraseña<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none transition placeholder:text-[#9ba69b] focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" placeholder="Tu contraseña" /></label><Link href="/auth/reset-password" className="-mt-2 inline-block text-sm font-semibold text-[#4e7252] hover:underline">¿Olvidaste tu contraseña?</Link>
            {(error || callbackErrorMessage) && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || callbackErrorMessage}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-wait disabled:opacity-60">{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
          </form>
          <p className="mt-7 text-sm text-[#68766b]">¿Necesitas acceso? Solicita una cuenta al administrador de tu organización.</p>
          <Link href="/" className="mt-8 inline-block text-sm font-semibold text-[#4e7252] hover:underline">Volver al inicio</Link>
        </div>
      </section>
    </main>
  )
}






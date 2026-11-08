'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { parseJsonResponse } from '@/lib/http/safe-response'
import { TurnstileWidget } from '@/components/turnstile-widget'

type RegisterResult = { error?: string; warning?: string; message?: string }

export function PublicRegistrationForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resendStatus, setResendStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    setResendStatus('')

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (!captchaToken) {
      setError('Completa la verificación anti-bots antes de continuar.')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/auth/register-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          confirm_password: confirmPassword,
          captcha_token: captchaToken,
        }),
      })
      const result: RegisterResult | null = await parseJsonResponse(response)

      if (!response.ok) {
        const fallback =
          response.status >= 500
            ? 'El servidor no pudo procesar la solicitud. Inténtalo de nuevo más tarde.'
            : 'No se pudo crear la cuenta.'
        throw new Error(
          [result?.error || fallback, result?.warning].filter(Boolean).join(' — '),
        )
      }
      if (!result) {
        throw new Error('No se pudo confirmar la creación de la cuenta. Inténtalo de nuevo.')
      }

      // Success: require email confirmation before any further access.
      setMessage(result.message || 'Revisa tu correo electrónico: debes confirmar tu cuenta antes de iniciar sesión.')
      setFullName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setCaptchaToken(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error. Inténtalo de nuevo.')
      setCaptchaToken(null)
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    setResendStatus('')
    if (!email.trim()) {
      setError('Escribe tu correo para reenviar la confirmación.')
      return
    }
    setResending(true)
    try {
      const response = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const result: RegisterResult | null = await parseJsonResponse(response)
      if (!response.ok) {
        throw new Error(result?.error || 'No se pudo reenviar la confirmación.')
      }
      setResendStatus('Si tu cuenta está pendiente de confirmación, te hemos enviado un correo nuevo.')
    } catch (reason) {
      setResendStatus('')
      setError(reason instanceof Error ? reason.message : 'No se pudo reenviar la confirmación.')
    } finally {
      setResending(false)
    }
  }

  const inputClass =
    'mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]'

  return (
    <section className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
      <h2 className="text-xl font-semibold text-[#26392c]">Crear cuenta de agricultor</h2>
      <p className="mt-2 text-sm leading-6 text-[#68766b]">
        Deberás confirmar tu correo electrónico antes de poder acceder a la plataforma.
      </p>

      {message ? (
        <div className="mt-6 space-y-4">
          <p role="status" className="rounded-xl bg-[#edf4e9] px-4 py-3 text-sm leading-6 text-[#3f6948]">
            {message}
          </p>
          <p role="status" className="text-sm font-semibold text-[#34473a]">
            Revisa tu bandeja de entrada (y spam). Hasta confirmar el correo, no podrás iniciar sesión.
          </p>
          <button
            type="button"
            onClick={() => void resendConfirmation()}
            disabled={resending}
            className="rounded-xl border border-[#cbd6c9] px-4 py-2.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4] disabled:opacity-60"
          >
            {resending ? 'Reenviando…' : 'Reenviar correo de confirmación'}
          </button>
          {resendStatus && (
            <p role="status" className="rounded-xl bg-[#edf4e9] px-4 py-3 text-sm leading-6 text-[#3f6948]">
              {resendStatus}
            </p>
          )}
          <p className="text-sm text-[#68766b]">
            ¿Ya confirmaste tu cuenta?{' '}
            <Link href="/auth/login" className="font-semibold text-[#4e7252] hover:underline">
              Inicia sesión
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={register} className="mt-6 space-y-4" noValidate>
          <label className="block text-sm font-medium text-[#34473a]">
            Nombre completo
            <input
              required
              maxLength={120}
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClass}
              placeholder="Nombre del agricultor"
            />
          </label>
          <label className="block text-sm font-medium text-[#34473a]">
            Correo electrónico
            <input
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
              placeholder="agricultor@correo.com"
            />
          </label>
          <label className="block text-sm font-medium text-[#34473a]">
            Contraseña (mínimo 12 caracteres)
            <input
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-[#34473a]">
            Confirmar contraseña
            <input
              required
              type="password"
              maxLength={128}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass}
            />
          </label>

          <TurnstileWidget onToken={setCaptchaToken} />

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
          <p className="text-center text-sm text-[#68766b]">
            ¿Ya tienes una cuenta?{' '}
            <Link href="/auth/login" className="font-semibold text-[#4e7252] hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      )}
    </section>
  )
}

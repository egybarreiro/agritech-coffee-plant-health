'use client'

import { useEffect, useRef, useState } from 'react'

type TurnstileWidgetProps = {
  /** Receives the one-time verification token, or null when expired/reset. */
  onToken: (token: string | null) => void
}

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
      theme: 'light'
    },
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_ID = 'cf-turnstile-script'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_URL
    script.async = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => {
      scriptPromise = null
      reject(new Error('turnstile script failed'))
    })
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget (public site key from
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY). The token produced here proves nothing on
 * its own: the /api/auth/register-public route re-verifies it server-side
 * with TURNSTILE_SECRET_KEY. When the site key is missing (setup pending),
 * the widget shows an explanatory notice and produces no token, so the API
 * will reject the submission (fail closed).
 */
export function TurnstileWidget({ onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) return

    let widgetId: string | null = null
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null)
            setFailed(true)
          },
          theme: 'light',
        })
      })
      .catch(() => {
        onToken(null)
        setFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId)
        } catch {
          // Widget may already be torn down during unmount.
        }
      }
    }
    // onToken is a state setter from the parent form and stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  if (!siteKey) {
    return (
      <p role="status" className="rounded-xl bg-[#fbf6ea] px-4 py-3 text-xs leading-5 text-[#725b2f]">
        La verificación anti-bots (Cloudflare Turnstile) aún no está configurada; mientras tanto, el registro
        público permanecerá deshabilitado.
      </p>
    )
  }

  if (failed) {
    return (
      <p role="status" className="rounded-xl bg-[#fbf6ea] px-4 py-3 text-xs leading-5 text-[#725b2f]">
        No se pudo cargar la verificación anti-bots. Revisa tu conexión y recarga la página.
      </p>
    )
  }

  return <div ref={containerRef} aria-label="Verificación anti-bots" />
}

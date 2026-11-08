// Default jsdom environment: client-behavior test for the public registration
// form. React createElement only (no JSX transform dependency). The Turnstile
// widget is mocked: it emits a one-time token like the real widget would, so
// the full happy path can be exercised without Cloudflare.
import { act } from 'react'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: (props: { href?: string; children?: ReactNode }) =>
    createElement('a', { href: props.href }, props.children),
  Link: (props: { href?: string; children?: ReactNode }) =>
    createElement('a', { href: props.href }, props.children),
}))

const widgetState = vi.hoisted(() => ({ emitToken: true }))

vi.mock('@/components/turnstile-widget', async () => {
  const react = await import('react')
  return {
    TurnstileWidget: (props: { onToken: (token: string | null) => void }) => {
      react.useEffect(() => {
        if (widgetState.emitToken) props.onToken('mock-captcha-token')
      }, [])
      return react.createElement('div', { 'data-testid': 'turnstile-stub' })
    },
  }
})

import { PublicRegistrationForm } from './public-registration-form'

let container: HTMLDivElement
let root: Root | null = null

function renderForm() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(PublicRegistrationForm))
  })
}

function fill(label: RegExp, value: string) {
  const labelEl = Array.from(container.querySelectorAll('label')).find((el) =>
    label.test(el.textContent ?? ''),
  )
  if (!labelEl) throw new Error(`label not found: ${label}`)
  const input = labelEl.querySelector('input')
  if (!input) throw new Error(`input not found for label: ${label}`)
  const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
  act(() => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  const button = container.querySelector('form button') as HTMLButtonElement | null
  if (!button) throw new Error('submit button not found')
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null
}

function statusText(): string | null {
  return container.querySelector('[role="status"]')?.textContent ?? null
}

beforeEach(() => {
  widgetState.emitToken = true
  renderForm()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.unstubAllGlobals()
})

describe('PublicRegistrationForm', () => {
  it('sends the payload (captcha token included, no client role key) and shows the confirmation notice', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValue(new Response('{"success":true,"message":"Revisa tu correo"}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    fill(/Nombre completo/, 'Ana Pérez')
    fill(/Correo/, 'ana@example.test')
    fill(/Contraseña \(mínimo/, 'pass-1234567890')
    fill(/Confirmar/, 'pass-1234567890')

    await submit()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/register-public')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(payload.captcha_token).toBe('mock-captcha-token')
    expect(payload.role).toBeUndefined()
    expect(statusText()).toContain('Revisa tu correo')
    expect(alertText()).toBeNull()
  })

  it('blocks submission (with a clear message) until the CAPTCHA token exists', async () => {
    // Simulate the widget producing no token (expired/failed/unconfigured).
    widgetState.emitToken = false
    act(() => {
      root?.unmount()
    })
    renderForm()

    const fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    fill(/Nombre completo/, 'Ana')
    fill(/Correo/, 'ana@example.test')
    fill(/Contraseña \(mínimo/, 'pass-1234567890')
    fill(/Confirmar/, 'pass-1234567890')

    await submit()

    expect(alertText()).toBe('Completa la verificación anti-bots antes de continuar.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports password mismatch without calling the API', async () => {
    const fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    fill(/Nombre completo/, 'Ana')
    fill(/Correo/, 'ana@example.test')
    fill(/Contraseña \(mínimo/, 'pass-1234567890')
    fill(/Confirmar/, 'diferente-password')

    await submit()

    expect(alertText()).toBe('Las contraseñas no coinciden.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Default jsdom environment: this is a browser-behavior test for the shared
// sign-out button. Written with React.createElement (no JSX) to keep the
// plain .ts transform simple.
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}))

import { SignOutButton } from './sign-out-button'

let fetchMock: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root | null = null

function renderButton() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(SignOutButton))
  })
}

function click() {
  const button = container.querySelector('button')
  if (!button) throw new Error('button not rendered')
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.unstubAllGlobals()
})

describe('SignOutButton', () => {
  it('posts to the shared logout API and navigates to /auth/login', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    renderButton()

    await act(async () => {
      click()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(mocks.replace).toHaveBeenCalledWith('/auth/login')
    expect(mocks.refresh).toHaveBeenCalled()
    expect(alertText()).toBeNull()
  })

  it('shows a meaningful error and stays on the page when logout fails with JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"Failed to sign out"}', { status: 500 }),
    )
    renderButton()

    await act(async () => {
      click()
    })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(alertText()).toBe('Failed to sign out')
  })

  it('survives an empty/non-JSON failure body without crashing', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }))
    renderButton()

    await act(async () => {
      click()
    })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(alertText()).toBe('No se pudo cerrar la sesión.')
  })

  it('navigates to /auth/login on 2xx even if the body is unexpectedly empty (cookies are already cleared)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))
    renderButton()

    await act(async () => {
      click()
    })

    expect(mocks.replace).toHaveBeenCalledWith('/auth/login')
    expect(mocks.refresh).toHaveBeenCalled()
  })
})

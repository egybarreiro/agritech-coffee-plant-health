// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { getLandingAccess, LANDING_ACTIONS } from './landing'

let getUserResult: { data: { user: { id: string } | null }; error: { message: string } | null }
let profileResult: { data: { role: string } | null; error: { message: string } | null }
let clientThrows: boolean

function makeClient() {
  if (clientThrows) throw new Error('client construction failed')
  return {
    auth: { getUser: vi.fn(async () => getUserResult) },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(profileResult),
          }),
        }),
      }
    },
  }
}

beforeEach(() => {
  mocks.createClient.mockImplementation(makeClient)
  clientThrows = false
  getUserResult = { data: { user: null }, error: null }
  profileResult = { data: null, error: null }
})

describe('getLandingAccess', () => {
  it('resolves the unauthenticated experience when there is no session', async () => {
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
    expect(LANDING_ACTIONS.unauthenticated).toEqual({
      label: 'Iniciar sesión',
      ctaLabel: 'Entrar a mi espacio',
      href: '/auth/login',
    })
  })

  it('resolves the farmer experience pointing to /dashboard', async () => {
    getUserResult = { data: { user: { id: '66666666-6666-4666-8666-666666666666' } }, error: null }
    profileResult = { data: { role: 'farmer' }, error: null }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: true, role: 'farmer' })
    expect(LANDING_ACTIONS.farmer).toEqual({
      label: 'Ir a mi espacio',
      ctaLabel: 'Ir a mi espacio',
      href: '/dashboard',
    })
  })

  it('resolves the administrator experience pointing to /admin', async () => {
    getUserResult = { data: { user: { id: '55555555-5555-4555-8555-555555555555' } }, error: null }
    profileResult = { data: { role: 'administrator' }, error: null }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: true, role: 'administrator' })
    expect(LANDING_ACTIONS.administrator).toEqual({
      label: 'Ir a administración',
      ctaLabel: 'Ir a administración',
      href: '/admin',
    })
  })

  it('fails safe to the public experience when getUser returns an error', async () => {
    getUserResult = { data: { user: null }, error: { message: 'session verification failed' } }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
  })

  it('fails safe to the public experience when the profile query fails', async () => {
    getUserResult = { data: { user: { id: '66666666-6666-4666-8666-666666666666' } }, error: null }
    profileResult = { data: null, error: { message: 'profile lookup failed' } }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
  })

  it('fails safe when the profile is missing', async () => {
    getUserResult = { data: { user: { id: '66666666-6666-4666-8666-666666666666' } }, error: null }
    profileResult = { data: null, error: null }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
  })

  it('fails safe on an unexpected role value instead of trusting non-application roles', async () => {
    getUserResult = { data: { user: { id: '66666666-6666-4666-8666-666666666666' } }, error: null }
    profileResult = { data: { role: 'superuser' }, error: null }
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
  })

  it('fails safe when the server client itself throws', async () => {
    clientThrows = true
    const access = await getLandingAccess()
    expect(access).toEqual({ authenticated: false })
  })
})

describe('landing page auth safety (source conformance, cf. lib/security.test.ts)', () => {
  const pageSource = readFileSync(resolve(process.cwd(), 'app', 'page.tsx'), 'utf8')
  const landingSource = readFileSync(resolve(process.cwd(), 'lib', 'landing.ts'), 'utf8')

  it('the landing page never triggers sign-out, logout, or cookie clearing', () => {
    expect(pageSource).not.toMatch(/signOut|auth\.logout|logout/i)
    expect(pageSource).not.toMatch(/cookies\s*\.\s*(delete|set)|deleteCookie|removeCookie/i)
    expect(landingSource).not.toMatch(/signOut|auth\.logout|logout/i)
    expect(landingSource).not.toMatch(/cookies\s*\.\s*(delete|set)|deleteCookie|removeCookie/i)
  })

  it('the landing page resolves auth on the server, not from browser state', () => {
    expect(pageSource).not.toMatch(/['"]use client['"]/)
    expect(pageSource).toMatch(/from ['"]@\/lib\/landing['"]/)
    expect(landingSource).toMatch(/from ['"]@\/lib\/supabase\/server['"]/)
    expect(landingSource).not.toMatch(/localStorage|window\.|document\.|searchParams|NEXT_PUBLIC_ANON/)
  })

  it('the landing page only exposes the public client via existing fields, never secret keys', () => {
    expect(landingSource).not.toMatch(/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|createServiceClient|createAdminClient/)
    expect(pageSource).not.toMatch(/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|createServiceClient|createAdminClient/)
  })
})

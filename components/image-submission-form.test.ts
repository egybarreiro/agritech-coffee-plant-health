// Default jsdom environment: client-behavior tests for the coffee-only
// image submission form. React.createElement only (no JSX transform).
// fetch, URL.createObjectURL/revokeObjectURL and crypto.randomUUID are
// stubbed so the full two-photo flow can be exercised locally.
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

vi.mock('next/image', () => ({
  default: (props: { src?: string; alt?: string }) =>
    createElement('img', { src: props.src, alt: props.alt }),
}))

import { ImageSubmissionForm } from './image-submission-form'

const plants = [
  { id: 'plant-cof-1', name: 'Café lote A', crop_id: 'crop-cof-1', crop_name: 'coffee' },
  { id: 'plant-cof-2', name: 'Café lote B', crop_id: 'crop-cof-1', crop_name: 'coffee' },
]
const coffePlantId = plants[0]!.id

let fetchMock: ReturnType<typeof vi.fn>
let uuidCounter = 0
let blobCounter = 0

type FormDataGet = (name: string) => FormDataEntryValue | null
function bodyOf(callIndex: number, field: string): FormDataEntryValue | null {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body: FormData } | undefined
  if (!init) return null
  return (init.body.get as FormDataGet)(field)
}

function json201(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 201, headers: { 'content-type': 'application/json' } })
}

// Deterministic mock backend: full-plant uploads create the assessment once;
// leaf uploads never create one — mirrors the API contract.
const fullImageId = 'img-full-1'
const analysisId = 'an-1'
let fullPlantCalls = 0
let leafCalls = 0
function routeFetch(_url: RequestInfo | URL, init?: RequestInit) {
  const form = init?.body as FormData
  const role = form.get('image_role')
  if (role === 'leaf_details') {
    leafCalls += 1
    return Promise.resolve(json201({ image: { id: `img-leaf-${leafCalls}` }, analysis: null, linked_analysis_id: analysisId }))
  }
  fullPlantCalls += 1
  return Promise.resolve(json201({ image: { id: fullImageId }, analysis: { id: analysisId, status: 'pending' } }))
}

let container: HTMLDivElement
let root: Root | null = null

function renderForm(initialPlantId?: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(createElement(ImageSubmissionForm, { plants, initialPlantId }))
  })
}

function fileInputByAriaLabel(label: string): HTMLInputElement {
  const input = container.querySelector(`input[type="file"][aria-label="${label}"]`)
  if (!input) throw new Error(`file input not found: ${label}`)
  return input as HTMLInputElement
}

function chooseFiles(input: HTMLInputElement, files: File[]) {
  const fileList = Object.assign(files, {
    item: (index: number) => files[index] ?? null,
    length: files.length,
  })
  Object.defineProperty(input, 'files', { value: fileList, configurable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function makeFile(name: string) {
  return new File(['bytes'], name, { type: 'image/jpeg' })
}

const FULL_PLANT_INPUT = 'Tomar o elegir la foto de la planta completa'
const LEAF_INPUT = 'Tomar o elegir uno o varios primeros planos de hojas'

async function submitForm() {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not rendered')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

/** Returns whether the submit button with the given label is disabled. */
function submitButtonDisabled(label: string): boolean {
  const button = Array.from(container.querySelectorAll('button[type="submit"]'))
    .find((el) => el.textContent?.includes(label))
  if (!button) throw new Error(`button not found: ${label}`)
  return (button as HTMLButtonElement).disabled
}

beforeEach(() => {
  fetchMock = vi.fn((url, init) => routeFetch(url, init))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', { randomUUID: () => `leaf-key-${++uuidCounter}` })
  URL.createObjectURL = vi.fn((file: Blob) => `blob:preview-${file.size}-${++blobCounter}`) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn(() => {}) as typeof URL.revokeObjectURL
  fullPlantCalls = 0
  leafCalls = 0
  uuidCounter = 0
  blobCounter = 0
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  document.body.textContent = ''
  vi.unstubAllGlobals()
})

describe('ImageSubmissionForm — two-photo submission flow (step gating)', () => {
  it('renders two numbered required sections with pending indicators', () => {
    renderForm(coffePlantId)

    const badges = container.querySelectorAll('[aria-label*="pendiente"]')
    expect(badges.length).toBe(2)
    expect(container.textContent).toContain('Planta completa — Obligatoria')
    expect(container.textContent).toContain('Primeros planos de hojas — Obligatorios')
  })

  it('blocks submission when the full-plant photo is missing', async () => {
    renderForm(coffePlantId)
    chooseFiles(fileInputByAriaLabel(LEAF_INPUT), [makeFile('hoja1.jpg')])

    expect(submitButtonDisabled('Guardar y enviar evaluación')).toBe(true)
    await submitForm()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks submission when leaf close-up photos are missing', async () => {
    renderForm(coffePlantId)
    chooseFiles(fileInputByAriaLabel(FULL_PLANT_INPUT), [makeFile('planta-completa.jpg')])

    expect(submitButtonDisabled('Guardar y enviar evaluación')).toBe(true)
    await submitForm()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits successfully with both photo categories and reuses one assessment', async () => {
    renderForm(coffePlantId)
    chooseFiles(fileInputByAriaLabel(FULL_PLANT_INPUT), [makeFile('planta-completa.jpg')])
    chooseFiles(fileInputByAriaLabel(LEAF_INPUT), [makeFile('hoja1.jpg')])

    const button = submitButton('submit') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await submitForm()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(0, 'image_role')).toBe('full_plant')
    expect(bodyOf(0, 'analysis_id')).toBeNull()
    expect(bodyOf(1, 'image_role')).toBe('leaf_details')
    // The leaf close-up references the SAME assessment created by the
    // full-plant upload.
    expect(bodyOf(1, 'analysis_id')).toBe(analysisId)
    expect(container.textContent).toContain('Evaluación registrada')
    // Both step indicators report completion.
    const doneBadges = container.querySelectorAll('[aria-label*="completada"]')
    expect(doneBadges.length).toBe(2)
  })

  it('uploads multiple leaf close-ups sequentially against one assessment record', async () => {
    renderForm(coffePlantId)
    chooseFiles(fileInputByAriaLabel(FULL_PLANT_INPUT), [makeFile('planta-completa.jpg')])
    chooseFiles(fileInputByAriaLabel(LEAF_INPUT), [makeFile('hoja1.jpg'), makeFile('hoja2.jpg')])

    await submitForm()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(bodyOf(0, 'image_role')).toBe('full_plant')
    expect(bodyOf(1, 'analysis_id')).toBe(analysisId)
    expect(bodyOf(2, 'image_role')).toBe('leaf_details')
    expect(bodyOf(2, 'analysis_id')).toBe(analysisId)
    // Exactly one assessment was created — only the full-plant call created it.
    expect(fullPlantCalls).toBe(1)
    expect(leafCalls).toBe(2)
  })
})

function submitButton(role?: 'submit' | 'button') {
  const forms = Array.from(container.querySelectorAll('form'))
  for (const form of forms) {
    const button = form.querySelector(`button[type="${role ?? 'submit'}"]`)
    if (button) return button as HTMLButtonElement
  }
  throw new Error('submit button not found')
}

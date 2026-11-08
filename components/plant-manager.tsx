'use client'

import Link from "next/link"
import { useState, type FormEvent } from 'react'

type Crop = { id: string; name: string; scientific_name: string }
type Plant = {
  id: string
  name: string
  crop_id: string
  created_at: string
  crop?: Crop | null
}
type PlantManagerProps = {
  initialCrops: Crop[]
  initialPlants: Plant[]
  initialError?: string
}

const cropLabels: Record<string, string> = {
  coffee: 'Café',
}

export function PlantManager({ initialCrops, initialPlants, initialError = '' }: PlantManagerProps) {
  // Coffee (Coffea spp.) is the only supported crop; the schema guarantees
  // the row exists, so registration no longer needs a crop selector.
  const coffeeCropId = initialCrops.find((crop) => crop.name === 'coffee')?.id ?? initialCrops[0]?.id ?? ''
  const [plants, setPlants] = useState(initialPlants)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)

  async function createPlant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, crop_id: coffeeCropId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo registrar la planta.')
      setPlants((current) => [result.plant, ...current])
      setName('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error al registrar la planta.')
    } finally {
      setBusy(false)
    }
  }

  async function renamePlant(event: FormEvent<HTMLFormElement>, plantId: string) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/plants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: plantId, name: editingName }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo cambiar el nombre.')
      setPlants((current) => current.map((plant) => plant.id === plantId ? { ...plant, ...result.plant } : plant))
      setEditingId(null)
      setEditingName('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ocurrió un error al actualizar la planta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="h-fit rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-[#26392c]">Registrar una planta</h2>
        <p className="mt-2 text-sm leading-6 text-[#68766b]">Asigna un nombre a tu cafeto (Coffea spp.) para identificarlo.</p>
        <form onSubmit={createPlant} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-[#34473a]">Nombre<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Cafeto del patio" className="mt-2 w-full rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 outline-none focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]" /></label>
          <input type="hidden" name="crop_id" value={coffeeCropId} />
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy || loading || !coffeeCropId} className="w-full rounded-xl bg-[#244b34] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:cursor-wait disabled:opacity-60">{busy ? 'Guardando…' : 'Registrar planta'}</button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold text-[#26392c]">Tus plantas</h2><span className="rounded-full bg-[#e4ecdf] px-3 py-1 text-sm font-semibold text-[#3f6948]">{plants.length}</span></div>
        {loading ? <p className="rounded-2xl border border-[#e0e7dc] bg-white p-6 text-sm text-[#68766b]">Cargando tus plantas…</p> : plants.length === 0 ? <div className="rounded-3xl border border-dashed border-[#cbd6c9] bg-white/70 p-8 text-center"><p className="font-medium text-[#34473a]">Todavía no has registrado plantas</p><p className="mt-2 text-sm text-[#68766b]">Usa el formulario para añadir tu primera planta.</p></div> : <ul className="space-y-3">{plants.map((plant) => <li key={plant.id} className="rounded-2xl border border-[#e0e7dc] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-semibold text-[#26392c]">{plant.name}</p><p className="mt-1 text-sm text-[#68766b]">{cropLabels[plant.crop?.name ?? ''] ?? plant.crop?.name ?? 'Cultivo'} · {plant.crop?.scientific_name ?? ''}</p><p className="mt-2 text-xs text-[#8a978a]">Registrada el {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(plant.created_at))}</p></div>
            <Link href="/dashboard/submit" className="mr-3 text-xs font-semibold text-[#4e7252] hover:underline">Enviar foto</Link>
            {editingId !== plant.id && <button type="button" onClick={() => { setEditingId(plant.id); setEditingName(plant.name); setError('') }} className="rounded-full border border-[#cbd6c9] px-3 py-1.5 text-xs font-semibold text-[#244b34] hover:bg-[#f6f8f4]">Cambiar nombre</button>}
          </div>
          {editingId === plant.id && <form onSubmit={(event) => void renamePlant(event, plant.id)} className="mt-4 flex flex-wrap gap-2"><input required maxLength={80} autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} aria-label="Nuevo nombre de la planta" className="min-w-48 flex-1 rounded-xl border border-[#d7dfd3] px-3 py-2 text-sm outline-none focus:border-[#6e956e]" /><button disabled={busy} className="rounded-xl bg-[#244b34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Guardar</button><button type="button" disabled={busy} onClick={() => setEditingId(null)} className="rounded-xl border border-[#d7dfd3] px-4 py-2 text-sm text-[#56665a]">Cancelar</button></form>}
        </li>)}</ul>}
      </section>
    </div>
  )
}
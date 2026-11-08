import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { ImageSubmissionForm } from '@/components/image-submission-form'

type PlantOption = { id: string; name: string; crop_id: string; crop_name: string }

export default async function SubmitImagePage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string }>
}) {
  const { plant: plantParam } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const [plantsResult, cropsResult] = await Promise.all([
    supabase.from('plants').select('id, name, crop_id').order('name'),
    supabase.from('crops').select('id, name').eq('is_active', true),
  ])
  const cropNames = new Map((cropsResult.data ?? []).map((crop) => [crop.id, crop.name]))
  const plants: PlantOption[] = (plantsResult.data ?? []).map((plant) => ({
    ...plant,
    crop_name: cropNames.get(plant.crop_id) ?? '',
  }))

  // Deep-link preselect: honored only when it is a valid UUID that belongs to
  // one of this farmer's plants (the list is RLS-scoped to the owner, so a
  // foreign id simply falls back to the default selection).
  const isUuid = z.string().uuid().safeParse(plantParam).success
  const initialPlantId = isUuid && plants.some((plant) => plant.id === plantParam) ? plantParam : undefined

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Nueva fotografía</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/history" className="text-sm font-semibold text-[#4e7252] hover:underline">Historial</Link>
            <SignOutButton />
          </div>
        </header>
        <section className="py-10">
          <Link href="/dashboard/plants" className="text-sm font-semibold text-[#4e7252] hover:underline">← Volver a mis plantas</Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Fotografía de la planta</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[#68766b]">Selecciona una imagen JPEG, PNG o WebP de hasta 10 MB. Se requieren dos tipos de foto: la planta completa y al menos un primer plano de hojas.</p>
        </section>
        {plantsResult.error || cropsResult.error
          ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">No se pudo cargar tu lista de plantas.</p>
          : plants.length === 0
            ? <div className="rounded-3xl border border-[#e0e7dc] bg-white p-7"><p className="font-semibold text-[#26392c]">Primero registra una planta</p><p className="mt-2 text-sm text-[#68766b]">Necesitas elegir una planta antes de enviar una fotografía.</p><Link href="/dashboard/plants" className="mt-5 inline-block text-sm font-semibold text-[#4e7252] hover:underline">Ir a Mis plantas →</Link></div>
            : <ImageSubmissionForm plants={plants} initialPlantId={initialPlantId} />}
      </div>
    </main>
  )
}
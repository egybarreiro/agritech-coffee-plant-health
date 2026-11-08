import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { PlantManager } from '@/components/plant-manager'

type Crop = { id: string; name: string; scientific_name: string }
type Plant = { id: string; name: string; crop_id: string; created_at: string; crop?: Crop | null }

export default async function PlantsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const [cropResult, plantResult] = await Promise.all([
    supabase.from('crops').select('id, name, scientific_name').eq('is_active', true).order('name'),
    supabase.from('plants').select('id, name, crop_id, created_at').order('created_at', { ascending: false }),
  ])
  const crops: Crop[] = cropResult.data ?? []
  const cropById = new Map(crops.map((crop) => [crop.id, crop]))
  const plants: Plant[] = (plantResult.data ?? []).map((plant) => ({
    ...plant,
    crop: cropById.get(plant.crop_id) ?? null,
  }))
  const initialError = cropResult.error || plantResult.error
    ? 'No se pudieron cargar las plantas. Inténtalo de nuevo más tarde.'
    : ''

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Mis plantas</span>
          </Link>
          <SignOutButton />
        </header>
        <section className="py-10">
          <Link href="/dashboard" className="text-sm font-semibold text-[#4e7252] hover:underline">← Volver al panel</Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Mis plantas</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[#68766b]">Registra tus plantas de café. Solo tú podrás consultar y cambiar los nombres de tus plantas.</p>
        </section>
        <PlantManager initialCrops={crops} initialPlants={plants} initialError={initialError} />
      </div>
    </main>
  )
}
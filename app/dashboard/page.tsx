import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { CropIllustration } from '@/components/crop-illustration'
import { LivingHedge } from '@/components/living-hedge'
import { ActionTile } from '@/components/action-tile'
import { CropPhotoBanner, CropPhotoBand, CropPhotoWash } from '@/components/crop-photos'
import { CameraIcon, UploadIcon, QrIcon, PrinterIcon } from '@/components/action-icons'

type Crop = { id: string; name: string; scientific_name: string; description: string | null }
type Plant = { id: string; name: string; crop_id: string; created_at: string }

const cropLabels: Record<string, string> = {
  coffee: 'Café',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=%2Fdashboard')

  const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const [cropResult, plantResult] = await Promise.all([
    supabase.from('crops').select('id, name, scientific_name, description').eq('is_active', true).order('name'),
    supabase.from('plants').select('id, name, crop_id, created_at').order('created_at', { ascending: false }).limit(200),
  ])
  const crops: Crop[] = cropResult.data ?? []
  const plants: Plant[] = plantResult.data ?? []
  const countByCropName = new Map<string, number>()
  const cropNameById = new Map(crops.map((crop) => [crop.id, crop.name]))
  for (const plant of plants) {
    const cropName = cropNameById.get(plant.crop_id)
    if (cropName) countByCropName.set(cropName, (countByCropName.get(cropName) ?? 0) + 1)
  }

  const displayName = profile.full_name?.trim() || user.email || 'Agricultor'
  const recentPlants = plants.slice(0, 4)

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/" aria-label="AgriTech — inicio">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Panel del agricultor</span>
          </Link>
          <SignOutButton />
        </header>

        <CropPhotoBanner
          priority
          className="mt-5"
          heightClassName="h-36 sm:h-44 lg:h-52"
          caption="Tu campo, siempre a la vista: cada cafeto con su historia de salud."
        />

        <section className="flex flex-wrap items-start justify-between gap-6 py-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Espacio del agricultor</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Hola, {displayName}</h1>
            <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">
              Elige tus unidades de café para gestionarlas, o salta a una acción con tu teléfono o cámara a mano.
            </p>
          </div>
          <Link
            href="/dashboard/plants"
            className="rounded-xl border border-[#cbd6c9] bg-white px-4 py-2.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4]"
          >
            Registrar unidad →
          </Link>
        </section>

        {/* Coffee workspace entry */}
        <section aria-labelledby="crop-selector-heading" className="relative">
          <CropPhotoWash />
          <div className="relative">
            <div className="flex items-center justify-between">
              <h2 id="crop-selector-heading" className="text-xl font-semibold text-[#26392c]">Unidades de café</h2>
              <span className="rounded-full bg-[#e4ecdf] px-3 py-1 text-sm font-semibold text-[#3f6948]">{plants.length} unidades totales</span>
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {crops.length === 0 ? (
                <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">No se pudieron cargar los cultivos.</p>
              ) : (
                crops.map((crop) => (
                  <Link
                    key={crop.id}
                    href={`/dashboard/crops/${crop.name}`}
                    className="group flex flex-col overflow-hidden rounded-3xl border border-[#e0e7dc] bg-white shadow-sm transition hover:border-[#a9c89b] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6e956e38]"
                  >
                    <CropPhotoBand className="h-20 sm:h-24" />
                    <div className="flex flex-1 items-center gap-5 p-5 sm:gap-7 sm:p-6">
                      <CropIllustration className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" animated />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-[#26392c]">{cropLabels[crop.name] ?? crop.name}</h3>
                          <span className="rounded-full bg-[#e4ecdf] px-3 py-1 text-xs font-semibold text-[#3f6948]">
                            {countByCropName.get(crop.name) ?? 0} unidades
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm italic text-[#758276]">{crop.scientific_name}</p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#68766b]">{crop.description}</p>
                        <span className="mt-3 inline-block text-sm font-semibold text-[#4e7252] group-hover:underline">Abrir espacio del cultivo →</span>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Four primary actions */}
        <section aria-labelledby="primary-actions-heading" className="mt-10">
          <h2 id="primary-actions-heading" className="text-xl font-semibold text-[#26392c]">Acciones principales</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <ActionTile
              href="/dashboard/submit"
              label="Tomar una foto"
              description="Captura con la cámara y solicita la evaluación de salud de una de tus unidades."
              icon={<CameraIcon />}
            />
            <ActionTile
              href="/dashboard/submit"
              label="Subir una foto"
              description="Sube una imagen JPEG, PNG o WebP (hasta 10 MB) desde tu galería o computadora."
              icon={<UploadIcon />}
            />
            <ActionTile
              href="/dashboard/scan"
              label="Escanear QR"
              description="Abre el detalle de una unidad escaneando la etiqueta pegada en planta, maceta o bandeja."
              icon={<QrIcon />}
            />
            <ActionTile
              href="/dashboard/labels"
              label="Generar etiquetas QR"
              description="Crea e imprime etiquetas individuales o una hoja completa para tus unidades."
              icon={<PrinterIcon />}
              badge="QR"
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-[#849084]">
            «Tomar una foto» y «Subir una foto» abren la misma pantalla: en el móvil, la cámara se activa al elegir la imagen.
          </p>
        </section>

        {/* Information panels */}
        <section aria-labelledby="panels-heading" className="mt-10 grid gap-5 pb-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
            <div className="flex items-center justify-between">
              <h2 id="panels-heading" className="text-lg font-semibold text-[#26392c]">Unidades recientes</h2>
              <Link href="/dashboard/plants" className="text-sm font-semibold text-[#4e7252] hover:underline">Ver todas</Link>
            </div>
            {recentPlants.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-[#cbd6c9] bg-white/70 p-6 text-center text-sm text-[#68766b]">
                Todavía no registras unidades. Empieza por tu primer cafeto.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {recentPlants.map((plant) => (
                  <li key={plant.id}>
                    <Link
                      href={`/dashboard/units/${plant.id}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-[#e0e7dc] bg-[#fafbf9] px-4 py-3 transition hover:border-[#a9c89b]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#26392c]">{plant.name}</span>
                        <span className="text-xs text-[#758276]">{cropLabels[cropNameById.get(plant.crop_id) ?? ''] ?? 'Unidad'} · {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(plant.created_at))}</span>
                      </span>
                      <span aria-hidden="true" className="text-[#4e7252]">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold text-[#26392c]">Accesos rápidos</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li><Link href="/dashboard/plants" className="font-semibold text-[#4e7252] hover:underline">Registrar y administrar unidades →</Link></li>
              <li><Link href="/dashboard/history" className="font-semibold text-[#4e7252] hover:underline">Historial de evaluaciones →</Link></li>
              <li><Link href="/dashboard/labels" className="font-semibold text-[#4e7252] hover:underline">Hoja de etiquetas QR →</Link></li>
              <li><Link href="/dashboard/scan" className="font-semibold text-[#4e7252] hover:underline">Escanear código QR →</Link></li>
            </ul>
            <p className="mt-6 rounded-xl bg-[#edf4e9] px-4 py-3 text-xs leading-5 text-[#3f6948]">
              Las evaluaciones se procesan automáticamente y muestran su nivel de certeza; los resultados simulados se
              marcan como tales y la revisión humana sigue disponible cuando la necesites.
            </p>
          </div>
        </section>

        <LivingHedge className="mt-2" />

        <footer className="mt-auto border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — Café (Coffea spp.). Evaluaciones orientativas, no sustituyen al especialista agrícola.
          <p className="mt-1">Fotografía: David J. Stang, vía Wikimedia Commons (CC BY-SA 4.0).</p>
        </footer>
      </div>
    </main>
  )
}

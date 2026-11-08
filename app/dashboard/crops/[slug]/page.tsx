import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { CropIllustration } from '@/components/crop-illustration'
import { ActionTile } from '@/components/action-tile'
import { CameraIcon, UploadIcon, QrIcon, PrinterIcon } from '@/components/action-icons'

const SUPPORTED_SLUGS = ['coffee'] as const
type CropSlug = (typeof SUPPORTED_SLUGS)[number]

function isCropSlug(value: string): value is CropSlug {
  return (SUPPORTED_SLUGS as readonly string[]).includes(value)
}

const cropLabels: Record<CropSlug, string> = {
  coffee: 'Café',
}

type UnitRow = { id: string; name: string; created_at: string }

export default async function CropWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Coffee is the only server-controlled crop addressable; anything else 404s.
  if (!isCropSlug(slug)) {
    notFound()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const [cropResult, unitsResult] = await Promise.all([
    supabase.from('crops').select('id, name, scientific_name, description').eq('name', slug).eq('is_active', true).maybeSingle(),
    supabase.from('plants').select('id, name, created_at').order('created_at', { ascending: false }).limit(200),
  ])

  const crop = cropResult.data
  if (cropResult.error || !crop) {
    return (
      <main className="min-h-screen bg-[#f5f7f1]">
        <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">
          <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
            <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
              <AgritechLogo size={40} responsive />
            </Link>
            <SignOutButton />
          </header>
          <p role="alert" className="mt-10 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            No se pudo cargar la información de este cultivo. Inténtalo de nuevo más tarde.
          </p>
        </div>
      </main>
    )
  }

  // RLS already limits plants to the owner; filter again by crop_id in code.
  const units: UnitRow[] = ((unitsResult.data ?? []) as UnitRow[]).filter(Boolean)

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ {cropLabels[slug]}</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="flex flex-wrap items-start justify-between gap-6 py-8">
          <div className="flex items-start gap-5">
            <CropIllustration className="hidden h-24 w-24 shrink-0 sm:block" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Espacio del cultivo</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">
                {cropLabels[slug]} <span className="text-xl font-normal text-[#758276]">· {crop.scientific_name}</span>
              </h1>
              <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">{crop.description}</p>
            </div>
          </div>
          <Link
            href="/dashboard/plants"
            className="rounded-xl border border-[#cbd6c9] bg-white px-4 py-2.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4]"
          >
            Registrar unidad →
          </Link>
        </section>

        <section aria-labelledby="crop-actions-heading">
          <h2 id="crop-actions-heading" className="text-xl font-semibold text-[#26392c]">Acciones del cultivo</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <ActionTile
              href="/dashboard/submit"
              label="Tomar una foto"
              description="Captura con la cámara y registra la evaluación; después elige una unidad de este cultivo."
              icon={<CameraIcon />}
            />
            <ActionTile
              href="/dashboard/submit"
              label="Subir una foto"
              description="Sube la evidencia fotográfica (JPEG, PNG o WebP de hasta 10 MB) de tus unidades."
              icon={<UploadIcon />}
            />
            <ActionTile
              href="/dashboard/scan"
              label="Escanear QR"
              description="Encuentra una unidad de este cultivo escaneando la etiqueta pegada en planta o bandeja."
              icon={<QrIcon />}
            />
            <ActionTile
              href={`/dashboard/labels?crop=${slug}`}
              label="Etiquetas QR"
              description="Genera e imprime etiquetas para las unidades de este cultivo."
              icon={<PrinterIcon />}
              badge="QR"
            />
          </div>
        </section>

        <section aria-labelledby="crop-units-heading" className="mt-10 pb-10">
          <div className="flex items-center justify-between">
            <h2 id="crop-units-heading" className="text-xl font-semibold text-[#26392c]">Unidades de {cropLabels[slug]}</h2>
            <span className="rounded-full bg-[#e4ecdf] px-3 py-1 text-sm font-semibold text-[#3f6948]">{units.length}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#68766b]">
            Una unidad puede ser un cafeto individual en maceta, una bandeja hidropónica o un grupo de cultivo. Cada una tiene
            su identificador único y su historial.
          </p>
          {units.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-dashed border-[#cbd6c9] bg-white/70 p-8 text-center">
              <p className="font-medium text-[#34473a]">Todavía no registras unidades de {cropLabels[slug].toLowerCase()}</p>
              <Link href="/dashboard/plants" className="mt-4 inline-block text-sm font-semibold text-[#4e7252] hover:underline">
                Registrar una unidad →
              </Link>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {units.map((unit) => (
                <li key={unit.id}>
                  <Link
                    href={`/dashboard/units/${unit.id}`}
                    className="group flex h-full flex-col justify-between rounded-3xl border border-[#e0e7dc] bg-white p-5 shadow-sm transition hover:border-[#a9c89b] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6e956e38]"
                  >
                    <div>
                      <p className="font-semibold text-[#26392c]">{unit.name}</p>
                      <p className="mt-1 text-xs text-[#8a978a]">
                        ID {unit.id.slice(0, 8)}… · registrada el {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(unit.created_at))}
                      </p>
                    </div>
                    <span className="mt-4 text-sm font-semibold text-[#4e7252] group-hover:underline">Abrir detalle y bitácora →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-auto border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — Café (Coffea spp.). Evaluaciones orientativas, no sustituyen al especialista agrícola.
        </footer>
      </div>
    </main>
  )
}

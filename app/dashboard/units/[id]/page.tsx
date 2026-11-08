import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { FieldLog } from '@/components/field-log'

const idSchema = z.string().uuid()

const analysisStatusLabels: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'En proceso',
  completed: 'Completada',
  failed: 'No completada',
}

const cropLabels: Record<string, string> = {
  coffee: 'Café',
}

type UnitCrop = { name: string; scientific_name: string }
type UnitPlant = { id: string; name: string; crop_id: string; created_at: string }
type UnitImage = { id: string; filename: string; storage_bucket: string; storage_path: string; submitted_at: string }

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    notFound()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  // RLS (plants_select_own) restricts reads to the owner; a foreign or
  // nonexistent unit resolves to null and renders a 404 — no information leak.
  const plantResult = await supabase
    .from('plants')
    .select('id, name, crop_id, created_at')
    .eq('id', id)
    .maybeSingle()

  const plant = plantResult.data as UnitPlant | null
  if (plantResult.error || !plant) {
    notFound()
  }

  const [cropResult, imagesResult] = await Promise.all([
    supabase.from('crops').select('name, scientific_name').eq('id', plant.crop_id).maybeSingle(),
    supabase
      .from('plant_images')
      .select('id, filename, storage_bucket, storage_path, submitted_at')
      .eq('plant_id', plant.id)
      .order('submitted_at', { ascending: false })
      .limit(30),
  ])

  const crop = cropResult.data as UnitCrop | null
  const images = ((imagesResult.data ?? []) as UnitImage[])
  const signedResult = images.length
    ? await supabase.storage.from('plant-images').createSignedUrls(images.map((image) => image.storage_path), 3600)
    : { data: [] as Array<{ path: string; signedUrl: string | null } | null> }
  const signedByPath = new Map((signedResult.data ?? []).map((item) => [item?.path, item?.signedUrl ?? null]))

  const imageIds = images.map((image) => image.id)
  const analysesResult = imageIds.length
    ? await supabase
        .from('analyses')
        .select('id, plant_image_id, status, submitted_at')
        .in('plant_image_id', imageIds)
        .order('submitted_at', { ascending: false })
    : { data: [] as Array<{ id: string; plant_image_id: string; status: string; submitted_at: string }> }
  const analyses = (analysesResult.data ?? []).map((analysis) => ({
    ...analysis,
    filename: images.find((image) => image.id === analysis.plant_image_id)?.filename ?? '',
  }))

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Unidad</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="flex flex-wrap items-start justify-between gap-6 py-8">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-[#4e7252] hover:underline">← Volver al panel</Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">{plant.name}</h1>
            <p className="mt-2 text-sm text-[#758276]">
              {crop ? `${cropLabels[crop.name] ?? crop.name} · ${crop.scientific_name}` : 'Cultivo'} · registrada el{' '}
              {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(plant.created_at))}
            </p>
          </div>
          <Link
            href={`/dashboard/units/${plant.id}/qr`}
            className="rounded-xl border border-[#cbd6c9] bg-white px-4 py-2.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4]"
          >
            Etiqueta QR →
          </Link>
        </section>

        {/* Unit identity panel — only fields the schema actually stores */}
        <section aria-labelledby="unit-meta-heading" className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
          <h2 id="unit-meta-heading" className="text-lg font-semibold text-[#26392c]">Identificación de la unidad</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#fafbf9] p-4">
              <dt className="text-xs font-medium text-[#758276]">Identificador único</dt>
              <dd className="mt-1 break-all text-sm font-semibold text-[#26392c]">{plant.id}</dd>
            </div>
            <div className="rounded-2xl bg-[#fafbf9] p-4">
              <dt className="text-xs font-medium text-[#758276]">Cultivo</dt>
              <dd className="mt-1 text-sm font-semibold text-[#26392c]">
                {cropNamesLabel(crop)}
              </dd>
            </div>
            <div className="rounded-2xl bg-[#fafbf9] p-4">
              <dt className="text-xs font-medium text-[#758276]">Identificación QR</dt>
              <dd className="mt-1 text-sm font-semibold text-[#26392c]">
                Generada al vuelo (prototipo)
                <span className="mt-1 block text-xs font-normal leading-5 text-[#68766b]">
                  El código no se guarda en la base de datos; se genera cuando imprimes la etiqueta.
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-[#8a978a]">
            Finca y ubicación física: el esquema actual aún no incluye esos campos; llegarán con la siguiente migración de base de datos.
          </p>
        </section>

        <section aria-labelledby="photos-heading" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="photos-heading" className="text-xl font-semibold text-[#26392c]">Fotografías</h2>
              <p className="mt-1 text-sm text-[#68766b]">Evidencia fotográfica de esta unidad (máx. 30 recientes).</p>
            </div>
            <Link
              href={`/dashboard/submit?plant=${plant.id}`}
              className="rounded-xl bg-[#244b34] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#193b28]"
            >
              Añadir fotografía / solicitar análisis →
            </Link>
          </div>
          {images.length === 0 ? (
            <p className="mt-4 rounded-3xl border border-dashed border-[#cbd6c9] bg-white/70 p-8 text-center text-sm text-[#68766b]">
              Aún no hay fotografías de esta unidad.
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {images.filter((image) => signedByPath.get(image.storage_path)).map((image) => (
                <li key={image.id} className="overflow-hidden rounded-2xl border border-[#e0e7dc] bg-white shadow-sm">
                  <Image
                    src={signedByPath.get(image.storage_path) as string}
                    alt={`Fotografía de la unidad ${plant.name}`}
                    width={600}
                    height={450}
                    unoptimized
                    className="h-40 w-full bg-[#f3f5f0] object-cover"
                  />
                  <div className="p-3">
                    <p className="truncate text-xs font-medium text-[#34473a]">{image.filename}</p>
                    <p className="mt-1 text-[11px] text-[#8a978a]">
                      {new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(image.submitted_at))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* B — AI analyses from submitted photographs (kept separate from the field log) */}
        <section aria-labelledby="analyses-heading" className="mt-8">
          <h2 id="analyses-heading" className="text-xl font-semibold text-[#26392c]">Evaluaciones de salud (por fotografía)</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#68766b]">
            Cada evaluación nace de una fotografía enviada y es procesada automáticamente; el resultado con su nivel de
            certeza se consulta en el historial.
          </p>
          {analyses.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[#cbd6c9] bg-white/70 p-6 text-center text-sm text-[#68766b]">
              Aún no hay evaluaciones para las fotografías de esta unidad.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {analyses.map((analysis) => (
                <li key={analysis.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e7dc] bg-white p-4 shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#26392c]">{analysis.filename || 'Fotografía'}</p>
                    <p className="mt-1 text-xs text-[#8a978a]">
                      {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(analysis.submitted_at))}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f3f0e6] px-3 py-1 text-xs font-semibold text-[#725b2f]">
                    {analysisStatusLabels[analysis.status] ?? analysis.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/history" className="mt-4 inline-block text-sm font-semibold text-[#4e7252] hover:underline">
            Ver evaluaciones con detalle →
          </Link>
        </section>

        {/* A — Farmer-recorded field log (never presented as an AI result) */}
        <div className="mt-8 pb-10">
          <FieldLog unitId={plant.id} />
        </div>

        <footer className="mt-auto border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — Evaluaciones orientativas, no sustituyen al especialista agrícola.
        </footer>
      </div>
    </main>
  )
}

function cropNamesLabel(crop: UnitCrop | null): string {
  if (!crop) return 'Cultivo'
  return `${cropLabels[crop.name] ?? crop.name} · ${crop.scientific_name}`
}

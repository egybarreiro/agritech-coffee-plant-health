import Link from 'next/link'
import { redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { buildUnitLabelPayload } from '@/lib/qr'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo, AgritechMark } from '@/components/agritech-mark'
import { PrintButton } from '@/components/print-button'

type UnitRow = { id: string; name: string; crop_id: string }
type CropRow = { id: string; name: string }

export default async function LabelSheetPage() {

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  const [cropResult, plantsResult] = await Promise.all([
    supabase.from('crops').select('id, name'),
    supabase.from('plants').select('id, name, crop_id').order('created_at', { ascending: false }).limit(200),
  ])

  // RLS scopes plants to the owner; coffee is the only supported crop.
  const crops = (cropResult.data ?? []) as CropRow[]
  const cropNameById = new Map(crops.map((crop) => [crop.id, crop.name]))
  const units = (plantsResult.data ?? []) as UnitRow[]

  // Generate one server-rendered QR-SVG label per unit (not persisted anywhere).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const labels = await Promise.all(
    units.map(async (unit) => {
      const { payload, absolute } = buildUnitLabelPayload(appUrl, unit.id)
      const svg = await QRCode.toString(payload, {
        type: 'svg',
        margin: 1,
        width: 300,
        errorCorrectionLevel: 'M',
      })
      return { unit, payload, absolute, svg }
    }),
  )

  return (
    <main className="min-h-screen bg-[#f5f7f1] print:bg-white">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5 print:hidden">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Etiquetas QR</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="py-8 print:hidden">
          <Link href="/dashboard" className="text-sm font-semibold text-[#4e7252] hover:underline">
            ← Volver al panel
          </Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Hoja de etiquetas</h1>
              <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">
                Un código por unidad de café recién imprimible. Cada etiqueta abre el detalle de la unidad con la cuenta propietaria.
              </p>
            </div>
          </div>

          {labels.some((label) => !label.absolute) && (
            <p role="alert" className="mt-4 max-w-2xl rounded-xl bg-[#fbf6ea] px-4 py-3 text-sm leading-6 text-[#725b2f]">
              Aviso: <code>NEXT_PUBLIC_APP_URL</code> no está configurado; los códigos contienen rutas relativas y
              la mayoría de escáneres no podrá abrirlas. Configura la URL pública de la aplicación antes de imprimir.
            </p>
          )}

          <div className="mt-6">
            <PrintButton label={labels.length === 0 ? 'Imprimir' : `Imprimir ${labels.length} etiqueta${labels.length === 1 ? '' : 's'}`} />
          </div>
        </section>

        {labels.length === 0 ? (
          <p className="mb-10 rounded-3xl border border-dashed border-[#cbd6c9] bg-white/70 p-8 text-center text-sm text-[#68766b] print:hidden">
            No hay unidades para etiquetar todavía.{' '}
            <Link href="/dashboard/plants" className="font-semibold text-[#4e7252] hover:underline">
              Registra la primera
            </Link>
            .
          </p>
        ) : (
          <section aria-label="Etiquetas imprimibles" className="label-sheet mb-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {labels.map((label) => (
              <article
                key={label.unit.id}
                className="flex flex-col items-center gap-3 rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm print:border print:shadow-none"
              >
                <div className="flex items-center gap-2 self-stretch">
                  {/* Monochrome ink for print (single-color safe), see docs/brand.md */}
                  <AgritechMark size={24} variant="mono" className="text-[#244b34]" />
                  <span className="text-xs font-semibold tracking-tight text-[#244b34]">AgriTech</span>
                  <span className="ml-auto max-w-[50%] truncate text-xs italic text-[#758276]">
                    {cropLabelsFor(cropNameById.get(label.unit.crop_id))}
                  </span>
                </div>
                <p className="text-base font-semibold text-[#26392c]">{label.unit.name}</p>
                <div
                  className="qr-svg [&>svg]:h-auto [&>svg]:w-full"
                  style={{ width: 160 }}
                  // Server-generated SVG from the trusted `qrcode` library.
                  dangerouslySetInnerHTML={{ __html: label.svg }}
                />
                <p className="text-center text-[10px] leading-4 text-[#5f6d62]">
                  Escanea para abrir la ficha de esta unidad.
                  <span className="mt-0.5 block break-all font-mono text-[9px] text-[#8a978a]">{label.payload}</span>
                </p>
              </article>
            ))}
          </section>
        )}

        <footer className="pb-6 text-xs leading-5 text-[#788477] print:hidden">
          AgriTech — Café (Coffea spp.).
        </footer>
      </div>

      <style>{`
        @media print {
          body { background: #ffffff; }
        }
      `}</style>
    </main>
  )
}

function cropLabelsFor(cropName: string | undefined): string {
  if (cropName === 'coffee') return 'Café'
  return ''
}

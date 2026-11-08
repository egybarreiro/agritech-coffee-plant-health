import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { buildUnitLabelPayload } from '@/lib/qr'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo, AgritechMark } from '@/components/agritech-mark'
import { PrintButton } from '@/components/print-button'

const idSchema = z.string().uuid()

export default async function UnitQrLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    notFound()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  // RLS restricts reads to the owner; a missing/foreign unit 404s.
  const plantResult = await supabase.from('plants').select('id, name, created_at').eq('id', id).maybeSingle()
  const plant = plantResult.data
  if (plantResult.error || !plant) {
    notFound()
  }

  // The QR encodes an absolute URL when NEXT_PUBLIC_APP_URL is configured;
  // otherwise it falls back to a relative path and the UI warns the farmer.
  const { payload, absolute } = buildUnitLabelPayload(process.env.NEXT_PUBLIC_APP_URL, plant.id)
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
  })

  return (
    <main className="min-h-screen bg-[#f5f7f1] print:bg-white">
      <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5 print:hidden">
          <Link href={`/dashboard/units/${plant.id}`} aria-label="AgriTech — unidad">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Etiqueta QR</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="py-8 print:hidden">
          <Link href={`/dashboard/units/${plant.id}`} className="text-sm font-semibold text-[#4e7252] hover:underline">
            ← Volver a la unidad
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Etiqueta individual</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">
            Imprime esta etiqueta y pégala en la unidad (cafeto, maceta, bandeja o grupo). El código abre el detalle
            de la unidad; el acceso exige iniciar sesión con la cuenta propietaria.
          </p>
          {!absolute && (
            <p role="alert" className="mt-4 max-w-2xl rounded-xl bg-[#fbf6ea] px-4 py-3 text-sm leading-6 text-[#725b2f]">
              Aviso: <code>NEXT_PUBLIC_APP_URL</code> no está configurado, así que el código contiene una ruta relativa.
              La mayoría de escáneres no la abrirán. Configura la URL pública de la aplicación y vuelve a generar la etiqueta.
            </p>
          )}
          <div className="mt-6">
            <PrintButton />
          </div>
        </section>

        {/* Printable label — MM×70mm-ish card; server-generated QR SVG (trusted content) */}
        <section aria-label="Etiqueta imprimible de la unidad" className="label-card mx-auto mt-4 mb-10 flex max-w-md flex-col items-center gap-4 rounded-3xl border border-[#e0e7dc] bg-white p-8 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-center gap-3 self-start">
            {/* Monochrome ink for print (single-color safe), see docs/brand.md */}
            <AgritechMark size={30} variant="mono" className="text-[#244b34]" />
            <span className="text-sm font-semibold tracking-tight text-[#244b34]">AgriTech</span>
          </div>
          <p className="text-center text-lg font-semibold text-[#26392c]">{plant.name}</p>
          <div
            className="qr-svg [&>svg]:h-auto [&>svg]:w-full"
            style={{ width: 220 }}
            // Server-generated SVG from the trusted `qrcode` library; payload is
            // built from the unit UUID and the configured app URL only.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-center text-xs leading-5 text-[#5f6d62]">
            Escanea para abrir la ficha de esta unidad.
            <span className="mt-1 block break-all font-mono text-[10px] text-[#8a978a]">{payload}</span>
          </p>
        </section>

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

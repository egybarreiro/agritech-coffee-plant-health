import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { QrScanner } from '@/components/qr-scanner'

export default async function ScanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'farmer') redirect('/admin')

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/dashboard" aria-label="AgriTech — panel del agricultor">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Escanear QR</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="py-8">
          <Link href="/dashboard" className="text-sm font-semibold text-[#4e7252] hover:underline">
            ← Volver al panel
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Escanear una unidad</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">
            Escanea la etiqueta QR pegada en tus unidades o introduce el código a mano si el navegador no admite
            la cámara. El escaneo solo acepta etiquetas emitidas por AgriTech.
          </p>
        </section>

        <QrScanner />

        <footer className="mt-10 border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — Café (Coffea spp.).
        </footer>
      </div>
    </main>
  )
}

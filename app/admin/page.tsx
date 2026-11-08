import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'
import { FarmerRegistrationForm } from '@/components/farmer-registration-form'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=%2Fadmin')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError || profile?.role !== 'administrator') redirect('/dashboard')

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/" aria-label="AgriTech — inicio">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Administración</span>
          </Link>
          <SignOutButton />
        </header>

        <section className="py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#648066]">Panel administrativo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">Hola, {profile?.full_name?.trim() || user?.email || 'administrador'}</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">Administra el acceso de los agricultores. Cada cuenta nueva tendrá el rol de agricultor y podrá registrar sus propias plantas.</p>
        </section>

        <div className="mb-6 rounded-2xl border border-[#d7e4d1] bg-[#edf4e9] p-5"><h2 className="font-semibold text-[#26392c]">Revisar fotografías pendientes</h2><p className="mt-1 text-sm text-[#68766b]">Registra revisiones humanas; la aplicación aún no genera diagnósticos automáticos.</p><Link href="/admin/analyses" className="mt-3 inline-block text-sm font-semibold text-[#3f6948] hover:underline">Abrir cola de revisión →</Link></div><div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="h-fit rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
            <p className="text-sm font-semibold text-[#648066]">Acceso y seguridad</p>
            <h2 className="mt-2 text-xl font-semibold text-[#26392c]">Cuentas de agricultores</h2>
            <p className="mt-3 text-sm leading-6 text-[#68766b]">Las cuentas se crean desde el servidor. Los agricultores no pueden asignarse permisos administrativos.</p>
            <p className="mt-5 text-sm leading-6 text-[#4e7252]">El acceso se valida tanto en el servidor como en la base de datos.</p>
          </section>
          <FarmerRegistrationForm />
        </div>

        <p className="mt-8 text-xs leading-5 text-[#8a978a]">El primer administrador debe aprovisionarse manualmente desde el servidor, según el procedimiento documentado.</p>
      </div>
    </main>
  )
}



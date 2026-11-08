import Link from 'next/link'
import { PublicRegistrationForm } from '@/components/public-registration-form'
import { AgritechLogo } from '@/components/agritech-mark'

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto grid min-h-screen max-w-3xl content-start px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/" aria-label="AgriTech — inicio">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Crear cuenta</span>
          </Link>
          <Link
            href="/auth/login"
            className="rounded-full border border-[#cbd6c9] bg-white px-4 py-2 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4]"
          >
            Iniciar sesión
          </Link>
        </header>

        <section className="py-10">
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e3025] sm:text-4xl">
            Crea tu cuenta de agricultor
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#68766b]">
            Regístrate para gestionar tus unidades de café: bitácora de campo, fotografías y etiquetas QR.
            Antes de entrar a la plataforma necesitarás <strong className="font-semibold text-[#34473a]">confirmar tu
            correo electrónico</strong>: al terminar el registro te enviaremos un correo de confirmación y tu cuenta
            permanecerá inactiva hasta que lo uses (revisa también tu carpeta de spam).
          </p>
        </section>

        <PublicRegistrationForm />

        <footer className="mt-10 border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — Café (Coffea spp.).
        </footer>
      </div>
    </main>
  )
}

import Link from 'next/link'
import { getLandingAccess, LANDING_ACTIONS } from '@/lib/landing'
import { AgritechLogo } from '@/components/agritech-mark'
import { CropIllustration } from '@/components/crop-illustration'
import { LivingHedge } from '@/components/living-hedge'
import { CropPhotoBanner, CropPhotoBand, CropPhotoWash } from '@/components/crop-photos'

export default async function HomePage() {
  // Server-side session/role resolution; fails safe to the public experience.
  const access = await getLandingAccess()
  const action = access.authenticated ? LANDING_ACTIONS[access.role] : LANDING_ACTIONS.unauthenticated

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      {/* Subtle technology grid accent behind the hero */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-96 opacity-[0.35]">
        <svg className="h-full w-full" role="presentation">
          <defs>
            <pattern id="landing-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M36 0H0v36" fill="none" stroke="#dbe5d3" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#landing-grid)" />
        </svg>
      </div>

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="AgriTech — inicio">
            <AgritechLogo size={42} responsive />
          </Link>
          <nav aria-label="Acceso principal" className="flex items-center gap-3">
            {access.authenticated && (
              <span className="hidden items-center gap-2 rounded-full bg-[#e4ecdf] px-3 py-1.5 text-xs font-semibold text-[#3f6948] sm:flex">
                <span aria-hidden="true">●</span> Sesión activa
              </span>
            )}
            {!access.authenticated && (
              <Link
                href="/auth/register"
                className="rounded-full border border-[#cbd6c9] bg-white/70 px-5 py-2.5 text-sm font-semibold text-[#244b34] backdrop-blur transition hover:bg-white"
              >
                Crear cuenta
              </Link>
            )}
            <Link
              href={action.href}
              className="rounded-full border border-[#cbd6c9] bg-white/70 px-5 py-2.5 text-sm font-semibold text-[#244b34] backdrop-blur transition hover:bg-white"
            >
              {action.label}
            </Link>
          </nav>
        </header>

        <CropPhotoBanner
          priority
          className="mt-2"
          caption="Cada cafeto cuenta su propia historia: bitácora, fotografías y salud de la planta."
        />

        <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#e0e7dc] bg-white px-4 py-2 text-sm font-medium text-[#3f6948]">
              Plataforma agrícola · Café (Coffea spp.)
            </p>
            <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight text-[#1e3025] sm:text-6xl">
              Observa tus cultivos. <span className="text-[#57805b]">Cuida cada unidad.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#617064]">
              AgriTech reúne en un solo lugar el seguimiento del cultivo de <strong className="font-semibold text-[#34473a]">café (Coffea spp.)</strong>:
              registra unidades de cultivo, documenta su bitácora de campo, etiqueta con QR y comparte la evidencia fotográfica para las evaluaciones de salud.
            </p>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#68766b]">
              Las evaluaciones se apoyan en fotografías revisadas por personal especializado; la bitácora es siempre tu registro de manejo.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={action.href}
                className="rounded-full bg-[#244b34] px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#193b28] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6e956e40]"
              >
                {action.ctaLabel}
              </Link>
              {!access.authenticated && (
                <Link
                  href="/auth/register"
                  className="rounded-full border border-[#cbd6c9] bg-white px-6 py-3.5 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6e956e40]"
                >
                  Crear cuenta de agricultor
                </Link>
              )}
              <span className="self-center rounded-full border border-[#dfe5db] bg-white px-4 py-2 text-xs font-semibold text-[#4e7252]">
                Café · Coffea spp.
              </span>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-[#e0e7dc] bg-white px-3 py-4">
                <dt className="text-xs font-medium text-[#68766b]">Unidades de cultivo</dt>
                <dd className="mt-1 text-sm font-semibold text-[#26392c]">Por planta o grupo</dd>
              </div>
              <div className="rounded-2xl border border-[#e0e7dc] bg-white px-3 py-4">
                <dt className="text-xs font-medium text-[#68766b]">Bitácora de campo</dt>
                <dd className="mt-1 text-sm font-semibold text-[#26392c]">Riego a cosecha</dd>
              </div>
              <div className="rounded-2xl border border-[#e0e7dc] bg-white px-3 py-4">
                <dt className="text-xs font-medium text-[#68766b]">Evaluaciones</dt>
                <dd className="mt-1 text-sm font-semibold text-[#26392c]">Con revisión humana</dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-5">
            <article className="relative overflow-hidden rounded-[2rem] border border-white bg-white shadow-xl shadow-[#344c3215]">
              <CropPhotoBand className="h-20 sm:h-24" />
              <div className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#758276]">Cultivo destacado</p>
                    <h2 className="mt-1 text-xl font-semibold text-[#26392c]">Café — Coffea spp.</h2>
                    <p className="mt-2 text-sm leading-6 text-[#68766b]">
                      Seguimiento por cafeto en maceta: hojas, brotes y granos en cada unidad con su propio historial y etiqueta QR.
                    </p>
                  </div>
                  <CropIllustration className="h-28 w-28 shrink-0" animated />
                </div>
                <ul className="mt-4 grid gap-2 text-sm text-[#4e7252] sm:grid-cols-2">
                  <li className="rounded-xl bg-[#edf4e9] px-3 py-2">Evaluación de hojas y brotes</li>
                  <li className="rounded-xl bg-[#edf4e9] px-3 py-2">Bitácora de manejo por cafeto</li>
                </ul>
              </div>
            </article>

            <article className="relative overflow-hidden rounded-[2rem] border border-[#e0e7dc] bg-white shadow-lg">
              <CropPhotoBand className="h-20 sm:h-24" />
              <div className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#758276]">Evidencia fotográfica</p>
                    <h2 className="mt-1 text-xl font-semibold text-[#26392c]">Dos fotos por evaluación</h2>
                    <p className="mt-2 text-sm leading-6 text-[#68766b]">
                      Planta completa y primeros planos de hojas: cada evaluación queda apoyada en la imagen completa del cafeto y en la evidencia cercana de sus hojas.
                    </p>
                  </div>
                  <CropIllustration className="h-28 w-28 shrink-0" />
                </div>
                <ul className="mt-4 grid gap-2 text-sm text-[#4e7252] sm:grid-cols-2">
                  <li className="rounded-xl bg-[#edf4e9] px-3 py-2">Planta y maceta en una foto</li>
                  <li className="rounded-xl bg-[#edf4e9] px-3 py-2">Primeros planos de hojas</li>
                </ul>
              </div>
            </article>
          </div>
        </section>

        <section className="relative border-t border-[#dfe5db] py-10">
          <CropPhotoWash />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight text-[#1e3025]">¿Cómo funciona?</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              <li className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-[#4e7252]">1 · Registra tus unidades</p>
                <p className="mt-2 text-sm leading-6 text-[#68766b]">Crea cafetos en maceta, bandejas o grupos de cultivo, cada uno con su identificador.</p>
              </li>
              <li className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-[#4e7252]">2 · Documenta y etiqueta</p>
                <p className="mt-2 text-sm leading-6 text-[#68766b]">Lleva la bitácora de campo, añade fotografías y pega etiquetas QR para seguir cada unidad en el invernadero.</p>
              </li>
              <li className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-[#4e7252]">3 · Solicita evaluaciones</p>
                <p className="mt-2 text-sm leading-6 text-[#68766b]">Envía fotografías para evaluación de salud; los resultados se revisan y registran con personal autorizado.</p>
              </li>
            </ol>
          </div>
        </section>

        <LivingHedge className="mt-2" />

        <footer className="border-t border-[#dfe5db] py-5 text-xs leading-5 text-[#788477]">
          AgriTech — café (Coffea spp.). Las evaluaciones son orientativas y no sustituyen el diagnóstico de un especialista agrícola.
          <p className="mt-1">Fotografía de cultivo: David J. Stang, vía Wikimedia Commons (CC BY-SA 4.0).</p>
        </footer>
      </div>
    </main>
  )
}

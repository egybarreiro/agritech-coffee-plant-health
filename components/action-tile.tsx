import Link from 'next/link'
import type { ReactNode } from 'react'

type ActionTileProps = {
  href: string
  label: string
  description: string
  icon: ReactNode
  /** Optional badge, e.g. "prototipo". */
  badge?: string
  className?: string
}

const iconFrame =
  'grid h-11 w-11 place-items-center rounded-2xl bg-[#e4ecdf] text-[#244b34]'

/**
 * Reusable primary-action card. Client navigation is intentionally a <Link>
 * so every action is a real, framework-managed route — no fake buttons and
 * no misleading controls.
 */
export function ActionTile({ href, label, description, icon, badge, className = '' }: ActionTileProps) {
  return (
    <Link
      href={href}
      className={`group flex h-full flex-col gap-4 rounded-3xl border border-[#e0e7dc] bg-white p-5 shadow-sm transition hover:border-[#a9c89b] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6e956e38] sm:p-6 ${className}`}
    >
      <div className="flex items-start justify-between">
        <span className={iconFrame}>{icon}</span>
        {badge && (
          <span className="rounded-full bg-[#f3f0e6] px-3 py-1 text-xs font-semibold text-[#725b2f]">{badge}</span>
        )}
      </div>
      <div>
        <p className="text-base font-semibold text-[#26392c] group-hover:text-[#244b34]">{label}</p>
        <p className="mt-1 text-sm leading-6 text-[#68766b]">{description}</p>
      </div>
      <span className="mt-auto text-sm font-semibold text-[#4e7252] group-hover:underline">Abrir →</span>
    </Link>
  )
}

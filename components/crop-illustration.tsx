type CropIllustrationProps = {
  className?: string
  /**
   * Opt-in gentle botanical motion (leaf sway / bean shimmer) driven
   * by CSS classes defined in app/globals.css — no GIF downloads, no
   * external assets, and automatically disabled with
   * `prefers-reduced-motion: reduce`. Leave off where animation would be
   * distracting or printed (QR labels).
   */
  animated?: boolean
}

/**
 * Soft vector illustration for the supported crop: coffee (Coffea spp.).
 * Used on the landing page and the farmer workspace — inline SVG keeps the
 * bundle dependency free and the visuals print- and theme-safe.
 */
export function CropIllustration({ className = '', animated = false }: CropIllustrationProps) {
  const sway = animated ? 'agri-anim-sway' : ''
  const drift = animated ? 'agri-anim-drift' : ''
  const shimmer = animated ? 'agri-anim-shimmer' : ''
  const delay1 = animated ? 'agri-anim-delay-1' : ''
  const delay2 = animated ? 'agri-anim-delay-2' : ''

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Illustración de una planta de café" className={className}>
      <defs>
        <radialGradient id="coffee-bg" cx="0.35" cy="0.25" r="1">
          <stop offset="0%" stopColor="#eef4e4" />
          <stop offset="100%" stopColor="#d9e7cd" />
        </radialGradient>
        <linearGradient id="coffee-leaf" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#3f6948" />
          <stop offset="100%" stopColor="#6f9a62" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" rx="28" fill="url(#coffee-bg)" />
      <path d="M100 172V92c0-26 12-46 34-58" stroke="#5f7a52" strokeWidth="7" strokeLinecap="round" fill="none" />
      <g className={`${drift} ${delay1}`}>
        <path d="M100 142c-22 4-38-2-48-18 21-8 37-4 50 10Z" fill="#4d7553" opacity="0.9" />
      </g>
      <g className={`${sway}`}>
        <path d="M100 118c-20-2-34-13-38-32 22-2 36 6 44 24Z" fill="url(#coffee-leaf)" />
      </g>
      <g className={`${sway} ${delay2}`}>
        <path d="M100 96c18-4 30-14 34-30-20 0-32 10-40 26Z" fill="#57805b" />
      </g>
      <g className={shimmer}>
        <circle cx="126" cy="72" r="11" fill="#bc8056" />
        <path d="M126 62c-4 3-4 17 0 20 4-3 4-17 0-20Z" fill="#7c4d26" opacity="0.75" />
        <circle cx="146" cy="96" r="9" fill="#d59a67" />
        <path d="M146 88c-3.4 2.6-3.4 13.4 0 16 3.4-2.6 3.4-13.4 0-16Z" fill="#8a5a30" opacity="0.7" />
        <circle cx="122" cy="118" r="8" fill="#a9713f" />
        <path d="M122 111c-3 2.4-3 12 0 14 3-2 3-11.6 0-14Z" fill="#663d1c" opacity="0.7" />
      </g>
      <path d="M58 172h84" stroke="#8fae7f" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}

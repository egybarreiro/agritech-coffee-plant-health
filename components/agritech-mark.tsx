/**
 * AgriTech brand identity — primary mark and logo lockup.
 *
 * Concept: "the plant as a monitored node." A single botanical leaf outline
 * with thin data traces connecting at its stem, ending in telemetry nodes —
 * plant health connected to intelligence. Deliberately minimal: no soil, no
 * canopy arcs, no clipart, no gradients in the primary rendition.
 *
 * **The monochrome single-ink mark is the standard logo** and the default for
 * every component here. Variations (see docs/brand.md):
 * - `mono`    — single-ink line version (THE primary), inherits `currentColor`;
 *               used everywhere in the UI and in any single-color context.
 * - `inverse` — fixed-white mono for dark surfaces (e.g. login brand panel).
 * - `color`   — deep-forest badge + fresh leaf. Retained only for the browser
 *               favicon / app-icon context (`app/icon.svg`), where a filled
 *               badge stays visible on any browser theme.
 *
 * The mark is a plain animated-free SVG with identical geometry across
 * variants — it stays recognizable at 16 px and in print.
 */
type AgritechMarkVariant = 'color' | 'mono' | 'inverse'

type AgritechMarkProps = {
  /** Rendered size in px (square mark). */
  size?: number
  className?: string
  variant?: AgritechMarkVariant
}

/** Shared geometry so every variant is the same shape. */
const LEAF_PATH = 'M15.8 33.2C12.6 22.4 21.4 12.2 35.2 11.6 37.4 24.2 28.6 33.4 15.8 33.2Z'
const MIDRIB_PATH = 'M18.2 30.8C22.4 27 27.4 21 33.4 13.6'
const VEINS = ['M27.6 20C26.4 18.3 24.6 17.2 22.4 17', 'M25.2 23.4C26.8 24.4 28.8 25 31 24.9']
const TRACES = [
  'M15.8 33.2C12.2 34.6 9.8 36.9 8.8 39.8',
  'M15.8 33.2C16.2 36.8 18 39.4 20.4 41',
  'M15.8 33.2C19 33.4 21.8 34.6 24 36.6',
]

type TraceNode = { cx: number; cy: number; r: number; ring?: boolean }
/** Network nodes where the traces terminate (ordered to match TRACES). */
const NODES: TraceNode[] = [
  { cx: 8.6, cy: 40.6, r: 1.6 },
  { cx: 21.4, cy: 41.5, r: 2, ring: true },
  { cx: 24.9, cy: 37.3, r: 1.3 },
]

/** Primary one-color line rendition used by `mono` and `inverse`. */
function LineMark({ ink }: { ink: string }) {
  return (
    <g fill="none">
      {/* Leaf as a confident single outline */}
      <path d={LEAF_PATH} stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
      {/* Stem-side structure */}
      <path d={MIDRIB_PATH} stroke={ink} strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
      {VEINS.map((d) => (
        <path key={d} d={d} stroke={ink} strokeWidth="0.9" strokeLinecap="round" opacity="0.4" />
      ))}
      {/* Data traces into the leaf stem */}
      <g stroke={ink} strokeWidth="1.2" strokeLinecap="round" opacity="0.75">
        {TRACES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {/* Telemetry nodes */}
      {NODES.map((node) => (
        <g key={`${node.cx}-${node.cy}`}>
          {node.ring && <circle cx={node.cx} cy={node.cy} r="4.3" stroke={ink} opacity="0.25" />}
          <circle cx={node.cx} cy={node.cy} r={node.r} fill={ink} />
        </g>
      ))}
    </g>
  )
}

export function AgritechMark({ size = 40, className = '', variant = 'mono' }: AgritechMarkProps) {
  const uid = 'agritech-identity'

  if (variant !== 'color') {
    const ink = variant === 'inverse' ? '#ffffff' : undefined
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label="AgriTech"
        className={className}
        style={ink ? { color: ink } : undefined}
      >
        <LineMark ink={ink ?? 'currentColor'} />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="AgriTech"
      className={className}
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#255238" />
          <stop offset="100%" stopColor="#152e20" />
        </linearGradient>
        <linearGradient id={`${uid}-leaf`} x1="0.15" y1="0.9" x2="0.85" y2="0.1">
          <stop offset="0%" stopColor="#4e8a52" />
          <stop offset="55%" stopColor="#74b166" />
          <stop offset="100%" stopColor="#a9d688" />
        </linearGradient>
      </defs>

      {/* Deep-forest badge */}
      <rect width="48" height="48" rx="12" fill={`url(#${uid}-bg)`} />
      {/* Quiet top-right light for depth (removed in print/mono contexts) */}
      <circle cx="39" cy="9" r="14" fill="#ffffff" opacity="0.045" />

      {/* Fresh botanical leaf */}
      <path d={LEAF_PATH} fill={`url(#${uid}-leaf)`} />
      {/* Midrib and veins cut in the badge color — crisp, quiet structure */}
      <path d={MIDRIB_PATH} stroke="#1b4029" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.8" />
      {VEINS.map((d) => (
        <path key={d} d={d} stroke="#1b4029" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.4" />
      ))}

      {/* Data traces connecting the plant into the platform */}
      <g stroke="#b7d9c0" strokeWidth="1.15" strokeLinecap="round" fill="none" opacity="0.8">
        {TRACES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {/* Telemetry nodes */}
      {NODES.map((node) => (
        <g key={`${node.cx}-${node.cy}`}>
          {node.ring && <circle cx={node.cx} cy={node.cy} r="4.3" stroke="#d7ead3" opacity="0.25" fill="none" />}
          <circle cx={node.cx} cy={node.cy} r={node.r} fill="#d7ead3" />
        </g>
      ))}
    </svg>
  )
}

type AgritechLogoProps = {
  /** Mark size in px. */
  size?: number
  className?: string
  variant?: AgritechMarkVariant
  /**
   * Hide the wordmark below the `sm` breakpoint so tight mobile headers can
   * keep only the standalone icon (it stays recognizable without text).
   */
  responsive?: boolean
}

/**
 * Primary lockup: mark + "AgriTech" wordmark, both in a single ink
 * (`#244b34` on light surfaces, white on dark via `variant="inverse"`).
 * The wordmark is real text — accessible, selectable, no extra fonts —
 * and carries the same color as the mark so the lockup reads as one
 * monochrome unit. Use this in navigation; use `AgritechMark` alone for
 * icons and tight spaces.
 */
export function AgritechLogo({ size = 40, className = '', variant = 'mono', responsive = false }: AgritechLogoProps) {
  const dark = variant === 'inverse'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2.5 sm:gap-3 ${dark ? 'text-white' : 'text-[#244b34]'} ${className}`}
      translate="no"
    >
      <AgritechMark size={size} variant={variant} />
      <span
        className={`${responsive ? 'hidden sm:inline-flex ' : ''}text-lg font-semibold tracking-tight ${
          dark ? 'text-white' : 'text-[#244b34]'
        }`}
      >
        AgriTech
      </span>
    </span>
  )
}

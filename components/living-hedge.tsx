/**
 * Decorative "living hedge" divider: a slim horizon of grass tufts that sway
 * gently (CSS classes from app/globals.css — no images, no dependencies).
 * Purely ornamental: aria-hidden, hidden from assistive tech and print,
 * and disabled automatically under `prefers-reduced-motion: reduce`.
 */
const BLADE_COLORS = ['#6f9a62', '#87a86c', '#57805b'] as const

function tuft(index: number, x: number) {
  const swayClass = index % 2 === 0 ? 'agri-anim-sway' : 'agri-anim-sway agri-anim-delay-2'
  const color = BLADE_COLORS[index % BLADE_COLORS.length]!
  // transform-origin comes from the shared class (fill-box 50% 100%):
  // every tuft rotates around the base of its own bounding box.
  return (
    <g key={index} className={swayClass}>
      <path d={`M${x} 44 C ${x - 1} 34, ${x + 3} 26, ${x + 2} 15`} stroke={color} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.75" />
      <path d={`M${x} 44 C ${x - 5} 38, ${x - 9} 31, ${x - 10} 22`} stroke={color} strokeWidth="2.1" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d={`M${x} 44 C ${x + 5} 38, ${x + 8} 30, ${x + 10} 21`} stroke={color} strokeWidth="2.1" strokeLinecap="round" fill="none" opacity="0.55" />
    </g>
  )
}

export function LivingHedge({ className = '' }: { className?: string }) {
  const tuftCount = 10
  return (
    <div aria-hidden="true" className={`select-none ${className}`}>
      <svg
        viewBox="0 0 1058 46"
        preserveAspectRatio="xMidYMax slice"
        className="h-11 w-full sm:h-14"
        role="presentation"
      >
        {Array.from({ length: tuftCount }, (_, index) => tuft(index, 40 + index * 102))}
      </svg>
    </div>
  )
}

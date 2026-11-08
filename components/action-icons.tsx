import type { ReactNode } from 'react'

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Minimal stroke icon set (24×24 viewBox) for the four primary farmer actions. */
export function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.1-1.7A2 2 0 0 1 10.9 3.4h2.2a2 2 0 0 1 1.7 1L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" />
      <circle cx="12" cy="12.5" r="3.6" />
      <circle cx="17" cy="9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M12 15V4.8m0 0L8.4 8.4M12 4.8l3.6 3.6" />
      <path d="M4.5 15.5v2.6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.6" />
    </svg>
  )
}

export function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <path d="M14 14h2.6v2.6H14Zm3.4 3.4H20V20h-2.6Zm-3.4 0h.2" strokeWidth="2.2" />
    </svg>
  )
}

export function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...strokeProps}>
      <path d="M7 8V4.8h10V8" />
      <rect x="4" y="8" width="16" height="7.5" rx="2" />
      <path d="M7 13.5h10V20H7Z" />
    </svg>
  )
}

export type IconComponent = () => ReactNode

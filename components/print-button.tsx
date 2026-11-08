'use client'

import { useState } from 'react'

/**
 * Client-side print trigger for QR label pages. All label content is
 * server-rendered; this component only calls window.print() after injecting
 * a print-only stylesheet that hides everything except the printable sheet.
 */
export function PrintButton({ label = 'Imprimir' }: { label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        try {
          window.print()
        } finally {
          // Chrome fires before/afterprint synchronously enough; a tick keeps
          // the disabled state visible without trapping a failed dialog.
          setTimeout(() => setBusy(false), 300)
        }
      }}
      className="rounded-xl bg-[#244b34] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#193b28] disabled:opacity-60 print:hidden"
    >
      {busy ? 'Preparando impresión…' : label}
    </button>
  )
}

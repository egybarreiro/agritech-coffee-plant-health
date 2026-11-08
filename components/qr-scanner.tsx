'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { parseUnitScan } from '@/lib/qr'

type DetectedBarcode = { rawValue: string }
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

/**
 * Sprint 1 QR scanning experience. Uses the browser-native BarcodeDetector
 * API when available (Chrome/Android; Safari support is partial), with an
 * explicit manual-entry fallback that accepts a pasted scan result — the raw
 * QR text or the unit UUID.
 *
 * Security: every decoded value passes through parseUnitScan, which only
 * admits same-origin /dashboard/units/<uuid> targets (or a bare unit UUID).
 * External origins and other paths are rejected — a sticker from another
 * system can never navigate the farmer elsewhere, and route access itself
 * still goes through middleware + the unit page ownership check.
 */
export function QrScanner() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const navigatingRef = useRef(false)

  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info')
  const [manual, setManual] = useState('')

  const detectorCtor = useCallback(
    (): BarcodeDetectorCtor | null =>
      typeof window !== 'undefined' && 'BarcodeDetector' in window
        ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
        : null,
    [],
  )

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current)
      loopRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const handleCode = useCallback(
    (rawValue: string) => {
      if (navigatingRef.current) return
      const destination = parseUnitScan(rawValue, window.location.origin)
      if (!destination) {
        setStatusTone('error')
        setStatus('El código no pertenece a una unidad de AgriTech. Escanea la etiqueta impresa por la aplicación.')
        return
      }
      navigatingRef.current = true
      stopCamera()
      router.push(destination)
    },
    [router, stopCamera],
  )

  async function openCamera() {
    setStatusTone('info')
    setStatus('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatusTone('error')
      setStatus('Este navegador no permite usar la cámara. Usa la entrada manual de abajo.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      setScanning(true)

      const Detector = detectorCtor()
      if (!Detector) {
        setStatusTone('error')
        setStatus('Este navegador no incluye lector de códigos nativo (BarcodeDetector). Usa la entrada manual de abajo.')
        return
      }
      const detector = new Detector({ formats: ['qr_code'] })
      loopRef.current = window.setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2) return
        try {
          const codes = await detector.detect(video)
          if (codes.length > 0) handleCode(codes[0].rawValue)
        } catch {
          // Transient decode errors are expected; keep the loop running.
        }
      }, 350)
    } catch {
      setStatusTone('error')
      setStatus('No se pudo abrir la cámara. Verifica los permisos del navegador o usa la entrada manual.')
    }
  }

  function handleManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!manual.trim()) return
    const destination = parseUnitScan(manual, window.location.origin)
    if (!destination) {
      setStatusTone('error')
      setStatus('El texto pegado no es una etiqueta de AgriTech válida. Pega el contenido del código QR (URL de la unidad) o el identificador de la unidad.')
      return
    }
    setStatusTone('info')
    setStatus('')
    router.push(destination)
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-[#26392c]">Escanear código QR</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68766b]">
          Apunta la cámara a la etiqueta de una unidad registrada (planta, maceta, bandeja o grupo).
          El código lleva al detalle de la unidad; requiere iniciar sesión con la cuenta propietaria.
        </p>
        <div className="mt-5 overflow-hidden rounded-2xl bg-[#101d15]">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-[4/3] w-full object-cover sm:aspect-video"
          />
          {!scanning && (
            <div className="grid h-56 place-items-center text-center text-sm text-[#a9c89b]">
              <span>La vista de la cámara aparecerá aquí.</span>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!scanning ? (
            <button
              type="button"
              onClick={() => void openCamera()}
              className="rounded-xl bg-[#244b34] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#193b28]"
            >
              Abrir cámara
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-xl border border-[#cbd6c9] px-5 py-3 text-sm font-semibold text-[#244b34] transition hover:bg-[#f6f8f4]"
            >
              Cerrar cámara
            </button>
          )}
          <span className="text-xs text-[#849084]">
            La cámara solo se usa mientras está abierta; nada se graba.
          </span>
        </div>
        {status && (
          <p
            role={statusTone === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-xl px-4 py-3 text-sm leading-6 ${
              statusTone === 'error' ? 'bg-red-50 text-red-700' : 'bg-[#edf4e9] text-[#3f6948]'
            }`}
          >
            {status}
          </p>
        )}
      </div>

      <div className="rounded-3xl border border-[#e0e7dc] bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-lg font-semibold text-[#26392c]">Entrada manual</h2>
        <p className="mt-2 text-sm leading-6 text-[#68766b]">
          Si tu navegador no soporta el escaneo con cámara, pega el contenido del código
          o escribe el identificador de la unidad (visible en la etiqueta impresa).
        </p>
        <form onSubmit={handleManual} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="unit-manual-entry">Contenido del código QR o identificador de la unidad</label>
          <input
            id="unit-manual-entry"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="https://…/dashboard/units/… o el identificador de la unidad"
            className="min-w-0 flex-1 rounded-xl border border-[#d7dfd3] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#6e956e] focus:ring-4 focus:ring-[#6e956e1c]"
          />
          <button
            type="submit"
            className="rounded-xl bg-[#244b34] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#193b28]"
          >
            Abrir unidad
          </button>
        </form>
      </div>
    </section>
  )
}

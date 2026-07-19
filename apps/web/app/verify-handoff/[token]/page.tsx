'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  IDENTITY_CONSENT_COPY,
  IDENTITY_CONSENT_POLICY_VERSION,
} from '@drape/shared/identity-trust'
import { createClient } from '../../../lib/supabase'

type HandoffResponse = {
  error?: string
  message?: string
  status?: string
  path?: string
  uploadToken?: string
  expiresAt?: string
}

function isLikelyMobile() {
  if (typeof navigator === 'undefined') return false
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function functionError(payload: HandoffResponse | null | undefined, fallback: string) {
  return payload?.error || payload?.message || fallback
}

export default function VerifyHandoffPage(): React.JSX.Element {
  const params = useParams<{ token: string | string[] }>()
  const rawToken = params.token
  const token = Array.isArray(rawToken) ? rawToken[0] ?? '' : rawToken
  const supabase = useMemo(() => createClient(), [])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [shutterFlash, setShutterFlash] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [consentGranted, setConsentGranted] = useState(false)
  const mobileReady = isLikelyMobile()

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const { data } = await supabase.functions.invoke<HandoffResponse>('identity-handoff-action', {
        body: { action: 'resolve-token', token },
      })
      if (cancelled) return
      if (data?.error) {
        setError(functionError(data, 'This identity handoff link is not available.'))
        return
      }
      setExpiresAt(typeof data?.expiresAt === 'string' ? data.expiresAt : null)

      if (!mobileReady) {
        setError('Open this secure link on your smartphone camera flow, or use the Drapeon mobile app to complete.')
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera capture is not available in this browser. Open inside the Drapeon mobile app to complete.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraReady(true)
      } catch {
        setError('Camera permission is required. Open inside the Drapeon mobile app to complete.')
      }
    }

    void boot()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [mobileReady, stopCamera, supabase, token])

  const captureAndSubmit = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || busy || !consentGranted) return
    setBusy(true)
    setError(null)
    setShutterFlash(true)
    window.setTimeout(() => setShutterFlash(false), 100)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const width = video.videoWidth || 1080
      const height = video.videoHeight || 1440
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Camera frame could not be captured.')
      context.drawImage(video, 0, 0, width, height)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (!nextBlob) reject(new Error('Camera frame could not be encoded.'))
          else resolve(nextBlob)
        }, 'image/jpeg', 0.9)
      })

      const uploadPrepared = await supabase.functions.invoke<HandoffResponse>('identity-handoff-action', {
        body: { action: 'create-upload-url', token },
      })
      if (uploadPrepared.error || uploadPrepared.data?.error) {
        throw new Error(functionError(uploadPrepared.data, uploadPrepared.error?.message ?? 'Could not prepare identity upload.'))
      }
      const path = uploadPrepared.data?.path
      const uploadToken = uploadPrepared.data?.uploadToken
      if (!path || !uploadToken) throw new Error('Could not prepare identity upload.')

      const { error: uploadError } = await supabase.storage
        .from('id-documents')
        .uploadToSignedUrl(path, uploadToken, blob, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const submitted = await supabase.functions.invoke<HandoffResponse>('identity-handoff-action', {
        body: {
          action: 'submit',
          token,
          storagePath: path,
          consentGranted: true,
          consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
          consentSource: 'WEB_HANDOFF',
          locale: navigator.language,
        },
      })
      if (submitted.error || submitted.data?.error) {
        throw new Error(functionError(submitted.data, submitted.error?.message ?? 'Identity review could not be submitted.'))
      }
      stopCamera()
      setSuccess(true)
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Identity review could not be submitted.')
    } finally {
      setBusy(false)
    }
  }, [busy, consentGranted, stopCamera, supabase, token])

  return (
    <main className="min-h-screen bg-bone px-5 py-8 text-ink">
      <div className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-100 ${shutterFlash ? 'opacity-95' : 'opacity-0'}`} aria-hidden="true" />
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Drapeon Trust</p>
          <h1 className="mt-3 text-4xl leading-tight">Hold your ID beside your face.</h1>
          <p className="mt-4 text-sm leading-6 text-ink/66">
            Take one live camera selfie with your physical passport, licence, or national ID visible next to your face.
          </p>
        </header>

        <section className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
          {success ? (
            <div className="p-6">
              <p className="text-sm font-semibold text-needle">Identity selfie submitted</p>
              <p className="mt-2 text-sm leading-6 text-ink/64">
                Keep the desktop setup page open. It will update automatically when review status changes.
              </p>
            </div>
          ) : error ? (
            <div className="p-6">
              <p className="text-sm font-semibold text-rust">Camera handoff paused</p>
              <p className="mt-2 text-sm leading-6 text-ink/64">{error}</p>
              <a href={`drape://verify-handoff/${encodeURIComponent(token)}`} className="mt-5 inline-flex rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
                Open inside the Drapeon mobile app to complete
              </a>
            </div>
          ) : (
            <>
              <div className="relative aspect-[3/4] overflow-hidden bg-ink">
                <video ref={videoRef} muted={true} playsInline={true} autoPlay={true} className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_36%,rgba(0,0,0,0.36)_37%,rgba(0,0,0,0.58)_100%)]" />
                <div className="pointer-events-none absolute left-1/2 top-[42%] h-[46%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-white/88 shadow-[0_0_0_999px_rgba(0,0,0,0.10)]" />
                <div className="pointer-events-none absolute left-1/2 top-[42%] h-[52%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-needle/70" />
                <div className="pointer-events-none absolute bottom-5 left-5 right-5 rounded-lg bg-black/62 p-3 text-center text-xs font-semibold leading-5 text-white shadow-lg">
                  Position your face and hold your ID card clearly inside this frame.
                </div>
              </div>
              <div className="p-5">
                <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 bg-bone/62 p-4">
                  <input
                    type="checkbox"
                    checked={consentGranted}
                    onChange={(event) => setConsentGranted(event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-needle"
                  />
                  <span className="text-xs leading-5 text-ink/66">
                    {IDENTITY_CONSENT_COPY}{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-needle underline underline-offset-2">
                      Read the Privacy Policy.
                    </a>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => { void captureAndSubmit() }}
                  disabled={!cameraReady || busy || !consentGranted}
                  className="flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:bg-ink/25"
                >
                  {busy ? 'Submitting...' : cameraReady ? 'Snap Photo' : 'Starting camera...'}
                </button>
                {expiresAt ? (
                  <p className="mt-3 text-center text-xs text-ink/44">Link expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                ) : null}
              </div>
            </>
          )}
        </section>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </main>
  )
}

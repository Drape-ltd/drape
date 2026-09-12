'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CircleStop, RefreshCw, ShieldCheck, Upload, Video, X } from 'lucide-react'
import {
  IDENTITY_CONSENT_COPY,
  TAILOR_TRUST_VIDEO_MAX_SECONDS,
  TAILOR_TRUST_VIDEO_MIN_SECONDS,
} from '@drape/shared'
import {
  createSignupMediaDraftKey,
  deleteSignupMediaDraft,
  readSignupMediaDraft,
  readVideoDurationSeconds,
  saveSignupMediaDraft,
  type SignupMediaDraftDescriptor,
} from '../lib/signup-media-draft'

const MAX_TRUST_VIDEO_BYTES = 30 * 1024 * 1024
const TRUST_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

function secondsLabel(value: number) {
  return `${Math.max(0, Math.round(value))} sec`
}

export function SignupTrustVideo({
  challengeText,
  draft,
  consentGranted,
  onDraftChange,
  onConsentChange,
  onError,
}: {
  challengeText: string
  draft: SignupMediaDraftDescriptor | null
  consentGranted: boolean
  onDraftChange: (draft: SignupMediaDraftDescriptor | null) => void
  onConsentChange: (granted: boolean) => void
  onError: (message: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraPreviewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [working, setWorking] = useState(false)

  function releaseCamera() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null
    setCameraReady(false)
    setRecording(false)
  }

  useEffect(() => {
    let active = true
    let nextUrl: string | null = null
    async function restore() {
      if (!draft) {
        setPreviewUrl(null)
        return
      }
      const blob = await readSignupMediaDraft(draft.key).catch(() => null)
      if (!active || !blob) return
      nextUrl = URL.createObjectURL(blob)
      setPreviewUrl(nextUrl)
    }
    void restore()
    return () => {
      active = false
      if (nextUrl) URL.revokeObjectURL(nextUrl)
    }
  }, [draft])

  useEffect(() => () => releaseCamera(), [])

  async function storeVideo(blob: Blob, name: string, durationSeconds: number) {
    if (!TRUST_VIDEO_TYPES.includes(blob.type)) throw new Error('Choose an MP4, MOV, or WebM video.')
    if (blob.size > MAX_TRUST_VIDEO_BYTES) throw new Error('Keep the private trust video under 30 MB.')
    if (durationSeconds < TAILOR_TRUST_VIDEO_MIN_SECONDS || durationSeconds > TAILOR_TRUST_VIDEO_MAX_SECONDS + 0.75) {
      throw new Error(`Record ${TAILOR_TRUST_VIDEO_MIN_SECONDS}–${TAILOR_TRUST_VIDEO_MAX_SECONDS} seconds so your face, voice, and phrase are clear.`)
    }
    if (draft?.key) await deleteSignupMediaDraft(draft.key).catch(() => undefined)
    const key = createSignupMediaDraftKey('trust')
    await saveSignupMediaDraft(key, blob)
    onDraftChange({
      key,
      name,
      contentType: blob.type,
      byteLength: blob.size,
      durationSeconds,
      createdAt: new Date().toISOString(),
    })
  }

  async function chooseUpload(file: File | undefined) {
    if (!file) return
    setWorking(true)
    onError(null)
    try {
      const duration = await readVideoDurationSeconds(file)
      await storeVideo(file, file.name, duration)
      releaseCamera()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'This private video could not be prepared.')
    } finally {
      setWorking(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function openCamera() {
    onError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('This browser cannot record video here. Upload a short video instead.')
      return
    }
    setWorking(true)
    try {
      releaseCamera()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = stream
        await cameraPreviewRef.current.play()
      }
      setCameraReady(true)
    } catch {
      onError('Camera or microphone access is blocked. Allow both in your browser, or upload a short video instead.')
    } finally {
      setWorking(false)
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream) return
    onError(null)
    const preferredType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onerror = () => onError('Recording stopped unexpectedly. Try again or upload a video.')
    recorder.onstop = () => {
      const duration = (Date.now() - startedAtRef.current) / 1000
      const contentType = recorder.mimeType.split(';')[0] || 'video/webm'
      const blob = new Blob(chunksRef.current, { type: contentType })
      setWorking(true)
      void storeVideo(blob, `drapeon-private-challenge-${Date.now()}.webm`, duration)
        .then(() => releaseCamera())
        .catch((cause) => onError(cause instanceof Error ? cause.message : 'This recording could not be saved.'))
        .finally(() => setWorking(false))
    }
    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setElapsedSeconds(0)
    setRecording(true)
    recorder.start(250)
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000
      setElapsedSeconds(elapsed)
      if (elapsed >= TAILOR_TRUST_VIDEO_MAX_SECONDS) stopRecording()
    }, 200)
  }

  async function removeDraft() {
    if (draft?.key) await deleteSignupMediaDraft(draft.key).catch(() => undefined)
    onDraftChange(null)
    onConsentChange(false)
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-needle/20 bg-[linear-gradient(150deg,rgba(236,244,239,0.92),rgba(255,255,255,0.98))]">
      <div className="flex items-start gap-3 border-b border-needle/12 p-4 sm:p-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-needle text-white"><ShieldCheck className="size-5" aria-hidden="true" /></div>
        <div><p className="text-sm font-semibold text-ink">Private marketplace trust video</p><p className="mt-1 text-xs leading-5 text-ink/58">Not shown on your profile. Drapeon reviewers use it to confirm a real person stands behind this studio. No government ID or face template is collected.</p></div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        <div className="rounded-[10px] border border-ink/10 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">Your randomized phrase</p>
          <p className="mt-2 text-sm leading-6 text-ink">{challengeText}</p>
        </div>

        {previewUrl && draft ? (
          <div className="grid gap-3">
            <div className="relative overflow-hidden rounded-[12px] bg-[#121815]">
              <video src={previewUrl} controls playsInline preload="metadata" className="aspect-video w-full object-contain" aria-label="Private trust video preview" />
              <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold text-white">Private · {secondsLabel(draft.durationSeconds)}</span>
            </div>
            <div role="status" className="rounded-[10px] border border-needle/18 bg-needle/7 px-4 py-3 text-sm"><p className="font-semibold text-ink">Video ready on this device</p><p className="mt-1 text-xs leading-5 text-ink/58">Not submitted yet. It uploads securely after you create the account and confirm your email in this browser.</p></div>
            <button type="button" onClick={() => void removeDraft()} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink/10 bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-bone"><RefreshCw className="size-4" />Record or choose again</button>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-[12px] bg-[#121815]">
              <video ref={cameraPreviewRef} muted playsInline className={`aspect-video w-full object-cover ${cameraReady ? 'block' : 'hidden'}`} aria-label="Camera preview" />
              {!cameraReady ? <div className="grid aspect-video place-items-center px-6 text-center text-white"><div><Video className="mx-auto size-8" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">See your camera preview before recording</p><p className="mt-1 text-xs leading-5 text-white/65">Keep your face visible and say the full phrase above.</p></div></div> : null}
              {recording ? <span className="absolute left-3 top-3 rounded-full bg-rust px-3 py-1 text-[11px] font-semibold text-white">Recording · {secondsLabel(elapsedSeconds)}</span> : null}
            </div>
            <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(event) => void chooseUpload(event.target.files?.[0])} />
            <div className="grid gap-2 sm:grid-cols-2">
              {!cameraReady ? <button type="button" disabled={working} onClick={() => void openCamera()} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-needle px-4 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:opacity-45"><Camera className="size-4" />Use camera</button> : recording ? <button type="button" onClick={stopRecording} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-rust px-4 text-sm font-semibold text-white"><CircleStop className="size-4" />Stop recording</button> : <button type="button" onClick={startRecording} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-needle px-4 text-sm font-semibold text-white"><Camera className="size-4" />Start recording</button>}
              <button type="button" disabled={working || recording} onClick={() => inputRef.current?.click()} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink/10 bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:opacity-45"><Upload className="size-4" />Upload video</button>
            </div>
            {cameraReady && !recording ? <button type="button" onClick={releaseCamera} className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 text-xs font-semibold text-ink/55 hover:text-ink"><X className="size-4" />Close camera</button> : null}
            <p className="text-center text-xs leading-5 text-ink/48">{TAILOR_TRUST_VIDEO_MIN_SECONDS}–{TAILOR_TRUST_VIDEO_MAX_SECONDS} seconds · camera and microphone · MP4, MOV, or WebM</p>
          </>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-ink/10 bg-white p-4 text-xs leading-5 text-ink/62">
          <input type="checkbox" checked={consentGranted} onChange={(event) => onConsentChange(event.target.checked)} className="mt-1 size-4 rounded border-ink/20 text-needle focus:ring-needle/35" />
          <span>{IDENTITY_CONSENT_COPY}</span>
        </label>
      </div>
    </div>
  )
}

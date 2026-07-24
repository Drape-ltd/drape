'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  IDENTITY_CONSENT_COPY,
  IDENTITY_CONSENT_POLICY_VERSION,
  TAILOR_TRUST_VIDEO_MAX_SECONDS,
  TAILOR_TRUST_VIDEO_MIN_SECONDS,
} from '@drape/shared/identity-trust'
import { createClient } from '../../../lib/supabase'

type TrustVideoContentType = 'video/mp4' | 'video/quicktime' | 'video/webm'

type HandoffResponse = {
  error?: string
  message?: string
  status?: string
  path?: string
  uploadToken?: string
  expiresAt?: string
  challengeId?: string
  challengeText?: string
}

function isLikelyMobile() {
  if (typeof navigator === 'undefined') return false
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function functionError(payload: HandoffResponse | null | undefined, fallback: string) {
  return payload?.error || payload?.message || fallback
}

function supportedRecorderType(): { mimeType: string; contentType: TrustVideoContentType } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates: Array<{ mimeType: string; contentType: TrustVideoContentType }> = [
    { mimeType: 'video/mp4', contentType: 'video/mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', contentType: 'video/webm' },
    { mimeType: 'video/webm', contentType: 'video/webm' },
  ]
  return candidates.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

export default function VerifyHandoffPage(): React.JSX.Element {
  const params = useParams<{ token: string | string[] }>()
  const rawToken = params.token
  const token = Array.isArray(rawToken) ? rawToken[0] ?? '' : rawToken
  const supabase = useMemo(() => createClient(), [])
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingIntervalRef = useRef<number | null>(null)
  const recordedUrlRef = useRef<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordedContentType, setRecordedContentType] = useState<TrustVideoContentType>('video/mp4')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [challengeText, setChallengeText] = useState('')
  const [consentGranted, setConsentGranted] = useState(false)
  const mobileReady = isLikelyMobile()

  const clearRecordingTimers = useCallback(() => {
    if (recordingTimeoutRef.current != null) window.clearTimeout(recordingTimeoutRef.current)
    if (recordingIntervalRef.current != null) window.clearInterval(recordingIntervalRef.current)
    recordingTimeoutRef.current = null
    recordingIntervalRef.current = null
  }, [])

  const stopCamera = useCallback(() => {
    clearRecordingTimers()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [clearRecordingTimers])

  const clearRecordedVideo = useCallback(() => {
    if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    recordedUrlRef.current = null
    setRecordedUrl(null)
    setRecordedBlob(null)
    setRecordingSeconds(0)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const { data } = await supabase.functions.invoke<HandoffResponse>('identity-handoff-action', {
        body: { action: 'resolve-token', token },
      })
      if (cancelled) return
      if (data?.error) {
        setError(functionError(data, 'This trust-video link is not available.'))
        return
      }
      setExpiresAt(typeof data?.expiresAt === 'string' ? data.expiresAt : null)
      setChallengeText(typeof data?.challengeText === 'string' ? data.challengeText : '')

      if (!mobileReady) {
        setError('Open this secure link on your smartphone, or use the Drapeon mobile app to complete trust verification.')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia || !supportedRecorderType()) {
        setError('Video recording is not available in this browser. Open the link inside the Drapeon mobile app instead.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1440 } },
          audio: true,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream
          await liveVideoRef.current.play()
        }
        setCameraReady(true)
      } catch {
        setError('Camera and microphone permission are required for the short trust video.')
      }
    }

    void boot()
    return () => {
      cancelled = true
      stopCamera()
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    }
  }, [mobileReady, stopCamera, supabase, token])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const startRecording = useCallback(() => {
    const stream = streamRef.current
    const recorderType = supportedRecorderType()
    if (!stream || !recorderType || recording || busy) return

    clearRecordedVideo()
    setError(null)
    chunksRef.current = []
    const recorder = new MediaRecorder(stream, { mimeType: recorderType.mimeType })
    recorderRef.current = recorder
    recordingStartedAtRef.current = Date.now()
    setRecordedContentType(recorderType.contentType)

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onerror = () => {
      clearRecordingTimers()
      setRecording(false)
      setError('The recording stopped unexpectedly. Please record the challenge again.')
    }
    recorder.onstop = () => {
      clearRecordingTimers()
      const seconds = Math.min(
        TAILOR_TRUST_VIDEO_MAX_SECONDS,
        Math.max(0, (Date.now() - recordingStartedAtRef.current) / 1000),
      )
      setRecording(false)
      setRecordingSeconds(seconds)
      if (seconds < TAILOR_TRUST_VIDEO_MIN_SECONDS) {
        setError(`Record for at least ${TAILOR_TRUST_VIDEO_MIN_SECONDS} seconds so your face, voice, and challenge phrase are clear.`)
        return
      }
      const blob = new Blob(chunksRef.current, { type: recorderType.contentType })
      if (blob.size === 0) {
        setError('The recorded video was empty. Please try again.')
        return
      }
      const url = URL.createObjectURL(blob)
      recordedUrlRef.current = url
      setRecordedBlob(blob)
      setRecordedUrl(url)
    }

    recorder.start(250)
    setRecording(true)
    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingSeconds(Math.min(
        TAILOR_TRUST_VIDEO_MAX_SECONDS,
        (Date.now() - recordingStartedAtRef.current) / 1000,
      ))
    }, 200)
    recordingTimeoutRef.current = window.setTimeout(stopRecording, TAILOR_TRUST_VIDEO_MAX_SECONDS * 1000)
  }, [busy, clearRecordedVideo, clearRecordingTimers, recording, stopRecording])

  const submitRecording = useCallback(async () => {
    if (!recordedBlob || busy || !consentGranted) return
    setBusy(true)
    setError(null)
    try {
      const uploadPrepared = await supabase.functions.invoke<HandoffResponse>('identity-handoff-action', {
        body: { action: 'create-upload-url', token, contentType: recordedContentType },
      })
      if (uploadPrepared.error || uploadPrepared.data?.error) {
        throw new Error(functionError(uploadPrepared.data, uploadPrepared.error?.message ?? 'Could not prepare secure video upload.'))
      }
      const path = uploadPrepared.data?.path
      const uploadToken = uploadPrepared.data?.uploadToken
      if (!path || !uploadToken) throw new Error('Could not prepare secure video upload.')

      const { error: uploadError } = await supabase.storage
        .from('trust-verification')
        .uploadToSignedUrl(path, uploadToken, recordedBlob, { contentType: recordedContentType })
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
        throw new Error(functionError(submitted.data, submitted.error?.message ?? 'Trust review could not be submitted.'))
      }
      stopCamera()
      setSuccess(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Trust review could not be submitted.')
    } finally {
      setBusy(false)
    }
  }, [busy, consentGranted, recordedBlob, recordedContentType, stopCamera, supabase, token])

  return (
    <main className="min-h-screen bg-bone px-5 py-8 text-ink">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Drapeon Trust</p>
          <h1 className="mt-3 text-4xl leading-tight">Record your short challenge.</h1>
          <p className="mt-4 text-sm leading-6 text-ink/66">
            Keep your face visible and say the private phrase shown below. Drapeon does not ask for a government ID.
          </p>
        </header>

        <section className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
          {success ? (
            <div className="p-6">
              <p className="text-sm font-semibold text-needle">Trust video submitted</p>
              <p className="mt-2 text-sm leading-6 text-ink/64">
                Your private video is ready for the Drapeon Trust team. You can return to setup now.
              </p>
            </div>
          ) : error && !cameraReady ? (
            <div className="p-6">
              <p className="text-sm font-semibold text-rust">Trust video paused</p>
              <p className="mt-2 text-sm leading-6 text-ink/64">{error}</p>
              <a href={`drape://verify-handoff/${encodeURIComponent(token)}`} className="mt-5 inline-flex rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
                Open in the Drapeon app
              </a>
            </div>
          ) : (
            <>
              <div className="border-b border-ink/8 bg-bone/72 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-needle">Your private prompt</p>
                <p className="mt-2 text-lg font-semibold leading-7 text-ink">{challengeText || 'Loading your challenge...'}</p>
              </div>
              <div className="relative aspect-[3/4] overflow-hidden bg-ink">
                {recordedUrl ? (
                  <video src={recordedUrl} controls={true} playsInline={true} className="h-full w-full object-contain" />
                ) : (
                  <video ref={liveVideoRef} muted={true} playsInline={true} autoPlay={true} className="h-full w-full object-cover" />
                )}
                {recording ? (
                  <div className="absolute left-4 top-4 rounded-full bg-rust px-3 py-1.5 text-xs font-semibold text-white">
                    Recording {recordingSeconds.toFixed(1)}s
                  </div>
                ) : null}
                {!recordedUrl ? (
                  <div className="pointer-events-none absolute bottom-5 left-5 right-5 rounded-lg bg-black/72 p-3 text-center text-xs font-semibold leading-5 text-white">
                    Keep your face visible and speak the full phrase clearly in one take.
                  </div>
                ) : null}
              </div>
              <div className="p-5">
                {error ? <p className="mb-4 rounded-lg bg-rust/10 px-4 py-3 text-sm font-semibold text-rust">{error}</p> : null}
                {recordedBlob ? (
                  <>
                    <p className="mb-4 text-sm leading-6 text-ink/60">Review the full clip before submitting. It should clearly include your face, voice, and the full phrase.</p>
                    <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 bg-bone/62 p-4">
                      <input
                        type="checkbox"
                        checked={consentGranted}
                        onChange={(event) => setConsentGranted(event.target.checked)}
                        className="mt-1 h-5 w-5 shrink-0 accent-needle"
                      />
                      <span className="text-xs leading-5 text-ink/66">
                        {IDENTITY_CONSENT_COPY}{' '}
                        <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-needle underline underline-offset-2">Read the Privacy Policy.</a>
                      </span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={clearRecordedVideo} disabled={busy} className="rounded-full border border-ink/12 px-4 py-3 text-sm font-semibold text-ink">Retake</button>
                      <button type="button" onClick={() => { void submitRecording() }} disabled={busy || !consentGranted} className="rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white disabled:bg-ink/25">
                        {busy ? 'Submitting...' : 'Submit video'}
                      </button>
                    </div>
                  </>
                ) : recording ? (
                  <button type="button" onClick={stopRecording} disabled={recordingSeconds < TAILOR_TRUST_VIDEO_MIN_SECONDS} className="flex w-full justify-center rounded-full bg-rust px-5 py-3 text-sm font-semibold text-white disabled:bg-ink/25">
                    {recordingSeconds < TAILOR_TRUST_VIDEO_MIN_SECONDS
                      ? `Keep recording ${Math.ceil(TAILOR_TRUST_VIDEO_MIN_SECONDS - recordingSeconds)}s`
                      : 'Stop recording'}
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} disabled={!cameraReady || !challengeText} className="flex w-full justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white disabled:bg-ink/25">
                    {cameraReady ? `Record ${TAILOR_TRUST_VIDEO_MIN_SECONDS}–${TAILOR_TRUST_VIDEO_MAX_SECONDS} second video` : 'Starting camera...'}
                  </button>
                )}
                {expiresAt ? (
                  <p className="mt-3 text-center text-xs text-ink/44">Link expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

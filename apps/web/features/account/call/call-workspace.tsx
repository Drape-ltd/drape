'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CalendarX2,
  Camera,
  ClipboardList,
  Clock3,
  CreditCard,
  LoaderCircle,
  MessageSquareText,
  Mic,
  ShieldCheck,
  Video,
  X,
} from 'lucide-react'
import { formatCallCountdown, formatMoney, formatStatusLabel, getCallLifecycleState } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'
import { usePersistentCallSession } from './persistent-call-session'

type RoomResult = {
  url?: string | null
  token?: string | null
  fallback?: string
  message?: string
  error?: string
}

type CallOrderContext = {
  id: string
  reference: string | null
  order_kind: string | null
  stage: string | null
  item_title: string | null
  garment_type: string | null
  garment_description: string | null
  item_size: string | null
  item_quantity: number | null
  delivery_method: string | null
  currency: string | null
  quoted_currency: string | null
  quoted_amount: number | null
  total_amount: number | null
  deadline: string | null
}

async function readFunctionError(error: unknown) {
  const response = error && typeof error === 'object' ? (error as { context?: Response }).context : null
  try {
    const body = response?.clone ? await response.clone().json() as { error?: string; message?: string } : null
    return body?.message || body?.error || null
  } catch {
    return null
  }
}

function protectedRoomUrl(url: string, token: string) {
  const room = new URL(url)
  room.searchParams.set('t', token)
  return room.toString()
}

function CallContent({ userId }: { userId: string }) {
  const params = useSearchParams()
  const orderId = params.get('orderId')
  const requestedCallType = params.get('callType') === 'audio' ? 'audio' : 'video'
  const requestedCallKind = params.get('callKind') === 'consultation' ? 'consultation' : null
  const [title, setTitle] = useState('Protected consultation')
  const [callKind, setCallKind] = useState<'consultation' | 'ready-made'>(
    requestedCallKind ?? 'ready-made'
  )
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null)
  const [gateCopy, setGateCopy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderContext, setOrderContext] = useState<CallOrderContext | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [mediaState, setMediaState] = useState<'idle' | 'checking' | 'ready' | 'blocked'>('idle')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const previewStreamRef = useRef<MediaStream | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const { activeCall, startCall, endCall } = usePersistentCallSession()
  const roomActive = activeCall?.orderId === orderId
  const contextReady = loadedOrderId === orderId
  const gatePresentation = gateCopy
    ? gateCopy.includes('fee')
      ? {
          eyebrow: 'Payment required',
          title: 'Complete payment before joining.',
          Icon: CreditCard,
        }
      : gateCopy.includes('ended')
        ? {
            eyebrow: 'Consultation ended',
            title: 'This call window has closed.',
            Icon: CalendarX2,
          }
        : gateCopy.includes('begins')
          ? {
              eyebrow: 'Consultation scheduled',
              title: 'Your call opens soon.',
              Icon: Clock3,
            }
          : {
              eyebrow: 'Call unavailable',
              title: 'Return to the order conversation.',
              Icon: CalendarX2,
            }
    : null
  const GateIcon = gatePresentation?.Icon ?? CalendarX2

  const stopMediaPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop())
    previewStreamRef.current = null
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null
  }, [])

  useEffect(() => () => stopMediaPreview(), [stopMediaPreview])

  useEffect(() => {
    const video = previewVideoRef.current
    const stream = previewStreamRef.current
    if (!video || !stream || mediaState !== 'ready') return
    video.srcObject = stream
    void video.play().catch(() => undefined)
  }, [mediaState])

  const checkMedia = useCallback(async () => {
    setMediaState('checking')
    setMediaError(null)
    setError(null)
    stopMediaPreview()
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaState('blocked')
      setMediaError('This browser cannot check media devices. Try a current version of Chrome, Safari, or Edge.')
      return
    }
    try {
      let permissionTimedOut = false
      let permissionTimer: number | null = null
      const mediaRequest = navigator.mediaDevices
        .getUserMedia({
          audio: true,
          video: requestedCallType === 'video',
        })
        .then((stream) => {
          if (permissionTimedOut) stream.getTracks().forEach((track) => track.stop())
          return stream
        })
      const permissionTimeout = new Promise<never>((_resolve, reject) => {
        permissionTimer = window.setTimeout(() => {
          permissionTimedOut = true
          reject(new DOMException('Camera and microphone permission did not respond.', 'AbortError'))
        }, 12_000)
      })
      const stream = await Promise.race([mediaRequest, permissionTimeout])
      if (permissionTimer) window.clearTimeout(permissionTimer)
      const microphoneReady = stream.getAudioTracks().some((track) => track.readyState === 'live')
      const cameraReady = requestedCallType === 'audio' || stream.getVideoTracks().some((track) => track.readyState === 'live')
      if (!microphoneReady || !cameraReady) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('The requested camera or microphone is not available.')
      }
      previewStreamRef.current = stream
      if (previewVideoRef.current) previewVideoRef.current.srcObject = stream
      setMediaState('ready')
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : ''
      setMediaState('blocked')
      setMediaError(
        name === 'NotAllowedError'
          ? 'Camera or microphone access is blocked. Allow access in the browser address bar, then try again.'
          : name === 'NotFoundError'
            ? 'No camera or microphone was found. Connect a device, then try again.'
            : name === 'NotReadableError'
              ? 'Another app may be using your camera or microphone. Close it, then try again.'
              : name === 'AbortError'
                ? 'The browser did not answer the device request. Check the camera icon in the address bar, allow access, then try again.'
              : cause instanceof Error
                ? cause.message
                : 'Drapeon could not verify your camera and microphone.'
      )
    }
  }, [requestedCallType, stopMediaPreview])

  useEffect(() => {
    if (!orderId) return
    let active = true
    void (async () => {
      const supabase = createClient()
      const { data, error: orderError } = await supabase
        .from('orders')
        .select('id,reference,order_kind,stage,item_title,garment_type,garment_description,item_size,item_quantity,delivery_method,currency,quoted_currency,quoted_amount,total_amount,deadline,customer_id,tailor_id,special_note')
        .eq('id', orderId)
        .or(`customer_id.eq.${userId},tailor_id.eq.${userId}`)
        .maybeSingle()
      if (!active) return
      if (orderError || !data) {
        setGateCopy('Return to Messages and reopen the call from the correct order conversation.')
        setError('This call could not be matched to an order in your account.')
        return
      }
      setOrderContext(data)
      try {
        const parsed = JSON.parse(data.special_note ?? '{}') as {
          consultation?: {
            status?: string | null
            scheduledStartAt?: string | null
            feeAmount?: number | null
            paidAt?: string | null
          }
        }
        const legacyConsultation = parsed.consultation
        const mayBeConsultation =
          requestedCallKind === 'consultation' ||
          data.stage === 'CONSULTATION' ||
          data.stage === 'PENDING_QUOTE' ||
          Boolean(legacyConsultation?.scheduledStartAt)
        const { data: booking, error: bookingError } = mayBeConsultation
          ? await supabase
              .from('consultation_bookings')
              .select('id,status,scheduled_start_at,fee_mode,fee_amount,payment_status,paid_at')
              .eq('order_id', orderId)
              .eq('status', 'CONFIRMED')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null, error: null }
        if (!active) return
        if (bookingError) throw bookingError

        const isConsultation = mayBeConsultation && Boolean(
          booking ||
          (legacyConsultation?.scheduledStartAt && legacyConsultation.status === 'SCHEDULED')
        )
        setCallKind(isConsultation ? 'consultation' : 'ready-made')
        setTitle(data.item_title?.trim() || data.garment_type?.trim() || 'Protected consultation')
        setError(null)
        if (!isConsultation) {
          setGateCopy(null)
          return
        }

        const scheduledStartAt = booking?.scheduled_start_at ?? legacyConsultation?.scheduledStartAt
        if (!scheduledStartAt) {
          setGateCopy('This consultation does not have an active scheduled slot.')
          return
        }
        const paymentBlocked = booking
          ? booking.fee_mode === 'PAID' && booking.payment_status !== 'PAID'
          : Boolean(legacyConsultation?.feeAmount && !legacyConsultation.paidAt)
        if (paymentBlocked) {
          setGateCopy('The consultation fee must be paid before this call can open.')
          return
        }
        const lifecycle = getCallLifecycleState(scheduledStartAt)
        setGateCopy(
          lifecycle.status === 'upcoming'
            ? `${formatCallCountdown(lifecycle.msUntilOpen)}. Return here when the protected call window begins.`
            : lifecycle.status === 'expired'
              ? 'This consultation window has ended. Use Messages to agree on the next step.'
              : lifecycle.status === 'active'
                ? null
                : 'This consultation does not have an active scheduled slot.'
        )
      } catch {
        setGateCopy('The consultation schedule could not be verified. Return to the order before retrying.')
      } finally {
        if (active) setLoadedOrderId(orderId)
      }
    })()
    return () => { active = false }
  }, [orderId, requestedCallKind, userId])

  const prepareRoom = useCallback(async () => {
    if (!orderId) return
    setBusy(true)
    setError(null)
    try {
      const functionName = callKind === 'consultation' ? 'create-consultation-room' : 'create-order-call-room'
      const { data, error: invokeError } = await createClient().functions.invoke<RoomResult>(functionName, {
        body: { orderId, callType: requestedCallType, notifyCounterpart: callKind === 'consultation' },
      })
      if (invokeError) throw new Error((await readFunctionError(invokeError)) || 'The protected call could not open.')
      if (!data?.url || !data.token) throw new Error(data?.message || data?.error || 'Continue in Messages while calling is unavailable.')
      stopMediaPreview()
      startCall({
        roomUrl: protectedRoomUrl(data.url, data.token),
        orderId,
        title,
        callKind,
        callType: requestedCallType,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The protected call could not open.')
    } finally {
      setBusy(false)
    }
  }, [callKind, orderId, requestedCallType, startCall, stopMediaPreview, title])

  if (!orderId) return <section data-route-content-ready="true" className="app-surface p-6"><h1 className="text-2xl font-semibold">Choose a conversation first.</h1><Link href="/account/messages" className="mt-4 inline-flex text-sm font-semibold text-needle">Open Messages</Link></section>

  return (
    <section data-route-content-ready="true" className="relative min-h-[calc(100dvh-2rem)] overflow-hidden rounded-[12px] bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-ui-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/account/messages?orderId=${encodeURIComponent(orderId)}`} aria-label="Return to conversation" className="grid size-9 shrink-0 place-items-center rounded-full border border-ink/12 transition hover:bg-ink/5"><ArrowLeft className="size-4" /></Link>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-xs text-ink/55">Private Drapeon {requestedCallType} call</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDetailsOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-ink/12 px-3 text-xs font-semibold text-ink transition hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle focus-visible:ring-offset-2">
            <ClipboardList className="size-4" aria-hidden="true" /> Order details
          </button>
          {roomActive ? <button type="button" onClick={() => { endCall(); setMediaState('idle') }} className="rounded-full border border-ink/12 px-4 py-2 text-xs font-semibold transition hover:bg-ink/5">Leave call</button> : null}
        </div>
      </header>
      {detailsOpen ? (
        <div className="absolute inset-0 z-30 flex justify-end bg-ink/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false) }}>
          <aside aria-label="Order details" className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-ui-border px-5 py-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-needle">During your call</p>
                <h2 className="mt-1 font-display text-2xl text-ink">Order details</h2>
              </div>
              <button type="button" onClick={() => setDetailsOpen(false)} aria-label="Close order details" title="Close order details" className="grid size-10 place-items-center rounded-full border border-ink/10 text-ink transition hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle">
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-needle">{orderContext?.order_kind === 'READY_MADE' ? 'Ready-made order' : 'Custom order'}</p>
              <h3 className="mt-2 font-display text-3xl leading-tight text-ink">{orderContext?.item_title?.trim() || orderContext?.garment_type?.trim() || title}</h3>
              {orderContext?.garment_description ? <p className="mt-3 text-sm leading-6 text-ink/65">{orderContext.garment_description}</p> : null}
              <dl className="mt-6 grid gap-0 overflow-hidden rounded-[10px] border border-ui-border">
                <div className="flex items-center justify-between gap-4 border-b border-ui-border px-4 py-3"><dt className="text-xs text-ink/52">Reference</dt><dd className="text-right text-sm font-semibold text-ink">{orderContext?.reference || 'Pending'}</dd></div>
                <div className="flex items-center justify-between gap-4 border-b border-ui-border px-4 py-3"><dt className="text-xs text-ink/52">Status</dt><dd className="text-right text-sm font-semibold text-ink">{formatStatusLabel(orderContext?.stage, { domain: 'order' })}</dd></div>
                <div className="flex items-center justify-between gap-4 border-b border-ui-border px-4 py-3"><dt className="text-xs text-ink/52">Size and quantity</dt><dd className="text-right text-sm font-semibold text-ink">{orderContext?.item_size || 'Made to measure'} · {orderContext?.item_quantity ?? 1}</dd></div>
                <div className="flex items-center justify-between gap-4 border-b border-ui-border px-4 py-3"><dt className="text-xs text-ink/52">Fulfillment</dt><dd className="text-right text-sm font-semibold text-ink">{formatStatusLabel(orderContext?.delivery_method, { domain: 'generic', fallback: 'Not selected' })}</dd></div>
                <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-xs text-ink/52">Agreed amount</dt><dd className="text-right text-sm font-semibold text-ink">{formatMoney((orderContext?.total_amount ?? orderContext?.quoted_amount ?? 0) > 0 ? (orderContext?.total_amount ?? orderContext?.quoted_amount) : null, orderContext?.currency ?? orderContext?.quoted_currency, { pendingLabel: 'Quote pending' })}</dd></div>
              </dl>
              <p className="mt-5 rounded-[10px] bg-bone/65 p-4 text-sm leading-6 text-ink/65">Keep decisions about fit, fabric, pricing, and fulfillment in Messages so both sides retain the same written record.</p>
            </div>
            <div className="border-t border-ui-border p-4">
              <Link href={`/account/orders/${encodeURIComponent(orderId)}`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-needle px-5 text-sm font-semibold text-white transition hover:bg-needle/90">
                <ClipboardList className="size-4" aria-hidden="true" /> Open full order
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
      {gatePresentation ? (
        <div className="mx-auto flex min-h-[calc(100dvh-5.5rem)] w-full max-w-xl flex-col items-center justify-center px-5 py-12 text-center sm:px-8">
          <span className="grid size-16 place-items-center rounded-full bg-needle/8 text-needle">
            <GateIcon className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-6 text-[0.7rem] font-semibold uppercase tracking-[0.15em] text-needle">
            {gatePresentation.eyebrow}
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-ink sm:text-5xl">
            {gatePresentation.title}
          </h1>
          <p role="status" className="mt-4 max-w-md text-sm leading-6 text-ink/62">
            {gateCopy}
          </p>
          <Link
            href={`/account/messages?orderId=${encodeURIComponent(orderId)}`}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-needle px-6 text-sm font-semibold text-white transition-colors hover:bg-needle/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35 focus-visible:ring-offset-2"
          >
            <MessageSquareText className="size-4" aria-hidden="true" /> Return to Messages
          </Link>
        </div>
      ) : busy || !contextReady ? (
        <div className="flex min-h-[calc(100dvh-5.5rem)] w-full items-center justify-center bg-[#eef3f1] px-5 py-12">
          <div
            role="status"
            aria-live="polite"
            className="flex w-full max-w-md flex-col items-center rounded-[18px] bg-[#171a18] px-6 py-10 text-center text-white shadow-lg sm:px-10"
          >
            <span className="grid size-16 place-items-center rounded-full border border-white/12 bg-white/8 text-white">
              <LoaderCircle className="size-7 animate-spin" aria-hidden="true" />
            </span>
            <p className="mt-5 text-base font-semibold">Preparing your call…</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-white/65">
              Drapeon will ask for camera and microphone access inside this protected order room.
            </p>
          </div>
        </div>
      ) : roomActive ? (
        <div aria-label="Active call workspace" className="min-h-[calc(100dvh-5.5rem)] bg-[#eef3f1]" />
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 sm:p-4 lg:py-4">
          <div
            className="relative flex min-h-0 overflow-hidden rounded-[18px] bg-[#171a18] text-white shadow-lg"
            style={{ height: 'clamp(16rem, 43dvh, 20rem)' }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(47,113,83,0.34),transparent_46%)]" />
            {requestedCallType === 'video' && mediaState === 'ready' ? (
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                aria-label="Camera preview"
                className="absolute inset-0 size-full object-cover"
              />
            ) : null}
            <div className={`absolute inset-0 flex flex-col items-center justify-center px-6 pb-12 text-center ${requestedCallType === 'video' && mediaState === 'ready' ? 'sr-only' : ''}`}>
              <span className="grid size-16 place-items-center rounded-full border border-white/12 bg-white/8 text-white">
                {mediaState === 'checking' ? <LoaderCircle className="size-7 animate-spin" aria-hidden="true" /> : <Video className="size-7" aria-hidden="true" />}
              </span>
              <p className="mt-5 text-base font-semibold">{mediaState === 'checking' ? 'Checking your devices…' : mediaState === 'ready' ? 'Microphone ready' : 'Check your devices before joining'}</p>
              <p className="mt-2 text-sm leading-6 text-white/65">Your browser will ask for camera and microphone access before Drapeon opens the protected room.</p>
            </div>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
              {mediaState === 'ready' ? (
                <>
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-black/55 px-3 text-xs font-semibold text-white"><Mic className="size-4" aria-hidden="true" /> Mic ready</span>
                  {requestedCallType === 'video' ? <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-black/55 px-3 text-xs font-semibold text-white"><Camera className="size-4" aria-hidden="true" /> Camera ready</span> : null}
                </>
              ) : (
                <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-semibold text-white/75">
                  {mediaState === 'checking' ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
                  {mediaState === 'checking' ? 'Waiting for browser permission' : 'Devices not checked'}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col px-1 py-1 text-center">
            <span className="mx-auto inline-flex w-fit items-center gap-2 rounded-full bg-needle/8 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-needle"><ShieldCheck className="size-4" aria-hidden="true" /> Drapeon call</span>
            <h1 className="mt-3 font-display text-3xl text-ink sm:text-4xl">{mediaState === 'ready' ? 'Your devices are ready.' : 'Check your setup first.'}</h1>
            <p className="mt-2 text-sm leading-6 text-ink/65">Drapeon verifies your camera and microphone here before opening the protected room. Final fit, fabric, and price decisions remain recorded in Messages.</p>
            {mediaError ? <p role="alert" className="mt-4 rounded-[8px] bg-rust/10 px-3 py-2 text-sm text-rust">{mediaError}</p> : null}
            {error ? <p role="alert" className="mt-4 rounded-[8px] bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
            <button type="button" disabled={mediaState === 'checking' || busy || !contextReady} onClick={() => { if (mediaState === 'ready') void prepareRoom(); else void checkMedia() }} className="mt-4 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-needle px-6 text-sm font-semibold text-white transition-colors hover:bg-needle/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
              {mediaState === 'checking' ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Checking devices…</> : mediaState === 'ready' ? <><Video className="size-4" aria-hidden="true" /> Join {requestedCallType} call</> : <><Camera className="size-4" aria-hidden="true" /> {mediaState === 'blocked' ? 'Try device check again' : 'Check camera and microphone'}</>}
            </button>
            {mediaState === 'blocked' ? (
              <button type="button" disabled={busy} onClick={() => void prepareRoom()} className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-ink/62 transition hover:bg-ink/5">
                Join without camera or microphone
              </button>
            ) : null}
            <Link href={`/account/messages?orderId=${encodeURIComponent(orderId)}`} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold text-needle transition hover:bg-needle/5">
              <MessageSquareText className="size-4" aria-hidden="true" /> Open Messages instead
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

export function CallWorkspace() {
  return <AccountRouteRuntime surface="call">{({ session }) => <CallContent userId={session.user.id} />}</AccountRouteRuntime>
}

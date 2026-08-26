'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { consultationAttendanceEvidenceCopy, consultationAttendanceResolutionCopy } from '@drape/shared'

type Role = 'CUSTOMER' | 'TAILOR'
type ResponseCode = 'AGREE_NO_CALL' | 'I_ATTENDED' | 'CONNECTION_ISSUE' | 'OTHER'
type Booking = { id: string; scheduled_start_at: string }
type Evidence = { derived_outcome: string; verified_overlap_seconds: number; provider_evidence_complete: boolean }
type Review = { status: string; reported_by_role: Role; reported_reason: string; counterparty_due_at: string; evidence_outcome_at_report: string; counterparty_response_code: ResponseCode | null; resolution_code: string | null }

const responseOptions: Array<{ code: ResponseCode; title: string; hint: string }> = [
  { code: 'AGREE_NO_CALL', title: 'The call did not happen', hint: 'Keep the fee protected and choose another time.' },
  { code: 'I_ATTENDED', title: 'I joined and waited', hint: 'Drapeon will compare this with the call activity.' },
  { code: 'CONNECTION_ISSUE', title: 'I had a connection issue', hint: 'Add a short explanation for review.' },
  { code: 'OTHER', title: 'Something else happened', hint: 'Explain what happened from your side.' },
]

const display = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())

export function ConsultationAttendancePanel({ orderId, actorRole }: { orderId: string; actorRole: Role }) {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [action, setAction] = useState<'report' | 'respond' | null>(null)
  const [responseCode, setResponseCode] = useState<ResponseCode | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [renderedAt] = useState(() => Date.now())

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: bookingRow } = await supabase.from('consultation_bookings').select('id, scheduled_start_at').eq('order_id', orderId).in('status', ['CONFIRMED', 'COMPLETED', 'NO_SHOW']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const next = bookingRow as Booking | null
    setBooking(next)
    if (!next) return
    const [evidenceResult, reviewResult] = await Promise.all([
      supabase.from('consultation_attendance_evidence').select('derived_outcome, verified_overlap_seconds, provider_evidence_complete').eq('booking_id', next.id).maybeSingle(),
      supabase.from('consultation_attendance_reviews').select('status, reported_by_role, reported_reason, counterparty_due_at, evidence_outcome_at_report, counterparty_response_code, resolution_code').eq('booking_id', next.id).maybeSingle(),
    ])
    setEvidence(evidenceResult.data as Evidence | null)
    if (reviewResult.error) {
      // Fail closed during schema rollout so a submitted report cannot appear
      // as a fresh report opportunity.
      const fallback = await supabase
        .from('consultation_attendance_reviews')
        .select('status, reported_by_role, reported_reason, counterparty_due_at, evidence_outcome_at_report, resolution_code')
        .eq('booking_id', next.id)
        .maybeSingle()
      setReview(fallback.data ? { ...(fallback.data as Omit<Review, 'counterparty_response_code'>), counterparty_response_code: null } : null)
    } else {
      setReview(reviewResult.data as Review | null)
    }
  }, [orderId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!booking?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`consultation-attendance:${booking.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_attendance_reviews', filter: `booking_id=eq.${booking.id}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [booking?.id, load])
  if (!booking) return null
  const activeBooking = booking
  const reportWindowOpen = renderedAt >= new Date(activeBooking.scheduled_start_at).getTime() + 15 * 60_000
  const canRespond = review?.status === 'COUNTERPARTY_REVIEW' && review.reported_by_role !== actorRole
  const isReporter = review?.reported_by_role === actorRole
  const evidenceCopy = consultationAttendanceEvidenceCopy(review?.evidence_outcome_at_report)
  const resolutionCopy = consultationAttendanceResolutionCopy(review?.resolution_code)
  const displayedEvidenceCopy = review?.status === 'OPS_REVIEW'
    ? {
        title: 'Both responses received',
        detail: 'Drapeon is comparing both reports with the call activity. No action is needed from you right now.',
      }
    : evidenceCopy
  const cardTitle = review
    ? review.status === 'COUNTERPARTY_REVIEW'
      ? (isReporter ? 'Attendance report sent' : 'Attendance response needed')
      : review.status === 'OPS_REVIEW' ? 'Attendance under review'
        : resolutionCopy.title
    : evidence?.derived_outcome === 'ATTENDED' ? 'Provider-confirmed attendance' : 'Provider timeline'

  if (review?.status === 'RESOLVED' && review.resolution_code === 'RESCHEDULE_REQUIRED') return null

  async function submit() {
    if (!action) return
    const responseNeedsNote = responseCode === 'CONNECTION_ISSUE' || responseCode === 'OTHER'
    if ((action === 'report' && text.trim().length < 10) || (action === 'respond' && (!responseCode || (responseNeedsNote && text.trim().length < 2)))) {
      setError(action === 'report' ? 'Explain what happened in at least 10 characters.' : !responseCode ? 'Choose what happened from your side.' : 'Add a short explanation.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; result?: { nextAction?: string } }>('consultation-attendance-action', {
      body: action === 'report'
        ? { action: 'report', bookingId: activeBooking.id, reason: text.trim(), idempotencyKey: `attendance:${activeBooking.id}:${actorRole}` }
        : { action: 'respond', bookingId: activeBooking.id, responseCode, response: text.trim() || undefined },
    })
    setBusy(false)
    if (invokeError) {
      let message = invokeError.message || 'This attendance update could not be submitted. Refresh and try again.'
      const context = (invokeError as { context?: unknown }).context
      if (context && typeof context === 'object' && 'json' in context) {
        try {
          const payload = await (context as { json: () => Promise<unknown> }).json()
          const serverMessage = payload && typeof payload === 'object' && 'error' in payload
            ? (payload as { error?: unknown }).error
            : null
          if (typeof serverMessage === 'string' && serverMessage.trim()) message = serverMessage.trim()
        } catch {
          // Keep the SDK error when the response does not contain JSON.
        }
      }
      setError(message)
      return
    }
    const submittedAction = action
    setAction(null)
    setText('')
    setResponseCode(null)
    setConfirmation(submittedAction === 'report'
      ? 'Report sent. The fee stays protected while the other person responds.'
      : data?.result?.nextAction === 'RESCHEDULE'
        ? 'Both accounts match. The fee stays protected while you choose another time.'
        : 'Response sent. Money stays frozen while Drapeon reviews the call activity.')
    await load()
  }

  return (
    <section className="rounded-[8px] border border-needle/14 bg-white/86 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Consultation attendance</p>
      <h2 className="mt-2 text-xl font-semibold text-ink">{cardTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-ink/62">
        {evidence?.provider_evidence_complete ? `Call records show ${Math.floor(evidence.verified_overlap_seconds / 60)} minutes of overlap. ` : ''}
        Opening the room alone does not prove attendance. Reports never move money automatically.
      </p>
      {review ? (
        <div className="mt-4">
          <span className="inline-flex rounded-full bg-needle/10 px-3 py-1 text-xs font-semibold text-needle">{displayedEvidenceCopy.title}</span>
          <p className="mt-2 text-xs leading-5 text-ink/55">{displayedEvidenceCopy.detail}</p>
        </div>
      ) : null}
      {review ? (
        <div className="mt-4 rounded-[8px] bg-bone p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">{review.reported_by_role === 'CUSTOMER' ? 'Customer report' : 'Tailor report'}</p>
          <p className="mt-2 text-sm leading-6 text-ink">{review.reported_reason}</p>
          {review.status === 'COUNTERPARTY_REVIEW' ? <p className="mt-2 text-xs text-ink/50">Respond by {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(review.counterparty_due_at))}</p> : null}
        </div>
      ) : null}
      {confirmation ? <p className="mt-4 rounded-[8px] border border-needle/20 bg-needle/8 p-3 text-sm font-semibold text-needle">{confirmation}</p> : null}
      {action ? (
        <div className="mt-5 grid gap-3">
          <label className="text-sm font-semibold text-ink" htmlFor={`attendance-${orderId}`}>{action === 'report' ? 'What happened?' : 'Your response'}</label>
          {action === 'respond' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {responseOptions.map((option) => (
                <button key={option.code} type="button" onClick={() => { setResponseCode(option.code); setError(null) }} className={`rounded-[8px] border p-3 text-left ${responseCode === option.code ? 'border-needle bg-needle/8' : 'border-ui-border bg-white'}`}>
                  <span className="block text-sm font-semibold text-ink">{option.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-ink/55">{option.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea id={`attendance-${orderId}`} value={text} onChange={(event) => setText(event.currentTarget.value)} className="min-h-32 rounded-[8px] border border-ui-border bg-white p-3 text-sm text-ink" maxLength={1000} />
          {error ? <p className="text-sm text-rust">{error}</p> : null}
          <div className="flex gap-3">
            <button type="button" onClick={() => void submit()} disabled={busy} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">{busy ? 'Submitting…' : 'Submit for review'}</button>
            <button type="button" onClick={() => setAction(null)} className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold text-ink">Cancel</button>
          </div>
        </div>
      ) : canRespond ? (
        <button type="button" onClick={() => { setResponseCode(null); setText(''); setConfirmation(null); setAction('respond') }} className="mt-5 rounded-[8px] border border-needle/25 px-4 py-2.5 text-sm font-semibold text-needle">Respond and continue</button>
      ) : !review && reportWindowOpen ? (
        <button type="button" onClick={() => setAction('report')} className="mt-5 rounded-[8px] border border-needle/25 px-4 py-2.5 text-sm font-semibold text-needle">Report an attendance issue</button>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-ink/45">
        {!review
          ? 'Reports never move money automatically.'
          : review.status === 'COUNTERPARTY_REVIEW'
            ? (isReporter ? 'No further action is needed from you right now. The fee stays protected while the other person responds.' : 'Your response determines whether you reschedule together or Drapeon reviews the call activity.')
            : review.status === 'OPS_REVIEW'
              ? 'The fee stays protected. Both accounts will be notified when Drapeon records the outcome.'
              : resolutionCopy.detail}
      </p>
    </section>
  )
}

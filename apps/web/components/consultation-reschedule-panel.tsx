'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { recommendedSchedulingStartDate, repairSchedulingOptions } from '@drape/shared/call-scheduling-policy'

type Role = 'CUSTOMER' | 'TAILOR'
type PendingRequest = { id: string; requested_by: string; requested_by_role: Role; proposed_start_at: string; proposed_start_options: string[] | null; note: string | null }
type AttendanceResolution = { resolution_code: string | null; reported_reason: string | null }
type MakeupBooking = { id: string; scheduled_start_at: string; scheduled_end_at: string; call_type: string; replaces_booking_id: string | null }

function localValue(offsetDays = 1) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60_000)
  date.setMinutes(0, 0, 0)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))
}
function toLocalInputValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function ConsultationReschedulePanel({ orderId, actorId, actorRole, onUpdated }: { orderId: string; actorId: string | null; actorRole: Role; onUpdated?: () => void }) {
  const [request, setRequest] = useState<PendingRequest | null>(null)
  const [open, setOpen] = useState(false)
  const [proposedLocals, setProposedLocals] = useState(() => [localValue(1), localValue(2), localValue(3)])
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'send' | 'ACCEPTED' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestedLocals, setSuggestedLocals] = useState<string[] | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [attendanceResolution, setAttendanceResolution] = useState<AttendanceResolution | null>(null)
  const [makeupBooking, setMakeupBooking] = useState<MakeupBooking | null>(null)
  const minimumLocal = useMemo(() => {
    return toLocalInputValue(recommendedSchedulingStartDate({ minLookaheadMinutes: 60 }))
  }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    const [requestResult, reviewResult, bookingResult] = await Promise.all([
      supabase.from('consultation_reschedule_requests').select('id, requested_by, requested_by_role, proposed_start_at, proposed_start_options, note').eq('order_id', orderId).eq('status', 'PENDING').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('consultation_attendance_reviews').select('resolution_code, reported_reason').eq('order_id', orderId).eq('status', 'RESOLVED').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('consultation_bookings').select('id, scheduled_start_at, scheduled_end_at, call_type, replaces_booking_id').eq('order_id', orderId).eq('status', 'CONFIRMED').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const requestData = requestResult.data
    const next = (requestData as PendingRequest | null) ?? null
    setRequest(next)
    setSelected(next?.proposed_start_options?.[0] ?? next?.proposed_start_at ?? null)
    setAttendanceResolution((reviewResult.data as AttendanceResolution | null) ?? null)
    const booking = (bookingResult.data as MakeupBooking | null) ?? null
    setMakeupBooking(booking?.replaces_booking_id ? booking : null)
  }, [orderId])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`web-consultation-reschedule:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_reschedule_requests', filter: `order_id=eq.${orderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_bookings', filter: `order_id=eq.${orderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_attendance_reviews', filter: `order_id=eq.${orderId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load, orderId])

  const options = request ? (request.proposed_start_options?.length ? request.proposed_start_options : [request.proposed_start_at]) : []
  const mine = !!request && request.requested_by === actorId

  function beginCounter() {
    setProposedLocals(options.length ? options.slice(0, 3).map((value) => {
      const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }) : [localValue(1), localValue(2), localValue(3)])
    setOpen(true); setError(null); setSuggestedLocals(null); setConfirmation(null)
  }

  async function sendTimes() {
    const values = proposedLocals.map((value) => new Date(value))
    const iso = values.map((value) => value.toISOString())
    if (values.some((value) => !Number.isFinite(value.getTime()) || value.getTime() < Date.now() + 60 * 60_000) || new Set(iso).size !== iso.length) {
      const repaired = repairSchedulingOptions(values, { minLookaheadMinutes: 60 })
      setSuggestedLocals(repaired.values.map(toLocalInputValue))
      setError(`${repaired.changedIndexes.length === 1 ? 'One option is' : 'Some options are'} too soon or repeated. Use the nearest valid times below.`)
      return
    }
    setBusy('send'); setError(null); setSuggestedLocals(null)
    const supabase = createClient()
    const body = request && request.requested_by !== actorId
      ? { action: 'counter', orderId, requestId: request.id, proposedStartAt: iso[0], alternativeStartAts: iso.slice(1), note: note.trim() || undefined }
      : { action: 'request', orderId, proposedStartAt: iso[0], alternativeStartAts: iso.slice(1), note: note.trim() || undefined }
    const { data, error: invokeError } = await supabase.functions.invoke('consultation-reschedule-action', { body })
    setBusy(null)
    if (invokeError || data?.ok !== true) { setError(typeof data?.error === 'string' ? data.error : 'Could not send these times. Try again.'); return }
    setOpen(false); setNote(''); setConfirmation('Times sent. The fee stays protected while the other person chooses.'); await load(); onUpdated?.()
  }

  async function accept() {
    if (!request || !selected) return
    setBusy('ACCEPTED'); setError(null)
    const supabase = createClient()
    const { data, error: invokeError } = await supabase.functions.invoke('consultation-reschedule-action', { body: { action: 'respond', orderId, requestId: request.id, decision: 'ACCEPTED', selectedStartAt: selected } })
    setBusy(null)
    if (invokeError || data?.ok !== true) { setError(typeof data?.error === 'string' ? data.error : 'Could not confirm this time.'); return }
    setConfirmation('New time confirmed. The booking and reminders are updated.'); await load(); onUpdated?.()
  }

  const rescheduleRequired = attendanceResolution?.resolution_code === 'RESCHEDULE_REQUIRED'
  if (!request && !confirmation && !rescheduleRequired && !makeupBooking) return null
  return (
    <section className="app-surface p-5">
      {confirmation ? <p role="status" className="mb-3 rounded-[8px] bg-needle/10 px-3 py-2 text-sm font-semibold text-needle">{confirmation}</p> : null}
      {error ? <div role="alert" className="mb-3 rounded-[8px] bg-rust/8 px-3 py-2 text-sm font-semibold text-rust"><p>{error}</p>{suggestedLocals ? <button type="button" onClick={() => { setProposedLocals(suggestedLocals); setSuggestedLocals(null); setError(null) }} className="mt-2 rounded-[8px] border border-rust/25 bg-white px-3 py-2 text-sm font-semibold text-rust">Use suggested times</button> : null}</div> : null}
      {open ? (
        <div className="grid gap-3">
          <div><h2 className="text-lg font-semibold text-ink">Propose times</h2><p className="mt-1 text-sm text-ink/55">Offer up to 3 options. Times appear in the other person’s timezone.</p></div>
          {proposedLocals.map((value, index) => <label key={index} className="grid gap-1 text-sm font-semibold text-ink">{index === 0 ? 'Preferred' : `Option ${index + 1}`}<input type="datetime-local" value={value} min={minimumLocal} onChange={(event) => { const nextValue = event.currentTarget.value; setSuggestedLocals(null); setError(null); setProposedLocals((current) => current.map((item, itemIndex) => itemIndex === index ? nextValue : item)) }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2.5 font-normal" /></label>)}
          <label className="grid gap-1 text-sm font-semibold text-ink">Note <span className="font-normal text-ink/45">(optional)</span><textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={300} rows={2} className="rounded-[8px] border border-ui-border bg-white px-3 py-2.5 font-normal" /></label>
          <div className="flex gap-2"><button type="button" disabled={!!busy} onClick={() => { void sendTimes() }} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send times'}</button><button type="button" onClick={() => setOpen(false)} className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold text-ink">Cancel</button></div>
        </div>
      ) : request ? (
        <div className="grid gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/75">Consultation</p><h2 className="mt-1 text-lg font-semibold text-ink">{mine ? 'Times sent' : 'Choose a new time'}</h2><p className="mt-1 text-sm text-ink/55">{mine ? 'Waiting for a response. The fee stays protected.' : 'Select one option, or suggest times that work better.'}</p></div>
          <div className="grid gap-2">{options.map((value) => <label key={value} className={`flex items-center gap-3 rounded-[8px] border p-3 ${!mine && selected === value ? 'border-needle bg-needle/8' : 'border-ui-border bg-white'}`}>{!mine ? <input type="radio" name={`consultation-${orderId}`} checked={selected === value} onChange={() => setSelected(value)} /> : null}<span className="text-sm font-semibold text-ink">{formatTime(value)}</span></label>)}</div>
          {request.note ? <p className="rounded-[8px] bg-bone p-3 text-sm text-ink/70">{request.note}</p> : null}
          {!mine ? <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy || !selected} onClick={() => { void accept() }} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'ACCEPTED' ? 'Confirming…' : 'Confirm selected time'}</button><button type="button" disabled={!!busy} onClick={beginCounter} className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold text-ink">Suggest other times</button></div> : null}
        </div>
      ) : makeupBooking ? (
        <div className="grid gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/75">Make-up consultation</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">New time confirmed</h2>
            <p className="mt-1 text-sm leading-6 text-ink/58">No second payment is needed. The original fee remains protected and this call has a fresh attendance record.</p>
          </div>
          <div className="rounded-[8px] border border-ui-border bg-white p-3">
            <p className="text-sm font-semibold text-ink">{formatTime(makeupBooking.scheduled_start_at)}</p>
            <p className="mt-1 text-xs text-ink/50">{makeupBooking.call_type === 'AUDIO' ? 'Audio' : 'Video'} · Opens 5 minutes before the scheduled time</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/account/call-join?orderId=${orderId}&callKind=consultation&callType=${makeupBooking.call_type === 'AUDIO' ? 'audio' : 'video'}`} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">Open call lobby</a>
            <a href={`/account/messages?orderId=${orderId}`} className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold text-ink">Message {actorRole === 'TAILOR' ? 'customer' : 'tailor'}</a>
          </div>
        </div>
      ) : rescheduleRequired ? (
        <div className="grid gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/75">Make-up consultation</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Choose another time together</h2>
            <p className="mt-1 text-sm leading-6 text-ink/58">Both accounts confirmed that the call did not happen. The order remains open for a quote, and the protected consultation fee will follow the new booking.</p>
          </div>
          {attendanceResolution.reported_reason ? (
            <details className="rounded-[8px] bg-bone px-3 py-2 text-sm text-ink/65">
              <summary className="cursor-pointer font-semibold text-needle">Why is another time needed?</summary>
              <p className="mt-2 leading-6">{attendanceResolution.reported_reason}</p>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => beginCounter()} className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">Propose new times</button>
            <a href={`/account/messages?orderId=${orderId}`} className="rounded-[8px] border border-ui-border px-4 py-2.5 text-sm font-semibold text-ink">Message {actorRole === 'TAILOR' ? 'customer' : 'tailor'}</a>
          </div>
        </div>
      ) : null}
    </section>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { deriveConsultationCancellation } from '@drape/shared'
import { createClient } from '@/lib/supabase'

type Role = 'CUSTOMER' | 'TAILOR'
type Booking = { id: string; status: string; scheduled_start_at: string; fee_mode: string; fee_amount: number | null; fee_currency: string | null; settlement_status: string }

function money(amount: number, currency: string | null) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD' }).format(amount / 100)
}

export function ConsultationLifecyclePanel({ orderId, actorRole, onUpdated }: { orderId: string; actorRole: Role; onUpdated?: () => void }) {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attendanceOutcome, setAttendanceOutcome] = useState<string | null>(null)
  const [verifiedOverlapSeconds, setVerifiedOverlapSeconds] = useState(0)
  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('consultation_bookings').select('id,status,scheduled_start_at,fee_mode,fee_amount,fee_currency,settlement_status').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const next = (data as Booking | null) ?? null
    setBooking(next)
    if (next?.id) {
      const { data: evidence } = await supabase.from('consultation_attendance_evidence').select('derived_outcome,verified_overlap_seconds').eq('booking_id', next.id).maybeSingle()
      setAttendanceOutcome(evidence?.derived_outcome ?? null)
      setVerifiedOverlapSeconds(evidence?.verified_overlap_seconds ?? 0)
    } else {
      setAttendanceOutcome(null)
      setVerifiedOverlapSeconds(0)
    }
  }, [orderId])
  useEffect(() => {
    const supabase = createClient()
    const timer = window.setTimeout(() => { void load() }, 0)
    const channel = supabase.channel(`consultation-lifecycle-web:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_bookings', filter: `order_id=eq.${orderId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_attendance_evidence', filter: `order_id=eq.${orderId}` }, () => { void load() })
      .subscribe()
    return () => { window.clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [load, orderId])
  const decision = useMemo(() => {
    if (!booking) return null
    try { return deriveConsultationCancellation({ actorRole, scheduledStartAt: booking.scheduled_start_at, feeAmount: booking.fee_amount ?? 0 }) } catch { return null }
  }, [actorRole, booking])
  async function cancelConsultation() {
    if (!booking || !decision || reason.trim().length < 2) return
    setBusy(true); setError(null); setNotice(null)
    const { data, error: invokeError } = await createClient().functions.invoke('consultation-lifecycle-action', { body: { action: 'cancel', bookingId: booking.id, reason: reason.trim(), idempotencyKey: `consultation-cancel:${booking.id}:${Date.now()}` } })
    setBusy(false)
    if (invokeError || data?.ok !== true) { setError(typeof data?.error === 'string' ? data.error : 'Could not cancel this consultation. Try again.'); return }
    setReason(''); setOpen(false); setNotice(data.refundPending ? 'Consultation cancelled. The refund is processing to the original payment method.' : 'Consultation cancelled. The order remains open for the next quote step.'); await load(); onUpdated?.()
  }
  if (!booking) return null
  const copy: Record<string, string> = { HELD: 'Consultation fee protected until attendance is verified.', REFUND_PENDING: 'Refund processing to the original payment method.', PARTIALLY_REFUNDED: 'Partial refund complete; earned fee is settling.', REFUNDED: 'Consultation fee refunded.', EARNED: 'Attendance verified. Tailor payment is being released.', RELEASE_PENDING: 'Tailor payment is processing.', RELEASED: 'Consultation fee released to the tailor.', OPS_REVIEW: 'Drapeon is reviewing attendance before money moves.', FAILED: 'Drapeon Ops is resolving a payment issue.' }
  const attendanceSettled = attendanceOutcome === 'ATTENDED' || verifiedOverlapSeconds >= 300 || ['EARNED', 'RELEASE_PENDING', 'RELEASED'].includes(booking.settlement_status)
  const canCancel = booking.status === 'CONFIRMED' && !!decision && !decision.requiresReview && !attendanceSettled
  return <section className="rounded-[8px] border border-needle/14 bg-white/86 p-5 shadow-sm">
    {notice ? <p role="status" className="mb-3 rounded-[8px] bg-needle/10 px-3 py-2 text-sm font-semibold text-needle">{notice}</p> : null}
    {error ? <p role="alert" className="mb-3 rounded-[8px] bg-rust/8 px-3 py-2 text-sm font-semibold text-rust">{error}</p> : null}
    {copy[booking.settlement_status] ? <p className="text-sm leading-6 text-ink/58">{copy[booking.settlement_status]}</p> : null}
    {canCancel && !open ? <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm font-semibold text-rust">Cancel consultation</button> : null}
    {open ? <div className="mt-4 grid gap-3 border-t border-ink/8 pt-4">
      <div className="rounded-[8px] border border-needle/14 bg-bone/60 p-4 text-sm leading-6 text-ink/72">
        <strong className="block text-ink">{actorRole === 'TAILOR' || decision?.refundAmount === booking.fee_amount ? 'Full refund' : 'Late cancellation'}</strong>
        {decision && booking.fee_mode === 'PAID' ? <><span className="block">Customer refund: {money(decision.refundAmount, booking.fee_currency)}</span>{decision.tailorEarnedAmount > 0 ? <span className="block">Tailor earns: {money(decision.tailorEarnedAmount, booking.fee_currency)}</span> : null}<span className="mt-1 block text-xs text-ink/50">Refunds return through the original payment provider.</span></> : <span>No fee will move.</span>}
      </div>
      <label className="grid gap-1.5 text-sm font-semibold text-ink">Why are you cancelling?<textarea value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={500} rows={3} className="rounded-[8px] border border-ui-border bg-white px-3 py-2.5 font-normal" placeholder="Add a short reason" /></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || reason.trim().length < 2} onClick={() => { void cancelConsultation() }} className="rounded-[8px] bg-rust px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null) }} className="rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink">Keep consultation</button></div>
    </div> : null}
  </section>
}

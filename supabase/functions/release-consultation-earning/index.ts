import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { createPaystackTransfer } from '../_shared/paystack.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { notificationDestinationData } from '../../../packages/shared/src/notification-policy.ts'

const FN = 'release-consultation-earning'
const Body = z.object({ bookingId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(Body, await request.json().catch(() => ({})))
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  let payoutId: string | null = null
  let orderId: string | null = null
  try {
    const { data: booking, error } = await supabase.from('consultation_bookings')
      .select('id,order_id,customer_id,tailor_id,fee_amount,fee_currency,earned_amount,settlement_status,payout_id,settlement_provider_reference,commercial_correlation_id,policy_version')
      .eq('id', parsed.data.bookingId).maybeSingle()
    if (error) throw error
    if (!booking) return json({ ok: false, error: 'Consultation was not found.' }, 404, cors)
    orderId = booking.order_id
    if (booking.settlement_status === 'RELEASED') return json({ ok: true, existing: true, payoutId: booking.payout_id, providerReference: booking.settlement_provider_reference }, 200, cors)
    if (!['EARNED', 'RELEASE_PENDING', 'FAILED'].includes(booking.settlement_status) || !booking.earned_amount) {
      return json({ ok: false, error: 'This consultation earning is not eligible for release.' }, 409, cors)
    }
    const { count: openReviews } = await supabase.from('consultation_attendance_reviews').select('id', { count: 'exact', head: true }).eq('booking_id', booking.id).in('status', ['COUNTERPARTY_REVIEW', 'OPS_REVIEW'])
    if ((openReviews ?? 0) > 0) return json({ ok: false, error: 'Attendance review must finish before money moves.' }, 409, cors)

    const { data: profile } = await supabase.from('tailor_profiles')
      .select('id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
      .eq('user_id', booking.tailor_id).maybeSingle()
    if (!profile?.id || profile.payout_account_verified !== true || profile.payout_reverification_required === true) throw new Error('Tailor payout account is not verified.')
    const currency = String(booking.fee_currency ?? '').toUpperCase()
    const provider = currency === 'NGN' ? 'PAYSTACK' : 'STRIPE'
    if (provider === 'PAYSTACK' && !profile.paystack_recipient_code) throw new Error('Paystack recipient is missing.')
    if (provider === 'STRIPE' && !profile.stripe_connect_account_id) throw new Error('Stripe Connect account is missing.')
    const { data: payment } = await supabase.from('order_payments').select('id').eq('order_id', booking.order_id).eq('phase', 'CONSULTATION').in('status', ['SUCCEEDED','PARTIAL_REFUND','REFUNDED']).order('created_at', { ascending: false }).limit(1).maybeSingle()

    await supabase.from('consultation_bookings').update({ settlement_status: 'RELEASE_PENDING', settlement_failure_reason: null }).eq('id', booking.id).in('settlement_status', ['EARNED','FAILED'])
    const { data: payout, error: payoutError } = await supabase.from('payouts').insert({
      tailor_profile_id: profile.id, order_id: booking.order_id, amount: booking.earned_amount,
      currency, provider, status: 'PROCESSING', payout_purpose: 'CONSULTATION_EARNING', source_payment_id: payment?.id ?? null,
      provider_response: { function: FN, consultation_booking_id: booking.id },
    }).select('id').single()
    if (payoutError) throw payoutError
    payoutId = payout.id
    await supabase.from('consultation_commercial_events').insert({ booking_id: booking.id, order_id: booking.order_id, event_type: 'PAYOUT_STARTED', actor_role: 'SYSTEM', amount: booking.earned_amount, currency, correlation_id: booking.commercial_correlation_id, payload: { payout_id: payout.id, provider } })

    let providerReference: string
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({ amount: booking.earned_amount, recipientCode: profile.paystack_recipient_code!, reason: 'Drapeon consultation earning', reference: `DRAPE-CONSULT-${booking.id}`, currency })
      providerReference = transfer.reference ?? transfer.transfer_code ?? `DRAPE-CONSULT-${booking.id}`
      await supabase.from('payouts').update({
        provider_payout_id: providerReference,
        provider_response: {
          function: FN,
          consultation_booking_id: booking.id,
          provider_reference: providerReference,
          terminal_outcome: 'PENDING_PROVIDER_CONFIRMATION',
        },
      }).eq('id', payout.id)
      await supabase.from('consultation_bookings').update({
        settlement_status: 'RELEASE_PENDING',
        payout_id: payout.id,
        settlement_provider_reference: providerReference,
        settlement_failure_reason: null,
      }).eq('id', booking.id)
      await audit(supabase, {
        event: 'consultation.earning_release_submitted',
        actor_role: 'SYSTEM',
        order_id: booking.order_id,
        payload: { function: FN, booking_id: booking.id, payout_id: payout.id, provider, provider_reference: providerReference },
      })
      return json({ ok: true, pending: true, payoutId: payout.id, providerReference }, 202, cors)
    } else {
      const transfer = await createStripeTransfer({ amount: booking.earned_amount, currency, destinationAccountId: profile.stripe_connect_account_id!, idempotencyKey: `DRAPE-CONSULT-${booking.id}`, transferGroup: `order:${booking.order_id}`, metadata: { order_id: booking.order_id, consultation_booking_id: booking.id, payout_id: payout.id } })
      providerReference = transfer.id
    }

    const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
      p_idempotency_key: `consultation-release:${booking.id}`, p_transaction_kind: 'ADJUSTMENT', p_purpose: 'CONSULTATION_RELEASE', p_order_id: booking.order_id,
      p_payment_id: payment?.id ?? null, p_policy_version: booking.policy_version, p_pricing_version: 1, p_correlation_id: booking.commercial_correlation_id,
      p_provider_reference: providerReference, p_entries: [
        { accountCode: 'CONSULTATION_ENTITLEMENT', accountScope: booking.order_id, direction: 'DEBIT', amount: booking.earned_amount, currency },
        { accountCode: 'TAILOR_RELEASED', accountScope: booking.order_id, direction: 'CREDIT', amount: booking.earned_amount, currency },
      ], p_metadata: { consultation_booking_id: booking.id, payout_id: payout.id }, p_actor_role: 'SYSTEM',
      p_original_currency: currency, p_original_amount: booking.earned_amount, p_settlement_currency: currency, p_settlement_amount: booking.earned_amount,
    })
    if (ledgerError) throw ledgerError
    const now = new Date().toISOString()
    await supabase.from('payouts').update({ status: provider === 'STRIPE' ? 'PROCESSING' : 'PAID', provider_payout_id: providerReference, provider_transfer_status: provider === 'STRIPE' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK', bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'PAID', provider_destination_id: provider === 'STRIPE' ? profile.stripe_connect_account_id : profile.paystack_recipient_code, bank_settlement_completed_at: provider === 'STRIPE' ? null : now, completed_at: provider === 'STRIPE' ? null : now, provider_response: { function: FN, consultation_booking_id: booking.id, provider_reference: providerReference, ledger_transaction_id: ledgerId } }).eq('id', payout.id)
    await supabase.from('consultation_bookings').update({ settlement_status: 'RELEASED', payout_id: payout.id, settlement_provider_reference: providerReference, settled_at: now, settlement_failure_reason: null }).eq('id', booking.id)
    await supabase.from('consultation_commercial_events').insert({ booking_id: booking.id, order_id: booking.order_id, event_type: 'PAYOUT_RELEASED', actor_role: 'SYSTEM', amount: booking.earned_amount, currency, correlation_id: booking.commercial_correlation_id, payload: { payout_id: payout.id, provider, provider_reference: providerReference, ledger_transaction_id: ledgerId } })
    await audit(supabase, { event: 'consultation.earning_released', actor_role: 'SYSTEM', order_id: booking.order_id, payload: { function: FN, booking_id: booking.id, amount: booking.earned_amount, currency, provider, payout_id: payout.id, provider_reference: providerReference } })
    await Promise.allSettled([
      enqueuePushJob(supabase, { userId: booking.tailor_id, orderId: booking.order_id, source: FN, idempotencyKey: `${FN}:push:${booking.id}`, priority: 9, notification: { title: 'Consultation fee released', body: provider === 'STRIPE' ? 'Your consultation earning is in your Stripe balance. Bank arrival will be tracked separately.' : 'Your verified consultation earning was sent to your payout account.', preferenceKey: 'paymentReleased', data: notificationDestinationData({ kind: 'ORDER', orderId: booking.order_id }) } }),
      enqueueOrderEventEmailJob(supabase, { recipientUserId: booking.tailor_id, audience: 'TAILOR', order: { id: booking.order_id }, subject: 'Your consultation fee was released', headline: 'Consultation fee released', body: provider === 'STRIPE' ? 'Drapeon released the earned fee to your Stripe balance. Earnings will update again when Stripe reports the bank payout outcome.' : 'Drapeon verified the consultation outcome and sent the earned fee to your payout account.', ctaLabel: 'View order', source: FN, priority: 9, idempotencyKey: `${FN}:email:${booking.id}` }),
    ])
    return json({ ok: true, payoutId: payout.id, providerReference }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (payoutId) await supabase.from('payouts').update({ status: 'FAILED', failed_at: new Date().toISOString(), provider_response: { function: FN, error: message, terminal_outcome: 'FAILED' } }).eq('id', payoutId)
    await supabase.from('consultation_bookings').update({ settlement_status: 'FAILED', settlement_failure_reason: message }).eq('id', parsed.data.bookingId)
    if (orderId) await createOrRefreshOpsIssue(supabase, { issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId, relatedEntityType: 'CONSULTATION_BOOKING', relatedEntityId: parsed.data.bookingId, title: 'Consultation earning release failed', description: 'A verified consultation earning did not reach a terminal provider payout.', recommendedAction: 'Review the payout destination, provider response, and consultation ledger before retrying from Money Desk.', dedupeKey: `consultation-payout-failed:${parsed.data.bookingId}`, metadata: { payout_id: payoutId, error: message } })
    await Sentry.captureMessage('Consultation earning release failed', { level: 'error', tags: { function: FN, failure_class: 'consultation_release' }, extra: { booking_id: parsed.data.bookingId, payout_id: payoutId, order_id: orderId, error: message } })
    log('error', FN, 'failed', { booking_id: parsed.data.bookingId, payout_id: payoutId, error: message })
    return json({ ok: false, error: message }, 500, cors)
  }
})

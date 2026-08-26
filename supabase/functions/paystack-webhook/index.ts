import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { markInitialOrderPaymentFailed } from '../_shared/payment-failure.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueueOrderConfirmationEmailJob } from '../_shared/payment-side-effects.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
import { sendSmsToUser } from '../_shared/sms.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'
import {
  fulfillmentPaymentConfirmedStageNote,
  paymentConfirmedStageNote,
  tailorFulfillmentPaymentConfirmedNotification,
  tailorPaymentConfirmedNotification,
} from '../_shared/payment-copy.ts'
import {
  buildCustomerOrderPaymentSms,
  buildRefundFailedSms,
  buildTailorOrderPaymentSms,
} from '../../../packages/shared/src/sms-copy.ts'
import {
  createWebhookEvent,
  findPaymentAttemptByProviderPaymentId,
  markPaymentAttemptStatus,
  markWebhookEventProcessed,
} from '../_shared/payment-ledger.ts'
import { recordRejectedWebhook } from '../_shared/payment-webhook.ts'
import {
  enqueueVerifiedPaymentWebhook,
  loadQueuedPaymentWebhook,
  shouldRecoverProcessedPaymentWebhook,
} from '../_shared/payment-webhook.ts'
import { verifyPaystackWebhookSignature, type PaystackTransaction } from '../_shared/paystack.ts'
import { enqueueTipConfirmedSideEffects } from '../_shared/tip-side-effects.ts'
import { completeTipPayout, holdTipPayout, type ReleasableTip } from '../_shared/tip-payout.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { finalizeRefundOnAttempt } from '../_shared/payment-refunds.ts'
import { refundOutcomeMessage, refundTimingMessage } from '../_shared/refund-guidance.ts'
import { Sentry } from '../_shared/sentry.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { enqueueFabricReleaseOutcomeSideEffects } from '../_shared/fabric-release.ts'
import { markDispatchRefundTerminal } from '../_shared/drapeon-dispatch-refund.ts'
import { finalizeDispatchShortfallFunding } from '../_shared/drapeon-dispatch.ts'

const FN = 'paystack-webhook'
const textEncoder = new TextEncoder()

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type PaystackEvent = {
  event: string
  data?: Record<string, unknown> | null
}

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  tailor_id?: string | null
  customer_id?: string | null
  seller_item_id?: string | null
  item_title?: string | null
  item_size?: string | null
  garment_type?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  currency?: string | null
  fulfillment_fee?: number | null
  consultation_fee?: number | null
  special_note?: string | null
  payment_intent_id?: string | null
  delivery_method?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_intent_id?: string | null
}

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION' | 'MATERIAL_ADVANCE' | 'TIP'
const PAYMENT_REVERSAL_TERMINAL_STAGES = new Set(['COMPLETE', 'CANCELLED', 'REFUNDED', 'DECLINED', 'EXPIRED'])

async function findPayoutForReference(supabase: SupabaseClient, reference: string) {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, order_id, status, provider_payout_id, material_advance_id, fabric_candidate_id')
    .eq('provider', 'PAYSTACK')
    .eq('provider_payout_id', reference)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null; material_advance_id: string | null; fabric_candidate_id: string | null } | null) ?? null
}

async function finalizeFabricCandidateRelease(
  supabase: SupabaseClient,
  payout: { id: string; fabric_candidate_id: string | null },
  reference: string,
  succeeded: boolean,
  providerResponse: Record<string, unknown>,
) {
  if (!payout.fabric_candidate_id) return
  const { data, error } = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
    p_candidate_id: payout.fabric_candidate_id,
    p_payout_id: payout.id,
    p_provider: 'PAYSTACK',
    p_provider_reference: reference,
    p_outcome: succeeded ? 'SUCCEEDED' : 'FAILED',
    p_provider_response: providerResponse,
  })
  if (error) throw error
  if (succeeded) {
    await resolveOpsIssueByDedupeKey(supabase, `fabric-candidate:release:${payout.fabric_candidate_id}`, { providerReference: reference })
  }
  await enqueueFabricReleaseOutcomeSideEffects(supabase, {
    candidateId: payout.fabric_candidate_id,
    outcome: succeeded ? 'SUCCEEDED' : 'FAILED',
  })
  return data
}

async function finalizeFundedFabricRelease(
  supabase: SupabaseClient,
  payout: { id: string; material_advance_id: string | null },
  reference: string,
  succeeded: boolean,
  providerResponse: Record<string, unknown>,
) {
  if (!payout.material_advance_id) return
  const { data: advance } = await supabase.from('order_material_advances')
    .select('money_desk_request_id,funding_source').eq('id', payout.material_advance_id).maybeSingle()
  if (advance?.funding_source !== 'FUNDED_FABRIC_ALLOWANCE') return
  const { error } = await supabase.rpc('record_funded_fabric_provider_outcome', {
    p_advance_id: payout.material_advance_id,
    p_payout_id: payout.id,
    p_provider_reference: reference,
    p_outcome: succeeded ? 'SUCCEEDED' : 'FAILED',
    p_provider_response: providerResponse,
  })
  if (error) throw new Error(error.message)
  if (advance.money_desk_request_id) {
    const { data: attempt } = await supabase.from('money_desk_execution_attempts')
      .select('id').eq('request_id', advance.money_desk_request_id).eq('status', 'PROCESSING')
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (attempt?.id) {
      const { error: completeError } = await supabase.rpc('complete_money_desk_execution', {
        p_attempt_id: attempt.id,
        p_status: succeeded ? 'SUCCEEDED' : 'FAILED',
        p_provider_reference: reference,
        p_failure_code: succeeded ? null : 'PROVIDER_TRANSFER_FAILED',
        p_failure_summary: succeeded ? null : 'Paystack reported a terminal transfer failure.',
      })
      if (completeError) throw new Error(completeError.message)
    }
  }
  const { data: materialOrder } = await supabase.from('orders').select('id,customer_id,tailor_id').eq('id', (await supabase.from('order_material_advances').select('order_id').eq('id', payout.material_advance_id).single()).data?.order_id ?? '').maybeSingle()
  if (materialOrder?.id) {
    const title = succeeded ? 'Fabric funds released' : 'Fabric release needs review'
    const tailorBody = succeeded ? 'Paystack confirmed the approved fabric release. Upload the final receipt and acquired-fabric proof after purchase.' : 'Paystack did not complete the fabric release. Drapeon Ops is reviewing it; do not start a duplicate request.'
    const customerBody = succeeded ? 'Paystack confirmed the approved release from your protected fabric allowance. Any remaining allowance stays protected.' : 'The approved fabric release did not complete. Your remaining protected allowance has not been reduced.'
    await Promise.all([
      enqueuePushJob(supabase, { userId: materialOrder.tailor_id, orderId: materialOrder.id, source: FN, idempotencyKey: `funded-fabric-provider:${succeeded ? 'success' : 'failed'}:tailor:${payout.material_advance_id}`, priority: 20, notification: { title, body: tailorBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: materialOrder.id, advanceId: payout.material_advance_id, action: succeeded ? 'RELEASE_CONFIRMED' : 'RELEASE_FAILED' } } }),
      enqueuePushJob(supabase, { userId: materialOrder.customer_id, orderId: materialOrder.id, source: FN, idempotencyKey: `funded-fabric-provider:${succeeded ? 'success' : 'failed'}:customer:${payout.material_advance_id}`, priority: 20, notification: { title, body: customerBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: materialOrder.id, advanceId: payout.material_advance_id, action: succeeded ? 'RELEASE_CONFIRMED' : 'RELEASE_FAILED' } } }),
      enqueueOrderEventEmailJob(supabase, { recipientUserId: materialOrder.tailor_id, audience: 'TAILOR', order: { id: materialOrder.id }, subject: title, headline: title, body: tailorBody, ctaLabel: 'View order', materialAdvanceId: payout.material_advance_id, action: succeeded ? 'RELEASE_CONFIRMED' : 'RELEASE_FAILED', source: FN, priority: 20, idempotencyKey: `funded-fabric-provider:${succeeded ? 'success' : 'failed'}:tailor:${payout.material_advance_id}` }),
      enqueueOrderEventEmailJob(supabase, { recipientUserId: materialOrder.customer_id, audience: 'CUSTOMER', order: { id: materialOrder.id }, subject: title, headline: title, body: customerBody, ctaLabel: 'View order', materialAdvanceId: payout.material_advance_id, action: succeeded ? 'RELEASE_CONFIRMED' : 'RELEASE_FAILED', source: FN, priority: 20, idempotencyKey: `funded-fabric-provider:${succeeded ? 'success' : 'failed'}:customer:${payout.material_advance_id}` }),
    ])
  }
}

async function finalizeConsultationEarningRelease(
  supabase: SupabaseClient,
  payout: { id: string; order_id: string | null },
  reference: string,
  succeeded: boolean,
  providerResponse: Record<string, unknown>,
) {
  const { data: booking, error: bookingError } = await supabase.from('consultation_bookings')
    .select('id,order_id,tailor_id,earned_amount,fee_currency,policy_version,commercial_correlation_id,settlement_status')
    .eq('payout_id', payout.id)
    .maybeSingle()
  if (bookingError) throw new Error(bookingError.message)
  if (!booking?.id || booking.settlement_status === 'RELEASED') return

  if (!succeeded) {
    const reason = 'Paystack reported a terminal consultation payout failure.'
    await supabase.from('consultation_bookings').update({
      settlement_status: 'FAILED',
      settlement_failure_reason: reason,
      settlement_provider_reference: reference,
    }).eq('id', booking.id)
    await supabase.from('consultation_commercial_events').insert({
      booking_id: booking.id,
      order_id: booking.order_id,
      event_type: 'PAYOUT_FAILED',
      actor_role: 'SYSTEM',
      amount: booking.earned_amount,
      currency: booking.fee_currency,
      correlation_id: booking.commercial_correlation_id,
      payload: { payout_id: payout.id, provider: 'PAYSTACK', provider_reference: reference, provider_response: providerResponse },
    })
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'PAYOUT_FAILED',
      severity: 'CRITICAL',
      source: FN,
      actorRole: 'SYSTEM',
      orderId: booking.order_id,
      relatedEntityType: 'CONSULTATION_BOOKING',
      relatedEntityId: booking.id,
      title: 'Consultation earning release failed',
      description: 'Paystack reported a terminal failure for a verified consultation earning.',
      recommendedAction: 'Review the provider response and payout destination before retrying from Money Desk.',
      dedupeKey: `consultation-payout-failed:${booking.id}`,
      metadata: { payout_id: payout.id, provider_reference: reference },
    })
    return
  }

  const amount = Number(booking.earned_amount ?? 0)
  const currency = String(booking.fee_currency ?? '').toUpperCase()
  if (!Number.isFinite(amount) || amount <= 0 || !currency) throw new Error('Consultation earning is missing a valid amount or currency.')
  const { data: payment } = await supabase.from('order_payments').select('id')
    .eq('order_id', booking.order_id).eq('phase', 'CONSULTATION')
    .in('status', ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: `consultation-release:${booking.id}`,
    p_transaction_kind: 'ADJUSTMENT',
    p_purpose: 'CONSULTATION_RELEASE',
    p_order_id: booking.order_id,
    p_payment_id: payment?.id ?? null,
    p_policy_version: booking.policy_version,
    p_pricing_version: 1,
    p_correlation_id: booking.commercial_correlation_id,
    p_provider_reference: reference,
    p_entries: [
      { accountCode: 'CONSULTATION_ENTITLEMENT', accountScope: booking.order_id, direction: 'DEBIT', amount, currency },
      { accountCode: 'TAILOR_RELEASED', accountScope: booking.order_id, direction: 'CREDIT', amount, currency },
    ],
    p_metadata: { consultation_booking_id: booking.id, payout_id: payout.id },
    p_actor_role: 'SYSTEM',
    p_original_currency: currency,
    p_original_amount: amount,
    p_settlement_currency: currency,
    p_settlement_amount: amount,
  })
  if (ledgerError) throw new Error(ledgerError.message)
  const now = new Date().toISOString()
  await supabase.from('consultation_bookings').update({
    settlement_status: 'RELEASED',
    settlement_provider_reference: reference,
    settled_at: now,
    settlement_failure_reason: null,
  }).eq('id', booking.id)
  await supabase.from('consultation_commercial_events').insert({
    booking_id: booking.id,
    order_id: booking.order_id,
    event_type: 'PAYOUT_RELEASED',
    actor_role: 'SYSTEM',
    amount,
    currency,
    correlation_id: booking.commercial_correlation_id,
    payload: { payout_id: payout.id, provider: 'PAYSTACK', provider_reference: reference, ledger_transaction_id: ledgerId },
  })
  await audit(supabase, {
    event: 'consultation.earning_released',
    actor_role: 'SYSTEM',
    order_id: booking.order_id,
    payload: { function: FN, booking_id: booking.id, amount, currency, provider: 'PAYSTACK', payout_id: payout.id, provider_reference: reference },
  })
  await Promise.allSettled([
    enqueuePushJob(supabase, { userId: booking.tailor_id, orderId: booking.order_id, source: FN, idempotencyKey: `release-consultation-earning:push:${booking.id}`, priority: 9, notification: { title: 'Consultation fee released', body: 'Your verified consultation earning was sent to your payout account.', preferenceKey: 'paymentReleased', data: { destination: 'ORDER', orderId: booking.order_id } } }),
    enqueueOrderEventEmailJob(supabase, { recipientUserId: booking.tailor_id, audience: 'TAILOR', order: { id: booking.order_id }, subject: 'Your consultation fee was released', headline: 'Consultation fee released', body: 'Drapeon verified the consultation outcome and sent the earned fee to your payout account.', ctaLabel: 'View order', source: FN, priority: 9, idempotencyKey: `release-consultation-earning:email:${booking.id}` }),
  ])
}

async function recordProviderPayoutFailure(
  supabase: SupabaseClient,
  input: {
    payoutId: string
    orderId: string | null
    providerPayoutId: string
    eventType: string
  },
) {
  let tailorId: string | null = null
  let orderReference: string | null = null

  if (input.orderId) {
    const { data } = await supabase
      .from('orders')
      .select('tailor_id, reference')
      .eq('id', input.orderId)
      .maybeSingle()

    tailorId = typeof data?.tailor_id === 'string' ? data.tailor_id : null
    orderReference = typeof data?.reference === 'string' ? data.reference : null
  }

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: input.orderId,
    userId: tailorId,
    provider: 'PAYSTACK',
    title: 'Paystack payout failed',
    description: `Paystack reported a payout failure for order ${orderReference ?? input.orderId ?? 'unknown'}.`,
    recommendedAction: 'Review the Paystack transfer, verify the tailor payout destination, and retry manually only after the failure cause is clear.',
    dedupeKey: `payout-failed:${input.payoutId}`,
    metadata: {
      provider: 'PAYSTACK',
      payout_id: input.payoutId,
      provider_payout_id: input.providerPayoutId,
      paystack_event_type: input.eventType,
    },
  })

  if (tailorId && input.orderId) {
    await sendPushToUser(supabase, tailorId, {
      title: 'Payout needs review',
      body: 'A payout release for this order needs Drapeon ops review before it can be retried.',
      data: { orderId: input.orderId },
    })
  }
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function paystackProviderEventId(event: PaystackEvent, payload: string) {
  const transactionId =
    typeof event.data?.id === 'number'
      ? String(event.data.id)
      : typeof event.data?.reference === 'string' && event.data.reference.trim().length > 0
        ? event.data.reference.trim()
        : await sha256Hex(payload)

  return `paystack:${event.event}:${transactionId}`
}

function metadataOrderId(transaction: PaystackTransaction | null | undefined) {
  const value = transaction?.metadata?.order_id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

async function findOrderForReference(supabase: SupabaseClient, reference: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('payment_intent_id', reference)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.id) return data as OrderRow

  const { data: fulfillmentData, error: fulfillmentError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('fulfillment_payment_intent_id', reference)
    .maybeSingle()

  if (fulfillmentError) {
    throw new Error(fulfillmentError.message)
  }

  return fulfillmentData as OrderRow | null
}

async function findOrderForTransaction(supabase: SupabaseClient, transaction: PaystackTransaction) {
  const orderId = metadataOrderId(transaction)
  if (orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
      .eq('id', orderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  return findOrderForReference(supabase, transaction.reference)
}

function paymentPhaseForTransaction(order: OrderRow, transaction: PaystackTransaction): PaymentPhase {
  const metadataPhase =
    typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'CONSULTATION'
      ? 'CONSULTATION'
      : typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'FULFILLMENT'
      ? 'FULFILLMENT'
      : typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'MATERIAL_ADVANCE'
      ? 'MATERIAL_ADVANCE'
      : typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'INITIAL_ORDER'
        ? 'INITIAL_ORDER'
      : typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'TIP'
        ? 'TIP'
        : null

  if (metadataPhase) return metadataPhase
  if (parseOrderSupportMeta(order.special_note).consultation?.paymentIntentId === transaction.reference) return 'CONSULTATION'
  if (order.fulfillment_payment_intent_id === transaction.reference) return 'FULFILLMENT'
  return 'INITIAL_ORDER'
}

async function markMaterialAdvancePayment(
  supabase: SupabaseClient,
  order: OrderRow,
  transaction: PaystackTransaction,
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED',
) {
  const advanceId =
    typeof transaction.metadata?.material_advance_id === 'string' && transaction.metadata.material_advance_id.trim().length > 0
      ? transaction.metadata.material_advance_id.trim()
      : ''

  let query = supabase
    .from('order_material_advances')
    .select('id, title, status, paid_at')
    .eq('order_id', order.id)

  query = advanceId
    ? query.eq('id', advanceId)
    : query.eq('payment_provider', 'PAYSTACK').eq('provider_payment_id', transaction.reference)

  const { data: advance, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!advance?.id) return false

  if (status !== 'SUCCEEDED') {
    const { error: updateError } = await supabase
      .from('order_material_advances')
      .update({
        status: 'PAYMENT_FAILED',
      })
      .eq('id', advance.id)
      .in('status', ['PAYMENT_PENDING', 'PAYMENT_FAILED'])
    if (updateError) throw new Error(updateError.message)
    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: `Material advance payment failed for ${advance.title ?? 'materials'}.`,
    })
    return true
  }

  if (advance.paid_at || advance.status === 'OPS_REVIEW' || advance.status === 'RELEASED') return false

  const { data: updated, error: updateError } = await supabase
    .from('order_material_advances')
    .update({
      status: 'OPS_REVIEW',
      release_status: 'OPS_REVIEW',
      payment_provider: 'PAYSTACK',
      provider_payment_id: transaction.reference,
      provider_checkout_url: null,
      paid_at: new Date().toISOString(),
      release_requested_at: new Date().toISOString(),
    })
    .eq('id', advance.id)
    .in('status', ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW'])
    .select('id')
    .maybeSingle()

  if (updateError) throw new Error(updateError.message)
  if (!updated?.id) return false

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: order.stage,
    note: `Material advance paid for ${advance.title ?? 'materials'}. Drapeon ops will review release before funds move.`,
  })

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'ORDER_REVIEW',
    severity: 'HIGH',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: order.id,
    userId: order.tailor_id ?? null,
    provider: 'PAYSTACK',
    title: 'Material advance paid',
    description: `Customer paid a material advance for order ${order.reference ?? order.id}. Ops must review before releasing this material amount to the tailor.`,
    recommendedAction: 'Confirm the expense is valid for the order, release only this material amount if appropriate, and require receipt proof after purchase.',
    dedupeKey: `material-advance:paid-release-review:${advance.id}`,
    relatedEntityType: 'order_material_advance',
    relatedEntityId: advance.id,
    metadata: {
      material_advance_id: advance.id,
      provider_payment_id: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
    },
  })

  return true
}

type OrderPaymentPhase = Exclude<PaymentPhase, 'MATERIAL_ADVANCE' | 'TIP'>

async function markOrderConfirmed(supabase: SupabaseClient, order: OrderRow, transaction: PaystackTransaction, phase: OrderPaymentPhase) {
  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') return false
  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) {
    await finalizeDispatchShortfallFunding(supabase, {
      orderId: order.id,
      actorRole: 'SYSTEM',
      provider: 'PAYSTACK',
      providerPaymentId: transaction.reference,
    })
    return false
  }

  if (phase === 'CONSULTATION') {
    const supportMeta = parseOrderSupportMeta(order.special_note)
    const consultation = supportMeta.consultation
    if (consultation?.paidAt) {
      await supabase.from('consultation_bookings').update({ payment_status: 'PAID', paid_at: consultation.paidAt, settlement_status: 'HELD' }).eq('order_id', order.id).eq('status', 'CONFIRMED')
      return false
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        special_note: serializeOrderSupportMeta({
          ...supportMeta,
          consultation: consultation
            ? {
                ...consultation,
                paymentProvider: 'PAYSTACK',
                paymentIntentId: transaction.reference,
                paymentCheckoutUrl: null,
                paidAt: new Date().toISOString(),
              }
            : consultation,
        }),
      })
      .eq('id', order.id)
      .select('id')
      .maybeSingle()

    if (updateError) throw new Error(updateError.message)
    if (!updatedOrder?.id) return false

    await supabase.from('consultation_bookings').update({
      payment_status: 'PAID',
      paid_at: new Date().toISOString(),
      settlement_status: 'HELD',
      updated_at: new Date().toISOString(),
    }).eq('order_id', order.id).eq('status', 'CONFIRMED')

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: 'Consultation fee paid. The consultation can start at the scheduled time.',
    })

    if (order.tailor_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.tailor_id.toString(), {
          title: 'Consultation fee paid',
          body: 'The customer paid the consultation fee. The call can start at the scheduled time.',
          preferenceKey: 'newOrders',
          data: { orderId: order.id },
        }),
      )
    }

    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase,
      source: FN,
      provider: 'PAYSTACK',
    })

    return true
  }

  if (phase === 'FULFILLMENT') {
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        fulfillment_payment_provider: 'PAYSTACK',
        fulfillment_payment_intent_id: transaction.reference,
        fulfillment_payment_checkout_url: null,
        fulfillment_payment_paid_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .is('fulfillment_payment_paid_at', null)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error(updateError.message)
    }

    if (!updatedOrder?.id) return false

    await finalizeDispatchShortfallFunding(supabase, {
      orderId: order.id,
      actorRole: 'SYSTEM',
      provider: 'PAYSTACK',
      providerPaymentId: transaction.reference,
    })

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: fulfillmentPaymentConfirmedStageNote(order.delivery_method),
    })

    if (order.tailor_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.tailor_id.toString(), {
          ...tailorFulfillmentPaymentConfirmedNotification(order.delivery_method),
          preferenceKey: 'newOrders',
          data: { orderId: order.id },
        }),
      )
      EdgeRuntime.waitUntil(
        sendSmsToUser({
          supabase,
          userId: order.tailor_id.toString(),
          audience: 'TAILOR',
          orderId: order.id,
          event: 'order.fulfillment_payment_confirmed',
          body: buildTailorOrderPaymentSms({
            id: order.id,
            reference: order.reference,
            orderKind: order.order_kind,
            garmentType: order.garment_type,
            itemTitle: order.item_title,
            itemSize: order.item_size,
            deliveryMethod: order.delivery_method,
          }, phase),
        }),
      )
    }

    if (order.customer_id) {
      EdgeRuntime.waitUntil(
        sendSmsToUser({
          supabase,
          userId: order.customer_id.toString(),
          audience: 'CUSTOMER',
          orderId: order.id,
          event: 'order.fulfillment_payment_confirmed',
          body: buildCustomerOrderPaymentSms({
            id: order.id,
            reference: order.reference,
            orderKind: order.order_kind,
            garmentType: order.garment_type,
            itemTitle: order.item_title,
            itemSize: order.item_size,
            deliveryMethod: order.delivery_method,
          }, phase),
        }),
      )
    }

    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase,
      source: FN,
      provider: 'PAYSTACK',
    })

    return true
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: 'PAYSTACK',
      payment_intent_id: transaction.reference,
      payment_checkout_url: null,
    })
    .eq('id', order.id)
    .eq('stage', order.stage)
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (!updatedOrder?.id) return false

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'CONFIRMED',
    note: paymentConfirmedStageNote(order.order_kind),
  })

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id.toString(), {
        ...tailorPaymentConfirmedNotification(order.order_kind),
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      }),
    )
    EdgeRuntime.waitUntil(
      sendSmsToUser({
        supabase,
        userId: order.tailor_id.toString(),
        audience: 'TAILOR',
        orderId: order.id,
        event: 'order.payment_confirmed',
        body: buildTailorOrderPaymentSms({
          id: order.id,
          reference: order.reference,
          orderKind: order.order_kind,
          garmentType: order.garment_type,
          itemTitle: order.item_title,
          itemSize: order.item_size,
          deliveryMethod: order.delivery_method,
        }, phase),
      }),
    )
    EdgeRuntime.waitUntil(
      notifyTailorAboutReadyMadeStockChange(supabase, {
        orderKind: order.order_kind,
        sellerItemId: order.seller_item_id,
        tailorId: order.tailor_id?.toString() ?? null,
        itemTitle: order.item_title,
        itemSize: order.item_size,
      }),
    )
  }

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendSmsToUser({
        supabase,
        userId: order.customer_id.toString(),
        audience: 'CUSTOMER',
        orderId: order.id,
        event: 'order.payment_confirmed',
        body: buildCustomerOrderPaymentSms({
          id: order.id,
          reference: order.reference,
          orderKind: order.order_kind,
          garmentType: order.garment_type,
          itemTitle: order.item_title,
          itemSize: order.item_size,
          deliveryMethod: order.delivery_method,
        }, phase),
      }),
    )
  }

  await enqueueOrderConfirmationEmailJob(supabase, {
    order,
    phase,
    source: FN,
    provider: 'PAYSTACK',
  })

  return true
}

function isInitialPaymentStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED'].includes(stage)
}

function isFulfillmentPaymentStage(order: OrderRow) {
  return order.stage === 'FINISHING' || !!order.fulfillment_payment_paid_at
}

async function markPaystackChargeReversed(
  supabase: SupabaseClient,
  input: {
    event: PaystackEvent
    order: OrderRow
    transaction: PaystackTransaction
    phase: PaymentPhase
    paymentAttemptId: string | null
  },
) {
  const nowIso = new Date().toISOString()
  const matchedAttempt = await markPaymentAttemptStatus(supabase, {
    provider: 'PAYSTACK',
    providerPaymentId: input.transaction.reference,
    status: 'REFUNDED',
    providerResponse: input.event as Record<string, unknown>,
  }).catch(() => null)

  const paymentId = matchedAttempt?.id ?? input.paymentAttemptId
  const reversedAmount = Math.max(
    typeof matchedAttempt?.amount === 'number'
      ? matchedAttempt.amount
      : typeof input.transaction.amount === 'number'
        ? input.transaction.amount
        : 0,
    0,
  )

  if (paymentId && reversedAmount > 0) {
    const { error: paymentPatchError } = await supabase
      .from('order_payments')
      .update({
        status: 'REFUNDED',
        refunded_amount: reversedAmount,
        last_refund_amount: reversedAmount,
        last_refund_at: nowIso,
        refunded_at: nowIso,
        provider_response: input.event as Record<string, unknown>,
      })
      .eq('id', paymentId)

    if (paymentPatchError) throw new Error(paymentPatchError.message)
  }

  let orderStageChanged = false
  if (input.phase === 'INITIAL_ORDER' && !PAYMENT_REVERSAL_TERMINAL_STAGES.has(input.order.stage)) {
    const { data: updatedOrder, error: orderUpdateError } = await supabase
      .from('orders')
      .update({
        stage: 'PAYMENT_FAILED',
        stage_updated_at: nowIso,
        payment_provider: 'PAYSTACK',
        payment_intent_id: input.transaction.reference,
        payment_checkout_url: null,
        escrow_released: false,
        escrow_released_at: null,
      })
      .eq('id', input.order.id)
      .select('id')
      .maybeSingle()

    if (orderUpdateError) throw new Error(orderUpdateError.message)
    orderStageChanged = !!updatedOrder?.id
  } else if (input.phase === 'FULFILLMENT') {
    const { error: fulfillmentUpdateError } = await supabase
      .from('orders')
      .update({
        fulfillment_payment_paid_at: null,
        fulfillment_payment_checkout_url: null,
        escrow_released: false,
        escrow_released_at: null,
      })
      .eq('id', input.order.id)

    if (fulfillmentUpdateError) throw new Error(fulfillmentUpdateError.message)
  } else {
    const { error: escrowUpdateError } = await supabase
      .from('orders')
      .update({
        escrow_released: false,
        escrow_released_at: null,
      })
      .eq('id', input.order.id)

    if (escrowUpdateError) throw new Error(escrowUpdateError.message)
  }

  await supabase.from('order_stage_updates').insert({
    order_id: input.order.id,
    stage: orderStageChanged ? 'PAYMENT_FAILED' : input.order.stage,
    note: `Paystack reversed payment ${input.transaction.reference}. Drapeon ops must review the order before work, handoff, or payout continues.`,
  })

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYMENT_BLOCKED',
    severity: 'CRITICAL',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: input.order.id,
    userId: input.order.customer_id ?? null,
    provider: 'PAYSTACK',
    stage: orderStageChanged ? 'PAYMENT_FAILED' : input.order.stage,
    title: 'Paystack payment reversed',
    description: `Paystack reversed payment ${input.transaction.reference} for order ${input.order.reference ?? input.order.id}.`,
    recommendedAction: 'Freeze payout and fulfillment until finance confirms whether money is recoverable. Contact both parties and decide whether to retry payment, pause production, or cancel/refund.',
    dedupeKey: `paystack-charge-reversed:${input.transaction.reference}`,
    metadata: {
      provider: 'PAYSTACK',
      paystack_event_type: input.event.event,
      provider_payment_id: input.transaction.reference,
      order_stage_before: input.order.stage,
      payment_phase: input.phase,
      reversed_amount: reversedAmount,
      currency: input.transaction.currency ?? null,
      payment_id: paymentId,
    },
  })

  if (input.order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, input.order.customer_id.toString(), {
        title: 'Payment needs review',
        body: 'Your payment provider reversed a payment on this order. Drapeon support is reviewing it now.',
        preferenceKey: 'orderUpdates',
        data: { orderId: input.order.id },
      }),
    )
  }

  if (input.order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, input.order.tailor_id.toString(), {
        title: 'Order payment needs review',
        body: 'A Paystack payment for this order was reversed. Pause fulfillment until Drapeon support clears the order.',
        preferenceKey: 'newOrders',
        data: { orderId: input.order.id },
      }),
    )
  }

  await audit(supabase, {
    event: 'payment.reversed',
    actor_role: 'SYSTEM',
    order_id: input.order.id,
    severity: 'error',
    payload: {
      function: FN,
      provider: 'PAYSTACK',
      paystack_event_type: input.event.event,
      payment_intent_id: input.transaction.reference,
      payment_phase: input.phase,
      order_stage_before: input.order.stage,
      order_stage_after: orderStageChanged ? 'PAYMENT_FAILED' : input.order.stage,
      reversed_amount: reversedAmount,
      currency: input.transaction.currency ?? null,
      payment_id: paymentId,
    },
  })

  return { paymentId, reversedAmount, orderStageChanged }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
  const queuedWebhookEventId = req.headers.get('x-drape-webhook-event-id')?.trim() || null
  let queuedProviderEventId: string | null = null
  let recoveringProcessedWebhook = false
  let payload: string

  if (queuedWebhookEventId) {
    const unauthorized = await authorizeCronRequest(req, `${FN}:queued-replay`, cors)
    if (unauthorized) return unauthorized
    const queued = await loadQueuedPaymentWebhook(supabase, {
      webhookEventId: queuedWebhookEventId,
      provider: 'PAYSTACK',
    })
    recoveringProcessedWebhook = !!queued.processed_at && shouldRecoverProcessedPaymentWebhook({
      eventType: queued.event_type,
      processingResult: queued.processing_result,
    })
    if (queued.processed_at && !recoveringProcessedWebhook) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, processed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    queuedProviderEventId = queued.provider_event_id
    payload = JSON.stringify(queued.payload)
  } else {
  const clientIp = getClientIp(req)
  const limit = await rateLimit(
    supabase,
    clientIp,
    FN,
    RATE_LIMITS.webhook.limit,
    RATE_LIMITS.webhook.windowMs,
    { ip: clientIp, userAgent: req.headers.get('user-agent') },
  )
  if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

  const signature = req.headers.get('x-paystack-signature')
  payload = await req.text()

  if (!signature) {
    await recordRejectedWebhook(supabase, {
      provider: 'PAYSTACK',
      functionName: FN,
      rawPayload: payload,
      reason: 'missing_signature',
      signatureHeader: null,
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/paystack',
    })
    return new Response('Missing x-paystack-signature header', { status: 401, headers: cors })
  }

  try {
    await verifyPaystackWebhookSignature({
      payload,
      signatureHeader: signature,
    })
  } catch (error) {
    await recordRejectedWebhook(supabase, {
      provider: 'PAYSTACK',
      functionName: FN,
      rawPayload: payload,
      reason: 'invalid_signature',
      signatureHeader: signature,
      verificationError: error instanceof Error ? error.message : String(error),
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/paystack',
    })
    return new Response('Invalid Paystack signature', { status: 401, headers: cors })
  }

    try {
      const event = JSON.parse(payload) as PaystackEvent
      if (!event?.event || typeof event.event !== 'string') {
        return new Response('Invalid event payload', { status: 400, headers: cors })
      }
      const queued = await enqueueVerifiedPaymentWebhook(supabase, {
        provider: 'PAYSTACK',
        providerEventId: await paystackProviderEventId(event, payload),
        eventType: event.event,
        payload: event as Record<string, unknown>,
        rawPayload: payload,
      })
      return new Response(JSON.stringify({
        ok: true,
        accepted: true,
        duplicate: queued.duplicate,
        alreadyProcessed: queued.alreadyProcessed,
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        return new Response('Invalid JSON payload', { status: 400, headers: cors })
      }
      const message = error instanceof Error ? error.message : String(error)
      log('error', FN, 'webhook.enqueue_failed', { error: message })
      await Sentry.captureMessage('Paystack webhook durable enqueue failed', {
        level: 'error',
        tags: { function: FN, provider: 'PAYSTACK', failure_class: 'durable_enqueue' },
        extra: { safe_error: message.slice(0, 500) },
      })
      return new Response('Webhook intake unavailable', { status: 503, headers: cors })
    }
  }

  try {
    const event = JSON.parse(payload) as PaystackEvent
    const transaction = event.data as PaystackTransaction | null
    const isRefundLifecycleEvent = event.event.startsWith('refund.')
    const providerPaymentReference = isRefundLifecycleEvent && typeof event.data?.transaction_reference === 'string' && event.data.transaction_reference.trim().length > 0
        ? event.data.transaction_reference.trim()
        : typeof transaction?.reference === 'string' && transaction.reference.trim().length > 0
          ? transaction.reference.trim()
          : typeof event.data?.transaction_reference === 'string' && event.data.transaction_reference.trim().length > 0
            ? event.data.transaction_reference.trim()
            : null
    const paymentAttempt = providerPaymentReference
      ? await findPaymentAttemptByProviderPaymentId(supabase, 'PAYSTACK', providerPaymentReference).catch(() => null)
      : null
    const webhookEvent = await createWebhookEvent(supabase, {
      provider: 'PAYSTACK',
      providerEventId: queuedProviderEventId ?? await paystackProviderEventId(event, payload),
      eventType: event.event,
      idempotencyKey:
        paymentAttempt?.idempotency_key
        ?? (typeof transaction?.metadata?.idempotency_key === 'string' ? transaction.metadata.idempotency_key : null),
      orderId: paymentAttempt?.order_id ?? null,
      paymentId: paymentAttempt?.id ?? null,
      signatureValid: true,
      payload: event as Record<string, unknown>,
    })

    if (webhookEvent.duplicate && webhookEvent.alreadyProcessed && !recoveringProcessedWebhook) {
      await audit(supabase, {
        event: 'payment.webhook_duplicate',
        actor_role: 'SYSTEM',
        order_id: paymentAttempt?.order_id ?? null,
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          paystack_event_type: event.event,
          payment_intent_id: transaction?.reference ?? null,
          processing_result: webhookEvent.processingResult,
        },
      })

      return new Response(JSON.stringify({ ok: true, duplicate: true, processed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (['refund.pending','refund.processing','refund.needs-attention','refund.failed','refund.processed'].includes(event.event)) {
      const refundAmount = typeof event.data?.amount === 'number'
        ? event.data.amount
        : typeof event.data?.amount === 'string'
          ? Number.parseInt(event.data.amount, 10)
          : 0
      if (!paymentAttempt?.id || !paymentAttempt.order_id || !providerPaymentReference || !Number.isFinite(refundAmount) || refundAmount <= 0) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: paymentAttempt?.order_id ?? null,
          paymentId: paymentAttempt?.id ?? null,
          processingResult: 'refund_invalid_or_unmatched',
        })
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'REFUND_FAILED',
          severity: 'CRITICAL',
          source: FN,
          actorRole: 'SYSTEM',
          orderId: paymentAttempt?.order_id ?? null,
          provider: 'PAYSTACK',
          title: 'Paystack refund webhook could not be matched',
          description: 'A refund lifecycle event arrived without a safe payment and amount match.',
          recommendedAction: 'Match the Paystack refund and original transaction manually before changing any Drapeon payment or ledger state.',
          dedupeKey: `paystack-refund-unmatched:${providerPaymentReference ?? webhookEvent.id}`,
          metadata: { event_type: event.event, payment_reference: providerPaymentReference, refund_amount: refundAmount },
        })
        return new Response(JSON.stringify({ ok: true, matched: false }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      const { data: payment, error: refundPaymentError } = await supabase.from('order_payments')
        .select('id,order_id,phase,provider,currency,amount,status,provider_payment_id,provider_response,refunded_amount,partial_refund_count,correlation_id')
        .eq('id', paymentAttempt.id).maybeSingle()
      if (refundPaymentError || !payment?.id) throw refundPaymentError ?? new Error('Refund payment was not found.')
      const existingProviderResponse = payment.provider_response && typeof payment.provider_response === 'object'
        ? payment.provider_response as Record<string, unknown>
        : {}
      const latestRequest = existingProviderResponse.latest_refund_request && typeof existingProviderResponse.latest_refund_request === 'object'
        ? existingProviderResponse.latest_refund_request as Record<string, unknown>
        : null
      const resolutionId = typeof latestRequest?.refund_resolution_id === 'string' ? latestRequest.refund_resolution_id : null
      const pendingExactRestoration = latestRequest?.exact_restoration && typeof latestRequest.exact_restoration === 'object'
        ? latestRequest.exact_restoration as Record<string, unknown>
        : null
      if (latestRequest?.refund_amount !== refundAmount) {
        throw new Error('Paystack refund webhook amount does not match the pending refund request.')
      }

      if (event.event === 'refund.pending' || event.event === 'refund.processing' || event.event === 'refund.needs-attention') {
        await supabase.from('order_payments').update({
          provider_response: { ...existingProviderResponse, latest_refund_event: event },
        }).eq('id', payment.id)
        if (event.event === 'refund.needs-attention') {
          await createOrRefreshOpsIssue(supabase, {
            issueType: 'REFUND_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId: payment.order_id, provider: 'PAYSTACK',
            title: 'Paystack refund needs customer bank details',
            description: 'Paystack cannot continue this refund until reviewed customer bank details are supplied.',
            recommendedAction: 'Use Paystack’s reviewed refund-retry process. Do not create a second refund.',
            dedupeKey: `paystack-refund-needs-attention:${payment.id}:${refundAmount}`,
            metadata: { payment_id: payment.id, refund_amount: refundAmount, refund_resolution_id: resolutionId },
          })
        }
        await markWebhookEventProcessed(supabase, webhookEvent.id, { orderId: payment.order_id, paymentId: payment.id, processingResult: event.event })
        return new Response(JSON.stringify({ ok: true, pending: true, status: event.event }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      const isDispatchRefund = resolutionId?.startsWith('dispatch-refund:') ?? false
      const { data: resolution, error: refundResolutionError } = resolutionId && !isDispatchRefund
        ? await supabase.from('order_refund_resolutions')
          .select('id,financial_case_id,money_desk_request_id,amount,tailor_work_amount,platform_fee_amount,tax_amount,fulfillment_amount,consultation_amount,promotion_amount,drapeon_funded_amount,correlation_id,provider_reference,order_outcome,resume_stage,outcome_applied_at')
          .eq('id', resolutionId).eq('order_id', payment.order_id).maybeSingle()
        : { data: null, error: null }
      if (refundResolutionError) throw refundResolutionError
      if (resolution?.id && resolution.amount !== refundAmount) {
        throw new Error('Paystack refund webhook amount does not match the approved refund resolution.')
      }

      if (event.event === 'refund.failed') {
        if (resolution?.id) await supabase.from('order_refund_resolutions').update({ status: 'FAILED', failure_summary: 'Paystack reported that the refund failed.', updated_at: new Date().toISOString() }).eq('id', resolution.id)
        if (resolution?.money_desk_request_id) {
          const { data: attempt } = await supabase.from('money_desk_execution_attempts').select('id').eq('request_id', resolution.money_desk_request_id).eq('status', 'PROCESSING').order('started_at', { ascending: false }).limit(1).maybeSingle()
          if (attempt?.id) await supabase.rpc('complete_money_desk_execution', { p_attempt_id: attempt.id, p_status: 'FAILED', p_provider_reference: event.data?.refund_reference ?? null, p_failure_code: 'PROVIDER_REFUND_FAILED', p_failure_summary: 'Paystack reported that the refund failed.' })
        }
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'REFUND_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId: payment.order_id, provider: 'PAYSTACK',
          title: 'Paystack refund failed', description: 'Paystack returned the pending refund amount to Drapeon instead of completing the customer refund.',
          recommendedAction: 'Review the provider reason and approved resolution before deciding whether to retry the same refund. Do not create a blind duplicate.',
          dedupeKey: `paystack-refund-failed:${payment.id}:${refundAmount}`,
          metadata: { payment_id: payment.id, refund_amount: refundAmount, refund_resolution_id: resolutionId },
        })
        const { data: failedRefundOrder } = await supabase.from('orders').select('id,reference,customer_id,tailor_id').eq('id', payment.order_id).maybeSingle()
        if (failedRefundOrder?.id) {
          for (const recipient of [{ id: failedRefundOrder.customer_id, audience: 'CUSTOMER' as const }, { id: failedRefundOrder.tailor_id, audience: 'TAILOR' as const }]) {
            if (!recipient.id) continue
            const body = recipient.audience === 'CUSTOMER'
              ? 'Paystack could not complete your approved refund. Your case remains open while Drapeon Ops reviews the provider reason; do not start another request.'
              : 'Paystack could not complete the approved customer refund. The order remains under review while Drapeon Ops checks the provider reason.'
            await enqueuePushJob(supabase, { userId: recipient.id, orderId: failedRefundOrder.id, source: FN, idempotencyKey: `paystack-refund-failed:${payment.id}:${refundAmount}:${recipient.audience}:push`, priority: 5, notification: { title: 'Refund needs attention', body, preferenceKey: 'orderUpdates', data: { orderId: failedRefundOrder.id, type: 'refund_failed', refundResolutionId: resolutionId ?? '' } } })
            await enqueueOrderEventEmailJob(supabase, { order: failedRefundOrder, recipientUserId: recipient.id, audience: recipient.audience, subject: 'Refund needs attention', headline: 'Refund needs attention', body, ctaLabel: 'View resolution', source: FN, idempotencyKey: `paystack-refund-failed:${payment.id}:${refundAmount}:${recipient.audience}:email`, priority: 5 })
            if (recipient.audience === 'CUSTOMER') {
              await enqueueSmsJob(supabase, { userId: recipient.id, audience: 'CUSTOMER', event: 'REFUND_FAILED', body: buildRefundFailedSms({ provider: 'Paystack', orderReference: failedRefundOrder.reference }), source: FN, orderId: failedRefundOrder.id, idempotencyKey: `paystack-refund-failed:${payment.id}:${refundAmount}:customer:sms`, priority: 5 })
            }
          }
        }
        await markWebhookEventProcessed(supabase, webhookEvent.id, { orderId: payment.order_id, paymentId: payment.id, processingResult: 'refund_failed' })
        await Sentry.captureMessage('Paystack refund reached terminal failure', {
          level: 'error',
          tags: { function: FN, provider: 'PAYSTACK', failure_class: 'refund_terminal_failure' },
          extra: { webhook_event_id: webhookEvent.id, payment_id: payment.id, order_id: payment.order_id, refund_resolution_id: resolutionId, refund_amount: refundAmount },
        })
        await markDispatchRefundTerminal(supabase, { resolutionId, succeeded: false })
        return new Response(JSON.stringify({ ok: true, failed: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      const exactRestoration = resolution?.id ? {
        refundResolutionId: resolution.id,
        tailorWorkAmount: resolution.tailor_work_amount,
        platformFeeAmount: resolution.platform_fee_amount,
        taxAmount: resolution.tax_amount,
        fulfillmentAmount: resolution.fulfillment_amount,
        consultationAmount: resolution.consultation_amount,
        promotionAmount: resolution.promotion_amount,
        drapeonFundedAmount: resolution.drapeon_funded_amount,
      } : pendingExactRestoration && resolutionId ? {
        refundResolutionId: resolutionId,
        tailorWorkAmount: Number(pendingExactRestoration.tailorWorkAmount ?? 0),
        platformFeeAmount: Number(pendingExactRestoration.platformFeeAmount ?? 0),
        taxAmount: Number(pendingExactRestoration.taxAmount ?? 0),
        fulfillmentAmount: Number(pendingExactRestoration.fulfillmentAmount ?? 0),
        consultationAmount: Number(pendingExactRestoration.consultationAmount ?? 0),
        promotionAmount: Number(pendingExactRestoration.promotionAmount ?? 0),
        drapeonFundedAmount: Number(pendingExactRestoration.drapeonFundedAmount ?? 0),
      } : undefined
      if (resolutionId && !exactRestoration) {
        throw new Error('The processed Paystack refund is missing its exact approved refund resolution.')
      }
      if (exactRestoration && Object.entries(exactRestoration).some(([key, value]) => key !== 'refundResolutionId' && (!Number.isInteger(value) || Number(value) < 0))) {
        throw new Error('The processed Paystack refund has an invalid exact restoration contract.')
      }
      if (exactRestoration && exactRestoration.tailorWorkAmount + exactRestoration.platformFeeAmount + exactRestoration.taxAmount + exactRestoration.fulfillmentAmount + exactRestoration.consultationAmount + exactRestoration.promotionAmount + exactRestoration.drapeonFundedAmount !== refundAmount) {
        throw new Error('The processed Paystack refund does not balance to its exact restoration contract.')
      }
      const rawProviderRefundId = event.data?.id ?? event.data?.refund_reference
      await finalizeRefundOnAttempt(supabase, {
        attempt: payment as never,
        refundAmount,
        providerResponse: {
          id: typeof rawProviderRefundId === 'number' ? rawProviderRefundId : undefined,
          status: 'processed',
          transaction: providerPaymentReference,
          amount: refundAmount,
          currency: payment.currency,
        },
        actorRole: 'SYSTEM',
        reason: typeof latestRequest?.reason === 'string' ? latestRequest.reason : 'Paystack confirmed the approved refund.',
        exactRestoration,
      })
      await markDispatchRefundTerminal(supabase, {
        resolutionId,
        succeeded: true,
        providerReference: typeof event.data?.refund_reference === 'string' || typeof event.data?.refund_reference === 'number'
          ? String(event.data.refund_reference)
          : null,
      })
      const nowIso = new Date().toISOString()
      const providerRefundReference = typeof event.data?.refund_reference === 'string' || typeof event.data?.refund_reference === 'number'
        ? String(event.data.refund_reference)
        : typeof event.data?.id === 'string' || typeof event.data?.id === 'number'
          ? String(event.data.id)
          : typeof resolution?.provider_reference === 'string'
            ? resolution.provider_reference
            : null
      if (resolution?.id) {
        await supabase.from('order_refund_resolutions').update({ status: 'SUCCEEDED', provider_reference: providerRefundReference, failure_summary: null, updated_at: nowIso }).eq('id', resolution.id)
      }
      if (payment.phase === 'CONSULTATION') {
        const { data: booking } = await supabase.from('consultation_bookings')
          .select('id,earned_amount,fee_amount')
          .eq('order_id', payment.order_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (booking?.id) {
          const fullRefund = refundAmount >= (booking.fee_amount ?? payment.amount)
          const nextSettlement = fullRefund ? 'REFUNDED' : (booking.earned_amount ?? 0) > 0 ? 'EARNED' : 'PARTIALLY_REFUNDED'
          await supabase.from('consultation_bookings').update({
            payment_status: fullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            settlement_status: nextSettlement,
            refunded_amount: refundAmount,
            settlement_eligible_at: nextSettlement === 'EARNED' ? nowIso : null,
            settled_at: fullRefund ? nowIso : null,
          }).eq('id', booking.id)
          if (nextSettlement === 'EARNED') {
            EdgeRuntime.waitUntil(supabase.functions.invoke('release-consultation-earning', { body: { bookingId: booking.id } }))
          }
        }
      }
      await supabase.from('ops_issues').update({ status: 'RESOLVED', resolved_at: nowIso, last_seen_at: nowIso, updated_at: nowIso })
        .eq('dedupe_key', `refund-ledger-missing:${payment.id}:${Math.max((payment.refunded_amount ?? 0), 0)}:${refundAmount}`)
        .in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED'])
      if (resolution?.id) {
        await supabase.from('ops_issues').update({
          status: 'RESOLVED',
          resolved_at: nowIso,
          last_seen_at: nowIso,
          updated_at: nowIso,
        })
          .eq('source', FN)
          .eq('issue_type', 'REFUND_FAILED')
          .contains('metadata', { refund_resolution_id: resolution.id })
          .in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED'])
      }
      if (resolution?.financial_case_id) {
        await supabase.from('financial_cases').update({ status: 'RESOLVED', money_movement_blocked: false, resolved_at: nowIso, resolution_code: 'CUSTOMER_REFUND_COMPLETED', resolution_summary: 'Paystack confirmed the approved customer refund.' }).eq('id', resolution.financial_case_id)
      }
      if (resolution?.id) {
        const { error: outcomeError } = await supabase.rpc('apply_ops_partial_refund_order_outcome', { p_resolution_id: resolution.id, p_provider_reference: providerRefundReference })
        if (outcomeError) throw outcomeError
      }
      if (resolution?.money_desk_request_id) {
        const { data: attempt } = await supabase.from('money_desk_execution_attempts').select('id').eq('request_id', resolution.money_desk_request_id).eq('status', 'PROCESSING').order('started_at', { ascending: false }).limit(1).maybeSingle()
        if (attempt?.id) await supabase.rpc('complete_money_desk_execution', { p_attempt_id: attempt.id, p_status: 'SUCCEEDED', p_provider_reference: providerRefundReference, p_failure_code: null, p_failure_summary: null })
      }
      const { data: refundOrder } = await supabase.from('orders').select('id,customer_id,tailor_id').eq('id', payment.order_id).maybeSingle()
      if (refundOrder?.id) {
        const title = 'Order refund is complete'
        for (const recipient of [{ id: refundOrder.customer_id, audience: 'CUSTOMER' as const }, { id: refundOrder.tailor_id, audience: 'TAILOR' as const }]) {
          if (!recipient.id) continue
          const expectedAt = typeof event.data?.expected_at === 'string' ? event.data.expected_at : null
          const outcome = resolution?.id ? refundOutcomeMessage(resolution.order_outcome, resolution.resume_stage) : ''
          const body = `${refundTimingMessage('PAYSTACK', recipient.audience, expectedAt)} ${outcome}`.trim()
          const notificationKey = resolution?.id ?? providerRefundReference ?? `${payment.id}:${refundAmount}`
          await enqueuePushJob(supabase, { userId: recipient.id, orderId: refundOrder.id, source: FN, idempotencyKey: `refund-resolution:${notificationKey}:${recipient.audience}:push`, priority: 30, notification: { title, body, preferenceKey: 'orderUpdates', data: { orderId: refundOrder.id, type: 'refund_completed', refundResolutionId: resolution?.id ?? '' } } })
          await enqueueOrderEventEmailJob(supabase, { order: refundOrder, recipientUserId: recipient.id, audience: recipient.audience, subject: title, headline: title, body, ctaLabel: 'View resolution', source: FN, idempotencyKey: `refund-resolution:${notificationKey}:${recipient.audience}:email`, priority: 30 })
        }
      }
      await markWebhookEventProcessed(supabase, webhookEvent.id, { orderId: payment.order_id, paymentId: payment.id, processingResult: 'refund_processed' })
      return new Response(JSON.stringify({ ok: true, processed: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (event.event === 'transfer.success' || event.event === 'transfer.failed') {
      const transferReference =
        typeof event.data?.reference === 'string' && event.data.reference.trim().length > 0
          ? event.data.reference.trim()
          : typeof event.data?.transfer_code === 'string' && event.data.transfer_code.trim().length > 0
            ? event.data.transfer_code.trim()
            : ''

      if (!transferReference) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_transfer_reference',
        })
        return new Response('Missing transfer payload', { status: 400, headers: cors })
      }

      const payout = await findPayoutForReference(supabase, transferReference)
      if (!payout?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'missing_payout',
        })
        await audit(supabase, {
          event: 'payout.webhook_missing',
          actor_role: 'SYSTEM',
          severity: 'warn',
          payload: {
            function: FN,
            provider: 'PAYSTACK',
            paystack_event_type: event.event,
            provider_payout_id: transferReference,
          },
        })
        return new Response(JSON.stringify({ ok: true, missingPayout: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const nowIso = new Date().toISOString()
      const nextStatus = event.event === 'transfer.success' ? 'PAID' : 'FAILED'
      const payoutPatch: Record<string, unknown> = {
        status: nextStatus,
        provider_response: event as Record<string, unknown>,
        processed_at: nowIso,
      }
      if (nextStatus === 'PAID') payoutPatch.completed_at = nowIso
      if (nextStatus === 'FAILED') {
        payoutPatch.failed_at = nowIso
        payoutPatch.blocked_reason = 'PROVIDER_TRANSFER_FAILED'
      }

      const { error: payoutError } = await supabase
        .from('payouts')
        .update(payoutPatch)
        .eq('id', payout.id)

      if (payoutError) {
        throw new Error(payoutError.message)
      }

      await finalizeFundedFabricRelease(
        supabase,
        payout,
        transferReference,
        nextStatus === 'PAID',
        event as Record<string, unknown>,
      )
      await finalizeFabricCandidateRelease(
        supabase,
        payout,
        transferReference,
        nextStatus === 'PAID',
        event as Record<string, unknown>,
      )
      await finalizeConsultationEarningRelease(
        supabase,
        payout,
        transferReference,
        nextStatus === 'PAID',
        event as Record<string, unknown>,
      )

      const { data: tip, error: tipError } = await supabase.from('order_tips')
        .select('id,order_id,customer_id,tailor_id,amount,currency,status,payment_id,correlation_id,ledger_transaction_id,payout_id,payout_provider_reference')
        .eq('payout_id', payout.id)
        .maybeSingle()
      if (tipError) throw tipError
      if (tip?.id) {
        const releasableTip = tip as ReleasableTip
        if (nextStatus === 'PAID') {
          await completeTipPayout(supabase, {
            tip: releasableTip,
            payoutId: payout.id,
            provider: 'PAYSTACK',
            providerReference: transferReference,
            providerResponse: event as Record<string, unknown>,
          })
        } else {
          const providerMessage = typeof event.data?.message === 'string' && event.data.message.trim()
            ? event.data.message.trim()
            : 'Paystack reported that the tip transfer failed.'
          await holdTipPayout(supabase, {
            tip: releasableTip,
            payoutId: payout.id,
            failure: providerMessage,
          })
        }
      }

      if (nextStatus === 'FAILED' && payout.order_id) {
        await supabase
          .from('orders')
          .update({
            escrow_released: false,
            escrow_released_at: null,
          })
          .eq('id', payout.order_id)
      }

      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: payout.order_id ?? null,
        paymentId: null,
        processingResult: nextStatus === 'PAID' ? 'payout_paid' : 'payout_failed',
      })

      await audit(supabase, {
        event: nextStatus === 'PAID' ? 'payout.completed' : 'payout.failed',
        actor_role: 'SYSTEM',
        order_id: payout.order_id ?? null,
        severity: nextStatus === 'PAID' ? 'info' : 'error',
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          paystack_event_type: event.event,
          provider_payout_id: transferReference,
          payout_id: payout.id,
        },
      })

      if (nextStatus === 'FAILED') {
        await recordProviderPayoutFailure(supabase, {
          payoutId: payout.id,
          orderId: payout.order_id ?? null,
          providerPayoutId: transferReference,
          eventType: event.event,
        })
        await Sentry.captureMessage('Paystack transfer reached terminal failure', {
          level: 'error',
          tags: { function: FN, provider: 'PAYSTACK', failure_class: 'payout_terminal_failure' },
          extra: { webhook_event_id: webhookEvent.id, provider_transfer_reference: transferReference, payout_id: payout.id, order_id: payout.order_id ?? null },
        })
      }

      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.event }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (event.event === 'charge.reversed') {
      if (!transaction?.reference) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: paymentAttempt?.order_id ?? null,
          paymentId: paymentAttempt?.id ?? null,
          processingResult: 'invalid_payload:missing_reference',
        })
        return new Response('Missing transaction payload', { status: 400, headers: cors })
      }

      await Sentry.captureMessage('Paystack charge reversal received', {
        level: 'error',
        tags: { function: FN, provider: 'PAYSTACK', failure_class: 'charge_reversal' },
        extra: { webhook_event_id: webhookEvent.id, provider_payment_reference: transaction.reference, payment_id: paymentAttempt?.id ?? null, order_id: paymentAttempt?.order_id ?? null },
      })

      const order = await findOrderForTransaction(supabase, transaction)
      if (!order?.id) {
        const matchedAttempt = await markPaymentAttemptStatus(supabase, {
          provider: 'PAYSTACK',
          providerPaymentId: transaction.reference,
          status: 'REFUNDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)

        if (matchedAttempt?.id && matchedAttempt.amount > 0) {
          await supabase
            .from('order_payments')
            .update({
              refunded_amount: matchedAttempt.amount,
              last_refund_amount: matchedAttempt.amount,
              last_refund_at: new Date().toISOString(),
            })
            .eq('id', matchedAttempt.id)
        }

        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: paymentAttempt?.order_id ?? null,
          paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
          processingResult: 'charge_reversed_missing_order',
        })

        await audit(supabase, {
          event: 'payment.webhook_order_missing',
          actor_role: 'SYSTEM',
          severity: 'error',
          payload: {
            function: FN,
            provider: 'PAYSTACK',
            paystack_event_type: event.event,
            payment_intent_id: transaction.reference,
          },
        })

        return new Response(JSON.stringify({ ok: true, reversed: true, missingOrder: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const phase = paymentPhaseForTransaction(order, transaction)
      const reversal = await markPaystackChargeReversed(supabase, {
        event,
        order,
        transaction,
        phase,
        paymentAttemptId: paymentAttempt?.id ?? null,
      })

      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: reversal.paymentId,
        processingResult: reversal.orderStageChanged ? 'charge_reversed_order_payment_failed' : 'charge_reversed_recorded',
      })

      return new Response(JSON.stringify({
        ok: true,
        reversed: true,
        phase,
        orderStageChanged: reversal.orderStageChanged,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (event.event !== 'charge.success' && event.event !== 'charge.failed') {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: `ignored:${event.event}`,
      })

      return new Response(JSON.stringify({ ok: true, ignored: true, type: event.event }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (!transaction?.reference) {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: 'invalid_payload:missing_reference',
      })
      return new Response('Missing transaction payload', { status: 400, headers: cors })
    }

    const order = await findOrderForTransaction(supabase, transaction)

    if (!order?.id) {
      await audit(supabase, {
        event: 'payment.webhook_order_missing',
        actor_role: 'SYSTEM',
        severity: 'warn',
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          paystack_event_type: event.event,
          payment_intent_id: transaction.reference,
          metadata_order_id:
            typeof transaction.metadata?.order_id === 'string' ? transaction.metadata.order_id : null,
        },
      })

      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: 'missing_order',
      })

      return new Response(JSON.stringify({ ok: true, missingOrder: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const phase = paymentPhaseForTransaction(order, transaction)

    if (event.event === 'charge.failed') {
      const failure = phase === 'MATERIAL_ADVANCE'
        ? {
            changed: await markMaterialAdvancePayment(supabase, order, transaction, 'FAILED'),
            stage: order.stage,
          }
        : phase === 'TIP' ? { changed: false as const, stage: order.stage } : await markInitialOrderPaymentFailed(supabase, order, {
            provider: 'PAYSTACK',
            paymentIntentId: transaction.reference,
            phase,
          }).catch(() => ({ changed: false as const, stage: order.stage }))
      const matchedAttempt = await markPaymentAttemptStatus(supabase, {
        provider: 'PAYSTACK',
        providerPaymentId: transaction.reference,
        status: 'FAILED',
        providerResponse: event as Record<string, unknown>,
      }).catch(() => null)
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
        processingResult: failure.changed ? 'payment_failed' : 'recorded_failure',
      })

      await audit(supabase, {
        event: 'payment.failed',
        actor_role: 'SYSTEM',
        order_id: order.id,
        severity: 'warn',
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          paystack_event_type: event.event,
          payment_intent_id: transaction.reference,
          stage: order.stage,
          next_stage: failure.stage,
          status: transaction.status,
          message: transaction.gateway_response ?? transaction.message ?? null,
        },
      })

      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.event }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (phase === 'MATERIAL_ADVANCE') {
      const changed = await markMaterialAdvancePayment(supabase, order, transaction, 'SUCCEEDED')
      const matchedAttempt = await markPaymentAttemptStatus(supabase, {
        provider: 'PAYSTACK',
        providerPaymentId: transaction.reference,
        status: 'SUCCEEDED',
        providerResponse: event as Record<string, unknown>,
      }).catch(() => null)
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
        processingResult: changed ? 'material_advance_paid' : 'material_advance_already_recorded',
      })

      await audit(supabase, {
        event: 'payment.material_advance_confirmed',
        actor_role: 'SYSTEM',
        order_id: order.id,
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          paystack_event_type: event.event,
          payment_intent_id: transaction.reference,
          payment_phase: phase,
          changed,
        },
      })

      return new Response(JSON.stringify({ ok: true, confirmed: true, changed, phase }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (phase === 'TIP') {
      const matchedAttempt = await markPaymentAttemptStatus(supabase, { provider: 'PAYSTACK', providerPaymentId: transaction.reference, status: 'SUCCEEDED', providerResponse: event as Record<string, unknown> })
      const { data: tip } = matchedAttempt?.id ? await supabase.from('order_tips').select('id, order_id, customer_id, tailor_id, amount, currency').eq('payment_id', matchedAttempt.id).maybeSingle() : { data: null }
      if (tip) await enqueueTipConfirmedSideEffects(supabase, tip)
      await markWebhookEventProcessed(supabase, webhookEvent.id, { orderId: order.id, paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null, processingResult: 'tip_confirmed' })
      await audit(supabase, { event: 'tip.confirmed', actor_role: 'SYSTEM', order_id: order.id, payload: { function: FN, tip_id: tip?.id ?? null, paystack_event_type: event.event, payment_intent_id: transaction.reference } })
      return new Response(JSON.stringify({ ok: true, confirmed: true, phase }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (phase === 'INITIAL_ORDER' && !isInitialPaymentStage(order.stage)) {
      await markPaymentAttemptStatus(supabase, {
        provider: 'PAYSTACK',
        providerPaymentId: transaction.reference,
        status: 'SUCCEEDED',
        providerResponse: event as Record<string, unknown>,
      }).catch(() => null)
      const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'PAYSTACK', transaction.reference).catch(() => null)
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
        processingResult: 'ignored:stage_not_payable',
      })
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (phase === 'FULFILLMENT' && !isFulfillmentPaymentStage(order)) {
      await markPaymentAttemptStatus(supabase, {
        provider: 'PAYSTACK',
        providerPaymentId: transaction.reference,
        status: 'SUCCEEDED',
        providerResponse: event as Record<string, unknown>,
      }).catch(() => null)
      const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'PAYSTACK', transaction.reference).catch(() => null)
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
        processingResult: 'ignored:stage_not_payable',
      })
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const changed = await markOrderConfirmed(supabase, order, transaction, phase)
    const matchedAttempt = await markPaymentAttemptStatus(supabase, {
      provider: 'PAYSTACK',
      providerPaymentId: transaction.reference,
      status: 'SUCCEEDED',
      providerResponse: event as Record<string, unknown>,
    }).catch(() => null)
    await markWebhookEventProcessed(supabase, webhookEvent.id, {
      orderId: order.id,
      paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
      processingResult: changed ? 'confirmed' : 'already_confirmed',
    })

    await audit(supabase, {
      event: phase === 'FULFILLMENT' ? 'payment.fulfillment_confirmed' : 'payment.confirmed',
      actor_role: 'SYSTEM',
      order_id: order.id,
      payload: {
        function: FN,
        provider: 'PAYSTACK',
        paystack_event_type: event.event,
        payment_intent_id: transaction.reference,
        payment_phase: phase,
        from_stage: order.stage,
        to_stage: phase === 'FULFILLMENT' ? order.stage : 'CONFIRMED',
        changed,
      },
    })

    return new Response(JSON.stringify({ ok: true, confirmed: true, changed }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'webhook.failed', { error: message })
    if (!(error instanceof SyntaxError)) {
      await Sentry.captureMessage('Paystack webhook processing failed', {
        level: 'error',
        tags: { function: FN, provider: 'PAYSTACK', failure_class: 'processing_failure' },
        extra: { safe_error: message.slice(0, 500) },
      })
    }
    if (error instanceof SyntaxError) {
      return new Response('Invalid JSON payload', { status: 400, headers: cors })
    }
    return new Response('Webhook error', { status: 500, headers: cors })
  }
})

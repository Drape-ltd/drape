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
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
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
  buildTailorOrderPaymentSms,
} from '../../../packages/shared/src/sms-copy.ts'
import {
  createWebhookEvent,
  findPaymentAttemptByProviderPaymentId,
  markPaymentAttemptStatus,
  markWebhookEventProcessed,
} from '../_shared/payment-ledger.ts'
import { recordRejectedWebhook } from '../_shared/payment-webhook.ts'
import { verifyPaystackWebhookSignature, type PaystackTransaction } from '../_shared/paystack.ts'

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

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION' | 'MATERIAL_ADVANCE'
const PAYMENT_REVERSAL_TERMINAL_STAGES = new Set(['COMPLETE', 'CANCELLED', 'REFUNDED', 'DECLINED', 'EXPIRED'])

async function findPayoutForReference(supabase: SupabaseClient, reference: string) {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, order_id, status, provider_payout_id')
    .eq('provider', 'PAYSTACK')
    .eq('provider_payout_id', reference)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null } | null) ?? null
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
      body: 'A payout release for this order needs Drape ops review before it can be retried.',
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
    note: `Material advance paid for ${advance.title ?? 'materials'}. Drape ops will review release before funds move.`,
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

type OrderPaymentPhase = Exclude<PaymentPhase, 'MATERIAL_ADVANCE'>

async function markOrderConfirmed(supabase: SupabaseClient, order: OrderRow, transaction: PaystackTransaction, phase: OrderPaymentPhase) {
  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') return false
  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) return false

  if (phase === 'CONSULTATION') {
    const supportMeta = parseOrderSupportMeta(order.special_note)
    const consultation = supportMeta.consultation
    if (consultation?.paidAt) return false

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
    note: `Paystack reversed payment ${input.transaction.reference}. Drape ops must review the order before work, handoff, or payout continues.`,
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
  const payload = await req.text()

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
    const transaction = event.data as PaystackTransaction | null
    const paymentAttempt = typeof transaction?.reference === 'string' && transaction.reference.trim().length > 0
      ? await findPaymentAttemptByProviderPaymentId(supabase, 'PAYSTACK', transaction.reference.trim()).catch(() => null)
      : null
    const webhookEvent = await createWebhookEvent(supabase, {
      provider: 'PAYSTACK',
      providerEventId: await paystackProviderEventId(event, payload),
      eventType: event.event,
      idempotencyKey:
        paymentAttempt?.idempotency_key
        ?? (typeof transaction?.metadata?.idempotency_key === 'string' ? transaction.metadata.idempotency_key : null),
      orderId: paymentAttempt?.order_id ?? null,
      paymentId: paymentAttempt?.id ?? null,
      signatureValid: true,
      payload: event as Record<string, unknown>,
    })

    if (webhookEvent.duplicate && webhookEvent.alreadyProcessed) {
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
        : await markInitialOrderPaymentFailed(supabase, order, {
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
    log('error', FN, 'webhook.failed', { error: error instanceof Error ? error.message : String(error) })
    if (error instanceof SyntaxError) {
      return new Response('Invalid JSON payload', { status: 400, headers: cors })
    }
    return new Response('Webhook error', { status: 500, headers: cors })
  }
})

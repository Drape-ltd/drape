import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getStripeWebhookSecrets, getSupabaseUrl } from '../_shared/env.ts'
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
import { verifyStripeWebhookSignature, type StripePaymentIntent } from '../_shared/stripe.ts'

const FN = 'stripe-webhook'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type StripeEvent = {
  id: string
  type: string
  data?: {
    object?: unknown
  }
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

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION'

type StripeTransferObject = {
  id: string
  amount?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
}

function isStripePaymentIntent(value: unknown): value is StripePaymentIntent {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isStripeTransferObject(value: unknown): value is StripeTransferObject {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

async function findPayoutForStripeTransfer(supabase: any, transfer: StripeTransferObject) {
  const payoutId =
    typeof transfer.metadata?.payout_id === 'string' && transfer.metadata.payout_id.trim().length > 0
      ? transfer.metadata.payout_id.trim()
      : ''

  if (payoutId) {
    const { data, error } = await supabase
      .from('payouts')
      .select('id, order_id, status, provider_payout_id')
      .eq('id', payoutId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data?.id) {
      return data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null }
    }
  }

  const { data, error } = await supabase
    .from('payouts')
    .select('id, order_id, status, provider_payout_id')
    .eq('provider', 'STRIPE')
    .eq('provider_payout_id', transfer.id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null } | null) ?? null
}

async function recordProviderPayoutFailure(
  supabase: any,
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
    provider: 'STRIPE',
    title: 'Stripe payout failed',
    description: `Stripe reported a payout reversal for order ${orderReference ?? input.orderId ?? 'unknown'}.`,
    recommendedAction: 'Review the Stripe transfer, verify the tailor payout destination, and retry manually only after the reversal reason is clear.',
    dedupeKey: `payout-failed:${input.payoutId}`,
    metadata: {
      provider: 'STRIPE',
      payout_id: input.payoutId,
      provider_payout_id: input.providerPayoutId,
      stripe_event_type: input.eventType,
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

async function findOrderForPaymentIntent(supabase: any, paymentIntent: StripePaymentIntent) {
  const metadataOrderId =
    typeof paymentIntent.metadata?.order_id === 'string' && paymentIntent.metadata.order_id.trim().length > 0
      ? paymentIntent.metadata.order_id.trim()
      : ''

  if (metadataOrderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
      .eq('id', metadataOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.id) return data as OrderRow

  const { data: fulfillmentData, error: fulfillmentError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('fulfillment_payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (fulfillmentError) {
    throw new Error(fulfillmentError.message)
  }

  return fulfillmentData as OrderRow | null
}

function paymentPhaseForIntent(order: OrderRow, paymentIntent: StripePaymentIntent): PaymentPhase {
  const metadataPhase =
    typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'CONSULTATION'
      ? 'CONSULTATION'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'FULFILLMENT'
      ? 'FULFILLMENT'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'INITIAL_ORDER'
        ? 'INITIAL_ORDER'
        : null

  if (metadataPhase) return metadataPhase
  if (parseOrderSupportMeta(order.special_note).consultation?.paymentIntentId === paymentIntent.id) return 'CONSULTATION'
  if (order.fulfillment_payment_intent_id === paymentIntent.id) return 'FULFILLMENT'
  return 'INITIAL_ORDER'
}

async function markOrderConfirmed(supabase: any, order: OrderRow, paymentIntent: StripePaymentIntent, phase: PaymentPhase) {
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
                paymentProvider: 'STRIPE',
                paymentIntentId: paymentIntent.id,
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
      provider: 'STRIPE',
    })

    return true
  }

  if (phase === 'FULFILLMENT') {
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        fulfillment_payment_provider: 'STRIPE',
        fulfillment_payment_intent_id: paymentIntent.id,
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
      provider: 'STRIPE',
    })

    return true
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: 'STRIPE',
      payment_intent_id: paymentIntent.id,
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
    provider: 'STRIPE',
  })

  return true
}

function isInitialPaymentStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED'].includes(stage)
}

function isFulfillmentPaymentStage(order: OrderRow) {
  return order.stage === 'FINISHING' || !!order.fulfillment_payment_paid_at
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
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

  const signature = req.headers.get('Stripe-Signature')
  const payload = await req.text()

  if (!signature) {
    await recordRejectedWebhook(supabase, {
      provider: 'STRIPE',
      functionName: FN,
      rawPayload: payload,
      reason: 'missing_signature',
      signatureHeader: null,
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/stripe',
    })
    return new Response('Missing Stripe-Signature header', { status: 401, headers: cors })
  }

  try {
    await verifyStripeWebhookSignature({
      payload,
      signatureHeader: signature,
      webhookSecret: getStripeWebhookSecrets(),
    })
  } catch (error) {
    await recordRejectedWebhook(supabase, {
      provider: 'STRIPE',
      functionName: FN,
      rawPayload: payload,
      reason: 'invalid_signature',
      signatureHeader: signature,
      verificationError: error instanceof Error ? error.message : String(error),
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/stripe',
    })
    return new Response('Invalid Stripe signature', { status: 401, headers: cors })
  }

  try {
    const event = JSON.parse(payload) as StripeEvent

    if (!event?.id || !event?.type) {
      return new Response('Invalid event payload', { status: 400, headers: cors })
    }

    const paymentIntent = isStripePaymentIntent(event.data?.object) ? event.data?.object : null
    const paymentIntentId = paymentIntent?.id ?? null
    const paymentAttempt = paymentIntentId
      ? await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntentId).catch(() => null)
      : null
    const webhookEvent = await createWebhookEvent(supabase, {
      provider: 'STRIPE',
      providerEventId: event.id,
      eventType: event.type,
      idempotencyKey:
        paymentAttempt?.idempotency_key
        ?? (typeof paymentIntent?.metadata?.idempotency_key === 'string' ? paymentIntent.metadata.idempotency_key : null),
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
          provider: 'STRIPE',
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntentId,
          processing_result: webhookEvent.processingResult,
        },
      })

      return new Response(JSON.stringify({ ok: true, duplicate: true, processed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (event.type === 'transfer.created' || event.type === 'transfer.reversed') {
      const transfer = isStripeTransferObject(event.data?.object) ? event.data?.object : null
      if (!transfer?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_transfer_id',
        })
        return new Response('Missing transfer payload', { status: 400, headers: cors })
      }

      const payout = await findPayoutForStripeTransfer(supabase, transfer)
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
            provider: 'STRIPE',
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            provider_payout_id: transfer.id,
          },
        })
        return new Response(JSON.stringify({ ok: true, missingPayout: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const nowIso = new Date().toISOString()
      const nextStatus = event.type === 'transfer.created' ? 'PAID' : 'REVERSED'
      const payoutPatch: Record<string, unknown> = {
        status: nextStatus,
        provider_response: event as Record<string, unknown>,
        processed_at: nowIso,
      }
      if (nextStatus === 'PAID') payoutPatch.completed_at = nowIso
      if (nextStatus === 'REVERSED') {
        payoutPatch.failed_at = nowIso
        payoutPatch.blocked_reason = 'PROVIDER_TRANSFER_REVERSED'
      }

      const { error: payoutError } = await supabase
        .from('payouts')
        .update(payoutPatch)
        .eq('id', payout.id)

      if (payoutError) {
        throw new Error(payoutError.message)
      }

      if (nextStatus === 'REVERSED' && payout.order_id) {
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
        processingResult: nextStatus === 'PAID' ? 'payout_paid' : 'payout_reversed',
      })

      await audit(supabase, {
        event: nextStatus === 'PAID' ? 'payout.completed' : 'payout.failed',
        actor_role: 'SYSTEM',
        order_id: payout.order_id ?? null,
        severity: nextStatus === 'PAID' ? 'info' : 'error',
        payload: {
          function: FN,
          provider: 'STRIPE',
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          provider_payout_id: transfer.id,
          payout_id: payout.id,
        },
      })

      if (nextStatus === 'REVERSED') {
        await recordProviderPayoutFailure(supabase, {
          payoutId: payout.id,
          orderId: payout.order_id ?? null,
          providerPayoutId: transfer.id,
          eventType: event.type,
        })
      }

      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed' &&
      event.type !== 'payment_intent.canceled'
    ) {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: `ignored:${event.type}`,
      })

      return new Response(JSON.stringify({ ok: true, ignored: true, type: event.type }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (!paymentIntent?.id) {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: 'invalid_payload:missing_payment_intent',
      })
      return new Response('Missing payment intent payload', { status: 400, headers: cors })
    }

    const order = await findOrderForPaymentIntent(supabase, paymentIntent)

    if (!order?.id) {
      await audit(supabase, {
        event: 'payment.webhook_order_missing',
        actor_role: 'SYSTEM',
        severity: 'warn',
        payload: {
          function: FN,
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntent.id,
          metadata_order_id: paymentIntent.metadata?.order_id ?? null,
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

    const phase = paymentPhaseForIntent(order, paymentIntent)

    if (event.type === 'payment_intent.succeeded') {
      if (phase === 'INITIAL_ORDER' && !isInitialPaymentStage(order.stage)) {
        await markPaymentAttemptStatus(supabase, {
          provider: 'STRIPE',
          providerPaymentId: paymentIntent.id,
          status: 'SUCCEEDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)
        const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntent.id).catch(() => null)
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
          provider: 'STRIPE',
          providerPaymentId: paymentIntent.id,
          status: 'SUCCEEDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)
        const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntent.id).catch(() => null)
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: order.id,
          paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
          processingResult: 'ignored:stage_not_payable',
        })
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const changed = await markOrderConfirmed(supabase, order, paymentIntent, phase)
      const matchedAttempt = await markPaymentAttemptStatus(supabase, {
        provider: 'STRIPE',
        providerPaymentId: paymentIntent.id,
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
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntent.id,
          payment_phase: phase,
          from_stage: order.stage,
          to_stage: phase === 'FULFILLMENT' ? order.stage : 'CONFIRMED',
          changed,
        },
      })

      return new Response(JSON.stringify({ ok: true, confirmed: true, changed }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const failureStatus = event.type === 'payment_intent.payment_failed' ? 'FAILED' : 'CANCELED'
    const failure = await markInitialOrderPaymentFailed(supabase, order, {
      provider: 'STRIPE',
      paymentIntentId: paymentIntent.id,
      phase,
    }).catch(() => ({ changed: false as const, stage: order.stage }))
    const matchedAttempt = await markPaymentAttemptStatus(supabase, {
      provider: 'STRIPE',
      providerPaymentId: paymentIntent.id,
      status: failureStatus,
      providerResponse: event as Record<string, unknown>,
    }).catch(() => null)
    await markWebhookEventProcessed(supabase, webhookEvent.id, {
      orderId: order.id,
      paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
      processingResult: failureStatus === 'FAILED'
        ? (failure.changed ? 'payment_failed' : 'recorded_failure')
        : (failure.changed ? 'payment_failed' : 'recorded_canceled'),
    })

    await audit(supabase, {
      event: event.type === 'payment_intent.payment_failed' ? 'payment.failed' : 'payment.canceled',
      actor_role: 'SYSTEM',
      order_id: order.id,
      severity: 'warn',
      payload: {
        function: FN,
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        payment_intent_id: paymentIntent.id,
        stage: order.stage,
        next_stage: failure.stage,
        status: paymentIntent.status,
        message: paymentIntent.last_payment_error?.message ?? null,
      },
    })

    return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'webhook.failed', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Webhook error', { status: 400, headers: cors })
  }
})

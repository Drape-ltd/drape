import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { markInitialOrderPaymentFailed } from '../_shared/payment-failure.ts'
import {
  findLatestPaymentAttemptForOrderPhase,
  markPaymentAttemptStatus,
  upsertPreparedPaymentAttempt,
} from '../_shared/payment-ledger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { enqueueOrderConfirmationEmailJob } from '../_shared/payment-side-effects.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
import { sendSmsToUser } from '../_shared/sms.ts'
import {
  fulfillmentPaymentConfirmedStageNote,
  paymentConfirmedStageNote,
  paymentPendingStageNote,
  tailorFulfillmentPaymentConfirmedNotification,
  tailorPaymentConfirmedNotification,
} from '../_shared/payment-copy.ts'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../_shared/paystack.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent } from '../_shared/stripe.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import {
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
  type ConsultationMeta,
} from '../_shared/order-support.ts'
import {
  buildCustomerOrderPaymentSms,
  buildTailorOrderPaymentSms,
} from '../../../packages/shared/src/sms-copy.ts'
import {
  normalizeAccountCurrency,
  resolvePaymentProviderForCurrency,
  type AccountCurrencyCode,
} from '../../../packages/shared/src/currency-config.ts'
import { resolvePreparedPaymentReference } from '../_shared/payment-recovery.ts'
import { getProviderCircuit, recordProviderHealth } from '../_shared/provider-health.ts'

const FN = 'payment-action'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('prepare-payment'),
    orderId: uuid,
  }),
  z.object({
    action: z.literal('confirm-payment'),
    orderId: uuid,
    paymentIntentId: z.string().trim().min(1).optional(),
  }),
])

type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION'
type OrderCurrency = AccountCurrencyCode

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  seller_item_id?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  currency?: string | null
  quote_expires_at?: string | null
  consultation_fee?: number | null
  special_note?: string | null
  delivery_method?: string | null
  delivery_address?: string | null
  fulfillment_fee?: number | null
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_provider?: PaymentProvider | null
  fulfillment_payment_intent_id?: string | null
  fulfillment_payment_checkout_url?: string | null
  garment_type?: string | null
  item_title?: string | null
  item_size?: string | null
  payment_provider?: PaymentProvider | null
  payment_intent_id?: string | null
  payment_checkout_url?: string | null
}

function isPaymentProvider(value: string | null | undefined): value is PaymentProvider {
  return value === 'STRIPE' || value === 'PAYSTACK'
}

function normalizeOrderCurrency(value: string | null | undefined): OrderCurrency | null {
  return normalizeAccountCurrency(value)
}

function paymentProviderForCurrency(currency: OrderCurrency): PaymentProvider {
  return resolvePaymentProviderForCurrency(currency)
}

function resolveStoredProvider(value: string | null | undefined, currency: OrderCurrency): PaymentProvider | null {
  if (!isPaymentProvider(value)) return null
  return value === paymentProviderForCurrency(currency) ? value : null
}

function paymentIdempotencyAction(phase: PaymentPhase) {
  if (phase === 'FULFILLMENT') return 'PAY-FULFILLMENT'
  if (phase === 'CONSULTATION') return 'PAY-CONSULTATION'
  return 'PAY'
}

function buildPaymentIdempotencyKey(orderId: string, phase: PaymentPhase) {
  return `DRAPE-${paymentIdempotencyAction(phase)}-${orderId}`
}

function buildPaystackReference(order: OrderRow, phase: PaymentPhase) {
  return buildPaymentIdempotencyKey(order.id, phase)
}

async function buildPaystackReferenceForNewAttempt(
  supabase: any,
  order: OrderRow,
  phase: PaymentPhase,
) {
  const baseReference = buildPaystackReference(order, phase)
  const { count, error } = await supabase
    .from('order_payments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', order.id)
    .eq('phase', phase)
    .eq('provider', 'PAYSTACK')

  if (error) throw error

  const attemptNumber = (count ?? 0) + 1
  return attemptNumber <= 1
    ? baseReference
    : `${baseReference}-R${attemptNumber}`
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, error: string, extra?: Record<string, unknown>) {
  return jsonResponse({ error, message: error, ...(extra ?? {}) }, status, cors)
}

function isPayableStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED'].includes(stage)
}

function isReusablePaystackStatus(status: string) {
  return !['success', 'failed', 'abandoned', 'reversed'].includes(status)
}

function paystackFailureAttemptStatus(status: string): 'FAILED' | 'CANCELED' | null {
  if (status === 'failed') return 'FAILED'
  if (status === 'abandoned' || status === 'reversed') return 'CANCELED'
  return null
}

function stripeFailureAttemptStatus(status: string): 'FAILED' | 'CANCELED' | null {
  if (status === 'processing' || status === 'succeeded') return null
  if (status === 'canceled') return 'CANCELED'
  return 'FAILED'
}

function paymentDescription(order: {
  reference?: string | null
  order_kind?: string | null
  garment_type?: string | null
  item_title?: string | null
  delivery_method?: string | null
}, phase: PaymentPhase) {
  if (phase === 'CONSULTATION') {
    return `Drape consultation payment #${order.reference ?? 'unknown'}`
  }

  if (phase === 'FULFILLMENT') {
    return order.delivery_method === 'LOCAL_DELIVERY'
      ? `Drape delivery payment #${order.reference ?? 'unknown'}`
      : `Drape shipping payment #${order.reference ?? 'unknown'}`
  }

  const label = order.order_kind === 'READY_MADE'
    ? (order.item_title ?? order.garment_type ?? 'Ready-made order')
    : (order.garment_type ?? 'Custom order')
  return `Drape order #${order.reference ?? 'unknown'} - ${label}`
}

function paystackStatusMessage(status: string) {
  if (status === 'pending' || status === 'ongoing') {
    return 'Payment is still open. Finish the Paystack checkout and return to the app.'
  }
  if (status === 'abandoned') {
    return 'Payment was not completed. Start payment again to continue.'
  }
  if (status === 'failed') {
    return 'Payment failed. Start payment again to continue.'
  }
  if (status === 'reversed') {
    return 'Payment was reversed. Start payment again to continue.'
  }
  return `Payment is not complete yet (${status}).`
}

function providerFailureMessage(provider: PaymentProvider, _currency: OrderCurrency, phase: 'prepare' | 'confirm') {
  if (provider === 'PAYSTACK') {
    return phase === 'prepare'
      ? 'We could not start Paystack checkout right now. Please try again in a moment.'
      : 'We could not confirm the Paystack payment right now. Please refresh and try again.'
  }

  return phase === 'prepare'
    ? 'We could not start Stripe checkout right now. Please try again in a moment.'
    : 'We could not confirm the Stripe payment right now. Please refresh and try again.'
}

async function recordPaymentProviderEvent(
  supabase: any,
  input: {
    provider: PaymentProvider
    action: 'prepare-payment' | 'confirm-payment'
    succeeded: boolean
    orderId: string
    paymentPhase: PaymentPhase
    currency: OrderCurrency
    paymentIntentId?: string | null
    error?: unknown
  },
) {
  await recordProviderHealth(supabase, {
    provider: input.provider,
    operation: 'PAYMENT',
    succeeded: input.succeeded,
    error: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
    metadata: {
      function: FN,
      action: input.action,
      order_id: input.orderId,
      payment_phase: input.paymentPhase,
      currency: input.currency,
      payment_intent_id: input.paymentIntentId ?? null,
    },
  })
}

async function auditPaymentBlocked(
  supabase: any,
  callerId: string,
  order: Pick<OrderRow, 'id' | 'stage' | 'order_kind' | 'delivery_method' | 'payment_provider'>,
  reason: string,
  payload?: Record<string, unknown>,
) {
  await audit(supabase, {
    event: 'payment.blocked',
    actor_id: callerId,
    actor_role: 'CUSTOMER',
    order_id: order.id,
    severity: 'warn',
    payload: {
      function: FN,
      reason,
      order_kind: order.order_kind ?? 'CUSTOM',
      stage: order.stage,
      provider: order.payment_provider ?? null,
      delivery_method: order.delivery_method ?? null,
      ...(payload ?? {}),
    },
  })

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYMENT_BLOCKED',
    severity: 'CRITICAL',
    source: FN,
    actorId: callerId,
    actorRole: 'CUSTOMER',
    orderId: order.id,
    provider: order.payment_provider ?? null,
    stage: order.stage,
    title: 'Payment blocked',
    description: `Customer payment could not continue because ${reason.replace(/_/gu, ' ').toLowerCase()}.`,
    recommendedAction: 'Verify the provider payment state, the order stage, and whether the customer should retry, be confirmed manually, or be refunded.',
    dedupeKey: `payment-blocked:${order.id}:${reason}`,
    metadata: {
      reason,
      order_kind: order.order_kind ?? 'CUSTOM',
      stage: order.stage,
      provider: order.payment_provider ?? null,
      delivery_method: order.delivery_method ?? null,
      ...(payload ?? {}),
    },
  })
}

function isFulfillmentPaymentPending(order: OrderRow) {
  return order.stage === 'FINISHING'
    && order.delivery_method !== 'LOCAL_COLLECTION'
    && typeof order.fulfillment_fee === 'number'
    && order.fulfillment_fee > 0
    && !!order.fulfillment_payment_requested_at
    && !order.fulfillment_payment_paid_at
}

function consultationMetaForOrder(order: OrderRow): ConsultationMeta | null {
  return parseOrderSupportMeta(order.special_note).consultation ?? null
}

function isConsultationPaymentPending(order: OrderRow) {
  const consultation = consultationMetaForOrder(order)
  return order.order_kind === 'CUSTOM'
    && order.stage === 'CONSULTATION'
    && typeof order.consultation_fee === 'number'
    && order.consultation_fee > 0
    && consultation?.paymentTiming === 'BEFORE_CALL_STARTS'
    && !consultation?.paidAt
}

function consultationPaymentAmount(order: OrderRow) {
  if (typeof order.consultation_fee !== 'number' || order.consultation_fee <= 0) {
    return null
  }

  return order.consultation_fee
}

function initialPaymentAmount(order: OrderRow) {
  if (typeof order.quoted_amount !== 'number' || order.quoted_amount <= 0) {
    return null
  }
  return order.quoted_amount
}

function fulfillmentPaymentAmount(order: OrderRow) {
  if (typeof order.fulfillment_fee !== 'number' || order.fulfillment_fee <= 0) {
    return null
  }

  return order.fulfillment_fee
}

function resolveActivePaymentPhase(order: OrderRow): PaymentPhase {
  if (isConsultationPaymentPending(order)) {
    return 'CONSULTATION'
  }

  if (isFulfillmentPaymentPending(order)) {
    return 'FULFILLMENT'
  }

  return 'INITIAL_ORDER'
}

function isInitialPaymentPayable(order: OrderRow) {
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage)
  }

  if (order.order_kind === 'READY_MADE') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage)
  }

  return false
}

function isPaymentPhasePayable(order: OrderRow, phase: PaymentPhase) {
  if (phase === 'CONSULTATION') return isConsultationPaymentPending(order)
  if (phase === 'FULFILLMENT') return isFulfillmentPaymentPending(order)
  return isInitialPaymentPayable(order)
}

function paymentPhaseNotPayableMessage(order: OrderRow, phase: PaymentPhase) {
  if (phase === 'CONSULTATION') return 'This order is not awaiting a consultation payment right now.'
  if (phase === 'FULFILLMENT') return 'This order is not awaiting a delivery or shipping payment right now.'
  return order.order_kind === 'CUSTOM'
    ? 'This custom order is not ready for payment yet.'
    : 'This ready-made order is not in a payable state.'
}

function paymentIntentForPhase(order: OrderRow, phase: PaymentPhase) {
  if (phase === 'CONSULTATION') {
    return consultationMetaForOrder(order)?.paymentIntentId?.trim() || null
  }
  return phase === 'FULFILLMENT'
    ? (order.fulfillment_payment_intent_id?.trim() || null)
    : (order.payment_intent_id?.trim() || null)
}

function paymentCheckoutUrlForPhase(order: OrderRow, phase: PaymentPhase) {
  if (phase === 'CONSULTATION') {
    return consultationMetaForOrder(order)?.paymentCheckoutUrl?.trim() || null
  }
  return phase === 'FULFILLMENT'
    ? (order.fulfillment_payment_checkout_url?.trim() || null)
    : (order.payment_checkout_url?.trim() || null)
}

function resolveProviderForPhase(order: OrderRow, phase: PaymentPhase, currency: OrderCurrency) {
  if (phase === 'CONSULTATION') {
    return resolveStoredProvider(consultationMetaForOrder(order)?.paymentProvider, currency) ?? paymentProviderForCurrency(currency)
  }
  return phase === 'FULFILLMENT'
    ? (resolveStoredProvider(order.fulfillment_payment_provider, currency) ?? paymentProviderForCurrency(currency))
    : (resolveStoredProvider(order.payment_provider, currency) ?? paymentProviderForCurrency(currency))
}

function resolveConfirmPhase(order: OrderRow, paymentIntentId?: string) {
  if (paymentIntentId && paymentIntentId === consultationMetaForOrder(order)?.paymentIntentId) {
    return 'CONSULTATION' as const
  }

  if (paymentIntentId && paymentIntentId === order.fulfillment_payment_intent_id) {
    return 'FULFILLMENT' as const
  }

  if (paymentIntentId && paymentIntentId === order.payment_intent_id) {
    return 'INITIAL_ORDER' as const
  }

  return resolveActivePaymentPhase(order)
}

async function finalizeSuccessfulPayment(
  supabase: any,
  order: OrderRow,
  callerId: string,
  provider: PaymentProvider,
  paymentIntentId: string,
  phase: PaymentPhase,
) {
  if (phase === 'CONSULTATION') {
    const supportMeta = parseOrderSupportMeta(order.special_note)
    const consultation = supportMeta.consultation

    if (consultation?.paidAt) {
      return { alreadyConfirmed: true as const, stage: order.stage }
    }

    const nextMeta = {
      ...supportMeta,
      consultation: consultation
        ? {
            ...consultation,
            paymentProvider: provider,
            paymentIntentId,
            paymentCheckoutUrl: null,
            paidAt: new Date().toISOString(),
            status: consultation.scheduledStartAt ? 'SCHEDULED' : consultation.status,
          }
        : consultation,
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        special_note: serializeOrderSupportMeta(nextMeta),
      })
      .eq('id', order.id)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error('Could not confirm consultation payment for this order.')
    }

    if (!updatedOrder?.id) {
      return { alreadyConfirmed: true as const, stage: order.stage }
    }

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: 'Consultation fee paid. The tailor can now start the consultation call.',
    })

    await markPaymentAttemptStatus(supabase, {
      provider,
      providerPaymentId: paymentIntentId,
      status: 'SUCCEEDED',
      providerResponse: {
        order_id: order.id,
        payment_phase: phase,
        stage: order.stage,
      },
    })

    await audit(supabase, {
      event: 'payment.consultation_confirmed',
      actor_id: callerId,
      actor_role: 'CUSTOMER',
      order_id: order.id,
      payload: {
        function: FN,
        provider,
        payment_phase: phase,
        payment_intent_id: paymentIntentId,
      },
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
      provider,
    })

    return { alreadyConfirmed: false as const, stage: order.stage }
  }

  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') {
    return { alreadyConfirmed: true as const, stage: 'CONFIRMED' }
  }

  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) {
    return { alreadyConfirmed: true as const, stage: order.stage }
  }

  if (phase === 'FULFILLMENT') {
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        fulfillment_payment_provider: provider,
        fulfillment_payment_intent_id: paymentIntentId,
        fulfillment_payment_checkout_url: null,
        fulfillment_payment_paid_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .is('fulfillment_payment_paid_at', null)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error('Could not confirm fulfillment payment for this order.')
    }

    if (!updatedOrder?.id) {
      return { alreadyConfirmed: true as const, stage: order.stage }
    }

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: fulfillmentPaymentConfirmedStageNote(order.delivery_method),
    })

    await markPaymentAttemptStatus(supabase, {
      provider,
      providerPaymentId: paymentIntentId,
      status: 'SUCCEEDED',
      providerResponse: {
        order_id: order.id,
        payment_phase: phase,
        stage: order.stage,
      },
    })

    await audit(supabase, {
      event: 'payment.fulfillment_confirmed',
      actor_id: callerId,
      actor_role: 'CUSTOMER',
      order_id: order.id,
      payload: {
        function: FN,
        provider,
        payment_phase: phase,
        payment_intent_id: paymentIntentId,
        delivery_method: order.delivery_method ?? null,
      },
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
      provider,
    })

    return { alreadyConfirmed: false as const, stage: order.stage }
  }

  if (order.stage === 'CONFIRMED') {
    return { alreadyConfirmed: true as const }
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: provider,
      payment_intent_id: paymentIntentId,
      payment_checkout_url: null,
    })
    .eq('id', order.id)
    .eq('stage', order.stage)
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error('Could not confirm payment for this order.')
  }

  if (!updatedOrder?.id) {
    return { alreadyConfirmed: true as const, stage: 'CONFIRMED' }
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'CONFIRMED',
    note: paymentConfirmedStageNote(order.order_kind),
  })

  await markPaymentAttemptStatus(supabase, {
    provider,
    providerPaymentId: paymentIntentId,
    status: 'SUCCEEDED',
    providerResponse: {
      order_id: order.id,
      payment_phase: phase,
      stage: 'CONFIRMED',
    },
  })

  await audit(supabase, {
    event: 'payment.confirmed',
    actor_id: callerId,
    actor_role: 'CUSTOMER',
    order_id: order.id,
    payload: {
      function: FN,
      provider,
      payment_intent_id: paymentIntentId,
      order_kind: order.order_kind ?? 'CUSTOM',
      from_stage: order.stage,
      to_stage: 'CONFIRMED',
    },
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
    provider,
  })

  return { alreadyConfirmed: false as const, stage: 'CONFIRMED' }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonError(cors, 401, 'Please sign in again before starting payment.')
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(cors, 400, 'Check the payment details and try again.')
    }

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 20)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const { orderId } = parsed.data

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        reference,
        stage,
        order_kind,
        customer_id,
        tailor_id,
        quoted_amount,
        quoted_currency,
        currency,
        quote_expires_at,
        consultation_fee,
        special_note,
        seller_item_id,
        delivery_method,
        delivery_address,
        fulfillment_fee,
        fulfillment_payment_requested_at,
        fulfillment_payment_paid_at,
        fulfillment_payment_provider,
        fulfillment_payment_intent_id,
        fulfillment_payment_checkout_url,
        garment_type,
        item_title,
        item_size,
        payment_provider,
        payment_intent_id,
        payment_checkout_url
      `)
      .eq('id', orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: orderId, error: orderError.message })
      return jsonError(cors, 500, 'We could not load this order for payment right now. Please refresh and try again.')
    }

    const row = order as OrderRow
    if (!row?.id) return jsonError(cors, 404, 'This order could not be found. Reopen it from your Orders tab.')
    if (row.customer_id?.toString() !== caller.id) return jsonError(cors, 403, 'This order is not available from this account.')

    const orderKind = row.order_kind ?? 'CUSTOM'
    const orderCurrency = normalizeOrderCurrency(row.currency ?? row.quoted_currency)
    if (!orderCurrency) {
      await auditPaymentBlocked(supabase, caller.id, row, 'unsupported_currency', {
        order_currency: row.currency ?? null,
        quoted_currency: row.quoted_currency ?? null,
      })
      return jsonError(cors, 409, 'This order currency is not supported for payment right now.')
    }
    const phase = parsed.data.action === 'confirm-payment'
      ? resolveConfirmPhase(row, parsed.data.paymentIntentId)
      : resolveActivePaymentPhase(row)
    const amount =
      phase === 'FULFILLMENT'
        ? fulfillmentPaymentAmount(row)
        : phase === 'CONSULTATION'
          ? consultationPaymentAmount(row)
          : initialPaymentAmount(row)
    const provider = resolveProviderForPhase(row, phase, orderCurrency)
    const latestAttempt = await findLatestPaymentAttemptForOrderPhase(supabase, {
      orderId: row.id,
      phase,
      statuses: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'],
    }).catch(() => null)
    const storedProviderForPhase =
      phase === 'FULFILLMENT'
        ? row.fulfillment_payment_provider
        : phase === 'CONSULTATION'
          ? consultationMetaForOrder(row)?.paymentProvider
          : row.payment_provider

    if (storedProviderForPhase && !isPaymentProvider(storedProviderForPhase)) {
      await auditPaymentBlocked(supabase, caller.id, row, 'provider_not_supported')
      return jsonError(cors, 409, 'This order is tied to an unsupported payment provider.')
    }

    if (
      isPaymentProvider(storedProviderForPhase)
      && storedProviderForPhase !== paymentProviderForCurrency(orderCurrency)
    ) {
      await auditPaymentBlocked(supabase, caller.id, row, 'provider_currency_mismatch', {
        stored_provider: storedProviderForPhase,
        expected_provider: paymentProviderForCurrency(orderCurrency),
        currency: orderCurrency,
        payment_phase: phase,
      })
      return jsonError(cors, 409, 'This order has a payment-provider mismatch. Refresh the order and try again.')
    }

    if (latestAttempt?.provider && latestAttempt.provider !== provider) {
      await auditPaymentBlocked(supabase, caller.id, row, 'ledger_provider_mismatch', {
        expected_provider: provider,
        recovered_provider: latestAttempt.provider,
        payment_phase: phase,
      })
      return jsonError(cors, 409, 'This order has a payment-provider mismatch. Refresh the order and try again.')
    }

    if (latestAttempt?.currency && normalizeOrderCurrency(latestAttempt.currency) !== orderCurrency) {
      await auditPaymentBlocked(supabase, caller.id, row, 'ledger_currency_mismatch', {
        expected_currency: orderCurrency,
        recovered_currency: latestAttempt.currency,
        payment_phase: phase,
        latest_attempt_id: latestAttempt.id,
      })
      return jsonError(cors, 409, 'This order has a payment-currency mismatch. Refresh the order and try again.')
    }

    if (typeof latestAttempt?.amount === 'number' && latestAttempt.amount !== amount) {
      await auditPaymentBlocked(supabase, caller.id, row, 'ledger_amount_mismatch', {
        expected_amount: amount,
        recovered_amount: latestAttempt.amount,
        currency: orderCurrency,
        payment_phase: phase,
        latest_attempt_id: latestAttempt.id,
      })
      return jsonError(cors, 409, 'This order total changed after payment was prepared. Contact support so we can refresh the payment safely.')
    }

    if (parsed.data.action === 'prepare-payment') {
      const quoteExpired =
        phase === 'INITIAL_ORDER'
        && orderKind === 'CUSTOM'
        && !!row.quote_expires_at
        && new Date(row.quote_expires_at).getTime() <= Date.now()
      const preflight = runPreflight([
        {
          name: 'order_belongs_to_customer',
          condition: row.customer_id?.toString() === caller.id,
          errorCode: 'ORDER_FORBIDDEN',
          message: 'This order is not available from this account.',
          field: 'customer_id',
          severity: 'BLOCKING',
          actual: { orderCustomerId: row.customer_id ?? null, callerId: caller.id },
        },
        {
          name: 'payment_phase_payable',
          condition: isPaymentPhasePayable(row, phase),
          errorCode: phase === 'CONSULTATION'
            ? 'CONSULTATION_NOT_PAYABLE'
            : phase === 'FULFILLMENT'
              ? 'FULFILLMENT_NOT_PAYABLE'
              : 'ORDER_NOT_PAYABLE',
          message: paymentPhaseNotPayableMessage(row, phase),
          field: 'stage',
          severity: 'BLOCKING',
          actual: { stage: row.stage, phase, orderKind },
        },
        {
          name: 'quote_not_expired',
          condition: !quoteExpired,
          errorCode: 'QUOTE_EXPIRED',
          message: 'This quote has expired. Ask the tailor to send a fresh quote.',
          field: 'quote_expires_at',
          severity: 'BLOCKING',
          actual: { quote_expires_at: row.quote_expires_at ?? null },
        },
        {
          name: 'payment_not_already_succeeded',
          condition: latestAttempt?.status !== 'SUCCEEDED',
          errorCode: 'PAYMENT_ALREADY_SUCCEEDED',
          message: 'This order has already been paid.',
          field: 'order_payments.status',
          severity: 'BLOCKING',
          actual: {
            latestAttemptId: latestAttempt?.id ?? null,
            latestAttemptStatus: latestAttempt?.status ?? null,
          },
        },
        {
          name: 'payment_amount_positive',
          condition: typeof amount === 'number' && amount > 0 && Number.isInteger(amount),
          errorCode: 'PAYMENT_AMOUNT_INVALID',
          message: 'This order is missing payment details.',
          field: 'amount',
          severity: 'BLOCKING',
          actual: { amount, phase },
        },
        {
          name: 'currency_supported',
          condition: !!orderCurrency,
          errorCode: 'PAYMENT_CURRENCY_UNSUPPORTED',
          message: 'This order currency is not supported for payment right now.',
          field: 'currency',
          severity: 'BLOCKING',
          actual: { currency: row.currency ?? null, quotedCurrency: row.quoted_currency ?? null },
        },
        {
          name: 'provider_matches_currency',
          condition: provider === paymentProviderForCurrency(orderCurrency),
          errorCode: 'PAYMENT_PROVIDER_CURRENCY_MISMATCH',
          message: 'This order has a payment-provider mismatch. Refresh the order and try again.',
          field: 'payment_provider',
          severity: 'BLOCKING',
          actual: { provider, expectedProvider: paymentProviderForCurrency(orderCurrency), currency: orderCurrency },
        },
        {
          name: 'delivery_address_present',
          condition: phase === 'CONSULTATION' || row.delivery_method === 'LOCAL_COLLECTION' || !!row.delivery_address?.trim(),
          errorCode: 'DELIVERY_ADDRESS_REQUIRED',
          message: 'Delivery address is required before payment can start.',
          field: 'delivery_address',
          severity: 'BLOCKING',
          actual: { deliveryMethod: row.delivery_method ?? null, hasDeliveryAddress: !!row.delivery_address?.trim() },
        },
        {
          name: 'paystack_email_present',
          condition: provider !== 'PAYSTACK' || !!caller.email?.trim(),
          errorCode: 'PAYSTACK_EMAIL_REQUIRED',
          message: 'A verified email is required before Paystack checkout can start.',
          field: 'email',
          severity: 'BLOCKING',
          actual: { provider, hasEmail: !!caller.email?.trim() },
        },
      ])

      if (!preflight.passed) {
        const failure = preflight.failures[0]!
        await auditPaymentBlocked(supabase, caller.id, row, failure.errorCode.toLowerCase(), {
          payment_phase: phase,
          preflight_check: failure.name,
          actual: failure.actual ?? null,
        })
        await logPreflightFailure(supabase, preflight, {
          operation: 'payment_initiation',
          entityType: 'order',
          entityId: row.id,
          orderId: row.id,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          userId: caller.id,
          source: FN,
          metadata: {
            payment_phase: phase,
            provider,
            currency: orderCurrency,
            amount,
            order_kind: orderKind,
          },
        })
        return preflightFailureResponse(preflight, cors, 409)
      }

      const circuit = await getProviderCircuit(supabase, provider, 'PAYMENT')
      if (circuit.open) {
        return jsonError(cors, 503, providerFailureMessage(provider, orderCurrency, 'prepare'), {
          code: 'PAYMENT_PROVIDER_DEGRADED',
          provider,
          retryAt: circuit.circuitOpenUntil,
        })
      }
    }

    if (parsed.data.action === 'confirm-payment') {
      const circuit = await getProviderCircuit(supabase, provider, 'PAYMENT')
      if (circuit.open) {
        return jsonError(cors, 503, providerFailureMessage(provider, orderCurrency, 'confirm'), {
          code: 'PAYMENT_PROVIDER_DEGRADED',
          provider,
          retryAt: circuit.circuitOpenUntil,
        })
      }

      const preparedPayment = resolvePreparedPaymentReference({
        expectedProvider: provider,
        storedPaymentIntentId: paymentIntentForPhase(row, phase),
        storedCheckoutUrl: paymentCheckoutUrlForPhase(row, phase),
        latestAttempt,
      })

      if (preparedPayment.providerMismatch) {
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_provider_recovery_mismatch', {
          expected_provider: provider,
          payment_phase: phase,
        })
        return jsonError(cors, 409, 'This order has a payment-provider mismatch. Refresh the order and try again.')
      }

      const preparedPaymentIntentId = preparedPayment.providerPaymentId

      if (!preparedPaymentIntentId) {
        await auditPaymentBlocked(supabase, caller.id, row, 'not_prepared')
        return jsonError(cors, 409, 'Payment has not been prepared for this order yet.')
      }

      if (parsed.data.paymentIntentId && parsed.data.paymentIntentId !== preparedPaymentIntentId) {
        await auditPaymentBlocked(supabase, caller.id, row, 'stale_payment_attempt', {
          expected_payment_intent_id: preparedPaymentIntentId,
          provided_payment_intent_id: parsed.data.paymentIntentId,
          payment_phase: phase,
        })
        return jsonError(cors, 409, 'This payment attempt is no longer current. Please retry from the order screen.')
      }

      if (phase === 'INITIAL_ORDER' && !isPayableStage(row.stage)) {
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_wrong_stage')
        return jsonError(cors, 409, 'This order is no longer awaiting payment confirmation.')
      }

      if (phase === 'CONSULTATION' && !isConsultationPaymentPending(row)) {
        await auditPaymentBlocked(supabase, caller.id, row, 'consultation_not_payable')
        return jsonError(cors, 409, 'This order is not awaiting consultation payment confirmation right now.')
      }

      if (phase === 'FULFILLMENT' && !isFulfillmentPaymentPending(row) && !row.fulfillment_payment_paid_at) {
        await auditPaymentBlocked(supabase, caller.id, row, 'fulfillment_not_payable')
        return jsonError(cors, 409, 'This order is not awaiting fulfillment payment confirmation right now.')
      }

      if (provider === 'PAYSTACK') {
        let transaction
        try {
          transaction = await verifyPaystackTransaction(preparedPaymentIntentId)
        } catch (error) {
          await recordPaymentProviderEvent(supabase, {
            provider: 'PAYSTACK',
            action: 'confirm-payment',
            succeeded: false,
            orderId: row.id,
            paymentPhase: phase,
            currency: orderCurrency,
            paymentIntentId: preparedPaymentIntentId,
            error,
          })
          await auditPaymentBlocked(supabase, caller.id, row, 'confirm_provider_error', {
            provider: 'PAYSTACK',
            payment_intent_id: preparedPaymentIntentId,
            payment_phase: phase,
            error: error instanceof Error ? error.message : String(error),
          })
          return jsonError(cors, 502, providerFailureMessage('PAYSTACK', orderCurrency, 'confirm'))
        }
        await recordPaymentProviderEvent(supabase, {
          provider: 'PAYSTACK',
          action: 'confirm-payment',
          succeeded: true,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: preparedPaymentIntentId,
        })
        if (transaction.status !== 'success') {
          const failureStatus = paystackFailureAttemptStatus(transaction.status)
          let nextStage = row.stage
          if (failureStatus) {
            await markPaymentAttemptStatus(supabase, {
              provider: 'PAYSTACK',
              providerPaymentId: preparedPaymentIntentId,
              status: failureStatus,
              providerResponse: transaction as unknown as Record<string, unknown>,
            }).catch(() => null)
            const failure = await markInitialOrderPaymentFailed(supabase, row, {
              provider: 'PAYSTACK',
              paymentIntentId: preparedPaymentIntentId,
              phase,
            })
            nextStage = failure.stage
          }
          await auditPaymentBlocked(supabase, caller.id, row, 'confirm_status_not_success', {
            provider: 'PAYSTACK',
            payment_status: transaction.status,
            payment_intent_id: preparedPaymentIntentId,
            payment_phase: phase,
          })
          return jsonError(cors, 409, paystackStatusMessage(transaction.status), {
            code: failureStatus ? 'PAYMENT_FAILED' : 'PAYMENT_NOT_COMPLETE',
            stage: nextStage,
            paymentStatus: transaction.status,
          })
        }

        const { alreadyConfirmed, stage } = await finalizeSuccessfulPayment(
          supabase,
          row,
          caller.id,
          'PAYSTACK',
          transaction.reference,
          phase,
        )

        return new Response(JSON.stringify({
          ok: true,
          confirmed: true,
          alreadyConfirmed,
          provider: 'PAYSTACK',
          orderId: row.id,
          paymentIntentId: transaction.reference,
          stage,
          status: transaction.status,
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      let paymentIntent
      try {
        paymentIntent = await retrieveStripePaymentIntent(preparedPaymentIntentId)
      } catch (error) {
        await recordPaymentProviderEvent(supabase, {
          provider: 'STRIPE',
          action: 'confirm-payment',
          succeeded: false,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: preparedPaymentIntentId,
          error,
        })
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_provider_error', {
          provider: 'STRIPE',
          payment_intent_id: preparedPaymentIntentId,
          payment_phase: phase,
          error: error instanceof Error ? error.message : String(error),
        })
        return jsonError(cors, 502, providerFailureMessage('STRIPE', orderCurrency, 'confirm'))
      }
      await recordPaymentProviderEvent(supabase, {
        provider: 'STRIPE',
        action: 'confirm-payment',
        succeeded: true,
        orderId: row.id,
        paymentPhase: phase,
        currency: orderCurrency,
        paymentIntentId: preparedPaymentIntentId,
      })
      if (paymentIntent.status !== 'succeeded') {
        const failureStatus = stripeFailureAttemptStatus(paymentIntent.status)
        let nextStage = row.stage
        if (failureStatus) {
          await markPaymentAttemptStatus(supabase, {
            provider: 'STRIPE',
            providerPaymentId: preparedPaymentIntentId,
            status: failureStatus,
            providerResponse: paymentIntent as unknown as Record<string, unknown>,
          }).catch(() => null)
          const failure = await markInitialOrderPaymentFailed(supabase, row, {
            provider: 'STRIPE',
            paymentIntentId: preparedPaymentIntentId,
            phase,
          })
          nextStage = failure.stage
        }
        const message =
          paymentIntent.status === 'processing'
            ? 'Payment is still processing. Pull to refresh in a moment.'
            : paymentIntent.status === 'canceled'
              ? 'Payment was canceled. Start payment again to continue.'
              : `Payment is not complete yet (${paymentIntent.status}).`
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_status_not_success', {
          provider: 'STRIPE',
          payment_status: paymentIntent.status,
          payment_intent_id: preparedPaymentIntentId,
          payment_phase: phase,
        })
        return jsonError(cors, 409, message, {
          code: failureStatus ? 'PAYMENT_FAILED' : 'PAYMENT_NOT_COMPLETE',
          stage: nextStage,
          paymentStatus: paymentIntent.status,
        })
      }

      const { alreadyConfirmed, stage } = await finalizeSuccessfulPayment(
        supabase,
        row,
        caller.id,
        'STRIPE',
        paymentIntent.id,
        phase,
      )

      return new Response(JSON.stringify({
        ok: true,
        confirmed: true,
        alreadyConfirmed,
        provider: 'STRIPE',
        orderId: row.id,
        paymentIntentId: paymentIntent.id,
        stage,
        status: paymentIntent.status,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (phase === 'INITIAL_ORDER') {
      if (orderKind === 'CUSTOM') {
        if (!['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(row.stage)) {
          await auditPaymentBlocked(supabase, caller.id, row, 'custom_not_payable')
          return jsonError(cors, 409, 'This custom order is not ready for payment yet.')
        }
        if (row.quote_expires_at && new Date(row.quote_expires_at).getTime() <= Date.now()) {
          await auditPaymentBlocked(supabase, caller.id, row, 'quote_expired', {
            quote_expires_at: row.quote_expires_at,
          })
          return jsonError(cors, 409, 'This quote has expired. Ask the tailor to send a fresh quote.')
        }
      } else if (orderKind === 'READY_MADE') {
        if (!['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(row.stage)) {
          await auditPaymentBlocked(supabase, caller.id, row, 'ready_made_not_payable')
          return jsonError(cors, 409, 'This ready-made order is not in a payable state.')
        }
      } else {
        await auditPaymentBlocked(supabase, caller.id, row, 'unsupported_order_kind', {
          order_kind: orderKind,
        })
        return jsonError(cors, 409, 'Unsupported order kind.')
      }
    } else if (phase === 'CONSULTATION') {
      if (!isConsultationPaymentPending(row)) {
        await auditPaymentBlocked(supabase, caller.id, row, 'consultation_not_payable')
        return jsonError(cors, 409, 'This order is not awaiting a consultation payment right now.')
      }
    } else if (!isFulfillmentPaymentPending(row)) {
      await auditPaymentBlocked(supabase, caller.id, row, 'fulfillment_not_payable')
      return jsonError(cors, 409, 'This order is not awaiting a delivery or shipping payment right now.')
    }

    if (!amount || amount <= 0) {
      await auditPaymentBlocked(supabase, caller.id, row, 'payment_details_missing', {
        amount,
        currency: orderCurrency,
        payment_phase: phase,
      })
      return jsonError(cors, 409, 'This order is missing payment details.')
    }

    if (phase !== 'CONSULTATION' && row.delivery_method !== 'LOCAL_COLLECTION' && !row.delivery_address?.trim()) {
      await auditPaymentBlocked(supabase, caller.id, row, 'delivery_address_missing')
      return jsonError(cors, 409, 'Delivery address is required before payment can start.')
    }

    if (provider === 'PAYSTACK') {
      if (!caller.email?.trim()) {
        await auditPaymentBlocked(supabase, caller.id, row, 'paystack_email_missing', {
          provider: 'PAYSTACK',
        })
        return jsonError(cors, 409, 'A verified email is required before Paystack checkout can start.')
      }

      const preparedPayment = resolvePreparedPaymentReference({
        expectedProvider: 'PAYSTACK',
        storedPaymentIntentId: paymentIntentForPhase(row, phase),
        storedCheckoutUrl: paymentCheckoutUrlForPhase(row, phase),
        latestAttempt,
      })

      if (preparedPayment.providerMismatch) {
        await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_recovery_mismatch', {
          expected_provider: 'PAYSTACK',
          payment_phase: phase,
        })
        return jsonError(cors, 409, 'This order has a payment-provider mismatch. Refresh the order and try again.')
      }

      let paymentReference = preparedPayment.providerPaymentId
      let checkoutUrl = preparedPayment.providerCheckoutUrl
      let existing = false

      if (paymentReference) {
        let transaction
        try {
          transaction = await verifyPaystackTransaction(paymentReference)
        } catch (error) {
          await recordPaymentProviderEvent(supabase, {
            provider: 'PAYSTACK',
            action: 'prepare-payment',
            succeeded: false,
            orderId: row.id,
            paymentPhase: phase,
            currency: orderCurrency,
            paymentIntentId: paymentReference,
            error,
          })
          await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
            provider: 'PAYSTACK',
            payment_intent_id: paymentReference,
            payment_phase: phase,
            error: error instanceof Error ? error.message : String(error),
          })
          return jsonError(cors, 502, providerFailureMessage('PAYSTACK', orderCurrency, 'prepare'))
        }
        await recordPaymentProviderEvent(supabase, {
          provider: 'PAYSTACK',
          action: 'prepare-payment',
          succeeded: true,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: paymentReference,
        })

        if (transaction.status === 'success') {
          const finalized = await finalizeSuccessfulPayment(supabase, row, caller.id, 'PAYSTACK', transaction.reference, phase)

          return new Response(JSON.stringify({
            ok: true,
            confirmed: true,
            alreadyPaid: true,
            provider: 'PAYSTACK',
            orderId: row.id,
            paymentIntentId: transaction.reference,
            authorizationUrl: checkoutUrl,
            existing: true,
            stage: finalized.stage,
            amount,
            currency: orderCurrency,
          }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

        if (isReusablePaystackStatus(transaction.status) && checkoutUrl) {
          existing = true
          paymentReference = transaction.reference
        } else if (isReusablePaystackStatus(transaction.status) && !checkoutUrl) {
          await auditPaymentBlocked(supabase, caller.id, row, 'paystack_resume_link_missing', {
            provider: 'PAYSTACK',
            payment_status: transaction.status,
            payment_intent_id: paymentReference,
            payment_phase: phase,
          })
          return jsonError(
            cors,
            409,
            'Your Paystack checkout is still open, but we could not recover the resume link yet. Wait a moment and try again.',
            { code: 'PAYSTACK_RESUME_LINK_MISSING' },
          )
        } else {
          paymentReference = null
          checkoutUrl = null
        }
      }

      let paystackIdempotencyKey = paymentReference || buildPaystackReference(row, phase)

      if (!paymentReference || !checkoutUrl) {
        let transaction
        try {
          // Paystack references cannot be reused after a terminal abandoned/failed
          // checkout. Keep retries deterministic without timestamps/randomness.
          if (!paymentReference) {
            paystackIdempotencyKey = await buildPaystackReferenceForNewAttempt(supabase, row, phase)
          }
          transaction = await initializePaystackTransaction({
            amount,
            currency: orderCurrency,
            email: caller.email,
            reference: paystackIdempotencyKey,
            callbackUrl: getPaystackCallbackUrl(),
            metadata: {
              order_id: row.id,
              reference: row.reference ?? row.id,
              order_kind: orderKind,
              payment_phase: phase,
              idempotency_key: paystackIdempotencyKey,
            },
          })
        } catch (error) {
          await recordPaymentProviderEvent(supabase, {
            provider: 'PAYSTACK',
            action: 'prepare-payment',
            succeeded: false,
            orderId: row.id,
            paymentPhase: phase,
            currency: orderCurrency,
            paymentIntentId: paystackIdempotencyKey,
            error,
          })
          await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
            provider: 'PAYSTACK',
            error: error instanceof Error ? error.message : String(error),
            currency: orderCurrency,
            payment_phase: phase,
          })
          return jsonError(cors, 502, providerFailureMessage('PAYSTACK', orderCurrency, 'prepare'))
        }
        await recordPaymentProviderEvent(supabase, {
          provider: 'PAYSTACK',
          action: 'prepare-payment',
          succeeded: true,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: transaction.reference,
        })

        paymentReference = transaction.reference
        checkoutUrl = transaction.authorization_url ?? null
        paystackIdempotencyKey = transaction.reference
        existing = false
      }

      if (!checkoutUrl) {
        await auditPaymentBlocked(supabase, caller.id, row, 'paystack_checkout_url_missing', {
          provider: 'PAYSTACK',
          payment_intent_id: paymentReference,
        })
        return jsonError(cors, 502, 'Payment checkout could not open cleanly. Please try again in a moment.')
      }

      const updates: Record<string, unknown> =
        phase === 'FULFILLMENT'
          ? {
              fulfillment_payment_provider: 'PAYSTACK',
              fulfillment_payment_intent_id: paymentReference,
              fulfillment_payment_checkout_url: checkoutUrl,
            }
          : phase === 'CONSULTATION'
            ? {
                special_note: serializeOrderSupportMeta({
                  ...parseOrderSupportMeta(row.special_note),
                  consultation: {
                    ...(consultationMetaForOrder(row) ?? {}),
                    paymentProvider: 'PAYSTACK',
                    paymentIntentId: paymentReference,
                    paymentCheckoutUrl: checkoutUrl,
                  },
                }),
              }
            : {
                payment_provider: 'PAYSTACK',
                payment_intent_id: paymentReference,
                payment_checkout_url: checkoutUrl,
              }

      let movedToPaymentPending = false
      if (
        phase === 'INITIAL_ORDER'
        && (
          (orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT')
          || row.stage === 'PAYMENT_FAILED'
        )
      ) {
        updates.stage = 'PAYMENT_PENDING'
        updates.stage_updated_at = new Date().toISOString()
        movedToPaymentPending = true
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', row.id)

      if (updateError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: row.id, error: updateError.message })
        return jsonError(cors, 500, 'Could not prepare payment for this order.')
      }

      if (movedToPaymentPending) {
        await supabase.from('order_stage_updates').insert({
          order_id: row.id,
          stage: 'PAYMENT_PENDING',
          note: paymentPendingStageNote(orderKind),
        })
      }

      await upsertPreparedPaymentAttempt(supabase, {
        orderId: row.id,
        phase,
        provider: 'PAYSTACK',
        currency: orderCurrency,
        amount,
        idempotencyKey: paystackIdempotencyKey,
        providerPaymentId: paymentReference,
        providerCheckoutUrl: checkoutUrl,
        providerResponse: {
          order_id: row.id,
          payment_phase: phase,
          existing,
          checkout_url: checkoutUrl,
        },
        status: 'PENDING',
      })

      await audit(supabase, {
        event: 'payment.prepared',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: row.id,
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          payment_intent_id: paymentReference,
          existing,
          payment_phase: phase,
          order_kind: orderKind,
          stage: movedToPaymentPending ? 'PAYMENT_PENDING' : row.stage,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        provider: 'PAYSTACK',
        orderId: row.id,
        paymentIntentId: paymentReference,
        authorizationUrl: checkoutUrl,
        existing,
        stage: movedToPaymentPending ? 'PAYMENT_PENDING' : row.stage,
        amount,
        currency: orderCurrency,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let paymentIntent = null as Awaited<ReturnType<typeof retrieveStripePaymentIntent>> | Awaited<ReturnType<typeof createStripePaymentIntent>> | null
    let existing = false
    const preparedPayment = resolvePreparedPaymentReference({
      expectedProvider: 'STRIPE',
      storedPaymentIntentId: paymentIntentForPhase(row, phase),
      storedCheckoutUrl: paymentCheckoutUrlForPhase(row, phase),
      latestAttempt,
    })
    if (preparedPayment.providerMismatch) {
      await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_recovery_mismatch', {
        expected_provider: 'STRIPE',
        payment_phase: phase,
      })
      return jsonError(cors, 409, 'This order has a payment-provider mismatch. Refresh the order and try again.')
    }
    const existingPaymentIntentId = preparedPayment.providerPaymentId
    let stripeIdempotencyKey = buildPaymentIdempotencyKey(row.id, phase)

    if (existingPaymentIntentId) {
      try {
        paymentIntent = await retrieveStripePaymentIntent(existingPaymentIntentId)
      } catch (error) {
        await recordPaymentProviderEvent(supabase, {
          provider: 'STRIPE',
          action: 'prepare-payment',
          succeeded: false,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: existingPaymentIntentId,
          error,
        })
        await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
          provider: 'STRIPE',
          payment_intent_id: existingPaymentIntentId,
          payment_phase: phase,
          error: error instanceof Error ? error.message : String(error),
        })
        return jsonError(cors, 502, providerFailureMessage('STRIPE', orderCurrency, 'prepare'))
      }
      await recordPaymentProviderEvent(supabase, {
        provider: 'STRIPE',
        action: 'prepare-payment',
        succeeded: true,
        orderId: row.id,
        paymentPhase: phase,
        currency: orderCurrency,
        paymentIntentId: existingPaymentIntentId,
      })
      if (paymentIntent.status === 'succeeded') {
        const finalized = await finalizeSuccessfulPayment(supabase, row, caller.id, 'STRIPE', paymentIntent.id, phase)

        return new Response(JSON.stringify({
          ok: true,
          confirmed: true,
          alreadyPaid: true,
          provider: 'STRIPE',
          orderId: row.id,
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          authorizationUrl: null,
          existing: true,
          stage: finalized.stage,
          amount,
          currency: orderCurrency,
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (
        paymentIntent.status !== 'canceled'
        && !(phase === 'INITIAL_ORDER' && row.stage === 'PAYMENT_FAILED' && paymentIntent.status !== 'processing')
      ) {
        existing = true
      } else {
        paymentIntent = null
      }
    }

    if (!paymentIntent) {
      try {
        paymentIntent = await createStripePaymentIntent({
          amount,
          currency: orderCurrency,
          description: paymentDescription(row, phase),
          idempotencyKey: stripeIdempotencyKey,
          metadata: {
            order_id: row.id,
            reference: row.reference ?? row.id,
            order_kind: orderKind,
            payment_phase: phase,
            idempotency_key: stripeIdempotencyKey,
          },
        })
      } catch (error) {
        await recordPaymentProviderEvent(supabase, {
          provider: 'STRIPE',
          action: 'prepare-payment',
          succeeded: false,
          orderId: row.id,
          paymentPhase: phase,
          currency: orderCurrency,
          paymentIntentId: stripeIdempotencyKey,
          error,
        })
        await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
          provider: 'STRIPE',
          error: error instanceof Error ? error.message : String(error),
          currency: orderCurrency,
          payment_phase: phase,
        })
        return jsonError(cors, 502, providerFailureMessage('STRIPE', orderCurrency, 'prepare'))
      }
      await recordPaymentProviderEvent(supabase, {
        provider: 'STRIPE',
        action: 'prepare-payment',
        succeeded: true,
        orderId: row.id,
        paymentPhase: phase,
        currency: orderCurrency,
        paymentIntentId: paymentIntent.id,
      })
    }

    if (!paymentIntent.client_secret) {
      await auditPaymentBlocked(supabase, caller.id, row, 'stripe_client_secret_missing', {
        provider: 'STRIPE',
        payment_intent_id: paymentIntent.id,
      })
      return jsonError(cors, 502, 'Card checkout could not open cleanly. Please try again in a moment.')
    }

    const updates: Record<string, unknown> =
      phase === 'FULFILLMENT'
        ? {
            fulfillment_payment_provider: 'STRIPE',
            fulfillment_payment_intent_id: paymentIntent.id,
            fulfillment_payment_checkout_url: null,
          }
        : phase === 'CONSULTATION'
          ? {
              special_note: serializeOrderSupportMeta({
                ...parseOrderSupportMeta(row.special_note),
                consultation: {
                  ...(consultationMetaForOrder(row) ?? {}),
                  paymentProvider: 'STRIPE',
                  paymentIntentId: paymentIntent.id,
                  paymentCheckoutUrl: null,
                },
              }),
            }
          : {
              payment_provider: 'STRIPE',
              payment_intent_id: paymentIntent.id,
              payment_checkout_url: null,
            }

    let movedToPaymentPending = false
    if (
      phase === 'INITIAL_ORDER'
      && (
        (orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT')
        || row.stage === 'PAYMENT_FAILED'
      )
    ) {
      updates.stage = 'PAYMENT_PENDING'
      updates.stage_updated_at = new Date().toISOString()
      movedToPaymentPending = true
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', row.id)

    if (updateError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: row.id, error: updateError.message })
      return jsonError(cors, 500, 'Could not prepare payment for this order.')
    }

    if (movedToPaymentPending) {
      await supabase.from('order_stage_updates').insert({
        order_id: row.id,
        stage: 'PAYMENT_PENDING',
        note: paymentPendingStageNote(orderKind),
      })
    }

    await upsertPreparedPaymentAttempt(supabase, {
      orderId: row.id,
      phase,
      provider: 'STRIPE',
      currency: orderCurrency,
      amount,
      idempotencyKey: stripeIdempotencyKey,
      providerPaymentId: paymentIntent.id,
      providerCheckoutUrl: null,
      providerResponse: {
        order_id: row.id,
        payment_phase: phase,
        existing,
        client_secret_present: !!paymentIntent.client_secret,
        status: paymentIntent.status,
      },
      status: 'PENDING',
    })

    await audit(supabase, {
      event: 'payment.prepared',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: row.id,
      payload: {
        function: FN,
        provider: 'STRIPE',
        payment_intent_id: paymentIntent.id,
        existing,
        payment_phase: phase,
        order_kind: orderKind,
        stage: movedToPaymentPending ? 'PAYMENT_PENDING' : row.stage,
      },
    })

    return new Response(JSON.stringify({
      ok: true,
      provider: 'STRIPE',
      orderId: row.id,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      authorizationUrl: null,
      existing,
      stage: movedToPaymentPending ? 'PAYMENT_PENDING' : row.stage,
      amount,
      currency: orderCurrency,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'Payment could not start cleanly. Please refresh the order and try again.')
  }
})

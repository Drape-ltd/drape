import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getStripeWebhookSecret, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { sendOrderConfirmationEmails } from '../_shared/order-email.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
import {
  fulfillmentPaymentConfirmedStageNote,
  paymentConfirmedStageNote,
  tailorFulfillmentPaymentConfirmedNotification,
  tailorPaymentConfirmedNotification,
} from '../_shared/payment-copy.ts'
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
  payment_intent_id?: string | null
  delivery_method?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_intent_id?: string | null
}

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT'

async function findOrderForPaymentIntent(supabase: any, paymentIntent: StripePaymentIntent) {
  const metadataOrderId =
    typeof paymentIntent.metadata?.order_id === 'string' && paymentIntent.metadata.order_id.trim().length > 0
      ? paymentIntent.metadata.order_id.trim()
      : ''

  if (metadataOrderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
      .eq('id', metadataOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.id) return data as OrderRow

  const { data: fulfillmentData, error: fulfillmentError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('fulfillment_payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (fulfillmentError) {
    throw new Error(fulfillmentError.message)
  }

  return fulfillmentData as OrderRow | null
}

function paymentPhaseForIntent(order: OrderRow, paymentIntent: StripePaymentIntent): PaymentPhase {
  const metadataPhase =
    typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'FULFILLMENT'
      ? 'FULFILLMENT'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'INITIAL_ORDER'
        ? 'INITIAL_ORDER'
        : null

  if (metadataPhase) return metadataPhase
  if (order.fulfillment_payment_intent_id === paymentIntent.id) return 'FULFILLMENT'
  return 'INITIAL_ORDER'
}

async function markOrderConfirmed(supabase: any, order: OrderRow, paymentIntent: StripePaymentIntent, phase: PaymentPhase) {
  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') return false
  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) return false

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
          data: { orderId: order.id },
        }),
      )
    }

    EdgeRuntime.waitUntil(sendOrderConfirmationEmails(supabase, order, phase))

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
        data: { orderId: order.id },
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

  EdgeRuntime.waitUntil(sendOrderConfirmationEmails(supabase, order, phase))

  return true
}

function isInitialPaymentStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED'].includes(stage)
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

  const signature = req.headers.get('Stripe-Signature')
  if (!signature) {
    return new Response('Missing Stripe-Signature header', { status: 400, headers: cors })
  }

  const payload = await req.text()

  try {
    await verifyStripeWebhookSignature({
      payload,
      signatureHeader: signature,
      webhookSecret: getStripeWebhookSecret(),
    })

    const event = JSON.parse(payload) as StripeEvent
    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())

    if (!event?.id || !event?.type) {
      return new Response('Invalid event payload', { status: 400, headers: cors })
    }

    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed' &&
      event.type !== 'payment_intent.canceled'
    ) {
      return new Response(JSON.stringify({ ok: true, ignored: true, type: event.type }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const paymentIntent = (event.data?.object ?? null) as StripePaymentIntent | null
    if (!paymentIntent?.id) {
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

      return new Response(JSON.stringify({ ok: true, missingOrder: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const phase = paymentPhaseForIntent(order, paymentIntent)

    if (event.type === 'payment_intent.succeeded') {
      if (phase === 'INITIAL_ORDER' && !isInitialPaymentStage(order.stage)) {
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      if (phase === 'FULFILLMENT' && !isFulfillmentPaymentStage(order)) {
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const changed = await markOrderConfirmed(supabase, order, paymentIntent, phase)

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

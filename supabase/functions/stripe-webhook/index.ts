import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getStripeWebhookSecret, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import {
  paymentConfirmedStageNote,
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
  payment_intent_id?: string | null
}

async function findOrderForPaymentIntent(supabase: any, paymentIntent: StripePaymentIntent) {
  const metadataOrderId =
    typeof paymentIntent.metadata?.order_id === 'string' && paymentIntent.metadata.order_id.trim().length > 0
      ? paymentIntent.metadata.order_id.trim()
      : ''

  if (metadataOrderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, payment_intent_id')
      .eq('id', metadataOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, payment_intent_id')
    .eq('payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data as OrderRow | null
}

async function markOrderConfirmed(supabase: any, order: OrderRow, paymentIntent: StripePaymentIntent) {
  if (order.stage === 'CONFIRMED') return false

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: 'STRIPE',
      payment_intent_id: paymentIntent.id,
      payment_checkout_url: null,
    })
    .eq('id', order.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

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
  }

  return true
}

function isPayableStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED'].includes(stage)
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

    if (event.type === 'payment_intent.succeeded') {
      if (!isPayableStage(order.stage)) {
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const changed = await markOrderConfirmed(supabase, order, paymentIntent)

      await audit(supabase, {
        event: 'payment.confirmed',
        actor_role: 'SYSTEM',
        order_id: order.id,
        payload: {
          function: FN,
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntent.id,
          from_stage: order.stage,
          to_stage: 'CONFIRMED',
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
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
import { verifyPaystackWebhookSignature, type PaystackTransaction } from '../_shared/paystack.ts'

const FN = 'paystack-webhook'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type PaystackEvent = {
  event: string
  data?: PaystackTransaction | null
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

function metadataOrderId(transaction: PaystackTransaction | null | undefined) {
  const value = transaction?.metadata?.order_id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

async function findOrderForReference(supabase: any, reference: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('payment_intent_id', reference)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.id) return data as OrderRow

  const { data: fulfillmentData, error: fulfillmentError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('fulfillment_payment_intent_id', reference)
    .maybeSingle()

  if (fulfillmentError) {
    throw new Error(fulfillmentError.message)
  }

  return fulfillmentData as OrderRow | null
}

async function findOrderForTransaction(supabase: any, transaction: PaystackTransaction) {
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
    typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'FULFILLMENT'
      ? 'FULFILLMENT'
      : typeof transaction.metadata?.payment_phase === 'string' && transaction.metadata.payment_phase === 'INITIAL_ORDER'
        ? 'INITIAL_ORDER'
        : null

  if (metadataPhase) return metadataPhase
  if (order.fulfillment_payment_intent_id === transaction.reference) return 'FULFILLMENT'
  return 'INITIAL_ORDER'
}

async function markOrderConfirmed(supabase: any, order: OrderRow, transaction: PaystackTransaction, phase: PaymentPhase) {
  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') return false
  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) return false

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

  const signature = req.headers.get('x-paystack-signature')
  if (!signature) {
    return new Response('Missing x-paystack-signature header', { status: 400, headers: cors })
  }

  const payload = await req.text()

  try {
    await verifyPaystackWebhookSignature({
      payload,
      signatureHeader: signature,
    })

    const event = JSON.parse(payload) as PaystackEvent
    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())

    if (event.event !== 'charge.success') {
      return new Response(JSON.stringify({ ok: true, ignored: true, type: event.event }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const transaction = event.data
    if (!transaction?.reference) {
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

      return new Response(JSON.stringify({ ok: true, missingOrder: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const phase = paymentPhaseForTransaction(order, transaction)

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

    const changed = await markOrderConfirmed(supabase, order, transaction, phase)

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
    return new Response('Webhook error', { status: 400, headers: cors })
  }
})

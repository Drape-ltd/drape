import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
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
  payment_intent_id?: string | null
}

function metadataOrderId(transaction: PaystackTransaction | null | undefined) {
  const value = transaction?.metadata?.order_id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function paymentConfirmedNote(orderKind?: string | null) {
  return orderKind === 'READY_MADE'
    ? 'Paystack confirmed payment for this ready-made order.'
    : 'Paystack confirmed payment for the accepted quote.'
}

function paymentConfirmedNotification(orderKind?: string | null) {
  return orderKind === 'READY_MADE'
    ? {
        title: 'New paid order ✅',
        body: 'A ready-made order has been paid and is ready for fulfillment.',
      }
    : {
        title: 'Quote paid ✅',
        body: 'The customer completed payment for your quote.',
      }
}

async function findOrderForReference(supabase: any, reference: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, payment_intent_id')
    .eq('payment_intent_id', reference)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data as OrderRow | null
}

async function findOrderForTransaction(supabase: any, transaction: PaystackTransaction) {
  const orderId = metadataOrderId(transaction)
  if (orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, payment_intent_id')
      .eq('id', orderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  return findOrderForReference(supabase, transaction.reference)
}

async function markOrderConfirmed(supabase: any, order: OrderRow, transaction: PaystackTransaction) {
  if (order.stage === 'CONFIRMED') return false

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: 'PAYSTACK',
      payment_intent_id: transaction.reference,
      payment_checkout_url: null,
    })
    .eq('id', order.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'CONFIRMED',
    note: paymentConfirmedNote(order.order_kind),
  })

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id.toString(), {
        ...paymentConfirmedNotification(order.order_kind),
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

    if (!isPayableStage(order.stage)) {
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const changed = await markOrderConfirmed(supabase, order, transaction)

    await audit(supabase, {
      event: 'payment.confirmed',
      actor_role: 'SYSTEM',
      order_id: order.id,
      payload: {
        function: FN,
        provider: 'PAYSTACK',
        paystack_event_type: event.event,
        payment_intent_id: transaction.reference,
        from_stage: order.stage,
        to_stage: 'CONFIRMED',
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

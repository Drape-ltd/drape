/**
 * expire-pending-payments — Supabase Edge Function (cron)
 *
 * Runs every 10 minutes via pg_cron or Supabase Scheduler:
 *   SELECT net.http_post(
 *     url := 'https://<project-ref>.functions.supabase.co/expire-pending-payments',
 *     headers := jsonb_build_object(
 *       'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
 *       'Content-Type', 'application/json'
 *     ),
 *     body := '{}'::jsonb
 *   );
 *
 * What it does:
 *   - confirms any stale `PAYMENT_PENDING` order whose Stripe or Paystack payment already succeeded
 *   - cancels abandoned Stripe intents after 30 minutes
 *   - returns custom orders to `QUOTE_SENT` when the quote is still valid
 *   - expires custom or ready-made orders when the payment window is over
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { verifyPaystackTransaction } from '../_shared/paystack.ts'
import {
  cancelStripePaymentIntent,
  retrieveStripePaymentIntent,
} from '../_shared/stripe.ts'

const FN = 'expire-pending-payments'
const PAYMENT_TIMEOUT_MINUTES = 30

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const left = new Uint8Array(hashA)
  const right = new Uint8Array(hashB)
  let diff = 0
  for (let index = 0; index < 32; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

type OrderRow = {
  id: string
  reference: string | null
  stage: string
  order_kind: 'CUSTOM' | 'READY_MADE'
  customer_id: string | null
  tailor_id: string | null
  garment_type: string | null
  item_title: string | null
  payment_intent_id: string | null
  payment_provider: string | null
  payment_checkout_url: string | null
  quote_expires_at: string | null
  stage_updated_at: string | null
}

function isQuoteStillOpen(quoteExpiresAt: string | null) {
  return !!quoteExpiresAt && new Date(quoteExpiresAt).getTime() > Date.now()
}

function paymentConfirmedNote(orderKind: OrderRow['order_kind']) {
  return orderKind === 'READY_MADE'
    ? 'Background reconciliation confirmed payment for this ready-made order.'
    : 'Background reconciliation confirmed payment for the accepted quote.'
}

function customerTimeoutNotification(order: OrderRow, nextStage: 'QUOTE_SENT' | 'EXPIRED') {
  if (order.order_kind === 'CUSTOM') {
    return nextStage === 'QUOTE_SENT'
      ? {
          title: 'Payment timed out',
          body: 'Your quote is still open. Return to the order when you are ready to finish payment.',
        }
      : {
          title: 'Quote expired',
          body: 'Your payment window closed and the quote expired. Ask the tailor to resend it if you still want to continue.',
        }
  }

  return {
    title: 'Checkout expired',
    body: 'Your ready-made checkout timed out before payment finished. Start checkout again when you are ready.',
  }
}

function tailorPaymentConfirmedNotification(orderKind: OrderRow['order_kind']) {
  return orderKind === 'READY_MADE'
    ? {
        title: 'New paid order ✅',
        body: 'A ready-made order was confirmed during payment reconciliation.',
      }
    : {
        title: 'Quote paid ✅',
        body: 'The customer completed payment for your quote.',
      }
}

async function markOrderConfirmed(
  supabase: any,
  order: OrderRow,
  provider: 'STRIPE' | 'PAYSTACK',
  paymentIntentId: string,
) {
  if (order.stage === 'CONFIRMED') return false

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: provider,
      payment_intent_id: paymentIntentId,
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

  await audit(supabase, {
    event: 'payment.confirmed',
    actor_role: 'SYSTEM',
    order_id: order.id,
    payload: {
      function: FN,
      provider,
      payment_intent_id: paymentIntentId,
      reconciled: true,
      order_kind: order.order_kind,
      from_stage: order.stage,
      to_stage: 'CONFIRMED',
    },
  })

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id, {
        ...tailorPaymentConfirmedNotification(order.order_kind),
        data: { orderId: order.id },
      }),
    )
  }

  return true
}

async function expireOrderPayment(supabase: any, order: OrderRow) {
  const nextStage =
    order.order_kind === 'CUSTOM' && isQuoteStillOpen(order.quote_expires_at)
      ? 'QUOTE_SENT'
      : 'EXPIRED'

  const note =
    order.order_kind === 'CUSTOM'
      ? nextStage === 'QUOTE_SENT'
        ? 'Payment window expired. The quote is open again for another attempt.'
        : 'Payment window expired and the quote is no longer valid.'
      : 'Checkout expired before payment was completed.'

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      stage: nextStage,
      stage_updated_at: new Date().toISOString(),
      payment_provider: null,
      payment_intent_id: null,
      payment_checkout_url: null,
    })
    .eq('id', order.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: nextStage,
    note,
  })

  await audit(supabase, {
    event: 'payment.expired',
    actor_role: 'SYSTEM',
    order_id: order.id,
    severity: 'warn',
    payload: {
      function: FN,
      order_kind: order.order_kind,
      next_stage: nextStage,
      payment_intent_id: order.payment_intent_id,
    },
  })

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        ...customerTimeoutNotification(order, nextStage),
        data: { orderId: order.id },
      }),
    )
  }

  return nextStage
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const valid = await timingSafeEqual(token, getServiceRoleKey())
    if (!valid) {
      log('warn', FN, 'auth.unauthorized')
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    const cutoff = new Date(Date.now() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        reference,
        stage,
        order_kind,
        customer_id,
        tailor_id,
        garment_type,
        item_title,
        payment_intent_id,
        payment_provider,
        payment_checkout_url,
        quote_expires_at,
        stage_updated_at
      `)
      .eq('stage', 'PAYMENT_PENDING')
      .lt('stage_updated_at', cutoff)

    if (error) {
      log('error', FN, 'db.error', { error: error.message })
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    }

    const orders = (data ?? []) as OrderRow[]
    if (orders.length === 0) {
      return new Response(JSON.stringify({ expired: 0, confirmed: 0, skipped: 0 }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let expired = 0
    let confirmed = 0
    let skipped = 0

    for (const order of orders) {
      try {
        if (order.payment_intent_id) {
          if (order.payment_provider === 'PAYSTACK') {
            const transaction = await verifyPaystackTransaction(order.payment_intent_id)

            if (transaction.status === 'success') {
              const changed = await markOrderConfirmed(supabase, order, 'PAYSTACK', transaction.reference)
              if (changed) confirmed += 1
              continue
            }
          } else {
            const paymentIntent = await retrieveStripePaymentIntent(order.payment_intent_id)

            if (paymentIntent.status === 'succeeded') {
              const changed = await markOrderConfirmed(supabase, order, 'STRIPE', paymentIntent.id)
              if (changed) confirmed += 1
              continue
            }

            if (paymentIntent.status === 'processing') {
              skipped += 1
              await audit(supabase, {
                event: 'payment.expiry_skipped_processing',
                actor_role: 'SYSTEM',
                order_id: order.id,
                severity: 'warn',
                payload: {
                  function: FN,
                  provider: 'STRIPE',
                  payment_intent_id: paymentIntent.id,
                  status: paymentIntent.status,
                },
              })
              continue
            }

            if (paymentIntent.status !== 'canceled') {
              await cancelStripePaymentIntent(order.payment_intent_id)
            }
          }
        }

        await expireOrderPayment(supabase, order)
        expired += 1
      } catch (orderError) {
        skipped += 1
        log('error', FN, 'order.failed', {
          order_id: order.id,
          error: orderError instanceof Error ? orderError.message : String(orderError),
        })
      }
    }

    return new Response(JSON.stringify({ expired, confirmed, skipped }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})

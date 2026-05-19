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
 *   - cancels any `PAYMENT_FAILED` order not retried within 2 hours
 *   - cancels abandoned Stripe intents after 30 minutes
 *   - returns custom orders to `QUOTE_SENT` when the quote is still valid
 *   - expires custom or ready-made orders when the payment window is over
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import {
  paymentConfirmedStageNote,
  tailorPaymentConfirmedNotification,
} from '../_shared/payment-copy.ts'
import { verifyPaystackTransaction } from '../_shared/paystack.ts'
import {
  cancelStripePaymentIntent,
  retrieveStripePaymentIntent,
} from '../_shared/stripe.ts'
import {
  buildFailedPaymentAutoCancelTerminalRequest,
  buildPaymentExpiredTerminalRequest,
} from '../../../packages/shared/src/order-terminal.ts'

const FN = 'expire-pending-payments'
const PAYMENT_PENDING_TIMEOUT_MINUTES = 30
const PAYMENT_FAILED_RETRY_WINDOW_MINUTES = 120

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
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
  seller_item_id: string | null
  item_size: string | null
  item_quantity: number | null
  payment_intent_id: string | null
  payment_provider: string | null
  payment_checkout_url: string | null
  quote_expires_at: string | null
  stage_updated_at: string | null
}

function isQuoteStillOpen(quoteExpiresAt: string | null) {
  return !!quoteExpiresAt && new Date(quoteExpiresAt).getTime() > Date.now()
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

function customerFailedPaymentNotification(order: OrderRow) {
  return order.order_kind === 'CUSTOM'
    ? {
        title: 'Order cancelled after failed payment',
        body: 'Payment was not retried in time, so this custom order was cancelled automatically.',
      }
    : {
        title: 'Checkout cancelled after failed payment',
        body: 'Payment was not retried in time, so this ready-made checkout was cancelled automatically.',
      }
}

function tailorFailedPaymentNotification(order: OrderRow) {
  return order.order_kind === 'CUSTOM'
    ? {
        title: 'Order cancelled after failed payment',
        body: 'The customer did not retry payment within 2 hours, so this custom order was cancelled automatically.',
      }
    : {
        title: 'Checkout cancelled after failed payment',
        body: 'The customer did not retry payment within 2 hours, so this ready-made checkout was cancelled automatically.',
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
    note: paymentConfirmedStageNote(order.order_kind),
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
        preferenceKey: 'newOrders',
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

  if (nextStage === 'QUOTE_SENT') {
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
  } else {
    await finalizeOrderTerminal(
      supabase,
      order.id,
      buildPaymentExpiredTerminalRequest({
        fromStage: order.stage as any,
        orderKind: order.order_kind,
        paymentIntentId: order.payment_intent_id,
        releaseReadyMadeInventory: order.order_kind === 'READY_MADE' && !!order.seller_item_id,
      }),
    )
  }

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        ...customerTimeoutNotification(order, nextStage),
        preferenceKey: 'paymentConfirmations',
        data: { orderId: order.id },
      }),
    )
  }

  return nextStage
}

async function cancelFailedPaymentOrder(supabase: any, order: OrderRow) {
  await finalizeOrderTerminal(
    supabase,
    order.id,
    buildFailedPaymentAutoCancelTerminalRequest({
      fromStage: order.stage as any,
      orderKind: order.order_kind,
      paymentIntentId: order.payment_intent_id,
      releaseReadyMadeInventory: order.order_kind === 'READY_MADE' && !!order.seller_item_id,
    }),
  )

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        ...customerFailedPaymentNotification(order),
        preferenceKey: 'paymentConfirmations',
        data: { orderId: order.id },
      }),
    )
  }

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id, {
        ...tailorFailedPaymentNotification(order),
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      }),
    )
  }
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
      return jsonResponse({ error: 'This scheduled payment job requires a trusted service request.' }, 401, cors)
    }

    const supabase: any = createClient(getSupabaseUrl(), getServiceRoleKey())
    const clientIp = getClientIp(req)
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.payment.limit,
      RATE_LIMITS.payment.windowMs,
      { ip: clientIp, userAgent: req.headers.get('user-agent') },
    )
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

    const pendingCutoff = new Date(Date.now() - PAYMENT_PENDING_TIMEOUT_MINUTES * 60 * 1000).toISOString()
    const failedCutoff = new Date(Date.now() - PAYMENT_FAILED_RETRY_WINDOW_MINUTES * 60 * 1000).toISOString()

    const { data: pendingData, error: pendingError } = await supabase
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
        seller_item_id,
        item_size,
        item_quantity,
        payment_intent_id,
        payment_provider,
        payment_checkout_url,
        quote_expires_at,
        stage_updated_at
      `)
      .eq('stage', 'PAYMENT_PENDING')
      .lt('stage_updated_at', pendingCutoff)

    if (pendingError) {
      log('error', FN, 'db.error', { error: pendingError.message, phase: 'pending_fetch' })
      return new Response(JSON.stringify({ error: pendingError.message }), { status: 500, headers: cors })
    }

    const { data: failedData, error: failedError } = await supabase
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
        seller_item_id,
        item_size,
        item_quantity,
        payment_intent_id,
        payment_provider,
        payment_checkout_url,
        quote_expires_at,
        stage_updated_at
      `)
      .eq('stage', 'PAYMENT_FAILED')
      .lt('stage_updated_at', failedCutoff)

    if (failedError) {
      log('error', FN, 'db.error', { error: failedError.message, phase: 'failed_fetch' })
      return new Response(JSON.stringify({ error: failedError.message }), { status: 500, headers: cors })
    }

    const orders = [
      ...((pendingData ?? []) as OrderRow[]),
      ...((failedData ?? []) as OrderRow[]),
    ]
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

            if (order.stage === 'PAYMENT_FAILED' && (transaction.status === 'pending' || transaction.status === 'ongoing')) {
              skipped += 1
              await audit(supabase, {
                event: 'payment.expiry_skipped_processing',
                actor_role: 'SYSTEM',
                order_id: order.id,
                severity: 'warn',
                payload: {
                  function: FN,
                  provider: 'PAYSTACK',
                  payment_intent_id: transaction.reference,
                  status: transaction.status,
                },
              })
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

        if (order.stage === 'PAYMENT_FAILED') {
          await cancelFailedPaymentOrder(supabase, order)
        } else {
          await expireOrderPayment(supabase, order)
        }
        expired += 1
      } catch (orderError) {
        skipped += 1
        log('error', FN, 'order.failed', {
          order_id: order.id,
          error: orderError instanceof Error ? orderError.message : String(orderError),
        })
      }
    }

    return jsonResponse({ expired, confirmed, skipped }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'Payment expiration job could not complete right now.' }, 500, cors)
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { markInitialOrderPaymentFailed } from '../_shared/payment-failure.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { sendOrderConfirmationEmails } from '../_shared/order-email.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
import { sendSmsToUser } from '../_shared/sms.ts'
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
  payment_intent_id?: string | null
  delivery_method?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_intent_id?: string | null
}

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT'

async function findPayoutForReference(supabase: any, reference: string) {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, order_id, status, provider_payout_id')
    .eq('provider', 'PAYSTACK')
    .eq('provider_payout_id', reference)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null } | null) ?? null
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

  EdgeRuntime.waitUntil(sendOrderConfirmationEmails(supabase, order, phase))

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
  const signature = req.headers.get('x-paystack-signature')
  const payload = await req.text()

  if (!signature) {
    await recordRejectedWebhook(supabase, {
      provider: 'PAYSTACK',
      functionName: FN,
      rawPayload: payload,
      reason: 'missing_signature',
      signatureHeader: null,
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
      if (nextStatus === 'FAILED') payoutPatch.failed_at = nowIso

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

      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.event }), {
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
      const failure = await markInitialOrderPaymentFailed(supabase, order, {
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
    return new Response('Webhook error', { status: 400, headers: cors })
  }
})

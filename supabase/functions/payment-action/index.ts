import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { sendOrderConfirmationEmails } from '../_shared/order-email.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
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

const FN = 'payment-action'
const PAYSTACK_CURRENCIES = new Set(['NGN', 'GHS'])

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
type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT'

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

function resolvePaymentProvider(order: OrderRow, currency: string): PaymentProvider {
  if (isPaymentProvider(order.payment_provider)) {
    return order.payment_provider
  }

  return PAYSTACK_CURRENCIES.has(currency.toUpperCase()) ? 'PAYSTACK' : 'STRIPE'
}

function resolveStoredProvider(value: string | null | undefined, currency: string): PaymentProvider {
  if (isPaymentProvider(value)) {
    return value
  }

  return PAYSTACK_CURRENCIES.has(currency.toUpperCase()) ? 'PAYSTACK' : 'STRIPE'
}

function buildPaystackReference(order: OrderRow, phase: PaymentPhase) {
  const seed = (order.reference ?? order.id).replace(/[^A-Za-z0-9._=-]/gu, '').slice(0, 60) || order.id
  return `DRP-${phase === 'FULFILLMENT' ? 'F' : 'P'}-${seed}-${Date.now()}`
}

function isPayableStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED'].includes(stage)
}

function isReusablePaystackStatus(status: string) {
  return !['success', 'failed', 'abandoned', 'reversed'].includes(status)
}

function paymentDescription(order: {
  reference?: string | null
  order_kind?: string | null
  garment_type?: string | null
  item_title?: string | null
  delivery_method?: string | null
}, phase: PaymentPhase) {
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

function providerFailureMessage(provider: PaymentProvider, currency: string, phase: 'prepare' | 'confirm') {
  const normalizedCurrency = currency.trim().toUpperCase()

  if (provider === 'PAYSTACK' && normalizedCurrency === 'KES') {
    return phase === 'prepare'
      ? 'KES checkout could not start on the Paystack path for this Drape setup. Please retry after switching this payment to Stripe.'
      : 'KES checkout could not be confirmed on the Paystack path for this Drape setup yet. Please refresh and try again.'
  }

  if (provider === 'PAYSTACK') {
    return phase === 'prepare'
      ? 'We could not start Paystack checkout right now. Please try again in a moment.'
      : 'We could not confirm the Paystack payment right now. Please refresh and try again.'
  }

  return phase === 'prepare'
    ? 'We could not start Stripe checkout right now. Please try again in a moment.'
    : 'We could not confirm the Stripe payment right now. Please refresh and try again.'
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
}

function isFulfillmentPaymentPending(order: OrderRow) {
  return order.stage === 'FINISHING'
    && order.delivery_method !== 'LOCAL_COLLECTION'
    && typeof order.fulfillment_fee === 'number'
    && order.fulfillment_fee > 0
    && !!order.fulfillment_payment_requested_at
    && !order.fulfillment_payment_paid_at
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
  if (isFulfillmentPaymentPending(order)) {
    return 'FULFILLMENT'
  }

  return 'INITIAL_ORDER'
}

function isInitialPaymentPayable(order: OrderRow) {
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING'].includes(order.stage)
  }

  if (order.order_kind === 'READY_MADE') {
    return order.stage === 'PAYMENT_PENDING'
  }

  return false
}

function paymentIntentForPhase(order: OrderRow, phase: PaymentPhase) {
  return phase === 'FULFILLMENT'
    ? (order.fulfillment_payment_intent_id?.trim() || null)
    : (order.payment_intent_id?.trim() || null)
}

function paymentCheckoutUrlForPhase(order: OrderRow, phase: PaymentPhase) {
  return phase === 'FULFILLMENT'
    ? (order.fulfillment_payment_checkout_url?.trim() || null)
    : (order.payment_checkout_url?.trim() || null)
}

function resolveProviderForPhase(order: OrderRow, phase: PaymentPhase, currency: string) {
  return phase === 'FULFILLMENT'
    ? resolveStoredProvider(order.fulfillment_payment_provider, currency)
    : resolvePaymentProvider(order, currency)
}

function resolveConfirmPhase(order: OrderRow, paymentIntentId?: string) {
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
          data: { orderId: order.id },
        }),
      )
    }

    EdgeRuntime.waitUntil(sendOrderConfirmationEmails(supabase, order, phase))

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

  return { alreadyConfirmed: false as const, stage: 'CONFIRMED' }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
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
      return new Response('Too many requests', { status: 429, headers: cors })
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
      return new Response('Database error', { status: 500, headers: cors })
    }

    const row = order as OrderRow
    if (!row?.id) return new Response('Order not found', { status: 404, headers: cors })
    if (row.customer_id?.toString() !== caller.id) return new Response('Forbidden', { status: 403, headers: cors })

    const orderKind = row.order_kind ?? 'CUSTOM'
    const currency = typeof row.quoted_currency === 'string' ? row.quoted_currency.trim().toLowerCase() : ''
    const phase = parsed.data.action === 'confirm-payment'
      ? resolveConfirmPhase(row, parsed.data.paymentIntentId)
      : resolveActivePaymentPhase(row)
    const amount = phase === 'FULFILLMENT' ? fulfillmentPaymentAmount(row) : initialPaymentAmount(row)
    const provider = resolveProviderForPhase(row, phase, currency)
    const storedProviderForPhase = phase === 'FULFILLMENT' ? row.fulfillment_payment_provider : row.payment_provider

    if (storedProviderForPhase && !isPaymentProvider(storedProviderForPhase)) {
      await auditPaymentBlocked(supabase, caller.id, row, 'provider_not_supported')
      return new Response('This order is tied to an unsupported payment provider.', { status: 409, headers: cors })
    }

    if (parsed.data.action === 'confirm-payment') {
      const preparedPaymentIntentId = paymentIntentForPhase(row, phase)

      if (!preparedPaymentIntentId) {
        await auditPaymentBlocked(supabase, caller.id, row, 'not_prepared')
        return new Response('Payment has not been prepared for this order yet.', { status: 409, headers: cors })
      }

      if (parsed.data.paymentIntentId && parsed.data.paymentIntentId !== preparedPaymentIntentId) {
        await auditPaymentBlocked(supabase, caller.id, row, 'stale_payment_attempt', {
          expected_payment_intent_id: preparedPaymentIntentId,
          provided_payment_intent_id: parsed.data.paymentIntentId,
          payment_phase: phase,
        })
        return new Response('This payment attempt is no longer current. Please retry from the order screen.', { status: 409, headers: cors })
      }

      if (phase === 'INITIAL_ORDER' && !isPayableStage(row.stage)) {
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_wrong_stage')
        return new Response('This order is no longer awaiting payment confirmation.', { status: 409, headers: cors })
      }

      if (phase === 'FULFILLMENT' && !isFulfillmentPaymentPending(row) && !row.fulfillment_payment_paid_at) {
        await auditPaymentBlocked(supabase, caller.id, row, 'fulfillment_not_payable')
        return new Response('This order is not awaiting fulfillment payment confirmation right now.', { status: 409, headers: cors })
      }

      if (provider === 'PAYSTACK') {
        let transaction
        try {
          transaction = await verifyPaystackTransaction(preparedPaymentIntentId)
        } catch (error) {
          await auditPaymentBlocked(supabase, caller.id, row, 'confirm_provider_error', {
            provider: 'PAYSTACK',
            payment_intent_id: preparedPaymentIntentId,
            payment_phase: phase,
            error: error instanceof Error ? error.message : String(error),
          })
          return new Response(providerFailureMessage('PAYSTACK', currency, 'confirm'), { status: 502, headers: cors })
        }
        if (transaction.status !== 'success') {
          await auditPaymentBlocked(supabase, caller.id, row, 'confirm_status_not_success', {
            provider: 'PAYSTACK',
            payment_status: transaction.status,
            payment_intent_id: preparedPaymentIntentId,
            payment_phase: phase,
          })
          return new Response(paystackStatusMessage(transaction.status), { status: 409, headers: cors })
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
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_provider_error', {
          provider: 'STRIPE',
          payment_intent_id: preparedPaymentIntentId,
          payment_phase: phase,
          error: error instanceof Error ? error.message : String(error),
        })
        return new Response(providerFailureMessage('STRIPE', currency, 'confirm'), { status: 502, headers: cors })
      }
      if (paymentIntent.status !== 'succeeded') {
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
        return new Response(message, { status: 409, headers: cors })
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
        if (!['QUOTE_SENT', 'PAYMENT_PENDING'].includes(row.stage)) {
          await auditPaymentBlocked(supabase, caller.id, row, 'custom_not_payable')
          return new Response('This custom order is not ready for payment yet.', { status: 409, headers: cors })
        }
        if (row.quote_expires_at && new Date(row.quote_expires_at).getTime() <= Date.now()) {
          await auditPaymentBlocked(supabase, caller.id, row, 'quote_expired', {
            quote_expires_at: row.quote_expires_at,
          })
          return new Response('This quote has expired. Ask the tailor to send a fresh quote.', { status: 409, headers: cors })
        }
      } else if (orderKind === 'READY_MADE') {
        if (row.stage !== 'PAYMENT_PENDING') {
          await auditPaymentBlocked(supabase, caller.id, row, 'ready_made_not_payable')
          return new Response('This ready-made order is not in a payable state.', { status: 409, headers: cors })
        }
      } else {
        await auditPaymentBlocked(supabase, caller.id, row, 'unsupported_order_kind', {
          order_kind: orderKind,
        })
        return new Response('Unsupported order kind.', { status: 409, headers: cors })
      }
    } else if (!isFulfillmentPaymentPending(row)) {
      await auditPaymentBlocked(supabase, caller.id, row, 'fulfillment_not_payable')
      return new Response('This order is not awaiting a delivery or shipping payment right now.', { status: 409, headers: cors })
    }

    if (!amount || amount <= 0 || !currency) {
      await auditPaymentBlocked(supabase, caller.id, row, 'payment_details_missing', {
        amount,
        currency,
        payment_phase: phase,
      })
      return new Response('This order is missing payment details.', { status: 409, headers: cors })
    }

    if (row.delivery_method !== 'LOCAL_COLLECTION' && !row.delivery_address?.trim()) {
      await auditPaymentBlocked(supabase, caller.id, row, 'delivery_address_missing')
      return new Response('Delivery address is required before payment can start.', { status: 409, headers: cors })
    }

    if (provider === 'PAYSTACK') {
      if (!caller.email?.trim()) {
        await auditPaymentBlocked(supabase, caller.id, row, 'paystack_email_missing', {
          provider: 'PAYSTACK',
        })
        return new Response('A verified email is required before Paystack checkout can start.', { status: 409, headers: cors })
      }

      let paymentReference = row.payment_intent_id?.trim() || null
      let checkoutUrl = paymentCheckoutUrlForPhase(row, phase)
      let existing = false
      paymentReference = paymentIntentForPhase(row, phase)

      if (paymentReference) {
        let transaction
        try {
          transaction = await verifyPaystackTransaction(paymentReference)
        } catch (error) {
          await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
            provider: 'PAYSTACK',
            payment_intent_id: paymentReference,
            payment_phase: phase,
            error: error instanceof Error ? error.message : String(error),
          })
          return new Response(providerFailureMessage('PAYSTACK', currency, 'prepare'), { status: 502, headers: cors })
        }

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
            currency: currency.toUpperCase(),
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
          return new Response(
            'Your Paystack checkout is still open, but we could not recover the resume link yet. Wait a moment and try again.',
            { status: 409, headers: cors },
          )
        } else {
          paymentReference = null
          checkoutUrl = null
        }
      }

      if (!paymentReference || !checkoutUrl) {
        let transaction
        try {
          transaction = await initializePaystackTransaction({
            amount,
            currency,
            email: caller.email,
            reference: buildPaystackReference(row, phase),
            callbackUrl: getPaystackCallbackUrl(),
            metadata: {
              order_id: row.id,
              reference: row.reference ?? row.id,
              order_kind: orderKind,
              payment_phase: phase,
            },
          })
        } catch (error) {
          await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
            provider: 'PAYSTACK',
            error: error instanceof Error ? error.message : String(error),
            currency: currency.toUpperCase(),
            payment_phase: phase,
          })
          return new Response(providerFailureMessage('PAYSTACK', currency, 'prepare'), { status: 502, headers: cors })
        }

        paymentReference = transaction.reference
        checkoutUrl = transaction.authorization_url ?? null
        existing = false
      }

      if (!checkoutUrl) {
        await auditPaymentBlocked(supabase, caller.id, row, 'paystack_checkout_url_missing', {
          provider: 'PAYSTACK',
          payment_intent_id: paymentReference,
        })
        return new Response('Paystack did not return a checkout URL for this payment.', { status: 502, headers: cors })
      }

      const updates: Record<string, unknown> = {
        ...(phase === 'FULFILLMENT'
          ? {
              fulfillment_payment_provider: 'PAYSTACK',
              fulfillment_payment_intent_id: paymentReference,
              fulfillment_payment_checkout_url: checkoutUrl,
            }
          : {
              payment_provider: 'PAYSTACK',
              payment_intent_id: paymentReference,
              payment_checkout_url: checkoutUrl,
            }),
      }

      let movedToPaymentPending = false
      if (phase === 'INITIAL_ORDER' && orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT') {
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
        return new Response('Could not prepare payment for this order.', { status: 500, headers: cors })
      }

      if (movedToPaymentPending) {
        await supabase.from('order_stage_updates').insert({
          order_id: row.id,
          stage: 'PAYMENT_PENDING',
          note: paymentPendingStageNote(orderKind),
        })
      }

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
        currency: currency.toUpperCase(),
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let paymentIntent = null as Awaited<ReturnType<typeof retrieveStripePaymentIntent>> | Awaited<ReturnType<typeof createStripePaymentIntent>> | null
    let existing = false

    const existingPaymentIntentId = paymentIntentForPhase(row, phase)

    if (existingPaymentIntentId) {
      try {
        paymentIntent = await retrieveStripePaymentIntent(existingPaymentIntentId)
      } catch (error) {
        await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
          provider: 'STRIPE',
          payment_intent_id: existingPaymentIntentId,
          payment_phase: phase,
          error: error instanceof Error ? error.message : String(error),
        })
        return new Response(providerFailureMessage('STRIPE', currency, 'prepare'), { status: 502, headers: cors })
      }
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
          currency: currency.toUpperCase(),
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (paymentIntent.status !== 'canceled') {
        existing = true
      } else {
        paymentIntent = null
      }
    }

    if (!paymentIntent) {
      try {
        paymentIntent = await createStripePaymentIntent({
          amount,
          currency,
          description: paymentDescription(row, phase),
          metadata: {
            order_id: row.id,
            reference: row.reference ?? row.id,
            order_kind: orderKind,
            payment_phase: phase,
          },
        })
      } catch (error) {
        await auditPaymentBlocked(supabase, caller.id, row, 'prepare_provider_error', {
          provider: 'STRIPE',
          error: error instanceof Error ? error.message : String(error),
          currency: currency.toUpperCase(),
          payment_phase: phase,
        })
        return new Response(providerFailureMessage('STRIPE', currency, 'prepare'), { status: 502, headers: cors })
      }
    }

    if (!paymentIntent.client_secret) {
      await auditPaymentBlocked(supabase, caller.id, row, 'stripe_client_secret_missing', {
        provider: 'STRIPE',
        payment_intent_id: paymentIntent.id,
      })
      return new Response('Stripe did not return a client secret for this payment intent.', { status: 502, headers: cors })
    }

    const updates: Record<string, unknown> = {
      ...(phase === 'FULFILLMENT'
        ? {
            fulfillment_payment_provider: 'STRIPE',
            fulfillment_payment_intent_id: paymentIntent.id,
            fulfillment_payment_checkout_url: null,
          }
        : {
            payment_provider: 'STRIPE',
            payment_intent_id: paymentIntent.id,
            payment_checkout_url: null,
          }),
    }

    let movedToPaymentPending = false
    if (phase === 'INITIAL_ORDER' && orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT') {
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
      return new Response('Could not prepare payment for this order.', { status: 500, headers: cors })
    }

    if (movedToPaymentPending) {
      await supabase.from('order_stage_updates').insert({
        order_id: row.id,
        stage: 'PAYMENT_PENDING',
        note: paymentPendingStageNote(orderKind),
      })
    }

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
      currency: currency.toUpperCase(),
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return new Response('Internal server error', { status: 500, headers: cors })
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../_shared/paystack.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent } from '../_shared/stripe.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'payment-action'
const PAYSTACK_CURRENCIES = new Set(['NGN', 'GHS', 'KES'])

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

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  quote_expires_at?: string | null
  delivery_method?: string | null
  delivery_address?: string | null
  garment_type?: string | null
  item_title?: string | null
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

function buildPaystackReference(order: OrderRow) {
  const seed = (order.reference ?? order.id).replace(/[^A-Za-z0-9._=-]/gu, '').slice(0, 60) || order.id
  return `DRP-${seed}-${Date.now()}`
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
}) {
  const label = order.order_kind === 'READY_MADE'
    ? (order.item_title ?? order.garment_type ?? 'Ready-made order')
    : (order.garment_type ?? 'Custom order')
  return `Drape order #${order.reference ?? 'unknown'} - ${label}`
}

function paymentPendingNote(orderKind?: string | null) {
  return orderKind === 'READY_MADE'
    ? 'Customer started checkout for this ready-made order.'
    : 'Customer started payment for this quote.'
}

function paymentConfirmedNote(orderKind?: string | null) {
  return orderKind === 'READY_MADE'
    ? 'Customer completed checkout and payment was confirmed.'
    : 'Customer paid for the accepted quote.'
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

async function finalizeSuccessfulPayment(
  supabase: any,
  order: OrderRow,
  callerId: string,
  provider: PaymentProvider,
  paymentIntentId: string,
) {
  if (order.stage === 'CONFIRMED') {
    return { alreadyConfirmed: true as const }
  }

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
    throw new Error('Could not confirm payment for this order.')
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'CONFIRMED',
    note: paymentConfirmedNote(order.order_kind),
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
        ...paymentConfirmedNotification(order.order_kind),
        data: { orderId: order.id },
      }),
    )
  }

  return { alreadyConfirmed: false as const }
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
        quote_expires_at,
        delivery_method,
        delivery_address,
        garment_type,
        item_title,
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
    const amount = typeof row.quoted_amount === 'number' ? row.quoted_amount : null
    const provider = resolvePaymentProvider(row, currency)

    if (row.payment_provider && !isPaymentProvider(row.payment_provider)) {
      await auditPaymentBlocked(supabase, caller.id, row, 'provider_not_supported')
      return new Response('This order is tied to an unsupported payment provider.', { status: 409, headers: cors })
    }

    if (parsed.data.action === 'confirm-payment') {
      if (!row.payment_intent_id) {
        await auditPaymentBlocked(supabase, caller.id, row, 'not_prepared')
        return new Response('Payment has not been prepared for this order yet.', { status: 409, headers: cors })
      }

      if (parsed.data.paymentIntentId && parsed.data.paymentIntentId !== row.payment_intent_id) {
        await auditPaymentBlocked(supabase, caller.id, row, 'stale_payment_attempt', {
          expected_payment_intent_id: row.payment_intent_id,
          provided_payment_intent_id: parsed.data.paymentIntentId,
        })
        return new Response('This payment attempt is no longer current. Please retry from the order screen.', { status: 409, headers: cors })
      }

      if (!isPayableStage(row.stage)) {
        await auditPaymentBlocked(supabase, caller.id, row, 'confirm_wrong_stage')
        return new Response('This order is no longer awaiting payment confirmation.', { status: 409, headers: cors })
      }

      if (provider === 'PAYSTACK') {
        const transaction = await verifyPaystackTransaction(row.payment_intent_id)
        if (transaction.status !== 'success') {
          await auditPaymentBlocked(supabase, caller.id, row, 'confirm_status_not_success', {
            provider: 'PAYSTACK',
            payment_status: transaction.status,
            payment_intent_id: row.payment_intent_id,
          })
          return new Response(paystackStatusMessage(transaction.status), { status: 409, headers: cors })
        }

        const { alreadyConfirmed } = await finalizeSuccessfulPayment(
          supabase,
          row,
          caller.id,
          'PAYSTACK',
          transaction.reference,
        )

        return new Response(JSON.stringify({
          ok: true,
          confirmed: true,
          alreadyConfirmed,
          provider: 'PAYSTACK',
          orderId: row.id,
          paymentIntentId: transaction.reference,
          stage: 'CONFIRMED',
          status: transaction.status,
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const paymentIntent = await retrieveStripePaymentIntent(row.payment_intent_id)
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
          payment_intent_id: row.payment_intent_id,
        })
        return new Response(message, { status: 409, headers: cors })
      }

      const { alreadyConfirmed } = await finalizeSuccessfulPayment(
        supabase,
        row,
        caller.id,
        'STRIPE',
        paymentIntent.id,
      )

      return new Response(JSON.stringify({
        ok: true,
        confirmed: true,
        alreadyConfirmed,
        provider: 'STRIPE',
        orderId: row.id,
        paymentIntentId: paymentIntent.id,
        stage: 'CONFIRMED',
        status: paymentIntent.status,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

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

    if (!amount || amount <= 0 || !currency) {
      await auditPaymentBlocked(supabase, caller.id, row, 'payment_details_missing', {
        amount,
        currency,
      })
      return new Response('This order is missing payment details.', { status: 409, headers: cors })
    }

    if (row.delivery_method === 'SHIPPING' && !row.delivery_address?.trim()) {
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
      let checkoutUrl = row.payment_checkout_url?.trim() || null
      let existing = false

      if (paymentReference) {
        const transaction = await verifyPaystackTransaction(paymentReference)

        if (transaction.status === 'success') {
          await finalizeSuccessfulPayment(supabase, row, caller.id, 'PAYSTACK', transaction.reference)

          return new Response(JSON.stringify({
            ok: true,
            confirmed: true,
            alreadyPaid: true,
            provider: 'PAYSTACK',
            orderId: row.id,
            paymentIntentId: transaction.reference,
            authorizationUrl: checkoutUrl,
            existing: true,
            stage: 'CONFIRMED',
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
        const transaction = await initializePaystackTransaction({
          amount,
          currency,
          email: caller.email,
          reference: buildPaystackReference(row),
          callbackUrl: getPaystackCallbackUrl(),
          metadata: {
            order_id: row.id,
            reference: row.reference ?? row.id,
            order_kind: orderKind,
          },
        })

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
        payment_provider: 'PAYSTACK',
        payment_intent_id: paymentReference,
        payment_checkout_url: checkoutUrl,
      }

      let movedToPaymentPending = false
      if (orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT') {
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
          note: paymentPendingNote(orderKind),
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

    if (row.payment_intent_id) {
      paymentIntent = await retrieveStripePaymentIntent(row.payment_intent_id)
      if (paymentIntent.status === 'succeeded') {
        await finalizeSuccessfulPayment(supabase, row, caller.id, 'STRIPE', paymentIntent.id)

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
          stage: 'CONFIRMED',
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
      paymentIntent = await createStripePaymentIntent({
        amount,
        currency,
        description: paymentDescription(row),
        metadata: {
          order_id: row.id,
          reference: row.reference ?? row.id,
          order_kind: orderKind,
        },
      })
    }

    if (!paymentIntent.client_secret) {
      await auditPaymentBlocked(supabase, caller.id, row, 'stripe_client_secret_missing', {
        provider: 'STRIPE',
        payment_intent_id: paymentIntent.id,
      })
      return new Response('Stripe did not return a client secret for this payment intent.', { status: 502, headers: cors })
    }

    const updates: Record<string, unknown> = {
      payment_provider: 'STRIPE',
      payment_intent_id: paymentIntent.id,
      payment_checkout_url: null,
    }

    let movedToPaymentPending = false
    if (orderKind === 'CUSTOM' && row.stage === 'QUOTE_SENT') {
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
        note: paymentPendingNote(orderKind),
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

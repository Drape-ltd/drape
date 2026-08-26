import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPaystackCallbackUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { findLatestPaymentAttemptForOrderPhase, markPaymentAttemptStatus, upsertPreparedPaymentAttempt } from '../_shared/payment-ledger.ts'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../_shared/paystack.ts'
import { enqueueTipConfirmedSideEffects } from '../_shared/tip-side-effects.ts'
import { createStripePaymentIntent, retrieveStripePaymentIntent } from '../_shared/stripe.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { Sentry } from '../_shared/sentry.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'order-tip-action'
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), orderId: uuid, amount: z.number().int().positive().max(100_000_000), currency: z.string().trim().length(3), idempotencyKey: z.string().trim().min(8).max(200) }),
  z.object({ action: z.literal('confirm'), tipId: uuid, providerReference: z.string().trim().min(1) }),
])
const json = (body: unknown, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const user = await getAuthUser(req)
  if (!user) return json({ error: 'AUTH_REQUIRED', message: 'Sign in again before tipping.' }, 401, cors)
  const parsed = parseBody(Body, await req.json().catch(() => ({})))
  if (!parsed.ok) return json({ error: 'VALIDATION_FAILED', message: 'Check the tip details and try again.' }, 400, cors)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    if (!(await checkRateLimit(supabase, `${FN}:${parsed.data.action}:${user.id}`, 3600, 20))) return rateLimitExceededResponse(cors)
    if (parsed.data.action === 'prepare') {
      const currency = normalizeAccountCurrency(parsed.data.currency)
      if (!currency) return json({ error: 'UNSUPPORTED_CURRENCY', message: 'This tip currency is not supported.' }, 409, cors)
      const { data: order } = await supabase.from('orders').select('id, reference, customer_id, tailor_id, stage, currency').eq('id', parsed.data.orderId).maybeSingle()
      if (!order || order.customer_id !== user.id) return json({ error: 'ORDER_NOT_FOUND', message: 'This completed order could not be found.' }, 404, cors)
      const { data: tip, error: tipError } = await supabase.rpc('prepare_order_tip', { p_order_id: order.id, p_customer_id: user.id, p_amount: parsed.data.amount, p_currency: currency, p_idempotency_key: parsed.data.idempotencyKey })
      if (tipError) return json({ error: 'TIP_NOT_AVAILABLE', message: tipError.message }, 409, cors)
      if (['PAYOUT_PENDING','PAID_OUT','SUCCEEDED'].includes(tip.status)) return json({ ok: true, confirmed: true, tip }, 200, cors)
      const provider = resolvePaymentProviderForCurrency(currency)
      const existing = await findLatestPaymentAttemptForOrderPhase(supabase, { orderId: order.id, phase: 'TIP', provider, statuses: ['PENDING','SUCCEEDED'] })
      if (existing?.status === 'SUCCEEDED') return json({ ok: true, confirmed: true, tip, provider, providerReference: existing.provider_payment_id }, 200, cors)
      let providerReference = existing?.provider_payment_id ?? null
      let authorizationUrl = existing?.provider_checkout_url ?? null
      let clientSecret: string | null = null
      if (!providerReference) {
        if (provider === 'STRIPE') {
          const intent = await createStripePaymentIntent({ amount: tip.amount, currency, description: `Tip for Drapeon order #${order.reference ?? order.id}`, idempotencyKey: `tip:${tip.id}`, metadata: { order_id: order.id, tip_id: tip.id, payment_phase: 'TIP', idempotency_key: tip.id } })
          providerReference = intent.id; clientSecret = intent.client_secret
        } else {
          if (!user.email) return json({ error: 'EMAIL_REQUIRED', message: 'A verified email is required for Paystack tips.' }, 409, cors)
          const transaction = await initializePaystackTransaction({ amount: tip.amount, currency, email: user.email, reference: `DRAPE-TIP-${tip.id}`, callbackUrl: getPaystackCallbackUrl(), metadata: { order_id: order.id, tip_id: tip.id, payment_phase: 'TIP' } })
          providerReference = transaction.reference; authorizationUrl = transaction.authorization_url ?? null
        }
      } else if (provider === 'STRIPE') {
        clientSecret = (await retrieveStripePaymentIntent(providerReference)).client_secret
      }
      const payment = await upsertPreparedPaymentAttempt(supabase, { orderId: order.id, phase: 'TIP', provider, currency, amount: tip.amount, idempotencyKey: `tip:${tip.id}`, providerPaymentId: providerReference, providerCheckoutUrl: authorizationUrl, providerResponse: { tipId: tip.id } })
      await supabase.from('order_tips').update({ status: 'PROCESSING', provider, provider_reference: providerReference, payment_id: payment.id }).eq('id', tip.id)
      await audit(supabase, { event: 'tip.prepared', actor_id: user.id, actor_role: 'CUSTOMER', order_id: order.id, payload: { tip_id: tip.id, payment_id: payment.id, provider, correlation_id: tip.correlation_id } })
      return json({ ok: true, confirmed: false, tipId: tip.id, orderId: order.id, provider, providerReference, authorizationUrl, clientSecret, amount: tip.amount, currency }, 200, cors)
    }

    const { data: tip } = await supabase.from('order_tips').select('id, order_id, customer_id, tailor_id, amount, currency, status, provider, provider_reference, correlation_id').eq('id', parsed.data.tipId).maybeSingle()
    if (!tip || tip.customer_id !== user.id || tip.provider_reference !== parsed.data.providerReference) return json({ error: 'TIP_NOT_FOUND', message: 'This tip attempt could not be found.' }, 404, cors)
    if (['PAYOUT_PENDING','PAID_OUT'].includes(tip.status)) return json({ ok: true, confirmed: true, tip }, 200, cors)
    if (tip.provider !== 'STRIPE' && tip.provider !== 'PAYSTACK') return json({ error: 'TIP_PROVIDER_INVALID', message: 'This tip provider is invalid.' }, 409, cors)
    const succeeded = tip.provider === 'STRIPE' ? (await retrieveStripePaymentIntent(tip.provider_reference)).status === 'succeeded' : (await verifyPaystackTransaction(tip.provider_reference)).status === 'success'
    if (!succeeded) return json({ error: 'TIP_NOT_CONFIRMED', message: 'The provider has not confirmed this tip yet.' }, 409, cors)
    await markPaymentAttemptStatus(supabase, { provider: tip.provider, providerPaymentId: tip.provider_reference, status: 'SUCCEEDED', providerResponse: { tipId: tip.id, confirmedBy: FN } })
    await enqueueTipConfirmedSideEffects(supabase, tip)
    await audit(supabase, { event: 'tip.confirmed', actor_id: user.id, actor_role: 'CUSTOMER', order_id: tip.order_id, payload: { tip_id: tip.id, provider: tip.provider, correlation_id: tip.correlation_id } })
    return json({ ok: true, confirmed: true, tip: { ...tip, status: 'PAYOUT_PENDING' } }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'action.failed', { actor_id: user.id, action: parsed.data.action, error: message })
    await Sentry.captureMessage('Order tip action failed', { tags: { function: FN, action: parsed.data.action }, extra: { actorId: user.id, error: message } })
    return json({ error: 'TIP_ACTION_FAILED', message: 'Drapeon could not safely update this tip.' }, 500, cors)
  }
})

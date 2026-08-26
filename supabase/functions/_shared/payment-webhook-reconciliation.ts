import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { retrievePaystackRefund, verifyPaystackTransaction, verifyPaystackTransfer } from './paystack.ts'
import { retrieveStripeEvent } from './stripe.ts'
import { asRecord, asString } from './jobs.ts'

type PaymentProvider = 'PAYSTACK' | 'STRIPE'

export type PaymentWebhookReconciliationResult = {
  matched: boolean
  mode: string
  providerStatus?: string | null
  expectedEventType: string
  providerEventType?: string | null
  providerObjectId?: string | null
  reason?: string | null
}

function normalizedStatus(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replaceAll('_', '-') : null
}

function paystackReference(data: Record<string, unknown>) {
  return asString(data.reference)
    ?? asString(data.transaction_reference)
    ?? asString(data.transfer_code)
}

async function reconcilePaystack(eventType: string, payload: Record<string, unknown>) {
  const data = asRecord(payload.data)

  if (eventType.startsWith('charge.')) {
    const reference = paystackReference(data)
    if (!reference) throw new Error('Paystack charge reconciliation is missing the transaction reference.')
    const provider = await verifyPaystackTransaction(reference)
    const providerStatus = normalizedStatus(provider.status)
    const expectedSuccess = eventType === 'charge.success'
    return {
      matched: expectedSuccess ? providerStatus === 'success' : providerStatus !== 'success',
      mode: 'PAYSTACK_TRANSACTION_VERIFY',
      providerStatus,
      expectedEventType: eventType,
      providerEventType: eventType,
      providerObjectId: reference,
      reason: expectedSuccess && providerStatus !== 'success'
        ? `Provider transaction status is ${providerStatus ?? 'unknown'}.`
        : null,
    } satisfies PaymentWebhookReconciliationResult
  }

  if (eventType.startsWith('transfer.')) {
    const reference = paystackReference(data)
    if (!reference) throw new Error('Paystack transfer reconciliation is missing the transfer reference.')
    const provider = await verifyPaystackTransfer(reference)
    const providerStatus = normalizedStatus(provider.status)
    const expected = eventType.split('.').at(-1)?.replaceAll('_', '-') ?? null
    const statusAliases: Record<string, string[]> = {
      success: ['success', 'successful'],
      failed: ['failed', 'failure'],
      reversed: ['reversed'],
    }
    const accepted = expected ? statusAliases[expected] ?? [expected] : []
    return {
      matched: accepted.length === 0 || (providerStatus != null && accepted.includes(providerStatus)),
      mode: 'PAYSTACK_TRANSFER_VERIFY',
      providerStatus,
      expectedEventType: eventType,
      providerEventType: eventType,
      providerObjectId: reference,
      reason: accepted.length > 0 && (!providerStatus || !accepted.includes(providerStatus))
        ? `Provider transfer status is ${providerStatus ?? 'unknown'}; expected ${accepted.join(' or ')}.`
        : null,
    } satisfies PaymentWebhookReconciliationResult
  }

  if (eventType.startsWith('refund.')) {
    const refundId = asString(data.id) ?? (typeof data.id === 'number' ? String(data.id) : null)
    if (!refundId) throw new Error('Paystack refund reconciliation is missing the refund id.')
    const provider = await retrievePaystackRefund(refundId)
    const providerStatus = normalizedStatus(provider.status)
    const expected = normalizedStatus(eventType.split('.').at(-1))
    return {
      matched: !expected || providerStatus === expected,
      mode: 'PAYSTACK_REFUND_RETRIEVE',
      providerStatus,
      expectedEventType: eventType,
      providerEventType: eventType,
      providerObjectId: refundId,
      reason: expected && providerStatus !== expected
        ? `Provider refund status is ${providerStatus ?? 'unknown'}; expected ${expected}.`
        : null,
    } satisfies PaymentWebhookReconciliationResult
  }

  return {
    matched: true,
    mode: 'PAYSTACK_SIGNED_EVENT_NO_RETRIEVAL_ENDPOINT',
    expectedEventType: eventType,
    providerEventType: eventType,
    providerObjectId: paystackReference(data),
    reason: 'Paystack has no general event retrieval endpoint for this signed event type.',
  } satisfies PaymentWebhookReconciliationResult
}

export async function reconcilePaymentWebhook(
  supabase: SupabaseClient,
  input: { webhookEventId: string; provider: PaymentProvider },
) {
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .select('id, provider, provider_event_id, event_type, payload, processed_at, signature_valid')
    .eq('id', input.webhookEventId)
    .eq('provider', input.provider)
    .maybeSingle()
  if (error) throw new Error(`Could not load payment webhook for reconciliation: ${error.message}`)
  const webhook = data as {
    id: string
    provider: PaymentProvider
    provider_event_id: string
    event_type: string
    payload: Record<string, unknown>
    processed_at: string | null
    signature_valid: boolean
  } | null
  if (!webhook?.processed_at || !webhook.signature_valid) {
    throw new Error('Payment webhook must be verified and processed before reconciliation.')
  }

  if (input.provider === 'STRIPE') {
    const accountId = asString(webhook.payload.account)
    const providerEvent = await retrieveStripeEvent({
      eventId: webhook.provider_event_id,
      accountId,
    })
    const result = {
      matched: providerEvent.id === webhook.provider_event_id && providerEvent.type === webhook.event_type,
      mode: 'STRIPE_EVENT_RETRIEVE',
      expectedEventType: webhook.event_type,
      providerEventType: providerEvent.type,
      providerObjectId: asString(asRecord(providerEvent.data?.object).id),
      reason: providerEvent.type === webhook.event_type
        ? null
        : `Provider event type is ${providerEvent.type}; expected ${webhook.event_type}.`,
    } satisfies PaymentWebhookReconciliationResult
    return result
  }

  return await reconcilePaystack(webhook.event_type, webhook.payload)
}

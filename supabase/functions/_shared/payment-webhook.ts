import { audit } from './logger.ts'
import { createWebhookEvent, markWebhookEventProcessed } from './payment-ledger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'

const textEncoder = new TextEncoder()

export async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildRejectedWebhookEventId(
  provider: PaymentProvider,
  reason: 'missing_signature' | 'invalid_signature',
  rawPayload: string,
) {
  return `${provider.toLowerCase()}:${reason}:${await sha256Hex(rawPayload)}`
}

export function buildRejectedWebhookPayload(options: {
  rawPayload: string
  reason: 'missing_signature' | 'invalid_signature'
  signatureHeader: string | null
  provider: PaymentProvider
  verificationError?: string | null
}) {
  let parsed: unknown = null

  try {
    parsed = JSON.parse(options.rawPayload)
  } catch {
    parsed = null
  }

  const object = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null

  return {
    reason: options.reason,
    verification_error: options.verificationError ?? null,
    signature_header_present: !!options.signatureHeader,
    signature_header_length: options.signatureHeader?.length ?? 0,
    provider: options.provider,
    unverified_event_id:
      typeof object?.id === 'string' ? object.id
      : typeof object?.data === 'object' && object.data && typeof (object.data as Record<string, unknown>).id === 'string'
        ? (object.data as Record<string, unknown>).id as string
        : null,
    unverified_event_type:
      typeof object?.type === 'string' ? object.type
      : typeof object?.event === 'string' ? object.event
        : null,
    unverified_reference:
      typeof object?.reference === 'string' ? object.reference
      : typeof object?.data === 'object' && object.data && typeof (object.data as Record<string, unknown>).reference === 'string'
        ? (object.data as Record<string, unknown>).reference as string
        : null,
    raw_payload: options.rawPayload,
  }
}

export async function recordRejectedWebhook(
  supabase: any,
  input: {
    provider: PaymentProvider
    functionName: string
    rawPayload: string
    reason: 'missing_signature' | 'invalid_signature'
    signatureHeader: string | null
    verificationError?: string | null
  },
) {
  const providerEventId = await buildRejectedWebhookEventId(input.provider, input.reason, input.rawPayload)
  const payload = buildRejectedWebhookPayload({
    rawPayload: input.rawPayload,
    reason: input.reason,
    signatureHeader: input.signatureHeader,
    provider: input.provider,
    verificationError: input.verificationError ?? null,
  })

  const webhookEvent = await createWebhookEvent(supabase, {
    provider: input.provider,
    providerEventId,
    eventType: input.reason,
    signatureValid: false,
    payload,
  })

  if (!webhookEvent.duplicate || !webhookEvent.alreadyProcessed) {
    await markWebhookEventProcessed(supabase, webhookEvent.id, {
      orderId: null,
      paymentId: null,
      processingResult: `rejected:${input.reason}`,
    })
  }

  await audit(supabase, {
    event: 'payment.webhook_invalid_signature',
    actor_role: 'SYSTEM',
    severity: 'warn',
    payload: {
      function: input.functionName,
      provider: input.provider,
      reason: input.reason,
      verification_error: input.verificationError ?? null,
    },
  })

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'WEBHOOK_ERROR',
    severity: 'CRITICAL',
    source: input.functionName,
    actorRole: 'SYSTEM',
    provider: input.provider,
    title: 'Webhook signature validation failed',
    description: `${input.provider} webhook signature validation failed and the event was rejected.`,
    recommendedAction: 'Confirm the provider webhook secret, inspect the rejected payload, and verify whether any legitimate payment or payout event needs manual replay.',
    dedupeKey: `webhook-error:${providerEventId}`,
    metadata: {
      reason: input.reason,
      verification_error: input.verificationError ?? null,
      provider_event_id: providerEventId,
    },
  })
}

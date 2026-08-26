import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit } from './logger.ts'
import { createWebhookEvent, markWebhookEventProcessed } from './payment-ledger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'

export type QueuedPaymentWebhook = {
  id: string
  provider: PaymentProvider
  provider_event_id: string
  event_type: string
  payload: Record<string, unknown>
  payload_sha256: string | null
  signature_valid: boolean
  processed_at: string | null
  processing_result: string | null
  processing_status: string
}

const RECOVERABLE_TERMINAL_RESULTS = new Set([
  'ignored:refund.processed',
  'ignored:refund.failed',
  'refund_invalid_or_unmatched',
])

/**
 * Legacy refund handlers could acknowledge a valid terminal provider event
 * before associating it with its Drapeon payment. Only the trusted queue may
 * replay one of those known outcomes. The downstream refund finalizer remains
 * the exactly-once authority, so this never creates a second provider refund.
 */
export function shouldRecoverProcessedPaymentWebhook(input: {
  eventType: string
  processingResult: string | null
}) {
  if (input.eventType !== 'refund.processed' && input.eventType !== 'refund.failed') return false
  return input.processingResult != null && RECOVERABLE_TERMINAL_RESULTS.has(input.processingResult)
}

const textEncoder = new TextEncoder()
const SIGNATURE_FAILURE_WINDOW_MS = 10 * 60_000
const SIGNATURE_FAILURE_ALERT_THRESHOLD = 3

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
    // Never persist an unverified provider body. A digest is sufficient for
    // deduplication and investigation without retaining attacker-controlled
    // customer/payment data.
    raw_payload_bytes: textEncoder.encode(options.rawPayload).byteLength,
  }
}

export async function enqueueVerifiedPaymentWebhook(
  supabase: SupabaseClient,
  input: {
    provider: PaymentProvider
    providerEventId: string
    eventType: string
    payload: Record<string, unknown>
    rawPayload: string
  },
) {
  const payloadSha256 = await sha256Hex(input.rawPayload)
  const { data, error } = await supabase.rpc('enqueue_verified_payment_webhook', {
    p_provider: input.provider,
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_payload: input.payload,
    p_payload_sha256: payloadSha256,
    p_max_attempts: 12,
  })

  if (error) throw new Error(`Could not durably enqueue ${input.provider} webhook: ${error.message}`)
  return data as {
    webhookEventId: string
    domainEventId: string
    jobId: string | null
    duplicate: boolean
    alreadyProcessed: boolean
    processingStatus: string
  }
}

export async function loadQueuedPaymentWebhook(
  supabase: SupabaseClient,
  input: { webhookEventId: string; provider: PaymentProvider },
) {
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .select('id, provider, provider_event_id, event_type, payload, payload_sha256, signature_valid, processed_at, processing_result, processing_status')
    .eq('id', input.webhookEventId)
    .eq('provider', input.provider)
    .maybeSingle()

  if (error) throw new Error(`Could not load queued payment webhook: ${error.message}`)
  const webhook = data as QueuedPaymentWebhook | null
  if (!webhook) throw new Error('Queued payment webhook was not found.')
  if (!webhook.signature_valid) throw new Error('Queued payment webhook signature was not verified.')
  if (!webhook.payload || typeof webhook.payload !== 'object' || Array.isArray(webhook.payload)) {
    throw new Error('Queued payment webhook payload is invalid.')
  }
  return webhook
}

export function shouldAlertOnSignatureFailureCount(count: number) {
  return count === SIGNATURE_FAILURE_ALERT_THRESHOLD
}

export async function recordRejectedWebhook(
  supabase: SupabaseClient,
  input: {
    provider: PaymentProvider
    functionName: string
    rawPayload: string
    reason: 'missing_signature' | 'invalid_signature'
    signatureHeader: string | null
    verificationError?: string | null
    sourceIp?: string | null
    userAgent?: string | null
    endpointPath?: string | null
  },
) {
  const providerEventId = await buildRejectedWebhookEventId(input.provider, input.reason, input.rawPayload)
  const payload = {
    ...buildRejectedWebhookPayload({
      rawPayload: input.rawPayload,
      reason: input.reason,
      signatureHeader: input.signatureHeader,
      provider: input.provider,
      verificationError: input.verificationError ?? null,
    }),
    raw_payload_sha256: await sha256Hex(input.rawPayload),
  }

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
      reconciliationRequired: false,
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
      source_ip: input.sourceIp ?? null,
      user_agent: input.userAgent ?? null,
    },
  })

  const timestamp = new Date().toISOString()
  const providerLabel = input.provider === 'STRIPE' ? 'Stripe' : 'Paystack'
  const sourceKey = input.sourceIp ?? 'unknown'
  const failureCount = await recordSignatureFailureForSource(
    supabase,
    input.provider,
    input.functionName,
    sourceKey,
  )

  if (shouldAlertOnSignatureFailureCount(failureCount)) {
    await Sentry.captureMessage(`${providerLabel} webhook signature failures repeated`, {
      level: 'warning',
      tags: {
        provider: input.provider,
        reason: input.reason,
        function: input.functionName,
      },
      extra: {
        sourceIp: input.sourceIp ?? null,
        userAgent: input.userAgent ?? null,
        timestamp,
        endpointPath: input.endpointPath ?? null,
        reason: input.reason,
        verificationError: input.verificationError ?? null,
        failureCount,
        windowMinutes: 10,
        payloadSha256: await sha256Hex(input.rawPayload),
        payloadBytes: textEncoder.encode(input.rawPayload).byteLength,
      },
    })

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'SYSTEM_ALERT',
      severity: 'HIGH',
      source: input.functionName,
      actorRole: 'SYSTEM',
      provider: input.provider,
      title: 'Repeated webhook signature failures',
      description: `${input.provider} webhook signature verification failed ${failureCount} times from ${sourceKey} within 10 minutes.`,
      recommendedAction: 'Review edge logs for this source, confirm provider webhook secret configuration, and block or challenge the source if it is not a provider retry.',
      dedupeKey: `webhook-signature-probe:${input.provider}:${input.functionName}:${sourceKey}`,
      metadata: {
        provider: input.provider,
        provider_event_id: providerEventId,
        source_ip: input.sourceIp ?? null,
        source_key: sourceKey,
        user_agent: input.userAgent ?? null,
        endpoint_path: input.endpointPath ?? null,
        reason: input.reason,
        verification_error: input.verificationError ?? null,
        failure_count: failureCount,
        window_minutes: 10,
        timestamp,
      },
    })
  }
}

function signatureFailureWindowStart() {
  const currentWindow = Math.floor(Date.now() / SIGNATURE_FAILURE_WINDOW_MS) * SIGNATURE_FAILURE_WINDOW_MS
  return new Date(currentWindow).toISOString()
}

async function recordSignatureFailureForSource(
  supabase: SupabaseClient,
  provider: PaymentProvider,
  functionName: string,
  sourceKey: string,
) {
  const key = `webhook-signature-failure:${provider}:${functionName}:${sourceKey}`
  const windowStart = signatureFailureWindowStart()
  const current = await supabase
    .from('rate_limit_counters')
    .select('count')
    .eq('key', key)
    .eq('window_start', windowStart)
    .maybeSingle()

  const nextCount = ((current.data as { count?: number } | null)?.count ?? 0) + 1
  const { error } = await supabase
    .from('rate_limit_counters')
    .upsert(
      { key, window_start: windowStart, count: nextCount },
      { onConflict: 'key,window_start' },
    )

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      fn: 'payment-webhook',
      event: 'signature_failure_count_failed',
      provider,
      functionName,
      sourceKey,
      error: error.message,
    }))
  }

  return nextCount
}

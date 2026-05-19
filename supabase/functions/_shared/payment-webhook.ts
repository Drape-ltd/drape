import { audit } from './logger.ts'
import { createWebhookEvent, markWebhookEventProcessed } from './payment-ledger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'

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
    raw_payload: options.rawPayload,
  }
}

export function shouldAlertOnSignatureFailureCount(count: number) {
  return count === SIGNATURE_FAILURE_ALERT_THRESHOLD
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
    sourceIp?: string | null
    userAgent?: string | null
    endpointPath?: string | null
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
        partialPayload: input.rawPayload.slice(0, 512),
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
  supabase: any,
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

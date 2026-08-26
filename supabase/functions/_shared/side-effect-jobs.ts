import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueBackgroundJob, type JobType } from './jobs.ts'
import { log } from './logger.ts'
import { Sentry } from './sentry.ts'

const FN = 'side-effect-jobs'

type Audience = 'CUSTOMER' | 'TAILOR'

type PushJobInput = {
  userId: string | null | undefined
  notification: {
    title: string
    body: string
    data?: Record<string, string>
    preferenceKey?: string
    channelId?: string
    sound?: string
    interruptionLevel?: string
  }
  source: string
  idempotencyKey: string
  orderId?: string | null
  priority?: number
}

type SmsJobInput = {
  userId: string | null | undefined
  audience: Audience
  event: string
  body: string | null | undefined
  source: string
  idempotencyKey: string
  orderId?: string | null
  fallbackPhone?: string | null
  priority?: number
}

type OrderEventEmailJobInput = {
  order: Record<string, unknown> & { id: string }
  recipientUserId: string | null | undefined
  audience: Audience
  subject: string
  body: string
  source: string
  idempotencyKey: string
  headline?: string
  ctaLabel?: string
  materialAdvanceId?: string | null
  action?: string | null
  evidenceImageUrl?: string | null
  evidenceStorageBucket?: 'order-photos' | 'commercial-evidence' | null
  priority?: number
  runAt?: string | null
  onlyIfMessageUnreadId?: string | null
}

async function captureEnqueueFailure(
  jobType: JobType,
  source: string,
  idempotencyKey: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error)
  log('warn', FN, 'enqueue.failed', {
    job_type: jobType,
    source,
    idempotency_key: idempotencyKey,
    error: message,
  })
  await Sentry.captureMessage('Failed to enqueue side-effect job', {
    level: 'warning',
    tags: { fn: FN, job_type: jobType, source },
    extra: { idempotency_key: idempotencyKey, error: message },
  })
}

async function safeEnqueue(
  supabase: SupabaseClient,
  input: {
    jobType: JobType
    eventType: string
    aggregateType: string
    aggregateId?: string | null
    orderId?: string | null
    idempotencyKey: string
    payload: Record<string, unknown>
    source: string
    priority?: number
    maxAttempts?: number
    runAt?: string | null
  },
) {
  try {
    await enqueueBackgroundJob(supabase, {
      jobType: input.jobType,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId ?? input.orderId ?? null,
      orderId: input.orderId ?? null,
      actorRole: 'SYSTEM',
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      metadata: { source: input.source },
      priority: input.priority ?? 50,
      maxAttempts: input.maxAttempts ?? 6,
      runAt: input.runAt ?? null,
    })
    return true
  } catch (error) {
    await captureEnqueueFailure(input.jobType, input.source, input.idempotencyKey, error)
    return false
  }
}

export async function enqueuePushJob(supabase: SupabaseClient, input: PushJobInput) {
  if (!input.userId || !input.notification.title.trim() || !input.notification.body.trim()) return false
  return await safeEnqueue(supabase, {
    jobType: 'SEND_PUSH',
    eventType: 'notification.push_requested',
    aggregateType: input.orderId ? 'order' : 'user',
    aggregateId: input.orderId ?? input.userId,
    orderId: input.orderId ?? null,
    idempotencyKey: `push:${input.idempotencyKey}`,
    source: input.source,
    priority: input.priority,
    payload: {
      userId: input.userId,
      notification: input.notification,
    },
  })
}

export async function enqueueSmsJob(supabase: SupabaseClient, input: SmsJobInput) {
  if (!input.userId || !input.body?.trim()) return false
  return await safeEnqueue(supabase, {
    jobType: 'SEND_SMS',
    eventType: 'notification.sms_requested',
    aggregateType: input.orderId ? 'order' : 'user',
    aggregateId: input.orderId ?? input.userId,
    orderId: input.orderId ?? null,
    idempotencyKey: `sms:${input.idempotencyKey}`,
    source: input.source,
    priority: input.priority,
    maxAttempts: 5,
    payload: {
      userId: input.userId,
      audience: input.audience,
      orderId: input.orderId ?? null,
      event: input.event,
      body: input.body,
      fallbackPhone: input.fallbackPhone ?? null,
    },
  })
}

export async function enqueueOrderEventEmailJob(
  supabase: SupabaseClient,
  input: OrderEventEmailJobInput,
) {
  if (!input.recipientUserId || !input.subject.trim() || !input.body.trim()) return false
  return await safeEnqueue(supabase, {
    jobType: 'SEND_ORDER_EVENT_EMAIL',
    eventType: 'order.email_requested',
    aggregateType: 'order',
    aggregateId: input.order.id,
    orderId: input.order.id,
    idempotencyKey: `order-email:${input.idempotencyKey}`,
    source: input.source,
    priority: input.priority,
    maxAttempts: 8,
    runAt: input.runAt ?? null,
    payload: {
      order: input.order,
      recipientUserId: input.recipientUserId,
      audience: input.audience,
      subject: input.subject,
      headline: input.headline ?? null,
      body: input.body,
      ctaLabel: input.ctaLabel ?? null,
      materialAdvanceId: input.materialAdvanceId ?? null,
      action: input.action ?? null,
      evidenceImageUrl: input.evidenceImageUrl ?? null,
      evidenceStorageBucket: input.evidenceStorageBucket ?? null,
      onlyIfMessageUnreadId: input.onlyIfMessageUnreadId ?? null,
    },
  })
}

export async function enqueueTipPayoutJob(
  supabase: SupabaseClient,
  input: { tipId: string; orderId: string; idempotencyKey: string; priority?: number },
) {
  return await safeEnqueue(supabase, {
    jobType: 'PROCESS_TIP_PAYOUT',
    eventType: 'tip.payout_requested',
    aggregateType: 'order_tip',
    aggregateId: input.tipId,
    orderId: input.orderId,
    idempotencyKey: `tip-payout:${input.idempotencyKey}`,
    source: 'tip-confirmation',
    priority: input.priority ?? 5,
    maxAttempts: 5,
    payload: { tipId: input.tipId },
  })
}

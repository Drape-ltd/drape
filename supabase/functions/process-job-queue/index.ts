import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import {
  asRecord,
  asString,
  claimDueJobs,
  createWorkerId,
  finishJob,
  type JobRow,
  type JobType,
} from '../_shared/jobs.ts'
import { log } from '../_shared/logger.ts'
import { sendPushToUser, type PushPayload } from '../_shared/notify.ts'
import { sendOrderConfirmationEmails, sendOrderEventEmail } from '../_shared/order-email.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { createOverduePayoutIssues } from '../_shared/payout-watchdog.ts'
import { Sentry } from '../_shared/sentry.ts'
import { sendSmsToUser } from '../_shared/sms.ts'

const FN = 'process-job-queue'
const DEFAULT_LIMIT = 25
const PAUSE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const ALLOWED_JOB_TYPES = new Set<JobType>([
  'SEND_PUSH',
  'SEND_SMS',
  'SEND_ORDER_EVENT_EMAIL',
  'SEND_ORDER_CONFIRMATION_EMAILS',
  'SEND_OPS_VERIFICATION_EMAIL',
  'CREATE_OPS_ISSUE',
])

function jsonResponse(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function backgroundWorkersPaused() {
  const value = Deno.env.get('DRAPE_BACKGROUND_WORKERS_PAUSED')?.trim().toLowerCase()
  return value ? PAUSE_VALUES.has(value) : false
}

function isAllowedJobType(value: string | null): value is JobType {
  return !!value && ALLOWED_JOB_TYPES.has(value as JobType)
}

async function readProcessingOptions(req: Request) {
  const fallback = { limit: DEFAULT_LIMIT, jobTypes: null as JobType[] | null }
  if (req.method !== 'POST') return fallback

  try {
    const body = await req.json()
    const payload = asRecord(body)
    const limitValue = Number(payload.limit)
    const limit = Number.isFinite(limitValue)
      ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
      : DEFAULT_LIMIT
    const jobTypes = Array.isArray(payload.jobTypes)
      ? payload.jobTypes
          .map((item) => asString(item))
          .filter(isAllowedJobType)
      : null

    return { limit, jobTypes: jobTypes && jobTypes.length > 0 ? jobTypes : null }
  } catch {
    return fallback
  }
}

function requireString(payload: Record<string, unknown>, key: string) {
  const value = asString(payload[key])
  if (!value) throw new Error(`Job payload is missing ${key}`)
  return value
}

function stringRecord(value: unknown) {
  const source = asRecord(value)
  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'string') output[key] = item
    else if (typeof item === 'number' || typeof item === 'boolean') output[key] = String(item)
  }
  return output
}

function ensureAudience(value: string | null, field: string) {
  if (value === 'CUSTOMER' || value === 'TAILOR') return value
  throw new Error(`Job payload ${field} must be CUSTOMER or TAILOR`)
}

function ensurePaymentPhase(value: string | null) {
  if (value === 'INITIAL_ORDER' || value === 'FULFILLMENT' || value === 'CONSULTATION') return value
  throw new Error('Job payload phase must be INITIAL_ORDER, FULFILLMENT, or CONSULTATION')
}

function optionalInterruptionLevel(value: unknown): PushPayload['interruptionLevel'] | undefined {
  const level = asString(value)
  if (!level) return undefined
  if (level === 'timeSensitive') return 'time-sensitive'
  if (level === 'passive' || level === 'active' || level === 'time-sensitive' || level === 'critical') {
    return level
  }
  throw new Error('Job payload interruptionLevel is invalid')
}

async function processJob(supabase: SupabaseClient, job: JobRow) {
  const payload = asRecord(job.payload)

  switch (job.job_type) {
    case 'SEND_PUSH': {
      const userId = requireString(payload, 'userId')
      const notification = asRecord(payload.notification)
      const result = await sendPushToUser(supabase, userId, {
        title: requireString(notification, 'title'),
        body: requireString(notification, 'body'),
        data: stringRecord(notification.data),
        preferenceKey: asString(notification.preferenceKey) as never,
        channelId: asString(notification.channelId) ?? undefined,
        sound: asString(notification.sound) ?? undefined,
        interruptionLevel: optionalInterruptionLevel(notification.interruptionLevel),
      })
      if (result.status === 'ERROR') {
        throw new Error(`Push delivery failed: ${result.reason}`)
      }
      if (result.status === 'SKIPPED') {
        log(result.reason === 'NO_TOKEN' ? 'warn' : 'info', FN, 'push.skipped', {
          job_id: job.id,
          user_id: userId,
          reason: result.reason,
        })
      }
      return
    }

    case 'SEND_SMS': {
      await sendSmsToUser({
        supabase,
        userId: requireString(payload, 'userId'),
        audience: ensureAudience(asString(payload.audience), 'audience'),
        orderId: asString(payload.orderId),
        event: requireString(payload, 'event'),
        body: requireString(payload, 'body'),
        fallbackPhone: asString(payload.fallbackPhone),
      })
      return
    }

    case 'SEND_ORDER_EVENT_EMAIL': {
      await sendOrderEventEmail(supabase, {
        order: asRecord(payload.order) as never,
        recipientUserId: requireString(payload, 'recipientUserId'),
        audience: ensureAudience(asString(payload.audience), 'audience'),
        subject: requireString(payload, 'subject'),
        headline: asString(payload.headline) ?? undefined,
        body: requireString(payload, 'body'),
        ctaLabel: asString(payload.ctaLabel) ?? undefined,
        evidenceImageUrl: asString(payload.evidenceImageUrl),
      })
      return
    }

    case 'SEND_ORDER_CONFIRMATION_EMAILS': {
      await sendOrderConfirmationEmails(
        supabase,
        asRecord(payload.order) as never,
        ensurePaymentPhase(asString(payload.phase)) as never,
      )
      return
    }

    case 'SEND_OPS_VERIFICATION_EMAIL': {
      const tailorId = requireString(payload, 'tailorId')
      const deliveryKey = requireString(payload, 'deliveryKey')
      const serviceRoleKey = getServiceRoleKey()
      const { data, error } = await supabase.functions.invoke('notify-ops-verification', {
        body: { tailorId, deliveryKey },
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      })
      if (error) {
        throw new Error(`Ops verification email failed: ${error.message}`)
      }
      const response = asRecord(data)
      if (response.ok !== true) {
        throw new Error(
          `Ops verification email returned an invalid response: ${asString(response.error) ?? 'unknown error'}`,
        )
      }
      return
    }

    case 'CREATE_OPS_ISSUE': {
      await createOrRefreshOpsIssue(supabase, {
        issueType: requireString(payload, 'issueType'),
        severity: requireString(payload, 'severity'),
        source: requireString(payload, 'source'),
        actorId: asString(payload.actorId),
        actorRole: asString(payload.actorRole),
        orderId: asString(payload.orderId),
        userId: asString(payload.userId),
        tailorProfileId: asString(payload.tailorProfileId),
        relatedEntityType: asString(payload.relatedEntityType),
        relatedEntityId: asString(payload.relatedEntityId),
        provider: asString(payload.provider),
        stage: asString(payload.stage),
        title: requireString(payload, 'title'),
        description: requireString(payload, 'description'),
        recommendedAction: requireString(payload, 'recommendedAction'),
        dedupeKey: requireString(payload, 'dedupeKey'),
        metadata: asRecord(payload.metadata),
      } as never)
      return
    }

    default:
      throw new Error(`Unsupported job type: ${job.job_type}`)
  }
}

async function reportDeadJob(
  supabase: SupabaseClient,
  job: JobRow,
  errorMessage: string,
) {
  await Promise.allSettled([
    Sentry.captureMessage('Drape job reached dead-letter state', {
      level: 'error',
      tags: { fn: FN, job_type: job.job_type },
      extra: {
        job_id: job.id,
        event_id: job.event_id,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        dedupe_key: job.dedupe_key,
        error: errorMessage,
      },
    }),
    job.job_type === 'CREATE_OPS_ISSUE'
      ? Promise.resolve()
      : createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: 'HIGH',
        source: FN,
        relatedEntityType: 'job_queue',
        relatedEntityId: job.id,
        provider: null,
        stage: job.job_type,
        title: 'A background job could not be completed',
        description: `Job ${job.job_type} failed after ${job.attempt_count} attempt(s): ${errorMessage}`,
        recommendedAction: 'Review the job payload, provider status, and retry manually after correcting the root cause.',
        dedupeKey: `job-dead:${job.id}`,
        metadata: {
          job_id: job.id,
          event_id: job.event_id,
          job_type: job.job_type,
          dedupe_key: job.dedupe_key,
          payload: job.payload,
        },
      }),
  ])
}

async function runPayoutWatchdog(supabase: SupabaseClient) {
  try {
    const overdue = await createOverduePayoutIssues(supabase)
    if (overdue.length > 0) {
      log('warn', FN, 'payout_watchdog.overdue_without_row', {
        count: overdue.length,
        orders: overdue.map((item) => ({
          order_id: item.order.id,
          reference: item.order.reference,
          payout_ready_at: item.payoutReadyAt,
          minutes_past_ready: item.minutesPastReady,
        })),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'payout_watchdog.failed', { error: message })
    await Sentry.captureMessage('Payout watchdog failed during job processing', {
      level: 'error',
      tags: { fn: FN, watchdog: 'payout_overdue_no_row' },
      extra: { error: message },
    })
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', message: 'Use POST to process queued jobs.' }, 405, cors)
  }

  const unauthorized = await authorizeCronRequest(req, FN, cors)
  if (unauthorized) return unauthorized

  const workerId = createWorkerId(FN)
  const { limit, jobTypes } = await readProcessingOptions(req)
  if (backgroundWorkersPaused()) {
    log('warn', FN, 'background_workers.paused', { worker_id: workerId, job_types: jobTypes })
    return jsonResponse({
      ok: true,
      workerId,
      jobTypes,
      paused: true,
      claimed: 0,
      succeeded: 0,
      retryable: 0,
      dead: 0,
      results: [],
    }, 200, cors)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const watchdogNeeded = !jobTypes || jobTypes.includes('CREATE_OPS_ISSUE')
  if (watchdogNeeded) await runPayoutWatchdog(supabase)
  const jobs = await claimDueJobs(supabase, workerId, limit, jobTypes)
  const results: Array<{
    id: string
    jobType: string
    status: 'SUCCEEDED' | 'RETRYABLE' | 'DEAD'
    error?: string
  }> = []

  for (const job of jobs) {
    const startedAt = performance.now()
    try {
      await processJob(supabase, job)
      await finishJob(supabase, {
        jobId: job.id,
        workerId,
        succeeded: true,
        durationMs: Math.round(performance.now() - startedAt),
      })
      results.push({ id: job.id, jobType: job.job_type, status: 'SUCCEEDED' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const willDead = job.attempt_count >= job.max_attempts
      log('warn', FN, 'job.failed', {
        job_id: job.id,
        job_type: job.job_type,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        error: message,
      })

      await finishJob(supabase, {
        jobId: job.id,
        workerId,
        succeeded: false,
        error: message,
        durationMs: Math.round(performance.now() - startedAt),
      })

      if (willDead) await reportDeadJob(supabase, job, message)
      results.push({ id: job.id, jobType: job.job_type, status: willDead ? 'DEAD' : 'RETRYABLE', error: message })
    }
  }

  return jsonResponse({
    ok: true,
    workerId,
    jobTypes,
    watchdogRan: watchdogNeeded,
    claimed: jobs.length,
    succeeded: results.filter((result) => result.status === 'SUCCEEDED').length,
    retryable: results.filter((result) => result.status === 'RETRYABLE').length,
    dead: results.filter((result) => result.status === 'DEAD').length,
    results,
  }, 200, cors)
})

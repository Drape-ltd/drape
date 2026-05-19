import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  firstPreflightFailure,
  preflightErrorPayload,
  runPreflight,
  type PreflightCheck,
  type PreflightResult,
} from '../../../packages/shared/src/preflight.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { Sentry } from './sentry.ts'

export { runPreflight, type PreflightCheck, type PreflightResult }

const PREFLIGHT_WINDOW_MS = 60 * 60_000
const PREFLIGHT_OPS_THRESHOLD = 3

export type PreflightContext = {
  operation: string
  entityType?: string | null
  entityId?: string | null
  actorId?: string | null
  actorRole?: string | null
  orderId?: string | null
  userId?: string | null
  source?: string | null
  metadata?: Record<string, unknown>
}

function preflightWindowStart() {
  const currentWindow = Math.floor(Date.now() / PREFLIGHT_WINDOW_MS) * PREFLIGHT_WINDOW_MS
  return new Date(currentWindow).toISOString()
}

function normalizeKeyPart(value: string | null | undefined) {
  return (value?.trim() || 'unknown').replace(/[^a-zA-Z0-9_.:-]/gu, '_').slice(0, 160)
}

async function recordPreflightFailureCount(
  supabase: SupabaseClient,
  context: PreflightContext,
  failure: PreflightCheck,
) {
  const entityKey = normalizeKeyPart(context.entityId ?? context.orderId ?? context.userId ?? context.actorId)
  const key = [
    'preflight',
    normalizeKeyPart(context.operation),
    normalizeKeyPart(failure.errorCode),
    normalizeKeyPart(context.entityType),
    entityKey,
  ].join(':')
  const windowStart = preflightWindowStart()
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
      fn: 'preflight',
      event: 'failure_count_failed',
      operation: context.operation,
      check: failure.name,
      reason: failure.errorCode,
      error: error.message,
    }))
  }

  return nextCount
}

export async function logPreflightFailure(
  supabase: SupabaseClient,
  result: PreflightResult,
  context: PreflightContext,
) {
  const failure = firstPreflightFailure(result)
  if (!failure) return

  const violationCount = await recordPreflightFailureCount(supabase, context, failure)
  const sentryExtra = {
    operation: context.operation,
    entityType: context.entityType ?? null,
    entityId: context.entityId ?? null,
    actorId: context.actorId ?? null,
    actorRole: context.actorRole ?? null,
    orderId: context.orderId ?? null,
    userId: context.userId ?? null,
    source: context.source ?? null,
    violationCount,
    failure: {
      name: failure.name,
      errorCode: failure.errorCode,
      field: failure.field ?? null,
      actual: failure.actual ?? null,
    },
    warnings: result.warnings.map((warning) => ({
      name: warning.name,
      errorCode: warning.errorCode,
      field: warning.field ?? null,
      actual: warning.actual ?? null,
    })),
    metadata: context.metadata ?? {},
  }

  await Sentry.captureMessage('Preflight check failed', {
    level: failure.errorCode.includes('TAMPER') || failure.errorCode.includes('MISMATCH') ? 'error' : 'warning',
    tags: {
      operation: context.operation,
      reason: failure.errorCode,
    },
    extra: sentryExtra,
  })

  if (violationCount < PREFLIGHT_OPS_THRESHOLD) return

  await createOrRefreshOpsIssue(supabase, {
    issueType: failure.errorCode.includes('PAY') ? 'PAYMENT_BLOCKED' : 'SYSTEM_ALERT',
    severity: failure.errorCode.includes('TAMPER') || failure.errorCode.includes('MISMATCH') ? 'CRITICAL' : 'MEDIUM',
    source: context.source ?? 'preflight',
    actorId: context.actorId ?? null,
    actorRole: context.actorRole ?? null,
    orderId: context.orderId ?? null,
    userId: context.userId ?? null,
    relatedEntityType: context.entityType ?? null,
    relatedEntityId: context.entityId ?? null,
    title: 'Repeated preflight failures',
    description: `${context.operation} failed preflight check ${failure.name} (${failure.errorCode}) ${violationCount} times in the last hour.`,
    recommendedAction: 'Review the entity state, confirm whether the UI is allowing an invalid action, and repair stale or inconsistent data before retrying.',
    dedupeKey: `preflight:${context.operation}:${failure.errorCode}:${context.entityType ?? 'entity'}:${context.entityId ?? context.orderId ?? context.userId ?? context.actorId ?? 'unknown'}`,
    metadata: sentryExtra,
  })
}

export function preflightFailureResponse(
  result: PreflightResult,
  cors: HeadersInit = {},
  status = 400,
) {
  const failure = firstPreflightFailure(result)
  if (!failure) {
    return new Response(JSON.stringify({ error: 'PREFLIGHT_FAILED', reason: 'UNKNOWN', message: 'The operation could not start.' }), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(preflightErrorPayload(failure, result.warnings)), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

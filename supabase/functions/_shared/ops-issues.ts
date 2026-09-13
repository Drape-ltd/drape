import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type OpsIssueSeverity,
  type OpsIssueStatus,
  type OpsIssueType,
} from '../../../packages/shared/src/ops-issues.ts'
import { sendCriticalOpsIssueNotification } from './ops-notifications.ts'
import { sendWebPushToOps } from './web-push.ts'
import { Sentry } from './sentry.ts'
import { log } from './logger.ts'
import { shouldPersistRoutineOpsIssue } from './ops-issue-generation-policy.ts'

type CreateOpsIssueInput = {
  issueType: OpsIssueType
  severity: OpsIssueSeverity
  source: string
  actorId?: string | null
  actorRole?: string | null
  orderId?: string | null
  userId?: string | null
  tailorProfileId?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  provider?: string | null
  stage?: string | null
  title: string
  description: string
  recommendedAction: string
  dedupeKey: string
  metadata?: Record<string, unknown>
  queueKey?: 'support' | 'privacy-deletion' | 'trust-safety' | 'money-desk' | 'delivery-supply' | 'reliability' | 'operations'
  notifyOps?: boolean
  notifyOpsPush?: boolean
}

type OpsIssueRow = {
  id: string
  issue_number: number
  case_number: string
  status: OpsIssueStatus
  canonical_status: string
  severity: OpsIssueSeverity
  metadata: Record<string, unknown> | null
  actor_id: string | null
  actor_role: string | null
  order_id: string | null
  user_id: string | null
  tailor_profile_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  provider: string | null
  stage: string | null
  title: string
  description: string
  recommended_action: string
}

function opsCasePushPayload(caseNumber: string) {
  const safeCaseNumber = /^OPS-[A-Z0-9-]{1,40}$/u.test(caseNumber) ? caseNumber : ''
  return safeCaseNumber
    ? { path: `/ops/cases/${safeCaseNumber}`, correlationKey: `ops-case:${safeCaseNumber}` }
    : { path: '/ops/my-work', correlationKey: 'ops-attention' }
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function captureOpsIssueFailure(
  event: string,
  error: string,
  input: { dedupeKey: string; issueType?: string; source?: string },
) {
  await Sentry.captureMessage('Ops issue persistence failed', {
    level: 'error',
    tags: {
      function: 'ops-issues',
      event,
      issue_type: input.issueType ?? 'UNKNOWN',
      source: input.source ?? 'UNKNOWN',
    },
    extra: {
      dedupe_key: input.dedupeKey,
      error,
    },
  })
}

export async function createOrRefreshOpsIssue(
  supabase: SupabaseClient,
  input: CreateOpsIssueInput,
) {
  if (!shouldPersistRoutineOpsIssue(input.source, Deno.env.get('DRAPE_ROUTINE_OPS_CASES_ENABLED'))) {
    log('info', 'ops-issues', 'issue.prelaunch_routine_suppressed', {
      issue_type: input.issueType,
      source: input.source,
      dedupe_key: input.dedupeKey,
    })
    return null
  }

  const environmentResponse = await supabase.rpc('current_ops_environment')
  const environment =
    environmentResponse.error || !['DEVELOPMENT', 'PRODUCTION'].includes(String(environmentResponse.data))
      ? 'UNKNOWN'
      : String(environmentResponse.data)
  const priority =
    input.severity === 'CRITICAL'
      ? 'P0'
      : input.severity === 'HIGH'
        ? 'P1'
        : input.severity === 'MEDIUM'
          ? 'P2'
          : 'P3'

  const existingResponse = await supabase
    .from('ops_issues')
    .select('id, issue_number, case_number, status, canonical_status, severity, metadata, actor_id, actor_role, order_id, user_id, tailor_profile_id, related_entity_type, related_entity_id, provider, stage, title, description, recommended_action')
    .eq('dedupe_key', input.dedupeKey)
    .maybeSingle()

  if (existingResponse.error) {
    log('error', 'ops-issues', 'issue.lookup_failed', {
      error: existingResponse.error.message,
      dedupe_key: input.dedupeKey,
    })
    await captureOpsIssueFailure('issue.lookup_failed', existingResponse.error.message, input)
    return null
  }

  const now = new Date().toISOString()
  const payload = {
    issue_type: input.issueType,
    severity: input.severity,
    status: 'OPEN' as OpsIssueStatus,
    canonical_status: 'NEW',
    source: input.source,
    actor_id: normalizeText(input.actorId),
    actor_role: normalizeText(input.actorRole),
    order_id: normalizeText(input.orderId),
    user_id: normalizeText(input.userId),
    tailor_profile_id: normalizeText(input.tailorProfileId),
    related_entity_type: normalizeText(input.relatedEntityType),
    related_entity_id: normalizeText(input.relatedEntityId),
    provider: normalizeText(input.provider),
    stage: normalizeText(input.stage),
    title: input.title.trim(),
    description: input.description.trim(),
    recommended_action: input.recommendedAction.trim(),
    dedupe_key: input.dedupeKey.trim(),
    metadata: input.metadata ?? {},
    queue_key: input.queueKey ?? null,
    priority,
    environment,
    provenance:
      environment === 'PRODUCTION' ? 'REAL' : environment === 'DEVELOPMENT' ? 'QA' : 'UNKNOWN',
    resolved_at: null,
    last_seen_at: now,
  }

  const existing = (existingResponse.data as OpsIssueRow | null) ?? null

  if (existing?.id) {
    const wasTerminal =
      existing.status === 'RESOLVED' ||
      existing.canonical_status === 'RESOLVED' ||
      existing.canonical_status === 'CLOSED'
    const beforeState = {
      status: existing.status,
      canonical_status: existing.canonical_status,
      severity: existing.severity,
      title: existing.title,
      description: existing.description,
      recommended_action: existing.recommended_action,
      metadata: existing.metadata ?? {},
    }

    const updateResponse = await supabase
      .from('ops_issues')
      .update(payload)
      .eq('id', existing.id)
      .select('id, issue_number, case_number')
      .single()

    if (updateResponse.error) {
      log('error', 'ops-issues', 'issue.update_failed', {
        error: updateResponse.error.message,
        dedupe_key: input.dedupeKey,
      })
      await captureOpsIssueFailure('issue.update_failed', updateResponse.error.message, input)
      return null
    }

    await supabase.from('ops_audit_logs').insert({
      issue_id: existing.id,
      action_taken: wasTerminal ? 'ISSUE_REOPENED' : 'ISSUE_REFRESHED',
      performed_by: normalizeText(input.actorId),
      performed_role: normalizeText(input.actorRole) ?? 'SYSTEM',
      reason: null,
      before_state: beforeState,
      after_state: {
        status: 'OPEN',
        canonical_status: 'NEW',
        severity: input.severity,
        title: input.title,
        description: input.description,
        recommended_action: input.recommendedAction,
        metadata: input.metadata ?? {},
      },
    })

    if (wasTerminal) {
      const notifyByEmail = input.severity === 'CRITICAL' || input.notifyOps === true
      if (notifyByEmail) await sendCriticalOpsIssueNotification({
        issueNumber: updateResponse.data.issue_number,
        issueType: input.issueType,
        severity: input.severity,
        title: input.title,
        description: input.description,
        recommendedAction: input.recommendedAction,
        source: input.source,
        orderId: input.orderId ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        provider: input.provider ?? null,
        stage: input.stage ?? null,
      })
      if (notifyByEmail || input.notifyOpsPush === true) {
        await sendWebPushToOps(supabase, opsCasePushPayload(String(updateResponse.data.case_number)))
      }
    }

    return updateResponse.data as { id: string; issue_number: number }
  }

  const insertResponse = await supabase
    .from('ops_issues')
    .insert(payload)
    .select('id, issue_number, case_number')
    .single()

  if (insertResponse.error) {
    log('error', 'ops-issues', 'issue.insert_failed', {
      error: insertResponse.error.message,
      dedupe_key: input.dedupeKey,
    })
    await captureOpsIssueFailure('issue.insert_failed', insertResponse.error.message, input)
    return null
  }

  await supabase.from('ops_audit_logs').insert({
    issue_id: (insertResponse.data as { id: string }).id,
    action_taken: 'ISSUE_CREATED',
    performed_by: normalizeText(input.actorId),
    performed_role: normalizeText(input.actorRole) ?? 'SYSTEM',
    reason: null,
    before_state: null,
    after_state: {
      status: 'OPEN',
      severity: input.severity,
      title: input.title,
      description: input.description,
      recommended_action: input.recommendedAction,
      metadata: input.metadata ?? {},
    },
  })

  const notifyByEmail = input.severity === 'CRITICAL' || input.notifyOps === true
  if (notifyByEmail) {
    await sendCriticalOpsIssueNotification({
      issueNumber: insertResponse.data.issue_number,
      issueType: input.issueType,
      severity: input.severity,
      title: input.title,
      description: input.description,
      recommendedAction: input.recommendedAction,
      source: input.source,
      orderId: input.orderId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      provider: input.provider ?? null,
      stage: input.stage ?? null,
    })
  }
  if (notifyByEmail || input.notifyOpsPush === true) {
    await sendWebPushToOps(supabase, opsCasePushPayload(String(insertResponse.data.case_number)))
  }

  return insertResponse.data as { id: string; issue_number: number }
}

export async function resolveOpsIssueByDedupeKey(
  supabase: SupabaseClient,
  dedupeKey: string,
  metadata: Record<string, unknown> = {},
) {
  const lookup = await supabase
    .from('ops_issues')
    .select('id, status, canonical_status, metadata')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()

  if (lookup.error) {
    log('error', 'ops-issues', 'issue.resolve_lookup_failed', {
      error: lookup.error.message,
      dedupe_key: dedupeKey,
    })
    await captureOpsIssueFailure('issue.resolve_lookup_failed', lookup.error.message, { dedupeKey })
    return
  }

  const existing = lookup.data as {
    id: string
    status: OpsIssueStatus
    canonical_status: string
    metadata: Record<string, unknown> | null
  } | null

  if (
    !existing?.id ||
    (existing.status === 'RESOLVED' && existing.canonical_status === 'RESOLVED')
  ) return

  const resolvedAt = new Date().toISOString()
  const nextMetadata = {
    ...(existing.metadata ?? {}),
    ...metadata,
    recoveredAt: resolvedAt,
  }
  const update = await supabase
    .from('ops_issues')
    .update({
      status: 'RESOLVED',
      canonical_status: 'RESOLVED',
      resolved_at: resolvedAt,
      last_seen_at: resolvedAt,
      metadata: nextMetadata,
    })
    .eq('id', existing.id)

  if (update.error) {
    log('error', 'ops-issues', 'issue.resolve_failed', {
      error: update.error.message,
      dedupe_key: dedupeKey,
    })
    await captureOpsIssueFailure('issue.resolve_failed', update.error.message, { dedupeKey })
    return
  }

  await supabase.from('ops_audit_logs').insert({
    issue_id: existing.id,
    action_taken: 'ISSUE_AUTO_RESOLVED',
    performed_by: null,
    performed_role: 'SYSTEM',
    reason: 'Provider recovered during a successful health-checked request.',
    before_state: {
      status: existing.status,
      canonical_status: existing.canonical_status,
      metadata: existing.metadata ?? {},
    },
    after_state: {
      status: 'RESOLVED',
      canonical_status: 'RESOLVED',
      metadata: nextMetadata,
    },
  })
}

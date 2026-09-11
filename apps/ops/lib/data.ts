import 'server-only'

import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'
import { canUseLegacyOpsReadBridge } from './legacy-read-bridge-policy.mjs'

export type CanonicalIssueRow = {
  id: string
  issue_number: number
  case_number?: string | null
  issue_type: string
  severity: string
  status: string
  canonical_status?: string | null
  source: string | null
  order_id: string | null
  user_id: string | null
  tailor_profile_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  provider: string | null
  title: string
  description: string
  recommended_action: string
  assigned_to: string | null
  queue_key?: string | null
  owning_team?: string | null
  priority?: string | null
  sensitivity?: string | null
  environment?: string | null
  first_response_due_at?: string | null
  active_resolution_due_at?: string | null
  first_responded_at?: string | null
  sla_clock_paused_at?: string | null
  sla_policy_version?: string | null
  record_version?: number | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type CanonicalQueuePolicyRow = {
  queue_key: string
  version: string
  primary_team: string
  backup_team: string
  permitted_roles: string[]
  pause_statuses: string[]
  escalation_triggers: string[]
  permitted_actions: string[]
  runbook_path: string
  alert_policy: string
}

export type CanonicalAuditRow = {
  id: string
  issue_id: string
  action_taken: string
  performed_by: string | null
  performed_role: string | null
  reason: string | null
  created_at: string
}

export type CanonicalCaseEventRow = {
  id: string
  issue_id: string
  event_type: string
  actor_label: string | null
  from_status: string | null
  to_status: string | null
  summary: string
  occurred_at: string
}

export type CanonicalReceiptRow = {
  id: string
  issue_id: string
  action_key: string
  outcome: string
  human_status: string
  correlation_id: string
  persisted_at: string
  completed_at: string | null
  side_effects: unknown[]
  blockers: unknown[]
  next_action: string | null
  failure_code: string | null
}

export type CanonicalCaseLineageRow = {
  id: string
  environment: string
  relationship_type: 'MERGED_INTO' | 'SPLIT_FROM'
  source_issue_id: string
  source_case_number: string
  target_issue_id: string
  target_case_number: string
  selected_context: string[]
  reason: string
  actor_label: string
  correlation_id: string
  created_at: string
}

export type CanonicalDeletionRow = {
  id: string
  user_id: string
  email: string | null
  role: string
  status: string
  reason: string | null
  requested_at: string
  acknowledged_at: string | null
  processed_at: string | null
  completed_at?: string | null
  metadata: Record<string, unknown> | null
}

export type CanonicalUserRow = {
  id: string
  display_name: string | null
  email: string | null
}

export type CanonicalOpsData = {
  issues: CanonicalIssueRow[]
  audits: CanonicalAuditRow[]
  events: CanonicalCaseEventRow[]
  receipts: CanonicalReceiptRow[]
  lineage: CanonicalCaseLineageRow[]
  deletions: CanonicalDeletionRow[]
  users: CanonicalUserRow[]
  policies: CanonicalQueuePolicyRow[]
  canonicalColumnsAvailable: boolean
  observedAt: string
}

export type CanonicalOpsDataOptions = {
  caseNumber?: string
  includeResolved?: boolean
}

const legacyIssueColumns = 'id,issue_number,issue_type,severity,status,source,order_id,user_id,tailor_profile_id,related_entity_type,related_entity_id,provider,title,description,recommended_action,assigned_to,metadata,created_at,updated_at'
const canonicalIssueColumns = `${legacyIssueColumns},case_number,canonical_status,queue_key,owning_team,priority,sensitivity,environment,first_response_due_at,active_resolution_due_at,first_responded_at,sla_clock_paused_at,sla_policy_version,record_version`
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

function unavailable(label: string, error: { message?: string } | null) {
  throw new Error(`${label} is unavailable: ${error?.message ?? 'unknown database error'}`)
}

function runtimeEnvironment() {
  return process.env.DRAPE_OPS_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production'
    ? 'PRODUCTION'
    : 'DEVELOPMENT'
}

export async function loadCanonicalOpsData(options: CanonicalOpsDataOptions = {}): Promise<CanonicalOpsData> {
  if (requiresOpsEdgeBroker()) {
    return invokeOpsReadBroker<CanonicalOpsData>('canonical-cases', options)
  }

  const client = createServiceRoleClient()
  if (!client) throw new Error('Authoritative Ops data is unavailable. No fixture fallback is permitted.')

  // This is a deliberately narrow migration bridge. It reads only the case
  // envelope and deletion domain required by Phase 1. It is removed when the
  // per-operator PostgREST token/view is proven; it never powers mutations.
  const currentEnvironment = runtimeEnvironment()
  let canonicalColumnsAvailable = true
  let canonicalIssueQuery = client
    .from('ops_issues')
    .select(canonicalIssueColumns)
    .eq('environment', currentEnvironment)
    .order('updated_at', { ascending: false })
  if (options.caseNumber) canonicalIssueQuery = canonicalIssueQuery.eq('case_number', options.caseNumber).limit(1)
  else if (options.includeResolved) canonicalIssueQuery = canonicalIssueQuery.limit(250)
  else canonicalIssueQuery = canonicalIssueQuery.in('canonical_status', ['NEW', 'TRIAGED', 'IN_PROGRESS', 'SCHEDULED_FOLLOW_UP', 'WAITING_CUSTOMER', 'WAITING_COUNTERPARTY', 'WAITING_PROVIDER', 'BLOCKED', 'ESCALATED']).limit(250)

  const canonicalIssueResult = await canonicalIssueQuery

  let issueData: unknown[] = canonicalIssueResult.data ?? []
  let issueError = canonicalIssueResult.error
  if (canonicalIssueResult.error) {
    if (!canUseLegacyOpsReadBridge({ environment: currentEnvironment, error: canonicalIssueResult.error })) {
      unavailable('Canonical Ops case queue', canonicalIssueResult.error)
    }
    canonicalColumnsAvailable = false
    let legacyIssueQuery = client
      .from('ops_issues')
      .select(legacyIssueColumns)
      .order('updated_at', { ascending: false })
    if (options.caseNumber) {
      // Random canonical case numbers do not exist before the case migration.
      legacyIssueQuery = legacyIssueQuery.eq('id', NIL_UUID).limit(1)
    } else if (options.includeResolved) legacyIssueQuery = legacyIssueQuery.limit(250)
    else legacyIssueQuery = legacyIssueQuery.in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED']).limit(250)
    const legacyIssueResult = await legacyIssueQuery
    issueData = legacyIssueResult.data ?? []
    issueError = legacyIssueResult.error
  }
  if (issueError) unavailable('Ops case queue', issueError)

  const issues = issueData as CanonicalIssueRow[]
  const issueIds = issues.map((issue) => issue.id)
  const emptyQuery = Promise.resolve({ data: [], error: null })
  const deletionIssueIds = issues
    .filter((issue) => issue.related_entity_type === 'account_deletion_request' && issue.related_entity_id)
    .map((issue) => issue.related_entity_id as string)
  let deletionQuery = client
      .from('account_deletion_requests')
      .select('id,user_id,email,role,status,reason,requested_at,acknowledged_at,processed_at,completed_at,metadata')
      .order('requested_at', { ascending: true })
  if (options.caseNumber) deletionQuery = deletionIssueIds.length > 0 ? deletionQuery.in('id', deletionIssueIds).limit(20) : deletionQuery.eq('id', NIL_UUID).limit(1)
  else if (options.includeResolved) deletionQuery = deletionQuery.limit(100)
  else deletionQuery = deletionQuery.in('status', ['PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION']).limit(100)

  const [deletionResult, auditResult, eventResult, receiptResult, lineageResult] = await Promise.all([
    deletionQuery,
    issueIds.length > 0
      ? client.from('ops_audit_logs').select('id,issue_id,action_taken,performed_by,performed_role,reason,created_at').in('issue_id', issueIds).order('created_at', { ascending: false }).limit(1000)
      : emptyQuery,
    canonicalColumnsAvailable && issueIds.length > 0
      ? client.from('ops_case_events').select('id,issue_id,event_type,actor_label,from_status,to_status,summary,occurred_at').in('issue_id', issueIds).order('occurred_at', { ascending: false }).limit(1000)
      : emptyQuery,
    canonicalColumnsAvailable && issueIds.length > 0
      ? client.from('ops_action_receipts').select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,side_effects,blockers,next_action,failure_code').in('issue_id', issueIds).order('persisted_at', { ascending: false }).limit(500)
      : emptyQuery,
    canonicalColumnsAvailable && options.caseNumber && issueIds.length === 1
      ? client.from('ops_case_lineage').select('id,environment,relationship_type,source_issue_id,source_case_number,target_issue_id,target_case_number,selected_context,reason,actor_label,correlation_id,created_at').eq('environment', runtimeEnvironment()).or(`source_issue_id.eq.${issueIds[0]},target_issue_id.eq.${issueIds[0]}`).order('created_at', { ascending: false }).limit(250)
      : emptyQuery,
  ])

  if (deletionResult.error) unavailable('Account deletion queue', deletionResult.error)
  if (auditResult.error) unavailable('Ops case timeline', auditResult.error)
  if (eventResult.error) unavailable('Canonical case events', eventResult.error)
  if (receiptResult.error) unavailable('Ops action receipts', receiptResult.error)
  if (lineageResult.error) unavailable('Ops case lineage', lineageResult.error)

  const deletions = (deletionResult.data ?? []) as unknown as CanonicalDeletionRow[]
  const userIds = [...new Set(deletions.map((request) => request.user_id))]
  const userResult = userIds.length > 0
    ? await client.from('users').select('id,display_name,email').in('id', userIds)
    : { data: [], error: null }
  if (userResult.error) unavailable('Deletion account context', userResult.error)

  const policyResult = canonicalColumnsAvailable
    ? await client
      .from('ops_queue_policies')
      .select('queue_key,version,primary_team,backup_team,permitted_roles,pause_statuses,escalation_triggers,permitted_actions,runbook_path,alert_policy')
      .eq('environment', currentEnvironment)
      .eq('active', true)
      .is('retired_at', null)
      .order('queue_key')
    : { data: [], error: null }
  if (policyResult.error) unavailable('Ops queue policy', policyResult.error)

  return {
    issues,
    audits: (auditResult.data ?? []) as unknown as CanonicalAuditRow[],
    events: (eventResult.data ?? []) as unknown as CanonicalCaseEventRow[],
    receipts: (receiptResult.data ?? []) as unknown as CanonicalReceiptRow[],
    lineage: (lineageResult.data ?? []) as unknown as CanonicalCaseLineageRow[],
    deletions,
    users: (userResult.data ?? []) as unknown as CanonicalUserRow[],
    policies: (policyResult.data ?? []) as unknown as CanonicalQueuePolicyRow[],
    canonicalColumnsAvailable,
    observedAt: new Date().toISOString(),
  }
}

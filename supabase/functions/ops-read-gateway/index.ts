import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { canReadOpsAction, isActiveOpsReadPrincipal, isOpsReadAction, queryBudgetForOpsReadAction, type OpsReadAction } from '../_shared/ops-read-policy.ts'
import { runOpsReadProjection } from '../_shared/ops-read-projections.ts'
import { meterOpsReadQueries } from '../_shared/ops-read-query-budget.ts'

const FN = 'ops-read-gateway'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const ACTIVE_CASE_STATUSES = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'SCHEDULED_FOLLOW_UP', 'WAITING_CUSTOMER', 'WAITING_COUNTERPARTY', 'WAITING_PROVIDER', 'BLOCKED', 'ESCALATED']
const CASE_COLUMNS = 'id,issue_number,issue_type,severity,status,source,order_id,user_id,tailor_profile_id,related_entity_type,related_entity_id,provider,title,description,recommended_action,assigned_to,metadata,created_at,updated_at,case_number,canonical_status,queue_key,owning_team,priority,sensitivity,environment,first_response_due_at,active_resolution_due_at,first_responded_at,sla_clock_paused_at,sla_policy_version,record_version'

type Principal = {
  id: string
  email: string
  roles: string[]
  permitted_environments: string[]
  access_subject: string | null
  session_revoked_before: string | null
  access_review_due_at: string | null
  status: string
}

type AuthorizedPrincipal = Principal & { subject: string }

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extraHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null
}

function environment() {
  const value = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
  return value === 'DEVELOPMENT' || value === 'PRODUCTION' ? value : null
}

function assertResult(label: string, result: { error: { message?: string } | null }) {
  if (result.error) throw new Error(`${label} is unavailable: ${result.error.message ?? 'unknown database error'}`)
}

async function loadCanonicalCases(supabase: SupabaseClient, env: string, input: Record<string, unknown>) {
  const caseNumber = stringValue(input.caseNumber, 64)
  if (caseNumber && !/^OPS-[A-Z0-9-]+$/u.test(caseNumber.toUpperCase())) throw new Error('The case number is invalid.')
  const includeResolved = input.includeResolved === true

  let issueQuery = supabase
    .from('ops_issues')
    .select(CASE_COLUMNS)
    .eq('environment', env)
    .order('updated_at', { ascending: false })
  if (caseNumber) issueQuery = issueQuery.eq('case_number', caseNumber.toUpperCase()).limit(1)
  else if (includeResolved) issueQuery = issueQuery.limit(250)
  else issueQuery = issueQuery.in('canonical_status', ACTIVE_CASE_STATUSES).limit(250)

  const issueResult = await issueQuery
  assertResult('Ops case queue', issueResult)
  const issues = issueResult.data ?? []
  const issueIds = issues.map((issue) => String(issue.id))
  const deletionIds = issues
    .filter((issue) => issue.related_entity_type === 'account_deletion_request' && issue.related_entity_id)
    .map((issue) => String(issue.related_entity_id))

  let deletionQuery = supabase
    .from('account_deletion_requests')
    .select('id,user_id,email,role,status,reason,requested_at,acknowledged_at,processed_at,completed_at,metadata')
    .order('requested_at', { ascending: true })
  if (caseNumber) deletionQuery = deletionIds.length > 0 ? deletionQuery.in('id', deletionIds).limit(20) : deletionQuery.eq('id', NIL_UUID).limit(1)
  else if (includeResolved) deletionQuery = deletionQuery.limit(100)
  else deletionQuery = deletionQuery.in('status', ['PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION']).limit(100)

  const empty = Promise.resolve({ data: [], error: null })
  const [deletionResult, auditResult, eventResult, receiptResult, lineageResult, policyResult] = await Promise.all([
    deletionQuery,
    issueIds.length > 0
      ? supabase.from('ops_audit_logs').select('id,issue_id,action_taken,performed_by,performed_role,reason,created_at').in('issue_id', issueIds).order('created_at', { ascending: false }).limit(1000)
      : empty,
    issueIds.length > 0
      ? supabase.from('ops_case_events').select('id,issue_id,event_type,actor_label,from_status,to_status,summary,occurred_at').in('issue_id', issueIds).order('occurred_at', { ascending: false }).limit(1000)
      : empty,
    issueIds.length > 0
      ? supabase.from('ops_action_receipts').select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,side_effects,blockers,next_action,failure_code').in('issue_id', issueIds).order('persisted_at', { ascending: false }).limit(500)
      : empty,
    caseNumber && issueIds.length === 1
      ? supabase.from('ops_case_lineage').select('id,environment,relationship_type,source_issue_id,source_case_number,target_issue_id,target_case_number,selected_context,reason,actor_label,correlation_id,created_at').eq('environment', env).or(`source_issue_id.eq.${issueIds[0]},target_issue_id.eq.${issueIds[0]}`).order('created_at', { ascending: false }).limit(250)
      : empty,
    supabase.from('ops_queue_policies').select('queue_key,version,primary_team,backup_team,permitted_roles,pause_statuses,escalation_triggers,permitted_actions,runbook_path,alert_policy').eq('environment', env).eq('active', true).is('retired_at', null).order('queue_key'),
  ])
  for (const [label, result] of [
    ['Account deletion queue', deletionResult],
    ['Ops case timeline', auditResult],
    ['Canonical case events', eventResult],
    ['Ops action receipts', receiptResult],
    ['Ops case lineage', lineageResult],
    ['Ops queue policy', policyResult],
  ] as const) assertResult(label, result)

  const deletions = deletionResult.data ?? []
  const userIds = [...new Set(deletions.map((request) => String(request.user_id)).filter(Boolean))]
  const userResult = userIds.length > 0
    ? await supabase.from('users').select('id,display_name,email').in('id', userIds)
    : { data: [], error: null }
  assertResult('Deletion account context', userResult)

  return {
    issues,
    audits: auditResult.data ?? [],
    events: eventResult.data ?? [],
    receipts: receiptResult.data ?? [],
    lineage: lineageResult.data ?? [],
    deletions,
    users: userResult.data ?? [],
    policies: policyResult.data ?? [],
    canonicalColumnsAvailable: true,
    observedAt: new Date().toISOString(),
  }
}

async function readAction(supabase: SupabaseClient, action: OpsReadAction, env: string, input: Record<string, unknown>, principal: AuthorizedPrincipal) {
  switch (action) {
    case 'session':
      return {
        id: principal.id,
        email: principal.email,
        roles: principal.roles,
        accessReviewDueAt: principal.access_review_due_at,
      }
    case 'canonical-cases':
      return loadCanonicalCases(supabase, env, input)
    default:
      return runOpsReadProjection(supabase, action, env, input, principal)
  }
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    const accessAssertion = request.headers.get('x-drape-ops-access-assertion')?.trim() ?? ''
    const identity = await verifyCloudflareOpsAccess(accessAssertion, {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
      requireSensitive: false,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity) return json({ error: 'Workforce access is required.', correlationId }, 401, cors)

    const raw = await request.text()
    if (raw.length > 8_192) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = asRecord(JSON.parse(raw || '{}'))
    if (!isOpsReadAction(body.action)) return json({ error: 'Unknown Ops read operation.', correlationId }, 400, cors)
    const input = asRecord(body.input)

    const env = environment()
    if (!env) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    const rawSupabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const queryMeter = meterOpsReadQueries(rawSupabase)
    const supabase = queryMeter.client
    const projectionStartedAt = performance.now()
    const { data, error } = await supabase
      .from('ops_workforce_principals')
      .select('id,email,roles,permitted_environments,access_subject,session_revoked_before,access_review_due_at,status')
      .eq('email', identity.email)
      .maybeSingle()
    if (error) throw error
    const principal = data as Principal | null
    if (
      !principal ||
      !isActiveOpsReadPrincipal({
        status: principal.status,
        accessSubject: principal.access_subject,
        permittedEnvironments: principal.permitted_environments,
        sessionRevokedBefore: principal.session_revoked_before,
        accessReviewDueAt: principal.access_review_due_at,
        assertedSubject: identity.subject,
        assertionIssuedAt: identity.issuedAt,
        environment: env,
      })
    ) {
      return json({ error: 'Workforce principal is unavailable, expired, or revoked.', correlationId }, 403, cors)
    }
    if (!canReadOpsAction(principal.roles, body.action)) {
      return json({ error: 'This workforce role cannot read the requested Ops projection.', correlationId }, 403, cors)
    }
    if (body.action === 'money-grant' && !identity.sensitiveAssurance) {
      return json({ error: 'Sensitive workforce assurance is required.', correlationId }, 403, cors)
    }

    const result = await readAction(supabase, body.action, env, input, { ...principal, subject: identity.subject })
    const queryCount = queryMeter.count()
    const queryBudget = queryBudgetForOpsReadAction(body.action)
    const durationMs = Math.round((performance.now() - projectionStartedAt) * 10) / 10
    const budgetExceeded = queryCount > queryBudget
    log(budgetExceeded ? 'warn' : 'info', FN, 'read.completed', {
      action: body.action,
      environment: env,
      correlation_id: correlationId,
      query_count: queryCount,
      query_budget: queryBudget,
      query_budget_exceeded: budgetExceeded,
      duration_ms: durationMs,
    })
    return json({ ok: true, data: result, correlationId }, 200, cors, {
      'X-Drape-Ops-Query-Count': String(queryCount),
      'X-Drape-Ops-Query-Budget': String(queryBudget),
      'Server-Timing': `ops-read;dur=${durationMs}`,
    })
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The Ops read could not be completed.', correlationId }, 500, cors)
  }
})

import type { CanonicalDeletionRow, CanonicalOpsData } from './data'

export type OpsCaseHistoryEntry = {
  id: string
  actionTaken: string
  performedBy: string | null
  performedRole: string | null
  reason: string | null
  createdAt: string
}

export type OpsActionReceipt = {
  id: string
  actionKey: string
  outcome: string
  humanStatus: string
  correlationId: string
  persistedAt: string
  completedAt: string | null
  sideEffectCount: number
  blockerCount: number
  nextAction: string | null
  failureCode: string | null
}

export type OpsWorkItem = {
  id: string
  caseNumber: string
  caseType: string
  queueKey: string
  title: string
  summary: string
  severity: string
  priority: string
  status: string
  context: string
  waitingReason: string | null
  recommendedAction: string
  assignee: string | null
  ownerTeam: string | null
  backupTeam: string | null
  permittedRoles: string[]
  permittedActions: string[]
  createdAt: string
  updatedAt: string
  slaDueAt: string | null
  slaPhase: 'FIRST_RESPONSE' | 'ACTIVE_RESOLUTION'
  slaPaused: boolean
  slaPolicyVersion: string | null
  runbookPath: string | null
  history: OpsCaseHistoryEntry[]
  receipts: OpsActionReceipt[]
  sourceHref: string | null
  facts: Array<{ label: string; value: string }>
  environment: 'development' | 'production'
  sensitivity: 'INTERNAL' | 'SENSITIVE' | 'HIGHLY_RESTRICTED'
  recordVersion: number | null
  relatedEntityType: string | null
  relatedEntityId: string | null
  userId: string | null
  tailorProfileId: string | null
  orderId: string | null
  source: string | null
  provider: string | null
  metadata: Record<string, unknown> | null
}

const severityRank: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  WARNING: 2,
  LOW: 3,
  INFO: 4,
}

const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

function normalizedSeverity(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? ''
  return normalized in severityRank ? normalized : 'MEDIUM'
}

function runtimeEnvironment(): 'development' | 'production' {
  return process.env.DRAPE_OPS_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production'
    ? 'production'
    : 'development'
}

function issueEnvironment(value: string | null | undefined) {
  const normalized = value?.toUpperCase()
  if (normalized === 'PRODUCTION') return 'production' as const
  if (normalized === 'DEVELOPMENT') return 'development' as const
  return runtimeEnvironment()
}

function normalizedSensitivity(value: string | null | undefined): OpsWorkItem['sensitivity'] {
  const normalized = value?.toUpperCase()
  if (normalized === 'HIGHLY_RESTRICTED') return 'HIGHLY_RESTRICTED'
  if (normalized === 'SENSITIVE' || normalized === 'RESTRICTED') return 'SENSITIVE'
  return 'INTERNAL'
}

function queueForIssue(issueType: string, source?: string | null, title?: string | null) {
  const type = issueType.toUpperCase()
  const origin = source?.toLowerCase() ?? ''
  const headline = title?.toLowerCase() ?? ''
  if (origin === 'account-support-action' || type === 'AFTERCARE_REQUEST' || headline.includes('support requested')) return 'support'
  if (type.includes('PAYOUT') || type.includes('PAYMENT') || type.includes('REFUND') || type.includes('SETTLEMENT')) return 'money'
  if (type.includes('VERIFICATION') || type.includes('TRUST') || type.includes('SAFETY') || type.includes('BYPASS')) return 'trust'
  if (type.includes('DELIVERY') || type.includes('DISPATCH') || type.includes('FULFILLMENT')) return 'delivery'
  if (type.includes('INCIDENT') || type.includes('PROVIDER') || type.includes('WEBHOOK') || type.includes('JOB')) return 'reliability'
  if (type.includes('DELETE') || type.includes('PRIVACY')) return 'privacy'
  return 'operations'
}

function normalizedQueueKey(value: string | null | undefined, issueType: string, source?: string | null, title?: string | null) {
  if (source?.toLowerCase() === 'account-support-action' || issueType.toUpperCase() === 'AFTERCARE_REQUEST' || title?.toLowerCase().includes('support requested')) return 'support'
  if (issueType.toUpperCase() === 'CONTENT_FLAG') return 'trust'
  switch (value?.trim().toLowerCase()) {
    case 'privacy-deletion': return 'privacy'
    case 'trust-safety': return 'trust'
    case 'money-desk': return 'money'
    case 'delivery-supply': return 'delivery'
    case 'reliability': return 'reliability'
    case 'operations': return 'operations'
    default: return queueForIssue(issueType, source, title)
  }
}

function displayCaseNumber(issueNumber: number) {
  return `OPS-${String(issueNumber).padStart(6, '0')}`
}

function metadataString(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function deletionFacts(request: CanonicalDeletionRow, displayName: string, accountEmail: string | null) {
  return [
    { label: 'Request ID', value: request.id },
    { label: 'Account', value: displayName },
    { label: 'Account email', value: accountEmail ?? 'Not available' },
    { label: 'Account role', value: formatEnum(request.role) },
    { label: 'Requested', value: new Date(request.requested_at).toLocaleString() },
    { label: 'Acknowledged', value: request.acknowledged_at ? new Date(request.acknowledged_at).toLocaleString() : 'Not yet' },
    { label: 'Processed', value: request.processed_at ? new Date(request.processed_at).toLocaleString() : 'Not yet' },
    { label: 'Source', value: metadataString(request.metadata, 'source') ?? 'Drapeon account settings' },
  ]
}

export function buildOpsWorkItems(data: CanonicalOpsData): OpsWorkItem[] {
  const auditsByIssue = new Map<string, OpsCaseHistoryEntry[]>()
  for (const audit of data.audits) {
    const history = auditsByIssue.get(audit.issue_id) ?? []
    history.push({
      id: audit.id,
      actionTaken: audit.action_taken,
      performedBy: audit.performed_by,
      performedRole: audit.performed_role,
      reason: audit.reason,
      createdAt: audit.created_at,
    })
    auditsByIssue.set(audit.issue_id, history)
  }

  for (const event of data.events) {
    const history = auditsByIssue.get(event.issue_id) ?? []
    history.push({
      id: event.id,
      actionTaken: event.event_type,
      performedBy: event.actor_label,
      performedRole: null,
      reason: event.summary,
      createdAt: event.occurred_at,
    })
    auditsByIssue.set(event.issue_id, history)
  }

  for (const history of auditsByIssue.values()) {
    history.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  }

  const receiptsByIssue = new Map<string, OpsActionReceipt[]>()
  for (const receipt of data.receipts) {
    const receipts = receiptsByIssue.get(receipt.issue_id) ?? []
    receipts.push({
      id: receipt.id,
      actionKey: receipt.action_key,
      outcome: receipt.outcome,
      humanStatus: receipt.human_status,
      correlationId: receipt.correlation_id,
      persistedAt: receipt.persisted_at,
      completedAt: receipt.completed_at,
      sideEffectCount: receipt.side_effects.length,
      blockerCount: receipt.blockers.length,
      nextAction: receipt.next_action,
      failureCode: receipt.failure_code,
    })
    receiptsByIssue.set(receipt.issue_id, receipts)
  }

  const userById = new Map(data.users.map((user) => [user.id, user]))
  const policyByQueue = new Map(
    data.policies.map((policy) => [normalizedQueueKey(policy.queue_key, ''), policy])
  )
  const deletionById = new Map(data.deletions.map((request) => [request.id, request]))
  const representedDeletionIds = new Set<string>()
  const items: OpsWorkItem[] = data.issues.map((issue) => {
    const deletion = issue.related_entity_type === 'account_deletion_request' && issue.related_entity_id
      ? deletionById.get(issue.related_entity_id)
      : undefined
    const user = deletion ? userById.get(deletion.user_id) : undefined
    if (deletion) representedDeletionIds.add(deletion.id)
    const queueKey = normalizedQueueKey(issue.queue_key, issue.issue_type, issue.source, issue.title)
    const policy = policyByQueue.get(queueKey) ?? policyByQueue.get(issue.queue_key ?? '')
    const caseNumber = issue.case_number ?? displayCaseNumber(issue.issue_number)
    const history = auditsByIssue.get(issue.id) ?? []
    const slaPhase = issue.first_responded_at ? 'ACTIVE_RESOLUTION' : 'FIRST_RESPONSE'
    const slaDueAt = slaPhase === 'FIRST_RESPONSE'
      ? issue.first_response_due_at ?? issue.active_resolution_due_at ?? null
      : issue.active_resolution_due_at ?? null

    if (deletion) {
      const displayName = user?.display_name ?? deletion.email ?? 'Account owner'
      return {
        id: issue.id,
        caseNumber,
        caseType: 'ACCOUNT_DELETION_REQUEST',
        queueKey: 'privacy',
        title: `Deletion request · ${displayName}`,
        summary: deletion.reason ?? 'Account owner requested deletion.',
        severity: normalizedSeverity(issue.severity),
        priority: issue.priority ?? 'P3',
        status: issue.canonical_status ?? deletion.status,
        context: `${formatEnum(deletion.role)} account`,
        waitingReason: deletion.status === 'PENDING' ? 'Awaiting privacy review' : metadataString(issue.metadata, 'blockedReasonCode'),
        recommendedAction: issue.recommended_action,
        assignee: issue.assigned_to,
        ownerTeam: issue.owning_team ?? policy?.primary_team ?? null,
        backupTeam: policy?.backup_team ?? null,
        permittedRoles: policy?.permitted_roles ?? [],
        permittedActions: policy?.permitted_actions ?? [],
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        slaDueAt,
        slaPhase,
        slaPaused: Boolean(issue.sla_clock_paused_at),
        slaPolicyVersion: issue.sla_policy_version ?? policy?.version ?? null,
        runbookPath: policy?.runbook_path ?? null,
        history,
        receipts: receiptsByIssue.get(issue.id) ?? [],
        sourceHref: deletion.role.toUpperCase() === 'TAILOR'
          ? issue.tailor_profile_id
            ? `/ops/tailors/${encodeURIComponent(issue.tailor_profile_id)}`
            : '/ops/tailors'
          : `/ops/customers/${encodeURIComponent(deletion.user_id)}`,
        facts: deletionFacts(deletion, displayName, user?.email ?? deletion.email),
        environment: issueEnvironment(issue.environment),
        sensitivity: 'HIGHLY_RESTRICTED',
        recordVersion: issue.record_version ?? null,
        relatedEntityType: issue.related_entity_type,
        relatedEntityId: deletion.id,
        userId: deletion.user_id,
        tailorProfileId: issue.tailor_profile_id,
        orderId: issue.order_id,
        source: issue.source,
        provider: issue.provider,
        metadata: issue.metadata,
      }
    }

    return {
      id: issue.id,
      caseNumber,
      caseType: issue.issue_type,
      queueKey,
      title: issue.title,
      summary: issue.description,
      severity: normalizedSeverity(issue.severity),
      priority: issue.priority ?? 'P3',
      status: issue.canonical_status ?? issue.status,
      context: issue.order_id ? `Order ${issue.order_id}` : issue.related_entity_type ?? 'Workflow',
      waitingReason: metadataString(issue.metadata, 'blockedReasonCode') ?? metadataString(issue.metadata, 'reason'),
      recommendedAction: issue.recommended_action,
      assignee: issue.assigned_to,
      ownerTeam: issue.owning_team ?? policy?.primary_team ?? null,
      backupTeam: policy?.backup_team ?? null,
      permittedRoles: policy?.permitted_roles ?? [],
      permittedActions: policy?.permitted_actions ?? [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      slaDueAt,
      slaPhase,
      slaPaused: Boolean(issue.sla_clock_paused_at),
      slaPolicyVersion: issue.sla_policy_version ?? policy?.version ?? null,
      runbookPath: policy?.runbook_path ?? null,
      history,
      receipts: receiptsByIssue.get(issue.id) ?? [],
      sourceHref: issue.order_id ? `/ops/orders/${encodeURIComponent(issue.order_id)}` : null,
      facts: [
        { label: 'Source', value: issue.source ?? 'Workflow ledger' },
        { label: 'Provider', value: issue.provider ?? 'Not applicable' },
        { label: 'Record version', value: issue.record_version ? String(issue.record_version) : 'Not migrated' },
      ],
      environment: issueEnvironment(issue.environment),
      sensitivity: normalizedSensitivity(issue.sensitivity),
      recordVersion: issue.record_version ?? null,
      relatedEntityType: issue.related_entity_type,
      relatedEntityId: issue.related_entity_id,
      userId: issue.user_id,
      tailorProfileId: issue.tailor_profile_id,
      orderId: issue.order_id,
      source: issue.source,
      provider: issue.provider,
      metadata: issue.metadata,
    }
  })

  for (const request of data.deletions) {
    if (representedDeletionIds.has(request.id)) continue
    const user = userById.get(request.user_id)
    const displayName = user?.display_name ?? request.email ?? 'Account owner'
    items.push({
      id: request.id,
      caseNumber: `DEL-${request.id.slice(0, 8).toUpperCase()}`,
      caseType: 'ACCOUNT_DELETION_REQUEST',
      queueKey: 'privacy',
      title: `Deletion request · ${displayName}`,
      summary: request.reason ?? 'Account owner requested deletion.',
      severity: 'HIGH',
      priority: 'P2',
      status: request.status,
      context: `${formatEnum(request.role)} account`,
      waitingReason: 'Case projection pending',
      recommendedAction: 'Repair the missing case projection before making an irreversible decision.',
      assignee: null,
      ownerTeam: 'customer_success',
      backupTeam: 'admin',
      permittedRoles: [],
      permittedActions: [],
      createdAt: request.requested_at,
      updatedAt: request.processed_at ?? request.acknowledged_at ?? request.requested_at,
      slaDueAt: null,
      slaPhase: 'FIRST_RESPONSE',
      slaPaused: false,
      slaPolicyVersion: null,
      runbookPath: '/ops/knowledge#privacy',
      history: [],
      receipts: [],
      sourceHref: request.role.toUpperCase() === 'TAILOR'
        ? '/ops/tailors'
        : `/ops/customers/${encodeURIComponent(request.user_id)}`,
      facts: deletionFacts(request, displayName, user?.email ?? request.email),
      environment: runtimeEnvironment(),
      sensitivity: 'HIGHLY_RESTRICTED',
      recordVersion: null,
      relatedEntityType: 'account_deletion_request',
      relatedEntityId: request.id,
      userId: request.user_id,
      tailorProfileId: null,
      orderId: null,
      source: 'account_deletion_requests',
      provider: null,
      metadata: request.metadata,
    })
  }

  return items.sort((left, right) => {
    const priorityDifference = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9)
    if (priorityDifference !== 0) return priorityDifference
    const severityDifference = (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9)
    if (severityDifference !== 0) return severityDifference
    const leftDue = left.slaDueAt ? new Date(left.slaDueAt).getTime() : Number.POSITIVE_INFINITY
    const rightDue = right.slaDueAt ? new Date(right.slaDueAt).getTime() : Number.POSITIVE_INFINITY
    if (leftDue !== rightDue) return leftDue - rightDue
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })
}

export function formatEnum(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function formatRelativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const absolute = Math.abs(seconds)
  if (absolute < 60) return seconds < 0 ? 'just now' : 'in under a minute'
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 48) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(hours, 'hour')
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value))
}

export function formatSla(value: string | null, paused = false) {
  if (!value) return { overdue: false, label: 'Not migrated' }
  if (paused) return { overdue: false, label: 'Paused' }
  const milliseconds = new Date(value).getTime() - Date.now()
  const overdue = milliseconds < 0
  const minutes = Math.max(1, Math.round(Math.abs(milliseconds) / 60000))
  const label = minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / 1440)}d`
  return { overdue, label: overdue ? `${label} overdue` : `${label} left` }
}

export function runtimeContract(canonicalColumnsAvailable = false) {
  const currentEnvironment = runtimeEnvironment()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  let projectRef = 'unavailable'
  try { projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? 'unavailable' } catch { /* display fail-closed state */ }
  const hash = projectRef === 'unavailable' ? projectRef : `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`
  return {
    environment: currentEnvironment,
    release: process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8) ?? process.env.GIT_COMMIT_SHA?.slice(0, 8) ?? 'local',
    projectRef: hash,
    accessMode: process.env.CF_ACCESS_AUD ? 'Cloudflare Access' : 'Local workforce dry run',
    sensitiveAccess: process.env.CF_ACCESS_SENSITIVE_AUD ? 'Configured' : currentEnvironment === 'production' ? 'Missing · protected actions locked' : 'Local dry run',
    databaseAuthority: canonicalColumnsAvailable
      ? 'Canonical environment-scoped read'
      : currentEnvironment === 'production'
        ? 'Unavailable · production fails closed'
        : 'Development-only legacy bridge · migration pending',
    communications: currentEnvironment === 'production' ? 'Production providers' : 'Development sinks',
  }
}

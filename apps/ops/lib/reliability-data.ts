import 'server-only'

import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type ServiceIncident = {
  id: string
  incidentKey: string
  title: string
  summary: string
  severity: string
  status: string
  affectedServices: string[]
  publicVisible: boolean
  acknowledgementRequired: boolean
  source: string
  sourceReference: string | null
  startedAt: string
  resolvedAt: string | null
  updatedAt: string
  lastObservedAt: string | null
  runbookUrl: string | null
  correlationId: string
  acknowledgedAt: string | null
  snoozedUntil: string | null
  snoozeReason: string | null
}

export type ProviderLane = {
  provider: string
  operation: string
  status: string
  failureCount: number
  circuitOpenUntil: string | null
  hasRecordedError: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  updatedAt: string | null
}

export type MonitorState = {
  id: string
  monitorKey: string
  targetId: string
  targetName: string
  healthy: boolean
  severity: string
  httpStatus: number
  latencyMs: number
  detail: string
  checkedAt: string
  lastTransitionAt: string
  slackDeliveredAt: string | null
}

export type JobQueueHealth = {
  pending: number
  retryable: number
  processing: number
  dead: number
  oldestPendingAt: string | null
  oldestProcessingAt: string | null
}

export type JobQueueItem = {
  id: string
  type: string
  status: string
  attempts: number
  maxAttempts: number
  runAt: string
  createdAt: string
  updatedAt: string
  linkedCaseNumber: string | null
  linkedCaseStatus: string | null
}

export type ReliabilityData = {
  incidents: ServiceIncident[]
  providers: ProviderLane[]
  monitors: MonitorState[]
  jobs: JobQueueHealth
  jobItems: JobQueueItem[]
  observedAt: string
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function environment() {
  return process.env.DRAPE_OPS_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production'
    ? 'PRODUCTION'
    : 'DEVELOPMENT'
}

export async function loadReliabilityData(): Promise<ReliabilityData> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<ReliabilityData>('reliability')
  const client = createServiceRoleClient()
  if (!client) throw new Error('Reliability data is unavailable because the server database client is not configured.')

  const [incidentResult, providerResult, jobResult, monitorResult, jobItemsResult, jobCasesResult] = await Promise.all([
    client
      .from('service_incidents')
      .select('id,incident_key,title,summary,severity,status,affected_services,public_visible,acknowledgement_required,source,source_reference,started_at,resolved_at,updated_at,last_observed_at,runbook_url,correlation_id,acknowledged_at,snoozed_until,snooze_reason')
      .eq('environment', environment())
      .order('updated_at', { ascending: false })
      .limit(100),
    client.rpc('get_provider_health'),
    client.rpc('get_job_queue_health'),
    client
      .from('ops_monitor_state')
      .select('id,monitor_key,target_id,target_name,healthy,severity,http_status,latency_ms,detail,checked_at,last_transition_at,slack_delivery')
      .eq('environment', environment())
      .order('checked_at', { ascending: false })
      .limit(24),
    client
      .from('job_queue')
      .select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at')
      .in('status', ['PENDING', 'RETRYABLE', 'PROCESSING', 'DEAD'])
      .order('updated_at', { ascending: false })
      .limit(200),
    client
      .from('ops_issues')
      .select('case_number,issue_number,canonical_status,status,related_entity_id,updated_at')
      .eq('related_entity_type', 'job_queue')
      .eq('environment', environment())
      .order('updated_at', { ascending: false })
      .limit(1000),
  ])

  if (incidentResult.error) throw new Error(`Incident ledger is unavailable: ${incidentResult.error.message}`)
  if (providerResult.error) throw new Error(`Provider health is unavailable: ${providerResult.error.message}`)
  if (jobResult.error) throw new Error(`Job queue health is unavailable: ${jobResult.error.message}`)
  if (monitorResult.error) throw new Error(`Synthetic monitor state is unavailable: ${monitorResult.error.message}`)
  if (jobItemsResult.error) throw new Error(`Job queue source records are unavailable: ${jobItemsResult.error.message}`)
  if (jobCasesResult.error) throw new Error(`Job recovery cases are unavailable: ${jobCasesResult.error.message}`)

  const providerRows = Array.isArray(providerResult.data) ? providerResult.data as Array<Record<string, unknown>> : []
  const job = jobResult.data && typeof jobResult.data === 'object' ? jobResult.data as Record<string, unknown> : {}
  const statusCounts = job.statusCounts && typeof job.statusCounts === 'object' ? job.statusCounts as Record<string, unknown> : {}
  const casesByJobId = new Map<string, Record<string, unknown>>()
  for (const issue of jobCasesResult.data ?? []) {
    const jobId = String(issue.related_entity_id ?? '')
    if (jobId && !casesByJobId.has(jobId)) casesByJobId.set(jobId, issue)
  }

  return {
    incidents: (incidentResult.data ?? []).map((row) => ({
      id: String(row.id),
      incidentKey: String(row.incident_key),
      title: String(row.title),
      summary: String(row.summary),
      severity: String(row.severity),
      status: String(row.status),
      affectedServices: Array.isArray(row.affected_services) ? row.affected_services.map(String) : [],
      publicVisible: row.public_visible === true,
      acknowledgementRequired: row.acknowledgement_required === true,
      source: String(row.source),
      sourceReference: stringValue(row.source_reference),
      startedAt: String(row.started_at),
      resolvedAt: stringValue(row.resolved_at),
      updatedAt: String(row.updated_at),
      lastObservedAt: stringValue(row.last_observed_at),
      runbookUrl: stringValue(row.runbook_url),
      correlationId: String(row.correlation_id),
      acknowledgedAt: stringValue(row.acknowledged_at),
      snoozedUntil: stringValue(row.snoozed_until),
      snoozeReason: stringValue(row.snooze_reason),
    })),
    providers: providerRows.map((row) => ({
      provider: stringValue(row.provider) ?? 'UNKNOWN',
      operation: stringValue(row.operation) ?? 'GENERAL',
      status: stringValue(row.status) ?? 'UNKNOWN',
      failureCount: numberValue(row.failureCount),
      circuitOpenUntil: stringValue(row.circuitOpenUntil),
      hasRecordedError: Boolean(stringValue(row.lastError)),
      lastSuccessAt: stringValue(row.lastSuccessAt),
      lastFailureAt: stringValue(row.lastFailureAt),
      updatedAt: stringValue(row.updatedAt),
    })),
    monitors: (monitorResult.data ?? []).map((row) => {
      const slack = row.slack_delivery && typeof row.slack_delivery === 'object' ? row.slack_delivery as Record<string, unknown> : null
      return {
        id: String(row.id),
        monitorKey: String(row.monitor_key),
        targetId: String(row.target_id),
        targetName: String(row.target_name),
        healthy: row.healthy === true,
        severity: String(row.severity),
        httpStatus: numberValue(row.http_status),
        latencyMs: numberValue(row.latency_ms),
        detail: String(row.detail),
        checkedAt: String(row.checked_at),
        lastTransitionAt: String(row.last_transition_at),
        slackDeliveredAt: stringValue(slack?.deliveredAt),
      }
    }),
    jobs: {
      pending: numberValue(statusCounts.PENDING),
      retryable: numberValue(job.retryableCount),
      processing: numberValue(statusCounts.PROCESSING),
      dead: numberValue(job.deadCount),
      oldestPendingAt: stringValue(job.oldestPendingAt),
      oldestProcessingAt: stringValue(job.oldestProcessingAt),
    },
    jobItems: (jobItemsResult.data ?? []).map((row) => {
      const issue = casesByJobId.get(String(row.id))
      return {
        id: String(row.id),
        type: String(row.job_type),
        status: String(row.status),
        attempts: numberValue(row.attempt_count),
        maxAttempts: numberValue(row.max_attempts),
        runAt: String(row.run_at),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        linkedCaseNumber: issue ? (stringValue(issue.case_number) ?? `OPS-${String(numberValue(issue.issue_number)).padStart(6, '0')}`) : null,
        linkedCaseStatus: issue ? (stringValue(issue.canonical_status) ?? stringValue(issue.status)) : null,
      }
    }),
    observedAt: new Date().toISOString(),
  }
}

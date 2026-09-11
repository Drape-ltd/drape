export type OpsMetricKey =
  | 'ops.open_cases'
  | 'ops.urgent_cases'
  | 'ops.unassigned_cases'
  | 'ops.sla_breached'
  | 'ops.sla_first_response_breached'
  | 'ops.sla_resolution_breached'
  | 'ops.critical_incidents'
  | 'ops.monitor_freshness'
  | 'ops.provider_degraded_lanes'
  | 'ops.jobs_pending_retryable_dead'
  | 'ops.communication_terminal_outcomes'
  | 'ops.money_pending_approval'
  | 'ops.money_execution_work'
  | 'ops.tailor_readiness'
  | 'ops.vision_outcomes'

export type OpsMetricDefinition = {
  key: OpsMetricKey
  label: string
  definition: string
  eligibility: string
  sourceGrain: string
  sourceWatermark: string
  owner: 'admin' | 'engineering' | 'finance' | 'ops' | 'trust' | 'customer_success'
  sensitivity: 'INTERNAL' | 'SENSITIVE'
  freshness: 'REQUEST_TIME' | 'SYNTHETIC_INTERVAL' | 'PROVIDER_CALLBACK'
  cachePolicy: 'PRIVATE_NO_STORE'
  dimensions: readonly string[]
  rollupGrains: readonly ('HOUR' | 'DAY')[]
  lateCorrectionHours: number
  drillDownHref: string
  emptyState: 'No eligible production data yet'
}

const metric = (definition: Omit<OpsMetricDefinition, 'emptyState' | 'cachePolicy'>): OpsMetricDefinition => ({
  ...definition,
  cachePolicy: 'PRIVATE_NO_STORE',
  emptyState: 'No eligible production data yet',
})

export const OPS_METRIC_CATALOGUE: Readonly<Record<OpsMetricKey, OpsMetricDefinition>> = Object.freeze({
  'ops.open_cases': metric({ key: 'ops.open_cases', label: 'Open cases', definition: 'Cases not resolved, closed, or cancelled in the current environment.', eligibility: 'Current canonical case envelope with a non-terminal status.', sourceGrain: 'ops_issues · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'priority', 'canonical_status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all' }),
  'ops.urgent_cases': metric({ key: 'ops.urgent_cases', label: 'P0 or P1', definition: 'Open canonical cases carrying P0 or P1 priority.', eligibility: 'Open case whose priority is P0 or P1.', sourceGrain: 'ops_issues · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'priority'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all?priority=critical' }),
  'ops.unassigned_cases': metric({ key: 'ops.unassigned_cases', label: 'Unassigned', definition: 'Open canonical cases without a named workforce assignee.', eligibility: 'Open case with no assigned principal or assignee label.', sourceGrain: 'ops_issues · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'priority'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all?scope=unassigned' }),
  'ops.sla_breached': metric({ key: 'ops.sla_breached', label: 'SLA breached', definition: 'Distinct open cases breaching either the first-response or active-resolution clock.', eligibility: 'Open, unpaused case whose applicable canonical due time has elapsed.', sourceGrain: 'ops_issues + ops_queue_policies · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'sla_phase', 'priority'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all?scope=overdue' }),
  'ops.sla_first_response_breached': metric({ key: 'ops.sla_first_response_breached', label: 'First response breached', definition: 'Open cases with no recorded first response whose first-response deadline elapsed.', eligibility: 'Open case, first_responded_at is null, first_response_due_at is in the past, and the clock is not paused.', sourceGrain: 'ops_issues + ops_queue_policies · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'priority'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all?scope=overdue&phase=first-response' }),
  'ops.sla_resolution_breached': metric({ key: 'ops.sla_resolution_breached', label: 'Resolution breached', definition: 'Active cases whose active-resolution deadline elapsed while the SLA clock was running.', eligibility: 'Open case with a first response, an elapsed active_resolution_due_at, and no paused clock.', sourceGrain: 'ops_issues + ops_queue_policies · current case', sourceWatermark: 'ops_issues.updated_at', owner: 'ops', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['queue_key', 'priority'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 48, drillDownHref: '/ops/queues/all?scope=overdue&phase=resolution' }),
  'ops.critical_incidents': metric({ key: 'ops.critical_incidents', label: 'Critical incidents', definition: 'Non-resolved critical service incidents in the current environment.', eligibility: 'Durable service incident with CRITICAL severity and non-terminal status.', sourceGrain: 'service_incidents · incident', sourceWatermark: 'service_incidents.updated_at', owner: 'engineering', sensitivity: 'INTERNAL', freshness: 'SYNTHETIC_INTERVAL', dimensions: ['service', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 24, drillDownHref: '/ops/incidents?scope=critical#incident-ledger' }),
  'ops.monitor_freshness': metric({ key: 'ops.monitor_freshness', label: 'Monitor freshness', definition: 'Age of the latest environment-bound durable synthetic observation.', eligibility: 'Latest observation per configured monitor target; missing state is not healthy.', sourceGrain: 'ops_monitor_state · target', sourceWatermark: 'ops_monitor_state.last_checked_at', owner: 'engineering', sensitivity: 'INTERNAL', freshness: 'SYNTHETIC_INTERVAL', dimensions: ['target_key', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 24, drillDownHref: '/ops/providers#synthetic-paths' }),
  'ops.provider_degraded_lanes': metric({ key: 'ops.provider_degraded_lanes', label: 'Degraded provider lanes', definition: 'Provider-operation circuits that are not healthy, closed, or OK.', eligibility: 'Current provider-operation circuit in a degraded, open, or unavailable state.', sourceGrain: 'provider circuit projection · operation lane', sourceWatermark: 'provider circuit checked_at', owner: 'engineering', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['provider', 'operation', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 24, drillDownHref: '/ops/providers?providerState=degraded#provider-lanes' }),
  'ops.jobs_pending_retryable_dead': metric({ key: 'ops.jobs_pending_retryable_dead', label: 'Job recovery state', definition: 'Queue work separated into pending, retryable, and terminal dead-letter states.', eligibility: 'Bounded job queue records in a non-success terminal or recovery state.', sourceGrain: 'job_queue · job', sourceWatermark: 'job_queue.updated_at', owner: 'engineering', sensitivity: 'INTERNAL', freshness: 'REQUEST_TIME', dimensions: ['job_type', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/providers#job-ledger' }),
  'ops.communication_terminal_outcomes': metric({ key: 'ops.communication_terminal_outcomes', label: 'Campaign delivery outcomes', definition: 'Campaign recipient totals with recorded delivered and failed or dead outcomes.', eligibility: 'Campaign recipient whose durable status is represented in the bounded campaign ledger.', sourceGrain: 'communication_campaign_recipients · recipient', sourceWatermark: 'communication_campaign_recipients.updated_at', owner: 'customer_success', sensitivity: 'SENSITIVE', freshness: 'PROVIDER_CALLBACK', dimensions: ['campaign', 'outcome'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/communications#campaign-ledger' }),
  'ops.money_pending_approval': metric({ key: 'ops.money_pending_approval', label: 'Awaiting approval', definition: 'Manual Money Desk requests in PENDING_APPROVAL.', eligibility: 'Current money request requiring an independent checker decision.', sourceGrain: 'money_desk_requests · request', sourceWatermark: 'money_desk_requests.updated_at', owner: 'finance', sensitivity: 'SENSITIVE', freshness: 'REQUEST_TIME', dimensions: ['request_type', 'currency', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/money?view=approval#money-request-ledger' }),
  'ops.money_execution_work': metric({ key: 'ops.money_execution_work', label: 'Execution work', definition: 'Approved, executing, or failed manual Money Desk requests.', eligibility: 'Current money request whose status is APPROVED, EXECUTING, or FAILED and therefore requires execution, provider confirmation, or recovery.', sourceGrain: 'money_desk_requests · request', sourceWatermark: 'money_desk_requests.updated_at', owner: 'finance', sensitivity: 'SENSITIVE', freshness: 'REQUEST_TIME', dimensions: ['request_type', 'provider', 'status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/money?view=execution#money-request-ledger' }),
  'ops.tailor_readiness': metric({ key: 'ops.tailor_readiness', label: 'Tailor readiness', definition: 'Trust, profile, marketplace, payout, availability, and shop readiness shown as independent states.', eligibility: 'Tailor profile in the current environment; no state implies another state is complete.', sourceGrain: 'tailor profile/application/item · tailor', sourceWatermark: 'tailor_profiles.updated_at', owner: 'trust', sensitivity: 'SENSITIVE', freshness: 'REQUEST_TIME', dimensions: ['trust_status', 'marketplace_status', 'payout_status'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/tailors#tailor-roster' }),
  'ops.vision_outcomes': metric({ key: 'ops.vision_outcomes', label: 'Vision outcomes', definition: 'Saved scans, explicit review requirements, and completed or failed capture sessions.', eligibility: 'Purpose-limited Vision scan/session metadata; body values and frames are excluded.', sourceGrain: 'vision scan/session · capture session', sourceWatermark: 'vision capture session updated_at', owner: 'ops', sensitivity: 'SENSITIVE', freshness: 'REQUEST_TIME', dimensions: ['status', 'review_required', 'platform'], rollupGrains: ['HOUR', 'DAY'], lateCorrectionHours: 72, drillDownHref: '/ops/vision#session-ledger' }),
})

export function getOpsMetricDefinition(key: OpsMetricKey) {
  return OPS_METRIC_CATALOGUE[key]
}

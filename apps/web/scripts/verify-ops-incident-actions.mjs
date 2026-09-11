import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !serviceRoleKey || !url.includes('pqptfuqogvrajozfsqzi')) {
  throw new Error('This proof may run only against the explicit Drape-DEV project.')
}

const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const monitorKey = 'ops-ingest-validation'
const targetId = 'dev-ready-validation'
const incidentKey = `synthetic:${monitorKey}:${targetId}`

async function rpc(name, parameters) {
  const result = await client.rpc(name, parameters)
  if (result.error) throw new Error(`${name}: ${result.error.code ?? 'ERROR'} ${result.error.message}`)
  return result.data
}

const principalResult = await client
  .from('ops_workforce_principals')
  .select('id,roles,permitted_environments')
  .eq('status', 'ACTIVE')
const principal = (principalResult.data ?? []).find((row) =>
  row.permitted_environments?.includes('development')
  && row.roles?.some((role) => ['admin', 'ops', 'engineering'].includes(role)),
)
if (principalResult.error) throw principalResult.error
if (!principal) throw new Error('No active named Drape-DEV incident-command principal is available.')

const currentMonitorResult = await client
  .from('ops_monitor_state')
  .select('checked_at')
  .eq('environment', 'DEVELOPMENT')
  .eq('monitor_key', monitorKey)
  .eq('target_id', targetId)
  .maybeSingle()
if (currentMonitorResult.error) throw currentMonitorResult.error
const previousCheckedAt = currentMonitorResult.data?.checked_at ? Date.parse(currentMonitorResult.data.checked_at) : 0
const checkedAt = new Date(Math.max(Date.now(), previousCheckedAt + 5_000))

async function ingest(healthy, offsetSeconds) {
  const at = new Date(checkedAt.getTime() + offsetSeconds * 1000).toISOString()
  return rpc('ingest_ops_health_monitor_state', {
    p_environment: 'DEVELOPMENT',
    p_monitor_key: monitorKey,
    p_target_id: targetId,
    p_target_name: 'Drape DEV monitor ingest validation',
    p_healthy: healthy,
    p_severity: healthy ? 'OK' : 'WARNING',
    p_fingerprint: healthy ? `phase3-recovery-${checkedAt.getTime()}` : `phase3-degraded-${checkedAt.getTime()}`,
    p_http_status: healthy ? 200 : 503,
    p_latency_ms: healthy ? 71 : 1_250,
    p_detail: healthy ? 'Intentional Drape-DEV incident-command recovery proof.' : 'Intentional Drape-DEV incident-command degraded proof.',
    p_result_payload: { id: targetId, proof: 'incident-command', ok: healthy },
    p_slack_delivery: null,
    p_checked_at: at,
    p_source_reference: 'dev://phase-3-incident-command-proof',
    p_runbook_url: 'https://docs.drapeon.internal/runbooks/health-monitor',
    p_correlation_id: randomUUID(),
  })
}

const degraded = await ingest(false, 0)
const issueResult = await client
  .from('ops_issues')
  .select('id,record_version')
  .eq('related_entity_type', 'service_incident')
  .eq('related_entity_id', degraded.incidentId)
  .eq('environment', 'DEVELOPMENT')
  .single()
if (issueResult.error) throw issueResult.error

const acknowledge = await rpc('perform_ops_incident_action', {
  p_incident_id: degraded.incidentId,
  p_action: 'ACKNOWLEDGE',
  p_reason: '',
  p_snooze_until: null,
  p_expected_record_version: issueResult.data.record_version,
  p_idempotency_key: `incident-ack-${randomUUID()}`,
  p_actor_principal_id: principal.id,
  p_actor_label: 'named-development-operator',
  p_environment: 'DEVELOPMENT',
  p_correlation_id: randomUUID(),
})

const snooze = await rpc('perform_ops_incident_action', {
  p_incident_id: degraded.incidentId,
  p_action: 'SNOOZE',
  p_reason: 'Bounded Drape-DEV follow-up proof after acknowledgement.',
  p_snooze_until: new Date(checkedAt.getTime() + 30 * 60_000).toISOString(),
  p_expected_record_version: acknowledge.recordVersion,
  p_idempotency_key: `incident-snooze-${randomUUID()}`,
  p_actor_principal_id: principal.id,
  p_actor_label: 'named-development-operator',
  p_environment: 'DEVELOPMENT',
  p_correlation_id: randomUUID(),
})

const recovered = await ingest(true, 120)
const duplicateReplay = await ingest(true, 120)
let staleReplayRejected = false
try {
  await ingest(false, 60)
} catch (error) {
  staleReplayRejected = String(error).includes('STALE_MONITOR_OBSERVATION')
  if (!staleReplayRejected) throw error
}
const finalResult = await client
  .from('service_incidents')
  .select('id,status,acknowledgement_required,acknowledged_at,snoozed_until,resolved_at')
  .eq('incident_key', incidentKey)
  .single()
if (finalResult.error) throw finalResult.error

const receiptResult = await client
  .from('ops_action_receipts')
  .select('id,action_key,outcome,correlation_id')
  .eq('issue_id', issueResult.data.id)
  .in('id', [acknowledge.receiptId, snooze.receiptId])
if (receiptResult.error) throw receiptResult.error

console.log(JSON.stringify({
  degradedTransition: degraded.transition,
  acknowledgeStatus: acknowledge.incidentStatus,
  snoozeStatus: snooze.incidentStatus,
  recoveredTransition: recovered.transition,
  duplicateReplay: duplicateReplay.duplicate === true && duplicateReplay.transition === 'NONE',
  staleReplayRejected,
  finalIncident: finalResult.data,
  receipts: receiptResult.data,
}, null, 2))

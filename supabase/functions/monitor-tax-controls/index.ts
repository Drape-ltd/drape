import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { Sentry } from '../_shared/sentry.ts'

const FN = 'monitor-tax-controls'
const REVIEW_WARNING_DAYS = 30

type ReviewedControl = {
  control_type: string
  control_id: string
  policy_version: string | null
  review_due_at: string
  correlation_id: string | null
}

function reviewHealth(reviewDueAt: string, now = Date.now()) {
  const due = new Date(reviewDueAt).getTime()
  if (!Number.isFinite(due)) return 'EXPIRED'
  if (due <= now) return 'EXPIRED'
  if (due <= now + REVIEW_WARNING_DAYS * 24 * 60 * 60 * 1_000) return 'REVIEW_DUE'
  return 'HEALTHY'
}

async function loadReviewedControlDeadlines(supabase: any): Promise<ReviewedControl[]> {
  const sources = [
    { table: 'tax_policy_versions', type: 'POLICY', id: 'policy_version', policy: 'policy_version', correlation: null, hasStatus: true },
    { table: 'tax_registration_controls', type: 'REGISTRATION', id: 'id', policy: 'policy_version', correlation: null, hasStatus: true },
    { table: 'tax_responsibility_controls', type: 'RESPONSIBILITY', id: 'id', policy: 'policy_version', correlation: null, hasStatus: true },
    { table: 'tax_corridor_controls', type: 'CORRIDOR', id: 'id', policy: 'policy_version', correlation: null, hasStatus: true },
    { table: 'tax_line_classification_controls', type: 'LINE_CLASSIFICATION', id: 'id', policy: null, correlation: null, hasStatus: false },
    { table: 'tax_registration_facts', type: 'REGISTRATION_FACT', id: 'id', policy: null, correlation: null, hasStatus: false },
  ] as const
  const rows: ReviewedControl[] = []
  for (const source of sources) {
    const columns = [source.id, source.policy, source.correlation, 'review_due_at', source.hasStatus ? 'status' : null]
      .filter((value): value is string => Boolean(value))
    const { data, error } = await supabase.from(source.table).select([...new Set(columns)].join(','))
    if (error) throw error
    for (const row of data ?? []) {
      if ('status' in row && !['APPROVED', 'ACTIVE'].includes(row.status)) continue
      rows.push({
        control_type: source.type,
        control_id: String(row[source.id]),
        policy_version: source.policy ? String(row[source.policy]) : null,
        review_due_at: String(row.review_due_at),
        correlation_id: source.correlation ? String(row[source.correlation]) : null,
      })
    }
  }
  return rows
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data, error } = await supabase.from('tax_control_health')
      .select('activation_id,environment,policy_version,jurisdiction_country_code,origin_country_code,destination_country_code,tax_transaction_type,fulfillment_classification,review_due_at,health_status,affected_open_reservations,correlation_id')
    if (error) throw error
    let alerted = 0
    for (const row of data ?? []) {
      const dedupeKey = `tax-control:${row.activation_id}`
      if (row.health_status === 'HEALTHY' || row.health_status === 'DISABLED') {
        await resolveOpsIssueByDedupeKey(supabase, dedupeKey, { recoveredBy: FN, healthStatus: row.health_status })
        continue
      }
      alerted += 1
      const expired = row.health_status === 'EXPIRED'
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: expired ? 'CRITICAL' : 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        title: expired ? 'Tax control review expired' : 'Tax control review due soon',
        description: expired
          ? 'New pricing for this exact activated scope is blocked. Existing accepted tax snapshots remain unchanged.'
          : 'The reviewed tax control is approaching its review deadline.',
        recommendedAction: 'Open the tax control in Ops, verify primary sources with Tax/Legal and Finance, then append a reviewed superseding control or a DISABLED activation. Do not edit accepted snapshots.',
        dedupeKey,
        relatedEntityType: 'tax_policy_activation',
        relatedEntityId: row.activation_id,
        notifyOps: true,
        metadata: {
          environment: row.environment, policy_version: row.policy_version,
          jurisdiction_country_code: row.jurisdiction_country_code,
          origin_country_code: row.origin_country_code, destination_country_code: row.destination_country_code,
          tax_transaction_type: row.tax_transaction_type,
          fulfillment_classification: row.fulfillment_classification,
          review_due_at: row.review_due_at, affected_open_reservations: row.affected_open_reservations,
          correlation_id: row.correlation_id,
        },
      })
    }
    const reviewedControls = await loadReviewedControlDeadlines(supabase)
    for (const row of reviewedControls) {
      const health = reviewHealth(row.review_due_at)
      const dedupeKey = `tax-reviewed-control:${row.control_type}:${row.control_id}`
      if (health === 'HEALTHY') {
        await resolveOpsIssueByDedupeKey(supabase, dedupeKey, { recoveredBy: FN, healthStatus: health })
        continue
      }
      alerted += 1
      const expired = health === 'EXPIRED'
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: expired ? 'CRITICAL' : 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        title: expired ? 'Reviewed tax dependency expired' : 'Reviewed tax dependency due soon',
        description: expired
          ? 'New activated pricing that depends on this reviewed control is blocked. Accepted snapshots remain unchanged.'
          : 'A reviewed tax dependency is approaching its review deadline.',
        recommendedAction: 'Verify the primary sources with Tax/Legal and Finance, then append a reviewed superseding record. Do not edit accepted snapshots.',
        dedupeKey,
        relatedEntityType: `tax_${row.control_type.toLowerCase()}`,
        relatedEntityId: row.control_id,
        notifyOps: true,
        metadata: {
          control_type: row.control_type,
          policy_version: row.policy_version,
          review_due_at: row.review_due_at,
          correlation_id: row.correlation_id,
        },
      })
    }
    const scanned = (data?.length ?? 0) + reviewedControls.length
    await audit(supabase, { event: 'tax.controls_monitored', actor_role: 'SYSTEM', payload: { function: FN, scanned, alerted } })
    return new Response(JSON.stringify({ ok: true, scanned, alerted }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'failed', { error: message })
    await Sentry.captureMessage('Tax control monitor failed', { level: 'error', tags: { function: FN }, extra: { safe_error: message } })
    return new Response(JSON.stringify({ ok: false, error: 'Tax control monitoring failed.' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})

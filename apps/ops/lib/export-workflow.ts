import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OpsSession } from '../../web/lib/ops-auth'
import {
  canRequestOpsExport,
  opsExportCsvCell,
  validateOpsExportRequest,
} from '../../../supabase/functions/_shared/ops-export-policy'

type ExportRequestRow = {
  id: string
  reference: string
  dataset: string
  status: string
  filters: Record<string, unknown>
  row_limit: number
  requester_principal_id: string
  requester_email: string
  correlation_id: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null
}

async function principalForSession(client: SupabaseClient, session: OpsSession) {
  if (!session.email) return null
  const result = await client
    .from('ops_workforce_principals')
    .select('id,email,roles,status,permitted_environments,access_review_due_at')
    .eq('email', session.email)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data
}

export async function requestLocalOpsExport(
  client: SupabaseClient,
  session: OpsSession,
  body: Record<string, unknown>,
  correlationId: string,
) {
  const validation = validateOpsExportRequest({
    dataset: body.dataset,
    reason: body.reason,
    rowLimit: body.rowLimit,
    filters: body.filters,
  })
  if (!validation.ok) return { ok: false as const, status: 400, error: validation.error }
  const idempotencyKey = text(body.idempotencyKey, 180)
  if (!idempotencyKey || idempotencyKey.length < 16) {
    return { ok: false as const, status: 400, error: 'idempotency-key-required' }
  }

  const principal = await principalForSession(client, session)
  const roles = Array.isArray(principal?.roles) ? principal.roles.map(String) : []
  if (!principal || !canRequestOpsExport(roles)) {
    return { ok: false as const, status: 403, error: 'export-role-required' }
  }
  const actorRole = roles.includes('admin') ? 'admin' : 'engineering'
  const environment = (process.env.DRAPE_OPS_ENV ?? 'development').trim().toUpperCase()
  const result = await client.rpc('request_ops_export', {
    p_dataset: validation.value.dataset,
    p_reason: validation.value.reason,
    p_filters: validation.value.filters,
    p_row_limit: validation.value.rowLimit,
    p_idempotency_key: idempotencyKey,
    p_actor_principal_id: principal.id,
    p_actor_label: session.email,
    p_actor_role: actorRole,
    p_environment: environment,
    p_sensitive_assurance: true,
    p_correlation_id: correlationId,
  })
  if (result.error) throw result.error
  const exportRequest = record(result.data)
  return {
    ok: true as const,
    status: 202,
    duplicate: exportRequest.duplicate === true,
    export: exportRequest,
    principalId: String(principal.id),
  }
}

export async function generateLocalOpsExport(
  client: SupabaseClient,
  exportRequestId: string,
  principalId: string,
  correlationId: string,
) {
  const claim = await client.rpc('claim_ops_export', {
    p_export_request_id: exportRequestId,
    p_actor_principal_id: principalId,
    p_correlation_id: correlationId,
  })
  if (claim.error) throw claim.error
  const claimEnvelope = record(claim.data)
  if (claimEnvelope.claimed !== true) return
  const request = record(claimEnvelope.request) as ExportRequestRow
  if (request.status !== 'PROCESSING') return

  try {
    const filters = record(request.filters)
    let query = client
      .from('ops_action_receipts')
      .select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,failure_code')
      .order('persisted_at', { ascending: false })
      .limit(Number(request.row_limit))
    const outcome = text(filters.outcome, 24)?.toUpperCase()
    if (outcome && outcome !== 'ALL') query = query.eq('outcome', outcome)
    const from = text(filters.from, 64)
    const to = text(filters.to, 64)
    if (from) query = query.gte('persisted_at', from)
    if (to) query = query.lte('persisted_at', to)
    const result = await query
    if (result.error) throw result.error

    const rows = result.data ?? []
    const generatedAt = new Date().toISOString()
    const csv = [
      [
        'export_reference', 'requested_by', 'generated_at', 'receipt_id',
        'case_id', 'action', 'outcome', 'human_status', 'correlation_id',
        'persisted_at', 'completed_at', 'failure_code',
      ].map(opsExportCsvCell).join(','),
      ...rows.map((row) => [
        request.reference, request.requester_email, generatedAt, row.id,
        row.issue_id, row.action_key, row.outcome, row.human_status,
        row.correlation_id, row.persisted_at, row.completed_at, row.failure_code,
      ].map(opsExportCsvCell).join(',')),
    ].join('\r\n')
    const checksum = createHash('sha256').update(csv).digest('hex')
    const completion = await client.rpc('complete_ops_export', {
      p_export_request_id: request.id,
      p_actor_principal_id: principalId,
      p_correlation_id: correlationId,
      p_content: csv,
      p_content_sha256: checksum,
      p_row_count: rows.length,
      p_source_watermark: rows.length > 0 ? String(rows[0].persisted_at) : null,
    })
    if (completion.error) throw completion.error
  } catch (error) {
    const failure = await client.rpc('fail_ops_export', {
      p_export_request_id: request.id,
      p_actor_principal_id: principalId,
      p_correlation_id: correlationId,
      p_failure_code: 'GENERATION_FAILED',
    })
    if (failure.error) throw failure.error
    throw error
  }
}

export async function downloadLocalOpsExport(
  client: SupabaseClient,
  session: OpsSession,
  exportRequestId: string,
  correlationId: string,
) {
  const principal = await principalForSession(client, session)
  const roles = Array.isArray(principal?.roles) ? principal.roles.map(String) : []
  if (!principal || !canRequestOpsExport(roles)) return null
  const result = await client.rpc('consume_ops_export_download', {
    p_export_request_id: exportRequestId,
    p_actor_principal_id: principal.id,
    p_correlation_id: correlationId,
  })
  if (result.error) throw result.error
  return record(result.data)
}

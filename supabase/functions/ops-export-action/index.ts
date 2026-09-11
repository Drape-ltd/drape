import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { canRequestOpsExport, opsExportCsvCell, validateOpsExportRequest } from '../_shared/ops-export-policy.ts'
import { isActiveOpsReadPrincipal } from '../_shared/ops-read-policy.ts'

const FN = 'ops-export-action'

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

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function environment() {
  const value = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
  return value === 'DEVELOPMENT' || value === 'PRODUCTION' ? value : null
}

function isPhoneClient(value: string | null) {
  const userAgent = value?.toLowerCase() ?? ''
  return /iphone|ipod|android.+mobile|windows phone/u.test(userAgent)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function generateActionReceiptExport(
  supabase: SupabaseClient,
  request: ExportRequestRow,
) {
  const claim = await supabase.rpc('claim_ops_export', {
    p_export_request_id: request.id,
    p_actor_principal_id: request.requester_principal_id,
    p_correlation_id: request.correlation_id,
  })
  if (claim.error) throw claim.error
  const claimEnvelope = asRecord(claim.data)
  if (claimEnvelope.claimed !== true) return
  const claimed = asRecord(claimEnvelope.request) as ExportRequestRow
  if (claimed.status !== 'PROCESSING') return

  try {
    const filters = asRecord(claimed.filters)
    let query = supabase
      .from('ops_action_receipts')
      .select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,failure_code')
      .order('persisted_at', { ascending: false })
      .limit(Number(claimed.row_limit))

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
    const header = [
      'export_reference',
      'requested_by',
      'generated_at',
      'receipt_id',
      'case_id',
      'action',
      'outcome',
      'human_status',
      'correlation_id',
      'persisted_at',
      'completed_at',
      'failure_code',
    ]
    const csv = [
      header.map(opsExportCsvCell).join(','),
      ...rows.map((row) => [
        claimed.reference,
        claimed.requester_email,
        generatedAt,
        row.id,
        row.issue_id,
        row.action_key,
        row.outcome,
        row.human_status,
        row.correlation_id,
        row.persisted_at,
        row.completed_at,
        row.failure_code,
      ].map(opsExportCsvCell).join(',')),
    ].join('\r\n')
    const sourceWatermark = rows.length > 0 ? String(rows[0].persisted_at) : null
    const checksum = await sha256(csv)
    const completion = await supabase.rpc('complete_ops_export', {
      p_export_request_id: claimed.id,
      p_actor_principal_id: claimed.requester_principal_id,
      p_correlation_id: claimed.correlation_id,
      p_content: csv,
      p_content_sha256: checksum,
      p_row_count: rows.length,
      p_source_watermark: sourceWatermark,
    })
    if (completion.error) throw completion.error
  } catch (error) {
    log('error', FN, 'generation.failed', {
      export_request_id: request.id,
      correlation_id: request.correlation_id,
      error: error instanceof Error ? error.message : String(error),
    })
    const failure = await supabase.rpc('fail_ops_export', {
      p_export_request_id: request.id,
      p_actor_principal_id: request.requester_principal_id,
      p_correlation_id: request.correlation_id,
      p_failure_code: 'GENERATION_FAILED',
    })
    if (failure.error) {
      log('error', FN, 'failure_record.failed', {
        export_request_id: request.id,
        correlation_id: request.correlation_id,
        code: failure.error.code,
      })
    }
  }
}

function runAfterResponse(task: Promise<unknown>) {
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(value: Promise<unknown>): void }
  }
  if (runtime.EdgeRuntime?.waitUntil) {
    runtime.EdgeRuntime.waitUntil(task)
    return Promise.resolve()
  }
  return task.then(() => undefined)
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const assertedCorrelationId = request.headers.get('x-correlation-id')?.trim() ?? ''
  const correlationId = isUuid(assertedCorrelationId) ? assertedCorrelationId : crypto.randomUUID()

  try {
    const identity = await verifyCloudflareOpsAccess(
      request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '',
      {
        teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
        normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
        sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
        requireSensitive: true,
        allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
        allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
      },
    )
    if (!identity?.sensitiveAssurance) {
      return json({ error: 'Fresh protected workforce access is required.', correlationId }, 401, cors)
    }
    if (isPhoneClient(`${request.headers.get('user-agent') ?? ''} ${request.headers.get('x-drape-client-user-agent') ?? ''}`)) {
      return json({ error: 'Exports require a trusted desktop.', correlationId }, 403, cors)
    }

    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      return json({ error: 'Request body must be valid JSON.', correlationId }, 400, cors)
    }
    const body = asRecord(parsed)
    const action = text(body.action, 24)?.toUpperCase()
    if (action !== 'REQUEST' && action !== 'DOWNLOAD') {
      return json({ error: 'Invalid export action.', correlationId }, 400, cors)
    }

    const env = environment()
    if (!env) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const principalResult = await supabase
      .from('ops_workforce_principals')
      .select('id,email,roles,permitted_environments,access_subject,session_revoked_before,access_review_due_at,status')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalResult.error) throw principalResult.error
    const principal = principalResult.data as Principal | null
    if (!principal || !canRequestOpsExport(principal.roles ?? []) || !isActiveOpsReadPrincipal({
      status: principal.status,
      accessSubject: principal.access_subject,
      permittedEnvironments: principal.permitted_environments ?? [],
      sessionRevokedBefore: principal.session_revoked_before,
      accessReviewDueAt: principal.access_review_due_at,
      assertedSubject: identity.subject,
      assertionIssuedAt: identity.issuedAt,
      environment: env,
    })) {
      return json({ error: 'Workforce principal is unavailable, expired, or unauthorized.', correlationId }, 403, cors)
    }

    if (action === 'DOWNLOAD') {
      const exportRequestId = text(body.exportRequestId, 64)
      if (!exportRequestId || !isUuid(exportRequestId)) return json({ error: 'Export request is invalid.', correlationId }, 400, cors)
      const result = await supabase.rpc('consume_ops_export_download', {
        p_export_request_id: exportRequestId,
        p_actor_principal_id: principal.id,
        p_correlation_id: correlationId,
      })
      if (result.error) {
        const missing = result.error.code === 'P0002'
        const forbidden = result.error.code === '42501'
        const unavailable = result.error.code === '55000'
        if (!missing && !forbidden && !unavailable) {
          log('error', FN, 'download.failed', { correlation_id: correlationId, code: result.error.code })
        }
        return json({
          error: missing
            ? 'Export request was not found.'
            : forbidden
              ? 'This export belongs to another workforce identity.'
              : unavailable
                ? 'This export is not ready or has expired.'
                : 'The export could not be downloaded.',
          correlationId,
        }, missing ? 404 : forbidden ? 403 : unavailable ? 409 : 500, cors)
      }
      const download = asRecord(result.data)
      const content = typeof download.content === 'string' ? download.content : ''
      const reference = text(download.reference, 32) ?? 'OPS-EXPORT'
      return new Response(content, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${reference}.csv"`,
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'X-Drape-Export-SHA256': text(download.sha256, 64) ?? '',
          'X-Drape-Correlation-Id': correlationId,
        },
      })
    }

    const validation = validateOpsExportRequest({
      dataset: body.dataset,
      reason: body.reason,
      rowLimit: body.rowLimit,
      filters: body.filters,
    })
    if (!validation.ok) return json({ error: validation.error, correlationId }, 400, cors)
    const idempotencyKey = text(body.idempotencyKey, 180)
    if (!idempotencyKey || idempotencyKey.length < 16) {
      return json({ error: 'A bounded idempotency key is required.', correlationId }, 400, cors)
    }

    const requestResult = await supabase.rpc('request_ops_export', {
      p_dataset: validation.value.dataset,
      p_reason: validation.value.reason,
      p_filters: validation.value.filters,
      p_row_limit: validation.value.rowLimit,
      p_idempotency_key: idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: identity.email,
      p_actor_role: principal.roles.includes('admin') ? 'admin' : 'engineering',
      p_environment: env,
      p_sensitive_assurance: true,
      p_correlation_id: correlationId,
    })
    if (requestResult.error) {
      const forbidden = requestResult.error.code === '42501'
      const invalid = requestResult.error.code === '22023'
      if (!forbidden && !invalid) {
        log('error', FN, 'request.failed', { correlation_id: correlationId, code: requestResult.error.code })
      }
      return json({
        error: forbidden
          ? 'This workforce role is not authorized to export reports.'
          : invalid
            ? 'The export request is invalid.'
            : 'The export request could not be persisted.',
        correlationId,
      }, forbidden ? 403 : invalid ? 400 : 500, cors)
    }

    const exportRequest = asRecord(requestResult.data)
    const exportRequestId = text(exportRequest.id, 64)
    const status = text(exportRequest.status, 24)
    if (exportRequestId && (status === 'REQUESTED' || status === 'FAILED')) {
      await runAfterResponse(generateActionReceiptExport(supabase, {
        id: exportRequestId,
        reference: text(exportRequest.reference, 32) ?? 'OPS-EXPORT',
        dataset: validation.value.dataset,
        status,
        filters: validation.value.filters,
        row_limit: validation.value.rowLimit,
        requester_principal_id: principal.id,
        requester_email: identity.email,
        correlation_id: text(exportRequest.correlationId, 64) ?? correlationId,
      }))
    }

    return json({
      ok: true,
      duplicate: exportRequest.duplicate === true,
      export: {
        id: exportRequestId,
        reference: exportRequest.reference,
        status: status ?? 'REQUESTED',
        correlationId: exportRequest.correlationId ?? correlationId,
      },
      correlationId,
    }, 202, cors)
  } catch (error) {
    log('error', FN, 'unhandled', {
      correlation_id: correlationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'The export workflow is unavailable.', correlationId }, 500, cors)
  }
})

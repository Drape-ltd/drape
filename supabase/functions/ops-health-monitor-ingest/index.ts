import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'

const FN = 'ops-health-monitor-ingest'

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null
}

async function sameSecret(provided: string, configured: string) {
  if (!provided || !configured) return false
  const encoder = new TextEncoder()
  const [providedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(configured)),
  ])
  const left = new Uint8Array(providedHash)
  const right = new Uint8Array(configuredHash)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    const authorized = await sameSecret(
      request.headers.get('x-drape-monitor-secret')?.trim() ?? '',
      Deno.env.get('DRAPE_HEALTH_MONITOR_INGEST_SECRET')?.trim() ?? '',
    )
    if (!authorized) return json({ error: 'Monitor authentication is required.', correlationId }, 401)

    const raw = await request.text()
    if (raw.length > 65_536) return json({ error: 'Monitor payload is too large.', correlationId }, 413)
    const body = JSON.parse(raw || '{}') as Record<string, unknown>
    const environment = safeText(body.environment, 20)?.toUpperCase() ?? ''
    const configuredEnvironment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment) || environment !== configuredEnvironment) {
      return json({ error: 'Monitor environment mismatch.', correlationId }, 403)
    }

    const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result as Record<string, unknown>
      : null
    const monitorKey = safeText(body.monitorKey, 80)
    const fingerprint = safeText(body.fingerprint, 200)
    const checkedAt = safeText(body.checkedAt, 80)
    const targetId = safeText(result?.id, 80)
    const targetName = safeText(result?.name, 160)
    const detail = safeText(result?.detail, 1000)
    const severity = safeText(result?.severity, 20)?.toUpperCase()
    const healthy = result?.ok === true
    const httpStatus = typeof result?.httpStatus === 'number' && Number.isInteger(result.httpStatus) ? result.httpStatus : 0
    const latencyMs = typeof result?.latencyMs === 'number' && Number.isInteger(result.latencyMs) ? result.latencyMs : 0
    if (!monitorKey || !fingerprint || !checkedAt || !targetId || !targetName || !detail || !severity) {
      return json({ error: 'Complete bounded monitor state is required.', correlationId }, 400)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('ingest_ops_health_monitor_state', {
      p_environment: environment,
      p_monitor_key: monitorKey,
      p_target_id: targetId,
      p_target_name: targetName,
      p_healthy: healthy,
      p_severity: severity,
      p_fingerprint: fingerprint,
      p_http_status: httpStatus,
      p_latency_ms: latencyMs,
      p_detail: detail,
      p_result_payload: result,
      p_slack_delivery: body.slackDelivery && typeof body.slackDelivery === 'object' ? body.slackDelivery : null,
      p_checked_at: checkedAt,
      p_source_reference: safeText(body.sourceReference, 500),
      p_runbook_url: safeText(body.runbookUrl, 500),
      p_correlation_id: safeText(body.correlationId, 180) ?? correlationId,
    })
    if (error) throw error
    return json({ ok: true, state: data, correlationId }, 200)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'Monitor state could not be persisted.', correlationId }, 500)
  }
})

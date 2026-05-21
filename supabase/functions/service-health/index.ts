import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  getOptionalHealthcheckSecret,
  getServiceRoleKey,
  getSupabaseUrl,
} from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'

const FN = 'service-health'

type Check = {
  ok: boolean
  status: 'ok' | 'warn' | 'fail'
  message: string
  latencyMs?: number
}

const REQUIRED_CRON_JOBS = [
  'expire-pending-payments',
  'expire-quotes',
  'auto-release',
  'release-order-payouts',
  'escalate-production-stalls',
  'send-consultation-reminders',
  'process-notification-jobs',
  'process-ops-jobs',
] as const

function jsonResponse(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const leftBytes = new Uint8Array(leftHash)
  const rightBytes = new Uint8Array(rightHash)
  let diff = 0
  for (let index = 0; index < 32; index += 1) diff |= leftBytes[index] ^ rightBytes[index]
  return diff === 0
}

async function authorizeReadiness(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return false

  const healthcheckSecret = getOptionalHealthcheckSecret()
  if (!healthcheckSecret) return false
  return timingSafeEqual(token, healthcheckSecret)
}

function envCheck(name: string, required = true): Check {
  const present = !!Deno.env.get(name)
  if (present) return { ok: true, status: 'ok', message: 'Configured' }
  return {
    ok: !required,
    status: required ? 'fail' : 'warn',
    message: required ? 'Missing required environment variable' : 'Optional environment variable not configured',
  }
}

function anyEnvCheck(names: string[], label: string, required = true): Check {
  const present = names.some((name) => !!Deno.env.get(name))
  if (present) return { ok: true, status: 'ok', message: 'Configured' }
  return {
    ok: !required,
    status: required ? 'fail' : 'warn',
    message: required
      ? `Missing required environment variable: ${label}`
      : `Optional environment variable not configured: ${label}`,
  }
}

async function databaseCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const { error } = await supabase
    .from('ops_issues')
    .select('id', { head: true, count: 'exact' })
    .limit(1)

  const latencyMs = Math.round(performance.now() - startedAt)
  if (error) {
    return {
      ok: false,
      status: 'fail',
      message: error.message,
      latencyMs,
    }
  }

  return {
    ok: true,
    status: latencyMs > 1_500 ? 'warn' : 'ok',
    message: latencyMs > 1_500 ? 'Database reachable but slower than expected' : 'Database reachable',
    latencyMs,
  }
}

async function cronCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const { data, error } = await supabase.rpc('get_drape_service_health')
  const latencyMs = Math.round(performance.now() - startedAt)

  if (error) {
    return {
      ok: true,
      status: 'warn',
      message: 'Cron status RPC is not installed yet; liveness and database checks still passed.',
      latencyMs,
    }
  }

  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const jobs = Array.isArray(payload.jobs) ? payload.jobs as Array<Record<string, unknown>> : []
  const installedNames = new Set(
    jobs
      .map((job) => typeof job.jobname === 'string' ? job.jobname : typeof job.jobName === 'string' ? job.jobName : '')
      .filter(Boolean),
  )
  const missing = REQUIRED_CRON_JOBS.filter((job) => !installedNames.has(job))

  if (missing.length > 0) {
    return {
      ok: false,
      status: 'fail',
      message: `Missing scheduled job(s): ${missing.join(', ')}`,
      latencyMs,
    }
  }

  return {
    ok: true,
    status: 'ok',
    message: 'Required scheduled jobs are present',
    latencyMs,
  }
}

async function jobQueueCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const { data, error } = await supabase.rpc('get_job_queue_health')
  const latencyMs = Math.round(performance.now() - startedAt)

  if (error) {
    return {
      ok: false,
      status: 'fail',
      message: `Job queue health RPC failed: ${error.message}`,
      latencyMs,
    }
  }

  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const deadCount = typeof payload.deadCount === 'number' ? payload.deadCount : 0
  const retryableCount = typeof payload.retryableCount === 'number' ? payload.retryableCount : 0
  const oldestPendingAt = typeof payload.oldestPendingAt === 'string' ? payload.oldestPendingAt : null
  const oldestPendingAgeMs = oldestPendingAt ? Date.now() - new Date(oldestPendingAt).getTime() : 0

  if (deadCount > 0) {
    return {
      ok: false,
      status: 'fail',
      message: `${deadCount} background job(s) are dead-lettered and need ops review`,
      latencyMs,
    }
  }

  if (oldestPendingAgeMs > 10 * 60 * 1000) {
    return {
      ok: true,
      status: 'warn',
      message: 'Background jobs are queued for longer than 10 minutes',
      latencyMs,
    }
  }

  if (retryableCount > 10) {
    return {
      ok: true,
      status: 'warn',
      message: `${retryableCount} background job(s) are retrying`,
      latencyMs,
    }
  }

  return {
    ok: true,
    status: 'ok',
    message: 'Job queue healthy',
    latencyMs,
  }
}

async function providerHealthCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const { data, error } = await supabase.rpc('get_provider_health')
  const latencyMs = Math.round(performance.now() - startedAt)

  if (error) {
    return {
      ok: false,
      status: 'fail',
      message: `Provider health RPC failed: ${error.message}`,
      latencyMs,
    }
  }

  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
  const open = rows.filter((row) => row.status === 'OPEN')
  const degraded = rows.filter((row) => row.status === 'DEGRADED')

  if (open.length > 0) {
    return {
      ok: false,
      status: 'fail',
      message: `Provider circuit open: ${open.map((row) => `${row.provider}:${row.operation}`).join(', ')}`,
      latencyMs,
    }
  }

  if (degraded.length > 0) {
    return {
      ok: true,
      status: 'warn',
      message: `Provider degraded: ${degraded.map((row) => `${row.provider}:${row.operation}`).join(', ')}`,
      latencyMs,
    }
  }

  return {
    ok: true,
    status: 'ok',
    message: 'Provider health clear',
    latencyMs,
  }
}

function providerSecretChecks() {
  return {
    stripeSecret: anyEnvCheck(['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_SANDBOX'], 'STRIPE_SECRET_KEY'),
    stripeWebhookSecret: anyEnvCheck(['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRETS'], 'STRIPE_WEBHOOK_SECRET'),
    paystackSecret: anyEnvCheck(['PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET_KEY_TEST'], 'PAYSTACK_SECRET_KEY'),
    reauthProofSecret: envCheck('REAUTH_PROOF_SECRET'),
    healthcheckSecret: anyEnvCheck(['DRAPE_HEALTHCHECK_SECRET', 'HEALTHCHECK_SECRET'], 'DRAPE_HEALTHCHECK_SECRET'),
    sentryDsn: anyEnvCheck(['SENTRY_DSN', 'SUPABASE_SENTRY_DSN'], 'SENTRY_DSN', false),
  } satisfies Record<string, Check>
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, cors)
  }

  const url = new URL(req.url)
  const check = url.searchParams.get('check') ?? 'live'
  const checkedAt = new Date().toISOString()

  if (check === 'live') {
    return jsonResponse({
      ok: true,
      status: 'ok',
      service: 'drape-edge',
      check: 'live',
      checkedAt,
    }, 200, cors)
  }

  if (check !== 'ready') {
    return jsonResponse({
      ok: false,
      error: 'Unsupported health check',
      supportedChecks: ['live', 'ready'],
    }, 400, cors)
  }

  if (!(await authorizeReadiness(req))) {
    log('warn', FN, 'auth.unauthorized')
    return jsonResponse({
      ok: false,
      error: 'This readiness check requires the Drape healthcheck secret.',
      message: 'This readiness check requires the Drape healthcheck secret.',
    }, 401, cors)
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const checks: Record<string, Check> = {
    edge: { ok: true, status: 'ok', message: 'Edge runtime reachable' },
    supabaseUrl: envCheck('SUPABASE_URL'),
    serviceRoleKey: {
      ok: !!(Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ?? Deno.env.get('DRAPE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
      status: Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ?? Deno.env.get('DRAPE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'ok' : 'fail',
      message: Deno.env.get('DRAPE_SERVICE_ROLE_JWT') ?? Deno.env.get('DRAPE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        ? 'Configured'
        : 'Missing required service role environment variable',
    },
    ...providerSecretChecks(),
    database: await databaseCheck(supabase),
    cron: await cronCheck(supabase),
    jobQueue: await jobQueueCheck(supabase),
    providers: await providerHealthCheck(supabase),
  }

  const failed = Object.values(checks).filter((item) => item.status === 'fail')
  const warnings = Object.values(checks).filter((item) => item.status === 'warn')
  const ok = failed.length === 0

  return jsonResponse({
    ok,
    status: ok ? (warnings.length > 0 ? 'degraded' : 'ok') : 'fail',
    service: 'drape-edge',
    check: 'ready',
    checkedAt,
    checks,
  }, ok ? 200 : 503, cors)
})

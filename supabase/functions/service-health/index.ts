import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  getOptionalHealthcheckSecret,
  getServiceRoleKey,
  getSupabaseUrl,
} from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import {
  findOverduePayoutsWithoutRows,
  PAYOUT_WATCHDOG_GRACE_MINUTES,
} from '../_shared/payout-watchdog.ts'
import { TAX_POLICY_CONTROLS } from '../../../packages/shared/src/tax.ts'

const FN = 'service-health'

type Check = {
  ok: boolean
  status: 'ok' | 'warn' | 'fail'
  message: string
  latencyMs?: number
  details?: Record<string, unknown>
}

type ReadinessTier = 'beta' | 'launch'

const REQUIRED_CRON_JOBS = [
  'expire-pending-payments',
  'expire-quotes',
  'auto-release',
  'release-order-payouts',
  'escalate-production-stalls',
  'send-consultation-reminders',
  'finalize-account-deletions',
  'process-notification-jobs',
  'process-ops-jobs',
  'process-money-jobs-recovery',
  'process-push-receipts',
  'monitor-tax-controls',
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

function secretModeCheck(names: string[], label: string, modes: Record<string, 'test' | 'live'>): Check {
  const value = names
    .map((name) => Deno.env.get(name)?.trim() ?? '')
    .find((candidate) => candidate.length > 0)

  if (!value) {
    return {
      ok: false,
      status: 'fail',
      message: `Missing required environment variable: ${label}`,
    }
  }

  for (const [prefix, mode] of Object.entries(modes)) {
    if (value.startsWith(prefix)) {
      const status = mode === 'test' ? 'warn' : 'ok'
      return {
        ok: true,
        status,
        message: mode === 'test'
          ? `${label} is configured in test mode. Tester checkout is safe, but public launch payments are not live.`
          : `${label} is configured in live mode. Real payment attempts can charge real cards.`,
        details: { mode },
      }
    }
  }

  return {
    ok: true,
    status: 'warn',
    message: `${label} is configured, but the key prefix did not match a known test/live pattern.`,
    details: { mode: 'unknown' },
  }
}

function smsSecretCheck(): Check {
  const provider = (Deno.env.get('SMS_PROVIDER') ?? '').trim().toLowerCase()
  const termiiConfigured = !!(Deno.env.get('TERMII_API_KEY') && (Deno.env.get('TERMII_SENDER_ID') ?? Deno.env.get('TERMII_FROM')))
  const twilioConfigured = !!(Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN') && Deno.env.get('TWILIO_FROM_NUMBER'))

  if (provider === 'termii') {
    return termiiConfigured
      ? { ok: true, status: 'ok', message: 'Termii SMS configured' }
      : { ok: false, status: 'fail', message: 'SMS_PROVIDER=termii but TERMII_API_KEY or TERMII_SENDER_ID is missing' }
  }

  if (provider === 'twilio') {
    return twilioConfigured
      ? { ok: true, status: 'ok', message: 'Twilio SMS configured' }
      : { ok: false, status: 'fail', message: 'SMS_PROVIDER=twilio but Twilio credentials are missing' }
  }

  if (termiiConfigured) return { ok: true, status: 'ok', message: 'Termii SMS configured' }
  if (twilioConfigured) return { ok: true, status: 'ok', message: 'Twilio SMS configured' }

  return {
    ok: true,
    status: 'warn',
    message: 'SMS provider is not configured. Push and email fallback can still run.',
  }
}

function taxPolicyReviewCheck(readinessTier: ReadinessTier, now = new Date()): Check {
  const overdue = TAX_POLICY_CONTROLS.filter((policy) => {
    const dueAt = new Date(`${policy.reviewDueAt}T23:59:59.999Z`).getTime()
    return Number.isFinite(dueAt) && dueAt < now.getTime()
  })
  const blocked = TAX_POLICY_CONTROLS.filter((policy) => policy.mode === 'BLOCKED')
  const nextReviewAt = TAX_POLICY_CONTROLS
    .map((policy) => policy.reviewDueAt)
    .sort()[0] ?? null

  if (overdue.length > 0) {
    return {
      ok: readinessTier === 'beta',
      status: readinessTier === 'beta' ? 'warn' : 'fail',
      message: `${overdue.length} tax policy review(s) are overdue. Public checkout must remain blocked until official sources are reviewed.`,
      details: {
        overdue: overdue.map((policy) => policy.countryCode),
        next_review_at: nextReviewAt,
        blocked_jurisdictions: blocked.map((policy) => policy.countryCode),
      },
    }
  }

  return {
    ok: true,
    status: blocked.length > 0 ? 'warn' : 'ok',
    message: blocked.length > 0
      ? `Tax policies are current; ${blocked.map((policy) => policy.countryCode).join(', ')} checkout remains intentionally blocked pending country-specific tax support.`
      : 'Tax policies are within their official-source review window.',
    details: {
      next_review_at: nextReviewAt,
      blocked_jurisdictions: blocked.map((policy) => policy.countryCode),
      reviewed: TAX_POLICY_CONTROLS.map((policy) => ({
        country_code: policy.countryCode,
        mode: policy.mode,
        reviewed_at: policy.reviewedAt,
        review_due_at: policy.reviewDueAt,
        source_url: policy.sourceUrl,
      })),
    },
  }
}

async function activatedTaxControlHealthCheck(supabase: any, readinessTier: ReadinessTier): Promise<Check> {
  const { data, error } = await supabase.from('tax_control_health')
    .select('activation_id,environment,policy_version,jurisdiction_country_code,origin_country_code,destination_country_code,tax_transaction_type,fulfillment_classification,review_due_at,health_status,affected_open_reservations,correlation_id')
  if (error) return { ok: false, status: 'fail', message: `Could not read activated tax-control health: ${error.message}` }
  const rows = data ?? []
  const expired = rows.filter((row: any) => row.health_status === 'EXPIRED')
  const due = rows.filter((row: any) => row.health_status === 'REVIEW_DUE')
  const productionExpired = expired.filter((row: any) => row.environment === 'PRODUCTION')
  const fail = readinessTier === 'launch' && productionExpired.length > 0
  return {
    ok: !fail,
    status: fail ? 'fail' : expired.length > 0 || due.length > 0 ? 'warn' : 'ok',
    message: rows.length === 0
      ? 'No reviewed tax scope is activated; legacy pricing remains in place.'
      : `${rows.length} activated tax scope(s); ${expired.length} expired and ${due.length} due for review.`,
    details: {
      activated: rows.length,
      expired: expired.map((row: any) => ({ activation_id: row.activation_id, environment: row.environment, correlation_id: row.correlation_id })),
      review_due: due.map((row: any) => ({ activation_id: row.activation_id, environment: row.environment, review_due_at: row.review_due_at })),
    },
  }
}

async function reviewedTaxDependencyHealthCheck(supabase: any, readinessTier: ReadinessTier): Promise<Check> {
  const sources = [
    { table: 'tax_policy_versions', id: 'policy_version', type: 'POLICY', hasStatus: true },
    { table: 'tax_registration_controls', id: 'id', type: 'REGISTRATION', hasStatus: true },
    { table: 'tax_responsibility_controls', id: 'id', type: 'RESPONSIBILITY', hasStatus: true },
    { table: 'tax_corridor_controls', id: 'id', type: 'CORRIDOR', hasStatus: true },
    { table: 'tax_line_classification_controls', id: 'id', type: 'LINE_CLASSIFICATION', hasStatus: false },
    { table: 'tax_registration_facts', id: 'id', type: 'REGISTRATION_FACT', hasStatus: false },
  ] as const
  const now = Date.now()
  const warningAt = now + 30 * 24 * 60 * 60 * 1_000
  const expired: Array<Record<string, string>> = []
  const due: Array<Record<string, string>> = []
  for (const source of sources) {
    const { data, error } = await supabase.from(source.table)
      .select(`${source.id},review_due_at${source.hasStatus ? ',status' : ''}`)
    if (error) return { ok: false, status: 'fail', message: `Could not read ${source.type.toLowerCase()} review health: ${error.message}` }
    for (const row of data ?? []) {
      if (source.hasStatus && !['APPROVED', 'ACTIVE'].includes(row.status)) continue
      const dueAt = new Date(row.review_due_at).getTime()
      const safe = { control_type: source.type, control_id: String(row[source.id]), review_due_at: String(row.review_due_at) }
      if (!Number.isFinite(dueAt) || dueAt <= now) expired.push(safe)
      else if (dueAt <= warningAt) due.push(safe)
    }
  }
  const fail = readinessTier === 'launch' && expired.length > 0
  return {
    ok: !fail,
    status: fail ? 'fail' : expired.length > 0 || due.length > 0 ? 'warn' : 'ok',
    message: expired.length > 0 || due.length > 0
      ? `${expired.length} reviewed tax dependencies expired; ${due.length} due within 30 days.`
      : 'Reviewed tax dependencies are within their review windows.',
    details: { expired, review_due: due },
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
  const vaultAvailable = payload.vaultAvailable === true
  const vaultProjectUrlConfigured = payload.vaultProjectUrlConfigured === true
  const vaultServiceRoleConfigured = payload.vaultServiceRoleConfigured === true
  const jobs = Array.isArray(payload.jobs) ? payload.jobs as Array<Record<string, unknown>> : []
  const installedNames = new Set(
    jobs
      .map((job) => typeof job.jobname === 'string' ? job.jobname : typeof job.jobName === 'string' ? job.jobName : '')
      .filter(Boolean),
  )
  const missing = REQUIRED_CRON_JOBS.filter((job) => !installedNames.has(job))

  if (!vaultAvailable || !vaultProjectUrlConfigured || !vaultServiceRoleConfigured) {
    return {
      ok: false,
      status: 'fail',
      message: 'Cron cannot invoke Edge Functions until DB Vault has project_url and service_role_key configured',
      latencyMs,
    }
  }

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

async function payoutWatchdogCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()

  try {
    const overdue = await findOverduePayoutsWithoutRows(supabase)
    const latencyMs = Math.round(performance.now() - startedAt)

    if (overdue.length > 0) {
      const oldest = overdue[0]
      return {
        ok: false,
        status: 'fail',
        message: `${overdue.length} payout(s) are overdue without a payout row. Oldest is ${oldest.minutesPastReady} minutes past ready.`,
        latencyMs,
        details: {
          grace_minutes: PAYOUT_WATCHDOG_GRACE_MINUTES,
          orders: overdue.map((item) => ({
            order_id: item.order.id,
            reference: item.order.reference,
            stage: item.order.stage,
            payout_ready_at: item.payoutReadyAt,
            minutes_past_ready: item.minutesPastReady,
            payout_amount: item.amount,
            payout_currency: item.currency,
            payout_provider: item.provider,
          })),
        },
      }
    }

    return {
      ok: true,
      status: 'ok',
      message: 'No overdue payout releases without payout rows',
      latencyMs,
    }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt)
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: 'fail',
      message: `Payout watchdog check failed: ${message}`,
      latencyMs,
    }
  }
}

async function androidPushRegistrationCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const { data, error } = await supabase
    .from('push_tokens')
    .select('platform, updated_at')
    .eq('platform', 'android')
    .order('updated_at', { ascending: false })
    .limit(1)

  const latencyMs = Math.round(performance.now() - startedAt)
  if (error) {
    return {
      ok: true,
      status: 'warn',
      message: `Could not inspect Android push token registration: ${error.message}`,
      latencyMs,
    }
  }

  const latest = Array.isArray(data) && data.length > 0 ? data[0] as Record<string, unknown> : null
  const updatedAt = typeof latest?.updated_at === 'string' ? latest.updated_at : null
  if (!updatedAt) {
    return {
      ok: true,
      status: 'warn',
      message: 'No Android push token has registered yet. Confirm Firebase google-services.json, EAS FCM credentials, rebuild, then open Android QA devices.',
      latencyMs,
    }
  }

  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000) {
    return {
      ok: true,
      status: 'warn',
      message: `Latest Android push token is stale (${updatedAt}). Reopen a rebuilt Android app and confirm expo-notifications stores a fresh token.`,
      latencyMs,
    }
  }

  return {
    ok: true,
    status: 'ok',
    message: `Android push token registered recently (${updatedAt})`,
    latencyMs,
  }
}

async function pushReceiptCheck(supabase: any): Promise<Check> {
  const startedAt = performance.now()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('push_delivery_attempts')
    .select('status, error_code, ticket_created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1_000)

  const latencyMs = Math.round(performance.now() - startedAt)
  if (error) {
    return {
      ok: true,
      status: 'warn',
      message: `Push receipt ledger is not available yet: ${error.message}`,
      latencyMs,
    }
  }

  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
  const deliveryErrors = rows.filter((row) => row.status === 'DELIVERY_ERROR')
  const expired = rows.filter((row) => row.status === 'RECEIPT_EXPIRED')
  const pending = rows.filter((row) => row.status === 'TICKET_ACCEPTED' || row.status === 'RECEIPT_PENDING')
  const oldestPendingAt = pending
    .map((row) => typeof row.ticket_created_at === 'string' ? row.ticket_created_at : null)
    .filter((value): value is string => !!value)
    .sort()[0] ?? null
  const oldestPendingAgeMs = oldestPendingAt ? Date.now() - new Date(oldestPendingAt).getTime() : 0
  const credentialErrors = deliveryErrors.filter((row) => row.error_code === 'InvalidCredentials')

  if (credentialErrors.length > 0) {
    return {
      ok: false,
      status: 'fail',
      message: `${credentialErrors.length} push receipt(s) report invalid APNs/FCM credentials`,
      latencyMs,
      details: { delivery_errors: deliveryErrors.length, expired: expired.length, pending: pending.length },
    }
  }

  if (deliveryErrors.length > 0 || expired.length > 0 || oldestPendingAgeMs > 30 * 60 * 1000) {
    return {
      ok: true,
      status: 'warn',
      message: `${deliveryErrors.length} delivery error(s), ${expired.length} expired receipt(s), and ${pending.length} pending receipt(s) in the last 24 hours`,
      latencyMs,
      details: { delivery_errors: deliveryErrors.length, expired: expired.length, pending: pending.length },
    }
  }

  return {
    ok: true,
    status: 'ok',
    message: rows.length === 0
      ? 'Push receipt ledger is ready; no beta deliveries recorded in the last 24 hours'
      : `${rows.length} push delivery attempt(s) recorded in the last 24 hours`,
    latencyMs,
    details: { delivery_errors: 0, expired: 0, pending: pending.length },
  }
}

function providerSecretChecks(readinessTier: ReadinessTier) {
  return {
    stripeSecret: anyEnvCheck(['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_SANDBOX'], 'STRIPE_SECRET_KEY'),
    stripeMode: secretModeCheck(
      ['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_SANDBOX'],
      'STRIPE_SECRET_KEY',
      { sk_test_: 'test', sk_live_: 'live' },
    ),
    stripeWebhookSecret: anyEnvCheck(['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRETS'], 'STRIPE_WEBHOOK_SECRET'),
    paystackSecret: anyEnvCheck(['PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET_KEY_TEST'], 'PAYSTACK_SECRET_KEY'),
    paystackMode: secretModeCheck(
      ['PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET_KEY_TEST'],
      'PAYSTACK_SECRET_KEY',
      { sk_test_: 'test', sk_live_: 'live' },
    ),
    smsProvider: smsSecretCheck(),
    ziptaxSecret: Deno.env.get('ZIPTAX_API_KEY')
      ? { ok: true, status: 'ok', message: 'Configured' }
      : readinessTier === 'beta'
        ? {
            ok: true,
            status: 'warn',
            message: 'ZIPTAX_API_KEY is not configured. Beta checkout can use the explicit static tax fallback, but public US/Canada checkout is not launch-ready.',
          }
        : envCheck('ZIPTAX_API_KEY'),
    authSmsHookSecret: anyEnvCheck(['AUTH_SMS_HOOK_SECRET', 'SUPABASE_AUTH_HOOK_SECRET'], 'AUTH_SMS_HOOK_SECRET', false),
    reauthProofSecret: anyEnvCheck(['REAUTH_PROOF_SECRET', 'DRAPE_REAUTH_PROOF_SECRET'], 'REAUTH_PROOF_SECRET'),
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
  const readinessTierParam = url.searchParams.get('tier') ?? 'launch'
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

  if (readinessTierParam !== 'beta' && readinessTierParam !== 'launch') {
    return jsonResponse({
      ok: false,
      error: 'Unsupported readiness tier',
      supportedTiers: ['beta', 'launch'],
    }, 400, cors)
  }

  if (!(await authorizeReadiness(req))) {
    log('warn', FN, 'auth.unauthorized')
    return jsonResponse({
      ok: false,
      error: 'This readiness check requires the Drapeon healthcheck secret.',
      message: 'This readiness check requires the Drapeon healthcheck secret.',
    }, 401, cors)
  }

  const readinessTier = readinessTierParam as ReadinessTier
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
    ...providerSecretChecks(readinessTier),
    taxPolicyReview: taxPolicyReviewCheck(readinessTier),
    activatedTaxControls: await activatedTaxControlHealthCheck(supabase, readinessTier),
    reviewedTaxDependencies: await reviewedTaxDependencyHealthCheck(supabase, readinessTier),
    database: await databaseCheck(supabase),
    cron: await cronCheck(supabase),
    jobQueue: await jobQueueCheck(supabase),
    payoutWatchdog: await payoutWatchdogCheck(supabase),
    androidPushRegistration: await androidPushRegistrationCheck(supabase),
    pushReceipts: await pushReceiptCheck(supabase),
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
    readinessTier,
    checkedAt,
    checks,
  }, ok ? 200 : 503, cors)
})

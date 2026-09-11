const STATE_KEY = 'drapeon-prod-health-state-v2'
const MONITOR_KEY = 'cloudflare-production-synthetic'
const REQUEST_TIMEOUT_MS = 12_000
const WARN_LATENCY_MS = 3_000

const targets = [
  {
    id: 'prod-ready',
    name: 'Drape PROD readiness',
    url: 'https://wkfsrunetmgjdtcurmoj.supabase.co/functions/v1/service-health?check=ready',
    secret: 'DRAPE_PROD_HEALTHCHECK_SECRET',
  },
]

function compact(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function checkTarget(target, env) {
  const startedAt = Date.now()
  if (!env[target.secret]) {
    return {
      id: target.id,
      name: target.name,
      ok: false,
      severity: 'critical',
      httpStatus: 0,
      latencyMs: 0,
      detail: `Monitor configuration is missing ${target.secret}`,
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(target.url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${env[target.secret]}`,
        'user-agent': 'Drapeon-Cloudflare-Synthetic/1.0',
      },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    const body = await response.json().catch(() => null)
    const failedChecks = Object.entries(body?.checks ?? {})
      .filter(([, check]) => check?.status === 'fail')
      .map(([name, check]) => `${name}: ${check?.message ?? 'failed'}`)
    const ready = response.ok && body?.ok === true && failedChecks.length === 0
    const latencyWarning = ready && latencyMs >= WARN_LATENCY_MS
    return {
      id: target.id,
      name: target.name,
      ok: ready && !latencyWarning,
      severity: ready ? (latencyWarning ? 'warning' : 'ok') : 'critical',
      httpStatus: response.status,
      latencyMs,
      detail: ready
        ? latencyWarning ? `Ready but slow (${latencyMs} ms)` : 'Ready'
        : compact(failedChecks.join('; ') || body?.message || `HTTP ${response.status}`),
    }
  } catch (error) {
    return {
      id: target.id,
      name: target.name,
      ok: false,
      severity: 'critical',
      httpStatus: 0,
      latencyMs: Date.now() - startedAt,
      detail: error?.name === 'AbortError' ? 'Timed out' : compact(error?.message || error),
    }
  } finally {
    clearTimeout(timer)
  }
}

function fingerprint(results) {
  const failures = results
    .filter((result) => !result.ok)
    .map(({ id, severity, httpStatus, detail }) => ({ id, severity, httpStatus, detail }))
  return JSON.stringify(failures)
}

function summaryFor(results) {
  const failures = results.filter((result) => !result.ok)
    if (failures.length === 0) return 'Drapeon production readiness is healthy.'
  return failures.map((result) => `${result.name}: ${result.detail}; HTTP ${result.httpStatus}; ${result.latencyMs} ms`).join('\n')
}

async function postSlack(env, heading, summary) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: env.SLACK_CHANNEL_ID,
      text: `${heading}\n${summary}\nhttps://ops.drapeon.co/ops/incidents`,
      unfurl_links: false,
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Slack delivery failed: ${body?.error ?? `HTTP ${response.status}`}`)
  }
  return {
    channel: body.channel ?? env.SLACK_CHANNEL_ID,
    messageTs: body.ts ?? null,
    deliveredAt: new Date().toISOString(),
  }
}

async function persistMonitorResult(env, result, checkedAt, currentFingerprint, correlationId, slackDelivery = null) {
  if (!env.OPS_HEALTH_INGEST_URL || !env.DRAPE_HEALTH_MONITOR_INGEST_SECRET || !env.SUPABASE_ANON_KEY) {
    throw new Error('Production monitor ledger configuration is missing')
  }
  const response = await fetch(env.OPS_HEALTH_INGEST_URL, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-monitor-secret': env.DRAPE_HEALTH_MONITOR_INGEST_SECRET,
    },
    body: JSON.stringify({
      environment: 'PRODUCTION',
      monitorKey: MONITOR_KEY,
      fingerprint: currentFingerprint,
      checkedAt,
      result,
      slackDelivery,
      correlationId,
      sourceReference: 'cloudflare-cron:drapeon-health-monitor',
      runbookUrl: 'https://ops.drapeon.co/ops/knowledge?runbook=production-health',
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Production monitor ledger write failed: ${body?.error ?? `HTTP ${response.status}`}`)
  }
  return body.state
}

async function runChecks(env) {
  if (env.MONITOR_ENVIRONMENT !== 'production') {
    throw new Error('Production health monitor requires MONITOR_ENVIRONMENT=production')
  }
  const checkedAt = new Date().toISOString()
  const results = await Promise.all(targets.map((target) => checkTarget(target, env)))
  const currentFingerprint = fingerprint(results)
  const healthy = results.every((result) => result.ok)
  const correlationId = crypto.randomUUID()
  const ledgerStates = await Promise.all(results.map((result) => persistMonitorResult(env, result, checkedAt, currentFingerprint, correlationId)))
  const transitions = ledgerStates.map((state) => state?.transition ?? 'NONE')
  let slackDelivery = null

  if (transitions.some((transition) => transition === 'DEGRADED' || transition === 'CHANGED')) {
    slackDelivery = await postSlack(env, ':rotating_light: *Drapeon service incident changed*', summaryFor(results))
  } else if (transitions.some((transition) => transition === 'RECOVERED')) {
    slackDelivery = await postSlack(env, ':white_check_mark: *Drapeon services recovered*', summaryFor(results))
  }
  if (slackDelivery) {
    await Promise.all(results.map((result) => persistMonitorResult(env, result, checkedAt, currentFingerprint, correlationId, slackDelivery)))
  }

  const state = {
    environment: 'production',
    checkedAt,
    healthy,
    fingerprint: currentFingerprint,
    results,
    slackDelivery,
    correlationId,
    ledgerTransitions: transitions,
  }
  await env.HEALTH_STATE.put(STATE_KEY, JSON.stringify(state))
  console.log(JSON.stringify({ event: 'health_check_completed', ...state }))
  return state
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runChecks(env))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/health') return new Response('Not found', { status: 404 })
    const state = await env.HEALTH_STATE.get(STATE_KEY, 'json')
    if (!state) return Response.json({ ok: false, status: 'never_checked' }, { status: 503 })
    const ageMs = Date.now() - Date.parse(state.checkedAt)
    const monitorFresh = Number.isFinite(ageMs) && ageMs <= 12 * 60_000
    return Response.json({
      ok: monitorFresh && state.healthy === true,
      monitorFresh,
      ageMs,
      checkedAt: state.checkedAt,
      healthy: state.healthy,
      results: state.results,
      slackDelivery: state.slackDelivery,
    }, { status: monitorFresh && state.healthy === true ? 200 : 503 })
  },
}

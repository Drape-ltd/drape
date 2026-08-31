const STATE_KEY = 'drapeon-health-state-v1'
const REQUEST_TIMEOUT_MS = 12_000
const WARN_LATENCY_MS = 3_000

const targets = [
  {
    id: 'dev-ready',
    name: 'Drape DEV readiness',
    url: 'https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/service-health?check=ready&tier=beta',
    secret: 'DRAPE_HEALTHCHECK_SECRET',
  },
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
  if (failures.length === 0) return 'Drapeon development and production readiness are healthy.'
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
      text: `${heading}\n${summary}\nhttps://ops.drapeon.co/ops?view=workflow-issues`,
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

async function runChecks(env) {
  const checkedAt = new Date().toISOString()
  const results = await Promise.all(targets.map((target) => checkTarget(target, env)))
  const currentFingerprint = fingerprint(results)
  const healthy = results.every((result) => result.ok)
  const previous = await env.HEALTH_STATE.get(STATE_KEY, 'json')
  const changed = previous?.fingerprint !== currentFingerprint
  let slackDelivery = previous?.slackDelivery ?? null

  if (changed && !healthy) {
    slackDelivery = await postSlack(env, ':rotating_light: *Drapeon service incident changed*', summaryFor(results))
  } else if (changed && healthy && previous && previous.healthy === false) {
    slackDelivery = await postSlack(env, ':white_check_mark: *Drapeon services recovered*', summaryFor(results))
  }

  const state = { checkedAt, healthy, fingerprint: currentFingerprint, results, slackDelivery }
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

import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../lib/ops-auth'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { createHash } from 'node:crypto'
import { checkPublicRateLimit } from '../../../lib/request-security'
import { validateOpsMutationOrigin } from '../../../lib/ops-request-security'

type WebPushSubscriptionPayload = {
  endpoint?: unknown
  keys?: {
    p256dh?: unknown
    auth?: unknown
  }
}

const OPS_PUSH_SUBSCRIPTION_LIMIT = 5
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
])

function isAllowedPushHost(hostname: string) {
  const normalized = hostname.toLowerCase()
  return ALLOWED_PUSH_HOSTS.has(normalized) || normalized.endsWith('.notify.windows.com')
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

function brokerConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return null
  return { supabaseUrl: supabaseUrl.replace(/\/+$/u, ''), anonKey }
}

async function invokePushBroker(input: {
  request: Request
  action: 'REGISTER' | 'UNREGISTER'
  subscription: NonNullable<ReturnType<typeof readSubscription>>
}) {
  const config = brokerConfiguration()
  if (!config) return json({ ok: false, error: 'notification-broker-unconfigured' }, 503)

  const assertion = input.request.headers.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ ok: false, error: 'workforce-assertion-required' }, 401)
  const correlationId = input.request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ops-web-push-action`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-client-user-agent': input.request.headers.get('user-agent') ?? '',
      'x-drape-ops-access-assertion': assertion,
    },
    body: JSON.stringify({ action: input.action, subscription: input.subscription }),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({ error: 'notification-broker-invalid-response' })) as Record<string, unknown>
  return json(payload, response.status)
}

async function resolveLocalPrincipalId(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  email: string,
) {
  const { data, error } = await client
    .from('ops_workforce_principals')
    .select('id,status,permitted_environments,access_review_due_at')
    .eq('email', email)
    .maybeSingle()
  if (error || !data || data.status !== 'ACTIVE') return null
  if (!(data.permitted_environments ?? []).includes('development')) return null
  if (!data.access_review_due_at || Date.parse(data.access_review_due_at) <= Date.now()) return null
  return typeof data.id === 'string' ? data.id : null
}

function readSubscription(value: unknown, requireKeys = true) {
  const payload = value as WebPushSubscriptionPayload | null
  const endpoint = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : ''
  const p256dh = typeof payload?.keys?.p256dh === 'string' ? payload.keys.p256dh.trim() : null
  const auth = typeof payload?.keys?.auth === 'string' ? payload.keys.auth.trim() : null

  if (!endpoint || (requireKeys && (!p256dh || !auth))) return null

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || !isAllowedPushHost(url.hostname)) return null
  } catch {
    return null
  }

  return { endpoint, p256dh, auth }
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) return json({ ok: false, error: 'invalid-origin' }, 403)

  const session = await getOpsSession()
  if (!session || !session.email || session.mode === 'bootstrap-token') return json({ ok: false, error: 'named-workforce-session-required' }, 401)

  const body = await request.json().catch(() => null)
  const subscription = readSubscription(body?.subscription)
  if (!subscription) return json({ ok: false, error: 'invalid-subscription' }, 400)

  if (session.mode === 'cloudflare-access') {
    return invokePushBroker({ request, action: 'REGISTER', subscription })
  }

  const client = createServiceRoleClient()
  if (!client) return json({ ok: false, error: 'service-role-missing' }, 503)
  const principalId = session.principalId ?? await resolveLocalPrincipalId(client, session.email)
  if (!principalId) return json({ ok: false, error: 'local-workforce-principal-required' }, 403)

  const limiterKey = createHash('sha256').update(session.email).digest('hex').slice(0, 24)
  const rateLimit = await checkPublicRateLimit(client, `ops-push-register:${limiterKey}`, 10 * 60, 12)
  if (!rateLimit.ok) return json({ ok: false, error: 'rate-limit-unavailable' }, 503)
  if (!rateLimit.allowed) return json({ ok: false, error: 'rate-limited' }, 429)

  const { data: existing, error: existingError } = await client
    .from('web_push_subscriptions')
    .select('endpoint, ops_email, ops_principal_id, ops_environment')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle()
  if (existingError) return json({ ok: false, error: 'ownership-check-failed' }, 503)
  if (
    (existing?.ops_email && existing.ops_email !== session.email) ||
    (existing?.ops_principal_id && existing.ops_principal_id !== principalId) ||
    (existing?.ops_environment && existing.ops_environment !== 'development')
  ) {
    return json({ ok: false, error: 'subscription-owned-by-another-principal' }, 409)
  }

  const { count, error: countError } = await client
    .from('web_push_subscriptions')
    .select('endpoint', { count: 'exact', head: true })
    .eq('audience', 'OPS')
    .eq('ops_environment', 'development')
    .eq('ops_principal_id', principalId)
    .eq('enabled', true)
    .neq('endpoint', subscription.endpoint)
  if (countError) return json({ ok: false, error: 'subscription-cap-check-failed' }, 503)
  if ((count ?? 0) >= OPS_PUSH_SUBSCRIPTION_LIMIT) {
    return json({ ok: false, error: 'subscription-limit-reached' }, 409)
  }

  const { error } = await client
    .from('web_push_subscriptions')
    .upsert(
      {
        audience: 'OPS',
        user_id: null,
        ops_principal_id: principalId,
        ops_role: session.role,
        ops_email: session.email,
        ops_environment: 'development',
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        user_agent: request.headers.get('user-agent'),
        enabled: true,
        last_authenticated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
        failure_count: 0,
        last_seen_at: new Date().toISOString(),
        failed_at: null,
        failure_reason: null,
      },
      { onConflict: 'endpoint' },
    )

  if (error) return json({ ok: false, error: 'save-failed', detail: error.message }, 500)
  return json({ ok: true })
}

export async function DELETE(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) return json({ ok: false, error: 'invalid-origin' }, 403)

  const session = await getOpsSession()
  if (!session || !session.email || session.mode === 'bootstrap-token') return json({ ok: false, error: 'named-workforce-session-required' }, 401)

  const body = await request.json().catch(() => null)
  const subscription = readSubscription(body?.subscription, false)
  if (!subscription) return json({ ok: false, error: 'invalid-subscription' }, 400)

  if (session.mode === 'cloudflare-access') {
    return invokePushBroker({ request, action: 'UNREGISTER', subscription })
  }

  const client = createServiceRoleClient()
  if (!client) return json({ ok: false, error: 'service-role-missing' }, 503)
  const principalId = session.principalId ?? await resolveLocalPrincipalId(client, session.email)
  if (!principalId) return json({ ok: false, error: 'local-workforce-principal-required' }, 403)

  const { error } = await client
    .from('web_push_subscriptions')
    .update({ enabled: false, last_seen_at: new Date().toISOString() })
    .eq('audience', 'OPS')
    .eq('ops_environment', 'development')
    .eq('ops_principal_id', principalId)
    .eq('endpoint', subscription.endpoint)

  if (error) return json({ ok: false, error: 'unsubscribe-failed', detail: error.message }, 500)
  return json({ ok: true })
}

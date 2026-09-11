import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { canReadOpsAction, isActiveOpsReadPrincipal } from '../_shared/ops-read-policy.ts'

const FN = 'ops-web-push-action'
const SUBSCRIPTION_LIMIT = 5
const ALLOWED_PUSH_HOSTS = new Set(['fcm.googleapis.com', 'push.services.mozilla.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'])

function list(value: string | undefined) { return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean) }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function json(body: Record<string, unknown>, status: number, cors: HeadersInit) { return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' } }) }
function environment() { const value = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toLowerCase(); return value === 'development' || value === 'production' ? value : null }
function isAllowedPushHost(hostname: string) { const normalized = hostname.toLowerCase(); return ALLOWED_PUSH_HOSTS.has(normalized) || normalized.endsWith('.notify.windows.com') }

function readSubscription(value: unknown, requireKeys: boolean) {
  const payload = asRecord(value); const keys = asRecord(payload.keys)
  const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : ''
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : null
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : null
  if (!endpoint || endpoint.length > 2_048 || (requireKeys && (!p256dh || !auth))) return null
  try { const url = new URL(endpoint); if (url.protocol !== 'https:' || !isAllowedPushHost(url.hostname)) return null } catch { return null }
  if ((p256dh?.length ?? 0) > 512 || (auth?.length ?? 0) > 256) return null
  return { endpoint, p256dh, auth }
}

async function hashed(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()
  try {
    const identity = await verifyCloudflareOpsAccess(request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '', {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '', normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')), sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')), requireSensitive: false,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co', allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity) return json({ error: 'Workforce access is required.', correlationId }, 401, cors)

    const raw = await request.text()
    if (raw.length > 8_192) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = asRecord(JSON.parse(raw || '{}'))
    const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : ''
    if (action !== 'REGISTER' && action !== 'UNREGISTER') return json({ error: 'Invalid notification action.', correlationId }, 400, cors)
    const subscription = readSubscription(body.subscription, action === 'REGISTER')
    if (!subscription) return json({ error: 'Invalid push subscription.', correlationId }, 400, cors)

    const env = environment()
    if (!env) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const principalResult = await supabase.from('ops_workforce_principals').select('id,email,roles,permitted_environments,access_subject,session_revoked_before,access_review_due_at,status').eq('email', identity.email).maybeSingle()
    if (principalResult.error) throw principalResult.error
    const principal = principalResult.data
    if (!principal || !canReadOpsAction(principal.roles ?? [], 'session') || !isActiveOpsReadPrincipal({ status: principal.status, accessSubject: principal.access_subject, permittedEnvironments: principal.permitted_environments ?? [], sessionRevokedBefore: principal.session_revoked_before, accessReviewDueAt: principal.access_review_due_at, assertedSubject: identity.subject, assertionIssuedAt: identity.issuedAt, environment: env.toUpperCase() as 'DEVELOPMENT' | 'PRODUCTION' })) {
      return json({ error: 'Workforce principal is unavailable, expired, or revoked.', correlationId }, 403, cors)
    }

    const rateResult = await supabase.rpc('check_rate_limit', { p_key: `ops-push:${await hashed(identity.email)}:${action}`, p_window_seconds: 600, p_max_requests: 12 })
    if (rateResult.error) return json({ error: 'Rate limit is unavailable.', correlationId }, 503, cors)
    if (rateResult.data !== true) return json({ error: 'Too many notification changes.', correlationId }, 429, cors)

    if (action === 'UNREGISTER') {
      const result = await supabase.from('web_push_subscriptions').update({ enabled: false, last_seen_at: new Date().toISOString() }).eq('audience', 'OPS').eq('ops_environment', env).eq('ops_principal_id', principal.id).eq('endpoint', subscription.endpoint)
      if (result.error) throw result.error
      return json({ ok: true, correlationId }, 200, cors)
    }

    const existingResult = await supabase.from('web_push_subscriptions').select('endpoint,ops_email,ops_principal_id,ops_environment').eq('endpoint', subscription.endpoint).maybeSingle()
    if (existingResult.error) throw existingResult.error
    const existing = existingResult.data
    if ((existing?.ops_email && existing.ops_email !== identity.email) || (existing?.ops_principal_id && existing.ops_principal_id !== principal.id) || (existing?.ops_environment && existing.ops_environment !== env)) {
      return json({ error: 'This subscription belongs to another workforce identity or environment.', correlationId }, 409, cors)
    }
    const countResult = await supabase.from('web_push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('audience', 'OPS').eq('ops_environment', env).eq('ops_principal_id', principal.id).eq('enabled', true).neq('endpoint', subscription.endpoint)
    if (countResult.error) throw countResult.error
    if ((countResult.count ?? 0) >= SUBSCRIPTION_LIMIT) return json({ error: 'The five-device notification limit has been reached.', correlationId }, 409, cors)

    const userAgent = request.headers.get('x-drape-client-user-agent')?.trim().slice(0, 512) || null
    const saveResult = await supabase.from('web_push_subscriptions').upsert({ audience: 'OPS', user_id: null, ops_principal_id: principal.id, ops_role: String((principal.roles ?? [])[0] ?? 'ops'), ops_email: identity.email, ops_environment: env, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth, user_agent: userAgent, enabled: true, last_authenticated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(), failure_count: 0, last_seen_at: new Date().toISOString(), failed_at: null, failure_reason: null }, { onConflict: 'endpoint' })
    if (saveResult.error) throw saveResult.error
    return json({ ok: true, correlationId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The notification subscription could not be changed.', correlationId }, 500, cors)
  }
})

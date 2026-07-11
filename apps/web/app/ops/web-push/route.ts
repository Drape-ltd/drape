import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../lib/ops-auth'
import { createServiceRoleClient } from '../../../lib/server-supabase'

type WebPushSubscriptionPayload = {
  endpoint?: unknown
  keys?: {
    p256dh?: unknown
    auth?: unknown
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

function readSubscription(value: unknown) {
  const payload = value as WebPushSubscriptionPayload | null
  const endpoint = typeof payload?.endpoint === 'string' ? payload.endpoint.trim() : ''
  const p256dh = typeof payload?.keys?.p256dh === 'string' ? payload.keys.p256dh.trim() : null
  const auth = typeof payload?.keys?.auth === 'string' ? payload.keys.auth.trim() : null

  if (!endpoint || !endpoint.startsWith('https://')) return null

  return { endpoint, p256dh, auth }
}

export async function POST(request: Request) {
  const session = await getOpsSession()
  if (!session) return json({ ok: false, error: 'locked' }, 401)

  const client = createServiceRoleClient()
  if (!client) return json({ ok: false, error: 'service-role-missing' }, 503)

  const body = await request.json().catch(() => null)
  const subscription = readSubscription(body?.subscription)
  if (!subscription) return json({ ok: false, error: 'invalid-subscription' }, 400)

  const { error } = await client
    .from('web_push_subscriptions')
    .upsert(
      {
        audience: 'OPS',
        user_id: null,
        ops_role: session.role,
        ops_email: session.email,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        user_agent: request.headers.get('user-agent'),
        enabled: true,
        last_seen_at: new Date().toISOString(),
        failed_at: null,
        failure_reason: null,
      },
      { onConflict: 'endpoint' },
    )

  if (error) return json({ ok: false, error: 'save-failed', detail: error.message }, 500)
  return json({ ok: true })
}

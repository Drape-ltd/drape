import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { sendMoneyApprovalRequiredNotification } from '../_shared/ops-notifications.ts'

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function isServiceRoleRequest(request: Request) {
  const serviceRoleKey = getServiceRoleKey().trim()
  return request.headers.get('Authorization')?.trim() === `Bearer ${serviceRoleKey}` ||
    request.headers.get('apikey')?.trim() === serviceRoleKey
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  if (!isServiceRoleRequest(request)) return json({ error: 'Service authorization required.' }, 401, cors)

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    return json({ error: 'A valid Money Desk request is required.' }, 400, cors)
  }

  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const existing = await client.from('money_desk_events').select('id')
    .eq('request_id', requestId).eq('event_type', 'FOUNDER_APPROVAL_EMAIL_SENT').limit(1).maybeSingle()
  if (existing.data?.id) return json({ ok: true, status: 'already-sent' }, 200, cors)

  const record = await client.from('money_desk_requests')
    .select('id,reference,status,action_type,risk_level,requester_email,requester_role,reason,correlation_id')
    .eq('id', requestId).maybeSingle()
  if (record.error || !record.data) return json({ error: 'Money Desk request was not found.' }, 404, cors)
  if (record.data.status !== 'PENDING_APPROVAL') return json({ error: 'Money Desk request is not awaiting approval.' }, 409, cors)

  const delivery = await sendMoneyApprovalRequiredNotification({
    requestId,
    reference: String(record.data.reference),
    actionLabel: String(record.data.action_type).toLowerCase().replaceAll('_', ' '),
    riskLevel: String(record.data.risk_level),
    preparedBy: String(record.data.requester_email),
    reason: String(record.data.reason),
  }).catch(() => ({ ok: false as const, skipped: false as const }))
  await client.from('money_desk_events').insert({
    request_id: requestId,
    event_type: delivery.ok ? 'FOUNDER_APPROVAL_EMAIL_SENT' : delivery.skipped ? 'FOUNDER_APPROVAL_EMAIL_SKIPPED' : 'FOUNDER_APPROVAL_EMAIL_FAILED',
    actor_email: record.data.requester_email,
    actor_role: record.data.requester_role,
    payload: { deliveryId: 'deliveryId' in delivery ? delivery.deliveryId : null, source: 'notify-money-approval' },
    correlation_id: record.data.correlation_id,
  })
  return json({ ok: delivery.ok, status: delivery.ok ? 'sent' : delivery.skipped ? 'skipped' : 'failed' }, delivery.ok ? 200 : 503, cors)
})

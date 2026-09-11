import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface-policy'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin' }, 403)
  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !session.principalId || session.mode !== 'cloudflare-access') {
    return json({ error: 'named-cloudflare-workforce-session-required' }, 401)
  }

  const body = await request.json().catch(() => null) as { action?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : ''
  if (!['ACKNOWLEDGE', 'SNOOZE', 'RESOLVE'].includes(action)) return json({ error: 'invalid-action' }, 400)
  if (action === 'RESOLVE' && isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-only-action' }, 403)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return json({ error: 'ops-broker-unavailable' }, 503)

  const headerStore = await headers()
  const assertion = headerStore.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ error: 'cloudflare-access-assertion-required' }, 401)
  const correlationId = headerStore.get('x-correlation-id')?.trim() || randomUUID()
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/ops-incident-action`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({ error: 'invalid-broker-response', correlationId }))
  return json(payload as Record<string, unknown>, response.status)
}

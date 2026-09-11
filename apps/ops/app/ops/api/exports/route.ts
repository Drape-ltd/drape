import { randomUUID } from 'node:crypto'
import { after } from 'next/server'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { forwardOpsExportBrokerResponse, invokeOpsExportBroker } from '../../../../lib/export-broker'
import { generateLocalOpsExport, requestLocalOpsExport } from '../../../../lib/export-workflow'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function correlationIdFor(request: Request) {
  const value = request.headers.get('x-correlation-id')?.trim() ?? ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : randomUUID()
}

export async function POST(request: Request) {
  const correlationId = correlationIdFor(request)
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-only-action', correlationId }, 403)

  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) {
    return json({ error: 'named-workforce-session-required', correlationId }, 401)
  }
  if (!['admin', 'engineering'].includes(session.role)) {
    return json({ error: 'export-role-required', correlationId }, 403)
  }
  if (!hasFreshOpsMfa(session)) {
    return json({ error: 'fresh-mfa-assurance-required', correlationId }, 401)
  }

  const raw = await request.text()
  if (raw.length > 16_384) return json({ error: 'request-too-large', correlationId }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return json({ error: 'invalid-json', correlationId }, 400)
  }
  if (session.mode === 'cloudflare-access') {
    const response = await invokeOpsExportBroker(request, { ...body, action: 'REQUEST' }, correlationId)
    return forwardOpsExportBrokerResponse(response)
  }

  const client = createServiceRoleClient()
  if (!client) return json({ error: 'export-workflow-unavailable', correlationId }, 503)
  try {
    const result = await requestLocalOpsExport(client, session, body, correlationId)
    if (!result.ok) return json({ error: result.error, correlationId }, result.status)
    const exportRequestId = typeof result.export.id === 'string' ? result.export.id : ''
    const requestCorrelationId = typeof result.export.correlationId === 'string'
      ? result.export.correlationId
      : correlationId
    const status = typeof result.export.status === 'string' ? result.export.status : ''
    if (exportRequestId && (status === 'REQUESTED' || status === 'FAILED')) {
      after(async () => {
        try {
          await generateLocalOpsExport(client, exportRequestId, result.principalId, requestCorrelationId)
        } catch {
          // The generator persists a bounded FAILED outcome before this callback returns.
        }
      })
    }
    return json({ ok: true, duplicate: result.duplicate, export: result.export, correlationId }, 202)
  } catch {
    return json({ error: 'export-request-failed', correlationId }, 500)
  }
}

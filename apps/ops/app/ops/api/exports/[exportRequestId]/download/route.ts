import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../../../lib/client-surface'
import { forwardOpsExportBrokerResponse, invokeOpsExportBroker } from '../../../../../../lib/export-broker'
import { downloadLocalOpsExport } from '../../../../../../lib/export-workflow'

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ exportRequestId: string }> },
) {
  const correlationId = correlationIdFor(request)
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-only-action', correlationId }, 403)
  const exportRequestId = (await params).exportRequestId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(exportRequestId)) {
    return json({ error: 'invalid-export-request', correlationId }, 400)
  }

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

  if (session.mode === 'cloudflare-access') {
    const response = await invokeOpsExportBroker(request, {
      action: 'DOWNLOAD',
      exportRequestId,
    }, correlationId)
    return forwardOpsExportBrokerResponse(response)
  }

  const client = createServiceRoleClient()
  if (!client) return json({ error: 'export-workflow-unavailable', correlationId }, 503)
  try {
    const download = await downloadLocalOpsExport(client, session, exportRequestId, correlationId)
    if (!download) return json({ error: 'export-role-required', correlationId }, 403)
    const content = typeof download.content === 'string' ? download.content : ''
    const reference = typeof download.reference === 'string' ? download.reference : 'OPS-EXPORT'
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${reference}.csv"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Drape-Export-SHA256': typeof download.sha256 === 'string' ? download.sha256 : '',
        'X-Drape-Correlation-Id': correlationId,
      },
    })
  } catch {
    return json({ error: 'export-download-unavailable', correlationId }, 409)
  }
}

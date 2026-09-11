import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { loadCanonicalOpsData } from '../../../../lib/data'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-required', correlationId }, 403)

  const session = await getOpsSession()
  if (!session?.allowed || !isNamedOpsWorkforceSession(session) || session.role !== 'admin') {
    return json({ error: 'named-admin-session-required', correlationId }, 401)
  }
  if (!hasFreshOpsMfa(session)) return json({ error: 'protected-access-required', correlationId }, 401)
  if (session.mode === 'local-workforce' && !await resolveLocalWorkforcePrincipal(session)) {
    return json({ error: 'local-case-workforce-principal-unavailable', correlationId }, 403)
  }

  const raw = await request.text()
  if (raw.length > 2_048) return json({ error: 'request-too-large', correlationId }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return json({ error: 'invalid-json', correlationId }, 400)
  }
  const caseNumber = typeof body.caseNumber === 'string' ? body.caseNumber.trim().toUpperCase() : ''
  if (!/^OPS-[A-Z0-9-]{4,60}$/u.test(caseNumber)) return json({ error: 'invalid-case-number', correlationId }, 400)

  try {
    const data = await loadCanonicalOpsData({ caseNumber })
    const issue = data.issues[0]
    if (!issue || issue.case_number?.toUpperCase() !== caseNumber) return json({ error: 'case-not-found', correlationId }, 404)
    return json({
      ok: true,
      case: {
        id: issue.id,
        caseNumber: issue.case_number,
        title: issue.title,
        summary: issue.description,
        status: issue.canonical_status ?? issue.status,
        queueKey: issue.queue_key,
        priority: issue.priority,
        severity: issue.severity,
        recordVersion: issue.record_version,
      },
      correlationId,
    }, 200)
  } catch {
    return json({ error: 'case-lookup-failed', correlationId }, 500)
  }
}

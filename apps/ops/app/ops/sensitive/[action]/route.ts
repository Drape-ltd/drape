import { NextRequest, NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { sanitizeOpsRedirect } from '../../../../../web/lib/ops-request-security'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'

export const dynamic = 'force-dynamic'

const SENSITIVE_ACTIONS = new Set([
  'account-deletion',
  'case',
  'export',
  'money',
  'trust-decision',
  'workforce-access',
])

function withProtectedState(path: string, state: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}protected=${encodeURIComponent(state)}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const returnTo = sanitizeOpsRedirect(request, request.nextUrl.searchParams.get('returnTo'))
  const action = (await params).action.trim().toLowerCase()

  if (!SENSITIVE_ACTIONS.has(action)) {
    return NextResponse.redirect(new URL('/ops/my-work?protected=invalid-action', request.url), 303)
  }
  if (isRestrictedOpsPhoneHeaders(request.headers)) {
    return NextResponse.redirect(new URL('/ops/my-work?protected=desktop-required', request.url), 303)
  }

  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) {
    return NextResponse.redirect(new URL('/ops/my-work?protected=identity-required', request.url), 303)
  }
  if (!hasFreshOpsMfa(session)) {
    return NextResponse.redirect(new URL(withProtectedState(returnTo, 'step-up-required'), request.url), 303)
  }

  return NextResponse.redirect(new URL(withProtectedState(returnTo, 'verified'), request.url), 303)
}

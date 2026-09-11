import { NextRequest, NextResponse } from 'next/server'
import { sanitizeOpsRedirect } from '../../../../web/lib/ops-request-security'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const returnTo = sanitizeOpsRedirect(request, request.nextUrl.searchParams.get('returnTo'))
  return NextResponse.redirect(
    new URL(`/ops/sensitive/case?returnTo=${encodeURIComponent(returnTo)}`, request.url),
    308,
  )
}

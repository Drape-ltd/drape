import { NextResponse } from 'next/server'
import {
  getOpsAccessMode,
  OPS_SESSION_COOKIE,
  getOpsDashboardToken,
  getOpsDashboardTokenStatus,
  hashOpsToken,
  matchesOpsDashboardToken,
} from '../../../lib/ops-auth'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { checkPublicRateLimit, getClientIp } from '../../../lib/request-security'
import {
  buildCanonicalOpsUrl,
  sanitizeOpsRedirect,
  validateOpsMutationOrigin,
} from '../../../lib/ops-request-security'

function buildRedirect(request: Request, redirectTo: string, key: 'notice' | 'error', value: string) {
  const url = buildCanonicalOpsUrl(request, redirectTo)
  url.searchParams.set(key, value)
  return url
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) {
    return NextResponse.json(
      { ok: false, error: 'invalid-origin' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  const formData = await request.formData()
  const redirectTo = sanitizeOpsRedirect(request, formData.get('redirectTo'))
  const submitted = typeof formData.get('token') === 'string' ? formData.get('token')?.toString().trim() ?? '' : ''
  const expected = getOpsDashboardToken()
  const tokenStatus = getOpsDashboardTokenStatus()
  const mode = getOpsAccessMode()

  if (mode === 'cloudflare-access') {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'workforce-login-required'))
  }

  if (!expected) {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', tokenStatus === 'weak' ? 'weak-token' : 'setup-needed'))
  }

  const client = createServiceRoleClient()
  if (!client) {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'service-role-missing'))
  }

  const ip = getClientIp(request)
  const limit = await checkPublicRateLimit(client, `ops-login:${ip}`, 15 * 60, 5)
  if (!limit.ok || !limit.allowed) {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'too-many-attempts'))
  }

  if (!submitted || !matchesOpsDashboardToken(submitted)) {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'invalid-token'))
  }

  const response = NextResponse.redirect(buildRedirect(request, redirectTo, 'notice', 'ops-unlocked'))
  response.cookies.set(OPS_SESSION_COOKIE, hashOpsToken(expected), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/ops',
    maxAge: 60 * 60 * 12,
  })

  return response
}

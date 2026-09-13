import { NextResponse } from 'next/server'
import { getOpsAccessMode, getOpsSession, OPS_SESSION_COOKIE } from '../../../lib/ops-auth'
import { buildCanonicalOpsUrl, validateOpsMutationOrigin } from '../../../lib/ops-request-security'
import { createServiceRoleClient } from '../../../lib/server-supabase'

function expiredOpsCookie(path: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${OPS_SESSION_COOKIE}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Strict${secure}`
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) {
    return NextResponse.json(
      { ok: false, error: 'invalid-origin' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  const session = await getOpsSession()
  if (session?.principalId) {
    const client = createServiceRoleClient()
    if (client) {
      await client
        .from('web_push_subscriptions')
        .update({ enabled: false, last_seen_at: new Date().toISOString() })
        .eq('audience', 'OPS')
        .eq('ops_principal_id', session.principalId)
    }
  }

  const mode = getOpsAccessMode()
  const url =
    mode === 'cloudflare-access'
      ? buildCanonicalOpsUrl(request, '/cdn-cgi/access/logout')
      : buildCanonicalOpsUrl(request, '/ops/my-work')

  if (mode !== 'cloudflare-access') {
    url.searchParams.set('notice', 'ops-signed-out')
  }

  // Sign-out is a POST, but both the local landing page and Cloudflare's logout
  // endpoint must be loaded with GET after the session cookie is cleared.
  const response = NextResponse.redirect(url, 303)
  response.cookies.set(OPS_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/ops',
    expires: new Date(0),
    maxAge: 0,
  })
  response.headers.append('Set-Cookie', expiredOpsCookie('/'))
  return response
}

import { NextResponse } from 'next/server'
import { getOpsAccessMode, OPS_SESSION_COOKIE } from '../../../lib/ops-auth'

export async function POST(request: Request) {
  const mode = getOpsAccessMode()
  const url =
    mode === 'cloudflare-access'
      ? new URL('/cdn-cgi/access/logout', request.url)
      : new URL('/ops', request.url)

  if (mode !== 'cloudflare-access') {
    url.searchParams.set('notice', 'ops-signed-out')
  }

  const response = NextResponse.redirect(url)
  response.cookies.delete(OPS_SESSION_COOKIE)
  return response
}

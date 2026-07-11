import { NextResponse } from 'next/server'
import { getOpsAccessMode, OPS_SESSION_COOKIE } from '../../../lib/ops-auth'

function requestOrigin(request: Request) {
  const host = request.headers.get('host')?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return host ? `${protocol}://${host}` : request.url
}

function expiredOpsCookie(path: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${OPS_SESSION_COOKIE}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Strict${secure}`
}

export async function POST(request: Request) {
  const mode = getOpsAccessMode()
  const url =
    mode === 'cloudflare-access'
      ? new URL('/cdn-cgi/access/logout', requestOrigin(request))
      : new URL('/ops', requestOrigin(request))

  if (mode !== 'cloudflare-access') {
    url.searchParams.set('notice', 'ops-signed-out')
  }

  const response = NextResponse.redirect(url)
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

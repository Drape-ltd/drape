import { NextResponse } from 'next/server'
import {
  getOpsAccessMode,
  getOpsDashboardToken,
  hashOpsToken,
  OPS_SESSION_COOKIE,
} from '../../../../web/lib/ops-auth'

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || getOpsAccessMode() !== 'local-workforce') {
    return new Response('Not found.', {
      status: 404,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    })
  }

  const token = getOpsDashboardToken()
  if (!token) {
    return new Response('Local workforce access is not configured.', {
      status: 503,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    })
  }

  const response = NextResponse.redirect(new URL('/ops/my-work?notice=ops-unlocked', request.url), 307)
  response.cookies.set(OPS_SESSION_COOKIE, hashOpsToken(token), {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/ops',
    maxAge: 60 * 60 * 12,
  })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return response
}

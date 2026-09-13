import { NextResponse } from 'next/server'
import {
  createLocalWorkforceSessionValue,
  getOpsAccessMode,
  getLocalWorkforceDryRunIdentity,
  OPS_SESSION_COOKIE,
} from '../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../web/lib/ops-request-security'

function unavailable() {
  return new Response('Not found.', {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || getOpsAccessMode() !== 'local-workforce') {
    return unavailable()
  }

  const response = NextResponse.redirect(new URL('/ops/my-work?notice=ops-signed-out', request.url), 303)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' || getOpsAccessMode() !== 'local-workforce') {
    return unavailable()
  }

  const originCheck = validateOpsMutationOrigin(request)
  const isSameOriginUserNavigation =
    originCheck.receivedOrigin === null &&
    originCheck.fetchSite === 'same-origin' &&
    request.headers.get('sec-fetch-mode')?.trim().toLowerCase() === 'navigate' &&
    request.headers.get('sec-fetch-dest')?.trim().toLowerCase() === 'document' &&
    request.headers.get('sec-fetch-user')?.trim() === '?1'
  if (!originCheck.ok && !isSameOriginUserNavigation) {
    return NextResponse.json({ ok: false, error: 'invalid-origin' }, { status: 403 })
  }

  const identity = getLocalWorkforceDryRunIdentity()
  const sessionValue = identity ? createLocalWorkforceSessionValue(identity) : null
  if (!identity || !sessionValue) {
    return NextResponse.json({ ok: false, error: 'local-workforce-unconfigured' }, { status: 503 })
  }

  const response = NextResponse.redirect(new URL('/ops/my-work?notice=ops-unlocked', request.url), 303)
  response.cookies.set(OPS_SESSION_COOKIE, sessionValue, {
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

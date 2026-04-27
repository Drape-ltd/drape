import { NextResponse } from 'next/server'
import {
  getOpsAccessMode,
  OPS_SESSION_COOKIE,
  getOpsDashboardToken,
  hashOpsToken,
  matchesOpsDashboardToken,
} from '../../../lib/ops-auth'

function sanitizeRedirect(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.startsWith('/ops')) return '/ops'
  return value
}

function buildRedirect(request: Request, redirectTo: string, key: 'notice' | 'error', value: string) {
  const url = new URL(redirectTo, request.url)
  url.searchParams.set(key, value)
  return url
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const redirectTo = sanitizeRedirect(formData.get('redirectTo'))
  const submitted = typeof formData.get('token') === 'string' ? formData.get('token')?.toString().trim() ?? '' : ''
  const expected = getOpsDashboardToken()
  const mode = getOpsAccessMode()

  if (mode === 'cloudflare-access') {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'workforce-login-required'))
  }

  if (!expected) {
    return NextResponse.redirect(buildRedirect(request, redirectTo, 'error', 'setup-needed'))
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

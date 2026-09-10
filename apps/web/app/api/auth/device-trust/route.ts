import { NextRequest, NextResponse } from 'next/server'
import { DEVICE_TRUST_REMEMBER_DAYS } from '@drape/shared'
import { getSupabasePublishableKey, getSupabaseUrl } from '../../../../lib/supabase-config'

const TOKEN_COOKIE = 'drapeon.deviceTrust'
const DEVICE_ID_COOKIE = 'drapeon.deviceTrustId'
const PENDING_COOKIE = 'drapeon.deviceChallenge'

function cookieBase(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production',
    path: '/',
  }
}

function clearCookie(response: NextResponse, request: NextRequest, name: string) {
  response.cookies.set(name, '', { ...cookieBase(request), maxAge: 0 })
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Sign in again before verifying this device.' }, { status: 401 })
  }
  const supabaseUrl = getSupabaseUrl()
  const publishableKey = getSupabasePublishableKey()
  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json({ error: 'Device verification is not configured.' }, { status: 503 })
  }

  const input = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!input || typeof input.action !== 'string') {
    return NextResponse.json({ error: 'Invalid device verification request.' }, { status: 400 })
  }

  const body = { ...input }
  if (input.action === 'assess' || input.action === 'list') {
    body.deviceToken = request.cookies.get(TOKEN_COOKIE)?.value
  }

  const upstream = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/trusted-device-action`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await upstream.json().catch(() => ({ error: 'Device verification returned an invalid response.' })) as Record<string, unknown>
  const clientPayload = { ...payload }
  delete clientPayload.token
  const response = NextResponse.json(clientPayload, { status: upstream.status })
  response.headers.set('Cache-Control', 'no-store')

  if (input.action === 'assess') {
    if (payload.trusted === true) {
      clearCookie(response, request, PENDING_COOKIE)
    } else if (typeof payload.challengeId === 'string') {
      response.cookies.set(PENDING_COOKIE, payload.challengeId, {
        ...cookieBase(request),
        maxAge: 10 * 60,
      })
    }
  }

  if (input.action === 'verify' && payload.trusted === true && typeof payload.token === 'string') {
    const remembered = payload.remembered === true
    response.cookies.set(TOKEN_COOKIE, payload.token, {
      ...cookieBase(request),
      ...(remembered ? { maxAge: DEVICE_TRUST_REMEMBER_DAYS * 24 * 60 * 60 } : {}),
    })
    if (typeof payload.deviceId === 'string') {
      response.cookies.set(DEVICE_ID_COOKIE, payload.deviceId, {
        ...cookieBase(request),
        ...(remembered ? { maxAge: DEVICE_TRUST_REMEMBER_DAYS * 24 * 60 * 60 } : {}),
      })
    }
    clearCookie(response, request, PENDING_COOKIE)
  }

  const currentDeviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value
  if (
    (input.action === 'revoke' && input.deviceId === currentDeviceId) ||
    (input.action === 'revoke-all' && input.exceptDeviceId !== currentDeviceId)
  ) {
    clearCookie(response, request, TOKEN_COOKIE)
    clearCookie(response, request, DEVICE_ID_COOKIE)
  }

  return response
}

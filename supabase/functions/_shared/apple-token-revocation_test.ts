import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { revokeAppleAuthorizationCode } from './apple-token-revocation.ts'

function pemFromBytes(bytes: ArrayBuffer) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).match(/.{1,64}/gu)?.join('\n') ?? ''
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`
}

Deno.test('exchanges an Apple authorization code and revokes the refresh token', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const privateKey = pemFromBytes(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const requests: Array<{ url: string; body: string }> = []
  const fetcher: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, body: String(init?.body ?? '') })
    if (url.endsWith('/auth/token')) {
      return Response.json({ access_token: 'access-value', refresh_token: 'refresh-value' })
    }
    return new Response(null, { status: 200 })
  }) as typeof fetch

  const result = await revokeAppleAuthorizationCode('one-time-code', {
    teamId: 'W84Q46T4XF',
    keyId: 'NAGDGCN4R6',
    clientId: 'co.drapeon.app',
    privateKey,
  }, fetcher)

  assertEquals(result, { ok: true, tokenType: 'refresh_token' })
  assertEquals(requests.length, 2)
  assertStringIncludes(requests[0].body, 'code=one-time-code')
  assertStringIncludes(requests[1].body, 'token=refresh-value')
  assertStringIncludes(requests[1].body, 'token_type_hint=refresh_token')
})

Deno.test('does not call revoke when Apple code exchange fails', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const privateKey = pemFromBytes(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let calls = 0
  const fetcher: typeof fetch = (async () => {
    calls += 1
    return Response.json({ error: 'invalid_grant' }, { status: 400 })
  }) as typeof fetch

  const result = await revokeAppleAuthorizationCode('expired-code', {
    teamId: 'W84Q46T4XF',
    keyId: 'NAGDGCN4R6',
    clientId: 'co.drapeon.app',
    privateKey,
  }, fetcher)

  assertEquals(result, { ok: false, stage: 'exchange', error: 'invalid_grant' })
  assertEquals(calls, 1)
})

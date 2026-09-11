import { assert, assertEquals } from 'jsr:@std/assert@1'
import { resetOpsAccessKeyCacheForTests, verifyCloudflareOpsAccess } from './ops-access.ts'

function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function fixture(overrides: Record<string, unknown> = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey & { kid?: string }
  jwk.kid = 'test-key'
  const now = 2_000_000_000
  const header = encode({ alg: 'RS256', kid: 'test-key' })
  const payload = encode({
    iss: 'https://drapeon.cloudflareaccess.com',
    aud: ['normal-audience', 'sensitive-audience'],
    sub: 'access-subject',
    email: 'operator@drapeon.co',
    amr: ['mfa'],
    iat: now - 20,
    nbf: now - 20,
    exp: now + 300,
    ...overrides,
  })
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return {
    token: `${header}.${payload}.${encodedSignature}`,
    now,
    fetcher: () => Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })),
  }
}

const config = {
  teamDomain: 'drapeon.cloudflareaccess.com',
  normalAudiences: ['normal-audience'],
  sensitiveAudiences: ['sensitive-audience'],
  requireSensitive: true,
}

Deno.test('verifies a recent sensitive Cloudflare Access assertion', async () => {
  resetOpsAccessKeyCacheForTests()
  const value = await fixture()
  const identity = await verifyCloudflareOpsAccess(value.token, config, { fetcher: value.fetcher, nowSeconds: value.now })
  assert(identity)
  assertEquals(identity.email, 'operator@drapeon.co')
  assertEquals(identity.sensitiveAssurance, true)
})

Deno.test('rejects the wrong audience', async () => {
  resetOpsAccessKeyCacheForTests()
  const value = await fixture({ aud: ['different-audience'] })
  assertEquals(await verifyCloudflareOpsAccess(value.token, config, { fetcher: value.fetcher, nowSeconds: value.now }), null)
})

Deno.test('rejects stale sensitive assurance', async () => {
  resetOpsAccessKeyCacheForTests()
  const value = await fixture({ iat: 2_000_000_000 - 901 })
  assertEquals(await verifyCloudflareOpsAccess(value.token, config, { fetcher: value.fetcher, nowSeconds: value.now }), null)
})

Deno.test('rejects tokens without the temporal claims required for revocation', async () => {
  for (const overrides of [{ iat: undefined }, { exp: undefined }, { exp: 1_999_999_900 }]) {
    resetOpsAccessKeyCacheForTests()
    const value = await fixture(overrides)
    assertEquals(await verifyCloudflareOpsAccess(value.token, { ...config, requireSensitive: false }, { fetcher: value.fetcher, nowSeconds: value.now }), null)
  }
})

Deno.test('rejects tokens without a signed subject or email identity', async () => {
  for (const overrides of [{ sub: undefined }, { sub: ' ' }, { email: undefined }, { email: ' ' }]) {
    resetOpsAccessKeyCacheForTests()
    const value = await fixture(overrides)
    assertEquals(await verifyCloudflareOpsAccess(value.token, { ...config, requireSensitive: false }, { fetcher: value.fetcher, nowSeconds: value.now }), null)
  }
})

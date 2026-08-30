const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token'
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

type AppleRevocationConfig = {
  teamId: string
  keyId: string
  clientId: string
  privateKey: string
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function pemBytes(pem: string) {
  const encoded = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replaceAll(/\s/gu, '')
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function appleRevocationConfigFromEnv(): AppleRevocationConfig | null {
  const teamId = Deno.env.get('APPLE_TEAM_ID')?.trim()
  const keyId = Deno.env.get('APPLE_SIGN_IN_KEY_ID')?.trim()
  const clientId = Deno.env.get('APPLE_SIGN_IN_CLIENT_ID')?.trim()
  const privateKey = Deno.env.get('APPLE_SIGN_IN_PRIVATE_KEY')?.replaceAll('\\n', '\n').trim()
  return teamId && keyId && clientId && privateKey
    ? { teamId, keyId, clientId, privateKey }
    : null
}

async function createClientSecret(config: AppleRevocationConfig, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
  const payload = base64Url(JSON.stringify({
    iss: config.teamId,
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: 'https://appleid.apple.com',
    sub: config.clientId,
  }))
  const signingInput = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

export async function revokeAppleAuthorizationCode(
  authorizationCode: string,
  config: AppleRevocationConfig,
  fetcher: typeof fetch = fetch,
) {
  const clientSecret = await createClientSecret(config)
  const tokenResponse = await fetcher(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  })
  const tokenBody = await tokenResponse.json().catch(() => ({})) as {
    access_token?: string
    refresh_token?: string
    error?: string
  }
  if (!tokenResponse.ok || (!tokenBody.refresh_token && !tokenBody.access_token)) {
    return { ok: false as const, stage: 'exchange' as const, error: tokenBody.error ?? `HTTP_${tokenResponse.status}` }
  }

  const token = tokenBody.refresh_token ?? tokenBody.access_token!
  const tokenTypeHint = tokenBody.refresh_token ? 'refresh_token' : 'access_token'
  const revokeResponse = await fetcher(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokenTypeHint,
    }),
  })
  if (!revokeResponse.ok) {
    const revokeBody = await revokeResponse.json().catch(() => ({})) as { error?: string }
    return { ok: false as const, stage: 'revoke' as const, error: revokeBody.error ?? `HTTP_${revokeResponse.status}` }
  }
  return { ok: true as const, tokenType: tokenTypeHint }
}

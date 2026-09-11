import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { encryptWebPushPayload } from './web-push.ts'

function concatBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function bytesBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmacSha256(keyBytes: Uint8Array, value: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    bytesBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytesBuffer(value)))
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])))
  return block.slice(0, length)
}

Deno.test('encryptWebPushPayload emits a decryptable aes128gcm record with exact Ops context', async () => {
  const clientKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const clientPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', clientKeys.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  const payload = {
    path: '/ops/cases/OPS-ABC12345',
    correlationKey: 'ops-case:OPS-ABC12345',
  }

  const record = await encryptWebPushPayload({
    p256dh: bytesToBase64Url(clientPublicBytes),
    auth: bytesToBase64Url(authSecret),
  }, payload)

  const salt = record.slice(0, 16)
  assertEquals(new DataView(record.buffer, record.byteOffset + 16, 4).getUint32(0), 4_096)
  const serverPublicLength = record[20]
  assertEquals(serverPublicLength, 65)
  const serverPublicBytes = record.slice(21, 21 + serverPublicLength)
  const ciphertext = record.slice(21 + serverPublicLength)
  const serverPublicKey = await crypto.subtle.importKey(
    'raw',
    bytesBuffer(serverPublicBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPublicKey },
    clientKeys.privateKey,
    256,
  ))
  const authenticationPrk = await hmacSha256(authSecret, sharedSecret)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicBytes,
    serverPublicBytes,
  )
  const ikm = await hkdfExpand(authenticationPrk, keyInfo, 32)
  const contentPrk = await hmacSha256(salt, ikm)
  const contentEncryptionKey = await hkdfExpand(
    contentPrk,
    new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    16,
  )
  const nonce = await hkdfExpand(
    contentPrk,
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    12,
  )
  const key = await crypto.subtle.importKey('raw', bytesBuffer(contentEncryptionKey), 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    bytesBuffer(ciphertext),
  ))

  assertEquals(plaintext.at(-1), 2)
  assertEquals(JSON.parse(new TextDecoder().decode(plaintext.slice(0, -1))), payload)
})

Deno.test('encryptWebPushPayload rejects absent or malformed subscription encryption keys', async () => {
  await assertRejects(
    () => encryptWebPushPayload({ p256dh: null, auth: null }, { path: '/ops', correlationKey: 'ops' }),
    Error,
    'missing encryption keys',
  )
  await assertRejects(
    () => encryptWebPushPayload({ p256dh: 'AA', auth: 'AA' }, { path: '/ops', correlationKey: 'ops' }),
    Error,
    'invalid encryption keys',
  )
})

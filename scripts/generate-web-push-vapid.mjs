import { createECDH } from 'node:crypto'

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()

const publicKey = ecdh.getPublicKey(null, 'uncompressed')
const privateKey = ecdh.getPrivateKey()

console.log('WEB_PUSH_VAPID_PUBLIC_KEY=' + base64Url(publicKey))
console.log('WEB_PUSH_VAPID_PRIVATE_KEY=' + base64Url(privateKey))
console.log('WEB_PUSH_VAPID_SUBJECT=mailto:ops@drapeon.co')

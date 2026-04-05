import { getServiceRoleKey } from './env.ts'
import { log } from './logger.ts'

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashLeft, hashRight] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])

  const leftBytes = new Uint8Array(hashLeft)
  const rightBytes = new Uint8Array(hashRight)
  let diff = 0

  for (let index = 0; index < 32; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index]
  }

  return diff === 0
}

export async function authorizeCronRequest(
  req: Request,
  fn: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const serviceRoleKey = getServiceRoleKey()
  const authorized = token.length > 0 && await timingSafeEqual(token, serviceRoleKey)

  if (authorized) return null

  log('warn', fn, 'auth.unauthorized')
  return new Response('Unauthorized', { status: 401, headers: cors })
}

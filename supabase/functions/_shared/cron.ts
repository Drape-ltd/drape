import { isTrustedServiceRoleToken } from './env.ts'
import { log } from './logger.ts'

export async function authorizeCronRequest(
  req: Request,
  fn: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (req.method !== 'POST') {
    log('warn', fn, 'method.not_allowed', { method: req.method })
    return new Response(
      JSON.stringify({
        error: 'Scheduled jobs must be invoked with POST.',
        message: 'Scheduled jobs must be invoked with POST.',
      }),
      {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    )
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const authorized = await isTrustedServiceRoleToken(token)

  if (authorized) return null

  log('warn', fn, 'auth.unauthorized')
  return new Response(
    JSON.stringify({
      error: 'This scheduled job requires a trusted service request.',
      message: 'This scheduled job requires a trusted service request.',
    }),
    {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    },
  )
}

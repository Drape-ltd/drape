import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const OPS_SESSION_COOKIE = 'drape_ops_session'

export function getOpsDashboardToken() {
  const token = process.env.OPS_DASHBOARD_TOKEN?.trim()
  return token && token.length > 0 ? token : null
}

export function hasOpsDashboardToken() {
  return getOpsDashboardToken() !== null
}

export function hashOpsToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function safeCompare(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right || left.length !== right.length) return false

  try {
    return timingSafeEqual(Buffer.from(left), Buffer.from(right))
  } catch {
    return false
  }
}

export function matchesOpsDashboardToken(candidate: string | null | undefined) {
  return safeCompare(candidate?.trim() ?? null, getOpsDashboardToken())
}

export async function hasOpsAccess() {
  const token = getOpsDashboardToken()
  if (!token) return false

  const cookieStore = await cookies()
  const session = cookieStore.get(OPS_SESSION_COOKIE)?.value ?? null

  return safeCompare(session, hashOpsToken(token))
}

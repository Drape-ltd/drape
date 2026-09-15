const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * @param {string | undefined} value
 */
function projectRef(value) {
  try {
    const url = new URL(value ?? '')
    if (url.protocol === 'https:' && url.hostname === 'auth.drapeon.co') return 'wkfsrunetmgjdtcurmoj'
    const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/u)
    return url.protocol === 'https:' ? match?.[1] ?? null : null
  } catch {
    return null
  }
}

/**
 * @typedef {{
 *   nodeEnvironment: string | undefined
 *   hostname: string
 *   expectedHostname: string | undefined
 *   opsEnvironment: string | undefined
 *   expectedProjectRef: string | undefined
 *   supabaseUrl: string | undefined
 *   accessTeamDomain: string | undefined
 *   normalAudience: string | undefined
 *   sensitiveAudience: string | undefined
 *   sharedToken: string | undefined
 *   bootstrapFlag: string | undefined
 *   localWorkforceFlag: string | undefined
 * }} RuntimeBoundaryInput
 */

/**
 * Evaluate the public runtime boundary without logging secret values.
 * Local development remains available, while every non-local production
 * request must satisfy the complete hostname, target, and Access contract.
 *
 * @param {RuntimeBoundaryInput} input
 * @returns {null | { status: 404 | 503; code: string }}
 */
export function evaluateOpsRuntimeBoundary(input) {
  const observedHost = input.hostname.trim().toLowerCase()
  if (input.nodeEnvironment !== 'production' || LOCAL_HOSTS.has(observedHost)) return null

  const expectedHost = (input.expectedHostname ?? '').trim().toLowerCase()
  if (!expectedHost || observedHost !== expectedHost) return { status: 404, code: 'host-denied' }
  if ((input.opsEnvironment ?? '').trim().toLowerCase() !== 'production') return { status: 503, code: 'environment-mismatch' }

  const expectedProject = (input.expectedProjectRef ?? '').trim()
  if (!expectedProject || projectRef(input.supabaseUrl) !== expectedProject) return { status: 503, code: 'project-mismatch' }

  if (!input.accessTeamDomain?.trim() || !input.normalAudience?.trim() || !input.sensitiveAudience?.trim()) {
    return { status: 503, code: 'access-incomplete' }
  }
  if (input.sharedToken?.trim() || input.bootstrapFlag?.trim() || input.localWorkforceFlag?.trim()) {
    return { status: 503, code: 'forbidden-bootstrap-config' }
  }
  return null
}

export const OPS_ACCESS_CERT_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * A previously verified signing-key set may preserve read-only workforce access
 * during a short issuer outage. It never crosses issuer boundaries and expires
 * after the reviewed 24-hour ceiling.
 *
 * @param {{ ageMs: number; issuerMatches: boolean; keyCount: number }} input
 * @returns {'stale' | 'reject'}
 */
export function accessCertificateFallbackState(input) {
  return input.issuerMatches
    && Number.isFinite(input.ageMs)
    && input.ageMs >= 0
    && input.ageMs < OPS_ACCESS_CERT_STALE_MAX_AGE_MS
    && Number.isInteger(input.keyCount)
    && input.keyCount > 0
    ? 'stale'
    : 'reject'
}

/**
 * Sensitive Ops actions require a freshly fetched signing-key set in addition
 * to the dedicated audience and recent MFA assertion.
 *
 * @param {'fresh' | 'stale' | 'not-applicable'} state
 */
export function accessCertificateAllowsSensitiveAction(state) {
  return state === 'fresh'
}

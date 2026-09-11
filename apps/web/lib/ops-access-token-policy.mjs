export const OPS_ACCESS_CLOCK_SKEW_SECONDS = 30

/**
 * Validate the Access claims that make expiry and principal revocation
 * enforceable before any signing-key lookup or database read occurs.
 *
 * @param {{ exp?: unknown; iat?: unknown; nbf?: unknown; sub?: unknown; email?: unknown }} claims
 * @param {number} nowSeconds
 */
export function hasValidOpsAccessTokenClaims(claims, nowSeconds) {
  if (!Number.isFinite(nowSeconds)) return false
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) return false
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return false
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf))) return false
  if (claims.iat > nowSeconds + OPS_ACCESS_CLOCK_SKEW_SECONDS) return false
  if (claims.exp <= nowSeconds - OPS_ACCESS_CLOCK_SKEW_SECONDS) return false
  if (claims.exp <= claims.iat) return false
  if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0) return false
  if (typeof claims.email !== 'string' || claims.email.trim().length === 0) return false
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + OPS_ACCESS_CLOCK_SKEW_SECONDS) return false
  return true
}

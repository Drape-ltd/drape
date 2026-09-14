export type AuthAccountRole = 'CUSTOMER' | 'TAILOR'

export function asAuthAccountRole(value: unknown): AuthAccountRole | null {
  return value === 'CUSTOMER' || value === 'TAILOR' ? value : null
}

export function resolveAuthenticatedRole(input: {
  establishedRole: unknown
  onboardingRole?: unknown
  entryIntent?: unknown
}): AuthAccountRole | null {
  return (
    asAuthAccountRole(input.establishedRole) ??
    asAuthAccountRole(input.onboardingRole) ??
    asAuthAccountRole(input.entryIntent)
  )
}

export function shouldBootstrapRole(establishedRole: unknown, entryIntent: unknown) {
  return asAuthAccountRole(establishedRole) === null && asAuthAccountRole(entryIntent) !== null
}

export function resolveAccountRuntimeRole(input: {
  requestedRole: unknown
  hasTailorProfile: boolean
}): AuthAccountRole {
  return asAuthAccountRole(input.requestedRole) ?? (input.hasTailorProfile ? 'TAILOR' : 'CUSTOMER')
}

export function shouldApplyFreshSignupRole(input: {
  intentMode: unknown
  intentRole: unknown
  createdAt: unknown
  lastSignInAt: unknown
}) {
  if (input.intentMode !== 'sign-up' || asAuthAccountRole(input.intentRole) === null) return false
  if (typeof input.createdAt !== 'string' || typeof input.lastSignInAt !== 'string') return false

  const createdAt = Date.parse(input.createdAt)
  const lastSignInAt = Date.parse(input.lastSignInAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) return false

  // Supabase creates OAuth users with a CUSTOMER mirror before the browser can
  // apply Drapeon's role choice. Only treat that mirror as provisional when
  // this callback is also the account's first sign-in. Existing accounts keep
  // their established role even if someone enters through the sign-up page.
  return Math.abs(lastSignInAt - createdAt) <= 2 * 60_000
}

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

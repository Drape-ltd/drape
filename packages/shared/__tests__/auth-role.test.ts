import {
  resolveAuthenticatedRole,
  shouldBootstrapRole,
} from '../src/auth-role'

describe('provider auth role resolution', () => {
  it('preserves an established role over a different entry intent', () => {
    expect(resolveAuthenticatedRole({
      establishedRole: 'TAILOR',
      onboardingRole: 'CUSTOMER',
      entryIntent: 'CUSTOMER',
    })).toBe('TAILOR')
  })

  it('uses onboarding intent only for a role-less account', () => {
    expect(resolveAuthenticatedRole({
      establishedRole: null,
      onboardingRole: 'CUSTOMER',
      entryIntent: 'TAILOR',
    })).toBe('CUSTOMER')
  })

  it('uses the entry intent as the final first-account bootstrap fallback', () => {
    expect(resolveAuthenticatedRole({
      establishedRole: null,
      onboardingRole: null,
      entryIntent: 'TAILOR',
    })).toBe('TAILOR')
  })

  it('never reapplies entry intent to an established account', () => {
    expect(shouldBootstrapRole('CUSTOMER', 'TAILOR')).toBe(false)
    expect(shouldBootstrapRole(null, 'TAILOR')).toBe(true)
  })
})

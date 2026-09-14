import {
  isFreshProviderAccount,
  resolveAccountRuntimeRole,
  resolveAuthenticatedRole,
  shouldApplyFreshSignupRole,
  shouldBootstrapRole,
  shouldChooseRoleAfterFreshProviderSignIn,
} from '../src/auth-role'

describe('provider auth role resolution', () => {
  it('preserves an established role over a different entry intent', () => {
    expect(
      resolveAuthenticatedRole({
        establishedRole: 'TAILOR',
        onboardingRole: 'CUSTOMER',
        entryIntent: 'CUSTOMER',
      })
    ).toBe('TAILOR')
  })

  it('uses onboarding intent only for a role-less account', () => {
    expect(
      resolveAuthenticatedRole({
        establishedRole: null,
        onboardingRole: 'CUSTOMER',
        entryIntent: 'TAILOR',
      })
    ).toBe('CUSTOMER')
  })

  it('uses the entry intent as the final first-account bootstrap fallback', () => {
    expect(
      resolveAuthenticatedRole({
        establishedRole: null,
        onboardingRole: null,
        entryIntent: 'TAILOR',
      })
    ).toBe('TAILOR')
  })

  it('never reapplies entry intent to an established account', () => {
    expect(shouldBootstrapRole('CUSTOMER', 'TAILOR')).toBe(false)
    expect(shouldBootstrapRole(null, 'TAILOR')).toBe(true)
  })

  it('keeps a confirmed tailor role while its required profile is being created', () => {
    expect(resolveAccountRuntimeRole({ requestedRole: 'TAILOR', hasTailorProfile: false })).toBe(
      'TAILOR'
    )
  })

  it('only infers the role from a profile when no account role exists', () => {
    expect(resolveAccountRuntimeRole({ requestedRole: null, hasTailorProfile: true })).toBe(
      'TAILOR'
    )
    expect(resolveAccountRuntimeRole({ requestedRole: null, hasTailorProfile: false })).toBe(
      'CUSTOMER'
    )
  })

  it('applies the selected role to a newly created provider account', () => {
    expect(
      shouldApplyFreshSignupRole({
        intentMode: 'sign-up',
        intentRole: 'TAILOR',
        createdAt: '2026-09-14T05:00:00.000Z',
        lastSignInAt: '2026-09-14T05:00:01.000Z',
      })
    ).toBe(true)
  })

  it('does not role-switch an established account entering through sign-up', () => {
    expect(
      shouldApplyFreshSignupRole({
        intentMode: 'sign-up',
        intentRole: 'TAILOR',
        createdAt: '2026-06-01T05:00:00.000Z',
        lastSignInAt: '2026-09-14T05:00:01.000Z',
      })
    ).toBe(false)
  })

  it('does not apply a sign-in intent as an account role', () => {
    expect(
      shouldApplyFreshSignupRole({
        intentMode: 'sign-in',
        intentRole: 'TAILOR',
        createdAt: '2026-09-14T05:00:00.000Z',
        lastSignInAt: '2026-09-14T05:00:01.000Z',
      })
    ).toBe(false)
  })

  it('asks a brand-new provider user entering through sign in to choose a role', () => {
    expect(
      shouldChooseRoleAfterFreshProviderSignIn({
        intentMode: 'sign-in',
        createdAt: '2026-09-14T05:00:00.000Z',
        lastSignInAt: '2026-09-14T05:00:01.000Z',
      })
    ).toBe(true)
  })

  it('does not ask an existing provider account to choose its role again', () => {
    expect(
      shouldChooseRoleAfterFreshProviderSignIn({
        intentMode: 'sign-in',
        createdAt: '2026-06-01T05:00:00.000Z',
        lastSignInAt: '2026-09-14T05:00:01.000Z',
      })
    ).toBe(false)
  })

  it('rejects invalid provider account timestamps as fresh', () => {
    expect(isFreshProviderAccount({ createdAt: 'invalid', lastSignInAt: null })).toBe(false)
  })
})

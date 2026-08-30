import {
  defaultCommunicationPreferences,
  legacyPreferenceCategory,
  resolveCommunicationPolicy,
} from '../src/communications'

describe('communications policy', () => {
  it('requires explicit consent for marketing', () => {
    const policy = resolveCommunicationPolicy({
      category: 'PROMOTION',
      purpose: 'MARKETING',
    })

    expect(policy.requiresConsent).toBe(true)
    expect(policy.mandatory).toBe(false)
    expect(defaultCommunicationPreferences().PROMOTION.PUSH).toBe(false)
  })

  it('keeps critical service alerts mandatory with explicit SMS fallback', () => {
    const policy = resolveCommunicationPolicy({
      category: 'SERVICE_STATUS',
      purpose: 'OPERATIONAL',
      severity: 'CRITICAL',
      actionRequired: true,
      timeSensitive: true,
      allowSmsFallback: true,
    })

    expect(policy.channels).toEqual(['IN_APP', 'PUSH', 'EMAIL'])
    expect(policy.mandatory).toBe(true)
    expect(policy.smsFallback).toBe(true)
    expect(policy.acknowledgementRequired).toBe(true)
  })

  it('maps legacy preferences without changing their meaning', () => {
    expect(legacyPreferenceCategory('messages')).toBe('MESSAGE')
    expect(legacyPreferenceCategory('paymentConfirmations')).toBe('PAYMENT')
    expect(legacyPreferenceCategory('promotions')).toBe('PROMOTION')
  })
})

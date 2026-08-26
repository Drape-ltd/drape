import {
  fulfillmentEligibilityCopy,
  pricingInvalidationForFulfillmentChange,
  resolveFulfillmentEligibility,
  type FulfillmentCorridorControl,
  type FulfillmentLocation,
} from '../src/fulfillment-eligibility'

const now = '2026-08-16T12:00:00.000Z'
const location = (countryCode: string, line = '10 Verified Street'): FulfillmentLocation => ({
  countryCode,
  regionCode: 'REGION',
  postalCode: '10001',
  city: 'City',
  addressLine1: line,
  verificationSource: 'ADDRESS_SEARCH',
  verificationReference: `place-${countryCode}`,
  verifiedAt: now,
})
const corridor = (overrides: Partial<FulfillmentCorridorControl> = {}): FulfillmentCorridorControl => ({
  controlId: 'corridor-1',
  policyVersion: 'tax-fulfillment-2026-08-15-v1',
  status: 'ACTIVE',
  originCountryCode: 'GH',
  destinationCountryCode: 'US',
  transactionType: 'CUSTOM_ORDER',
  collectionMode: 'PAYABLE_ON_IMPORT',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
  reviewDueAt: '2027-01-01T00:00:00.000Z',
  ...overrides,
})

describe('fulfillment eligibility', () => {
  it('allows collection only from a verified structured pickup location', () => {
    const eligible = resolveFulfillmentEligibility({
      method: 'LOCAL_COLLECTION', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: null, corridor: null, now,
    })
    expect(eligible).toMatchObject({ status: 'ELIGIBLE', fulfillmentClassification: 'LOCAL_COLLECTION' })
    expect(resolveFulfillmentEligibility({
      method: 'LOCAL_COLLECTION', transactionType: 'CUSTOM_ORDER',
      origin: { ...location('GH'), verificationSource: 'LEGACY_FREE_TEXT' }, destination: null, corridor: null, now,
    })).toMatchObject({ status: 'BLOCKED', reason: 'ORIGIN_LOCATION_UNVERIFIED' })
  })

  it('allows same-country local delivery', () => {
    expect(resolveFulfillmentEligibility({
      method: 'LOCAL_DELIVERY', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: location('GH', '20 Customer Road'), corridor: null, now,
    })).toMatchObject({ status: 'ELIGIBLE', fulfillmentClassification: 'LOCAL_DELIVERY' })
  })

  it('returns an explicit international switch for cross-country local delivery', () => {
    const result = resolveFulfillmentEligibility({
      method: 'LOCAL_DELIVERY', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: location('US'), corridor: null, now,
    })
    expect(result).toMatchObject({
      status: 'BLOCKED', reason: 'LOCAL_DELIVERY_COUNTRY_MISMATCH', suggestedMethod: 'SHIPPING',
    })
    expect(fulfillmentEligibilityCopy(result)).toBe('This address is outside the tailor’s country.')
  })

  it('fails closed without an active exact international corridor', () => {
    expect(resolveFulfillmentEligibility({
      method: 'SHIPPING', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: location('US'), corridor: null, now,
    })).toMatchObject({ status: 'BLOCKED', reason: 'INTERNATIONAL_CORRIDOR_NOT_ACTIVE' })
    expect(resolveFulfillmentEligibility({
      method: 'SHIPPING', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: location('US'), corridor: corridor({ destinationCountryCode: 'CA' }), now,
    })).toMatchObject({ status: 'BLOCKED', reason: 'INTERNATIONAL_CORRIDOR_NOT_ACTIVE' })
  })

  it('returns collection mode for an active corridor', () => {
    expect(resolveFulfillmentEligibility({
      method: 'SHIPPING', transactionType: 'CUSTOM_ORDER',
      origin: location('GH'), destination: location('US'), corridor: corridor(), now,
    })).toMatchObject({
      status: 'ELIGIBLE', fulfillmentClassification: 'INTERNATIONAL_SHIPPING',
      collectionMode: 'PAYABLE_ON_IMPORT', corridorControlId: 'corridor-1',
    })
  })

  it('invalidates active pricing only for a material fingerprint change', () => {
    expect(pricingInvalidationForFulfillmentChange({
      previousFingerprint: 'a', nextFingerprint: 'b', hasActivePricing: true,
    })).toEqual(expect.objectContaining({ reason: 'FULFILLMENT_LOCATION_CHANGED' }))
    expect(pricingInvalidationForFulfillmentChange({
      previousFingerprint: 'a', nextFingerprint: 'a', hasActivePricing: true,
    })).toBeNull()
  })
})

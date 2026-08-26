import {
  TAX_FULFILLMENT_POLICY_VERSION,
  type TaxCollectionMode,
  type TaxTransactionType,
  type VerifiedTaxLocation,
  // The explicit extension is required by the Supabase/Deno production
  // bundler. The workspace test compiler does not enable
  // allowImportingTsExtensions, so keep the narrow suppression here rather
  // than weakening import rules repository-wide.
  // @ts-ignore TS5097 -- cross-runtime Deno import boundary.
} from './tax-decision.ts'

export const FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION =
  'fulfillment-eligibility-2026-08-16-v1' as const

export const FULFILLMENT_METHODS = [
  'LOCAL_COLLECTION',
  'LOCAL_DELIVERY',
  'SHIPPING',
] as const
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number]

export const FULFILLMENT_ELIGIBILITY_BLOCKED_REASONS = [
  'ORIGIN_LOCATION_REQUIRED',
  'ORIGIN_LOCATION_UNVERIFIED',
  'DESTINATION_LOCATION_REQUIRED',
  'DESTINATION_LOCATION_UNVERIFIED',
  'LOCAL_DELIVERY_COUNTRY_MISMATCH',
  'INTERNATIONAL_DESTINATION_REQUIRED',
  'INTERNATIONAL_CORRIDOR_NOT_ACTIVE',
  'INTERNATIONAL_CORRIDOR_BLOCKED',
  'INTERNATIONAL_CORRIDOR_REVIEW_EXPIRED',
] as const
export type FulfillmentEligibilityBlockedReason =
  (typeof FULFILLMENT_ELIGIBILITY_BLOCKED_REASONS)[number]

export type FulfillmentLocation = VerifiedTaxLocation & {
  /** A stable provider/place identifier when the verifier supplies one. */
  verificationReference: string | null
}

export type FulfillmentCorridorControl = {
  controlId: string
  policyVersion: string
  status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED'
  originCountryCode: string
  destinationCountryCode: string
  transactionType: TaxTransactionType
  collectionMode: TaxCollectionMode
  effectiveFrom: string
  effectiveTo: string | null
  reviewDueAt: string
}

export type FulfillmentEligibilityInput = {
  method: FulfillmentMethod
  transactionType: TaxTransactionType
  origin: FulfillmentLocation | null
  destination: FulfillmentLocation | null
  corridor: FulfillmentCorridorControl | null
  now?: string | Date
}

export type FulfillmentEligibilityResult =
  | {
      status: 'ELIGIBLE'
      contractVersion: typeof FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION
      policyVersion: typeof TAX_FULFILLMENT_POLICY_VERSION
      method: FulfillmentMethod
      fulfillmentClassification: 'LOCAL_COLLECTION' | 'LOCAL_DELIVERY' | 'INTERNATIONAL_SHIPPING'
      origin: FulfillmentLocation
      destination: FulfillmentLocation | null
      corridorControlId: string | null
      collectionMode: TaxCollectionMode | null
      fingerprint: string
    }
  | {
      status: 'BLOCKED'
      contractVersion: typeof FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION
      policyVersion: typeof TAX_FULFILLMENT_POLICY_VERSION
      method: FulfillmentMethod
      reason: FulfillmentEligibilityBlockedReason
      suggestedMethod: FulfillmentMethod | null
      originCountryCode: string | null
      destinationCountryCode: string | null
    }

const UNVERIFIED_LOCATION_SOURCES = new Set([
  'FREE_TEXT',
  'LEGACY_FREE_TEXT',
  'LEGACY_UNVERIFIED',
  'UNKNOWN',
])

function normalizedCountry(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? ''
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null
}

function normalizedPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

export function isVerifiedFulfillmentLocation(
  value: FulfillmentLocation | null | undefined,
): value is FulfillmentLocation {
  if (!value) return false
  if (!normalizedCountry(value.countryCode)) return false
  if (!value.addressLine1?.trim()) return false
  if (!value.verificationSource?.trim()) return false
  if (UNVERIFIED_LOCATION_SOURCES.has(value.verificationSource.trim().toUpperCase())) return false
  return Number.isFinite(Date.parse(value.verifiedAt))
}

function blocked(
  input: FulfillmentEligibilityInput,
  reason: FulfillmentEligibilityBlockedReason,
  suggestedMethod: FulfillmentMethod | null = null,
): FulfillmentEligibilityResult {
  return {
    status: 'BLOCKED',
    contractVersion: FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    method: input.method,
    reason,
    suggestedMethod,
    originCountryCode: normalizedCountry(input.origin?.countryCode),
    destinationCountryCode: normalizedCountry(input.destination?.countryCode),
  }
}

function locationFingerprint(location: FulfillmentLocation | null) {
  if (!location) return '-'
  return [
    normalizedCountry(location.countryCode),
    normalizedPart(location.regionCode),
    normalizedPart(location.postalCode),
    normalizedPart(location.city),
    normalizedPart(location.addressLine1),
    normalizedPart(location.verificationSource),
    normalizedPart(location.verificationReference),
  ].join('|')
}

export function fulfillmentEligibilityFingerprint(input: {
  method: FulfillmentMethod
  origin: FulfillmentLocation
  destination: FulfillmentLocation | null
  corridorControlId: string | null
  collectionMode: TaxCollectionMode | null
}) {
  return [
    FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
    input.method,
    locationFingerprint(input.origin),
    locationFingerprint(input.destination),
    input.corridorControlId ?? '-',
    input.collectionMode ?? '-',
  ].join('::')
}

export function resolveFulfillmentEligibility(
  input: FulfillmentEligibilityInput,
): FulfillmentEligibilityResult {
  if (!input.origin) return blocked(input, 'ORIGIN_LOCATION_REQUIRED')
  if (!isVerifiedFulfillmentLocation(input.origin)) {
    return blocked(input, 'ORIGIN_LOCATION_UNVERIFIED')
  }

  if (input.method === 'LOCAL_COLLECTION') {
    const eligible = {
      method: input.method,
      origin: input.origin,
      destination: null,
      corridorControlId: null,
      collectionMode: null,
    } as const
    return {
      status: 'ELIGIBLE',
      contractVersion: FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      fulfillmentClassification: 'LOCAL_COLLECTION',
      ...eligible,
      fingerprint: fulfillmentEligibilityFingerprint(eligible),
    }
  }

  if (!input.destination) return blocked(input, 'DESTINATION_LOCATION_REQUIRED')
  if (!isVerifiedFulfillmentLocation(input.destination)) {
    return blocked(input, 'DESTINATION_LOCATION_UNVERIFIED')
  }

  const originCountry = normalizedCountry(input.origin.countryCode)
  const destinationCountry = normalizedCountry(input.destination.countryCode)
  if (input.method === 'LOCAL_DELIVERY') {
    if (originCountry !== destinationCountry) {
      return blocked(input, 'LOCAL_DELIVERY_COUNTRY_MISMATCH', 'SHIPPING')
    }
    const eligible = {
      method: input.method,
      origin: input.origin,
      destination: input.destination,
      corridorControlId: null,
      collectionMode: null,
    } as const
    return {
      status: 'ELIGIBLE',
      contractVersion: FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      fulfillmentClassification: 'LOCAL_DELIVERY',
      ...eligible,
      fingerprint: fulfillmentEligibilityFingerprint(eligible),
    }
  }

  if (originCountry === destinationCountry) {
    return blocked(input, 'INTERNATIONAL_DESTINATION_REQUIRED', 'LOCAL_DELIVERY')
  }
  if (!input.corridor) return blocked(input, 'INTERNATIONAL_CORRIDOR_NOT_ACTIVE')
  if (input.corridor.status === 'BLOCKED' || input.corridor.collectionMode === 'BLOCKED') {
    return blocked(input, 'INTERNATIONAL_CORRIDOR_BLOCKED')
  }
  const now = input.now instanceof Date
    ? input.now
    : new Date(input.now ?? new Date().toISOString())
  const effectiveTo = input.corridor.effectiveTo ? new Date(input.corridor.effectiveTo) : null
  if (
    input.corridor.status === 'EXPIRED'
    || new Date(input.corridor.reviewDueAt) <= now
    || new Date(input.corridor.effectiveFrom) > now
    || (effectiveTo && effectiveTo <= now)
  ) {
    return blocked(input, 'INTERNATIONAL_CORRIDOR_REVIEW_EXPIRED')
  }
  if (
    input.corridor.status !== 'ACTIVE'
    || input.corridor.policyVersion !== TAX_FULFILLMENT_POLICY_VERSION
    || normalizedCountry(input.corridor.originCountryCode) !== originCountry
    || normalizedCountry(input.corridor.destinationCountryCode) !== destinationCountry
    || input.corridor.transactionType !== input.transactionType
  ) {
    return blocked(input, 'INTERNATIONAL_CORRIDOR_NOT_ACTIVE')
  }

  const eligible = {
    method: input.method,
    origin: input.origin,
    destination: input.destination,
    corridorControlId: input.corridor.controlId,
    collectionMode: input.corridor.collectionMode,
  } as const
  return {
    status: 'ELIGIBLE',
    contractVersion: FULFILLMENT_ELIGIBILITY_CONTRACT_VERSION,
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    fulfillmentClassification: 'INTERNATIONAL_SHIPPING',
    ...eligible,
    fingerprint: fulfillmentEligibilityFingerprint(eligible),
  }
}

export function fulfillmentEligibilityCopy(result: FulfillmentEligibilityResult) {
  if (result.status === 'ELIGIBLE') {
    if (result.collectionMode === 'PAYABLE_ON_IMPORT') {
      return 'Import taxes or duties are paid when the shipment arrives.'
    }
    if (result.collectionMode === 'COLLECTED_AT_CHECKOUT') {
      return 'Eligible taxes and shipping charges are collected at checkout.'
    }
    return result.method === 'LOCAL_COLLECTION'
      ? 'Collection is available from the tailor’s verified pickup location.'
      : 'This fulfillment option is available for the selected address.'
  }
  const copy: Record<FulfillmentEligibilityBlockedReason, string> = {
    ORIGIN_LOCATION_REQUIRED: 'The tailor must add a verified fulfillment location first.',
    ORIGIN_LOCATION_UNVERIFIED: 'The tailor’s fulfillment location needs verification first.',
    DESTINATION_LOCATION_REQUIRED: 'Enter and confirm the destination address to continue.',
    DESTINATION_LOCATION_UNVERIFIED: 'Choose or confirm a complete destination address to continue.',
    LOCAL_DELIVERY_COUNTRY_MISMATCH: 'This address is outside the tailor’s country.',
    INTERNATIONAL_DESTINATION_REQUIRED: 'Use local delivery for an address in the tailor’s country.',
    INTERNATIONAL_CORRIDOR_NOT_ACTIVE: 'Drapeon shipping is not available for this route yet.',
    INTERNATIONAL_CORRIDOR_BLOCKED: 'This shipping route is currently unavailable.',
    INTERNATIONAL_CORRIDOR_REVIEW_EXPIRED: 'This shipping route is being reviewed and cannot be selected right now.',
  }
  return copy[result.reason]
}

export function pricingInvalidationForFulfillmentChange(input: {
  previousFingerprint: string | null | undefined
  nextFingerprint: string | null | undefined
  hasActivePricing: boolean
}) {
  if (!input.hasActivePricing || !input.previousFingerprint || !input.nextFingerprint) return null
  if (input.previousFingerprint === input.nextFingerprint) return null
  return {
    reason: 'FULFILLMENT_LOCATION_CHANGED' as const,
    message: 'Fulfillment details changed. Review the updated price before paying.',
  }
}

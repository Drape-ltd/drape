import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolveFulfillmentEligibility,
  type FulfillmentCorridorControl,
  type FulfillmentEligibilityResult,
  type FulfillmentLocation,
  type FulfillmentMethod,
} from '../../../packages/shared/src/fulfillment-eligibility.ts'
import { TAX_FULFILLMENT_POLICY_VERSION } from '../../../packages/shared/src/tax-decision.ts'
import type { TaxTransactionType } from '../../../packages/shared/src/tax-decision.ts'

type DestinationInput = {
  countryCode?: string | null
  regionCode?: string | null
  postalCode?: string | null
  city?: string | null
  addressLine1?: string | null
  verificationSource?: string | null
  verificationReference?: string | null
  verifiedAt?: string | null
} | null

function locationFromDestination(input: DestinationInput): FulfillmentLocation | null {
  if (!input) return null
  return {
    countryCode: input.countryCode?.trim().toUpperCase() ?? '',
    regionCode: input.regionCode?.trim().toUpperCase() || null,
    postalCode: input.postalCode?.trim() || null,
    city: input.city?.trim() || null,
    addressLine1: input.addressLine1?.trim() ?? '',
    verificationSource: input.verificationSource?.trim() ?? '',
    verificationReference: input.verificationReference?.trim() || null,
    verifiedAt: input.verifiedAt ?? '',
  }
}

export async function resolveAuthoritativeFulfillmentEligibility(options: {
  supabase: SupabaseClient
  tailorProfileId: string
  method: FulfillmentMethod
  destination: DestinationInput
  transactionType?: TaxTransactionType
  now?: string
}): Promise<FulfillmentEligibilityResult> {
  const transactionType = options.transactionType ?? 'CUSTOM_ORDER'
  const { data: tailor, error: tailorError } = await options.supabase
    .from('tailor_profiles')
    .select('id,user_id,pickup_available,delivery_available,shipping_available')
    .eq('id', options.tailorProfileId)
    .maybeSingle()
  if (tailorError) throw tailorError

  const supported = options.method === 'LOCAL_COLLECTION'
    ? tailor?.pickup_available === true
    : options.method === 'LOCAL_DELIVERY'
      ? tailor?.delivery_available === true
      : tailor?.shipping_available === true

  const { data: pickup, error: pickupError } = tailor?.user_id
    ? await options.supabase.from('tailor_pickup_details').select(
        'pickup_address_line1,pickup_city,pickup_region,pickup_postal_code,pickup_country_code,pickup_location_verification_source,pickup_location_verification_reference,pickup_location_verified_at',
      ).eq('user_id', tailor.user_id).maybeSingle()
    : { data: null, error: null }
  if (pickupError) throw pickupError

  const origin: FulfillmentLocation | null = supported && pickup
    ? {
        countryCode: pickup.pickup_country_code ?? '',
        regionCode: pickup.pickup_region ?? null,
        postalCode: pickup.pickup_postal_code ?? null,
        city: pickup.pickup_city ?? null,
        addressLine1: pickup.pickup_address_line1 ?? '',
        verificationSource: pickup.pickup_location_verification_source ?? 'LEGACY_UNVERIFIED',
        verificationReference: pickup.pickup_location_verification_reference ?? null,
        verifiedAt: pickup.pickup_location_verified_at ?? '',
      }
    : null
  const destination = locationFromDestination(options.destination)

  let corridor: FulfillmentCorridorControl | null = null
  if (options.method === 'SHIPPING' && origin?.countryCode && destination?.countryCode) {
    const { data, error } = await options.supabase.from('tax_corridor_controls').select(
      'id,policy_version,status,origin_country_code,destination_country_code,tax_transaction_type,collection_mode,effective_from,effective_to,review_due_at',
    )
      .eq('policy_version', TAX_FULFILLMENT_POLICY_VERSION)
      .eq('origin_country_code', origin.countryCode.trim().toUpperCase())
      .eq('destination_country_code', destination.countryCode.trim().toUpperCase())
      .eq('tax_transaction_type', transactionType)
      .in('status', ['ACTIVE', 'BLOCKED', 'EXPIRED'])
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) {
      corridor = {
        controlId: data.id,
        policyVersion: data.policy_version,
        status: data.status,
        originCountryCode: data.origin_country_code,
        destinationCountryCode: data.destination_country_code,
        transactionType: data.tax_transaction_type,
        collectionMode: data.collection_mode,
        effectiveFrom: data.effective_from,
        effectiveTo: data.effective_to,
        reviewDueAt: data.review_due_at,
      }
    }
  }

  return resolveFulfillmentEligibility({
    method: options.method,
    transactionType,
    origin,
    destination,
    corridor,
    now: options.now,
  })
}

export function fulfillmentDestinationFromDraftFields(fields: Record<string, unknown>) {
  const method = fields.deliveryMethod
  if (method === 'LOCAL_COLLECTION') return null
  return {
    countryCode: typeof fields.deliveryCountryCode === 'string'
      ? fields.deliveryCountryCode
      : typeof fields.deliveryCountry === 'string' ? fields.deliveryCountry : null,
    regionCode: typeof fields.deliveryRegion === 'string'
      ? fields.deliveryRegion
      : typeof fields.deliveryStateRegion === 'string' ? fields.deliveryStateRegion : null,
    postalCode: typeof fields.deliveryPostalCode === 'string' ? fields.deliveryPostalCode : null,
    city: typeof fields.deliveryCity === 'string' ? fields.deliveryCity : null,
    addressLine1: typeof fields.deliveryAddress === 'string'
      ? fields.deliveryAddress
      : typeof fields.deliveryAddressLine1 === 'string' ? fields.deliveryAddressLine1 : null,
    verificationSource: typeof fields.deliveryVerificationSource === 'string'
      ? fields.deliveryVerificationSource
      : 'CUSTOMER_CONFIRMED_STRUCTURED',
    verificationReference: typeof fields.deliveryVerificationReference === 'string'
      ? fields.deliveryVerificationReference
      : null,
    verifiedAt: typeof fields.deliveryVerifiedAt === 'string'
      ? fields.deliveryVerifiedAt
      : null,
  }
}

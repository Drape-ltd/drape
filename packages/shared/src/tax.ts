import type { AccountCurrencyCode } from './currency-config.ts'

const EU_REGION_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
])

const COUNTRY_CODE_ALIASES: Record<string, string> = {
  US: 'US',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  CA: 'CA',
  CAN: 'CA',
  CANADA: 'CA',
  NG: 'NG',
  NGA: 'NG',
  NIGERIA: 'NG',
  GH: 'GH',
  GHA: 'GH',
  GHANA: 'GH',
  KE: 'KE',
  KEN: 'KE',
  KENYA: 'KE',
  GB: 'GB',
  GBR: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
  ENGLAND: 'GB',
  SCOTLAND: 'GB',
  WALES: 'GB',
  'NORTHERN IRELAND': 'GB',
}

const TAX_LOCATION_HINTS: Array<{ countryCode: string; hints: string[] }> = [
  { countryCode: 'NG', hints: ['NIGERIA', 'LAGOS', 'ABUJA', 'IKEJA', 'LEKKI', 'IBADAN', 'PORT HARCOURT'] },
  { countryCode: 'GH', hints: ['GHANA', 'ACCRA', 'KUMASI', 'TEMA'] },
  { countryCode: 'KE', hints: ['KENYA', 'NAIROBI', 'MOMBASA', 'KISUMU'] },
  { countryCode: 'US', hints: ['UNITED STATES', 'USA', 'TEXAS', 'CALIFORNIA', 'NEW YORK', 'FLORIDA', 'ILLINOIS'] },
  { countryCode: 'CA', hints: ['CANADA', 'ONTARIO', 'TORONTO', 'VANCOUVER', 'QUEBEC', 'ALBERTA'] },
  { countryCode: 'GB', hints: ['UNITED KINGDOM', 'ENGLAND', 'SCOTLAND', 'WALES', 'LONDON', 'MANCHESTER'] },
]

export type TaxContext = {
  regionCode?: string | null
  countryCode?: string | null
  currency: AccountCurrencyCode
}

export type OrderTaxJurisdictionInput = {
  fulfillment?: string | null
  deliveryCountryCode?: string | null
  deliveryAddress?: string | null
  sellerLocation?: string | null
  sellerPickupAddress?: string | null
  customerRegionCode?: string | null
}

export type OrderTaxJurisdiction = {
  countryCode: string | null
  address: string | null
  source: 'PICKUP_LOCATION' | 'DELIVERY_DESTINATION' | 'LEGACY_ACCOUNT_REGION' | 'UNRESOLVED'
}

export type TaxBreakdown = {
  label: string
  jurisdiction: string | null
  rateBps: number
  amount: number
  inclusive: boolean
  fallback: boolean
  fallbackReason: string | null
  components?: TaxComponent[]
}

export type TaxComponent = {
  key: string
  label: string
  rateBps: number
}

export type TaxSnapshotLine = TaxComponent & {
  amount: number
}

export const GHANA_TAX_COMPONENTS: TaxComponent[] = [
  { key: 'ghana-vat', label: 'Ghana VAT', rateBps: 1500 },
  { key: 'ghana-nhil', label: 'NHIL', rateBps: 250 },
  { key: 'ghana-getfund', label: 'GETFund levy', rateBps: 250 },
]

export const GHANA_EFFECTIVE_TAX_RATE_BPS = 2000

export type TaxPolicyControl = {
  countryCode: string
  mode: 'STATIC' | 'PROVIDER' | 'BLOCKED'
  reviewedAt: string
  reviewDueAt: string
  sourceUrl: string
  note: string
}

/**
 * Operational review controls for tax behavior. Currency is intentionally not
 * part of this registry: the physical tax jurisdiction owns the tax rule.
 * Static policies require a recurring official-source review, while provider
 * policies are monitored through provider readiness and lookup failures.
 */
export const TAX_POLICY_CONTROLS: TaxPolicyControl[] = [
  {
    countryCode: 'NG',
    mode: 'STATIC',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://old.firs.gov.ng/wp-content/uploads/2021/06/CLARIFICATION-ON-THE-IMPLEMENTATION-OF-THE-VALUE-ADDED-TAX-VAT-ACT.pdf',
    note: 'Nigeria VAT 7.5%; taxable status and registration obligations still require business review.',
  },
  {
    countryCode: 'GH',
    mode: 'STATIC',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://gra.gov.gh/domestic-tax/tax-types/vat/',
    note: 'Ghana VAT 15% plus NHIL 2.5% and GETFund Levy 2.5%, shown separately.',
  },
  {
    countryCode: 'KE',
    mode: 'STATIC',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax',
    note: 'Kenya general VAT rate 16%; product treatment and registration obligations still require business review.',
  },
  {
    countryCode: 'GB',
    mode: 'STATIC',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://www.gov.uk/vat-rates',
    note: 'United Kingdom standard VAT 20%; reduced and zero-rated product classes must not use this default.',
  },
  {
    countryCode: 'US',
    mode: 'PROVIDER',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://api.ziptax.com/',
    note: 'Destination lookup is mandatory and checkout fails closed when it cannot be resolved.',
  },
  {
    countryCode: 'CA',
    mode: 'PROVIDER',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://api.ziptax.com/',
    note: 'Province-specific destination lookup is mandatory and checkout fails closed when it cannot be resolved.',
  },
  {
    countryCode: 'EU',
    mode: 'BLOCKED',
    reviewedAt: '2026-08-15',
    reviewDueAt: '2026-09-15',
    sourceUrl: 'https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en',
    note: 'EU member states set different VAT rates; no flat euro-area rate is permitted.',
  },
]

export type LockedOrderAmountsInput = {
  subtotalAmount: number
  platformFeeAmount?: number | null
  shippingAmount?: number | null
  taxRateBps?: number | null
  taxableAmount?: number | null
}

export type LockedOrderAmounts = {
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  taxRateBps: number
  shippingAmount: number
  totalAmount: number
}

export function normalizeTaxCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (!normalized) return null
  if (normalized.length === 2 && /^[A-Z]{2}$/u.test(normalized)) {
    return normalized
  }
  return COUNTRY_CODE_ALIASES[normalized] ?? null
}

function countryFromLocation(value: string | null | undefined) {
  const direct = normalizeTaxCountryCode(value)
  if (direct) return direct
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (!normalized) return null
  return TAX_LOCATION_HINTS.find((entry) =>
    entry.hints.some((hint) => normalized.includes(hint))
  )?.countryCode ?? null
}

/**
 * Resolve the physical tax jurisdiction without using the charge currency.
 * Pickup is taxed at the seller's pickup location; delivery and shipping are
 * taxed at the destination. Account region is retained only for legacy rows
 * that have no explicit fulfillment method.
 */
export function resolveOrderTaxJurisdiction(
  input: OrderTaxJurisdictionInput,
): OrderTaxJurisdiction {
  const fulfillment = input.fulfillment?.trim().toUpperCase() ?? ''
  const pickup = fulfillment === 'PICKUP' || fulfillment === 'LOCAL_COLLECTION'
  const localDelivery = fulfillment === 'DELIVERY' || fulfillment === 'LOCAL_DELIVERY'
  const shipping = fulfillment === 'SHIPPING'

  if (pickup) {
    const address = input.sellerPickupAddress?.trim() || input.sellerLocation?.trim() || null
    return {
      countryCode:
        countryFromLocation(input.sellerPickupAddress)
        ?? countryFromLocation(input.sellerLocation),
      address,
      source: address ? 'PICKUP_LOCATION' : 'UNRESOLVED',
    }
  }

  if (localDelivery || shipping) {
    const address = input.deliveryAddress?.trim() || null
    const destinationCountry =
      normalizeTaxCountryCode(input.deliveryCountryCode)
      ?? countryFromLocation(input.deliveryAddress)
    const countryCode = localDelivery
      ? destinationCountry ?? countryFromLocation(input.sellerLocation)
      : destinationCountry

    return {
      countryCode,
      address,
      source: countryCode ? 'DELIVERY_DESTINATION' : 'UNRESOLVED',
    }
  }

  const address = input.deliveryAddress?.trim() || null
  const countryCode =
    normalizeTaxCountryCode(input.deliveryCountryCode)
    ?? countryFromLocation(input.deliveryAddress)
    ?? normalizeTaxCountryCode(input.customerRegionCode)

  return {
    countryCode,
    address,
    source: countryCode
      ? (input.deliveryCountryCode || input.deliveryAddress
          ? 'DELIVERY_DESTINATION'
          : 'LEGACY_ACCOUNT_REGION')
      : 'UNRESOLVED',
  }
}

function staticTaxBreakdown(
  label: string,
  jurisdiction: string,
  rateBps: number,
): TaxBreakdown {
  return {
    label,
    jurisdiction,
    rateBps,
    amount: 0,
    inclusive: false,
    fallback: false,
    fallbackReason: null,
  }
}

function serverLookupRequired(
  label: string,
  jurisdiction: string,
): TaxBreakdown {
  return {
    label,
    jurisdiction,
    rateBps: 0,
    amount: 0,
    inclusive: false,
    fallback: true,
    fallbackReason: 'SERVER_LOOKUP_REQUIRED',
  }
}

export function resolveTaxBreakdown(input: TaxContext): TaxBreakdown {
  const regionCode = (input.regionCode ?? '').trim().toUpperCase()
  const countryCode = normalizeTaxCountryCode(input.countryCode) ?? regionCode

  if (countryCode === 'NG') {
    return staticTaxBreakdown('Tax (Nigeria VAT)', 'Nigeria VAT', 750)
  }

  if (countryCode === 'GH') {
    return {
      ...staticTaxBreakdown(
        'Ghana VAT and statutory levies',
        'Ghana VAT + NHIL + GETFund',
        GHANA_EFFECTIVE_TAX_RATE_BPS,
      ),
      components: GHANA_TAX_COMPONENTS,
    }
  }

  if (countryCode === 'KE') {
    return staticTaxBreakdown('Tax (Kenya VAT)', 'Kenya VAT', 1600)
  }

  if (countryCode === 'GB') {
    return staticTaxBreakdown('Tax (United Kingdom VAT)', 'United Kingdom VAT', 2000)
  }

  if (EU_REGION_CODES.has(countryCode)) {
    return {
      ...serverLookupRequired('Tax (country-specific EU VAT)', `${countryCode} VAT`),
      fallbackReason: 'COUNTRY_SPECIFIC_TAX_PROVIDER_REQUIRED',
    }
  }

  if (countryCode === 'US') {
    return serverLookupRequired('Tax (US sales tax)', 'US sales tax')
  }

  if (countryCode === 'CA') {
    return serverLookupRequired('Tax (Canada sales tax)', 'Canada sales tax')
  }

  return {
    label: 'Tax',
    jurisdiction: countryCode || null,
    rateBps: 0,
    amount: 0,
    inclusive: false,
    fallback: true,
    fallbackReason: 'UNSUPPORTED_TAX_JURISDICTION',
  }
}

export function formatTaxRate(rateBps: number) {
  const percentage = Math.max(0, rateBps) / 100
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '')}%`
}

export function isGhanaTaxJurisdiction(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().toUpperCase().includes('GHANA')
}

export function taxSnapshotNeedsRefresh(input: {
  taxRegion?: string | null
  taxRateBps?: number | null
  taxFallback?: boolean | null
}) {
  return !input.taxFallback
    && isGhanaTaxJurisdiction(input.taxRegion)
    && input.taxRateBps !== GHANA_EFFECTIVE_TAX_RATE_BPS
}

/**
 * Produce customer-facing tax lines from a locked aggregate snapshot. Amounts
 * are allocated from the stored tax total so rounding can never change the
 * amount due or rewrite an existing financial snapshot.
 */
export function taxLinesForSnapshot(input: {
  taxRegion?: string | null
  taxRateBps?: number | null
  taxAmount: number
}): TaxSnapshotLine[] {
  const taxAmount = Math.max(0, Math.round(input.taxAmount))
  const rateBps = Math.max(0, input.taxRateBps ?? 0)
  const components = isGhanaTaxJurisdiction(input.taxRegion)
    && rateBps === GHANA_EFFECTIVE_TAX_RATE_BPS
    ? GHANA_TAX_COMPONENTS
    : [{
        key: 'tax',
        label: input.taxRegion?.trim() || 'Tax',
        rateBps,
      }]

  let allocated = 0
  return components.map((component, index) => {
    const amount = index === components.length - 1
      ? taxAmount - allocated
      : Math.round((taxAmount * component.rateBps) / Math.max(rateBps, 1))
    allocated += amount
    return { ...component, amount }
  })
}

/**
 * Expand an immutable receipt tax total only when its stored jurisdiction
 * explicitly identifies the current Ghana statutory bundle. Older receipts
 * retain their original aggregate line instead of being reinterpreted using
 * today's rates.
 */
export function taxLinesForReceiptSnapshot(input: {
  taxJurisdiction?: string | null
  taxAmount: number
}): TaxSnapshotLine[] {
  const jurisdiction = input.taxJurisdiction?.trim() || null
  const isCurrentGhanaBundle = jurisdiction?.toUpperCase()
    === 'GHANA VAT + NHIL + GETFUND'
  const lines = taxLinesForSnapshot({
    taxRegion: jurisdiction,
    taxRateBps: isCurrentGhanaBundle ? GHANA_EFFECTIVE_TAX_RATE_BPS : 0,
    taxAmount: input.taxAmount,
  })
  return isCurrentGhanaBundle ? lines : lines.map((line) => ({
    ...line,
    label: jurisdiction ? `Tax · ${jurisdiction}` : 'Tax',
  }))
}

export function calculateLockedOrderAmounts(input: LockedOrderAmountsInput): LockedOrderAmounts {
  const subtotalAmount = Math.max(0, input.subtotalAmount)
  const platformFeeAmount = Math.max(0, input.platformFeeAmount ?? 0)
  const shippingAmount = Math.max(0, input.shippingAmount ?? 0)
  const taxRateBps = Math.max(0, input.taxRateBps ?? 0)
  const taxableBase = Math.max(0, input.taxableAmount ?? subtotalAmount)
  const taxAmount = Math.round((taxableBase * taxRateBps) / 10_000)
  const totalAmount = subtotalAmount + platformFeeAmount + taxAmount + shippingAmount

  return {
    subtotalAmount,
    platformFeeAmount,
    taxAmount,
    taxRateBps,
    shippingAmount,
    totalAmount,
  }
}

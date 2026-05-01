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

export type TaxContext = {
  regionCode?: string | null
  countryCode?: string | null
  currency: AccountCurrencyCode
}

export type TaxBreakdown = {
  label: string
  jurisdiction: string | null
  rateBps: number
  amount: number
  inclusive: boolean
  fallback: boolean
  fallbackReason: string | null
}

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

  if (countryCode === 'NG' && input.currency === 'NGN') {
    return staticTaxBreakdown('Tax (Nigeria VAT)', 'Nigeria VAT', 750)
  }

  if (countryCode === 'GH' && input.currency === 'GHS') {
    return staticTaxBreakdown('Tax (Ghana VAT)', 'Ghana VAT', 1500)
  }

  if (countryCode === 'KE' && input.currency === 'KES') {
    return staticTaxBreakdown('Tax (Kenya VAT)', 'Kenya VAT', 1600)
  }

  if (countryCode === 'GB' && input.currency === 'GBP') {
    return staticTaxBreakdown('Tax (United Kingdom VAT)', 'United Kingdom VAT', 2000)
  }

  if (EU_REGION_CODES.has(countryCode) && input.currency === 'EUR') {
    return staticTaxBreakdown('Tax (EU VAT)', 'EU VAT (flat launch default)', 2000)
  }

  if (countryCode === 'US' && input.currency === 'USD') {
    return serverLookupRequired('Tax (US sales tax)', 'US sales tax')
  }

  if (countryCode === 'CA' && input.currency === 'CAD') {
    return serverLookupRequired('Tax (Canada sales tax)', 'Canada sales tax')
  }

  return {
    label: 'Tax',
    jurisdiction: countryCode || null,
    rateBps: 0,
    amount: 0,
    inclusive: false,
    fallback: false,
    fallbackReason: null,
  }
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

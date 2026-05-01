import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getOptionalSentryDsn, getZiptaxApiKey } from './env.ts'
import { log } from './logger.ts'
import {
  calculateLockedOrderAmounts,
  normalizeTaxCountryCode,
  resolveTaxBreakdown as resolveStaticTaxBreakdown,
  type LockedOrderAmounts,
} from '../../../packages/shared/src/tax.ts'
import type { AccountCurrencyCode } from '../../../packages/shared/src/currency-config.ts'

const FN = 'tax'
const ZIPTAX_ENDPOINT = 'https://api.ziptax.com/request/v60'
const ZIPTAX_TIMEOUT_MS = 5_000
const TAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ZIPTAX_FALLBACK_REASON = 'ZIPTAX_UNAVAILABLE'
const ONTARIO_FALLBACK_RATE_BPS = 1_300
const ONTARIO_FALLBACK_REGION = 'Ontario HST'

// Drape is a Wyoming LLC. Formal nexus analysis has not
// yet been completed with a US accountant. Tax is being
// collected conservatively across all US states pending
// that review. Economic nexus threshold in most states
// is $100,000 in sales or 200 transactions per year.
// At early stage volume Drape is unlikely to trigger
// nexus obligations in any state. Revisit at scale.
// Physical nexus: Wyoming only. WY has no general sales
// tax on digital marketplace services.
// TODO post-launch: implement tax remittance reporting.
// Use Ziptax or TaxJar filing API to automate state and
// provincial remittance once filing thresholds are hit
// in each jurisdiction.

const CANADIAN_PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
}

const CANADIAN_PROVINCE_TAX_TYPES: Record<string, string> = {
  AB: 'GST',
  BC: 'GST+PST',
  MB: 'GST+PST',
  NB: 'HST',
  NL: 'HST',
  NS: 'HST',
  NT: 'GST',
  NU: 'GST',
  ON: 'HST',
  PE: 'HST',
  QC: 'GST+QST',
  SK: 'GST+PST',
  YT: 'GST',
}

export type ResolvedOrderTax = {
  label: string
  taxRegion: string
  rateBps: number
  fallback: boolean
  fallbackReason: string | null
  source: 'STATIC' | 'ZIPTAX' | 'ZIPTAX_CACHE'
  rawResponse?: Record<string, unknown> | null
  shippingTaxable: boolean
  platformFeeTaxable: boolean
}

export type TaxLockInput = {
  supabase: SupabaseClient
  orderId?: string | null
  currency: AccountCurrencyCode
  regionCode?: string | null
  countryCode?: string | null
  address?: string | null
  postalCode?: string | null
  stateRegion?: string | null
  city?: string | null
}

type ZiptaxAddressDetail = {
  normalizedAddress?: string
  state?: string
  stateCode?: string
  county?: string
  city?: string
  postalCode?: string
}

type ZiptaxSummary = {
  rate?: number
  summary_name?: string
  tax_type?: string
}

type ZiptaxBaseRate = {
  jur_description?: string
  jur_name?: string
  rate?: number
}

type ZiptaxResponse = {
  metadata?: {
    rCode?: number
    version?: string
  }
  addressDetail?: ZiptaxAddressDetail
  tax_summaries?: ZiptaxSummary[] | null
  base_rates?: ZiptaxBaseRate[] | null
  shipping?: {
    taxable?: string
    description?: string
  }
  service?: {
    taxable?: string
    description?: string
  }
}

type CachedTaxRate = {
  country_code: string
  postal_code: string
  rate_bps: number
  tax_region: string
  source: string
  shipping_taxable: boolean
  platform_fee_taxable: boolean
  raw_response: Record<string, unknown> | null
  expires_at: string
}

function normalizePostalCode(value: string | null | undefined, countryCode: 'US' | 'CA'): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return null

  if (countryCode === 'US') {
    const match = trimmed.match(/\b\d{5}(?:-\d{4})?\b/u)
    return match?.[0] ?? null
  }

  const compact = trimmed.replace(/\s+/gu, '')
  const match = compact.match(/^[A-Z]\d[A-Z]\d[A-Z]\d$/u)
  if (!match) return null
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

function extractPostalCodeFromAddress(address: string | null | undefined, countryCode: 'US' | 'CA'): string | null {
  if (typeof address !== 'string') return null
  return normalizePostalCode(address, countryCode)
}

function countryCodeForCurrency(currency: AccountCurrencyCode): 'US' | 'CA' | null {
  if (currency === 'USD') return 'US'
  if (currency === 'CAD') return 'CA'
  return null
}

function boolFromTaxableFlag(value: string | null | undefined, defaultValue: boolean) {
  if (value === 'Y') return true
  if (value === 'N') return false
  return defaultValue
}

function rateToBps(rate: number) {
  return rate <= 1 ? Math.round(rate * 10_000) : Math.round(rate * 100)
}

function normalizeRateBpsFromSummaries(summaries: ZiptaxSummary[] | null | undefined) {
  const safeSummaries = Array.isArray(summaries) ? summaries : []
  const salesRates = safeSummaries
    .filter((summary) => summary.tax_type === 'SALES_TAX' && typeof summary.rate === 'number')
    .map((summary) => summary.rate as number)
  if (salesRates.length > 0) {
    return rateToBps(salesRates.reduce((sum, rate) => sum + rate, 0))
  }

  const useRates = safeSummaries
    .filter((summary) => summary.tax_type === 'USE_TAX' && typeof summary.rate === 'number')
    .map((summary) => summary.rate as number)
  if (useRates.length > 0) {
    return rateToBps(useRates.reduce((sum, rate) => sum + rate, 0))
  }

  return null
}

function normalizeRateBpsFromBaseRates(baseRates: ZiptaxBaseRate[] | null | undefined) {
  const safeBaseRates = Array.isArray(baseRates) ? baseRates : []
  const rates = safeBaseRates
    .filter((rate) => typeof rate.rate === 'number')
    .map((rate) => rate.rate as number)
  if (rates.length === 0) return null
  return rateToBps(rates.reduce((sum, rate) => sum + rate, 0))
}

function provinceTaxLabel(detail: ZiptaxAddressDetail | undefined, summaries: ZiptaxSummary[] | null | undefined) {
  const provinceCode = detail?.stateCode?.trim().toUpperCase() || ''
  const provinceName = detail?.state?.trim()
    || CANADIAN_PROVINCE_NAMES[provinceCode]
    || 'Canada'
  const summaryName = (Array.isArray(summaries) ? summaries : [])
    .map((summary) => summary.summary_name?.trim())
    .find((value): value is string => !!value && value.length > 0)

  const taxType = summaryName || CANADIAN_PROVINCE_TAX_TYPES[provinceCode] || 'sales tax'
  return `${provinceName} ${taxType}`.trim()
}

function usStateLabel(detail: ZiptaxAddressDetail | undefined, baseRates: ZiptaxBaseRate[] | null | undefined) {
  if (detail?.state?.trim()) return detail.state.trim()
  const stateRate = (Array.isArray(baseRates) ? baseRates : [])
    .find((rate) => rate.jur_name === 'US_STATE' && typeof rate.jur_description === 'string' && rate.jur_description.trim().length > 0)
  if (stateRate?.jur_description) return stateRate.jur_description.trim()
  if (detail?.stateCode?.trim()) return detail.stateCode.trim().toUpperCase()
  return 'United States'
}

async function captureTaxFailureInSentry(context: Record<string, unknown>) {
  const dsn = getOptionalSentryDsn()
  if (!dsn) return

  try {
    const dsnUrl = new URL(dsn)
    const projectId = dsnUrl.pathname.replace(/^\/+/u, '')
    const eventId = crypto.randomUUID().replace(/-/gu, '')
    const envelopeHeader = {
      event_id: eventId,
      dsn,
      sent_at: new Date().toISOString(),
    }
    const itemHeader = { type: 'event' }
    const eventPayload = {
      event_id: eventId,
      level: 'error',
      message: 'ZipTax lookup failed',
      platform: 'javascript',
      timestamp: Math.floor(Date.now() / 1000),
      tags: {
        component: 'tax',
        provider: 'ZIPTAX',
      },
      extra: context,
    }

    await fetch(`${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: `${JSON.stringify(envelopeHeader)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(eventPayload)}`,
    })
  } catch (error) {
    log('warn', FN, 'sentry.capture_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function readCachedTaxRate(
  supabase: SupabaseClient,
  countryCode: 'US' | 'CA',
  postalCode: string,
) {
  try {
    const { data, error } = await supabase
      .from('tax_rate_cache')
      .select('country_code, postal_code, rate_bps, tax_region, source, shipping_taxable, platform_fee_taxable, raw_response, expires_at')
      .eq('country_code', countryCode)
      .eq('postal_code', postalCode)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (error) throw error
    return (data as CachedTaxRate | null) ?? null
  } catch (error) {
    log('warn', FN, 'tax_cache.read_failed', {
      country_code: countryCode,
      postal_code: postalCode,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function writeCachedTaxRate(
  supabase: SupabaseClient,
  countryCode: 'US' | 'CA',
  postalCode: string,
  tax: ResolvedOrderTax,
) {
  try {
    const expiresAt = new Date(Date.now() + TAX_CACHE_TTL_MS).toISOString()
    const { error } = await supabase
      .from('tax_rate_cache')
      .upsert({
        country_code: countryCode,
        postal_code: postalCode,
        rate_bps: tax.rateBps,
        tax_region: tax.taxRegion,
        source: tax.source,
        shipping_taxable: tax.shippingTaxable,
        platform_fee_taxable: tax.platformFeeTaxable,
        raw_response: tax.rawResponse ?? {},
        expires_at: expiresAt,
      }, {
        onConflict: 'country_code,postal_code',
      })

    if (error) throw error
  } catch (error) {
    log('warn', FN, 'tax_cache.write_failed', {
      country_code: countryCode,
      postal_code: postalCode,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getTaxRateFromZiptax(
  address: string,
  zip: string,
  country: 'US' | 'CA',
): Promise<{ rateBps: number; reason: string }> {
  const params = new URLSearchParams({
    format: 'json',
    countryCode: country === 'US' ? 'USA' : 'CAN',
    postalcode: zip,
    addressDetailExtended: 'true',
    shippingExtended: 'true',
  })

  if (address.trim()) {
    params.set('address', address.trim())
  }

  const response = await fetch(`${ZIPTAX_ENDPOINT}?${params.toString()}`, {
    headers: {
      'X-API-KEY': getZiptaxApiKey(),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(ZIPTAX_TIMEOUT_MS),
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`ZipTax request failed (${response.status}): ${payload.slice(0, 240)}`)
  }

  const payload = await response.json() as ZiptaxResponse
  if (payload.metadata?.rCode !== 100) {
    throw new Error(`ZipTax did not return success metadata (rCode=${payload.metadata?.rCode ?? 'unknown'}).`)
  }

  const rateBps = normalizeRateBpsFromSummaries(payload.tax_summaries)
    ?? normalizeRateBpsFromBaseRates(payload.base_rates)

  if (rateBps === null) {
    throw new Error('ZipTax did not return a combined tax rate.')
  }

  const reason = country === 'US'
    ? usStateLabel(payload.addressDetail, payload.base_rates)
    : provinceTaxLabel(payload.addressDetail, payload.tax_summaries)

  return { rateBps, reason }
}

function staticTaxFromContext(input: TaxLockInput): ResolvedOrderTax {
  const breakdown = resolveStaticTaxBreakdown({
    regionCode: input.regionCode,
    countryCode: input.countryCode,
    currency: input.currency,
  })

  return {
    label: breakdown.label,
    taxRegion: breakdown.jurisdiction ?? 'Tax',
    rateBps: breakdown.rateBps,
    fallback: breakdown.fallback,
    fallbackReason: breakdown.fallbackReason,
    source: 'STATIC',
    rawResponse: null,
    shippingTaxable: false,
    platformFeeTaxable: false,
  }
}

function ziptaxFallback(input: TaxLockInput, countryCode: 'US' | 'CA'): ResolvedOrderTax {
  if (countryCode === 'CA') {
    return {
      label: `Tax (${ONTARIO_FALLBACK_REGION})`,
      taxRegion: ONTARIO_FALLBACK_REGION,
      rateBps: ONTARIO_FALLBACK_RATE_BPS,
      fallback: true,
      fallbackReason: ZIPTAX_FALLBACK_REASON,
      source: 'STATIC',
      rawResponse: null,
      shippingTaxable: false,
      platformFeeTaxable: false,
    }
  }

  const region = input.stateRegion?.trim()
    || input.regionCode?.trim().toUpperCase()
    || 'United States'

  return {
    label: `Tax (${region})`,
    taxRegion: region,
    rateBps: 0,
    fallback: true,
    fallbackReason: ZIPTAX_FALLBACK_REASON,
    source: 'STATIC',
    rawResponse: null,
    shippingTaxable: false,
    platformFeeTaxable: false,
  }
}

export async function resolveOrderTax(input: TaxLockInput): Promise<ResolvedOrderTax> {
  const countryCode =
    (normalizeTaxCountryCode(input.countryCode) as 'US' | 'CA' | null)
    ?? countryCodeForCurrency(input.currency)
    ?? (normalizeTaxCountryCode(input.regionCode) as 'US' | 'CA' | null)

  if (!countryCode || !['USD', 'CAD'].includes(input.currency)) {
    return staticTaxFromContext(input)
  }

  const postalCode =
    normalizePostalCode(input.postalCode, countryCode)
    ?? extractPostalCodeFromAddress(input.address, countryCode)

  if (!postalCode) {
    return ziptaxFallback(input, countryCode)
  }

  const cached = await readCachedTaxRate(input.supabase, countryCode, postalCode)
  if (cached) {
    return {
      label: `Tax (${cached.tax_region})`,
      taxRegion: cached.tax_region,
      rateBps: cached.rate_bps,
      fallback: false,
      fallbackReason: null,
      source: 'ZIPTAX_CACHE',
      rawResponse: cached.raw_response,
      shippingTaxable: !!cached.shipping_taxable,
      platformFeeTaxable: !!cached.platform_fee_taxable,
    }
  }

  try {
    const params = new URLSearchParams({
      format: 'json',
      countryCode: countryCode === 'US' ? 'USA' : 'CAN',
      postalcode: postalCode,
      addressDetailExtended: 'true',
      shippingExtended: 'true',
    })

    if (input.address?.trim()) params.set('address', input.address.trim())
    if (input.stateRegion?.trim()) params.set('state', input.stateRegion.trim())
    if (input.city?.trim()) params.set('city', input.city.trim())

    const response = await fetch(`${ZIPTAX_ENDPOINT}?${params.toString()}`, {
      headers: {
        'X-API-KEY': getZiptaxApiKey(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(ZIPTAX_TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`ZipTax request failed (${response.status}): ${body.slice(0, 240)}`)
    }

    const payload = await response.json() as ZiptaxResponse
    if (payload.metadata?.rCode !== 100) {
      throw new Error(`ZipTax did not return success metadata (rCode=${payload.metadata?.rCode ?? 'unknown'}).`)
    }

    const rateBps = normalizeRateBpsFromSummaries(payload.tax_summaries)
      ?? normalizeRateBpsFromBaseRates(payload.base_rates)

    if (rateBps === null) {
      throw new Error('ZipTax did not return a combined tax rate.')
    }

    const taxRegion = countryCode === 'US'
      ? usStateLabel(payload.addressDetail, payload.base_rates)
      : provinceTaxLabel(payload.addressDetail, payload.tax_summaries)
    const shippingTaxable = boolFromTaxableFlag(payload.shipping?.taxable, false)
    const platformFeeTaxable = boolFromTaxableFlag(payload.service?.taxable, false)

    const resolved: ResolvedOrderTax = {
      label: `Tax (${taxRegion})`,
      taxRegion,
      rateBps,
      fallback: false,
      fallbackReason: null,
      source: 'ZIPTAX',
      rawResponse: payload as Record<string, unknown>,
      shippingTaxable,
      platformFeeTaxable,
    }

    await writeCachedTaxRate(input.supabase, countryCode, postalCode, resolved)

    return resolved
  } catch (error) {
    const context = {
      order_id: input.orderId ?? null,
      country_code: countryCode,
      postal_code: postalCode,
      address: input.address ?? null,
      currency: input.currency,
      error: error instanceof Error ? error.message : String(error),
    }
    log('error', FN, 'ziptax.lookup_failed', context)
    await captureTaxFailureInSentry(context)
    return ziptaxFallback(input, countryCode)
  }
}

export function calculateLockedOrderAmountsWithTaxBase(input: {
  subtotalAmount: number
  platformFeeAmount?: number | null
  shippingAmount?: number | null
  taxRateBps?: number | null
  shippingTaxable?: boolean
  platformFeeTaxable?: boolean
}): LockedOrderAmounts {
  const subtotalAmount = Math.max(0, input.subtotalAmount)
  const platformFeeAmount = Math.max(0, input.platformFeeAmount ?? 0)
  const shippingAmount = Math.max(0, input.shippingAmount ?? 0)
  const taxableAmount = subtotalAmount
    + (input.shippingTaxable ? shippingAmount : 0)
    + (input.platformFeeTaxable ? platformFeeAmount : 0)

  return calculateLockedOrderAmounts({
    subtotalAmount,
    platformFeeAmount,
    shippingAmount,
    taxRateBps: input.taxRateBps ?? 0,
    taxableAmount,
  })
}

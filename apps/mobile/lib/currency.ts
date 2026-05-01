import { useEffect, useMemo, useState } from 'react'
import {
  currencyDisplayLabel,
  currencySymbol,
  DEFAULT_ACCOUNT_CURRENCY,
  detectCurrencyPreference,
  normalizeAccountCurrency,
  SUPPORTED_ACCOUNT_CURRENCIES,
  type AccountCurrencyCode,
  type CurrencySource,
} from '@drape/shared'
import { useAuth } from './auth'
import { supabase } from './supabase'

type CurrencyCode = AccountCurrencyCode

export type { CurrencyCode }

export const SUPPORTED_CURRENCIES: Array<{ code: CurrencyCode; symbol: string; name: string }> =
  SUPPORTED_ACCOUNT_CURRENCIES.map((code) => ({
    code,
    symbol: currencySymbol(code),
    name: currencyDisplayLabel(code),
  }))

export type Rates = Partial<Record<CurrencyCode, number>>
export type CurrencyPreferenceContext = ReturnType<typeof detectCurrencyPreference>

const RATES_TTL_MS = 60 * 60 * 1000

let inMemoryRatesCache: { rates: Rates; fetchedAt: number } | null = null

export const STATIC_FALLBACK_RATES: Rates = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
  NGN: 1580,
  GHS: 15.6,
  KES: 129,
  CAD: 1.36,
}

function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null
  } catch {
    return null
  }
}

function isMissingUsersTable(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return error?.code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes("could not find the table 'public.users'") ||
    message.includes("relation 'public.users' does not exist") ||
    message.includes("relation \"public.users\" does not exist")
}

export function detectDeviceCurrencyPreference() {
  return detectCurrencyPreference({ locale: deviceLocale() })
}

export async function fetchCurrencyPreferenceContext(input?: {
  locale?: string | null
}): Promise<CurrencyPreferenceContext> {
  const locale = input?.locale ?? deviceLocale()
  const fallback = detectCurrencyPreference({ locale })

  try {
    const { data, error } = await supabase.functions.invoke('currency-context', {
      body: { locale },
    })

    if (error) return fallback

    const currency = normalizeAccountCurrency((data as any)?.currency)
    const source = typeof (data as any)?.source === 'string'
      ? ((data as any).source.trim().toUpperCase() as CurrencySource)
      : fallback.source
    const regionCode = typeof (data as any)?.regionCode === 'string' && (data as any).regionCode.trim().length > 0
      ? (data as any).regionCode.trim().toUpperCase()
      : fallback.regionCode

    if (!currency) return fallback

    return {
      currency,
      source,
      regionCode,
      usedFallback: source === 'UNSUPPORTED_FALLBACK',
    }
  } catch {
    return fallback
  }
}

export async function fetchRates(): Promise<Rates> {
  const now = Date.now()
  if (inMemoryRatesCache && now - inMemoryRatesCache.fetchedAt < RATES_TTL_MS) {
    return inMemoryRatesCache.rates
  }

  try {
    const codes = SUPPORTED_ACCOUNT_CURRENCIES.filter((code) => code !== 'USD').join(',')
    const response = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${codes}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Rates request failed with ${response.status}`)

    const json = await response.json()
    const rates: Rates = {
      USD: 1,
      ...(json?.rates ?? {}),
    }

    inMemoryRatesCache = { rates, fetchedAt: now }
    return rates
  } catch {
    return STATIC_FALLBACK_RATES
  }
}

export function formatAmount(
  amountMinorUnits: number,
  fromCurrency: CurrencyCode = DEFAULT_ACCOUNT_CURRENCY,
  toCurrency: CurrencyCode,
  rates: Rates,
): string {
  const amount = amountMinorUnits / 100
  const fromRate = rates[fromCurrency] ?? 1
  const toRate = rates[toCurrency] ?? 1
  const converted = (amount / fromRate) * toRate
  const symbol = currencySymbol(toCurrency)

  const isLargeUnit = ['NGN', 'KES', 'GHS'].includes(toCurrency)
  const formatted = isLargeUnit
    ? Math.round(converted).toLocaleString()
    : converted.toFixed(0)

  return `${symbol}${formatted}`
}

export function useCurrency() {
  const { user } = useAuth()
  const detected = useMemo(() => detectDeviceCurrencyPreference(), [])

  const [currency, setCurrencyState] = useState<CurrencyCode>(detected.currency)
  const [source, setSource] = useState<CurrencySource>(detected.source)
  const [regionCode, setRegionCode] = useState(detected.regionCode)
  const [rates, setRates] = useState<Rates>(STATIC_FALLBACK_RATES)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const liveRates = await fetchRates()
      if (cancelled) return
      setRates(liveRates)

      const resolvedDetection = await fetchCurrencyPreferenceContext()
      if (cancelled) return

      if (!user?.id) {
        setCurrencyState(resolvedDetection.currency)
        setSource(resolvedDetection.source)
        setRegionCode(resolvedDetection.regionCode)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('users')
        .select('default_currency, currency_source, region_code')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        if (!isMissingUsersTable(error)) {
          console.warn('Unable to load account currency, falling back to detected locale.', {
            message: error.message,
            code: error.code,
          })
        }
        setCurrencyState(resolvedDetection.currency)
        setSource(resolvedDetection.source)
        setRegionCode(resolvedDetection.regionCode)
        setLoading(false)
        return
      }

      const nextCurrency = normalizeAccountCurrency((data as any)?.default_currency) ?? resolvedDetection.currency
      const nextSource = ((data as any)?.currency_source as CurrencySource | null) ?? resolvedDetection.source
      const nextRegionCode = typeof (data as any)?.region_code === 'string'
        ? (data as any).region_code.trim().toUpperCase() || resolvedDetection.regionCode
        : resolvedDetection.regionCode

      setCurrencyState(nextCurrency)
      setSource(nextSource)
      setRegionCode(nextRegionCode)
      setLoading(false)
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  async function setCurrency(
    code: CurrencyCode,
    options?: {
      source?: CurrencySource
      regionCode?: string | null
    },
  ) {
    const nextSource = options?.source ?? 'USER_SELECTED'
    const nextRegionCode = options?.regionCode?.trim().toUpperCase() || regionCode || detected.regionCode

    setCurrencyState(code)
    setSource(nextSource)
    setRegionCode(nextRegionCode)

    if (!user?.id) return

    const { error } = await supabase
      .from('users')
      .update({
        default_currency: code,
        currency_source: nextSource,
        region_code: nextRegionCode,
        currency_confirmed_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      throw error
    }
  }

  const unsupportedMessage = source === 'UNSUPPORTED_FALLBACK'
    ? 'Your local currency is not supported yet. Prices are shown in USD.'
    : null

  return {
    currency,
    rates,
    loading,
    setCurrency,
    source,
    regionCode,
    unsupportedMessage,
  }
}

/**
 * Drape currency utility
 *
 * All amounts in the DB are stored in minor units (cents) of the tailor's quoted currency.
 * The `quoted_currency` column defaults to 'USD'. This module provides:
 *  - SUPPORTED_CURRENCIES list with symbols
 *  - fetchRates() — live exchange rates from Frankfurter (free, no key)
 *  - formatAmount(amountMinorUnits, fromCurrency, toCurrency, rate) — display string
 *  - useCurrency() hook — user's preferred currency + live rates
 */

import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const CURRENCY_PREF_KEY = 'drape_currency'
const RATES_CACHE_KEY = 'drape_rates_cache'
const RATES_TTL_MS = 60 * 60 * 1000 // 1 hour

export type CurrencyCode = 'USD' | 'GBP' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'ZAR' | 'CAD' | 'AUD' | 'INR'

export const SUPPORTED_CURRENCIES: Array<{ code: CurrencyCode; symbol: string; name: string }> = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
]

export type Rates = Partial<Record<CurrencyCode, number>>

/**
 * Fetch live exchange rates from Frankfurter (base USD).
 * Falls back to a static snapshot if unavailable.
 */
// Snapshot: 2026-03-18. Update if rates diverge > 15% from live.
export const STATIC_FALLBACK_RATES: Rates = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
  NGN: 1580,
  GHS: 15.6,
  KES: 129,
  ZAR: 18.4,
  CAD: 1.36,
  AUD: 1.53,
  INR: 83.5,
}

export async function fetchRates(): Promise<Rates> {
  try {
    // Check cache
    const cached = await AsyncStorage.getItem(RATES_CACHE_KEY)
    if (cached) {
      const { rates, fetchedAt } = JSON.parse(cached)
      if (Date.now() - fetchedAt < RATES_TTL_MS) return rates
    }

    const codes = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== 'USD').join(',')
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${codes}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error('Rate fetch failed')
    const json = await res.json()
    const rates: Rates = { USD: 1, ...json.rates }

    await AsyncStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }))
    return rates
  } catch {
    return STATIC_FALLBACK_RATES
  }
}

/**
 * Convert and format an amount.
 * @param amountMinorUnits — amount in minor units of fromCurrency (e.g. cents)
 * @param fromCurrency — the currency the amount is stored in
 * @param toCurrency — the currency to display in
 * @param rates — exchange rates relative to USD
 */
export function formatAmount(
  amountMinorUnits: number,
  fromCurrency: CurrencyCode = 'USD',
  toCurrency: CurrencyCode,
  rates: Rates,
): string {
  const amount = amountMinorUnits / 100

  const fromRate = rates[fromCurrency] ?? 1
  const toRate = rates[toCurrency] ?? 1

  const converted = (amount / fromRate) * toRate

  const currency = SUPPORTED_CURRENCIES.find((c) => c.code === toCurrency)
  const symbol = currency?.symbol ?? toCurrency

  // Format with appropriate decimals
  const isLargeUnit = ['NGN', 'KES', 'INR', 'ZAR', 'GHS'].includes(toCurrency)
  const formatted = isLargeUnit
    ? Math.round(converted).toLocaleString()
    : converted.toFixed(0)

  return `${symbol}${formatted}`
}

/**
 * useCurrency hook — provides the user's preferred currency, live rates,
 * and a setter to change the preference.
 */
export function useCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>('USD')
  const [rates, setRates] = useState<Rates>(STATIC_FALLBACK_RATES)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const [savedPref, liveRates] = await Promise.all([
        AsyncStorage.getItem(CURRENCY_PREF_KEY),
        fetchRates(),
      ])
      if (savedPref) setCurrencyState(savedPref as CurrencyCode)
      setRates(liveRates)
      setLoading(false)
    }
    init()
  }, [])

  async function setCurrency(code: CurrencyCode) {
    setCurrencyState(code)
    await AsyncStorage.setItem(CURRENCY_PREF_KEY, code)
  }

  return { currency, rates, loading, setCurrency }
}

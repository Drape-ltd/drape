import type { AccountCurrencyCode } from '../../../packages/shared/src/currency-config.ts'

const FX_API_BASE = 'https://api.frankfurter.app/latest'

export type FxQuote = {
  provider: 'FRANKFURTER'
  from: AccountCurrencyCode
  to: AccountCurrencyCode
  rate: number
  timestamp: string
}

export async function fetchFxQuote(
  from: AccountCurrencyCode,
  to: AccountCurrencyCode,
): Promise<FxQuote> {
  if (from === to) {
    return {
      provider: 'FRANKFURTER',
      from,
      to,
      rate: 1,
      timestamp: new Date().toISOString(),
    }
  }

  const response = await fetch(`${FX_API_BASE}?from=${from}&to=${to}`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`FX quote request failed with ${response.status}`)
  }

  const payload = await response.json()
  const rate = Number(payload?.rates?.[to])
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX quote for ${from}/${to} is unavailable`)
  }

  return {
    provider: 'FRANKFURTER',
    from,
    to,
    rate,
    timestamp: typeof payload?.date === 'string' && payload.date.length > 0
      ? new Date(`${payload.date}T00:00:00.000Z`).toISOString()
      : new Date().toISOString(),
  }
}

export function convertMinorUnitsWithFx(amountMinorUnits: number, rate: number) {
  return Math.round(amountMinorUnits * rate)
}

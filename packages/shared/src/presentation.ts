export type PresentationLocale = string | readonly string[]

export type MoneyPresentationOptions = {
  locale?: PresentationLocale
  fallbackCurrency?: string
  pendingLabel?: string
}

/**
 * Formats stored minor currency units for every Drapeon client.
 * Business calculations stay in integer minor units; this helper is display-only.
 */
export function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
  options: MoneyPresentationOptions = {},
): string {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) {
    return options.pendingLabel ?? 'Quote pending'
  }

  const fallbackCurrency = options.fallbackCurrency ?? 'USD'
  const requestedCurrency = currency?.trim().toUpperCase() || fallbackCurrency

  try {
    return new Intl.NumberFormat(options.locale ?? 'en-US', {
      style: 'currency',
      currency: requestedCurrency,
    }).format(amountMinor / 100)
  } catch {
    return new Intl.NumberFormat(options.locale ?? 'en-US', {
      style: 'currency',
      currency: fallbackCurrency,
    }).format(amountMinor / 100)
  }
}

/** Parses database timestamps consistently, including legacy UTC values without a suffix. */
export function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes('T') && !/(?:z|[+-]\d{2}:?\d{2})$/iu.test(trimmed)
    ? `${trimmed}Z`
    : trimmed
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(
  value: string | null | undefined,
  options: { locale?: PresentationLocale; timeZone?: string; fallback?: string | null } = {},
): string | null {
  const date = parseDateValue(value)
  if (!date) return options.fallback ?? null
  return new Intl.DateTimeFormat(options.locale ?? 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: options.timeZone,
  }).format(date)
}

export function formatRelative(
  value: string | null | undefined,
  options: { locale?: PresentationLocale; now?: number; fallback?: string } = {},
): string {
  const date = parseDateValue(value)
  const fallback = options.fallback ?? 'Recently'
  if (!date) return fallback

  const now = options.now ?? Date.now()
  const deltaMinutes = Math.round((date.getTime() - now) / 60_000)
  const absoluteMinutes = Math.abs(deltaMinutes)
  if (absoluteMinutes <= 1) return 'Just now'

  const formatter = new Intl.RelativeTimeFormat(options.locale ?? 'en-US', { numeric: 'auto' })
  if (absoluteMinutes < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')
  return formatDate(value, { locale: options.locale, fallback }) ?? fallback
}

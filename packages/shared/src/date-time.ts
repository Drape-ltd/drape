export type ExplicitDateTimeOptions = {
  timeZone?: string | null
  fallback?: string | null
}

export function isSupportedTimeZone(timeZone: string | null | undefined) {
  if (!timeZone?.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function resolvedLocalTimeZone() {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isSupportedTimeZone(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Formats an instant with an explicit 12-hour clock and zone marker.
 * Scheduled product events must never rely on a device's implicit clock convention.
 */
export function formatExplicitZonedDateTime(
  value: string | number | Date | null | undefined,
  options: ExplicitDateTimeOptions = {},
) {
  if (value === null || value === undefined || value === '') return options.fallback ?? null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return options.fallback ?? null

  const requestedZone = options.timeZone?.trim() || null
  const timeZone = isSupportedTimeZone(requestedZone) ? requestedZone! : resolvedLocalTimeZone()
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timeZone ?? undefined,
    timeZoneName: 'short',
  }).format(date)

  return formatted.replace(/\s+at\s+/, ' · ')
}

/** Adds AM/PM to legacy generated copy that used an en-GB 24-hour timestamp. */
export function clarifyLegacyScheduledTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})$/)
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return value
  const hour = Number(match[4])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value
  const hour12 = hour % 12 || 12
  const period = hour < 12 ? 'AM' : 'PM'
  return `${match[1]} ${match[2]} ${match[3]} · ${hour12}:${match[5]} ${period}`
}

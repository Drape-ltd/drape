export function isSupportedTimeZone(timeZone: string | null | undefined) {
  if (!timeZone?.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function formatExplicitZonedDateTime(startAt: string, timeZone: string | null | undefined) {
  const date = new Date(startAt)
  if (!Number.isFinite(date.getTime())) return 'the scheduled time'
  const safeZone = isSupportedTimeZone(timeZone) ? timeZone!.trim() : 'UTC'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: safeZone, timeZoneName: 'short',
  }).format(date).replace(/\s+at\s+/, ' · ')
}

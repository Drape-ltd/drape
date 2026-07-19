const URL_ENCODED_TOKEN = /%[0-9a-f]{2}/i

export function decodeDisplayText(value: string): string {
  let current = value

  for (let attempt = 0; attempt < 3 && URL_ENCODED_TOKEN.test(current); attempt += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) break
      current = decoded
    } catch {
      break
    }
  }

  return current
}

export function formatDatabaseEnumLabel(
  value: string | null | undefined,
  fallback = 'Not set',
): string {
  if (!value?.trim()) return fallback

  return value
    .trim()
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, '$1 $2')
    .toLowerCase()
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

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

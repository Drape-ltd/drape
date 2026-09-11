export function parseOpsUuidPathParam(value: string) {
  let decoded: string

  try {
    decoded = decodeURIComponent(value).trim()
  } catch {
    return null
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(decoded)
    ? decoded
    : null
}

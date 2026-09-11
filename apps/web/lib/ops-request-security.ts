import 'server-only'

const DEFAULT_PRODUCTION_OPS_ORIGIN = 'https://ops.drapeon.co'

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function normalizeConfiguredOrigin(value: string | null | undefined) {
  const candidate = value?.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

export function getCanonicalOpsOrigin(request: Request) {
  const requestUrl = new URL(request.url)
  if (process.env.NODE_ENV !== 'production' || isLocalHostname(requestUrl.hostname)) {
    return requestUrl.origin
  }

  return (
    normalizeConfiguredOrigin(process.env.OPS_CANONICAL_ORIGIN) ??
    normalizeConfiguredOrigin(
      process.env.OPS_HOSTNAME ? `https://${process.env.OPS_HOSTNAME}` : null,
    ) ??
    DEFAULT_PRODUCTION_OPS_ORIGIN
  )
}

export function sanitizeOpsRedirect(request: Request, value: FormDataEntryValue | null) {
  const canonicalOrigin = getCanonicalOpsOrigin(request)
  if (typeof value !== 'string' || !value.startsWith('/ops') || value.startsWith('//')) {
    return '/ops'
  }

  try {
    const url = new URL(value, canonicalOrigin)
    if (url.origin !== canonicalOrigin || (url.pathname !== '/ops' && !url.pathname.startsWith('/ops/'))) {
      return '/ops'
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/ops'
  }
}

export function buildCanonicalOpsUrl(request: Request, path: string) {
  return new URL(path, getCanonicalOpsOrigin(request))
}

export function validateOpsMutationOrigin(request: Request) {
  const expectedOrigin = getCanonicalOpsOrigin(request)
  const origin = normalizeConfiguredOrigin(request.headers.get('origin'))
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? ''
  const expectedUrl = new URL(expectedOrigin)
  const receivedUrl = origin ? new URL(origin) : null
  const equivalentLocalOrigin =
    process.env.NODE_ENV !== 'production' &&
    receivedUrl !== null &&
    isLocalHostname(expectedUrl.hostname) &&
    isLocalHostname(receivedUrl.hostname) &&
    expectedUrl.protocol === receivedUrl.protocol &&
    expectedUrl.port === receivedUrl.port

  return {
    ok: (origin === expectedOrigin || equivalentLocalOrigin) && fetchSite === 'same-origin',
    expectedOrigin,
    receivedOrigin: origin,
    fetchSite,
  }
}

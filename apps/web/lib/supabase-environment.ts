export const DEVELOPMENT_SUPABASE_PROJECT_REF = 'pqptfuqogvrajozfsqzi'
export const PRODUCTION_SUPABASE_PROJECT_REF = 'wkfsrunetmgjdtcurmoj'
export const PRODUCTION_SUPABASE_CUSTOM_DOMAIN = 'auth.drapeon.co'

const PRODUCTION_WEB_HOSTNAMES = new Set([
  'drapeon.co',
  'www.drapeon.co',
  'ops.drapeon.co',
])

export type WebEnvironmentTarget = 'development' | 'production'

export function getSupabaseProjectRef(url: string | null | undefined) {
  if (!url) return null

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === PRODUCTION_SUPABASE_CUSTOM_DOMAIN) {
      return PRODUCTION_SUPABASE_PROJECT_REF
    }
    const suffix = '.supabase.co'

    if (!hostname.endsWith(suffix)) return null

    const projectRef = hostname.slice(0, -suffix.length)
    return /^[a-z0-9]+$/u.test(projectRef) ? projectRef : null
  } catch {
    return null
  }
}

export function getSupabaseJwtProjectRef(key: string | null | undefined) {
  if (!key) return null
  const encodedPayload = key.split('.')[1]
  if (!encodedPayload) return null

  try {
    const normalizedPayload = encodedPayload.replace(/-/gu, '+').replace(/_/gu, '/')
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')
    const payload = JSON.parse(globalThis.atob(paddedPayload)) as { ref?: unknown }
    return typeof payload.ref === 'string' && /^[a-z0-9]+$/u.test(payload.ref)
      ? payload.ref
      : null
  } catch {
    return null
  }
}

export function validateServiceRoleTarget(
  url: string | null | undefined,
  key: string | null | undefined,
  declaredKeyProjectRef: string | null | undefined,
) {
  const urlProjectRef = getSupabaseProjectRef(url)
  const keyProjectRef = getSupabaseJwtProjectRef(key) ?? declaredKeyProjectRef?.trim() ?? null
  return {
    urlProjectRef,
    keyProjectRef,
    isValid: Boolean(urlProjectRef && keyProjectRef && urlProjectRef === keyProjectRef),
  }
}

export function isProductionWebHostname(hostname: string | null | undefined) {
  const normalized = hostname?.trim().toLowerCase().split(':')[0] ?? ''
  return PRODUCTION_WEB_HOSTNAMES.has(normalized)
}

export function expectedSupabaseProjectRef(target: WebEnvironmentTarget) {
  return target === 'production'
    ? PRODUCTION_SUPABASE_PROJECT_REF
    : DEVELOPMENT_SUPABASE_PROJECT_REF
}

export function validateSupabaseTarget(
  url: string | null | undefined,
  target: WebEnvironmentTarget
) {
  const actualProjectRef = getSupabaseProjectRef(url)
  const expectedProjectRef = expectedSupabaseProjectRef(target)

  return {
    actualProjectRef,
    expectedProjectRef,
    isValid: actualProjectRef === expectedProjectRef,
  }
}

export function assertSupabaseTarget(
  url: string | null | undefined,
  target: WebEnvironmentTarget,
  scope: string
) {
  const result = validateSupabaseTarget(url, target)

  if (!result.isValid) {
    throw new Error(
      `[${scope}] Refusing ${target} web access: expected Supabase project ` +
        `${result.expectedProjectRef}, received ${result.actualProjectRef ?? 'an invalid or missing URL'}.`
    )
  }

  return result
}

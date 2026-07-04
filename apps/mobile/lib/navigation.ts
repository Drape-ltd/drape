import type { Router } from 'expo-router'

type ReplaceTarget = Parameters<Router['replace']>[0]
type BackNavigation = {
  canGoBack: () => boolean
}

const SAFE_RETURN_PREFIXES = [
  '/(customer)',
  '/(tailor)',
  '/(auth)',
  '/passport',
  '/referral',
  '/group-invite',
]

export function sanitizeReturnTo(value: unknown) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('//')) return undefined
  if (trimmed.includes('://')) return undefined
  if (trimmed.startsWith('/vision')) return undefined
  if (trimmed === '/') return undefined
  return SAFE_RETURN_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix}/`))
    ? trimmed
    : undefined
}

export function goBackOrFallback(
  router: Router,
  navigation: BackNavigation,
  fallback: ReplaceTarget,
) {
  if (navigation.canGoBack()) {
    router.back()
    return
  }
  router.replace(fallback)
}

export function goBackOrReturnTo(
  router: Router,
  navigation: BackNavigation,
  returnTo: unknown,
  fallback: ReplaceTarget,
) {
  const safeReturnTo = sanitizeReturnTo(returnTo)
  if (navigation.canGoBack()) {
    router.back()
    return
  }
  if (safeReturnTo) {
    router.replace(safeReturnTo as ReplaceTarget)
    return
  }
  router.replace(fallback)
}

export function goBackOrReturnToIfNeeded(
  router: Router,
  navigation: BackNavigation,
  returnTo: unknown,
  fallback: ReplaceTarget,
) {
  const safeReturnTo = sanitizeReturnTo(returnTo)
  if (safeReturnTo) {
    router.replace(safeReturnTo as ReplaceTarget)
    return
  }
  if (navigation.canGoBack()) {
    router.back()
    return
  }
  router.replace(fallback)
}

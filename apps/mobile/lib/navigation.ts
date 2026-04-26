import type { Router } from 'expo-router'

type ReplaceTarget = Parameters<Router['replace']>[0]
type BackNavigation = {
  canGoBack: () => boolean
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
  if (typeof returnTo === 'string' && returnTo.trim().length > 0) {
    router.replace(returnTo as ReplaceTarget)
    return
  }
  goBackOrFallback(router, navigation, fallback)
}

export function goBackOrReturnToIfNeeded(
  router: Router,
  navigation: BackNavigation,
  returnTo: unknown,
  fallback: ReplaceTarget,
) {
  if (navigation.canGoBack()) {
    router.back()
    return
  }
  if (typeof returnTo === 'string' && returnTo.trim().length > 0) {
    router.replace(returnTo as ReplaceTarget)
    return
  }
  router.replace(fallback)
}

import type { Router } from 'expo-router'

type ReplaceTarget = Parameters<Router['replace']>[0]
type NavigateTarget = Parameters<Router['navigate']>[0]
type BackNavigation = {
  canGoBack: () => boolean
}
type ReturnNavigationOptions = {
  fromPath?: string
  dismissToTarget?: boolean
}
type TabLayoutGroup = '(customer)' | '(tailor)'
type TabRouteBranch = {
  group: TabLayoutGroup
  segment: string
}
type HistoryRouteTarget = {
  pathname: string
  remainingHistory: string
}

const SAFE_RETURN_PREFIXES = [
  '/(customer)',
  '/(tailor)',
  '/(auth)',
  '/passport',
  '/referral',
  '/group-invite',
]
const TAB_LAYOUT_GROUPS: readonly TabLayoutGroup[] = ['(customer)', '(tailor)']

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

export function pickSafeReturnTo(...values: unknown[]) {
  for (const value of values) {
    const safeValue = sanitizeReturnTo(value)
    if (safeValue) return safeValue
  }
  return undefined
}

function cleanHistorySegment(value: string) {
  return value.trim().replace(/\/{2,}/g, '/')
}

export function appendToHistory(currentChain: string | undefined, newSegment: string): string {
  const cleanSegment = cleanHistorySegment(newSegment)
  if (!cleanSegment) return currentChain || ''

  const cleanCurrent = (currentChain ?? '')
    .split(',')
    .map(cleanHistorySegment)
    .filter(Boolean)
  if (cleanCurrent.at(-1) === cleanSegment) return cleanCurrent.join(',')

  return cleanCurrent.length > 0 ? `${cleanCurrent.join(',')},${cleanSegment}` : cleanSegment
}

function routePathFromTarget(target: unknown) {
  if (typeof target === 'string') return target
  if (
    typeof target === 'object' &&
    target !== null &&
    'pathname' in target &&
    typeof target.pathname === 'string'
  ) {
    return target.pathname
  }
  return undefined
}

function tabRouteBranch(target: unknown): TabRouteBranch | undefined {
  const path = routePathFromTarget(target)
  if (!path?.startsWith('/')) return undefined
  const normalizedPath = path.split(/[?#]/, 1)[0] ?? ''
  const [group, segment = ''] = normalizedPath.split('/').filter(Boolean)
  if (!TAB_LAYOUT_GROUPS.includes(group as TabLayoutGroup)) return undefined
  return { group: group as TabLayoutGroup, segment }
}

function isGroupedTabPath(target: unknown) {
  return Boolean(tabRouteBranch(target))
}

function isRootLevelPath(target: unknown) {
  const path = routePathFromTarget(target)
  if (!path?.startsWith('/')) return false
  return !isGroupedTabPath(path)
}

function shouldUseRootCrossoverNavigation(
  target: unknown,
  fallback: ReplaceTarget,
  options?: ReturnNavigationOptions,
) {
  return isRootLevelPath(options?.fromPath) || isRootLevelPath(target) || isRootLevelPath(fallback)
}

function shouldNavigateAcrossTabBranch(safeReturnTo: string, fallback: ReplaceTarget) {
  const returnBranch = tabRouteBranch(safeReturnTo)
  if (!returnBranch) return false

  const fallbackBranch = tabRouteBranch(fallback)
  if (!fallbackBranch) return true

  return (
    returnBranch.group !== fallbackBranch.group ||
    returnBranch.segment !== fallbackBranch.segment
  )
}

function appendHistoryParam(target: string, remainingHistory: string) {
  if (!remainingHistory) return target

  const hashIndex = target.indexOf('#')
  const pathAndQuery = hashIndex >= 0 ? target.slice(0, hashIndex) : target
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : ''
  const separator = pathAndQuery.includes('?') ? '&' : '?'

  return `${pathAndQuery}${separator}historyChain=${encodeURIComponent(remainingHistory)}${hash}`
}

function historyTargetToHref(historyTarget: HistoryRouteTarget) {
  return appendHistoryParam(historyTarget.pathname, historyTarget.remainingHistory)
}

function navigateWithHistory(
  router: Router,
  pathname: string,
  remainingHistory: string,
) {
  scheduleRouteTransition(() => {
    router.navigate({
      pathname,
      params: {
        historyChain: remainingHistory,
      },
    } as NavigateTarget)
  })
}

function navigateToTarget(router: Router, target: ReplaceTarget, historyChain = '') {
  if (typeof target === 'string') {
    navigateWithHistory(router, target, historyChain)
    return
  }

  scheduleRouteTransition(() => {
    router.navigate(target as NavigateTarget)
  })
}

function resolveHistoryTarget(returnTo: unknown): HistoryRouteTarget | undefined {
  const safeReturnTo = sanitizeReturnTo(returnTo)
  if (!safeReturnTo) return undefined

  const historyParts = safeReturnTo
    .split(',')
    .map(cleanHistorySegment)
    .filter(Boolean)
  const target = historyParts.at(-1)
  if (!target || !sanitizeReturnTo(target)) return undefined

  return {
    pathname: target,
    remainingHistory: historyParts.slice(0, -1).join(','),
  }
}

function dismissCurrentStack(router: Router) {
  try {
    if (router.canDismiss()) {
      router.dismissAll()
    }
  } catch {}
}

function scheduleRouteTransition(action: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(action)
    return
  }
  setTimeout(action, 0)
}

function applySafeReturn(
  router: Router,
  historyTarget: HistoryRouteTarget,
  fallback: ReplaceTarget,
  options?: ReturnNavigationOptions,
) {
  const safeReturnTo = historyTargetToHref(historyTarget)
  if (options?.dismissToTarget) {
    scheduleRouteTransition(() => {
      router.dismissTo(safeReturnTo as ReplaceTarget)
    })
    return
  }

  if (shouldUseRootCrossoverNavigation(historyTarget.pathname, fallback, options)) {
    navigateWithHistory(router, historyTarget.pathname, historyTarget.remainingHistory)
    return
  }

  if (shouldNavigateAcrossTabBranch(safeReturnTo, fallback)) {
    scheduleRouteTransition(() => {
      router.navigate(safeReturnTo as NavigateTarget)
    })
    return
  }
  scheduleRouteTransition(() => {
    router.replace(safeReturnTo as ReplaceTarget)
  })
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
  scheduleRouteTransition(() => {
    router.replace(fallback)
  })
}

export function resetTo(router: Router, target: ReplaceTarget) {
  dismissCurrentStack(router)
  scheduleRouteTransition(() => {
    router.replace(target)
  })
}

export function goBackOrReturnTo(
  router: Router,
  navigation: BackNavigation,
  returnTo: unknown,
  fallback: ReplaceTarget,
  options?: ReturnNavigationOptions,
) {
  const historyTarget = resolveHistoryTarget(returnTo)
  if (historyTarget) {
    applySafeReturn(router, historyTarget, fallback, options)
    return
  }
  if (options?.dismissToTarget) {
    scheduleRouteTransition(() => {
      router.dismissTo(fallback)
    })
    return
  }
  if (shouldUseRootCrossoverNavigation(fallback, fallback, options)) {
    navigateToTarget(router, fallback)
    return
  }
  scheduleRouteTransition(() => {
    router.dismissTo(fallback)
  })
}

export function goBackOrReturnToIfNeeded(
  router: Router,
  navigation: BackNavigation,
  returnTo: unknown,
  fallback: ReplaceTarget,
  options?: ReturnNavigationOptions,
) {
  const historyTarget = resolveHistoryTarget(returnTo)
  if (historyTarget) {
    applySafeReturn(router, historyTarget, fallback, options)
    return
  }
  if (shouldUseRootCrossoverNavigation(fallback, fallback, options)) {
    navigateToTarget(router, fallback)
    return
  }
  scheduleRouteTransition(() => {
    router.dismissTo(fallback)
  })
}

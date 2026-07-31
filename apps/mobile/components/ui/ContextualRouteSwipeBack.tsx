import type { PropsWithChildren } from 'react'
import {
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
  type Href,
} from 'expo-router'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { ContextualSwipeBack } from './ContextualSwipeBack'

const PRIMARY_ROUTE_KEYS = new Set([
  '',
  'index',
  '(customer)/index',
  '(customer)/saved',
  '(customer)/search',
  '(customer)/messages/index',
  '(customer)/orders/index',
  '(customer)/profile/index',
  '(tailor)/index',
  '(tailor)/clients/index',
  '(tailor)/earnings',
  '(tailor)/orders/index',
  '(tailor)/shop/index',
  '(tailor)/profile/index',
])

const ROUTES_WITH_OWN_EXIT_GESTURE = new Set([
  '(customer)/messages/[orderId]',
  '(tailor)/messages/[orderId]',
  'call-join',
])

function fallbackForSegments(segments: string[]): Href {
  const [group, branch] = segments
  if (group === '(customer)') {
    if (branch === 'messages' || branch === 'orders' || branch === 'profile') {
      return `/(customer)/${branch}` as Href
    }
    return '/(customer)' as Href
  }
  if (group === '(tailor)') {
    if (branch === 'clients' || branch === 'orders' || branch === 'profile' || branch === 'shop') {
      return `/(tailor)/${branch}` as Href
    }
    return '/(tailor)' as Href
  }
  return '/' as Href
}

/**
 * One route-level edge gesture for every mobile child screen.
 *
 * Native stack gestures remain disabled because they can bypass returnTo and
 * historyChain. Screens with destructive/confirming exits keep their own
 * ContextualSwipeBack implementation and are excluded here.
 */
export function ContextualRouteSwipeBack({ children }: PropsWithChildren) {
  const router = useRouter()
  const segments = useSegments() as string[]
  const pathname = usePathname()
  const params = useGlobalSearchParams<{ returnTo?: string; historyChain?: string }>()
  const routeKey = segments.join('/')
  const enabled =
    !routeKey.startsWith('(auth)') &&
    !routeKey.startsWith('vision') &&
    !PRIMARY_ROUTE_KEYS.has(routeKey) &&
    !ROUTES_WITH_OWN_EXIT_GESTURE.has(routeKey)
  const safeReturnTo = pickSafeReturnTo(params.returnTo, params.historyChain)
  const fallback = fallbackForSegments(segments)
  const navigation = { canGoBack: () => router.canGoBack() }

  function handleBack() {
    if (safeReturnTo) {
      goBackOrReturnTo(router, navigation, safeReturnTo, fallback, { fromPath: pathname })
      return
    }
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace(fallback)
  }

  return (
    <ContextualSwipeBack enabled={enabled} onBack={handleBack}>
      {children}
    </ContextualSwipeBack>
  )
}

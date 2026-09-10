import type { Route } from 'next'
import type { AccountSurface } from './surface-contract'

export type AccountNavIcon = 'bell' | 'briefcase' | 'card' | 'heart' | 'help' | 'logout' | 'message' | 'orders' | 'profile' | 'ruler' | 'search' | 'settings' | 'users' | 'wallet'

export type AccountNavGroup = {
  title: string
  items: Array<{ label: string; href: Route; icon: AccountNavIcon; badge?: string | null }>
}

export function accountHomeRoute(role: 'CUSTOMER' | 'TAILOR'): Route {
  return role === 'TAILOR' ? '/account/work' : '/account/orders'
}

export function accountSurfaceAllowedForRole(role: 'CUSTOMER' | 'TAILOR', surface: AccountSurface) {
  // Tailors may enter the Explore surface through their storefront preview.
  // It remains absent from tailor navigation, but must not be redirected away.
  const customerOnly: AccountSurface[] = ['saved', 'brief', 'measurements', 'checkout']
  const tailorOnly: AccountSurface[] = ['work', 'earnings', 'payout', 'profile', 'clients']
  return role === 'CUSTOMER' ? !tailorOnly.includes(surface) : !customerOnly.includes(surface)
}

export function accountNavigation(role: 'CUSTOMER' | 'TAILOR', counts: { activeOrders: number; unreadMessages: number; unreadNotifications?: number; payoutNeedsSetup: boolean }): AccountNavGroup[] {
  const orderBadge = counts.activeOrders > 0 ? String(counts.activeOrders) : null
  const messageBadge = counts.unreadMessages > 0 ? String(counts.unreadMessages) : null
  const notificationBadge = (counts.unreadNotifications ?? 0) > 0 ? String(counts.unreadNotifications) : null
  const account: AccountNavGroup = { title: 'Account', items: [
    { label: 'Notifications', href: '/account/notifications', icon: 'bell', badge: notificationBadge },
    { label: 'Settings', href: '/account/settings', icon: 'settings' },
    { label: 'Support', href: '/account/support', icon: 'help' },
  ] }

  if (role === 'TAILOR') return [
    { title: 'Workspace', items: [
      { label: 'Dashboard', href: '/account/work', icon: 'briefcase', badge: orderBadge },
      { label: 'Orders', href: '/account/orders', icon: 'orders', badge: orderBadge },
      { label: 'Messages', href: '/account/messages', icon: 'message', badge: messageBadge },
      { label: 'Clients', href: '/account/clients', icon: 'users' },
      { label: 'Shop', href: '/account/shop', icon: 'card' },
      { label: 'Earnings', href: '/account/earnings', icon: 'wallet' },
      { label: 'Payout', href: '/account/payout', icon: 'wallet', badge: counts.payoutNeedsSetup ? '!' : null },
      { label: 'Profile', href: '/account/profile', icon: 'profile' },
    ] },
    account,
  ]

  return [
    { title: 'Buying', items: [
      { label: 'Explore', href: '/account/explore', icon: 'search' },
      { label: 'Marketplace', href: '/account/shop', icon: 'card' },
      { label: 'Wishlists', href: '/account/saved', icon: 'heart' },
      { label: 'Orders', href: '/account/orders', icon: 'orders', badge: orderBadge },
      { label: 'Messages', href: '/account/messages', icon: 'message', badge: messageBadge },
      { label: 'Measurements', href: '/account/measurements', icon: 'ruler' },
    ] },
    account,
  ]
}

export function isAccountRouteActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (href === '/account/orders') return pathname === href || pathname.startsWith('/account/orders/')
  if (href === '/account/explore') return pathname === href || pathname.startsWith('/account/tailors/')
  if (href === '/account/shop') return pathname === href || pathname.startsWith('/account/items/')
  return pathname === href
}

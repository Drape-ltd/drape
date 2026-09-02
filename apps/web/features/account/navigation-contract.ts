import type { Route } from 'next'

export type AccountNavIcon = 'briefcase' | 'card' | 'heart' | 'help' | 'logout' | 'message' | 'orders' | 'profile' | 'ruler' | 'search' | 'settings' | 'wallet'

export type AccountNavGroup = {
  title: string
  items: Array<{ label: string; href: Route; icon: AccountNavIcon; badge?: string | null }>
}

export function accountHomeRoute(role: 'CUSTOMER' | 'TAILOR'): Route {
  return role === 'TAILOR' ? '/account/work' : '/account/orders'
}

export function accountNavigation(role: 'CUSTOMER' | 'TAILOR', counts: { activeOrders: number; unreadMessages: number; payoutNeedsSetup: boolean }): AccountNavGroup[] {
  const orderBadge = counts.activeOrders > 0 ? String(counts.activeOrders) : null
  const messageBadge = counts.unreadMessages > 0 ? String(counts.unreadMessages) : null
  const account: AccountNavGroup = { title: 'Account', items: [
    { label: 'Settings', href: '/account/settings', icon: 'settings' },
    { label: 'Support', href: '/account/support', icon: 'help' },
  ] }

  if (role === 'TAILOR') return [
    { title: 'Workspace', items: [
      { label: 'Dashboard', href: '/account/work', icon: 'briefcase', badge: orderBadge },
      { label: 'Orders', href: '/account/orders', icon: 'orders', badge: orderBadge },
      { label: 'Messages', href: '/account/messages', icon: 'message', badge: messageBadge },
      { label: 'Shop', href: '/account/shop', icon: 'card' },
      { label: 'Earnings', href: '/account/earnings', icon: 'wallet' },
      { label: 'Payout', href: '/account/payout', icon: 'wallet', badge: counts.payoutNeedsSetup ? '!' : null },
      { label: 'Profile', href: '/account/profile', icon: 'profile' },
    ] },
    account,
  ]

  return [
    { title: 'Buying', items: [
      { label: 'Explore', href: '/explore', icon: 'search' },
      { label: 'Marketplace', href: '/account/shop', icon: 'card' },
      { label: 'Saved', href: '/account/saved', icon: 'heart' },
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
  if (href === '/explore') return pathname === href || pathname.startsWith('/tailors/')
  if (href === '/account/shop') return pathname === href || pathname.startsWith('/account/items/')
  return pathname === href
}

import { expect, test } from 'playwright/test'
import { accountHomeRoute, accountNavigation, accountSurfaceAllowedForRole, isAccountRouteActive } from '../../features/account/navigation-contract'

test.describe('role-aware account navigation contract', () => {
  test('customer navigation never exposes tailor workspace actions', () => {
    const groups = accountNavigation('CUSTOMER', { activeOrders: 2, unreadMessages: 3, payoutNeedsSetup: true })
    const labels = groups.flatMap((group) => group.items.map((item) => item.label))
    expect(groups.map((group) => group.title)).toEqual(['Buying', 'Account'])
    expect(labels).toEqual(['Explore', 'Marketplace', 'Wishlists', 'Orders', 'Messages', 'Measurements', 'Notifications', 'Settings', 'Support'])
    expect(labels).not.toContain('Dashboard')
    expect(labels).not.toContain('Earnings')
    expect(labels).not.toContain('Payout')
    expect(accountHomeRoute('CUSTOMER')).toBe('/account/orders')
  })

  test('tailor navigation keeps shop, earnings, payout and profile in its workspace', () => {
    const groups = accountNavigation('TAILOR', { activeOrders: 4, unreadMessages: 1, payoutNeedsSetup: true })
    const items = groups.flatMap((group) => group.items)
    expect(items.map((item) => item.label)).toEqual(['Dashboard', 'Orders', 'Messages', 'Clients', 'Shop', 'Earnings', 'Payout', 'Profile', 'Notifications', 'Settings', 'Support'])
    expect(items.find((item) => item.label === 'Payout')?.badge).toBe('!')
    expect(accountHomeRoute('TAILOR')).toBe('/account/work')
  })

  test('detail routes keep their owning navigation destination active', () => {
    expect(isAccountRouteActive('/account/orders/order-1', '/account/orders')).toBe(true)
    expect(isAccountRouteActive('/account/items/item-1', '/account/shop')).toBe(true)
    expect(isAccountRouteActive('/account/tailors/profile-1', '/account/explore')).toBe(true)
    expect(isAccountRouteActive('/account/settings', '/account/orders')).toBe(false)
  })

  test('customer and tailor routes cannot leak into the other workspace', () => {
    expect(accountSurfaceAllowedForRole('CUSTOMER', 'explore')).toBe(true)
    expect(accountSurfaceAllowedForRole('CUSTOMER', 'work')).toBe(false)
    expect(accountSurfaceAllowedForRole('CUSTOMER', 'payout')).toBe(false)
    expect(accountSurfaceAllowedForRole('TAILOR', 'work')).toBe(true)
    expect(accountSurfaceAllowedForRole('TAILOR', 'measurements')).toBe(false)
    expect(accountSurfaceAllowedForRole('TAILOR', 'brief')).toBe(false)
    expect(accountSurfaceAllowedForRole('TAILOR', 'item-detail')).toBe(true)
  })
})

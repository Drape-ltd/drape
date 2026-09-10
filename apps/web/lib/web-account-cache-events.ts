'use client'

export const WEB_ACCOUNT_CACHE_INVALIDATE_EVENT = 'drapeon:web-account-cache-invalidate'
export const WEB_NOTIFICATION_UNREAD_COUNT_EVENT = 'drapeon:web-notification-unread-count'
export const WEB_ACCOUNT_IDENTITY_UPDATE_EVENT = 'drapeon:web-account-identity-update'

export type WebAccountIdentityUpdate = {
  avatarUrl?: string | null
}

export function invalidateWebAccountCaches(reason: 'role-change' | 'sign-out' | 'session-change') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, { detail: { reason } }))
}

export function publishWebNotificationUnreadCount(count: number) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WEB_NOTIFICATION_UNREAD_COUNT_EVENT, {
    detail: { count: Math.max(0, Math.floor(count)) },
  }))
}

export function publishWebAccountIdentityUpdate(update: WebAccountIdentityUpdate) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WEB_ACCOUNT_IDENTITY_UPDATE_EVENT, { detail: update }))
}

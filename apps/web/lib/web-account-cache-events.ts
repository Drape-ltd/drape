'use client'

export const WEB_ACCOUNT_CACHE_INVALIDATE_EVENT = 'drapeon:web-account-cache-invalidate'

export function invalidateWebAccountCaches(reason: 'role-change' | 'sign-out' | 'session-change') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, { detail: { reason } }))
}

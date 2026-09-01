'use client'

import { createClient } from './supabase'
import { clearWebSessionScope } from './web-session-scope'
import { invalidateWebAccountCaches } from './web-account-cache-events'

export type WebSignOutReason = 'manual' | 'session-scope' | 'timeout'
export type WebSignOutScope = 'global' | 'local' | 'others'

export type WebSignOutOptions = {
  reason?: WebSignOutReason
  redirectTo?: string
  scope?: WebSignOutScope
}

function currentCookiePaths() {
  if (typeof window === 'undefined') return ['/']

  const paths = new Set<string>(['/'])
  const segments = window.location.pathname.split('/').filter(Boolean)
  let path = ''

  for (const segment of segments) {
    path += `/${segment}`
    paths.add(path)
  }

  return [...paths]
}

function clearAccessibleCookies() {
  if (typeof document === 'undefined') return

  const cookieNames = document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name))

  if (cookieNames.length === 0) return

  const hostname = window.location.hostname
  const shouldUseDomain = hostname.includes('.') && hostname !== 'localhost'
  const domains = shouldUseDomain ? [hostname, `.${hostname}`] : [undefined]
  const paths = currentCookiePaths()

  for (const name of cookieNames) {
    for (const path of paths) {
      for (const domain of domains) {
        document.cookie = [
          `${name}=`,
          'Max-Age=0',
          'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          `Path=${path}`,
          domain ? `Domain=${domain}` : '',
          'SameSite=Lax',
        ].filter(Boolean).join('; ')
      }
    }
  }
}

export function clearBrowserAuthState() {
  if (typeof window === 'undefined') return

  invalidateWebAccountCaches('sign-out')
  clearWebSessionScope()
  clearAccessibleCookies()

  try {
    window.localStorage.clear()
  } catch (error) {
    console.warn('[web-auth] Could not clear localStorage during sign-out.', error)
  }

  try {
    window.sessionStorage.clear()
  } catch (error) {
    console.warn('[web-auth] Could not clear sessionStorage during sign-out.', error)
  }
}

export async function signOutWebSession(options: WebSignOutOptions = {}) {
  const { redirectTo, scope = 'local' } = options

  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut({ scope })
    if (error) {
      console.warn('[web-auth] Supabase sign-out returned an error.', error.message)
    }
  } catch (error) {
    console.warn('[web-auth] Supabase sign-out failed before local cleanup.', error)
  } finally {
    clearBrowserAuthState()
  }

  if (redirectTo && typeof window !== 'undefined') {
    window.location.assign(redirectTo)
  }
}

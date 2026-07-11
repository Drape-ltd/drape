'use client'

import { useEffect } from 'react'

const AUTH_CALLBACK_PATH = '/auth/callback'
const RECOVERY_CALLBACK_PATH = '/auth/recover'
const WORKSPACE_PATH = '/account/orders'

function hasAuthSignal(searchParams: URLSearchParams, hashParams: URLSearchParams) {
  return (
    searchParams.has('code') ||
    searchParams.has('token_hash') ||
    searchParams.has('access_token') ||
    searchParams.has('refresh_token') ||
    searchParams.has('error_description') ||
    hashParams.has('access_token') ||
    hashParams.has('refresh_token') ||
    hashParams.has('error_description')
  )
}

function isRecovery(searchParams: URLSearchParams, hashParams: URLSearchParams) {
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery'
}

export function AuthLandingRedirect(): null {
  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname === AUTH_CALLBACK_PATH || currentUrl.pathname === RECOVERY_CALLBACK_PATH) {
      return
    }

    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''))
    if (!hasAuthSignal(currentUrl.searchParams, hashParams)) {
      return
    }

    const targetPath = isRecovery(currentUrl.searchParams, hashParams) ? RECOVERY_CALLBACK_PATH : AUTH_CALLBACK_PATH
    const targetUrl = new URL(targetPath, currentUrl.origin)
    currentUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value)
    })

    if (targetPath === AUTH_CALLBACK_PATH && !targetUrl.searchParams.has('next')) {
      targetUrl.searchParams.set('next', WORKSPACE_PATH)
    }

    window.location.replace(`${targetUrl.pathname}${targetUrl.search}${currentUrl.hash}`)
  }, [])

  return null
}

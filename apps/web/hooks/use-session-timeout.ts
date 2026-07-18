'use client'

import { useCallback, useEffect, useRef } from 'react'
import { signOutWebSession } from '../lib/web-auth-session'

const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const ACTIVITY_RESET_THROTTLE_MS = 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'] as const
const TIMEOUT_REDIRECT_PATH = '/sign-in?reason=timeout'

type UseSessionTimeoutOptions = {
  enabled?: boolean
  timeoutMs?: number
}

export function useSessionTimeout({
  enabled = true,
  timeoutMs = SESSION_TIMEOUT_MS,
}: UseSessionTimeoutOptions = {}): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityAtRef = useRef(0)
  const signingOutRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (!timeoutRef.current) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const timeoutSession = useCallback(() => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    clearTimer()
    void signOutWebSession({
      reason: 'timeout',
      redirectTo: TIMEOUT_REDIRECT_PATH,
      scope: 'local',
    })
  }, [clearTimer])

  const resetTimer = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return
    clearTimer()
    timeoutRef.current = setTimeout(timeoutSession, timeoutMs)
  }, [clearTimer, enabled, timeoutMs, timeoutSession])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      clearTimer()
      return undefined
    }

    signingOutRef.current = false
    lastActivityAtRef.current = Date.now()
    resetTimer()

    const markActivity = () => {
      const now = Date.now()
      if (now - lastActivityAtRef.current < ACTIVITY_RESET_THROTTLE_MS) return
      lastActivityAtRef.current = now
      resetTimer()
    }

    const verifyVisibilityTimeout = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityAtRef.current >= timeoutMs) {
        timeoutSession()
        return
      }
      resetTimer()
    }

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, markActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', verifyVisibilityTimeout)

    return () => {
      clearTimer()
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markActivity)
      }
      document.removeEventListener('visibilitychange', verifyVisibilityTimeout)
    }
  }, [clearTimer, enabled, resetTimer, timeoutMs, timeoutSession])
}

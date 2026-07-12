'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { registerWebPushSubscription } from '../lib/web-push-client'

const OPS_WEB_PUSH_SAVED_KEY = 'drapeon:ops:web-push-saved'

type OpsPulseIssue = {
  key?: string | null
  issueNumber?: number | null
  issueType?: string | null
  title?: string | null
}

type OpsPulseResponse = {
  ok?: boolean
  enabled?: boolean
  openCount?: number
  criticalCount?: number
  fingerprint?: string | null
  latest?: OpsPulseIssue | null
}

type OpsPulseAlertsProps = {
  initialOpenCount: number
  initialCriticalCount: number
  initialLatestKey: string
  initialLatestTitle: string | null
  workflowHref: string
}

type WebPushStatus = 'idle' | 'saving' | 'saved' | 'unavailable' | 'failed'

function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function hasSavedOpsWebPush() {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(OPS_WEB_PUSH_SAVED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberOpsWebPushSaved() {
  try {
    window.localStorage.setItem(OPS_WEB_PUSH_SAVED_KEY, '1')
  } catch {
    // Local storage can be disabled; the server-side subscription still matters.
  }
}

function forgetOpsWebPushSaved() {
  try {
    window.localStorage.removeItem(OPS_WEB_PUSH_SAVED_KEY)
  } catch {
    // Nothing to clean up when local storage is unavailable.
  }
}

function initialWebPushStatus(): WebPushStatus {
  return currentPermission() === 'granted' && hasSavedOpsWebPush() ? 'saved' : 'idle'
}

function issueCountCopy(openCount: number, criticalCount: number, latestTitle?: string | null) {
  return [
    `Watching ${openCount} active issue${openCount === 1 ? '' : 's'}`,
    criticalCount > 0 ? `including ${criticalCount} critical` : null,
  ].filter(Boolean).join(', ') + `.${latestTitle ? ` Latest: ${latestTitle}` : ''}`
}

export function OpsPulseAlerts({
  initialOpenCount,
  initialCriticalCount,
  initialLatestKey,
  initialLatestTitle,
  workflowHref,
}: OpsPulseAlertsProps): ReactElement {
  const initialFingerprint = useMemo(
    () => `${initialOpenCount}:${initialCriticalCount}:${initialLatestKey}`,
    [initialCriticalCount, initialLatestKey, initialOpenCount],
  )
  const [openCount, setOpenCount] = useState(initialOpenCount)
  const [criticalCount, setCriticalCount] = useState(initialCriticalCount)
  const [status, setStatus] = useState(() => issueCountCopy(initialOpenCount, initialCriticalCount, initialLatestTitle))
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => currentPermission())
  const [webPushStatus, setWebPushStatus] = useState<WebPushStatus>(() => initialWebPushStatus())
  const initializedFromServerRef = useRef(Boolean(initialFingerprint))
  const originalTitleRef = useRef<string | null>(null)
  const webPushSaveAttemptedRef = useRef(false)

  useEffect(() => {
    if (!window.sessionStorage.getItem('drapeon:ops:pulse:fingerprint') && initialFingerprint) {
      window.sessionStorage.setItem('drapeon:ops:pulse:fingerprint', initialFingerprint)
    }
    if (!window.sessionStorage.getItem('drapeon:ops:pulse:latest-critical') && initialLatestKey) {
      window.sessionStorage.setItem('drapeon:ops:pulse:latest-critical', initialLatestKey)
    }
  }, [initialFingerprint, initialLatestKey])

  useEffect(() => {
    let active = true
    let reloadTimer: number | null = null

    function notify(latest: OpsPulseIssue | null | undefined) {
      if (!latest || !('Notification' in window) || Notification.permission !== 'granted') return
      if (document.visibilityState === 'visible') return
      const issueNumber = latest.issueNumber ? String(latest.issueNumber).padStart(4, '0') : ''
      const notice = new Notification(issueNumber ? `Critical Ops issue #${issueNumber}` : 'Critical Ops issue', {
        body: latest.title || latest.issueType || 'A critical issue needs review.',
        icon: '/icon-192.png',
        tag: latest.key || 'ops-critical',
      })
      notice.onclick = () => {
        window.focus()
        window.location.href = workflowHref
      }
    }

    async function poll() {
      try {
        const response = await fetch('/ops/action?kind=pulse', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        if (!active) return
        if (!response.ok) {
          setStatus('Live Ops pulse could not refresh. Keep this page open and refresh if the session changed.')
          return
        }
        const pulse = (await response.json()) as OpsPulseResponse
        if (!pulse.enabled) return

        const nextOpenCount = Number(pulse.openCount || 0)
        const nextCriticalCount = Number(pulse.criticalCount || 0)
        const nextFingerprint = String(pulse.fingerprint || '')
        const nextLatestKey = pulse.latest?.key ? String(pulse.latest.key) : ''
        const previousFingerprint = window.sessionStorage.getItem('drapeon:ops:pulse:fingerprint') || initialFingerprint
        const previousLatestKey = window.sessionStorage.getItem('drapeon:ops:pulse:latest-critical') || ''

        setOpenCount(nextOpenCount)
        setCriticalCount(nextCriticalCount)
        setStatus(issueCountCopy(nextOpenCount, nextCriticalCount, pulse.latest?.title ?? null))

        if (initializedFromServerRef.current) {
          initializedFromServerRef.current = false
          if (nextFingerprint) window.sessionStorage.setItem('drapeon:ops:pulse:fingerprint', nextFingerprint)
          if (nextLatestKey) window.sessionStorage.setItem('drapeon:ops:pulse:latest-critical', nextLatestKey)
          return
        }

        const hasNewCritical = Boolean(nextLatestKey && nextLatestKey !== previousLatestKey)
        const changed = Boolean(nextFingerprint && nextFingerprint !== previousFingerprint)
        if (hasNewCritical) {
          notify(pulse.latest)
          window.sessionStorage.setItem('drapeon:ops:pulse:latest-critical', nextLatestKey)
        }
        if (changed) {
          window.sessionStorage.setItem('drapeon:ops:pulse:fingerprint', nextFingerprint)
          setStatus('Ops issue state changed. Refreshing the dashboard...')
          reloadTimer = window.setTimeout(() => window.location.reload(), 1400)
        }
      } catch {
        if (active) setStatus('Live Ops pulse is temporarily offline. The dashboard still shows the last loaded state.')
      }
    }

    const firstPoll = window.setTimeout(() => { void poll() }, 2500)
    const interval = window.setInterval(() => { void poll() }, 15000)
    return () => {
      active = false
      window.clearTimeout(firstPoll)
      window.clearInterval(interval)
      if (reloadTimer) window.clearTimeout(reloadTimer)
    }
  }, [initialFingerprint, workflowHref])

  useEffect(() => {
    if (typeof document === 'undefined') return
    originalTitleRef.current ??= document.title
    document.title = criticalCount > 0 ? `(${criticalCount}) Drapeon Ops` : originalTitleRef.current

    return () => {
      if (originalTitleRef.current) document.title = originalTitleRef.current
    }
  }, [criticalCount])

  const saveClosedBrowserAlerts = useCallback(async ({
    keepSavedOnFailure = false,
    showProgress = true,
  }: {
    keepSavedOnFailure?: boolean
    showProgress?: boolean
  } = {}) => {
    if (showProgress) setWebPushStatus('saving')

    const registration = await registerWebPushSubscription('/ops')
    if (!registration.ok) {
      const nextStatus = registration.reason === 'not-configured' ? 'unavailable' : 'failed'
      if (!keepSavedOnFailure || nextStatus === 'unavailable') forgetOpsWebPushSaved()
      if (showProgress || nextStatus === 'unavailable') {
        setWebPushStatus(nextStatus)
      } else if (!keepSavedOnFailure) {
        setWebPushStatus('idle')
      }
      return false
    }

    const response = await fetch('/ops/web-push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ subscription: registration.subscription }),
    }).catch(() => null)

    if (response?.ok) {
      rememberOpsWebPushSaved()
      setWebPushStatus('saved')
      return true
    }

    if (!keepSavedOnFailure) forgetOpsWebPushSaved()
    if (showProgress) {
      setWebPushStatus('failed')
    } else if (!keepSavedOnFailure) {
      setWebPushStatus('idle')
    }
    return false
  }, [])

  useEffect(() => {
    const nextPermission = currentPermission()

    if (nextPermission !== 'granted' || webPushSaveAttemptedRef.current) return
    webPushSaveAttemptedRef.current = true

    const timer = window.setTimeout(() => {
      if (hasSavedOpsWebPush()) {
        void saveClosedBrowserAlerts({ keepSavedOnFailure: true, showProgress: false })
        return
      }

      void saveClosedBrowserAlerts({ showProgress: false })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [saveClosedBrowserAlerts])

  async function enableAlerts() {
    if (!('Notification' in window)) {
      setPermission('unsupported')
      setWebPushStatus('unavailable')
      return
    }
    const nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)
    if (nextPermission !== 'granted') return

    webPushSaveAttemptedRef.current = true
    await saveClosedBrowserAlerts()
  }

  const buttonCopy = (() => {
    if (webPushStatus === 'saving') return 'Saving alerts...'
    if (webPushStatus === 'saved') return 'Closed-browser alerts on'
    if (webPushStatus === 'unavailable') return 'Web push not configured'
    if (webPushStatus === 'failed') return 'Alert save failed'
    if (permission === 'unsupported') return 'Desktop alerts unavailable'
    if (permission === 'granted') return 'Enable closed-browser alerts'
    if (permission === 'denied') return 'Alerts blocked in browser'
    return 'Enable desktop alerts'
  })()
  const buttonDisabled =
    webPushStatus === 'saving' ||
    webPushStatus === 'saved' ||
    webPushStatus === 'unavailable' ||
    permission === 'unsupported' ||
    permission === 'denied'

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-[1.1rem] border border-needle/14 bg-white/82 px-4 py-3 text-sm text-ink shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">Live Ops pulse</p>
        <p className="mt-1 text-sm leading-6 text-ink/66">{status}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="rounded-full border border-needle/14 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">
          {openCount} active
        </span>
        <span className="rounded-full border border-rust/14 bg-rust/8 px-3 py-1.5 text-xs font-semibold text-rust-700">
          {criticalCount} critical
        </span>
        <button
          type="button"
          onClick={() => { void enableAlerts() }}
          disabled={buttonDisabled}
          className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-55"
        >
          {buttonCopy}
        </button>
        <a
          href={workflowHref}
          className="rounded-full bg-needle px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-needle-600"
        >
          Open issues
        </a>
      </div>
    </div>
  )
}

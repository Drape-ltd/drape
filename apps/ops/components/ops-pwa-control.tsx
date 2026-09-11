'use client'

import { Bell, BellOff, Download, LoaderCircle, Smartphone } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

type PushState = 'checking' | 'disabled' | 'enabling' | 'enabled' | 'blocked' | 'unsupported' | 'unconfigured' | 'error'

type SerializablePushSubscription = {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string | null; auth: string | null }
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

let badgeReconciliation: Promise<void> | null = null
let lastBadgeReconciliationAt = 0

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

function serializeSubscription(subscription: PushSubscription): SerializablePushSubscription {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: { p256dh: json.keys?.p256dh ?? null, auth: json.keys?.auth ?? null },
  }
}

async function saveSubscription(subscription: PushSubscription) {
  const response = await fetch('/ops/api/web-push', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: serializeSubscription(subscription) }),
  })
  return response.ok
}

async function loadVapidPublicKey() {
  const response = await fetch('/ops/api/web-push', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return null
  const payload = await response.json() as { enabled?: boolean; publicKey?: string | null }
  return payload.enabled && payload.publicKey ? payload.publicKey : null
}

async function clearAppBadge() {
  const badgeNavigator = navigator as BadgeNavigator
  if (badgeNavigator.clearAppBadge) await badgeNavigator.clearAppBadge()
}

async function performAppBadgeReconciliation() {
  const badgeNavigator = navigator as BadgeNavigator
  if (!badgeNavigator.setAppBadge && !badgeNavigator.clearAppBadge) return
  const response = await fetch('/ops/api/badge', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401 || response.status === 403) {
    await clearAppBadge()
    lastBadgeReconciliationAt = Date.now()
    return
  }
  if (!response.ok) return
  const payload = await response.json() as { attentionCount?: unknown }
  const count = typeof payload.attentionCount === 'number' && Number.isSafeInteger(payload.attentionCount)
    ? Math.max(0, payload.attentionCount)
    : 0
  if (count > 0 && badgeNavigator.setAppBadge) await badgeNavigator.setAppBadge(count)
  else await clearAppBadge()
  lastBadgeReconciliationAt = Date.now()
}

function reconcileAppBadge() {
  if (badgeReconciliation) return badgeReconciliation
  if (Date.now() - lastBadgeReconciliationAt < 10_000) return Promise.resolve()
  badgeReconciliation = performAppBadgeReconciliation().finally(() => { badgeReconciliation = null })
  return badgeReconciliation
}

export function OpsPwaControl() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
  const [pushState, setPushState] = useState<PushState>('checking')

  useEffect(() => {
    let active = true
    const restorePush = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (active) setPushState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (active) setPushState('blocked')
        return
      }
      const registration = await navigator.serviceWorker.register('/ops-sw.js', { scope: '/' })
      const subscription = await registration.pushManager.getSubscription()
      if (!active) return
      if (Notification.permission !== 'granted' || !subscription) {
        setPushState('disabled')
        return
      }
      setPushState(await saveSubscription(subscription) ? 'enabled' : 'error')
    }
    void restorePush().catch(() => { if (active) setPushState('error') })
    void reconcileAppBadge().catch(() => undefined)
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const onInstalled = () => { setInstalled(true); setPrompt(null) }
    const onForeground = () => {
      if (document.visibilityState === 'visible') void reconcileAppBadge().catch(() => undefined)
    }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('focus', onForeground)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
      active = false
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('focus', onForeground)
      document.removeEventListener('visibilitychange', onForeground)
    }
  }, [])

  const enablePush = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }
    setPushState('enabling')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setPushState(permission === 'denied' ? 'blocked' : 'disabled')
      return
    }
    const publicKey = await loadVapidPublicKey()
    if (!publicKey) {
      setPushState('unconfigured')
      return
    }
    try {
      const registration = await navigator.serviceWorker.register('/ops-sw.js', { scope: '/' })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      })
      setPushState(await saveSubscription(subscription) ? 'enabled' : 'error')
    } catch {
      setPushState('error')
    }
  }

  const disablePush = async () => {
    setPushState('checking')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const response = await fetch('/ops/api/web-push', {
          method: 'DELETE',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: serializeSubscription(subscription) }),
        })
        if (!response.ok) {
          setPushState('error')
          return
        }
        await subscription.unsubscribe()
      }
      await clearAppBadge()
      setPushState('disabled')
    } catch {
      setPushState('error')
    }
  }

  const pushLabel = pushState === 'enabled'
    ? 'Alerts on'
    : pushState === 'blocked'
      ? 'Alerts blocked'
      : pushState === 'unsupported'
        ? 'Alerts unavailable'
        : pushState === 'unconfigured'
          ? 'Alerts not configured'
          : pushState === 'error'
            ? 'Retry alerts'
            : pushState === 'checking' || pushState === 'enabling'
              ? 'Checking alerts'
              : 'Enable alerts'

  return <div className="ops-pwa-controls">
    {installed
      ? <span className="ops-pwa-state" title="Installed Ops app"><Smartphone size={14} /><span>Installed</span></span>
      : prompt
        ? <button className="ops-pwa-install" type="button" onClick={async () => { await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted') setInstalled(true); setPrompt(null) }}><Download size={14} /><span>Install Ops</span></button>
        : <Link className="ops-pwa-install" href="/install"><Download size={14} /><span>Install</span></Link>}
    <button
      className="ops-pwa-install"
      data-state={pushState}
      type="button"
      disabled={pushState === 'checking' || pushState === 'enabling' || pushState === 'unsupported' || pushState === 'blocked' || pushState === 'unconfigured'}
      onClick={pushState === 'enabled' ? disablePush : enablePush}
      aria-label={pushState === 'enabled' ? 'Disable Ops push notifications' : pushLabel}
      title={pushState === 'blocked' ? 'Allow notifications in this browser or installed app settings.' : pushLabel}
    >
      {pushState === 'checking' || pushState === 'enabling' ? <LoaderCircle className="ops-spin" size={14} /> : pushState === 'blocked' || pushState === 'unsupported' || pushState === 'unconfigured' ? <BellOff size={14} /> : <Bell size={14} />}
      <span>{pushLabel}</span>
    </button>
  </div>
}

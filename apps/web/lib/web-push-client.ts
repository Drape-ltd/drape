'use client'

export type SerializableWebPushSubscription = {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string | null
    auth: string | null
  }
}

type WebPushPublicKeyResponse = {
  enabled?: boolean
  publicKey?: string | null
}

type WebPushRegistrationResult =
  | { ok: true; subscription: SerializableWebPushSubscription }
  | { ok: false; reason: 'unsupported' | 'not-configured' | 'permission-denied' | 'registration-failed' }

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

function serializeSubscription(subscription: PushSubscription): SerializableWebPushSubscription {
  const json = subscription.toJSON()

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? null,
      auth: json.keys?.auth ?? null,
    },
  }
}

async function loadPublicKey() {
  const response = await fetch('/api/web-push', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return null
  const payload = (await response.json()) as WebPushPublicKeyResponse
  return payload.enabled && payload.publicKey ? payload.publicKey : null
}

export async function registerWebPushSubscription(scope: '/account' | '/ops'): Promise<WebPushRegistrationResult> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return { ok: false, reason: 'unsupported' }
  }

  if (Notification.permission !== 'granted') {
    return { ok: false, reason: 'permission-denied' }
  }

  const publicKey = await loadPublicKey()
  if (!publicKey) return { ok: false, reason: 'not-configured' }

  try {
    const registration = await navigator.serviceWorker.register('/web-push-sw.js', { scope })
    const existing = await registration.pushManager.getSubscription()
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    })

    return { ok: true, subscription: serializeSubscription(subscription) }
  } catch (error) {
    console.warn('[web push] Subscription registration failed.', error)
    return { ok: false, reason: 'registration-failed' }
  }
}

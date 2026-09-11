/* Drapeon Ops service worker: installability and generic workforce alerts only.
 * Operational pages and API responses are deliberately never cached. */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('drapeon-ops-')).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

function safeOpsPath(candidate) {
  if (typeof candidate !== 'string') return '/ops/my-work'
  try {
    const url = new URL(candidate, self.location.origin)
    const allowed = url.origin === self.location.origin
      && (url.pathname === '/ops' || url.pathname.startsWith('/ops/'))
    return allowed ? `${url.pathname}${url.search}${url.hash}` : '/ops/my-work'
  } catch {
    return '/ops/my-work'
  }
}

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = {} }
  const path = safeOpsPath(payload.path)
  event.waitUntil(self.registration.showNotification('Drapeon Ops needs attention', {
    body: 'Open the restricted control plane to review the latest assigned work.',
    icon: '/ops-icon-192.png',
    badge: '/ops-icon-192.png',
    tag: typeof payload.correlationKey === 'string' ? payload.correlationKey.slice(0, 120) : 'drapeon-ops-attention',
    renotify: false,
    data: { path },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const candidate = event.notification.data && typeof event.notification.data.path === 'string'
    ? event.notification.data.path
    : '/ops/my-work'
  const path = safeOpsPath(candidate)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.navigate(path)
      return existing.focus()
    }
    return self.clients.openWindow(path)
  })())
})

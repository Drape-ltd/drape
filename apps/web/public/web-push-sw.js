self.addEventListener('push', (event) => {
  let payload = null

  try {
    payload = event.data ? event.data.json() : null
  } catch {
    payload = null
  }

  const scopePath = (() => {
    try {
      return new URL(self.registration.scope).pathname
    } catch {
      return '/'
    }
  })()

  const defaultUrl = scopePath.startsWith('/ops') ? '/ops?view=workflow-issues' : '/account/orders'
  const title = typeof payload?.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Drapeon update'
  const body = typeof payload?.body === 'string' && payload.body.trim()
    ? payload.body.trim()
    : 'Open Drapeon to review the latest activity.'
  const targetUrl = typeof payload?.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : defaultUrl

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: typeof payload?.tag === 'string' ? payload.tag : 'drapeon-update',
      data: { url: targetUrl },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetPath = event.notification.data?.url || '/'
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of windows) {
      if ('focus' in client && client.url.startsWith(self.location.origin)) {
        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl)
        }
        return client.focus()
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl)
    }

    return undefined
  })())
})

const SESSION_ONLY_STORAGE_KEY = 'drapeon.web.auth.sessionOnly'
const SESSION_TAB_STORAGE_KEY = 'drapeon.web.auth.sessionScope'

function browserStorage() {
  if (typeof window === 'undefined') return null
  return {
    local: window.localStorage,
    session: window.sessionStorage,
  }
}

export function markWebSessionScope(rememberDevice: boolean): void {
  const storage = browserStorage()
  if (!storage) return

  if (rememberDevice) {
    storage.local.removeItem(SESSION_ONLY_STORAGE_KEY)
    storage.session.removeItem(SESSION_TAB_STORAGE_KEY)
    return
  }

  storage.local.setItem(SESSION_ONLY_STORAGE_KEY, '1')
  storage.session.setItem(SESSION_TAB_STORAGE_KEY, '1')
}

export function clearWebSessionScope(): void {
  const storage = browserStorage()
  if (!storage) return
  storage.local.removeItem(SESSION_ONLY_STORAGE_KEY)
  storage.session.removeItem(SESSION_TAB_STORAGE_KEY)
}

export function shouldClearSessionOnlyWebSession(): boolean {
  const storage = browserStorage()
  if (!storage) return false
  return storage.local.getItem(SESSION_ONLY_STORAGE_KEY) === '1' && storage.session.getItem(SESSION_TAB_STORAGE_KEY) !== '1'
}

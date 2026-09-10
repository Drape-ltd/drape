'use client'

type Entry = { value: unknown; expiresAt: number }

const values = new Map<string, Entry>()
const requests = new Map<string, Promise<unknown>>()
export const ACCOUNT_DATA_CACHE_TTL_MS = 20_000

export function readAccountData<T>(key: string, load: () => Promise<T>, ttl = ACCOUNT_DATA_CACHE_TTL_MS): Promise<T> {
  const cached = values.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T)
  const pending = requests.get(key)
  if (pending) return pending as Promise<T>
  const request = load()
    .then((value) => {
      values.set(key, { value, expiresAt: Date.now() + ttl })
      return value
    })
    .finally(() => requests.delete(key))
  requests.set(key, request)
  return request
}

export function invalidateAccountData(prefix?: string) {
  if (!prefix) {
    values.clear()
    requests.clear()
    return
  }
  for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
  for (const key of requests.keys()) if (key.startsWith(prefix)) requests.delete(key)
}

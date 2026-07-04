import AsyncStorage from '@react-native-async-storage/async-storage'
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'

const CACHE_KEY = 'drape:react-query-cache:v1'
const MAX_AGE_MS = 6 * 60 * 60 * 1000
const WRITE_DEBOUNCE_MS = 2_000

type PersistedQueryCache = {
  savedAt: number
  clientState: unknown
}

function shouldPersistQuery(queryKey: readonly unknown[]) {
  const [root] = queryKey
  if (typeof root !== 'string') return false

  // Keep AsyncStorage persistence limited to public or low-risk data. Orders,
  // customer profile data, wishlists, dashboards, and measurement-adjacent
  // queries can contain PII and should be refetched after launch app resumes.
  return [
    'tailor-public',
    'feature-flags',
  ].includes(root)
}

export async function hydratePersistedQueryCache(queryClient: QueryClient) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as PersistedQueryCache
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      await AsyncStorage.removeItem(CACHE_KEY)
      return
    }

    hydrate(queryClient, parsed.clientState as never)
  } catch {
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
  }
}

export function installQueryCachePersistence(queryClient: QueryClient) {
  let writeTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleWrite = () => {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = setTimeout(() => {
      writeTimer = null
      const clientState = dehydrate(queryClient, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' && shouldPersistQuery(query.queryKey),
      })

      AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), clientState } satisfies PersistedQueryCache),
      ).catch(() => {})
    }, WRITE_DEBOUNCE_MS)
  }

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' || event.type === 'removed') {
      scheduleWrite()
    }
  })
}

export async function clearPersistedQueryCache() {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
}

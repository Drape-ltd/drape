import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const VALID_APP_VARIANTS = new Set(['development', 'preview', 'testflight', 'production'])
const VALID_SUPABASE_ENVS = new Set(['development', 'preview', 'staging', 'test', 'production'])

function getSupabaseProjectRef(url: string) {
  try {
    const hostname = new URL(url).hostname
    const [ref, provider] = hostname.split('.')
    return provider === 'supabase' ? ref ?? null : null
  } catch {
    return null
  }
}

function assertMobileSupabaseConfig() {
  const appVariant = (process.env.EXPO_PUBLIC_APP_VARIANT ?? (__DEV__ ? 'development' : 'production'))
    .trim()
    .toLowerCase()
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const supabasePublishableKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    ''
  const supabaseEnv = process.env.EXPO_PUBLIC_SUPABASE_ENV?.trim().toLowerCase() ?? ''
  const declaredProjectRef = process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF?.trim() ?? ''
  const actualProjectRef = getSupabaseProjectRef(supabaseUrl)

  if (!VALID_APP_VARIANTS.has(appVariant)) {
    throw new Error(
      `Invalid EXPO_PUBLIC_APP_VARIANT "${appVariant}". Expected one of development, preview, testflight, production.`
    )
  }

  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL.')
  }

  if (!actualProjectRef) {
    throw new Error(`EXPO_PUBLIC_SUPABASE_URL must point to a Supabase project, received "${supabaseUrl}".`)
  }

  if (!supabasePublishableKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY.')
  }

  if (!supabaseEnv) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_ENV. Set it explicitly so mobile dev and preview builds cannot drift into production.'
    )
  }

  if (!VALID_SUPABASE_ENVS.has(supabaseEnv)) {
    throw new Error(
      `Invalid EXPO_PUBLIC_SUPABASE_ENV "${supabaseEnv}". Expected one of development, preview, staging, test, production.`
    )
  }

  if (appVariant !== 'production' && !declaredProjectRef) {
    throw new Error(
      `Missing EXPO_PUBLIC_SUPABASE_PROJECT_REF for the ${appVariant} mobile environment.`
    )
  }

  if (declaredProjectRef && declaredProjectRef !== actualProjectRef) {
    throw new Error(
      `Supabase project ref mismatch. EXPO_PUBLIC_SUPABASE_URL points to ${actualProjectRef}, but EXPO_PUBLIC_SUPABASE_PROJECT_REF is ${declaredProjectRef}.`
    )
  }

  if (appVariant === 'production' && supabaseEnv !== 'production') {
    throw new Error('Production mobile builds must use EXPO_PUBLIC_SUPABASE_ENV=production.')
  }

  if (appVariant !== 'production' && supabaseEnv === 'production') {
    throw new Error(
      `Refusing to initialize Supabase for the ${appVariant} app with production mobile data settings.`
    )
  }

  return { supabaseUrl, supabasePublishableKey }
}

const { supabaseUrl, supabasePublishableKey } = assertMobileSupabaseConfig()
const supabaseHost = new URL(supabaseUrl).host
const AUTH_STORAGE_VERSION = 'v2'
const legacySupabaseStorageKey = `drape.auth.${supabaseHost}`
const supabaseStorageKey = `drape.auth.${AUTH_STORAGE_VERSION}.${supabaseHost}`
const AUTH_NETWORK_TIMEOUT_MS = 12_000
const DEFAULT_EDGE_FUNCTION_TIMEOUT_MS = 25_000
const LEGACY_AUTH_STORAGE_KEYS = [
  legacySupabaseStorageKey,
  'supabase.auth.token',
  'supabase.auth.token-user',
  'supabase.auth.token-code-verifier',
]

const SECURE_STORE_MAX = 2000
const SECURE_STORE_CHUNK_SIZE = 1800

if (__DEV__) {
  const keyKind = supabasePublishableKey.startsWith('eyJ')
    ? 'anon-jwt'
    : supabasePublishableKey.startsWith('sb_publishable_')
      ? 'publishable'
      : 'unknown'
  console.log('[Drape auth] Supabase client ready', {
    host: supabaseHost,
    keyKind,
    storageVersion: AUTH_STORAGE_VERSION,
  })
}

function chunkMetaKey(key: string) {
  return `${key}.chunks`
}

function chunkKey(key: string, index: number) {
  return `${key}.chunk.${index}`
}

async function readChunkCount(key: string) {
  try {
    const raw = await SecureStore.getItemAsync(chunkMetaKey(key))
    if (!raw) return 0

    const parsed = JSON.parse(raw) as { count?: unknown }
    return typeof parsed.count === 'number' && parsed.count > 0 && Number.isInteger(parsed.count)
      ? parsed.count
      : 0
  } catch {
    return 0
  }
}

async function deleteSecureStoreChunks(key: string) {
  const count = await readChunkCount(key)
  await Promise.all([
    SecureStore.deleteItemAsync(chunkMetaKey(key)).catch(() => {}),
    ...Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, index)).catch(() => {})
    ),
  ])
}

async function readSecureStoreValue(key: string) {
  const count = await readChunkCount(key)
  if (count > 0) {
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    )

    if (chunks.every((chunk): chunk is string => typeof chunk === 'string')) {
      return chunks.join('')
    }

    await deleteSecureStoreChunks(key)
    return null
  }

  return SecureStore.getItemAsync(key)
}

async function writeSecureStoreValue(key: string, value: string) {
  await deleteSecureStoreChunks(key)

  if (value.length <= SECURE_STORE_MAX) {
    await SecureStore.setItemAsync(key, value)
    return
  }

  const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, 'gs')) ?? []
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
  )
  await SecureStore.setItemAsync(chunkMetaKey(key), JSON.stringify({ count: chunks.length }))
  await SecureStore.deleteItemAsync(key).catch(() => {})
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      const secureValue = await readSecureStoreValue(key)
      if (secureValue !== null) return secureValue

      const legacyValue = await AsyncStorage.getItem(key)
      if (legacyValue !== null) {
        await writeSecureStoreValue(key, legacyValue)
        await AsyncStorage.removeItem(key).catch(() => {})
        return legacyValue
      }

      return null
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await writeSecureStoreValue(key, value)
      await AsyncStorage.removeItem(key).catch(() => {})
    } catch (error) {
      if (__DEV__) {
        console.warn('[Drape auth] SecureStore auth write failed; falling back to AsyncStorage.', error)
        await AsyncStorage.setItem(key, value).catch(() => {})
        return
      }
      throw error
    }
  },
  removeItem: async (key: string) => {
    await Promise.all([
      AsyncStorage.removeItem(key).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
      deleteSecureStoreChunks(key),
    ])
  },
}

async function clearLegacyAuthStorage() {
  await Promise.all(
    LEGACY_AUTH_STORAGE_KEYS.flatMap((key) => [
      AsyncStorage.removeItem(key).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
      deleteSecureStoreChunks(key),
    ]),
  )
}

void clearLegacyAuthStorage()

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    storageKey: supabaseStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
})

async function withNetworkTimeout<Result>(
  promise: Promise<Result>,
  message: string,
  timeoutMs = AUTH_NETWORK_TIMEOUT_MS,
): Promise<Result> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<Result>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function getFreshAccessToken(forceRefresh = false): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return null
  }

  const refresh = async () => {
    const { data, error } = await withNetworkTimeout(
      supabase.auth.refreshSession(),
      'Connection timed out before Drapeon could refresh your session. Check your signal and try again.',
    )
    if (!error) {
      return data.session?.access_token ?? null
    }
    return null
  }

  if (forceRefresh) {
    return refresh()
  }

  const expiresAt = session.expires_at ? session.expires_at * 1000 : null
  const isExpiringSoon = !!expiresAt && expiresAt - Date.now() < 60_000

  // getSession() is local-only in React Native. Validate the current access
  // token with Auth so we don't send a stale or corrupted JWT to Edge Functions.
  const { error: userError } = await withNetworkTimeout(
    supabase.auth.getUser(),
    'Connection timed out before Drapeon could verify your session. Check your signal and try again.',
  )
  if (userError) {
    const refreshed = await refresh()
    if (refreshed) return refreshed
    return null
  }

  if (isExpiringSoon) {
    const refreshed = await refresh()
    if (refreshed) return refreshed
  }

  return session.access_token
}

// Edge Functions return endpoint-specific JSON. Callers should pass T, but the
// default stays loose for legacy call sites that narrow response payloads inline.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeFunction<T = any>(
  fn: string,
  options?: { body?: object; headers?: Record<string, string>; timeoutMs?: number },
): Promise<{ data: T | null; error: Error | null }> {
  let token: string | null = null
  try {
    token = await getFreshAccessToken(false)
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  if (!token) {
    return {
      data: null,
      error: new Error('Your session expired. Please sign in again.'),
    }
  }

  try {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_EDGE_FUNCTION_TIMEOUT_MS
    const withTimeout = async <Result,>(promise: Promise<Result>): Promise<Result> => {
      let timeout: ReturnType<typeof setTimeout> | null = null
      try {
        return await Promise.race([
          promise,
          new Promise<Result>((_, reject) => {
            timeout = setTimeout(() => {
              reject(
                new Error(
                  'Connection timed out before Drapeon could confirm this action. Your work is still saved; check your signal and try again.'
                )
              )
            }, timeoutMs)
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }

    const invokeOnce = async () =>
      withTimeout(
        supabase.functions.invoke<T>(fn, {
          body: options?.body ?? {},
          headers: {
            Authorization: `Bearer ${token}`,
            ...options?.headers,
          },
        })
      )

    let { data, error } = await invokeOnce()

    const message = (error as Error | null)?.message ?? ''
    const shouldRetryWithRefresh = /invalid jwt/i.test(message) || /401/.test(message)

    if (error && shouldRetryWithRefresh) {
      token = await getFreshAccessToken(true)
      if (!token) {
        return {
          data: null,
          error: new Error('Your session expired. Please sign in again.'),
        }
      }
      const retryResult = await invokeOnce()
      data = retryResult.data
      error = retryResult.error
    }

    if (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }

    return {
      data: data ?? null,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

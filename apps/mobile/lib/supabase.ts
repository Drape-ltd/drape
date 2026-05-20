import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const VALID_APP_VARIANTS = new Set(['development', 'preview', 'production'])
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
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    ''
  const supabaseEnv = process.env.EXPO_PUBLIC_SUPABASE_ENV?.trim().toLowerCase() ?? ''
  const declaredProjectRef = process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF?.trim() ?? ''
  const actualProjectRef = getSupabaseProjectRef(supabaseUrl)

  if (!VALID_APP_VARIANTS.has(appVariant)) {
    throw new Error(
      `Invalid EXPO_PUBLIC_APP_VARIANT "${appVariant}". Expected one of development, preview, production.`
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
const supabaseStorageKey = `drape.auth.${supabaseHost}`
const LEGACY_AUTH_STORAGE_KEYS = [
  'supabase.auth.token',
  'supabase.auth.token-user',
  'supabase.auth.token-code-verifier',
]

// SecureStore has a 2048-byte limit. Auth tokens exceed this, so we use
// AsyncStorage as the primary store and SecureStore only for small values.
const SECURE_STORE_MAX = 2000

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      // Try AsyncStorage first (handles large tokens)
      const value = await AsyncStorage.getItem(key)
      if (value !== null) return value
      // Fall back to SecureStore for values written before this change
      return await SecureStore.getItemAsync(key)
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      // Always write to AsyncStorage (no size limit for auth tokens)
      await AsyncStorage.setItem(key, value)
      // Also write to SecureStore only if small enough
      if (value.length <= SECURE_STORE_MAX) {
        await SecureStore.setItemAsync(key, value)
      }
    } catch {
      // AsyncStorage write failure is non-fatal for auth flow
    }
  },
  removeItem: async (key: string) => {
    await Promise.all([
      AsyncStorage.removeItem(key).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
    ])
  },
}

async function clearLegacyAuthStorage() {
  await Promise.all(
    LEGACY_AUTH_STORAGE_KEYS.flatMap((key) => [
      AsyncStorage.removeItem(key).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
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
  },
})

async function getFreshAccessToken(forceRefresh = false): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return null
  }

  const refresh = async () => {
    const { data, error } = await supabase.auth.refreshSession()
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
  const { error: userError } = await supabase.auth.getUser()
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
  options?: { body?: object; headers?: Record<string, string> },
): Promise<{ data: T | null; error: Error | null }> {
  let token = await getFreshAccessToken(false)

  if (!token) {
    return {
      data: null,
      error: new Error('Your session expired. Please sign in again.'),
    }
  }

  try {
    const invokeOnce = async () =>
      supabase.functions.invoke<T>(fn, {
        body: options?.body ?? {},
        headers: {
          Authorization: `Bearer ${token}`,
          ...options?.headers,
        },
      })

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

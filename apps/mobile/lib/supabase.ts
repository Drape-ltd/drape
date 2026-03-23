import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

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

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Module-level token cache, kept in sync via a module-level auth subscription.
//
// Why not just rely on supabase.functions.invoke's built-in auth?
// The FunctionsClient caches the Authorization header and only updates it via
// onAuthStateChange. After a hot-reload (module re-eval), the new supabase
// client starts with only the publishable key until SIGNED_IN fires. Meanwhile the
// PostgREST client works because it calls getSession() dynamically on every
// request. Edge function calls fail because they use the stale publishable key.
//
// The module-level subscription below is the self-healing layer: when the new
// supabase client loads the persisted session from AsyncStorage it fires
// INITIAL_SESSION / SIGNED_IN, which updates _accessToken here — without
// waiting for AuthProvider to remount.
let _accessToken: string | null = null

// AuthProvider also calls this on every auth state change as a belt-and-
// suspenders; the module subscription below is the braces.
export function setCurrentAccessToken(token: string | null) {
  _accessToken = token
}

// Self-healing: keep _accessToken in sync with the supabase client's auth state
// at module level. This fires as soon as the client loads the stored session from
// AsyncStorage, regardless of React component lifecycle.
supabase.auth.onAuthStateChange((_event, session) => {
  _accessToken = session?.access_token ?? null
})

export async function invokeFunction<T = any>(
  fn: string,
  options?: { body?: object; headers?: Record<string, string> },
): Promise<{ data: T | null; error: Error | null }> {
  let token = _accessToken
  if (!token) {
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token ?? null
  }
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  return supabase.functions.invoke<T>(fn, {
    ...options,
    headers: { ...authHeader, ...options?.headers },
  })
}

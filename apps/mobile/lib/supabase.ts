import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

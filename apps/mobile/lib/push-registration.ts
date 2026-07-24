import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { supabase } from './supabase'

const PUSH_INSTALLATION_ID_KEY = 'drape:push-installation-id:v1'

function createInstallationId() {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return randomUuid
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export async function getPushInstallationId() {
  const existing = await AsyncStorage.getItem(PUSH_INSTALLATION_ID_KEY)
  if (existing?.trim()) return existing

  const created = createInstallationId()
  await AsyncStorage.setItem(PUSH_INSTALLATION_ID_KEY, created)
  return created
}

export async function registerPushInstallation(token: string) {
  const deviceId = await getPushInstallationId()
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS,
    p_device_id: deviceId,
  })
  if (error) throw new Error(`Could not save push token: ${error.message}`)
}

export async function unregisterPushInstallation() {
  const deviceId = await AsyncStorage.getItem(PUSH_INSTALLATION_ID_KEY)
  if (!deviceId?.trim()) return

  const { error } = await supabase.rpc('unregister_push_token', {
    p_device_id: deviceId,
  })
  if (error) throw new Error(`Could not remove push token: ${error.message}`)
}

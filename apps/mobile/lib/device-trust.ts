import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import type { TrustedDeviceSummary } from '@drape/shared'
import { invokeFunction } from './supabase'

const DEVICE_TOKEN_KEY = 'drapeon.deviceTrust.v1'
let sessionDeviceToken: string | null = null

type DeviceTrustResponse = {
  ok?: boolean
  trusted?: boolean
  challengeId?: string
  maskedEmail?: string
  expiresAt?: string
  token?: string
  remembered?: boolean
  deviceId?: string
  devices?: TrustedDeviceSummary[]
  error?: string
}

function platform() {
  return Platform.OS === 'ios' ? 'IOS' as const : 'ANDROID' as const
}

function label() {
  return Platform.OS === 'ios' ? 'Drapeon on iPhone or iPad' : 'Drapeon on Android'
}

async function storedToken() {
  if (sessionDeviceToken) return sessionDeviceToken
  try {
    sessionDeviceToken = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)
  } catch {
    sessionDeviceToken = null
  }
  return sessionDeviceToken
}

async function call(body: Record<string, unknown>, session?: Session) {
  const { data, error } = await invokeFunction<DeviceTrustResponse>('trusted-device-action', {
    body,
    accessToken: session?.access_token,
  })
  if (error) throw error
  if (!data || data.error) throw new Error(data?.error || 'Device verification could not finish.')
  return data
}

export async function assessMobileDevice(session: Session, rememberDevice: boolean) {
  return call({
    action: 'assess',
    deviceToken: await storedToken() || undefined,
    rememberDevice,
    label: label(),
    platform: platform(),
  }, session)
}

export async function verifyMobileDevice(session: Session, challengeId: string, code: string) {
  const result = await call({ action: 'verify', challengeId, code }, session)
  if (result.token) {
    sessionDeviceToken = result.token
    if (result.remembered) {
      await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, result.token)
    }
  }
  return result
}

export async function isMobileDeviceTrusted(session: Session) {
  const result = await call({
    action: 'list',
    deviceToken: await storedToken() || undefined,
  }, session)
  return result.devices?.some((device) => device.current) === true
}

export async function listMobileTrustedDevices() {
  return call({ action: 'list', deviceToken: await storedToken() || undefined })
}

export async function revokeMobileTrustedDevice(deviceId: string) {
  const current = (await listMobileTrustedDevices()).devices?.find((device) => device.id === deviceId && device.current)
  const result = await call({ action: 'revoke', deviceId })
  if (current) {
    sessionDeviceToken = null
    await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY).catch(() => undefined)
  }
  return result
}

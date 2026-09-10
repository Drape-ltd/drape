export const DEVICE_TRUST_CODE_LENGTH = 6
export const DEVICE_TRUST_CODE_TTL_MINUTES = 10
export const DEVICE_TRUST_MAX_ATTEMPTS = 5
export const DEVICE_TRUST_REMEMBER_DAYS = 30
export const DEVICE_TRUST_SESSION_HOURS = 12

export type DeviceTrustPlatform = 'WEB' | 'IOS' | 'ANDROID'

export type TrustedDeviceSummary = {
  id: string
  label: string
  platform: DeviceTrustPlatform
  trustedAt: string
  lastUsedAt: string
  expiresAt: string
  current: boolean
  remembered: boolean
}

export function isDeviceTrustCode(value: string) {
  return new RegExp(`^\\d{${DEVICE_TRUST_CODE_LENGTH}}$`, 'u').test(value.trim())
}

export function normalizeDeviceLabel(value: string | null | undefined, platform: DeviceTrustPlatform) {
  const fallback = platform === 'WEB' ? 'Web browser' : platform === 'IOS' ? 'iPhone or iPad' : 'Android device'
  const normalized = (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
  return normalized || fallback
}

export function deviceTrustExpiry(remembered: boolean, now = new Date()) {
  const durationMs = remembered
    ? DEVICE_TRUST_REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : DEVICE_TRUST_SESSION_HOURS * 60 * 60 * 1000
  return new Date(now.getTime() + durationMs)
}

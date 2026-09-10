import type { Session } from '@supabase/supabase-js'
import type { DeviceTrustPlatform, TrustedDeviceSummary } from '@drape/shared'

type DeviceTrustResponse = {
  ok?: boolean
  trusted?: boolean
  challengeId?: string
  maskedEmail?: string
  expiresAt?: string
  deviceId?: string
  remembered?: boolean
  attemptsRemaining?: number
  devices?: TrustedDeviceSummary[]
  error?: string
  message?: string
}

function webDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Web browser'
  const agent = navigator.userAgent
  const browser = /Edg\//u.test(agent)
    ? 'Edge'
    : /Chrome\//u.test(agent)
      ? 'Chrome'
      : /Firefox\//u.test(agent)
        ? 'Firefox'
        : /Safari\//u.test(agent)
          ? 'Safari'
          : 'Web browser'
  const system = /Macintosh|Mac OS X/u.test(agent)
    ? 'Mac'
    : /Windows/u.test(agent)
      ? 'Windows'
      : /Android/u.test(agent)
        ? 'Android'
        : /iPhone|iPad/u.test(agent)
          ? 'iPhone or iPad'
          : 'device'
  return `${browser} on ${system}`
}

export async function deviceTrustRequest(
  session: Session,
  body: Record<string, unknown>,
): Promise<DeviceTrustResponse> {
  const response = await fetch('/api/auth/device-trust', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({})) as DeviceTrustResponse
  if (!response.ok || payload.error) {
    throw new Error(payload.message || payload.error || 'Device verification could not finish.')
  }
  return payload
}

export function assessWebDevice(session: Session, rememberDevice: boolean) {
  return deviceTrustRequest(session, {
    action: 'assess',
    rememberDevice,
    label: webDeviceLabel(),
    platform: 'WEB' satisfies DeviceTrustPlatform,
  })
}

export function verifyWebDevice(session: Session, challengeId: string, code: string) {
  return deviceTrustRequest(session, { action: 'verify', challengeId, code })
}

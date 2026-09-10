import {
  DEVICE_TRUST_REMEMBER_DAYS,
  deviceTrustExpiry,
  isDeviceTrustCode,
  normalizeDeviceLabel,
} from '../src/device-trust'

describe('device trust', () => {
  it('accepts only the six digit verification format', () => {
    expect(isDeviceTrustCode('123456')).toBe(true)
    expect(isDeviceTrustCode(' 123456 ')).toBe(true)
    expect(isDeviceTrustCode('12345')).toBe(false)
    expect(isDeviceTrustCode('12345a')).toBe(false)
  })

  it('normalizes labels and supplies platform fallbacks', () => {
    expect(normalizeDeviceLabel('  Safari\n on Mac  ', 'WEB')).toBe('Safari on Mac')
    expect(normalizeDeviceLabel('', 'IOS')).toBe('iPhone or iPad')
  })

  it('trusts remembered devices for the documented window', () => {
    const start = new Date('2026-09-09T12:00:00.000Z')
    expect(deviceTrustExpiry(true, start).toISOString()).toBe(
      new Date(start.getTime() + DEVICE_TRUST_REMEMBER_DAYS * 86_400_000).toISOString(),
    )
    expect(deviceTrustExpiry(false, start).toISOString()).toBe('2026-09-10T00:00:00.000Z')
  })
})

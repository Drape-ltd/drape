import {
  clarifyLegacyScheduledTime,
  formatExplicitZonedDateTime,
  isSupportedTimeZone,
} from '../src/date-time'

describe('explicit scheduled date-time formatting', () => {
  it('uses AM/PM and the event IANA timezone', () => {
    const value = formatExplicitZonedDateTime('2026-07-31T15:20:00.000Z', { timeZone: 'America/Chicago' })
    expect(value).toContain('Fri, Jul 31, 2026')
    expect(value).toContain('10:20 AM')
    expect(value).toMatch(/CDT|GMT-5/)
  })

  it('converts the same instant for another supported timezone', () => {
    const value = formatExplicitZonedDateTime('2026-07-31T15:20:00.000Z', { timeZone: 'Africa/Lagos' })
    expect(value).toContain('4:20 PM')
    expect(value).toMatch(/GMT\+1|WAT/)
  })

  it('detects invalid zones and keeps formatting with a safe fallback', () => {
    expect(isSupportedTimeZone('America/Chicago')).toBe(true)
    expect(isSupportedTimeZone('Not/A_Timezone')).toBe(false)
    expect(formatExplicitZonedDateTime('2026-07-31T15:20:00.000Z', { timeZone: 'Not/A_Timezone' })).toMatch(/AM|PM/)
  })

  it('clarifies legacy 24-hour generated messages', () => {
    expect(clarifyLegacyScheduledTime('31 Jul 2026, 00:45')).toBe('31 Jul 2026 · 12:45 AM')
    expect(clarifyLegacyScheduledTime('31 Jul 2026, 14:05')).toBe('31 Jul 2026 · 2:05 PM')
  })
})

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
} from '../src/auth-security'

describe('validatePasswordStrength', () => {
  it('accepts a strong password', () => {
    expect(validatePasswordStrength('TailorRoom2026!')).toBeNull()
  })

  it('rejects passwords shorter than the minimum length', () => {
    expect(validatePasswordStrength('Abc123!')).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  })

  it('rejects passwords longer than the maximum length', () => {
    expect(validatePasswordStrength(`Abc123!${'x'.repeat(MAX_PASSWORD_LENGTH)}`)).toBe(
      `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`,
    )
  })

  it('rejects passwords without a letter', () => {
    expect(validatePasswordStrength('1234567890!')).toBe(
      'Password must include at least one letter.',
    )
  })

  it('rejects passwords without a number or symbol', () => {
    expect(validatePasswordStrength('abcdefghij')).toBe(
      'Password must include at least one number or symbol.',
    )
  })

  it('rejects leading or trailing spaces', () => {
    expect(validatePasswordStrength(' StrongPass2026!')).toBe(
      'Password cannot start or end with spaces.',
    )
    expect(validatePasswordStrength('StrongPass2026! ')).toBe(
      'Password cannot start or end with spaces.',
    )
  })

  it('rejects common weak passwords', () => {
    expect(validatePasswordStrength('Password123')).toBe(
      'Password is too easy to guess. Choose something less predictable.',
    )
  })

  it('rejects passwords containing the user name or email', () => {
    expect(
      validatePasswordStrength('AdaStrong2026!', {
        forbiddenValues: ['ada@example.com', 'Ada Okafor'],
      }),
    ).toBe('Password should not include your name or email.')
  })
})

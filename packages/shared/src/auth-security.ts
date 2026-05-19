export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72

export const PASSWORD_POLICY_HINT =
  'Use 8-72 characters with at least one letter and one number or symbol. Avoid your name, email, and leading or trailing spaces.'

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'letmein',
  'welcome',
  'admin',
  'admin123',
])

export type PasswordValidationOptions = {
  forbiddenValues?: Array<string | null | undefined>
}

function normalizePasswordFragment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function extractForbiddenFragments(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return []

  const base = trimmed.includes('@') ? (trimmed.split('@')[0] ?? '') : trimmed
  const fragments = new Set<string>()

  const normalizedBase = normalizePasswordFragment(base)
  if (normalizedBase.length >= 3) {
    fragments.add(normalizedBase)
  }

  for (const token of base.split(/[^a-z0-9]+/giu)) {
    const normalized = normalizePasswordFragment(token)
    if (normalized.length >= 3) {
      fragments.add(normalized)
    }
  }

  return Array.from(fragments)
}

export function validatePasswordStrength(
  password: string,
  options: PasswordValidationOptions = {},
): string | null {
  if (!password) {
    return 'Password is required.'
  }

  if (password !== password.trim()) {
    return 'Password cannot start or end with spaces.'
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`
  }

  if (!/[A-Za-z]/u.test(password)) {
    return 'Password must include at least one letter.'
  }

  if (!(/[0-9]/u.test(password) || /[^A-Za-z0-9\s]/u.test(password))) {
    return 'Password must include at least one number or symbol.'
  }

  const normalizedPassword = normalizePasswordFragment(password)
  if (COMMON_WEAK_PASSWORDS.has(normalizedPassword)) {
    return 'Password is too easy to guess. Choose something less predictable.'
  }

  const forbiddenFragments = options.forbiddenValues?.flatMap(extractForbiddenFragments) ?? []
  for (const fragment of forbiddenFragments) {
    if (normalizedPassword.includes(fragment)) {
      return 'Password should not include your name or email.'
    }
  }

  return null
}

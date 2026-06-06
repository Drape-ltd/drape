import { sanitiseText } from '@drape/shared/contact-filter'

const CONTACT_REMOVED_LABEL = 'contact detail removed'

export function safeUserText(value: string | null | undefined, fallback = ''): string {
  const trimmed = value?.trim()
  if (!trimmed) return fallback

  const { sanitised } = sanitiseText(trimmed)
  const cleaned = sanitised
    .replaceAll('[removed]', CONTACT_REMOVED_LABEL)
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
}

export function safeEntityName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return fallback

  const { sanitised, hadViolation } = sanitiseText(trimmed)
  if (hadViolation) return fallback

  return sanitised.replace(/\s+/g, ' ').trim() || fallback
}

export function hasSafeUserText(value: string | null | undefined): boolean {
  return safeUserText(value).length > 0
}

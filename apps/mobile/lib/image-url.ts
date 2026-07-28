import { supabase } from '@/lib/supabase'
import { Sentry } from '@/lib/sentry'

export type StorageImageBucket =
  | 'avatars'
  | 'portfolio-photos'
  | 'order-photos'
  | 'message-media'
  | 'seller-item-media'
  | 'review-media'

export const PROFILE_IMAGE_PLACEHOLDER = { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' } as const
export const PORTFOLIO_IMAGE_PLACEHOLDER = { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' } as const

function isAbsoluteImageUrl(value: string) {
  return /^(https?:|file:|blob:|data:)/i.test(value)
}

export function resolveStorageImageUrl(
  value?: string | null,
  bucket?: StorageImageBucket,
): string | null {
  const raw = value?.trim()
  if (!raw) return null

  if (isAbsoluteImageUrl(raw)) return raw
  if (!bucket) return raw

  const normalizedPath = raw
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${bucket}/`), '')
    .replace(/^public\//, '')

  if (!normalizedPath) return null

  return supabase.storage.from(bucket).getPublicUrl(normalizedPath).data.publicUrl
}

export function captureImageLoadFailure(input: {
  url?: string | null
  bucket?: StorageImageBucket
  surface?: string
  error?: unknown
  attempt?: number
  willRetry?: boolean
  cachePolicy?: string
}) {
  const errorMessage = imageErrorMessage(input.error)
  const diagnosticUrl = safeDiagnosticImageUrl(input.url)
  const diagnosticData = {
    url: diagnosticUrl,
    bucket: input.bucket ?? null,
    surface: input.surface ?? null,
    error: errorMessage,
    attempt: input.attempt ?? 1,
    willRetry: input.willRetry ?? false,
    cachePolicy: input.cachePolicy ?? null,
  }

  if (input.willRetry) {
    Sentry.addBreadcrumb({
      category: 'image',
      level: 'warning',
      message: 'Image load failed; retrying without cache',
      data: diagnosticData,
    })
    return
  }

  Sentry.captureMessage('Image failed to load', {
    level: 'warning',
    fingerprint: ['image-load-failure', input.bucket ?? 'unknown', input.surface ?? 'unknown'],
    extra: diagnosticData,
  })
}

function imageErrorMessage(error: unknown, depth = 0): string {
  if (depth > 3 || error == null) return 'Unknown image error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error !== 'object') return String(error)

  const record = error as Record<string, unknown>
  for (const key of ['error', 'message', 'nativeEvent'] as const) {
    const value = record[key]
    if (value == null || value === error) continue
    const message = imageErrorMessage(value, depth + 1)
    if (message !== 'Unknown image error') return message
  }

  return 'Unknown image error'
}

function safeDiagnosticImageUrl(value?: string | null): string | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^data:/i.test(raw)) return 'data:[omitted]'
  if (/^blob:/i.test(raw)) return 'blob:[omitted]'
  return raw.split(/[?#]/, 1)[0] ?? null
}

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
}) {
  const errorMessage =
    typeof input.error === 'string'
      ? input.error
      : input.error && typeof input.error === 'object' && 'error' in input.error
        ? String((input.error as { error?: unknown }).error ?? 'Unknown image error')
        : 'Unknown image error'

  Sentry.captureMessage('Image failed to load', {
    level: 'warning',
    extra: {
      url: input.url ?? null,
      bucket: input.bucket ?? null,
      surface: input.surface ?? null,
      error: errorMessage,
    },
  })
}

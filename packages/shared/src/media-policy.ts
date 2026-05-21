export const MEDIA_LIMITS_BYTES = {
  image: 10 * 1024 * 1024,
  portfolioVideo: 50 * 1024 * 1024,
  stageVideo: 50 * 1024 * 1024,
  voiceNote: 25 * 1024 * 1024,
} as const

export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ALLOWED_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const
export const ALLOWED_VOICE_CONTENT_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/x-m4a'] as const

export type MediaPurpose =
  | 'AVATAR'
  | 'PORTFOLIO'
  | 'ORDER_REFERENCE'
  | 'PRODUCTION_STAGE'
  | 'READY_MADE_ITEM'
  | 'MESSAGE_MEDIA'
  | 'VISION_PROOF'
  | 'ID_DOCUMENT'
  | 'UNKNOWN'

export type MediaValidationInput = {
  byteLength: number
  contentType?: string | null
  maxBytes?: number | null
  allowedContentTypes?: readonly string[] | null
  purpose?: MediaPurpose
}

function normalizeContentType(value: string | null | undefined) {
  return value?.split(';')[0]?.trim().toLowerCase() || null
}

function contentTypeMatches(contentType: string, allowedContentTypes: readonly string[]) {
  return allowedContentTypes.some((allowed) => {
    const normalized = normalizeContentType(allowed)
    if (!normalized) return false
    if (normalized.endsWith('/*')) return contentType.startsWith(normalized.slice(0, -1))
    return contentType === normalized
  })
}

export function allowedContentTypesForPurpose(purpose: MediaPurpose | undefined) {
  switch (purpose) {
    case 'AVATAR':
    case 'ORDER_REFERENCE':
    case 'READY_MADE_ITEM':
    case 'VISION_PROOF':
      return ALLOWED_IMAGE_CONTENT_TYPES
    case 'PORTFOLIO':
    case 'PRODUCTION_STAGE':
      return [...ALLOWED_IMAGE_CONTENT_TYPES, ...ALLOWED_VIDEO_CONTENT_TYPES] as const
    case 'MESSAGE_MEDIA':
      return [...ALLOWED_IMAGE_CONTENT_TYPES, ...ALLOWED_VIDEO_CONTENT_TYPES, ...ALLOWED_VOICE_CONTENT_TYPES] as const
    default:
      return null
  }
}

export function validateMediaUpload(input: MediaValidationInput) {
  if (!Number.isFinite(input.byteLength) || input.byteLength <= 0) {
    return 'Selected file was empty. Please choose it again.'
  }

  const maxBytes = input.maxBytes ?? null
  if (maxBytes && input.byteLength > maxBytes) {
    return `Selected file must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`
  }

  const contentType = normalizeContentType(input.contentType)
  const allowed = input.allowedContentTypes ?? allowedContentTypesForPurpose(input.purpose) ?? null
  if (contentType && allowed && !contentTypeMatches(contentType, allowed)) {
    return 'That file type is not supported here. Please choose a photo or video from your device.'
  }

  return null
}

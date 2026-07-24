export const MEDIA_LIMITS_BYTES = {
  image: 10 * 1024 * 1024,
  portfolioVideo: 30 * 1024 * 1024,
  readyMadeItemVideo: 30 * 1024 * 1024,
  stageVideo: 30 * 1024 * 1024,
  messageVideo: 30 * 1024 * 1024,
  orderUpdateVideo: 30 * 1024 * 1024,
  reviewVideo: 30 * 1024 * 1024,
  voiceNote: 25 * 1024 * 1024,
} as const

export const MEDIA_LIMITS_SECONDS = {
  portfolioVideo: 30,
  readyMadeItemVideo: 30,
  messageVideo: 60,
  orderUpdateVideo: 60,
  reviewVideo: 30,
} as const

export const VIDEO_DURATION_LIMIT_MESSAGE =
  'Videos must be 30 seconds or less to maintain optimal streaming quality.'
export const OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE =
  'Videos must be 60 seconds or less to keep chat and order updates easy to review.'

export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ALLOWED_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const
export const ALLOWED_VOICE_CONTENT_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/x-m4a'] as const
export const ALLOWED_READY_MADE_ITEM_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
] as const
export const ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
] as const
export const ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
  ...ALLOWED_VOICE_CONTENT_TYPES,
] as const
export const ALLOWED_REVIEW_MEDIA_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
] as const

export function isVideoMediaUrl(src: string | null | undefined) {
  if (!src) return false
  try {
    const pathname = src.startsWith('blob:') || src.startsWith('data:')
      ? src
      : new URL(src).pathname
    return /\.(mp4|mov|m4v)$/iu.test(pathname)
  } catch {
    return /\.(mp4|mov|m4v)$/iu.test(src)
  }
}

export function videoPosterFrameUrl(src: string) {
  try {
    const url = new URL(src)
    url.hash = 't=0.001'
    return url.toString()
  } catch {
    const [base] = src.split('#')
    return base + '#t=0.001'
  }
}

export type MediaPurpose =
  | 'AVATAR'
  | 'PORTFOLIO'
  | 'ORDER_REFERENCE'
  | 'PRODUCTION_STAGE'
  | 'READY_MADE_ITEM'
  | 'MESSAGE_MEDIA'
  | 'REVIEW_MEDIA'
  | 'VISION_PROOF'
  | 'TRUST_VERIFICATION'
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
    case 'VISION_PROOF':
      return ALLOWED_IMAGE_CONTENT_TYPES
    case 'TRUST_VERIFICATION':
      return ALLOWED_VIDEO_CONTENT_TYPES
    case 'READY_MADE_ITEM':
      return ALLOWED_READY_MADE_ITEM_CONTENT_TYPES
    case 'ORDER_REFERENCE':
    case 'PRODUCTION_STAGE':
      return ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES
    case 'PORTFOLIO':
      return [...ALLOWED_IMAGE_CONTENT_TYPES, ...ALLOWED_VIDEO_CONTENT_TYPES] as const
    case 'MESSAGE_MEDIA':
      return ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES
    case 'REVIEW_MEDIA':
      return ALLOWED_REVIEW_MEDIA_CONTENT_TYPES
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

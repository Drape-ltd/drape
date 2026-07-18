import type { ImagePickerAsset } from 'expo-image-picker'
import { ALLOWED_VIDEO_CONTENT_TYPES, VIDEO_DURATION_LIMIT_MESSAGE } from '@drape/shared/media-policy'

type ValidateVideoAssetOptions = {
  maxBytes: number
  maxSeconds: number
  maxBytesMessage: string
  unsupportedMessage?: string
  durationMessage?: string
  skipNonVideo?: boolean
}

export function extensionFromAsset(asset: ImagePickerAsset) {
  const raw = asset.fileName || asset.uri.split('?')[0]?.split('/').pop() || ''
  return raw.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
}

export function pickerVideoContentType(asset: ImagePickerAsset) {
  const normalizedMime = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalizedMime && (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(normalizedMime)) {
    return normalizedMime
  }

  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return normalizedMime ?? 'video/mp4'
}

export function pickerVideoExtension(asset: ImagePickerAsset) {
  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'mov'
  return 'mp4'
}

export function pickerVideoDurationSeconds(asset: ImagePickerAsset) {
  if (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) {
    return null
  }
  return asset.duration / 1000
}

export function isVideoPickerAsset(asset: ImagePickerAsset) {
  const mimeType = asset.mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return asset.type === 'video' || mimeType.startsWith('video/') || /\.(mp4|mov|m4v)(?:$|\?)/iu.test(asset.uri)
}

export function validateVideoPickerAsset(asset: ImagePickerAsset, options: ValidateVideoAssetOptions) {
  if (options.skipNonVideo && !isVideoPickerAsset(asset)) return null

  const contentType = pickerVideoContentType(asset)
  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return options.unsupportedMessage ?? 'Choose an MP4 or MOV video.'
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > options.maxBytes) {
    return options.maxBytesMessage
  }

  const durationSeconds = pickerVideoDurationSeconds(asset)
  if (durationSeconds != null && durationSeconds > options.maxSeconds) {
    return options.durationMessage ?? VIDEO_DURATION_LIMIT_MESSAGE
  }

  return null
}

import { supabase } from '@/lib/supabase'
import { MEDIA_CACHE_CONTROL_SECONDS, validateMediaUpload, type MediaPurpose } from '@drape/shared/media-policy'

type PublicStorageUploadOptions = {
  bucket: string
  path: string
  uri: string
  contentType: string
  maxBytes?: number
  upsert?: boolean
  allowedContentTypes?: readonly string[]
  purpose?: MediaPurpose
}

type UploadValidationOptions = {
  maxBytes?: number
  contentType?: string | null
  allowedContentTypes?: readonly string[] | null
  purpose?: MediaPurpose
}

function normalizeUploadValidationOptions(options?: number | UploadValidationOptions): UploadValidationOptions {
  if (typeof options === 'number') return { maxBytes: options }
  return options ?? {}
}

export async function createValidatedUploadBlob(uri: string, options?: number | UploadValidationOptions) {
  const payload = await createValidatedUploadPayload(uri, options)
  return new Blob([payload.data], {
    type: payload.contentType ?? 'application/octet-stream',
  })
}

export async function createValidatedUploadPayload(uri: string, options?: number | UploadValidationOptions) {
  const validation = normalizeUploadValidationOptions(options)
  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error('Could not read the selected file.')
  }

  const data = await response.arrayBuffer()
  const byteLength = data.byteLength
  const responseContentType = response.headers.get('content-type')
  const contentType = validation.contentType ?? responseContentType
  const validationError = validateMediaUpload({
    byteLength,
    contentType,
    maxBytes: validation.maxBytes,
    allowedContentTypes: validation.allowedContentTypes,
    purpose: validation.purpose,
  })
  if (validationError) throw new Error(validationError)

  return {
    data,
    byteLength,
    contentType,
  }
}

export async function uploadPublicStorageImage(options: PublicStorageUploadOptions) {
  const payload = await createValidatedUploadPayload(options.uri, {
    maxBytes: options.maxBytes,
    contentType: options.contentType,
    allowedContentTypes: options.allowedContentTypes,
    purpose: options.purpose ?? 'UNKNOWN',
  })
  const { error } = await supabase.storage
    .from(options.bucket)
    .upload(options.path, payload.data, {
      contentType: options.contentType,
      cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable,
      upsert: options.upsert ?? false,
    })

  if (error) throw error

  return supabase.storage.from(options.bucket).getPublicUrl(options.path).data.publicUrl
}

export async function uploadPrivateStorageImage(options: PublicStorageUploadOptions) {
  const payload = await createValidatedUploadPayload(options.uri, {
    maxBytes: options.maxBytes,
    contentType: options.contentType,
    allowedContentTypes: options.allowedContentTypes,
    purpose: options.purpose ?? 'UNKNOWN',
  })
  const { error } = await supabase.storage.from(options.bucket).upload(options.path, payload.data, {
    contentType: options.contentType,
    cacheControl: MEDIA_CACHE_CONTROL_SECONDS.private,
    upsert: options.upsert ?? false,
  })
  if (error) throw error
  return options.path
}

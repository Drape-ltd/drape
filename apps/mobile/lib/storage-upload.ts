import { supabase } from '@/lib/supabase'

type PublicStorageUploadOptions = {
  bucket: string
  path: string
  uri: string
  contentType: string
  maxBytes?: number
  upsert?: boolean
}

export async function createValidatedUploadBlob(uri: string, maxBytes?: number) {
  const payload = await createValidatedUploadPayload(uri, maxBytes)
  return new Blob([payload.data], {
    type: payload.contentType ?? 'application/octet-stream',
  })
}

export async function createValidatedUploadPayload(uri: string, maxBytes?: number) {
  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error('Could not read the selected file.')
  }

  const data = await response.arrayBuffer()
  const byteLength = data.byteLength
  if (byteLength <= 0) {
    throw new Error('Selected file was empty. Please choose it again.')
  }

  if (maxBytes && byteLength > maxBytes) {
    throw new Error(`Selected file must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`)
  }

  return {
    data,
    byteLength,
    contentType: response.headers.get('content-type'),
  }
}

export async function uploadPublicStorageImage(options: PublicStorageUploadOptions) {
  const payload = await createValidatedUploadPayload(options.uri, options.maxBytes)
  const { error } = await supabase.storage
    .from(options.bucket)
    .upload(options.path, payload.data, {
      contentType: options.contentType,
      upsert: options.upsert ?? false,
    })

  if (error) throw error

  return supabase.storage.from(options.bucket).getPublicUrl(options.path).data.publicUrl
}

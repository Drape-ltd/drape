/**
 * stripExif — re-encodes an image through expo-image-manipulator,
 * which drops all EXIF metadata (GPS, device info, timestamps).
 *
 * Use before any photo upload to Supabase Storage.
 *
 * Returns the cleaned local URI. If manipulation fails, the upload should
 * stop instead of storing bytes that do not match the file extension/MIME.
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'

type StripExifOptions = {
  maxWidth?: number
  compress?: number
}

export async function stripExif(uri: string, options: StripExifOptions = {}): Promise<string> {
  try {
    const actions = options.maxWidth ? [{ resize: { width: options.maxWidth } }] : []
    const result = await manipulateAsync(
      uri,
      actions,
      { compress: options.compress ?? 0.85, format: SaveFormat.JPEG },
    )
    return result.uri
  } catch {
    throw new Error('Could not prepare the selected image. Please choose a different photo.')
  }
}

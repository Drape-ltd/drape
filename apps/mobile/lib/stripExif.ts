/**
 * stripExif — re-encodes an image through expo-image-manipulator,
 * which drops all EXIF metadata (GPS, device info, timestamps).
 *
 * Use before any photo upload to Supabase Storage.
 *
 * Returns the cleaned local URI. Falls back to the original URI if
 * manipulation fails (better to upload with EXIF than to block the user).
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'

export async function stripExif(uri: string): Promise<string> {
  try {
    const result = await manipulateAsync(
      uri,
      [], // no transforms — just re-encode to drop metadata
      { compress: 0.85, format: SaveFormat.JPEG },
    )
    return result.uri
  } catch {
    return uri
  }
}

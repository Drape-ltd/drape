/**
 * stripExif — re-encodes an image through expo-image-manipulator,
 * which drops all EXIF metadata (GPS, device info, timestamps).
 *
 * Use before any photo upload to Supabase Storage.
 *
 * Returns the cleaned local URI. If manipulation fails, the upload should
 * stop instead of storing bytes that do not match the file extension/MIME.
 */
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator'

type StripExifOptions = {
  maxWidth?: number
  compress?: number
  cropAspectRatio?: number
  sourceWidth?: number
  sourceHeight?: number
}

export async function stripExif(uri: string, options: StripExifOptions = {}): Promise<string> {
  try {
    const actions: Action[] = []

    if (
      options.cropAspectRatio &&
      options.sourceWidth &&
      options.sourceHeight &&
      options.sourceWidth > 0 &&
      options.sourceHeight > 0
    ) {
      const sourceRatio = options.sourceWidth / options.sourceHeight
      const targetRatio = options.cropAspectRatio
      let cropWidth = options.sourceWidth
      let cropHeight = options.sourceHeight

      if (sourceRatio > targetRatio) {
        cropWidth = Math.round(options.sourceHeight * targetRatio)
      } else if (sourceRatio < targetRatio) {
        cropHeight = Math.round(options.sourceWidth / targetRatio)
      }

      actions.push({
        crop: {
          originX: Math.max(0, Math.floor((options.sourceWidth - cropWidth) / 2)),
          originY: Math.max(0, Math.floor((options.sourceHeight - cropHeight) / 2)),
          width: cropWidth,
          height: cropHeight,
        },
      })
    }

    if (options.maxWidth) actions.push({ resize: { width: options.maxWidth } })

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

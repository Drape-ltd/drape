import { Alert, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

import { Sentry } from '@/lib/sentry'

type SafePickerOptions = {
  context: string
  mediaLabel?: string
  title?: string
  extra?: Record<string, unknown>
}

function pickerErrorMessage(error: unknown, mediaLabel: string) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : ''
  const details = `${code} ${message}`

  if (/PHPhotosErrorDomain|3164/i.test(details)) {
    return `iOS could not prepare that ${mediaLabel}. Make sure it has finished downloading to this device, then try again.`
  }

  return `We could not open that ${mediaLabel}. Please choose another file or try again.`
}

export function preferCurrentAssetRepresentation(
  options: ImagePicker.ImagePickerOptions
): ImagePicker.ImagePickerOptions {
  if (Platform.OS !== 'ios') return options

  return {
    ...options,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  }
}

export function preferCompatibleVideoRepresentation(
  options: ImagePicker.ImagePickerOptions
): ImagePicker.ImagePickerOptions {
  if (Platform.OS !== 'ios') return options

  return {
    ...options,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
  }
}

export async function launchImagePickerSafely(
  launch: () => Promise<ImagePicker.ImagePickerResult>,
  options: SafePickerOptions
) {
  try {
    return await launch()
  } catch (error) {
    const mediaLabel = options.mediaLabel ?? 'media file'
    Sentry.captureException(error, {
      extra: {
        context: options.context,
        mediaLabel,
        ...options.extra,
      },
    })
    Alert.alert(options.title ?? 'Could not open media', pickerErrorMessage(error, mediaLabel))
    return null
  }
}

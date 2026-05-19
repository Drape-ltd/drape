import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

export type AvatarImageSource = 'camera' | 'library'

const AVATAR_PICKER_OPTIONS = {
  mediaTypes: 'images' as const,
  allowsEditing: true,
  aspect: [1, 1] as [number, number],
  quality: 0.9,
}

export async function pickAvatarImageUri(source: AvatarImageSource): Promise<string | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()

  if (!permission.granted) {
    Alert.alert(
      'Permission needed',
      source === 'camera'
        ? 'Allow camera access to take a profile photo.'
        : 'Allow photo access to choose a profile photo.',
    )
    return null
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(AVATAR_PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(AVATAR_PICKER_OPTIONS)

  if (result.canceled || !result.assets[0]) return null
  return result.assets[0].uri
}

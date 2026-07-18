import React, { memo, useState } from 'react'
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import { Feather } from '@expo/vector-icons'
import { Colors, FontWeight, Shadow } from '@/constants/theme'
import { captureImageLoadFailure, PROFILE_IMAGE_PLACEHOLDER, resolveStorageImageUrl } from '@/lib/image-url'

type AvatarImageProps = {
  uri?: string | null
  initials?: string
  size: number
  style?: StyleProp<ViewStyle>
  borderColor?: string
  borderWidth?: number
  shadow?: boolean
  testID?: string
}

function AvatarImageComponent({
  uri,
  initials,
  size,
  style,
  borderColor = 'rgba(255,255,255,0.38)',
  borderWidth = 1,
  shadow = false,
  testID,
}: AvatarImageProps) {
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const resolvedUri = resolveStorageImageUrl(uri, 'avatars')

  const loaded = !!resolvedUri && loadedUri === resolvedUri
  const hasRemoteImage = !!resolvedUri && failedUri !== resolvedUri
  const cleanedInitials = initials
    ?.trim()
    .split(/\s+/)
    .map((chunk) => chunk[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <View
      testID={testID}
      style={[
        styles.shell,
        shadow ? styles.shadow : null,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor,
          borderWidth,
        },
        style,
      ]}
    >
      {hasRemoteImage ? (
        <ExpoImage
          source={{ uri: resolvedUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          contentPosition="center"
          cachePolicy="memory-disk"
          transition={120}
          placeholder={PROFILE_IMAGE_PLACEHOLDER}
          onLoad={() => setLoadedUri(resolvedUri)}
          onError={(error) => {
            setFailedUri(resolvedUri)
            captureImageLoadFailure({
              url: resolvedUri,
              bucket: 'avatars',
              surface: 'avatar_image',
              error,
            })
          }}
        />
      ) : null}

      {!hasRemoteImage || !loaded ? (
        <View style={[styles.placeholder, { borderRadius: size / 2 }]}>
          {cleanedInitials ? (
            <Text style={[styles.initials, { fontSize: Math.max(12, Math.round(size * 0.34)) }]}>
              {cleanedInitials}
            </Text>
          ) : (
            <Feather name="user" size={Math.max(16, Math.round(size * 0.42))} color={Colors.needleGreen} />
          )}
        </View>
      ) : null}
    </View>
  )
}

export const AvatarImage = memo(AvatarImageComponent)

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    backgroundColor: Colors.white,
  },
  shadow: {
    ...Shadow.sm,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  initials: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
  },
})

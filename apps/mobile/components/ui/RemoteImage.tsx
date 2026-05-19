import React, { memo, useEffect, useMemo, useState } from 'react'
import { StyleProp, View, ViewStyle } from 'react-native'
import { Image, type ImageProps } from 'expo-image'
import { Colors } from '@/constants/theme'
import {
  captureImageLoadFailure,
  PORTFOLIO_IMAGE_PLACEHOLDER,
  resolveStorageImageUrl,
  type StorageImageBucket,
} from '@/lib/image-url'

type RemoteImageProps = Omit<ImageProps, 'source' | 'placeholder' | 'onError'> & {
  uri?: string | null
  bucket?: StorageImageBucket
  containerStyle?: StyleProp<ViewStyle>
  fallback?: React.ReactNode
  placeholder?: ImageProps['placeholder']
  placeholderColor?: string
  surface?: string
  onLoadError?: (url: string | null) => void
}

function RemoteImageComponent({
  uri,
  bucket,
  containerStyle,
  fallback,
  placeholder = PORTFOLIO_IMAGE_PLACEHOLDER,
  placeholderColor = Colors.boneDeep,
  surface,
  onLoadError,
  style,
  contentFit = 'cover',
  cachePolicy = 'memory-disk',
  transition = 300,
  ...imageProps
}: RemoteImageProps) {
  const resolvedUri = useMemo(() => resolveStorageImageUrl(uri, bucket), [bucket, uri])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [resolvedUri])

  if (!resolvedUri || failed) {
    return (
      <View style={containerStyle}>
        {fallback ?? <View style={[{ backgroundColor: placeholderColor }, style as StyleProp<ViewStyle>]} />}
      </View>
    )
  }

  return (
    <View style={containerStyle}>
      <Image
        {...imageProps}
        source={{ uri: resolvedUri }}
        style={[{ backgroundColor: placeholderColor }, style]}
        contentFit={contentFit}
        cachePolicy={cachePolicy}
        transition={transition}
        placeholder={placeholder}
        onError={(error) => {
          setFailed(true)
          captureImageLoadFailure({ url: resolvedUri, bucket, surface, error })
          onLoadError?.(resolvedUri)
        }}
      />
    </View>
  )
}

export const RemoteImage = memo(RemoteImageComponent)

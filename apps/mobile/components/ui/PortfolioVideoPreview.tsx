import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { ResizeMode, Video } from 'expo-av'
import { Colors } from '@/constants/theme'

type PortfolioVideoPreviewProps = {
  uri: string
  style?: StyleProp<ViewStyle>
  contentFit?: 'contain' | 'cover' | 'fill'
  nativeControls?: boolean
  autoplay?: boolean
  isLooping?: boolean
  showMuteToggle?: boolean
}

export function PortfolioVideoPreview({
  uri,
  style,
  contentFit = 'cover',
  nativeControls = false,
  autoplay = true,
  isLooping = true,
  showMuteToggle,
}: PortfolioVideoPreviewProps) {
  const videoRef = useRef<Video>(null)
  const [isMuted, setIsMuted] = useState(true)
  const resizeMode =
    contentFit === 'contain'
      ? ResizeMode.CONTAIN
      : contentFit === 'fill'
        ? ResizeMode.STRETCH
        : ResizeMode.COVER
  const shouldShowMuteToggle = showMuteToggle ?? nativeControls

  useEffect(() => {
    const player = videoRef.current
    return () => {
      void player?.unloadAsync().catch(() => {})
    }
  }, [uri])

  useEffect(() => {
    if (autoplay) return
    void videoRef.current?.pauseAsync().catch(() => {})
  }, [autoplay])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        void videoRef.current?.pauseAsync().catch(() => {})
      }
    })

    return () => subscription.remove()
  }, [])

  return (
    <View style={[style, styles.wrap]}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        shouldPlay={autoplay}
        isMuted={isMuted}
        isLooping={isLooping}
        useNativeControls={nativeControls}
        progressUpdateIntervalMillis={1000}
      />
      {shouldShowMuteToggle ? (
        <TouchableOpacity
          style={styles.soundToggle}
          onPress={() => setIsMuted((value) => !value)}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
        >
          <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={18} color={Colors.textInverse} />
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  soundToggle: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
})

import { useEffect, useMemo, useRef } from 'react'
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { DailyMediaView } from '@daily-co/react-native-daily-js'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useActiveCall } from '@/lib/active-call'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const AUDIO_DOCK_WIDTH = 154
const AUDIO_DOCK_HEIGHT = 50
const VIDEO_DOCK_WIDTH = 148
const VIDEO_DOCK_HEIGHT = 190
const SCREEN_EDGE = 12

export function ActiveCallMiniDock() {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { session } = useActiveCall()
  const position = useRef(new Animated.ValueXY()).current
  const dragOrigin = useRef({ x: 0, y: 0 })
  const dragged = useRef(false)
  const lastDragEndedAt = useRef(0)
  const screen = Dimensions.get('window')
  const isVideo = session?.context.callType === 'video'
  const dockWidth = isVideo ? VIDEO_DOCK_WIDTH : AUDIO_DOCK_WIDTH
  const dockHeight = isVideo ? VIDEO_DOCK_HEIGHT : AUDIO_DOCK_HEIGHT

  useEffect(() => {
    const x = Math.max(SCREEN_EDGE, screen.width - dockWidth - SCREEN_EDGE)
    const y = Math.max(insets.top + 72, screen.height * 0.22)
    position.setValue({ x, y })
    dragOrigin.current = { x, y }
  }, [dockWidth, insets.top, position, screen.height, screen.width])

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      dragged.current = false
      position.stopAnimation((value) => {
        dragOrigin.current = value
      })
    },
    onPanResponderMove: (_, gesture) => {
      dragged.current = true
      const maxX = Math.max(SCREEN_EDGE, screen.width - dockWidth - SCREEN_EDGE)
      const maxY = Math.max(insets.top + 72, screen.height - dockHeight - insets.bottom - 88)
      position.setValue({
        x: Math.min(maxX, Math.max(SCREEN_EDGE, dragOrigin.current.x + gesture.dx)),
        y: Math.min(maxY, Math.max(insets.top + 72, dragOrigin.current.y + gesture.dy)),
      })
    },
    onPanResponderRelease: () => {
      if (dragged.current) lastDragEndedAt.current = Date.now()
      position.stopAnimation((value) => {
        const left = value.x < (screen.width - dockWidth) / 2
        const targetX = left
          ? SCREEN_EDGE
          : Math.max(SCREEN_EDGE, screen.width - dockWidth - SCREEN_EDGE)
        Animated.spring(position, {
          toValue: { x: targetX, y: value.y },
          useNativeDriver: false,
          damping: 20,
          stiffness: 220,
          mass: 0.8,
        }).start(() => {
          dragOrigin.current = { x: targetX, y: value.y }
        })
      })
    },
    onPanResponderTerminationRequest: () => false,
  }), [dockHeight, dockWidth, insets.bottom, insets.top, position, screen.height, screen.width])

  if (!session || session.meetingState !== 'joined-meeting' || pathname === '/call-join') return null
  const { context } = session

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.dock,
          isVideo ? styles.videoDock : styles.audioDock,
          { transform: position.getTranslateTransform() },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Return to active Drapeon call"
          activeOpacity={0.88}
          style={isVideo ? styles.videoPressable : styles.audioPressable}
          onPress={() => {
            if (Date.now() - lastDragEndedAt.current < 300) return
            router.dismissTo({
              pathname: '/call-join',
              params: {
                orderId: context.orderId,
                callKind: context.callKind,
                callType: context.callType,
                ...(context.historyChain ? { historyChain: context.historyChain } : {}),
              },
            })
          }}
        >
          {isVideo ? (
            <>
              {session.videoTrack ? (
                <DailyMediaView
                  videoTrack={session.videoTrack}
                  audioTrack={null}
                  mirror={session.videoMirror}
                  objectFit="cover"
                  style={styles.video}
                />
              ) : (
                <View style={styles.videoFallback}>
                  <Feather name="video-off" size={24} color={Colors.textInverse} />
                  <Text style={styles.videoFallbackText}>Camera is off</Text>
                </View>
              )}
              <View style={styles.videoTopBar}>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.videoLiveText}>LIVE</Text>
                </View>
                <Feather name="maximize-2" size={16} color={Colors.textInverse} />
              </View>
              <View style={styles.videoBottomBar}>
                <Text numberOfLines={1} style={styles.videoLabel}>{session.videoLabel}</Text>
                <Text style={styles.videoReturn}>Open call</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.liveIcon}>
                <Feather name="phone" size={17} color={Colors.textInverse} />
              </View>
              <View style={styles.copy}>
                <Text style={styles.eyebrow}>LIVE AUDIO</Text>
                <Text numberOfLines={1} style={styles.label}>Back to call</Text>
              </View>
              <Feather name="maximize-2" size={16} color={Colors.textInverse} />
            </>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    ...Shadow.lg,
  },
  audioDock: {
    width: AUDIO_DOCK_WIDTH,
    height: AUDIO_DOCK_HEIGHT,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  videoDock: {
    width: VIDEO_DOCK_WIDTH,
    height: VIDEO_DOCK_HEIGHT,
    borderRadius: Radius.lg,
    backgroundColor: Colors.ink,
    overflow: 'hidden',
  },
  audioPressable: {
    flex: 1,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  videoPressable: { flex: 1 },
  video: { ...StyleSheet.absoluteFillObject },
  videoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.ink,
  },
  videoFallbackText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: FontWeight.medium,
  },
  videoTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 9,
    paddingTop: 8,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#56D798' },
  videoLiveText: {
    color: Colors.textInverse,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: FontWeight.bold,
  },
  videoBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 9,
    paddingTop: 18,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  videoLabel: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  videoReturn: {
    marginTop: 1,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
  },
  liveIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  copy: { flex: 1 },
  eyebrow: {
    color: Colors.textInverse,
    fontSize: 8,
    letterSpacing: 1.1,
    fontWeight: FontWeight.bold,
  },
  label: {
    marginTop: 1,
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
})

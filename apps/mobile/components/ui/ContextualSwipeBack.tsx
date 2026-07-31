import { useMemo, useState, type PropsWithChildren } from 'react'
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'

const EDGE_WIDTH = 26
const COMMIT_DISTANCE = 72
const COMMIT_VELOCITY = 0.55

/**
 * A route-safe edge gesture. Native stack gestures are disabled in Drapeon
 * because they can skip returnTo/historyChain; this delegates to the same
 * contextual exit callback as header back and Android hardware back.
 */
export function ContextualSwipeBack({
  children,
  onBack,
  enabled = true,
}: PropsWithChildren<{ onBack: () => void; enabled?: boolean }>) {
  const [progress] = useState(() => new Animated.Value(0))
  const responder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => (
        enabled &&
        gesture.dx > 6 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25
      ),
      onPanResponderGrant: () => {
        progress.stopAnimation()
      },
      onPanResponderMove: (_, gesture) => {
        progress.setValue(Math.max(0, Math.min(1, gesture.dx / COMMIT_DISTANCE)))
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldCommit = gesture.dx >= COMMIT_DISTANCE || gesture.vx >= COMMIT_VELOCITY
        if (shouldCommit) {
          Animated.timing(progress, {
            toValue: 1,
            duration: 90,
            useNativeDriver: true,
          }).start(() => {
            progress.setValue(0)
            onBack()
          })
          return
        }
        Animated.spring(progress, {
          toValue: 0,
          damping: 18,
          stiffness: 240,
          mass: 0.8,
          useNativeDriver: true,
        }).start()
      },
      onPanResponderTerminate: () => {
        Animated.spring(progress, {
          toValue: 0,
          damping: 18,
          stiffness: 240,
          mass: 0.8,
          useNativeDriver: true,
        }).start()
      },
    })
  }, [enabled, onBack, progress])

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.content,
          enabled && {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.94],
            }),
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 24],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
      {enabled ? (
        <View
          style={styles.edgeTarget}
          pointerEvents="box-only"
          {...responder.panHandlers}
          testID="contextual-swipe-back-edge"
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                opacity: progress,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-18, 14],
                    }),
                  },
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.78, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Feather name="chevron-left" size={21} color={Colors.needleGreen} />
          </Animated.View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  edgeTarget: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
    justifyContent: 'center',
    zIndex: 50,
  },
  indicator: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.lightGrey,
  },
})

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image as NativeImage,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { Sentry } from '@/lib/sentry'

export type CropResult = {
  uri: string
  width: number
  height: number
  originalUri: string
  crop: {
    x: number
    y: number
    width: number
    height: number
    rotation: 0
    aspectRatio: '4:3'
  }
}

type ImageCropEditorProps = {
  visible: boolean
  uri: string | null
  sourceWidth?: number | null
  sourceHeight?: number | null
  aspect?: [number, number]
  onCancel: () => void
  onComplete: (result: CropResult) => void
}

const MAX_ZOOM = 4

function clamp(value: number, min: number, max: number) {
  'worklet'
  return Math.min(max, Math.max(min, value))
}

export function ImageCropEditor({
  visible,
  uri,
  sourceWidth,
  sourceHeight,
  aspect = [4, 3],
  onCancel,
  onComplete,
}: ImageCropEditorProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [resolvedSize, setResolvedSize] = useState({
    width: sourceWidth ?? 0,
    height: sourceHeight ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const zoom = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const touchState = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    startDistance: 0,
    startTouchX: 0,
    startTouchY: 0,
    startZoom: 1,
    startX: 0,
    startY: 0,
  })

  const frameWidth = Math.max(1, windowWidth - (Spacing.lg * 2))
  const requestedFrameHeight = frameWidth * (aspect[1] / aspect[0])
  const frameHeight = Math.min(requestedFrameHeight, Math.max(180, windowHeight * 0.52))
  const imageWidth = Math.max(1, resolvedSize.width)
  const imageHeight = Math.max(1, resolvedSize.height)
  const baseScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight)

  useEffect(() => {
    if (!visible || !uri) return
    setSaving(false)
    zoom.value = 1
    translateX.value = 0
    translateY.value = 0

    if ((sourceWidth ?? 0) > 0 && (sourceHeight ?? 0) > 0) {
      setResolvedSize({ width: sourceWidth!, height: sourceHeight! })
      return
    }

    NativeImage.getSize(
      uri,
      (width, height) => setResolvedSize({ width, height }),
      (error) => {
        Sentry.captureException(error, { extra: { context: 'image_crop_measure_source' } })
      },
    )
  }, [sourceHeight, sourceWidth, translateX, translateY, uri, visible, zoom])

  const cropResponder = useMemo(() => {
    function distance(touches: readonly { pageX: number; pageY: number }[]) {
      if (touches.length < 2) return 0
      return Math.hypot(
        touches[1].pageX - touches[0].pageX,
        touches[1].pageY - touches[0].pageY,
      )
    }

    function beginPan(touch: { pageX: number; pageY: number }) {
      touchState.current = {
        mode: 'pan',
        startDistance: 0,
        startTouchX: touch.pageX,
        startTouchY: touch.pageY,
        startZoom: zoom.value,
        startX: translateX.value,
        startY: translateY.value,
      }
    }

    function beginPinch(touches: readonly { pageX: number; pageY: number }[]) {
      touchState.current = {
        mode: 'pinch',
        startDistance: Math.max(1, distance(touches)),
        startTouchX: 0,
        startTouchY: 0,
        startZoom: zoom.value,
        startX: translateX.value,
        startY: translateY.value,
      }
    }

    function clampTranslation(nextZoom: number, nextX: number, nextY: number) {
      const renderedWidth = imageWidth * baseScale * nextZoom
      const renderedHeight = imageHeight * baseScale * nextZoom
      const maxX = Math.max(0, (renderedWidth - frameWidth) / 2)
      const maxY = Math.max(0, (renderedHeight - frameHeight) / 2)
      translateX.value = clamp(nextX, -maxX, maxX)
      translateY.value = clamp(nextY, -maxY, maxY)
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches
        if (touches.length >= 2) beginPinch(touches)
        else if (touches[0]) beginPan(touches[0])
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches
        if (touches.length >= 2) {
          if (touchState.current.mode !== 'pinch') beginPinch(touches)
          const nextZoom = clamp(
            touchState.current.startZoom * (distance(touches) / touchState.current.startDistance),
            1,
            MAX_ZOOM,
          )
          zoom.value = nextZoom
          clampTranslation(nextZoom, translateX.value, translateY.value)
          return
        }

        if (!touches[0]) return
        if (touchState.current.mode !== 'pan') beginPan(touches[0])
        clampTranslation(
          zoom.value,
          touchState.current.startX + touches[0].pageX - touchState.current.startTouchX,
          touchState.current.startY + touches[0].pageY - touchState.current.startTouchY,
        )
      },
      onPanResponderRelease: () => { touchState.current.mode = 'none' },
      onPanResponderTerminate: () => { touchState.current.mode = 'none' },
      onPanResponderTerminationRequest: () => false,
    })
  }, [baseScale, frameHeight, frameWidth, imageHeight, imageWidth, translateX, translateY, zoom])

  const imageStyle = useAnimatedStyle(() => ({
    width: imageWidth * baseScale,
    height: imageHeight * baseScale,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoom.value },
    ],
  }), [baseScale, imageHeight, imageWidth])

  function reset() {
    zoom.value = withSpring(1, { damping: 18, stiffness: 180 })
    translateX.value = withSpring(0, { damping: 18, stiffness: 180 })
    translateY.value = withSpring(0, { damping: 18, stiffness: 180 })
  }

  function adjustZoom(delta: number) {
    const nextZoom = clamp(zoom.value + delta, 1, MAX_ZOOM)
    const renderedWidth = imageWidth * baseScale * nextZoom
    const renderedHeight = imageHeight * baseScale * nextZoom
    const maxX = Math.max(0, (renderedWidth - frameWidth) / 2)
    const maxY = Math.max(0, (renderedHeight - frameHeight) / 2)
    zoom.value = withSpring(nextZoom, { damping: 18, stiffness: 180 })
    translateX.value = withSpring(clamp(translateX.value, -maxX, maxX), { damping: 18, stiffness: 180 })
    translateY.value = withSpring(clamp(translateY.value, -maxY, maxY), { damping: 18, stiffness: 180 })
  }

  async function applyCrop() {
    if (!uri || resolvedSize.width <= 0 || resolvedSize.height <= 0 || saving) return
    setSaving(true)
    try {
      const effectiveScale = baseScale * zoom.value
      const renderedWidth = imageWidth * effectiveScale
      const renderedHeight = imageHeight * effectiveScale
      const imageLeft = ((frameWidth - renderedWidth) / 2) + translateX.value
      const imageTop = ((frameHeight - renderedHeight) / 2) + translateY.value
      const cropWidth = Math.min(imageWidth, frameWidth / effectiveScale)
      const cropHeight = Math.min(imageHeight, frameHeight / effectiveScale)
      const originX = clamp(-imageLeft / effectiveScale, 0, Math.max(0, imageWidth - cropWidth))
      const originY = clamp(-imageTop / effectiveScale, 0, Math.max(0, imageHeight - cropHeight))

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      )
      onComplete({
        uri: result.uri,
        width: result.width,
        height: result.height,
        originalUri: uri,
        crop: {
          x: originX,
          y: originY,
          width: cropWidth,
          height: cropHeight,
          rotation: 0,
          aspectRatio: '4:3',
        },
      })
    } catch (error) {
      Sentry.captureException(error, { extra: { context: 'image_crop_apply' } })
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.screen}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel cropping"
              style={styles.headerAction}
              onPress={onCancel}
              disabled={saving}
            >
              <Feather name="x" size={25} color={Colors.textInverse} />
            </TouchableOpacity>
            <Text style={styles.title}>Crop photo</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save cropped photo"
              style={styles.doneAction}
              onPress={() => { void applyCrop() }}
              disabled={saving || resolvedSize.width <= 0}
            >
              {saving ? <ActivityIndicator color={Colors.ink} /> : <Text style={styles.doneText}>Done</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.editorArea}>
            <Text style={styles.help}>Pinch to zoom. Drag to frame the detail you want to show.</Text>
            <View style={[styles.cropFrame, { width: frameWidth, height: frameHeight }]}>
              {uri && resolvedSize.width > 0 ? (
                <View collapsable={false} style={styles.gestureSurface} {...cropResponder.panHandlers}>
                  <Animated.Image source={{ uri }} resizeMode="cover" style={[styles.image, imageStyle]} />
                </View>
              ) : (
                <ActivityIndicator size="large" color={Colors.textInverse} />
              )}
              <View pointerEvents="none" style={styles.grid}>
                <View style={[styles.gridLineVertical, { left: '33.333%' }]} />
                <View style={[styles.gridLineVertical, { left: '66.666%' }]} />
                <View style={[styles.gridLineHorizontal, { top: '33.333%' }]} />
                <View style={[styles.gridLineHorizontal, { top: '66.666%' }]} />
              </View>
            </View>
            <View style={styles.cropControls}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Zoom out"
                style={styles.iconControl}
                onPress={() => adjustZoom(-0.25)}
                disabled={saving}
              >
                <Feather name="minus" size={20} color={Colors.textInverse} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Reset crop"
                style={styles.resetButton}
                onPress={reset}
                disabled={saving}
              >
                <Feather name="rotate-ccw" size={18} color={Colors.textInverse} />
                <Text style={styles.resetText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Zoom in"
                style={styles.iconControl}
                onPress={() => adjustZoom(0.25)}
                disabled={saving}
              >
                <Feather name="plus" size={20} color={Colors.textInverse} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.ink },
  header: {
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  title: { color: Colors.textInverse, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  doneAction: {
    minWidth: 72,
    height: 44,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Colors.bone,
  },
  doneText: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  editorArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: Spacing.xl },
  help: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  cropFrame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.bone,
    backgroundColor: '#050505',
  },
  gestureSurface: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {},
  grid: { ...StyleSheet.absoluteFillObject },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  resetButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  cropControls: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  resetText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
})

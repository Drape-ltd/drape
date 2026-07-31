import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const PLAYBACK_RATES = [1, 1.5, 2] as const
const WAVEFORM_HEIGHTS = [8, 13, 19, 11, 22, 16, 9, 18, 24, 12, 17, 10, 21, 15, 8, 14, 23, 18, 11, 20, 13, 9, 17, 25, 15, 10, 19, 12, 22, 14, 8, 16] as const

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function DrapeVoicePlayer({
  uri,
  durationSeconds,
  inverse = false,
  isActive = false,
  onActivate,
  onDeactivate,
  onFinished,
}: {
  uri: string | null
  durationSeconds?: number | null
  inverse?: boolean
  isActive?: boolean
  onActivate?: () => void
  onDeactivate?: () => void
  onFinished?: () => void
}) {
  const soundRef = useRef<Audio.Sound | null>(null)
  const trackWidthRef = useRef(0)
  const finishedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [positionMillis, setPositionMillis] = useState(0)
  const [durationMillis, setDurationMillis] = useState(Math.max(0, (durationSeconds ?? 0) * 1000))
  const [rateIndex, setRateIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  const rate = PLAYBACK_RATES[rateIndex]!
  const progress = durationMillis > 0 ? Math.min(1, positionMillis / durationMillis) : 0
  onFinishedRef.current = onFinished

  useEffect(() => {
    return () => {
      const sound = soundRef.current
      soundRef.current = null
      if (sound) void sound.unloadAsync()
    }
  }, [])

  async function loadSound() {
    if (!uri) return null
    if (soundRef.current) return soundRef.current

    setLoading(true)
    setFailed(false)
    try {
      const { sound, status } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, progressUpdateIntervalMillis: 200, rate, shouldCorrectPitch: true },
      )
      soundRef.current = sound
      if (status.isLoaded) {
        setDurationMillis(status.durationMillis ?? durationMillis)
      }
      sound.setOnPlaybackStatusUpdate((nextStatus) => {
        if (!nextStatus.isLoaded) return
        setPlaying(nextStatus.isPlaying)
        setPositionMillis(nextStatus.positionMillis)
        setDurationMillis(nextStatus.durationMillis ?? durationMillis)
        const resolvedDuration = nextStatus.durationMillis ?? durationMillis
        const reachedEnd = nextStatus.isPlaying && resolvedDuration > 0 && nextStatus.positionMillis >= resolvedDuration - 80
        if (nextStatus.didJustFinish || reachedEnd) {
          if (finishedRef.current) return
          finishedRef.current = true
          setPlaying(false)
          setPositionMillis(0)
          void sound.stopAsync().catch(() => undefined)
          onFinishedRef.current?.()
        }
      })
      return sound
    } catch {
      setFailed(true)
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (isActive) {
      finishedRef.current = false
      void loadSound().then((sound) => {
        if (!cancelled && sound) void sound.playAsync()
      })
    } else if (soundRef.current) {
      void soundRef.current.pauseAsync().catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [isActive, uri])

  async function togglePlayback() {
    const sound = await loadSound()
    if (!sound) return
    if (playing) {
      await sound.pauseAsync()
      onDeactivate?.()
    } else {
      finishedRef.current = false
      onActivate?.()
      await sound.playAsync()
    }
  }

  async function cycleRate() {
    const nextIndex = (rateIndex + 1) % PLAYBACK_RATES.length
    const nextRate = PLAYBACK_RATES[nextIndex]!
    setRateIndex(nextIndex)
    if (soundRef.current) await soundRef.current.setRateAsync(nextRate, true)
  }

  async function seekTo(locationX: number) {
    const sound = await loadSound()
    if (!sound || trackWidthRef.current <= 0 || durationMillis <= 0) return
    const ratio = Math.max(0, Math.min(1, locationX / trackWidthRef.current))
    const nextPosition = Math.round(durationMillis * ratio)
    setPositionMillis(nextPosition)
    await sound.setPositionAsync(nextPosition)
  }

  async function seekBy(deltaMillis: number) {
    const sound = await loadSound()
    if (!sound || durationMillis <= 0) return
    const nextPosition = Math.max(0, Math.min(durationMillis, positionMillis + deltaMillis))
    setPositionMillis(nextPosition)
    await sound.setPositionAsync(nextPosition)
  }

  const foreground = inverse ? Colors.textInverse : Colors.needleGreen
  const secondary = inverse ? 'rgba(255,255,255,0.76)' : Colors.inkLight
  const track = inverse ? 'rgba(255,255,255,0.28)' : Colors.lightGrey

  return (
    <View style={styles.player} accessibilityLabel="Voice note player">
      <Pressable
        onPress={() => void togglePlayback()}
        accessibilityRole="button"
        accessibilityLabel={failed ? 'Retry voice note' : playing ? 'Pause voice note' : 'Play voice note'}
        style={[styles.playButton, inverse && styles.playButtonInverse]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : (
          <Feather name={failed ? 'refresh-cw' : playing ? 'pause' : 'play'} size={17} color={foreground} />
        )}
      </Pressable>

      <View style={styles.timeline}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          accessibilityActions={[
            { name: 'decrement', label: 'Rewind 10 seconds' },
            { name: 'increment', label: 'Forward 10 seconds' },
          ]}
          onAccessibilityAction={(event) => {
            void seekBy(event.nativeEvent.actionName === 'decrement' ? -10_000 : 10_000)
          }}
          onLayout={(event) => { trackWidthRef.current = event.nativeEvent.layout.width }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => { void seekTo(event.nativeEvent.locationX) }}
          onResponderMove={(event) => { void seekTo(event.nativeEvent.locationX) }}
          onResponderRelease={(event) => { void seekTo(event.nativeEvent.locationX) }}
          onResponderTerminationRequest={() => false}
          style={styles.scrubberTouch}
        >
          <View style={styles.waveform}>
            {WAVEFORM_HEIGHTS.map((height, index) => {
              const barProgress = (index + 1) / WAVEFORM_HEIGHTS.length
              return (
                <View
                  key={`${height}:${index}`}
                  style={[
                    styles.waveformBar,
                    { height, backgroundColor: barProgress <= progress ? foreground : track },
                  ]}
                />
              )
            })}
          </View>
        </View>
      </View>

      <Text style={[styles.time, { color: secondary }]} numberOfLines={1}>
        {failed ? 'Retry' : `${formatDuration(positionMillis)}/${formatDuration(durationMillis)}`}
      </Text>

      <Pressable
        onPress={() => void cycleRate()}
        accessibilityRole="button"
        accessibilityLabel={`Playback speed ${rate} times`}
        style={[styles.rateButton, inverse && styles.rateButtonInverse]}
      >
        <Text style={[styles.rateLabel, { color: foreground }]}>{rate}x</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  player: {
    width: 238,
    maxWidth: '100%',
    minWidth: 196,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  playButtonInverse: { backgroundColor: 'rgba(255,255,255,0.16)' },
  timeline: { flex: 1, minWidth: 56 },
  scrubberTouch: { height: 28, justifyContent: 'center' },
  waveform: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 1 },
  waveformBar: { flex: 1, minWidth: 1, maxWidth: 3, borderRadius: Radius.full },
  time: { minWidth: 42, fontFamily: Fonts.body, fontSize: 10, textAlign: 'right' },
  rateButton: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 5,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  rateButtonInverse: { backgroundColor: 'rgba(255,255,255,0.16)' },
  rateLabel: { fontFamily: Fonts.bodyBold, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
})

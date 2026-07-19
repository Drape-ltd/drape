import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const PLAYBACK_RATES = [1, 1.5, 2] as const

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
}: {
  uri: string | null
  durationSeconds?: number | null
  inverse?: boolean
}) {
  const soundRef = useRef<Audio.Sound | null>(null)
  const trackWidthRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [positionMillis, setPositionMillis] = useState(0)
  const [durationMillis, setDurationMillis] = useState(Math.max(0, (durationSeconds ?? 0) * 1000))
  const [rateIndex, setRateIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  const rate = PLAYBACK_RATES[rateIndex]!
  const progress = durationMillis > 0 ? Math.min(1, positionMillis / durationMillis) : 0

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
        if (nextStatus.didJustFinish) {
          setPlaying(false)
          setPositionMillis(0)
          void sound.setPositionAsync(0)
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

  async function togglePlayback() {
    const sound = await loadSound()
    if (!sound) return
    if (playing) await sound.pauseAsync()
    else await sound.playAsync()
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
    await sound.setPositionAsync(Math.round(durationMillis * ratio))
  }

  const foreground = inverse ? Colors.textInverse : Colors.needleGreen
  const secondary = inverse ? 'rgba(255,255,255,0.76)' : Colors.inkLight
  const track = inverse ? 'rgba(255,255,255,0.22)' : Colors.lightGrey

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
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Voice note progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          onLayout={(event) => { trackWidthRef.current = event.nativeEvent.layout.width }}
          onPress={(event) => { void seekTo(event.nativeEvent.locationX) }}
          style={[styles.track, { backgroundColor: track }]}
        >
          <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: foreground }]} />
          <View style={[styles.thumb, { left: `${progress * 100}%`, backgroundColor: foreground }]} />
        </Pressable>
        <View style={styles.metaRow}>
          <Text style={[styles.time, { color: secondary }]}>
            {failed ? 'Tap to retry' : `${formatDuration(positionMillis)} / ${formatDuration(durationMillis)}`}
          </Text>
          <Feather name="volume-2" size={13} color={secondary} />
        </View>
      </View>

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
    width: 268,
    maxWidth: '100%',
    minWidth: 216,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 4,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  playButtonInverse: { backgroundColor: 'rgba(255,255,255,0.16)' },
  timeline: { flex: 1, minWidth: 0, gap: 5 },
  track: { height: 4, borderRadius: Radius.full, justifyContent: 'center' },
  progress: { height: 4, borderRadius: Radius.full },
  thumb: {
    position: 'absolute',
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: Radius.full,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontFamily: Fonts.body, fontSize: FontSize.xs },
  rateButton: {
    minWidth: 38,
    height: 34,
    paddingHorizontal: 7,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  rateButtonInverse: { backgroundColor: 'rgba(255,255,255,0.16)' },
  rateLabel: { fontFamily: Fonts.bodyBold, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
})

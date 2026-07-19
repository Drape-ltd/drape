import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { DrapeVisionConfidence } from '@drape/drape-vision/types'
import {
  Fonts,
  FontSize,
  Radius,
  Shadow,
  Spacing,
  useDrapeTheme,
  type DrapeColorPalette,
} from '@/constants/theme'
import {
  clampVisionProgress,
  visionConfidenceStatus,
  type VisionSurfaceTone,
} from './presentation'

type FeatherName = ComponentProps<typeof Feather>['name']
type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name']

/* eslint-disable no-restricted-syntax -- Camera chrome uses a fixed high-contrast palette in every system theme. */
export const VISION_CAMERA_PALETTE = {
  background: '#0C0D0C',
  surface: 'rgba(20, 22, 21, 0.90)',
  surfaceSoft: 'rgba(20, 22, 21, 0.72)',
  border: 'rgba(255, 255, 255, 0.18)',
  text: '#FFFFFF',
  textMuted: '#D7D8D5',
  primary: '#9FCFB5',
  capture: '#2D6A4F',
  accent: '#F07A52',
} as const
/* eslint-enable no-restricted-syntax */

function toneColors(colors: DrapeColorPalette, tone: VisionSurfaceTone) {
  switch (tone) {
    case 'active':
      return { background: colors.needleGreenLight, foreground: colors.needleGreen, border: colors.needleGreen }
    case 'success':
      return { background: colors.needleGreenLight, foreground: colors.success, border: colors.success }
    case 'warning':
      return { background: colors.statusPendingBg, foreground: colors.statusPending, border: colors.statusPending }
    case 'blocked':
      return { background: colors.statusErrorBg, foreground: colors.error, border: colors.error }
    default:
      return { background: colors.boneDeep, foreground: colors.inkLight, border: colors.lightGrey }
  }
}

export function VisionShell({
  children,
  header,
  footer,
  scrollable = true,
  camera = false,
  contentContainerStyle,
  testID,
}: {
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode | ((compact: boolean) => ReactNode)
  scrollable?: boolean
  camera?: boolean
  contentContainerStyle?: StyleProp<ViewStyle>
  testID?: string
}) {
  const { colors } = useDrapeTheme()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const [footerCompact, setFooterCompact] = useState(false)
  const lastScrollYRef = useRef(0)
  const compactProgress = useSharedValue(0)
  const backgroundColor = camera ? VISION_CAMERA_PALETTE.background : colors.bone

  useEffect(() => {
    compactProgress.value = withTiming(footerCompact ? 1 : 0, { duration: 180 })
  }, [compactProgress, footerCompact])

  const compactSideInset = Math.max(Spacing.xxxl, (windowWidth - 184) / 2)
  const footerMotionStyle = useAnimatedStyle(() => ({
    left: interpolate(compactProgress.value, [0, 1], [Spacing.xl, compactSideInset]),
    right: interpolate(compactProgress.value, [0, 1], [Spacing.xl, compactSideInset]),
    transform: [{ scale: interpolate(compactProgress.value, [0, 1], [1, 0.96]) }],
  }), [compactSideInset])

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!footer) return
    const nextY = Math.max(0, event.nativeEvent.contentOffset.y)
    const delta = nextY - lastScrollYRef.current

    if (nextY <= 16) {
      setFooterCompact(false)
    } else if (delta >= 8) {
      setFooterCompact(true)
    } else if (delta <= -8) {
      setFooterCompact(false)
    }

    if (Math.abs(delta) >= 2) {
      lastScrollYRef.current = nextY
    }
  }, [footer])

  const footerContent = typeof footer === 'function' ? footer(footerCompact) : footer
  const body = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.shellContent,
        footer ? { paddingBottom: 128 + insets.bottom } : null,
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      onScroll={handleScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentContainerStyle]}>{children}</View>
  )

  return (
    <SafeAreaView
      testID={testID}
      edges={camera ? ['top', 'bottom'] : ['top']}
      style={[styles.shell, { backgroundColor }]}
    >
      {header}
      {body}
      {footer ? (
        <View pointerEvents="box-none" style={styles.footerLayer}>
          <Animated.View
            style={[
              styles.floatingFooter,
              footerMotionStyle,
              {
                bottom: Math.max(insets.bottom, Spacing.sm),
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.lightGrey,
              },
            ]}
          >
            {footerContent}
          </Animated.View>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

export function VisionHeader({
  status,
  tone = 'neutral',
  onClose,
  closeLabel = 'Close Drapeon Vision',
  camera = false,
  disabled = false,
}: {
  status: string
  tone?: VisionSurfaceTone
  onClose: () => void
  closeLabel?: string
  camera?: boolean
  disabled?: boolean
}) {
  const { colors } = useDrapeTheme()
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onClose}
        hitSlop={8}
        style={({ pressed }) => [
          styles.headerButton,
          {
            backgroundColor: camera ? VISION_CAMERA_PALETTE.surfaceSoft : colors.surface,
            borderColor: camera ? VISION_CAMERA_PALETTE.border : colors.lightGrey,
          },
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Feather name="x" size={20} color={camera ? VISION_CAMERA_PALETTE.text : colors.ink} />
      </Pressable>
      <VisionStatusChip label={status} tone={tone} camera={camera} />
    </View>
  )
}

export function VisionStatusChip({
  label,
  tone = 'neutral',
  camera = false,
}: {
  label: string
  tone?: VisionSurfaceTone
  camera?: boolean
}) {
  const { colors } = useDrapeTheme()
  const palette = toneColors(colors, tone)
  const foreground = camera
    ? tone === 'warning' || tone === 'blocked' ? VISION_CAMERA_PALETTE.accent : VISION_CAMERA_PALETTE.primary
    : palette.foreground

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.statusChip,
        {
          backgroundColor: camera ? VISION_CAMERA_PALETTE.surfaceSoft : palette.background,
          borderColor: camera ? VISION_CAMERA_PALETTE.border : palette.border,
        },
      ]}
    >
      <View style={[styles.statusDot, { backgroundColor: foreground }]} />
      <Text style={[styles.statusText, { color: camera ? VISION_CAMERA_PALETTE.text : foreground }]}>
        {label}
      </Text>
    </View>
  )
}

export function VisionStepCard({
  icon,
  materialIcon,
  eyebrow,
  title,
  body,
  status,
  statusTone,
  selected = false,
  disabled = false,
  onPress,
  trailing,
}: {
  icon?: FeatherName
  materialIcon?: MaterialName
  eyebrow?: string
  title: string
  body: string
  status?: string
  statusTone?: VisionSurfaceTone
  selected?: boolean
  disabled?: boolean
  onPress?: () => void
  trailing?: ReactNode
}) {
  const { colors } = useDrapeTheme()
  const content = (
    <>
      <View style={[styles.stepIcon, { backgroundColor: colors.needleGreenLight }]}>
        {materialIcon ? (
          <MaterialCommunityIcons name={materialIcon} size={22} color={colors.needleGreen} />
        ) : (
          <Feather name={icon ?? 'aperture'} size={21} color={colors.needleGreen} />
        )}
      </View>
      <View style={styles.stepCopy}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.needleGreen }]}>{eyebrow}</Text> : null}
        <Text style={[styles.stepTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.stepBody, { color: colors.inkLight }]}>{body}</Text>
        {status ? <VisionStatusChip label={status} tone={statusTone} /> : null}
      </View>
      {trailing ?? (onPress ? <Feather name="chevron-right" size={20} color={colors.midGrey} /> : null)}
    </>
  )
  const cardStyle = [
    styles.stepCard,
    {
      backgroundColor: colors.surface,
      borderColor: selected ? colors.needleGreen : colors.lightGrey,
    },
    selected && styles.stepCardSelected,
    disabled && styles.disabled,
  ]

  if (!onPress) return <View style={cardStyle}>{content}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${status ?? ''}. ${body}`.trim()}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  )
}

export function VisionInstructionPanel({
  icon = 'aperture',
  title,
  body,
  tone = 'active',
  camera = false,
  progress,
}: {
  icon?: FeatherName
  title: string
  body?: string | null
  tone?: VisionSurfaceTone
  camera?: boolean
  progress?: number
}) {
  const { colors } = useDrapeTheme()
  const palette = toneColors(colors, tone)
  const accent = camera
    ? tone === 'warning' || tone === 'blocked' ? VISION_CAMERA_PALETTE.accent : VISION_CAMERA_PALETTE.primary
    : palette.foreground

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={[title, body].filter(Boolean).join('. ')}
      style={[
        styles.instruction,
        {
          backgroundColor: camera ? VISION_CAMERA_PALETTE.surface : palette.background,
          borderColor: camera ? VISION_CAMERA_PALETTE.border : palette.border,
        },
      ]}
    >
      <View style={styles.instructionRow}>
        <Feather name={icon} size={20} color={accent} />
        <View style={styles.instructionCopy}>
          <Text style={[styles.instructionTitle, { color: camera ? VISION_CAMERA_PALETTE.text : colors.ink }]}>{title}</Text>
          {body ? (
            <Text style={[styles.instructionBody, { color: camera ? VISION_CAMERA_PALETTE.textMuted : colors.inkLight }]}>{body}</Text>
          ) : null}
        </View>
      </View>
      {typeof progress === 'number' ? <VisionProgressRail progress={progress} camera={camera} /> : null}
    </View>
  )
}

export function VisionProgressRail({
  progress,
  camera = false,
  segments,
}: {
  progress: number
  camera?: boolean
  segments?: number
}) {
  const { colors } = useDrapeTheme()
  const reducedMotion = useReducedMotion()
  const animatedProgress = useSharedValue(clampVisionProgress(progress))

  useEffect(() => {
    animatedProgress.value = withTiming(clampVisionProgress(progress), {
      duration: reducedMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
    })
  }, [animatedProgress, progress, reducedMotion])

  const fillStyle = useAnimatedStyle(() => ({
    width: `${animatedProgress.value * 100}%`,
  }))

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clampVisionProgress(progress) * 100) }}
      style={[styles.progressTrack, { backgroundColor: camera ? VISION_CAMERA_PALETTE.border : colors.lightGrey }]}
    >
      <Animated.View
        style={[
          styles.progressFill,
          { backgroundColor: camera ? VISION_CAMERA_PALETTE.primary : colors.needleGreen },
          fillStyle,
        ]}
      />
      {segments && segments > 1 ? (
        <View pointerEvents="none" style={styles.segmentLayer}>
          {Array.from({ length: segments - 1 }, (_, index) => (
            <View
              key={index}
              style={[styles.segmentDivider, { left: `${((index + 1) / segments) * 100}%` }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function VisionCaptureControl({
  label,
  icon = 'play',
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string
  icon?: FeatherName
  onPress: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.captureOuter,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      <View style={styles.captureInner}>
        {loading ? (
          <ActivityIndicator color={VISION_CAMERA_PALETTE.text} />
        ) : (
          <Feather name={icon} size={28} color={VISION_CAMERA_PALETTE.text} />
        )}
      </View>
    </Pressable>
  )
}

export function VisionMetricCard({
  label,
  value,
  confidence,
  note,
  emphasized = false,
  onEdit,
}: {
  label: string
  value: string
  confidence?: DrapeVisionConfidence | null
  note?: string
  emphasized?: boolean
  onEdit?: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${value}. ${visionConfidenceStatus(confidence).label}.`}
      style={[
        styles.metricCard,
        {
          backgroundColor: emphasized ? colors.needleGreenLight : colors.surface,
          borderColor: emphasized ? colors.needleGreen : colors.lightGrey,
        },
      ]}
    >
      <View style={styles.metricHeader}>
        <Text style={[styles.metricLabel, { color: colors.inkLight }]}>{label}</Text>
        {onEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={onEdit} hitSlop={8}>
            <Feather name="edit-2" size={15} color={colors.needleGreen} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.metricValue, { color: colors.ink }]} adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
      <VisionConfidenceBadge confidence={confidence} />
      {note ? <Text style={[styles.metricNote, { color: colors.inkLight }]}>{note}</Text> : null}
    </View>
  )
}

export function VisionConfidenceBadge({ confidence }: { confidence?: DrapeVisionConfidence | null }) {
  const status = visionConfidenceStatus(confidence)
  return <VisionStatusChip label={status.label} tone={status.tone} />
}

export function VisionPrivacyNotice({ points }: { points: readonly string[] }) {
  const { colors } = useDrapeTheme()
  return (
    <View style={[styles.privacy, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
      <View style={styles.privacyHeader}>
        <Feather name="shield" size={19} color={colors.needleGreen} />
        <Text style={[styles.privacyTitle, { color: colors.ink }]}>Private by design</Text>
      </View>
      {points.map((point) => (
        <View key={point} style={styles.privacyRow}>
          <Feather name="check-circle" size={16} color={colors.needleGreen} />
          <Text style={[styles.privacyText, { color: colors.inkLight }]}>{point}</Text>
        </View>
      ))}
    </View>
  )
}

export function VisionErrorState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}) {
  const { colors } = useDrapeTheme()
  return (
    <View style={styles.errorState}>
      <View style={[styles.errorIcon, { backgroundColor: colors.statusErrorBg }]}>
        <Feather name="alert-triangle" size={26} color={colors.error} />
      </View>
      <Text style={[styles.errorTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.errorBody, { color: colors.inkLight }]}>{body}</Text>
      <VisionPrimaryButton label={actionLabel} onPress={onAction} />
      {secondaryLabel && onSecondary ? (
        <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} onPress={onSecondary} style={styles.secondaryAction}>
          <Text style={[styles.secondaryActionText, { color: colors.needleGreen }]}>{secondaryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function VisionSectionTitle({
  eyebrow,
  title,
  body,
  style,
}: {
  eyebrow?: string
  title: string
  body?: string
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useDrapeTheme()
  return (
    <View style={[styles.sectionHeading, style]}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: colors.needleGreen }]}>{eyebrow}</Text> : null}
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
      {body ? <Text style={[styles.sectionBody, { color: colors.inkLight }]}>{body}</Text> : null}
    </View>
  )
}

export function VisionPrimaryButton({
  label,
  icon = 'arrow-right',
  onPress,
  disabled = false,
  loading = false,
  compact = false,
  style,
}: {
  label: string
  icon?: FeatherName
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  compact?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useDrapeTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        compact && styles.primaryActionCompact,
        { backgroundColor: colors.needleGreen },
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={VISION_CAMERA_PALETTE.text} />
      ) : (
        <>
          {!compact ? <Text style={styles.primaryActionText}>{label}</Text> : null}
          <Feather name={icon} size={18} color={VISION_CAMERA_PALETTE.text} />
        </>
      )}
    </Pressable>
  )
}

export function VisionDockIconButton({
  icon,
  label,
  onPress,
  destructive = false,
  disabled = false,
}: {
  icon: FeatherName
  label: string
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  const { colors } = useDrapeTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.dockIconAction,
        {
          backgroundColor: colors.surface,
          borderColor: destructive ? colors.error : colors.lightGrey,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Feather name={icon} size={19} color={destructive ? colors.error : colors.needleGreen} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shell: { flex: 1 },
  shellContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },
  footerLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 40,
    elevation: 40,
  },
  floatingFooter: {
    position: 'absolute',
    left: Spacing.xl,
    right: Spacing.xl,
    minHeight: 64,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    ...Shadow.lg,
  },
  header: {
    minHeight: 62,
    paddingHorizontal: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
  statusChip: {
    minHeight: 30,
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: { width: 7, height: 7, borderRadius: Radius.full },
  statusText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, lineHeight: 16 },
  stepCard: {
    minHeight: 112,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  stepCardSelected: { borderWidth: 1.5 },
  stepIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  stepCopy: { flex: 1, gap: 5 },
  eyebrow: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, lineHeight: 16, textTransform: 'uppercase' },
  stepTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.lg, lineHeight: 23 },
  stepBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  instruction: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.lg, gap: Spacing.md },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  instructionCopy: { flex: 1, gap: 3 },
  instructionTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, lineHeight: 21 },
  instructionBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  progressTrack: { height: 8, borderRadius: Radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.full },
  segmentLayer: { ...StyleSheet.absoluteFillObject },
  segmentDivider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.6)' },
  captureOuter: {
    width: 78,
    height: 78,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: VISION_CAMERA_PALETTE.text,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: Radius.full,
    backgroundColor: VISION_CAMERA_PALETTE.capture,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricCard: {
    minWidth: 0,
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 132,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  metricLabel: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: FontSize.sm, lineHeight: 18 },
  metricValue: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xxl, lineHeight: 32 },
  metricNote: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 18 },
  privacy: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.lg, gap: Spacing.md },
  privacyHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  privacyTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, lineHeight: 21 },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  privacyText: { flex: 1, fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  errorState: { flex: 1, justifyContent: 'center', alignItems: 'stretch', paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  errorIcon: { width: 58, height: 58, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  errorTitle: { fontFamily: Fonts.display, fontSize: FontSize.xxl, lineHeight: 32, textAlign: 'center' },
  errorBody: { fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 23, textAlign: 'center' },
  sectionHeading: { gap: Spacing.sm },
  sectionTitle: { fontFamily: Fonts.display, fontSize: FontSize.xxl, lineHeight: 32 },
  sectionBody: { fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 23 },
  primaryAction: {
    minHeight: 54,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadow.md,
  },
  primaryActionCompact: {
    width: 50,
    minHeight: 50,
    paddingHorizontal: 0,
  },
  dockIconAction: {
    width: 50,
    height: 50,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    lineHeight: 21,
    color: VISION_CAMERA_PALETTE.text,
    textAlign: 'center',
  },
  secondaryAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 20 },
})

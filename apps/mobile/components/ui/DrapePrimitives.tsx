import { useEffect, type ComponentProps, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import {
  resolveStatusDisplay,
  type StatusDisplayDomain,
  type StatusDisplayTone,
} from '@drape/shared/status-display'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { BottomSheetScaffold, type BottomSheetScaffoldAction } from './BottomSheetScaffold'
import { Input } from './Input'
import { SkeletonBlock } from './Skeleton'
import { useDrapeCapsuleNavMotion } from './DrapeCapsuleNav'

type FeatherName = ComponentProps<typeof Feather>['name']
type ActionTone = 'primary' | 'secondary' | 'ghost' | 'destructive'
type StatusTone = StatusDisplayTone

export type DrapePressableProps = PressableProps & {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

export function DrapePressable({ children, style, disabled, ...props }: DrapePressableProps) {
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole={props.accessibilityRole ?? 'button'}
      accessibilityState={{ ...props.accessibilityState, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.pressable,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {children}
    </Pressable>
  )
}

export type DrapeIconButtonProps = Omit<DrapePressableProps, 'children' | 'accessibilityLabel'> & {
  icon: FeatherName
  accessibilityLabel: string
  size?: number
  tone?: ActionTone
}

export function DrapeIconButton({
  icon,
  accessibilityLabel,
  size = 20,
  tone = 'ghost',
  style,
  ...props
}: DrapeIconButtonProps) {
  return (
    <DrapePressable
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, styles[`iconButton_${tone}`], style]}
      {...props}
    >
      <Feather
        name={icon}
        size={size}
        color={tone === 'primary' || tone === 'destructive' ? Colors.textInverse : Colors.ink}
      />
    </DrapePressable>
  )
}

export type DrapeCapsuleButtonProps = Omit<DrapePressableProps, 'children'> & {
  label: string
  icon?: FeatherName
  tone?: ActionTone
  loading?: boolean
  compact?: boolean
  textStyle?: StyleProp<TextStyle>
}

export function DrapeCapsuleButton({
  label,
  icon,
  tone = 'primary',
  loading = false,
  compact = false,
  disabled,
  style,
  textStyle,
  ...props
}: DrapeCapsuleButtonProps) {
  const blocked = disabled || loading
  const inverse = tone === 'primary' || tone === 'destructive'

  return (
    <DrapePressable
      disabled={blocked}
      accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityState={{ ...props.accessibilityState, disabled: !!blocked, busy: loading }}
      style={[
        styles.capsuleButton,
        compact && styles.capsuleButtonCompact,
        styles[`capsuleButton_${tone}`],
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={inverse ? Colors.textInverse : Colors.needleGreen} />
      ) : (
        <>
          {icon ? (
            <Feather name={icon} size={18} color={inverse ? Colors.textInverse : Colors.ink} />
          ) : null}
          <Text
            numberOfLines={2}
            style={[
              styles.capsuleButtonLabel,
              inverse && styles.capsuleButtonLabelInverse,
              tone === 'ghost' && styles.capsuleButtonLabelGhost,
              textStyle,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </DrapePressable>
  )
}

export function DrapeActionBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.actionBar, style]}>{children}</View>
}

export const DRAPE_FLOATING_ACTION_DOCK_CLEARANCE = 112

export function DrapeFloatingActionDock({
  children,
  style,
  testID,
  compactOnScroll = true,
  compactWidth,
  forceCompact = false,
}: {
  children: ReactNode | ((compact: boolean) => ReactNode)
  style?: StyleProp<ViewStyle>
  testID?: string
  compactOnScroll?: boolean
  compactWidth?: number
  forceCompact?: boolean
}) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const { compact } = useDrapeCapsuleNavMotion()
  const effectiveCompact = forceCompact || (compactOnScroll && compact)
  const compactProgress = useSharedValue(effectiveCompact ? 1 : 0)
  const compactSideInset = compactWidth
    ? Math.max(Spacing.xxxl, (windowWidth - compactWidth) / 2)
    : Spacing.xxxl

  useEffect(() => {
    compactProgress.value = withTiming(effectiveCompact ? 1 : 0, { duration: 180 })
  }, [compactProgress, effectiveCompact])

  const motionStyle = useAnimatedStyle(() => ({
    left: interpolate(compactProgress.value, [0, 1], [Spacing.xl, compactSideInset]),
    right: interpolate(compactProgress.value, [0, 1], [Spacing.xl, compactSideInset]),
    transform: [{ scale: interpolate(compactProgress.value, [0, 1], [1, 0.94]) }],
  }), [compactSideInset])
  const content = typeof children === 'function' ? children(effectiveCompact) : children

  return (
    <View pointerEvents="box-none" style={styles.floatingActionLayer}>
      <Animated.View
        testID={testID}
        style={[
          styles.floatingActionDock,
          motionStyle,
          {
            bottom: Math.max(insets.bottom, Spacing.sm),
            backgroundColor: Colors.surface,
            borderColor: Colors.lightGrey,
          },
          style,
        ]}
      >
        {content}
      </Animated.View>
    </View>
  )
}

export function DrapeInlineActionCard({
  eyebrow,
  title,
  body,
  icon,
  children,
}: {
  eyebrow?: string
  title: string
  body?: string | null
  icon?: FeatherName
  children?: ReactNode
}) {
  return (
    <View style={styles.inlineCard}>
      <View style={styles.inlineCardHeader}>
        {icon ? (
          <View style={styles.inlineCardIcon}>
            <Feather name={icon} size={18} color={Colors.needleGreen} />
          </View>
        ) : null}
        <View style={styles.inlineCardCopy}>
          {eyebrow ? <Text style={styles.inlineCardEyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.inlineCardTitle}>{title}</Text>
          {body ? <Text style={styles.inlineCardBody}>{body}</Text> : null}
        </View>
      </View>
      {children ? <View style={styles.inlineCardActions}>{children}</View> : null}
    </View>
  )
}

export function DrapeStatusChip({
  value,
  label,
  tone,
  domain = 'generic',
  accessibilityLabel,
  testID,
  style,
}: {
  value?: string | null
  label?: string
  tone?: StatusTone
  domain?: StatusDisplayDomain
  accessibilityLabel?: string
  testID?: string
  style?: StyleProp<ViewStyle>
}) {
  const display = resolveStatusDisplay(value, { domain })
  const displayLabel = label ?? display.label
  const displayTone = tone ?? display.tone
  return (
    <View
      style={[styles.statusChip, styles[`statusChip_${displayTone}`], style]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? displayLabel}
      testID={testID}
    >
      <View style={[styles.statusDot, styles[`statusDot_${displayTone}`]]} />
      <Text style={[styles.statusLabel, styles[`statusLabel_${displayTone}`]]}>{displayLabel}</Text>
    </View>
  )
}

export const DrapeField = Input
export const DrapeSkeleton = SkeletonBlock

export function DrapeEmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: FeatherName
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyStateIcon}>
        <Feather name={icon} size={24} color={Colors.needleGreen} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateBody}>{body}</Text>
      {action ? <View style={styles.emptyStateAction}>{action}</View> : null}
    </View>
  )
}

export function DrapeSheet(props: {
  visible: boolean
  title: string
  subtitle?: string | null
  onDismiss: () => void
  children: ReactNode
  scrollable?: boolean
  snapPoints?: Array<number | string>
  enableDynamicSizing?: boolean
  primaryAction?: BottomSheetScaffoldAction
  secondaryAction?: BottomSheetScaffoldAction
  destructiveAction?: BottomSheetScaffoldAction
  testID?: string
}) {
  return <BottomSheetScaffold {...props} />
}

const styles = StyleSheet.create({
  pressable: {
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
  iconButton: {
    width: 44,
    height: 44,
    minHeight: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton_primary: { backgroundColor: Colors.needleGreen },
  iconButton_secondary: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey },
  iconButton_ghost: { backgroundColor: 'transparent' },
  iconButton_destructive: { backgroundColor: Colors.error },
  capsuleButton: {
    minHeight: 52,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadow.md,
  },
  capsuleButtonCompact: { minHeight: 44, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  capsuleButton_primary: { backgroundColor: Colors.needleGreen },
  capsuleButton_secondary: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey },
  capsuleButton_ghost: { backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  capsuleButton_destructive: { backgroundColor: Colors.error },
  capsuleButtonLabel: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  capsuleButtonLabelInverse: { color: Colors.textInverse },
  capsuleButtonLabelGhost: { color: Colors.needleGreen },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  floatingActionLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
    elevation: 20,
  },
  floatingActionDock: {
    position: 'absolute',
    minHeight: 64,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.lg,
  },
  inlineCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  inlineCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  inlineCardIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  inlineCardCopy: { flex: 1, gap: 3 },
  inlineCardEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
  },
  inlineCardTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  inlineCardBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20, color: Colors.inkLight },
  inlineCardActions: { gap: Spacing.sm },
  statusChip: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  statusChip_success: { backgroundColor: Colors.needleGreenLight },
  statusDot_success: { backgroundColor: Colors.success },
  statusLabel_success: { color: Colors.needleGreenDark },
  statusChip_warning: { backgroundColor: Colors.statusPendingBg },
  statusDot_warning: { backgroundColor: Colors.statusPending },
  statusLabel_warning: { color: Colors.warning },
  statusChip_danger: { backgroundColor: Colors.errorLight },
  statusDot_danger: { backgroundColor: Colors.error },
  statusLabel_danger: { color: Colors.error },
  statusChip_neutral: { backgroundColor: Colors.boneDeep },
  statusDot_neutral: { backgroundColor: Colors.midGrey },
  statusLabel_neutral: { color: Colors.inkLight },
  statusChip_info: { backgroundColor: Colors.needleGreenLight },
  statusDot_info: { backgroundColor: Colors.needleGreen },
  statusLabel_info: { color: Colors.needleGreenDark },
  emptyState: { alignItems: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  emptyStateIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  emptyStateTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyStateBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20, color: Colors.inkLight, textAlign: 'center' },
  emptyStateAction: { alignSelf: 'stretch', marginTop: Spacing.sm },
})

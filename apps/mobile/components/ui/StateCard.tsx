import type { ComponentProps, ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontWeight, Spacing } from '@/constants/theme'

type StateCardTone = 'empty' | 'error' | 'warning' | 'success'

type StateCardProps = {
  title: string
  body: string
  tone?: StateCardTone
  icon?: ComponentProps<typeof Feather>['name']
  actionLabel?: string
  onAction?: () => void
  children?: ReactNode
}

const toneColor: Record<StateCardTone, { iconBg: string; icon: string }> = {
  empty: { iconBg: Colors.needleGreenLight, icon: Colors.needleGreenDark },
  error: { iconBg: Colors.statusErrorBg, icon: Colors.error },
  warning: { iconBg: Colors.statusPendingBg, icon: Colors.kanteRust },
  success: { iconBg: Colors.needleGreenLight, icon: Colors.needleGreenDark },
}

export function StateCard({
  title,
  body,
  tone = 'empty',
  icon,
  actionLabel,
  onAction,
  children,
}: StateCardProps) {
  const colors = toneColor[tone]
  const resolvedIcon = icon ?? (tone === 'error' ? 'alert-circle' : tone === 'warning' ? 'alert-triangle' : 'inbox')

  return (
    <View style={styles.card}>
      <View style={[styles.iconCircle, { backgroundColor: colors.iconBg }]}>
        <Feather name={resolvedIcon} size={26} color={colors.icon} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={tone === 'error' || tone === 'warning' ? styles.secondaryAction : styles.primaryAction}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          activeOpacity={0.75}
        >
          <Text style={tone === 'error' || tone === 'warning' ? styles.secondaryActionText : styles.primaryActionText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 18,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    textAlign: 'center',
    letterSpacing: 0,
  },
  body: {
    maxWidth: 250,
    fontFamily: Fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.inkLight,
    textAlign: 'center',
  },
  primaryAction: {
    width: '100%',
    minHeight: 56,
    marginTop: Spacing.lg,
    borderRadius: 14,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.textInverse,
  },
  secondaryAction: {
    minWidth: 180,
    minHeight: 56,
    marginTop: Spacing.lg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.ink,
  },
})

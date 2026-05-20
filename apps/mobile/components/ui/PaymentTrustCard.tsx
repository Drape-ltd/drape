import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type PaymentTrustCardProps = {
  body?: string
  actionLabel?: string
  onPressAction?: () => void
}

export function PaymentTrustCard({
  body = 'Drape holds payment securely until delivery is confirmed and the dispute window closes.',
  actionLabel,
  onPressAction,
}: PaymentTrustCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Payment protected</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onPressAction ? (
        <TouchableOpacity
          style={styles.action}
          onPress={onPressAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          activeOpacity={0.75}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreenDark,
    letterSpacing: 0,
  },
  body: {
    maxWidth: 330,
    fontFamily: Fonts.body,
    fontSize: FontSize.lg,
    lineHeight: 26,
    color: Colors.needleGreenDark,
  },
  action: {
    width: 180,
    minHeight: 54,
    marginTop: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
})

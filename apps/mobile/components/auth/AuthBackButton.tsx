import { Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'

type AuthBackButtonProps = {
  onPress: () => void
  style?: ViewStyle
  label?: string
}

export function AuthBackButton({ onPress, style, label = 'Back' }: AuthBackButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Feather name="chevron-left" size={20} color={Colors.needleGreen} />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    paddingVertical: Spacing.xs,
  },
  label: {
    fontFamily: Fonts.bodyMedium,
    color: Colors.needleGreen,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
})

import React from 'react'
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type TouchableOpacityProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends TouchableOpacityProps {
  label: string
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  style?: ViewStyle
  textStyle?: TextStyle
}

export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  loading = false,
  fullWidth = true,
  style,
  textStyle,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      disabled={isDisabled}
      activeOpacity={0.75}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: loading }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? Colors.textInverse : Colors.needleGreen}
        />
      ) : (
        <Text
          style={[
            styles.label,
            styles[`label_${variant}`],
            styles[`labelSize_${size}`],
            isDisabled && styles.label_disabled,
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    minHeight: 44,
  },
  fullWidth: {
    width: '100%',
  },

  // Variants
  primary: {
    backgroundColor: Colors.needleGreen,
  },
  secondary: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: Colors.kanteRust,
  },
  disabled: {
    backgroundColor: Colors.disabledFill,
    borderColor: Colors.disabledFill,
    opacity: 1,
  },

  // Sizes
  size_sm: { paddingVertical: 8, paddingHorizontal: Spacing.md },
  size_md: { paddingVertical: 10, paddingHorizontal: Spacing.lg },
  size_lg: { minHeight: 56, paddingVertical: 14, paddingHorizontal: Spacing.xl },

  // Labels
  label: {
    fontFamily: Fonts.bodyBold,
    fontWeight: FontWeight.bold,
    letterSpacing: 0,
  },
  label_primary: { color: Colors.textInverse },
  label_secondary: { color: Colors.ink },
  label_ghost: { color: Colors.needleGreen },
  label_danger: { color: Colors.textInverse },
  label_disabled: { color: Colors.disabledText },

  labelSize_sm: { fontSize: FontSize.sm },
  labelSize_md: { fontSize: 16, lineHeight: 20 },
  labelSize_lg: { fontSize: 16, lineHeight: 20 },
})

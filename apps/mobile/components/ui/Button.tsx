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
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

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
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? Colors.white : Colors.needleGreen}
        />
      ) : (
        <Text style={[styles.label, styles[`label_${variant}`], styles[`labelSize_${size}`], textStyle]}>
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
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: Colors.error,
  },
  disabled: {
    opacity: 0.45,
  },

  // Sizes
  size_sm: { paddingVertical: 8, paddingHorizontal: Spacing.md },
  size_md: { paddingVertical: 10, paddingHorizontal: Spacing.lg },
  size_lg: { paddingVertical: 12, paddingHorizontal: Spacing.xl },

  // Labels
  label: {
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.1,
  },
  label_primary: { color: Colors.white },
  label_secondary: { color: Colors.needleGreen },
  label_ghost: { color: Colors.needleGreen },
  label_danger: { color: Colors.white },

  labelSize_sm: { fontSize: FontSize.sm },
  labelSize_md: { fontSize: FontSize.md, lineHeight: 20 },
  labelSize_lg: { fontSize: FontSize.md, lineHeight: 20 },
})

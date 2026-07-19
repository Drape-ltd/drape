// Mobile aliases for the locked shared Drapeon design system.
import { Appearance, useColorScheme } from 'react-native'
import { colors, darkColors, shadows, typography } from '@drape/shared/design-system'

const lightPalette = {
  // Brand
  needleGreen: colors.primary,
  needleGreenLight: colors.primaryLight,
  needleGreenDark: colors.primaryDark,
  kanteRust: colors.accent,
  kanteRustLight: colors.accentLight,
  accentLight: colors.accentLight,

  // Neutrals
  bone: colors.background,
  boneDeep: colors.statusMutedBg,
  ink: colors.textPrimary,
  inkLight: colors.textSecondary,
  midGrey: colors.textMuted,
  lightGrey: colors.border,
  white: colors.surface,
  surface: colors.surface,
  surfaceElevated: colors.surface,
  textInverse: colors.textInverse,

  // Semantic
  success: colors.statusSuccess,
  warning: colors.statusBlocked,
  error: colors.statusError,
  errorLight: colors.statusErrorBg,
  statusErrorBg: colors.statusErrorBg,
  statusPending: colors.statusPending,
  statusPendingBg: colors.statusPendingBg,
  timeEvening: colors.timeEvening,
  timeEveningBg: colors.timeEveningBg,
  disabledFill: colors.disabledFill,
  disabledText: colors.disabledText,
} as const

export type DrapeColorPalette = Record<keyof typeof lightPalette, string>
export type DrapeColorScheme = 'light' | 'dark'

const darkPalette: DrapeColorPalette = {
  // Brand
  needleGreen: darkColors.primary,
  needleGreenLight: darkColors.primaryLight,
  needleGreenDark: darkColors.primaryDark,
  kanteRust: darkColors.accent,
  kanteRustLight: darkColors.accentLight,
  accentLight: darkColors.accentLight,

  // Neutrals
  bone: darkColors.background,
  boneDeep: darkColors.statusMutedBg,
  ink: darkColors.textPrimary,
  inkLight: darkColors.textSecondary,
  midGrey: darkColors.textMuted,
  lightGrey: darkColors.border,
  // Legacy alias: most older screens use `white` as a card/sheet surface.
  // Text and icons that must stay white should use `textInverse`.
  white: darkColors.surface,
  surface: darkColors.surface,
  surfaceElevated: darkColors.surfaceElevated,
  textInverse: darkColors.textInverse,

  // Semantic
  success: darkColors.statusSuccess,
  warning: darkColors.statusBlocked,
  error: darkColors.statusError,
  errorLight: darkColors.statusErrorBg,
  statusErrorBg: darkColors.statusErrorBg,
  statusPending: darkColors.statusPending,
  statusPendingBg: darkColors.statusPendingBg,
  timeEvening: darkColors.timeEvening,
  timeEveningBg: darkColors.timeEveningBg,
  disabledFill: darkColors.disabledFill,
  disabledText: darkColors.disabledText,
}

function isDarkMode() {
  return Appearance.getColorScheme() === 'dark'
}

export function getDrapeColorScheme(): DrapeColorScheme {
  return isDarkMode() ? 'dark' : 'light'
}

export function getDrapeColors(scheme: DrapeColorScheme = getDrapeColorScheme()): DrapeColorPalette {
  return scheme === 'dark' ? darkPalette : lightPalette
}

export function useDrapeTheme() {
  const colorScheme = useColorScheme()
  const scheme: DrapeColorScheme = colorScheme === 'dark' ? 'dark' : 'light'

  return {
    scheme,
    colors: getDrapeColors(scheme),
    isDark: scheme === 'dark',
  } as const
}

function color(name: keyof typeof lightPalette) {
  return getDrapeColors()[name]
}

export const Colors = {
  get needleGreen() { return color('needleGreen') },
  get needleGreenLight() { return color('needleGreenLight') },
  get needleGreenDark() { return color('needleGreenDark') },
  get kanteRust() { return color('kanteRust') },
  get kanteRustLight() { return color('kanteRustLight') },
  get accentLight() { return color('accentLight') },
  get bone() { return color('bone') },
  get boneDeep() { return color('boneDeep') },
  get ink() { return color('ink') },
  get inkLight() { return color('inkLight') },
  get midGrey() { return color('midGrey') },
  get lightGrey() { return color('lightGrey') },
  get white() { return color('white') },
  get surface() { return color('surface') },
  get surfaceElevated() { return color('surfaceElevated') },
  get textInverse() { return color('textInverse') },
  get success() { return color('success') },
  get warning() { return color('warning') },
  get error() { return color('error') },
  get errorLight() { return color('errorLight') },
  get statusErrorBg() { return color('statusErrorBg') },
  get statusPending() { return color('statusPending') },
  get statusPendingBg() { return color('statusPendingBg') },
  get timeEvening() { return color('timeEvening') },
  get timeEveningBg() { return color('timeEveningBg') },
  get disabledFill() { return color('disabledFill') },
  get disabledText() { return color('disabledText') },
} satisfies DrapeColorPalette

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 15,
  lg: 18,
  xl: 21,
  xxl: 26,
  xxxl: 32,
} as const

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
}

export const Fonts = {
  display: typography.display,
  body: typography.body,
  bodyMedium: 'DrapeTextMedium',
  bodySemiBold: 'DrapeTextSemiBold',
  bodyBold: 'DrapeTextBold',
  mono: typography.mono,
} as const

export const Radius = {
  sm: 6,
  md: 12,
  lg: 14,
  xl: 18,
  full: 999,
} as const

export const Shadow = {
  sm: shadows.card,
  md: shadows.elevated,
  lg: shadows.elevated,
} as const

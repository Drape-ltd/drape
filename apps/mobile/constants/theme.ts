// Drape design tokens — single source of truth for mobile

export const Colors = {
  // Brand
  needleGreen: '#2D6A4F',
  needleGreenLight: '#E8F5EF',
  needleGreenDark: '#1B4030',
  kanteRust: '#D85A30',
  kanteRustLight: '#FAEEE9',

  // Neutrals
  bone: '#F5F0E8',
  boneDeep: '#EDE8DF',
  ink: '#1A1A1A',
  inkLight: '#4A4A4A',
  midGrey: '#9CA3AF',
  lightGrey: '#E5E7EB',
  white: '#FFFFFF',

  // Semantic
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  errorLight: '#FEF2F2',
} as const

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 36,
} as const

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
}

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
} as const

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
} as const

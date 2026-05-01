// Drape design tokens — single source of truth for mobile

export const Colors = {
  // Brand
  needleGreen: '#1D9E75',
  needleGreenLight: '#E1F5EE',
  needleGreenDark: '#167A5A',
  kanteRust: '#D85A30',
  kanteRustLight: '#F8E8E1',

  // Neutrals
  bone: '#F9F7F3',
  boneDeep: '#F1ECE3',
  ink: '#2C2C2A',
  inkLight: '#5B5A55',
  midGrey: '#888780',
  lightGrey: '#DDD9D2',
  white: '#FFFFFF',

  // Semantic
  success: '#1D9E75',
  warning: '#D85A30',
  error: '#D85A30',
  errorLight: '#F8E8E1',
} as const

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

export const Radius = {
  sm: 6,
  md: 12,
  lg: 14,
  xl: 18,
  full: 999,
} as const

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 5,
  },
} as const

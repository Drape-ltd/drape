export const colors = {
  primary: '#1D9E75',
  primaryDark: '#0F6E56',
  primaryLight: '#E1F5EE',

  accent: '#D85A30',
  accentLight: '#FAEEDA',

  background: '#F9F7F3',
  surface: '#FFFFFF',
  surfaceDark: '#1A1A18',

  textPrimary: '#2C2C2A',
  textSecondary: '#5C5B58',
  textMuted: '#888780',
  textInverse: '#FFFFFF',

  border: '#E0DDD8',
  borderFocus: '#1D9E75',
  borderError: '#D85A30',

  statusPending: '#F59E0B',
  statusPendingBg: '#FAEEDA',
  statusSuccess: '#1D9E75',
  statusSuccessBg: '#E1F5EE',
  statusError: '#E24B4A',
  statusErrorBg: '#FCEBEB',
  statusBlocked: '#D85A30',
  statusBlockedBg: '#FAEEDA',
  statusMuted: '#888780',
  statusMutedBg: '#F1EFE8',
} as const

export const darkColors = {
  background: '#1A1A18',
  surface: '#2C2C2A',
  surfaceElevated: '#343330',
  surfaceDark: '#11110F',
  textPrimary: '#F9F7F3',
  textSecondary: '#C8C5C0',
  textMuted: '#A8A49D',
  textInverse: '#FFFFFF',
  border: '#3C3B38',
  borderFocus: '#1D9E75',
  borderError: '#F07A52',
  primary: '#1D9E75',
  primaryDark: '#7BD8B8',
  primaryLight: '#143D32',
  accent: '#F07A52',
  accentLight: '#3D241C',
  statusPending: '#F6B84A',
  statusPendingBg: '#3A2C16',
  statusSuccess: '#35C99A',
  statusSuccessBg: '#143D32',
  statusError: '#FF7A78',
  statusErrorBg: '#3D2222',
  statusBlocked: '#F07A52',
  statusBlockedBg: '#3D241C',
  statusMuted: '#A8A49D',
  statusMutedBg: '#24231F',
} as const

export const typography = {
  display: 'Georgia',
  body: 'System',
  mono: 'Courier',

  size: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 48,
  },

  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },

  tracking: {
    tight: -0.3,
    normal: 0,
    wide: 0.5,
    wider: 1.2,
  },
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,

  screenPadding: 24,
  cardPadding: 16,
  sectionGap: 32,
  elementGap: 8,
  listItemGap: 12,
} as const

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 100,
  full: 9999,
} as const

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 4,
  },
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const

export const touchTargets = {
  minimum: 44,
  comfortable: 52,
  large: 60,
} as const

export const animation = {
  duration: {
    instant: 100,
    fast: 200,
    normal: 300,
    slow: 500,
  },
  easing: {
    default: 'ease-in-out',
    spring: { damping: 15, stiffness: 150 },
  },
} as const

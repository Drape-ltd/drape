import { Appearance } from 'react-native'

// Drapeon ships light-first. Keep the dark palette available behind an explicit
// build flag so it can return without another design-system migration.
const darkThemeEnabled = process.env.EXPO_PUBLIC_DARK_THEME_V1 === 'true'
Appearance.setColorScheme(darkThemeEnabled ? null : 'light')

require('expo-router/entry')

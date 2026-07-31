import { Appearance } from 'react-native'

// Drapeon ships light-first. Keep the dark palette available behind an explicit
// build flag so it can return without another design-system migration.
Appearance.setColorScheme('light')

require('expo-router/entry')

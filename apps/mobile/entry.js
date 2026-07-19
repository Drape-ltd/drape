import { Appearance } from 'react-native'

// Clear any process-level override before Expo Router evaluates screen styles.
Appearance.setColorScheme(null)

require('expo-router/entry')

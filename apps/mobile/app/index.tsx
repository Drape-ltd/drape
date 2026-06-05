import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function AppIndex() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.needleGreen} />
      <Text style={styles.label}>Loading Drapeon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
    gap: Spacing.md,
  },
  label: {
    color: Colors.ink,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
})

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors, FontSize, Spacing } from '@/constants/theme'

export function Divider({ label }: { label?: string }) {
  if (!label) return <View style={styles.line} />
  return (
    <View style={styles.row}>
      <View style={styles.flex} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.flex} />
    </View>
  )
}

const styles = StyleSheet.create({
  line: { height: 1, backgroundColor: Colors.lightGrey },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1, height: 1, backgroundColor: Colors.lightGrey },
  label: { fontSize: FontSize.sm, color: Colors.midGrey },
})

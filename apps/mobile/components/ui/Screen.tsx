import React from 'react'
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Colors, Spacing } from '@/constants/theme'

interface ScreenProps {
  children: React.ReactNode
  scroll?: boolean
  padded?: boolean
  style?: ViewStyle
  contentStyle?: ViewStyle
}

export function Screen({ children, scroll = false, padded = true, style, contentStyle }: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, contentStyle]}>{children}</View>
  )

  return (
    <SafeAreaView style={[styles.safeArea, style]} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bone },
  flex: { flex: 1 },
  padded: { padding: Spacing.xl },
})

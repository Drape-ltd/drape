import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

export default function AuthCallbackScreen() {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 8000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{timedOut ? 'Sign-in handoff' : 'Securing your session'}</Text>
          </View>
          {!timedOut ? (
            <>
              <ActivityIndicator color={Colors.needleGreen} size="large" />
              <Text style={styles.title}>Finishing sign in…</Text>
              <Text style={styles.hint}>Please wait while we secure your session and place you on the right side of Drape.</Text>
              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>What happens next</Text>
                <Text style={styles.noteText}>If this is your first time, we may ask one or two quick setup questions before you enter the app.</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Still working on sign in</Text>
              <Text style={styles.hint}>
                This is taking longer than expected. You can head back to sign in and try again.
              </Text>
              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>Nothing should be lost</Text>
                <Text style={styles.noteText}>Your account is still the same. This screen is only the handoff between your provider and Drape.</Text>
              </View>
              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>Best retry path</Text>
                <Text style={styles.noteText}>Return to sign in and use the same provider again. We’ll try the handoff fresh without changing your account.</Text>
              </View>
              <View style={styles.actions}>
                <Button label="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
                <Button label="Create account" variant="secondary" onPress={() => router.replace('/(auth)/sign-up')} />
                <Button label="Back to welcome" variant="ghost" onPress={() => router.replace('/(auth)/welcome')} />
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  heroCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  title: {
    fontSize: 28,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    lineHeight: 34,
  },
  hint: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 24,
  },
  noteCard: {
    width: '100%',
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  noteTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  noteText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  actions: {
    width: '100%',
    gap: Spacing.md,
  },
})

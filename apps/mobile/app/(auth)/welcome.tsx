import { View, Text, StyleSheet, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>drape</Text>
        <Text style={styles.tagline}>Custom clothing, crafted for you.</Text>
        <Text style={styles.sub}>
          Connect with master tailors worldwide.{'\n'}
          Get measured once. Clothes that always fit.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Create an account" onPress={() => router.push('/(auth)/sign-up')} />
        <Divider label="or" />
        <Button
          label="Sign in"
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
        />
        <Text style={styles.legal}>
          By continuing you agree to our{' '}
          <Text style={styles.link}>Terms</Text> and{' '}
          <Text style={styles.link}>Privacy Policy</Text>.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bone,
    padding: Spacing.xl,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  wordmark: {
    fontSize: 52,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: -2,
  },
  tagline: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 30,
  },
  sub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  actions: {
    gap: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  legal: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  link: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
})

import { View, Text, StyleSheet, Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()

  async function openLegal(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', `Please visit ${url.replace('https://', '')} manually. You can still continue with sign up or sign in here.`)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', `Please visit ${url.replace('https://', '')} manually. You can still continue with sign up or sign in here.`)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.brandCard}>
          <Text style={styles.wordmark}>drape</Text>
          <Text style={styles.tagline}>Custom and ready-made fashion, handled clearly.</Text>
          <Text style={styles.sub}>Find trusted tailors and boutiques, pay securely, and track every order in one place.</Text>
        </View>
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
          <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/terms') }}>Terms</Text> and{' '}
          <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/privacy') }}>Privacy Policy</Text>.
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
  },
  brandCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    gap: Spacing.lg,
    ...Shadow.lg,
  },
  wordmark: {
    fontSize: 52,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: -2,
  },
  tagline: {
    fontSize: 32,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 38,
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

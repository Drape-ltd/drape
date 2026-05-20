import { View, Text, StyleSheet, Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Divider } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()

  async function openLegal(url: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert(
        'Unable to open link',
        `Please visit ${url.replace('https://', '')} manually. You can still continue with sign up or sign in here.`
      )
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(
        'Unable to open link',
        `Please visit ${url.replace('https://', '')} manually. You can still continue with sign up or sign in here.`
      )
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.brandLockup}>
          <Text style={styles.wordmark}>drape</Text>
        </View>
        <Text style={styles.tagline}>Your tailor, found and protected.</Text>
        <Text style={styles.sub}>
          Order custom pieces, ready-made finds, and track every stitch with payment protection.
        </Text>
        <View style={styles.trustRail}>
          <TrustPoint label="Vetted tailors" />
          <TrustPoint label="Protected payments" />
          <TrustPoint label="Tracked orders" />
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
          <Text
            style={styles.link}
            onPress={() => {
              void openLegal('https://drapeon.co/terms')
            }}
          >
            Terms
          </Text>{' '}
          and{' '}
          <Text
            style={styles.link}
            onPress={() => {
              void openLegal('https://drapeon.co/privacy')
            }}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </SafeAreaView>
  )
}

function TrustPoint({ label }: { label: string }) {
  return (
    <View style={styles.trustPoint}>
      <View style={styles.trustIcon}>
        <Feather name="check" size={12} color={Colors.needleGreen} />
      </View>
      <Text style={styles.trustText}>{label}</Text>
    </View>
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
  brandLockup: {
    alignItems: 'flex-start',
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 58,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: 0,
    lineHeight: 66,
  },
  tagline: {
    fontFamily: Fonts.display,
    fontSize: 34,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 40,
    marginTop: Spacing.lg,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  trustRail: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  trustPoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  trustIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  trustText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  actions: {
    gap: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  legal: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  link: {
    fontFamily: Fonts.bodyMedium,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
})

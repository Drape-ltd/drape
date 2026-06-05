import { View, Text, StyleSheet, Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Divider } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()

  function startAs(intent: 'CUSTOMER' | 'TAILOR') {
    router.push({
      pathname: '/(auth)/sign-up',
      params: { intent },
    })
  }

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
          <View style={styles.logoMark}>
            <Text style={styles.logoLetter}>D</Text>
          </View>
          <Text style={styles.wordmark}>Drapeon</Text>
        </View>
        <Text style={styles.eyebrow}>AI-powered fashion discovery and fit</Text>
        <Text style={styles.tagline}>Fashion that fits before the first stitch.</Text>
        <Text style={styles.sub}>
          Find trusted tailors, shop ready-made pieces, and use Drape Vision to keep fit,
          orders, and payments in one protected place.
        </Text>
        <View style={styles.trustRail}>
          <TrustPoint label="Discover trusted fashion" />
          <TrustPoint label="Review fit before ordering" />
          <TrustPoint label="Track money and handoff" />
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Continue as customer" onPress={() => startAs('CUSTOMER')} />
        <Button
          label="Continue as tailor"
          variant="secondary"
          onPress={() => startAs('TAILOR')}
        />
        <Divider label="already have an account?" />
        <Button
          label="Sign in"
          variant="ghost"
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
    gap: Spacing.md,
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.white,
  },
  logoLetter: {
    fontFamily: Fonts.display,
    fontSize: 21,
    fontWeight: FontWeight.bold,
    color: Colors.white,
    lineHeight: 25,
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 42,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: 0,
    lineHeight: 50,
  },
  eyebrow: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.lightGrey,
    color: Colors.needleGreen,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: Spacing.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    textTransform: 'uppercase',
  },
  tagline: {
    fontFamily: Fonts.display,
    fontSize: 36,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 41,
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

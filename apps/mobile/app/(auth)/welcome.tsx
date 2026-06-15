import type { ComponentProps } from 'react'
import { View, Text, StyleSheet, Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

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
        <Text style={styles.wordmark}>Drapeon</Text>
        <Text style={styles.eyebrow}>AI-powered fashion discovery and fit</Text>
        <Text style={styles.tagline}>Fashion that fits before the first stitch.</Text>
        <Text style={styles.sub}>
          Discover tailors, shop pieces, and track orders with fit and payment protection.
        </Text>
        <ProductPreview />
      </View>

      <View style={styles.actions}>
        <Button label="Continue as customer" onPress={() => startAs('CUSTOMER')} />
        <Button
          label="Continue as tailor"
          variant="secondary"
          onPress={() => startAs('TAILOR')}
        />
        <Button
          label="Sign in"
          variant="ghost"
          size="md"
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

type FeatherIconName = ComponentProps<typeof Feather>['name']

function ProductPreview() {
  return (
    <View style={styles.previewShell}>
      <View style={styles.previewCard}>
        <View style={styles.previewTopRow}>
          <Text style={styles.previewKicker}>Drapeon flow</Text>
          <View style={styles.protectedPill}>
            <Feather name="shield" size={13} color={Colors.needleGreen} />
            <Text style={styles.protectedText}>Protected</Text>
          </View>
        </View>
        <View style={styles.previewSteps}>
          <PreviewStep icon="search" label="Find" />
          <View style={styles.previewLine} />
          <PreviewStep icon="scissors" label="Fit" />
          <View style={styles.previewLine} />
          <PreviewStep icon="credit-card" label="Pay" />
          <View style={styles.previewLine} />
          <PreviewStep icon="check-circle" label="Track" />
        </View>
      </View>
      <View style={styles.previewTabs}>
        <Text style={styles.previewTab}>Fit</Text>
        <Text style={styles.previewTab}>Order</Text>
        <Text style={styles.previewTab}>Trust</Text>
      </View>
    </View>
  )
}

function PreviewStep({ icon, label }: { icon: FeatherIconName; label: string }) {
  return (
    <View style={styles.previewStep}>
      <View style={styles.previewStepIcon}>
        <Feather name={icon} size={16} color={Colors.textInverse} />
      </View>
      <Text style={styles.previewStepLabel}>{label}</Text>
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
    justifyContent: 'flex-end',
    gap: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 48,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: 0,
    lineHeight: 56,
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
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    textTransform: 'uppercase',
  },
  tagline: {
    fontFamily: Fonts.display,
    fontSize: 38,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 43,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  previewShell: {
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  previewCard: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    ...Shadow.md,
  },
  previewTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  previewKicker: {
    color: Colors.textInverse,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  protectedPill: {
    alignItems: 'center',
    backgroundColor: Colors.textInverse,
    borderRadius: Radius.full,
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  protectedText: {
    color: Colors.needleGreen,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  previewSteps: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  previewStep: {
    alignItems: 'center',
    gap: Spacing.sm,
    width: 58,
  },
  previewStepIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  previewStepLabel: {
    color: Colors.textInverse,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  previewLine: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    flex: 1,
    height: 1,
    marginBottom: 24,
  },
  previewTabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  previewTab: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    color: Colors.ink,
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    overflow: 'hidden',
    paddingVertical: Spacing.sm,
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
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

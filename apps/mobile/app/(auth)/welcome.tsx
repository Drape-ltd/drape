import { View, Text, StyleSheet, Alert, Linking, ScrollView, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors } from '@drape/shared/design-system'
import { Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const palette = {
  background: colors.background,
  surface: colors.surface,
  ink: colors.textPrimary,
  muted: colors.textSecondary,
  line: colors.border,
  green: colors.primary,
  greenDark: colors.primaryDark,
  greenSoft: colors.primaryLight,
  inverse: colors.textInverse,
}

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
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          <Text style={styles.wordmark}>Drapeon</Text>
          <Text style={styles.eyebrow}>AI-powered fashion discovery and fit</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.tagline}>Find fashion that fits.</Text>
          <Text style={styles.sub}>
            Shop ready-made pieces, start custom orders, and follow every update in one protected workspace.
          </Text>

          <View style={styles.promiseRow}>
            <PromiseItem icon="search" label="Discover" />
            <PromiseItem icon="scissors" label="Fit" />
            <PromiseItem icon="shield" label="Protect" />
          </View>
        </View>

        <View style={styles.actions}>
          <RoleButton
            title="Continue as customer"
            subtitle="Shop, order, and track your fit."
            variant="primary"
            onPress={() => startAs('CUSTOMER')}
          />
          <RoleButton
            title="Continue as tailor"
            subtitle="Manage briefs, quotes, and production."
            variant="secondary"
            onPress={() => startAs('TAILOR')}
          />

          <TouchableOpacity
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            onPress={() => router.push('/(auth)/sign-in')}
            style={styles.signInButton}
          >
            <Text style={styles.signInLabel}>Sign in</Text>
          </TouchableOpacity>

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
      </ScrollView>
    </SafeAreaView>
  )
}

function PromiseItem({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.promiseItem}>
      <View style={styles.promiseIcon}>
        <Feather name={icon} size={15} color={palette.green} />
      </View>
      <Text style={styles.promiseLabel}>{label}</Text>
    </View>
  )
}

function RoleButton({
  title,
  subtitle,
  variant,
  onPress,
}: {
  title: string
  subtitle: string
  variant: 'primary' | 'secondary'
  onPress: () => void
}) {
  const primary = variant === 'primary'

  return (
    <TouchableOpacity
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={[styles.roleButton, primary ? styles.roleButtonPrimary : styles.roleButtonSecondary]}
    >
      <View style={styles.roleCopy}>
        <Text style={[styles.roleTitle, primary && styles.roleTitlePrimary]}>{title}</Text>
        <Text style={[styles.roleSubtitle, primary && styles.roleSubtitlePrimary]}>{subtitle}</Text>
      </View>
      <Feather name="arrow-right" size={18} color={primary ? palette.inverse : palette.green} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: Spacing.xxl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  brandBlock: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  wordmark: {
    color: palette.green,
    fontFamily: Fonts.display,
    fontSize: 44,
    fontWeight: FontWeight.bold,
    letterSpacing: 0,
    lineHeight: 50,
  },
  eyebrow: {
    alignSelf: 'flex-start',
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    color: palette.green,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
    lineHeight: 18,
    overflow: 'hidden',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  hero: {
    gap: Spacing.xl,
  },
  tagline: {
    color: palette.ink,
    fontFamily: Fonts.display,
    fontSize: 42,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
    lineHeight: 48,
  },
  sub: {
    color: palette.muted,
    fontFamily: Fonts.body,
    fontSize: 17,
    lineHeight: 26,
  },
  promiseRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  promiseItem: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: Spacing.sm,
    justifyContent: 'center',
    minHeight: 82,
  },
  promiseIcon: {
    alignItems: 'center',
    backgroundColor: palette.greenSoft,
    borderRadius: Radius.full,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  promiseLabel: {
    color: palette.ink,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  actions: {
    gap: Spacing.md,
  },
  roleButton: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  roleButtonPrimary: {
    backgroundColor: palette.green,
  },
  roleButtonSecondary: {
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderWidth: 1,
  },
  roleCopy: {
    flex: 1,
    gap: 3,
  },
  roleTitle: {
    color: palette.ink,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    fontWeight: FontWeight.semibold,
  },
  roleTitlePrimary: {
    color: palette.inverse,
  },
  roleSubtitle: {
    color: palette.muted,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  roleSubtitlePrimary: {
    color: colors.primaryLight,
  },
  signInButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  signInLabel: {
    color: palette.greenDark,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  legal: {
    color: palette.muted,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  link: {
    color: palette.greenDark,
    fontFamily: Fonts.bodyMedium,
    fontWeight: FontWeight.medium,
  },
})

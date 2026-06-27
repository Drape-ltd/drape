import { useMemo } from 'react'
import { View, Text, StyleSheet, Alert, Linking, ScrollView, TouchableOpacity, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { colors, darkColors } from '@drape/shared/design-system'
import { Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type WelcomePalette = {
  background: string
  surface: string
  ink: string
  muted: string
  line: string
  green: string
  greenDark: string
  greenSoft: string
  secondaryButton: string
  inverse: string
}

const lightPalette: WelcomePalette = {
  background: colors.background,
  surface: colors.surface,
  ink: colors.textPrimary,
  muted: colors.textSecondary,
  line: colors.border,
  green: colors.primary,
  greenDark: colors.primaryDark,
  greenSoft: colors.primaryLight,
  secondaryButton: colors.secondaryActionBg,
  inverse: colors.textInverse,
}

const darkPalette: WelcomePalette = {
  background: darkColors.background,
  surface: darkColors.surface,
  ink: darkColors.textPrimary,
  muted: darkColors.textSecondary,
  line: darkColors.border,
  green: darkColors.statusSuccess,
  greenDark: darkColors.primaryDark,
  greenSoft: darkColors.statusSuccessBg,
  secondaryButton: darkColors.secondaryActionBg,
  inverse: colors.textInverse,
}

export default function WelcomeScreen() {
  const router = useRouter()
  const isDark = useColorScheme() === 'dark'
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => makeStyles(palette), [palette])

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
        </View>

        <View style={styles.hero}>
          <Text style={styles.tagline} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.86}>
            Your tailor.{'\n'}Anywhere in the world.
          </Text>
          <Text style={styles.sub}>
            Find a tailor, place your order, and watch it come to life. Every stitch tracked. Every payment protected.
          </Text>

          <View style={styles.promiseRow}>
            <PromiseItem icon="account" label="Find your tailor" styles={styles} palette={palette} />
            <PromiseItem icon="tape-measure" label="Your measurements" styles={styles} palette={palette} />
            <PromiseItem icon="shield-check" label="Protected payment" styles={styles} palette={palette} />
          </View>
        </View>

        <View style={styles.actions}>
          <RoleButton
            title="Continue as customer"
            variant="primary"
            styles={styles}
            palette={palette}
            onPress={() => startAs('CUSTOMER')}
          />
          <RoleButton
            title="Continue as tailor"
            variant="secondary"
            styles={styles}
            palette={palette}
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

function PromiseItem({
  icon,
  label,
  styles,
  palette,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap
  label: string
  styles: ReturnType<typeof makeStyles>
  palette: WelcomePalette
}) {
  return (
    <View style={styles.promiseItem}>
      <View style={styles.promiseIcon}>
        <MaterialCommunityIcons name={icon} size={18} color={palette.green} />
      </View>
      <Text style={styles.promiseLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>
        {label}
      </Text>
    </View>
  )
}

function RoleButton({
  title,
  variant,
  styles,
  palette,
  onPress,
}: {
  title: string
  variant: 'primary' | 'secondary'
  styles: ReturnType<typeof makeStyles>
  palette: WelcomePalette
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
      </View>
      <Feather name="arrow-right" size={18} color={primary ? palette.inverse : palette.green} />
    </TouchableOpacity>
  )
}

function makeStyles(palette: WelcomePalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 28,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  brandBlock: {
    paddingTop: 2,
  },
  wordmark: {
    color: palette.green,
    fontFamily: Fonts.display,
    fontSize: 44,
    fontWeight: FontWeight.bold,
    letterSpacing: 0,
    lineHeight: 50,
  },
  hero: {
    gap: 16,
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
    marginTop: 8,
  },
  promiseItem: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    justifyContent: 'center',
    minHeight: 88,
    paddingHorizontal: 4,
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
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    lineHeight: 15,
    textAlign: 'center',
    width: '100%',
  },
  actions: {
    gap: Spacing.md,
    paddingTop: 4,
  },
  roleButton: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  roleButtonPrimary: {
    backgroundColor: palette.green,
  },
  roleButtonSecondary: {
    backgroundColor: palette.secondaryButton,
    borderColor: palette.line,
    borderWidth: 1,
  },
  roleCopy: {
    flex: 1,
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
  signInButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
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
}

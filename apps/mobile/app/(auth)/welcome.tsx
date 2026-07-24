import { useMemo } from 'react'
import { View, Text, StyleSheet, Alert, Linking, ScrollView, TouchableOpacity, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Wordmark — small anchor mark at top */}
        <Text style={styles.wordmark}>Drapeon</Text>

        {/* Hero — fills available vertical space */}
        <View style={styles.hero}>
          <Text style={styles.tagline}>
            Your tailor.{'\n'}Anywhere in the world.
          </Text>
          <Text style={styles.sub}>
            Find a tailor, place your order, and watch it come to life. Every stitch tracked. Every payment protected.
          </Text>
        </View>

        <View style={styles.divider} />

        {/* Actions */}
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
              onPress={() => { void openLegal('https://drapeon.co/terms') }}
            >
              Terms
            </Text>{' '}
            and{' '}
            <Text
              style={styles.link}
              onPress={() => { void openLegal('https://drapeon.co/privacy') }}
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
      <Text style={[styles.roleTitle, primary && styles.roleTitlePrimary]}>{title}</Text>
      <Feather name="arrow-right" size={18} color={palette.green} />
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
      padding: Spacing.xl,
      paddingBottom: Spacing.xxl,
    },
    wordmark: {
      color: palette.green,
      fontFamily: Fonts.display,
      fontSize: 28,
      fontWeight: FontWeight.semibold,
      letterSpacing: 0,
      lineHeight: 34,
      paddingTop: Spacing.xs,
    },
    hero: {
      flex: 1,
      justifyContent: 'center',
      gap: Spacing.lg,
      paddingVertical: Spacing.xxl,
    },
    tagline: {
      color: palette.ink,
      fontFamily: Fonts.display,
      fontSize: 44,
      fontWeight: FontWeight.bold,
      letterSpacing: -0.5,
      lineHeight: 54,
    },
    sub: {
      color: palette.muted,
      fontFamily: Fonts.body,
      fontSize: 16,
      lineHeight: 25,
      maxWidth: 320,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginBottom: Spacing.xl,
    },
    actions: {
      gap: Spacing.md,
    },
    roleButton: {
      alignItems: 'center',
      borderRadius: Radius.xl,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 62,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
    },
    roleButtonPrimary: {
      backgroundColor: palette.secondaryButton,
    },
    roleButtonSecondary: {
      backgroundColor: palette.secondaryButton,
      borderColor: palette.line,
      borderWidth: 1,
    },
    roleTitle: {
      flex: 1,
      flexShrink: 1,
      color: palette.ink,
      fontFamily: Fonts.bodySemiBold,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      marginRight: Spacing.sm,
    },
    roleTitlePrimary: {
      color: palette.ink,
    },
    signInButton: {
      alignItems: 'center',
      backgroundColor: palette.surface,
      borderColor: palette.line,
      borderRadius: Radius.xl,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 56,
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

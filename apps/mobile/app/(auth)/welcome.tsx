import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'
import Svg, { Path } from 'react-native-svg'
import { colors, darkColors } from '@drape/shared/design-system'
import { useAuth } from '@/lib/auth'
import { Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type Palette = { background: string; surface: string; ink: string; muted: string; line: string; green: string; greenDark: string }
const light: Palette = { background: colors.background, surface: colors.surface, ink: colors.textPrimary, muted: colors.textSecondary, line: colors.border, green: colors.primary, greenDark: colors.primaryDark }
const dark: Palette = { background: darkColors.background, surface: darkColors.secondaryActionBg, ink: darkColors.textPrimary, muted: darkColors.textSecondary, line: darkColors.border, green: darkColors.statusSuccess, greenDark: darkColors.statusSuccess }

function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
      <Path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <Path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" />
      <Path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.3 2.7C7.2 7.7 9.4 5.9 12 5.9z" />
    </Svg>
  )
}

export default function WelcomeScreen() {
  const router = useRouter()
  const { signInWithApple, signInWithGoogle } = useAuth()
  const [providerLoading, setProviderLoading] = useState<'apple' | 'google' | null>(null)
  const isDark = useColorScheme() === 'dark'
  const palette = isDark ? dark : light
  const styles = useMemo(() => makeStyles(palette), [palette])

  async function continueWith(provider: 'apple' | 'google') {
    if (providerLoading) return
    setProviderLoading(provider)
    const result = provider === 'apple' ? await signInWithApple() : await signInWithGoogle()
    setProviderLoading(null)
    if (result.error) Alert.alert(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in failed`, result.error)
  }

  async function openLegal(url: string) {
    try {
      if (!await Linking.canOpenURL(url)) throw new Error('unsupported')
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', `Please visit ${url.replace('https://', '')} manually.`)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.wordmark}>Drapeon</Text>
        <View style={styles.hero}>
          <Text style={styles.tagline}>Your tailor.{`\n`}Anywhere in the world.</Text>
          <Text style={styles.sub}>Discover tailors. Order when you’re ready.</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.exploreButton} onPress={() => router.push('/(public)/explore')} accessibilityRole="button" accessibilityLabel="Explore Drapeon without an account">
            <Text style={styles.exploreLabel}>Explore Drapeon</Text>
            <Feather name="arrow-right" size={19} color={colors.textInverse} />
          </TouchableOpacity>

          <View style={styles.dividerRow}><View style={styles.divider} /><Text style={styles.dividerText}>or</Text><View style={styles.divider} /></View>

          {Platform.OS === 'ios' ? (
            <View style={styles.appleWrap}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={Radius.xl}
                style={styles.appleButton}
                onPress={() => { void continueWith('apple') }}
              />
              {providerLoading === 'apple' ? <ActivityIndicator style={styles.providerSpinner} color={isDark ? colors.textPrimary : colors.textInverse} /> : null}
            </View>
          ) : null}

          <TouchableOpacity style={styles.providerButton} onPress={() => { void continueWith('google') }} disabled={!!providerLoading} accessibilityRole="button" accessibilityLabel="Continue with Google" accessibilityState={{ disabled: !!providerLoading, busy: providerLoading === 'google' }}>
            <GoogleMark />
            <Text style={styles.providerLabel}>{providerLoading === 'google' ? 'Opening Google…' : 'Continue with Google'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.providerButton} onPress={() => router.push('/(auth)/sign-in')} disabled={!!providerLoading} accessibilityRole="button" accessibilityLabel="Continue with email">
            <Feather name="mail" size={20} color={palette.ink} />
            <Text style={styles.providerLabel}>Continue with email</Text>
          </TouchableOpacity>

          <Text style={styles.legal}>By continuing, you agree to our <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/terms') }}>Terms</Text> and acknowledge our <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/privacy') }}>Privacy Policy</Text>.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.background },
    content: { flexGrow: 1, padding: Spacing.xl, paddingBottom: Spacing.xxl },
    wordmark: { color: p.green, fontFamily: Fonts.display, fontSize: 28, fontWeight: FontWeight.semibold, lineHeight: 34, paddingTop: Spacing.xs },
    hero: { flex: 1, justifyContent: 'center', gap: Spacing.lg, paddingVertical: Spacing.xl },
    tagline: { color: p.ink, fontFamily: Fonts.display, fontSize: 42, fontWeight: FontWeight.bold, letterSpacing: -0.5, lineHeight: 50 },
    sub: { color: p.muted, fontFamily: Fonts.body, fontSize: 16, lineHeight: 25, maxWidth: 340 },
    actions: { gap: Spacing.md },
    exploreButton: { minHeight: 52, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, backgroundColor: p.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    exploreLabel: { color: colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs },
    divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: p.line },
    dividerText: { color: p.muted, fontFamily: Fonts.body, fontSize: 11 },
    appleWrap: { position: 'relative' },
    appleButton: { width: '100%', height: 50 },
    providerSpinner: { position: 'absolute', right: Spacing.lg, top: 15 },
    providerButton: { minHeight: 50, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
    providerLabel: { color: p.ink, fontFamily: Fonts.bodySemiBold, fontSize: 15, fontWeight: FontWeight.semibold },
    legal: { color: p.muted, fontFamily: Fonts.body, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    link: { color: p.greenDark, fontFamily: Fonts.bodyMedium, fontWeight: FontWeight.medium },
  })
}

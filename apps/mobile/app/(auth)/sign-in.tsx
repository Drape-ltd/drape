import { useState } from 'react'
import {
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Linking,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import { colors } from '@drape/shared/design-system'

type RoleIntent = 'CUSTOMER' | 'TAILOR'

const oauthPalette = {
  appleBg: colors.surfaceDark,
  appleFg: colors.textInverse,
  googleBg: colors.surface,
  googleFg: colors.textPrimary,
  googleBorder: colors.border,
}

function normalizeRoleIntent(value: unknown): RoleIntent | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === 'CUSTOMER' || candidate === 'TAILOR' ? candidate : null
}

export default function SignInScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ intent?: string }>()
  const { signIn, signInWithGoogle, signInWithApple } = useAuth()
  const roleIntent = normalizeRoleIntent(params.intent)
  const intentLabel = roleIntent === 'TAILOR' ? 'tailor' : roleIntent === 'CUSTOMER' ? 'customer' : null
  const intentTitle = roleIntent === 'TAILOR'
    ? 'Sign in to your tailor workspace.'
    : roleIntent === 'CUSTOMER'
      ? 'Sign in to order with Drapeon.'
      : 'Sign in to Drapeon.'
  const intentBody = roleIntent === 'TAILOR'
    ? 'Open briefs, consultations, production updates, payouts, and your storefront.'
    : roleIntent === 'CUSTOMER'
      ? 'Continue browsing tailors, tracking orders, measurements, messages, and protected payments.'
      : 'Continue tracking orders, messages, measurements, and protected payments.'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  function validateEmail(value: string) {
    const trimmed = value.trim()
    if (!trimmed) {
      setEmailError('Email is required.')
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.')
      return false
    }
    setEmailError('')
    return true
  }

  function goBack() {
    router.replace('/(auth)/welcome')
  }

  useContextualBackHandler(goBack)

  async function handleSignIn() {
    if (loading || oauthLoading) return
    if (!validateEmail(email)) return
    if (!password) {
      setPasswordError('Password is required.')
      return
    }
    setPasswordError('')

    setLoading(true)
    const { error } = await signIn(email.trim().toLowerCase(), password, roleIntent)
    setLoading(false)
    if (error) {
      if (error === 'Incorrect password. Try again.') {
        setPasswordError(error)
        Alert.alert('Incorrect password', 'Incorrect password. Try again.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset password',
            onPress: () => {
              router.push({
                pathname: '/(auth)/forgot-password',
                params: { email: email.trim().toLowerCase() },
              })
            },
          },
        ])
      } else {
        Alert.alert('Sign in failed', error)
      }
    } else {
      setPasswordError('')
      capture('sign_in')
    }
    // RouteGuard handles redirect
  }

  async function handleGoogle() {
    if (loading || oauthLoading) return
    setOauthLoading('google')
    const { error } = await signInWithGoogle(roleIntent)
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_in', { method: 'google' })
  }

  async function handleApple() {
    if (loading || oauthLoading) return
    setOauthLoading('apple')
    const { error } = await signInWithApple(roleIntent)
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_in', { method: 'apple' })
  }

  async function contactAccountSupport() {
    const normalizedEmail = email.trim().toLowerCase()
    const emailSubject = encodeURIComponent('Account access help')
    const emailBody = encodeURIComponent(
      normalizedEmail
        ? `Hi Drapeon support,\n\nI cannot access my account. The email I tried is ${normalizedEmail}.\n\nWhat I need help with:\n`
        : 'Hi Drapeon support,\n\nI cannot access my account.\n\nWhat I need help with:\n'
    )
    const emailUrl = `mailto:${CONTACTS.support}?subject=${emailSubject}&body=${emailBody}`
    const whatsappUrl = buildWhatsAppSupportUrl(
      normalizedEmail
        ? `Hi Drapeon, I cannot access my account. The email I tried is ${normalizedEmail}.`
        : 'Hi Drapeon, I cannot access my account.',
    )
    try {
      const supported = await Linking.canOpenURL(whatsappUrl)
      if (!supported) {
        await Linking.openURL(emailUrl)
        return
      }
      await Linking.openURL(whatsappUrl)
    } catch {
      Alert.alert('Contact support', `Message Drapeon on WhatsApp or email ${CONTACTS.support} for account access help.`)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <AuthBackButton style={styles.back} onPress={goBack} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <AuthEntryHeader
            eyebrow="Welcome back"
            title={intentTitle}
            body={intentBody}
            showWordmark={false}
          />

          <View style={styles.formCard}>
            <View style={styles.formIntro}>
              <Text style={styles.formEyebrow}>Your account</Text>
              <Text style={styles.formTitle}>
                {intentLabel
                  ? `Use your email or a connected account. We’ll open the ${intentLabel} side after sign in.`
                  : 'Use your email or a connected account.'}
              </Text>
            </View>

            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={(value) => {
                setEmail(value)
                if (emailError) validateEmail(value)
              }}
              onBlur={() => validateEmail(email)}
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              required
              testID="email-input"
            />

            <Input
              label="Password"
              placeholder="Your password"
              value={password}
              onChangeText={(value) => {
                setPassword(value)
                if (passwordError) setPasswordError('')
              }}
              error={passwordError}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="done"
              onSubmitEditing={() => { void handleSignIn() }}
              required
              testID="password-input"
            />

            <Button
              label="Sign in"
              onPress={handleSignIn}
              loading={loading}
              disabled={!email || !password || !!emailError}
            />

            <Text style={styles.prompt}>
              Don't have an account?{' '}
              <Text
                style={styles.link}
                onPress={() => router.replace({
                  pathname: '/(auth)/sign-up',
                  params: roleIntent ? { intent: roleIntent } : undefined,
                })}
              >
                Create one
              </Text>
            </Text>

            <Divider label="or continue with" />

            <View style={styles.oauthRow}>
              <TouchableOpacity
                style={styles.oauthBtn}
                onPress={handleGoogle}
                disabled={!!oauthLoading || loading}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
              >
                <Text style={styles.oauthIcon}>G</Text>
                <Text style={styles.oauthLabel}>
                  {oauthLoading === 'google' ? 'Opening…' : 'Google'}
                </Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={[styles.oauthBtn, styles.oauthBtnApple]}
                  onPress={handleApple}
                  disabled={!!oauthLoading || loading}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with Apple"
                >
                  <Ionicons name="logo-apple" size={18} color={oauthPalette.appleFg} />
                  <Text style={[styles.oauthLabel, styles.oauthLabelApple]}>
                    {oauthLoading === 'apple' ? 'Opening…' : 'Apple'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.accountLinksRow}>
              <TouchableOpacity
                style={styles.accountLinkHit}
                onPress={() => router.push('/(auth)/forgot-password')}
              >
                <Text style={styles.forgot}>Forgot password?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.accountLinkHit}
                onPress={() => {
                  void contactAccountSupport()
                }}
              >
                <Text style={styles.supportLink}>Can’t access account?</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.nextCard}>
              <Text style={styles.nextEyebrow}>Protected access</Text>
              <Text style={styles.nextTitle}>
                {intentLabel
                  ? `If this account has not used the ${intentLabel} side yet, we’ll take you to setup first.`
                  : 'We’ll return you to the right side of your account after sign in.'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  keyboardAvoider: { flex: 1 },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxl },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  formIntro: { gap: 4 },
  formEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  formTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  prompt: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { fontFamily: Fonts.bodyMedium, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: 4,
  },
  nextEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  nextTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 21,
  },
  forgot: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  supportLink: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  accountLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  accountLinkHit: { flexShrink: 1 },
  oauthRow: { flexDirection: 'row', gap: Spacing.md },
  oauthBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: oauthPalette.googleBorder,
    backgroundColor: oauthPalette.googleBg,
  },
  oauthBtnApple: { backgroundColor: oauthPalette.appleBg, borderColor: oauthPalette.appleBg },
  oauthIcon: { fontFamily: Fonts.bodyBold, fontSize: FontSize.md, fontWeight: FontWeight.bold, color: oauthPalette.googleFg },
  oauthIconApple: { color: oauthPalette.appleFg },
  oauthLabel: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: oauthPalette.googleFg },
  oauthLabelApple: { color: oauthPalette.appleFg },
})

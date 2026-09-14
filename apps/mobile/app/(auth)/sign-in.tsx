import { useState } from 'react'
import {
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
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
import { TurnstileChallenge } from '@/components/auth/TurnstileChallenge'
import { Button, Input, Divider, KeyboardAwareScrollView } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'
import { CONTACTS, buildWhatsAppSupportUrl, isDeviceTrustCode } from '@drape/shared'
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
  const { signIn, verifyDeviceChallenge, cancelDeviceChallenge, signInWithGoogle, signInWithApple } = useAuth()
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
  const [securityError, setSecurityError] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [deviceChallenge, setDeviceChallenge] = useState<{ challengeId: string; maskedEmail: string; expiresAt: string } | null>(null)
  const [deviceCode, setDeviceCode] = useState('')

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
    if (deviceChallenge) {
      void cancelDeviceChallenge().finally(() => {
        setDeviceChallenge(null)
        setDeviceCode('')
      })
      return
    }
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
    if (!captchaToken) return
    setPasswordError('')
    setSecurityError('')

    setLoading(true)
    const { error, deviceChallenge: challenge } = await signIn(email.trim().toLowerCase(), password, roleIntent, captchaToken, rememberDevice)
    setCaptchaToken(null)
    setCaptchaResetKey((current) => current + 1)
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
      } else if (error.toLowerCase().includes('security check')) {
        setSecurityError(
          'We refreshed the security check. Wait for it to complete, then retry. Your details are still here, or you can use Apple or Google below.',
        )
      } else {
        Alert.alert('Sign in failed', error)
      }
    } else if (challenge) {
      setPassword('')
      setDeviceCode('')
      setDeviceChallenge(challenge)
    } else {
      setPasswordError('')
      capture('sign_in')
    }
    // RouteGuard handles redirect
  }

  async function handleVerifyDevice() {
    if (!deviceChallenge || loading || !isDeviceTrustCode(deviceCode)) return
    setLoading(true)
    const { error } = await verifyDeviceChallenge(deviceChallenge.challengeId, deviceCode)
    setLoading(false)
    if (error) {
      Alert.alert('Code not verified', error)
      return
    }
    capture('sign_in', { method: 'password', device_verified: true })
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

  if (deviceChallenge) {
    return (
      <SafeAreaView style={styles.container}>
        <AuthBackButton style={styles.back} onPress={goBack} />
        <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <AuthEntryHeader
              eyebrow="New device"
              title="Check your email."
              body={`Enter the six-digit code sent to ${deviceChallenge.maskedEmail}.`}
              showWordmark={false}
            />
            <View style={styles.formCard}>
              <View style={styles.verificationIcon}>
                <Ionicons name="shield-checkmark-outline" size={28} color={Colors.needleGreen} />
              </View>
              <Input
                label="Verification code"
                placeholder="000000"
                value={deviceCode}
                onChangeText={(value) => setDeviceCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                required
                testID="device-code-input"
              />
              <Text style={styles.codeHint}>
                Expires {new Date(deviceChallenge.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Never share this code.
              </Text>
              <Button
                label="Verify and continue"
                onPress={handleVerifyDevice}
                loading={loading}
                disabled={!isDeviceTrustCode(deviceCode)}
                testID="device-code-submit"
              />
              <TouchableOpacity onPress={goBack} accessibilityRole="button" accessibilityLabel="Use another account">
                <Text style={styles.useAnotherAccount}>Use another account</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <AuthBackButton style={styles.back} onPress={goBack} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <KeyboardAwareScrollView
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
                  ? `Use your email or a connected account. New accounts can start on the ${intentLabel} side; returning accounts keep their current workspace.`
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
              textContentType="username"
              autoComplete="email"
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
              onSubmitEditing={() => {
                if (captchaToken) void handleSignIn()
              }}
              required
              testID="password-input"
            />

            <TurnstileChallenge
              key={captchaResetKey}
              action="signin"
              onTokenChange={(token) => {
                setCaptchaToken(token)
                if (token) setSecurityError('')
              }}
            />

            {securityError ? <Text style={styles.securityError}>{securityError}</Text> : null}

            <Button
              label="Sign in"
              testID="sign-in-submit"
              onPress={handleSignIn}
              loading={loading}
              disabled={!email || !password || !!emailError || !captchaToken}
            />

            <TouchableOpacity
              style={styles.rememberRow}
              onPress={() => setRememberDevice((current) => !current)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberDevice }}
              accessibilityLabel="Trust this device for 30 days"
            >
              <Ionicons
                name={rememberDevice ? 'checkbox' : 'square-outline'}
                size={22}
                color={rememberDevice ? Colors.needleGreen : Colors.midGrey}
              />
              <View style={styles.rememberCopy}>
                <Text style={styles.rememberTitle}>Trust this device for 30 days</Text>
                <Text style={styles.rememberHint}>Leave this off on a shared or public device.</Text>
              </View>
            </TouchableOpacity>

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

          </View>
        </KeyboardAwareScrollView>
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
  verificationIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
    alignSelf: 'center',
  },
  codeHint: { fontFamily: Fonts.body, fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  useAnotherAccount: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, color: Colors.needleGreen, textAlign: 'center' },
  rememberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  rememberCopy: { flex: 1, gap: 2 },
  rememberTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  rememberHint: { fontFamily: Fonts.body, fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  securityError: {
    color: Colors.error,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
})

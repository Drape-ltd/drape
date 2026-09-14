import { useState } from 'react'
import { KeyboardAvoidingView, Platform, View, Text, StyleSheet, Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import { TurnstileChallenge } from '@/components/auth/TurnstileChallenge'
import { Button, Input, KeyboardAwareScrollView } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getHostedRecoveryUrl() {
  const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://drapeon.co').replace(/\/+$/, '')
  return `${siteUrl}/auth/recover`
}

function getPasswordRecoveryRedirectUrl() {
  return getHostedRecoveryUrl()
}

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>()
  const [email, setEmail] = useState(emailParam ?? '')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [securityError, setSecurityError] = useState('')

  async function handleReset() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return
    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Invalid email', 'Enter a valid email address and try again.')
      return
    }
    if (!captchaToken) return
    setSecurityError('')

    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: getPasswordRecoveryRedirectUrl(),
      captchaToken,
    })
    setCaptchaToken(null)
    setCaptchaResetKey((current) => current + 1)
    setLoading(false)
    if (error) {
      const isCaptchaError = error.message.toLowerCase().includes('captcha')
      if (isCaptchaError) {
        setSecurityError(
          'We refreshed the security check. Wait for it to complete, then retry. Your email is still here.'
        )
      } else {
        Alert.alert(
          'Could not start reset',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. We could not start password reset yet. Retry when the signal improves.'
            : 'We could not start password reset right now. Please try again in a moment.'
        )
      }
    } else {
      setEmail(normalizedEmail)
      setSent(true)
    }
  }

  function goBack() {
    router.replace('/(auth)/sign-in')
  }

  useContextualBackHandler(goBack)

  return (
    <SafeAreaView style={styles.container}>
      <AuthBackButton style={styles.back} onPress={goBack} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          {sent ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateEyebrow}>Reset link sent</Text>
              <View style={styles.successBlock}>
                <View style={styles.successIcon}>
                  <Ionicons name="mail" size={32} color={Colors.needleGreen} />
                </View>
                <Text style={styles.heading}>Check your email</Text>
                <Text style={styles.sub}>
                  We've sent a password reset link to{'\n'}
                  <Text style={styles.emailHighlight}>{email}</Text>
                </Text>
                <Text style={styles.hint}>
                  The link expires in 1 hour. Check your spam folder if you don't see it.
                </Text>
              </View>
              <View style={styles.nextCard}>
                <Text style={styles.nextEyebrow}>What happens next</Text>
                <Text style={styles.nextTitle}>Open the link on any trusted device.</Text>
                <Text style={styles.nextCopy}>
                  The link opens Drapeon’s secure web reset screen. After you choose a new password,
                  return here and sign in to the same account.
                </Text>
              </View>
              <Button
                label="Back to sign in"
                variant="secondary"
                onPress={() => router.replace('/(auth)/sign-in')}
              />
            </View>
          ) : (
            <>
              <AuthEntryHeader
                eyebrow="Account recovery"
                title="Reset your password."
                body="Enter the email on your Drapeon account and we’ll send you a secure reset link."
                showWordmark={false}
              />
              <View style={styles.formCard}>
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  required
                  error={
                    email && !isValidEmail(email.trim().toLowerCase())
                      ? 'Enter a valid email address'
                      : ''
                  }
                />

                <TurnstileChallenge
                  key={captchaResetKey}
                  action="recovery"
                  onTokenChange={(token) => {
                    setCaptchaToken(token)
                    if (token) setSecurityError('')
                  }}
                />

                {securityError ? <Text style={styles.securityError}>{securityError}</Text> : null}

                <Button
                  label="Send reset link"
                  onPress={handleReset}
                  loading={loading}
                  disabled={
                    !email.trim() || !isValidEmail(email.trim().toLowerCase()) || !captchaToken
                  }
                />
              </View>

              <View style={styles.reassuranceCard}>
                <View style={styles.reassuranceIcon}>
                  <Ionicons name="lock-closed" size={18} color={Colors.needleGreen} />
                </View>
                <View style={styles.reassuranceCopy}>
                  <Text style={styles.reassuranceTitle}>Secure from request to reset</Text>
                  <Text style={styles.reassuranceText}>
                    The link opens drapeon.co to finish. Your orders, messages, and profile stay
                    where you left them.
                  </Text>
                  <Text style={styles.reassuranceHelp}>
                    No longer control this inbox? Contact support for account recovery.
                  </Text>
                </View>
              </View>
            </>
          )}
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  keyboardAvoider: { flex: 1 },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    marginTop: Spacing.lg,
  },
  stateEyebrow: {
    alignSelf: 'flex-start',
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  heading: {
    fontSize: 34,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 40,
    letterSpacing: 0,
  },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  reassuranceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  reassuranceIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  reassuranceCopy: { flex: 1, gap: 4 },
  reassuranceTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  reassuranceText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  reassuranceHelp: {
    marginTop: Spacing.xs,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
  },
  formCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  successBlock: { gap: Spacing.lg, alignItems: 'center' },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  emailHighlight: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  hint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  securityError: {
    color: Colors.error,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: 4,
  },
  nextEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 21,
  },
  nextCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
})

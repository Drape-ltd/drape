import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  StyleSheet,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
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

  async function handleReset() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return
    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Invalid email', 'Enter a valid email address and try again.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: getPasswordRecoveryRedirectUrl(),
    })
    setLoading(false)
    if (error) {
      Alert.alert(
        'Could not start reset',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not start password reset yet. Retry when the signal improves.'
          : 'We could not start password reset right now. Please try again in a moment.'
      )
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
                <Text style={styles.nextTitle}>Open the link from this device if you can.</Text>
                <Text style={styles.nextCopy}>
                  We’ll bring you into a secure password-reset screen, then send you back to sign in
                  with the same Drapeon account.
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
                title="Reset your password without losing your place."
                body="Enter the email address on your Drapeon account and we’ll send you a secure link to set a new password."
                showWordmark={false}
              />
              <View style={styles.reassuranceCard}>
                <Text style={styles.reassuranceTitle}>What happens next</Text>
                <Text style={styles.reassuranceText}>
                  We’ll send a secure recovery link to your inbox.
                </Text>
                <Text style={styles.reassuranceText}>
                  Your orders, messages, and profile stay exactly where you left them.
                </Text>
                <Text style={styles.reassuranceText}>
                  If you no longer control this inbox, support may need stronger proof before
                  helping with account recovery.
                </Text>
              </View>

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

                <Button
                  label="Send reset link"
                  onPress={handleReset}
                  loading={loading}
                  disabled={!email.trim() || !isValidEmail(email.trim().toLowerCase())}
                />
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
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxl },
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
    backgroundColor: Colors.bone,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
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

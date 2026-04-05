import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const navigation = useNavigation()
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
      redirectTo: 'drape://reset-password',
    })
    setLoading(false)
    if (error) {
      Alert.alert(
        'Could not start reset',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not start password reset yet. Retry when the signal improves.'
          : 'We could not start password reset right now. Please try again in a moment.',
      )
    } else {
      setEmail(normalizedEmail)
      setSent(true)
    }
  }

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(auth)/sign-in')
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {sent ? (
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Reset link sent</Text>
            </View>
            <View style={styles.successBlock}>
              <Text style={styles.successEmoji}>📬</Text>
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
                We’ll bring you into a secure password-reset screen, then send you back to sign in with the same Drape account.
              </Text>
            </View>
            <Button
              label="Back to sign in"
              variant="secondary"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
        ) : (
          <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Account recovery</Text>
          </View>
          <Text style={styles.heading}>Reset your password without losing your place.</Text>
          <Text style={styles.sub}>
            Enter the email address on your Drape account and we'll send you a secure link to set a new password.
          </Text>
          <View style={styles.reassuranceCard}>
            <Text style={styles.reassuranceTitle}>What happens next</Text>
            <Text style={styles.reassuranceText}>We’ll send a secure recovery link to your inbox.</Text>
            <Text style={styles.reassuranceText}>Your orders, messages, and profile stay exactly where you left them.</Text>
            <Text style={styles.reassuranceText}>If you no longer control this inbox, support may need stronger proof before helping with account recovery.</Text>
          </View>

          <View style={styles.formCard}>
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                required
                error={email && !isValidEmail(email.trim().toLowerCase()) ? 'Enter a valid email address' : ''}
              />

              <Button
                label="Send reset link"
                onPress={handleReset}
                loading={loading}
                disabled={!email.trim() || !isValidEmail(email.trim().toLowerCase())}
              />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { flex: 1, padding: Spacing.xl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: Spacing.xl,
    gap: Spacing.lg,
    marginTop: Spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  heading: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 40, letterSpacing: -0.6 },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  reassuranceCard: {
    backgroundColor: Colors.bone,
    borderRadius: 24,
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
    borderRadius: 24,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  successBlock: { gap: Spacing.lg, alignItems: 'center' },
  successEmoji: { fontSize: 56 },
  emailHighlight: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  hint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: 24,
    padding: Spacing.lg,
    gap: 4,
  },
  nextEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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

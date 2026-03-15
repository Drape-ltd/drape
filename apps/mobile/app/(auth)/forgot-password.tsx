import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleReset() {
    if (!email.trim()) return
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: 'drape://reset-password',
    })
    setLoading(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {sent ? (
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
            <Button
              label="Back to sign in"
              variant="secondary"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
        ) : (
          <>
            <Text style={styles.heading}>Reset your password</Text>
            <Text style={styles.sub}>
              Enter the email address on your Drape account and we'll send you a reset link.
            </Text>

            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              required
            />

            <Button
              label="Send reset link"
              onPress={handleReset}
              loading={loading}
              disabled={!email.trim()}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { flex: 1, padding: Spacing.xl, gap: Spacing.lg },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24, marginTop: -Spacing.sm },
  successBlock: { flex: 1, gap: Spacing.lg, paddingTop: Spacing.xxxl, alignItems: 'center' },
  successEmoji: { fontSize: 56 },
  emailHighlight: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  hint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
})

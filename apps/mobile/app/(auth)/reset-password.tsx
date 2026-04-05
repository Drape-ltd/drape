import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { clearRecentReauth } from '@/lib/recent-reauth'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const passwordError = password ? (validatePasswordStrength(password) ?? '') : ''

  // Supabase fires PASSWORD_RECOVERY once the deep-link token is exchanged.
  // Until then we show a loading state rather than a broken form.
  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || !session) return
      setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
        setLinkError(null)
      }
    })

    const timeout = setTimeout(() => {
      if (!active) return
      setLinkError('This reset link is invalid or expired. Request a new one and try again.')
    }, 8000)

    return () => {
      active = false
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(auth)/sign-in')
  }

  async function handleSave() {
    if (saving) return
    if (passwordError) {
      Alert.alert('Password issue', passwordError)
      return
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", 'Please check both fields and try again.')
      return
    }

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (error) {
      Alert.alert('Error', error.message)
    } else {
      try {
        await supabase.auth.signOut({ scope: 'global' })
        await clearRecentReauth()
      } catch {
        try {
          await supabase.auth.signOut()
          await clearRecentReauth()
        } catch {
          // Best effort — the success screen still gives the user a way back to sign in.
        }
      }
      setDone(true)
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Password updated</Text>
          </View>
          <View style={styles.centred}>
            <Text style={styles.successEmoji}>🔒</Text>
            <Text style={styles.heading}>You're all set</Text>
            <Text style={styles.sub}>You can now sign in with your new password.</Text>
          </View>
          <View style={styles.nextCard}>
            <Text style={styles.nextEyebrow}>What happens next</Text>
            <Text style={styles.nextTitle}>Sign back in and we’ll return you to the right side of Drape.</Text>
            <Text style={styles.nextCopy}>
              Your orders, messages, clients, and profile stay exactly where you left them. For safety, you may need to sign in again on other devices too.
            </Text>
          </View>
          <Button label="Sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </SafeAreaView>
    )
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Secure recovery</Text>
          </View>
          <View style={styles.centred}>
            <Text style={styles.heading}>Checking your reset link</Text>
            <Text style={styles.sub}>{linkError ?? 'Verifying reset link…'}</Text>
          </View>
          {linkError ? (
            <Button
              label="Request a new link"
              variant="secondary"
              onPress={() => router.replace('/(auth)/forgot-password')}
            />
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Choose a new password</Text>
          </View>
          <Text style={styles.heading}>Set a password you can come back to easily.</Text>
          <Text style={styles.sub}>Use at least 8 characters. Once saved, we'll send you back to sign in cleanly.</Text>
          <View style={styles.reassuranceCard}>
            <Text style={styles.reassuranceTitle}>A smooth return matters here.</Text>
            <Text style={styles.reassuranceText}>You’re updating access to the same Drape account, not creating a new one.</Text>
            <Text style={styles.reassuranceText}>Once saved, you’ll sign back in and continue with your orders, clients, and messages as normal.</Text>
          </View>

          <View style={styles.formCard}>
            <Input
              label="New password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              error={passwordError}
              hint={PASSWORD_POLICY_HINT}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              required
            />
            <Input
              label="Confirm password"
              placeholder="••••••••"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              required
              error={confirm && password !== confirm ? "Passwords don't match" : ''}
            />

            <Button
              label="Save new password"
              onPress={handleSave}
              loading={saving}
              disabled={!password || !confirm || !!passwordError || password !== confirm}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { flex: 1, padding: Spacing.xl, gap: Spacing.lg, paddingTop: Spacing.lg },
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
  centred: { alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingVertical: Spacing.lg },
  successEmoji: { fontSize: 56 },
  heading: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 40, letterSpacing: -0.6, textAlign: 'center' },
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

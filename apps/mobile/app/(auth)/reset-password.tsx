import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Button, Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  // Supabase fires PASSWORD_RECOVERY once the deep-link token is exchanged.
  // Until then we show a loading state rather than a broken form.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSave() {
    if (password.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.')
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
      setDone(true)
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centred}>
          <Text style={styles.successEmoji}>🔒</Text>
          <Text style={styles.heading}>Password updated</Text>
          <Text style={styles.sub}>You can now sign in with your new password.</Text>
          <Button label="Sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </SafeAreaView>
    )
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centred}>
          <Text style={styles.sub}>Verifying reset link…</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.heading}>Choose a new password</Text>
        <Text style={styles.sub}>Must be at least 8 characters.</Text>

        <Input
          label="New password"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          required
        />
        <Input
          label="Confirm password"
          placeholder="••••••••"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          required
          error={confirm && password !== confirm ? "Passwords don't match" : ''}
        />

        <Button
          label="Save new password"
          onPress={handleSave}
          loading={saving}
          disabled={!password || !confirm || password !== confirm}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  content: { flex: 1, padding: Spacing.xl, gap: Spacing.lg, paddingTop: Spacing.xxxl },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, padding: Spacing.xl },
  successEmoji: { fontSize: 56 },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
})

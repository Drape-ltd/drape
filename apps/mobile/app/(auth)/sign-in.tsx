import { useState } from 'react'
import { Platform, View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'

export default function SignInScreen() {
  const router = useRouter()
  const { signIn, signInWithGoogle, signInWithApple } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)

  async function handleSignIn() {
    setLoading(true)
    const { error } = await signIn(email.trim().toLowerCase(), password)
    setLoading(false)
    if (error) {
      Alert.alert('Sign in failed', error)
    } else {
      capture('sign_in')
    }
    // RouteGuard handles redirect
  }

  async function handleGoogle() {
    setOauthLoading('google')
    const { error } = await signInWithGoogle()
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_in', { method: 'google' })
  }

  async function handleApple() {
    setOauthLoading('apple')
    const { error } = await signInWithApple()
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_in', { method: 'apple' })
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.sub}>Sign in to your Drape account.</Text>

        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
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
          onChangeText={setPassword}
          secureTextEntry
          required
          testID="password-input"
        />

        <Button
          label="Sign in"
          onPress={handleSignIn}
          loading={loading}
          disabled={!email || !password}
        />

        <TouchableOpacity style={styles.forgotWrap} onPress={() => router.push('/(auth)/forgot-password')}>
          <Text style={styles.forgot}>Forgot your password?</Text>
        </TouchableOpacity>

        <Divider label="or continue with" />

        <View style={styles.oauthRow}>
          <TouchableOpacity
            style={styles.oauthBtn}
            onPress={handleGoogle}
            disabled={!!oauthLoading || loading}
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
            >
              <Text style={[styles.oauthIcon, styles.oauthIconApple]}></Text>
              <Text style={[styles.oauthLabel, styles.oauthLabelApple]}>
                {oauthLoading === 'apple' ? 'Opening…' : 'Apple'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.prompt}>
          Don't have an account?{' '}
          <Text style={styles.link} onPress={() => router.replace('/(auth)/sign-up')}>
            Create one
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { padding: Spacing.xl, gap: Spacing.lg },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, marginTop: -Spacing.sm },
  prompt: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { color: Colors.needleGreen, fontWeight: FontWeight.medium },
  forgotWrap: { alignSelf: 'flex-end' },
  forgot: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  oauthRow: { flexDirection: 'row', gap: Spacing.md },
  oauthBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, paddingVertical: Spacing.md,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  oauthBtnApple: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  oauthIcon: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  oauthIconApple: { color: Colors.white },
  oauthLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  oauthLabelApple: { color: Colors.white },
})

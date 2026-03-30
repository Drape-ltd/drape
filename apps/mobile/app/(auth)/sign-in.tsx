import { useState } from 'react'
import { Platform, View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'

export default function SignInScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { signIn, signInWithGoogle, signInWithApple } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [emailError, setEmailError] = useState('')

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
    if (navigation.canGoBack()) router.back()
    else router.replace('/(auth)/welcome')
  }

  async function handleSignIn() {
    if (loading || oauthLoading) return
    if (!validateEmail(email)) return
    if (!password) {
      Alert.alert('Password required', 'Please enter your password to continue.')
      return
    }

    setLoading(true)
    const { error } = await signIn(email.trim().toLowerCase(), password)
    setLoading(false)
    if (error) {
      if (error.includes('did not match')) {
        Alert.alert(
          'Sign in failed',
          `${error}\n\nIf this account was created with Google or Apple, use that provider. Otherwise reset the password for this email and try again.`,
          [
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
          ],
        )
      } else {
        Alert.alert('Sign in failed', error)
      }
    } else {
      capture('sign_in')
    }
    // RouteGuard handles redirect
  }

  async function handleGoogle() {
    if (loading || oauthLoading) return
    setOauthLoading('google')
    const { error } = await signInWithGoogle()
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_in', { method: 'google' })
  }

  async function handleApple() {
    if (loading || oauthLoading) return
    setOauthLoading('apple')
    const { error } = await signInWithApple()
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_in', { method: 'apple' })
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <Text style={styles.heading}>Welcome back.</Text>
          <Text style={styles.sub}>Pick up where you left off.</Text>
        </View>

        <View style={styles.formCard}>
        <View style={styles.formIntro}>
          <Text style={styles.formEyebrow}>Your account</Text>
          <Text style={styles.formTitle}>Email and password, or a provider.</Text>
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
            onChangeText={setPassword}
            secureTextEntry
            required
            testID="password-input"
          />

          <Button
            label="Sign in"
            onPress={handleSignIn}
            loading={loading}
            disabled={!email || !password || !!emailError}
          />

        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>You’ll go back to the right side of your account.</Text>
        </View>

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
                <Ionicons name="logo-apple" size={18} color={Colors.white} />
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
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  heading: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 40, letterSpacing: -0.6 },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  formIntro: { gap: 4 },
  formEyebrow: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
  formTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold, lineHeight: 24 },
  prompt: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { color: Colors.needleGreen, fontWeight: FontWeight.medium },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 21,
  },
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

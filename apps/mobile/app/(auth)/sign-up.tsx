import { useState } from 'react'
import { Platform, View, Text, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'
import { validateDisplayName } from '@drape/shared/contact-filter'

type Role = 'CUSTOMER' | 'TAILOR'

export default function SignUpScreen() {
  const router = useRouter()
  const { signUp, signInWithGoogle, signInWithApple } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [nameError, setNameError] = useState('')

  function validateName(name: string) {
    const err = validateDisplayName(name)
    setNameError(err ?? '')
    return !err
  }

  async function handleSignUp() {
    if (!validateName(displayName)) return
    if (!email || !password) return

    setLoading(true)
    const { error } = await signUp(email.trim().toLowerCase(), password, displayName.trim(), role)
    setLoading(false)

    if (error) {
      Alert.alert('Sign up failed', error)
    } else {
      capture('sign_up', { role })
    }
    // RouteGuard handles redirect on session change
  }

  async function handleGoogle() {
    setOauthLoading('google')
    const { error } = await signInWithGoogle()
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_up', { method: 'google' })
    // RouteGuard will redirect to role-select if role is not set
  }

  async function handleApple() {
    setOauthLoading('apple')
    const { error } = await signInWithApple()
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_up', { method: 'apple' })
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View>
        <Text style={styles.heading}>Create your account</Text>
        <Text style={styles.sub}>Join Drape — it's free.</Text>

        {/* Role picker */}
        <View style={styles.roleRow}>
          <TouchableOpacity
            testID="role-customer"
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
          >
            <Text style={styles.roleEmoji}>👔</Text>
            <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
              I'm a customer
            </Text>
            <Text style={styles.roleHint}>I want custom clothing</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="role-tailor"
            style={[styles.roleCard, role === 'TAILOR' && styles.roleCardActive]}
            onPress={() => setRole('TAILOR')}
          >
            <Text style={styles.roleEmoji}>🧵</Text>
            <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
              I'm a tailor
            </Text>
            <Text style={styles.roleHint}>I make custom clothing</Text>
          </TouchableOpacity>
        </View>

        <Input
          label="Display name"
          placeholder="e.g. Ade Okafor"
          value={displayName}
          onChangeText={(v) => {
            setDisplayName(v)
            if (nameError) validateName(v)
          }}
          onBlur={() => validateName(displayName)}
          error={nameError}
          hint="Your name shown to tailors or customers. No @, URLs, or phone numbers."
          filterContact
          required
          autoCapitalize="words"
          testID="display-name-input"
        />

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
          placeholder="8+ characters"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          required
          testID="password-input"
        />

        <Button
          label="Create account"
          onPress={handleSignUp}
          loading={loading}
          disabled={!displayName || !email || !password || !!nameError}
        />

        <Divider label="or sign up with" />

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

        <Text style={styles.signInPrompt}>
          Already have an account?{' '}
          <Text style={styles.link} onPress={() => router.replace('/(auth)/sign-in')}>
            Sign in
          </Text>
        </Text>
      </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bone },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, marginTop: -Spacing.sm },
  roleRow: { flexDirection: 'row', gap: Spacing.md },
  roleCard: {
    flex: 1,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  roleCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  roleEmoji: { fontSize: 24 },
  roleLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
    textAlign: 'center',
  },
  roleLabelActive: { color: Colors.needleGreen },
  roleHint: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },
  signInPrompt: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { color: Colors.needleGreen, fontWeight: FontWeight.medium },
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

import { useState } from 'react'
import { Platform, View, Text, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, ScrollView } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'
import { validateDisplayName } from '@drape/shared/contact-filter'

type Role = 'CUSTOMER' | 'TAILOR'

export default function SignUpScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { signUp, signInWithGoogle, signInWithApple } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  function validateName(name: string) {
    const err = validateDisplayName(name)
    setNameError(err ?? '')
    return !err
  }

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

  function validatePassword(value: string) {
    if (!value) {
      setPasswordError('Password is required.')
      return false
    }
    if (value.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return false
    }
    setPasswordError('')
    return true
  }

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(auth)/welcome')
  }

  async function handleSignUp() {
    if (loading || oauthLoading) return
    if (!validateName(displayName)) return
    if (!validateEmail(email) || !validatePassword(password)) return

    setLoading(true)
    const { error, requiresEmailConfirmation } = await signUp(email.trim().toLowerCase(), password, displayName.trim(), role)
    setLoading(false)

    if (error) {
      Alert.alert('Sign up failed', error)
    } else {
      capture('sign_up', { role })
      if (requiresEmailConfirmation) {
        Alert.alert(
          'Check your email',
          'We sent you a confirmation link. Open it to finish creating your account, then sign in.',
          [
            {
              text: 'OK',
              onPress: () => {
                router.replace('/(auth)/sign-in')
              },
            },
          ]
        )
      }
    }
    // RouteGuard handles redirect on session change
  }

  async function handleGoogle() {
    if (loading || oauthLoading) return
    setOauthLoading('google')
    const { error } = await signInWithGoogle()
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_up', { method: 'google' })
    // RouteGuard will redirect to role-select if role is not set
  }

  async function handleApple() {
    if (loading || oauthLoading) return
    setOauthLoading('apple')
    const { error } = await signInWithApple()
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_up', { method: 'apple' })
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Create your Drape account</Text>
        </View>
        <Text style={styles.heading}>One account. Tailored for whichever side you're on.</Text>
        <Text style={styles.sub}>
          Customers discover trusted tailors and track every step. Tailors manage briefs, quotes, consultations, and production in one calm workspace.
        </Text>
        <View style={styles.heroPoints}>
          <View style={styles.heroPoint}>
            <Text style={styles.heroPointTitle}>For customers</Text>
            <Text style={styles.heroPointCopy}>Send one clear brief, review your quote, and follow progress without guesswork.</Text>
          </View>
          <View style={styles.heroPoint}>
            <Text style={styles.heroPointTitle}>For tailors</Text>
            <Text style={styles.heroPointCopy}>Receive serious orders, guide consultations, and keep production beautifully organised.</Text>
          </View>
        </View>
      </View>

      <View style={styles.formCard}>
        <View style={styles.formIntro}>
          <Text style={styles.formEyebrow}>Choose your starting role</Text>
          <Text style={styles.formTitle}>You can always switch views later.</Text>
        </View>

        <View style={styles.roleGuideCard}>
          <Text style={styles.roleGuideTitle}>Best starting point</Text>
          <Text style={styles.roleGuideText}>
            Pick the side you expect to use first. Drape keeps both experiences under one account, so this choice is just your cleanest way in.
          </Text>
        </View>

        {/* Role picker */}
        <View style={styles.roleRow}>
          <TouchableOpacity
            testID="role-customer"
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
          >
            <View style={[styles.roleIconWrap, role === 'CUSTOMER' && styles.roleIconWrapActive]}>
              <Text style={styles.roleEmoji}>👔</Text>
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
                Customer
              </Text>
              <Text style={styles.roleHint}>Find a tailor, place an order, and track it through to completion.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'CUSTOMER' && styles.roleCheckActive]}>
              <Text style={[styles.roleCheckText, role === 'CUSTOMER' && styles.roleCheckTextActive]}>✓</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            testID="role-tailor"
            style={[styles.roleCard, role === 'TAILOR' && styles.roleCardActive]}
            onPress={() => setRole('TAILOR')}
          >
            <View style={[styles.roleIconWrap, role === 'TAILOR' && styles.roleIconWrapActive]}>
              <Text style={styles.roleEmoji}>🧵</Text>
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
                Tailor
              </Text>
              <Text style={styles.roleHint}>Receive briefs, run consultations, send quotes, and manage production.</Text>
            </View>
            <View style={[styles.roleCheck, role === 'TAILOR' && styles.roleCheckActive]}>
              <Text style={[styles.roleCheckText, role === 'TAILOR' && styles.roleCheckTextActive]}>✓</Text>
            </View>
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
          placeholder="8+ characters"
          value={password}
          onChangeText={(value) => {
            setPassword(value)
            if (passwordError) validatePassword(value)
          }}
          onBlur={() => validatePassword(password)}
          error={passwordError}
          secureTextEntry
          required
          testID="password-input"
        />

        <Button
          label="Create account"
          onPress={handleSignUp}
          loading={loading}
          disabled={!displayName || !email || !password || !!nameError || !!emailError || !!passwordError}
        />

        <View style={styles.nextCard}>
          <Text style={styles.nextEyebrow}>What happens next</Text>
          <Text style={styles.nextTitle}>
            We’ll take you into the right setup flow so your first booking or first client order starts cleanly.
          </Text>
          <Text style={styles.nextCopy}>
            Customers finish a few fit basics. Tailors continue into storefront, availability, and verification.
          </Text>
        </View>

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
              <Ionicons name="logo-apple" size={18} color={Colors.white} />
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
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
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
  heroPoints: { gap: Spacing.md },
  heroPoint: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.bone,
    padding: Spacing.md,
    gap: 4,
  },
  heroPointTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  heroPointCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  formIntro: { gap: 4 },
  formEyebrow: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
  formTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold },
  roleGuideCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  roleGuideTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  roleGuideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  roleRow: { gap: Spacing.md },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    gap: Spacing.md,
  },
  roleCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  roleEmoji: { fontSize: 24 },
  roleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconWrapActive: {
    backgroundColor: '#EAF6F1',
  },
  roleTextWrap: { flex: 1, gap: 2 },
  roleLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  roleLabelActive: { color: Colors.needleGreen },
  roleHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  roleCheck: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  roleCheckActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  roleCheckText: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.bold,
  },
  roleCheckTextActive: {
    color: Colors.white,
  },
  signInPrompt: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { color: Colors.needleGreen, fontWeight: FontWeight.medium },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
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

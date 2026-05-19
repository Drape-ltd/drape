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
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'

type Role = 'CUSTOMER' | 'TAILOR'

function passwordStrength(value: string) {
  const hasLower = /[a-z]/u.test(value)
  const hasUpper = /[A-Z]/u.test(value)
  const hasNumber = /[0-9]/u.test(value)
  const hasSymbol = /[^A-Za-z0-9\s]/u.test(value)

  if (value.length >= 12 && hasLower && hasUpper && hasNumber && hasSymbol) {
    return { label: 'Strong', color: Colors.needleGreenDark, progress: '100%' as const }
  }
  if (value.length >= 8 && hasLower && hasUpper && hasNumber) {
    return { label: 'Good', color: Colors.needleGreen, progress: '75%' as const }
  }
  if (value.length >= 8) {
    return { label: 'Fair', color: Colors.statusPending, progress: '50%' as const }
  }
  return { label: 'Weak', color: Colors.error, progress: '25%' as const }
}

function passwordChecklist(value: string) {
  return [
    { label: 'At least 8 characters', met: value.length >= 8 },
    { label: 'At least one number', met: /[0-9]/u.test(value) },
    { label: 'At least one uppercase letter', met: /[A-Z]/u.test(value) },
  ]
}

export default function SignUpScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { signUp, signInWithGoogle, signInWithApple } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>('CUSTOMER')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const strength = passwordStrength(password)
  const passwordRequirements = passwordChecklist(password)
  const passwordRequirementsMet = passwordRequirements.every((requirement) => requirement.met)
  const confirmPasswordError = confirmPassword && password !== confirmPassword ? 'Passwords do not match' : ''

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
    const err = validatePasswordStrength(value, { forbiddenValues: [email, displayName] })
    setPasswordError(err ?? '')
    return !err
  }

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(auth)/welcome')
  }

  async function handleSignUp() {
    if (loading || oauthLoading) return
    if (!validateName(displayName)) return
    if (!validateEmail(email) || !validatePassword(password)) return
    if (!passwordRequirementsMet || password !== confirmPassword) return

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
        <Text style={styles.heading}>Create your account.</Text>
        <Text style={styles.sub}>Start as a customer or tailor. You can switch later inside Drape.</Text>
      </View>

      <View style={styles.formCard}>
        <View style={styles.formIntro}>
          <Text style={styles.formEyebrow}>Choose your starting role</Text>
          <Text style={styles.formTitle}>You can always switch views later.</Text>
        </View>

        {/* Role picker */}
        <View style={styles.roleRow}>
          <TouchableOpacity
            testID="role-customer"
            style={[styles.roleCard, role === 'CUSTOMER' && styles.roleCardActive]}
            onPress={() => setRole('CUSTOMER')}
            accessibilityRole="button"
            accessibilityLabel="Start as a customer"
            accessibilityState={{ selected: role === 'CUSTOMER' }}
          >
            <View style={[styles.roleIconWrap, role === 'CUSTOMER' && styles.roleIconWrapActive]}>
              <Ionicons name="person-outline" size={22} color={role === 'CUSTOMER' ? Colors.needleGreen : Colors.ink} />
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
            accessibilityRole="button"
            accessibilityLabel="Start as a tailor"
            accessibilityState={{ selected: role === 'TAILOR' }}
          >
            <View style={[styles.roleIconWrap, role === 'TAILOR' && styles.roleIconWrapActive]}>
              <Ionicons name="cut-outline" size={22} color={role === 'TAILOR' ? Colors.needleGreen : Colors.ink} />
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
          placeholder="e.g. John Doe"
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
          hint={PASSWORD_POLICY_HINT}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          required
          testID="password-input"
        />
        {password ? (
          <View style={styles.passwordMeter}>
            <View style={styles.passwordMeterHeader}>
              <Text style={styles.passwordMeterLabel}>Password strength</Text>
              <Text style={[styles.passwordMeterValue, { color: strength.color }]}>{strength.label}</Text>
            </View>
            <View style={styles.passwordMeterTrack}>
              <View
                style={[
                  styles.passwordMeterFill,
                  { width: strength.progress, backgroundColor: strength.color },
                ]}
              />
            </View>
            {!passwordRequirementsMet ? (
              <View style={styles.passwordChecklist}>
                {passwordRequirements.map((requirement) => (
                  <View key={requirement.label} style={styles.passwordChecklistRow}>
                    <View style={[styles.passwordCheckDot, requirement.met && styles.passwordCheckDotMet]}>
                      <Text style={[styles.passwordCheckGlyph, requirement.met && styles.passwordCheckGlyphMet]}>
                        {requirement.met ? '✓' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.passwordCheckText, requirement.met && styles.passwordCheckTextMet]}>
                      {requirement.label}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <Input
          label="Confirm password"
          placeholder="Repeat your password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={confirmPasswordError}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          required
          testID="confirm-password-input"
        />

        <Button
          label="Create account"
          onPress={handleSignUp}
          loading={loading}
          disabled={
            !displayName ||
            !email ||
            !password ||
            !confirmPassword ||
            !passwordRequirementsMet ||
            !!nameError ||
            !!emailError ||
            !!passwordError ||
            !!confirmPasswordError
          }
        />

        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>You’ll go into the right setup flow next.</Text>
        </View>

        <Divider label="or sign up with" />

        <View style={styles.oauthRow}>
          <TouchableOpacity
            style={styles.oauthBtn}
            onPress={handleGoogle}
            disabled={!!oauthLoading || loading}
            accessibilityRole="button"
            accessibilityLabel="Sign up with Google"
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
              accessibilityRole="button"
              accessibilityLabel="Sign up with Apple"
            >
              <Ionicons name="logo-apple" size={18} color={Colors.textInverse} />
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
  content: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  heading: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 34, letterSpacing: -0.4, fontFamily: 'Georgia' },
  sub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  formIntro: { gap: 4 },
  formEyebrow: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.8 },
  formTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold, fontFamily: 'Georgia' },
  passwordMeter: {
    gap: Spacing.sm,
    marginTop: -Spacing.sm,
  },
  passwordMeterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  passwordMeterLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  passwordMeterValue: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  passwordMeterTrack: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    overflow: 'hidden',
  },
  passwordMeterFill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  passwordChecklist: {
    gap: 6,
  },
  passwordChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  passwordCheckDot: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  passwordCheckDotMet: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  passwordCheckGlyph: {
    fontSize: 10,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
  passwordCheckGlyphMet: {
    color: Colors.textInverse,
  },
  passwordCheckText: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  passwordCheckTextMet: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
  roleRow: { gap: Spacing.md },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    gap: Spacing.md,
  },
  roleCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  roleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconWrapActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  roleTextWrap: { flex: 1, gap: 2 },
  roleLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  roleLabelActive: { color: Colors.needleGreen },
  roleHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 16 },
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
    color: Colors.textInverse,
  },
  signInPrompt: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { color: Colors.needleGreen, fontWeight: FontWeight.medium },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.md,
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
    lineHeight: 19,
  },
  nextCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  oauthRow: { flexDirection: 'row', gap: Spacing.md },
  oauthBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, minHeight: 44, paddingVertical: Spacing.sm,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  oauthBtnApple: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  oauthIcon: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  oauthIconApple: { color: Colors.textInverse },
  oauthLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  oauthLabelApple: { color: Colors.textInverse },
})

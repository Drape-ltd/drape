import { useState } from 'react'
import {
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import { Button, Input, Divider } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme'
import { colors } from '@drape/shared/design-system'
import { validateDisplayName } from '@drape/shared/contact-filter'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'

type Role = 'CUSTOMER' | 'TAILOR'

const oauthPalette = {
  appleBg: colors.surfaceDark,
  appleFg: colors.textInverse,
  googleBg: colors.surface,
  googleFg: colors.textPrimary,
  googleBorder: colors.border,
}

function normalizeRoleIntent(value: unknown): Role | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === 'CUSTOMER' || candidate === 'TAILOR' ? candidate : null
}

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
  const params = useLocalSearchParams<{ intent?: string }>()
  const { signUp, signInWithGoogle, signInWithApple } = useAuth()
  const initialRole = normalizeRoleIntent(params.intent) ?? 'CUSTOMER'

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>(initialRole)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const strength = passwordStrength(password)
  const passwordRequirements = passwordChecklist(password)
  const passwordRequirementsMet = passwordRequirements.every((requirement) => requirement.met)
  const confirmPasswordError =
    confirmPassword && password !== confirmPassword ? 'Passwords do not match' : ''

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
    router.replace('/(auth)/welcome')
  }

  useContextualBackHandler(goBack)

  async function handleSignUp() {
    if (loading || oauthLoading) return
    if (!validateName(displayName)) return
    if (!validateEmail(email) || !validatePassword(password)) return
    if (!passwordRequirementsMet || password !== confirmPassword) return

    setLoading(true)
    const { error, requiresEmailConfirmation } = await signUp(
      email.trim().toLowerCase(),
      password,
      displayName.trim(),
      role
    )
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
    const { error } = await signInWithGoogle(role)
    setOauthLoading(null)
    if (error) Alert.alert('Google sign-in failed', error)
    else capture('sign_up', { method: 'google' })
    // RouteGuard will redirect to role-select if role is not set
  }

  async function handleApple() {
    if (loading || oauthLoading) return
    setOauthLoading('apple')
    const { error } = await signInWithApple(role)
    setOauthLoading(null)
    if (error) Alert.alert('Apple sign-in failed', error)
    else capture('sign_up', { method: 'apple' })
  }

  return (
    <SafeAreaView style={styles.container}>
      <AuthBackButton style={styles.back} onPress={goBack} />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AuthEntryHeader
            eyebrow="Create account"
            title="Create your Drapeon account."
            body="Choose your starting side. You can add the other side later from account settings."
            showWordmark={false}
            compact
          />

          <View style={styles.formCard}>
            <View style={styles.roleRow}>
              <TouchableOpacity
                testID="role-customer"
                style={[styles.roleSegment, role === 'CUSTOMER' && styles.roleSegmentActive]}
                onPress={() => setRole('CUSTOMER')}
                accessibilityRole="button"
                accessibilityLabel="Start as a customer"
                accessibilityState={{ selected: role === 'CUSTOMER' }}
              >
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={role === 'CUSTOMER' ? Colors.needleGreen : Colors.midGrey}
                />
                <Text style={[styles.roleLabel, role === 'CUSTOMER' && styles.roleLabelActive]}>
                  Customer
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="role-tailor"
                style={[styles.roleSegment, role === 'TAILOR' && styles.roleSegmentActive]}
                onPress={() => setRole('TAILOR')}
                accessibilityRole="button"
                accessibilityLabel="Start as a tailor"
                accessibilityState={{ selected: role === 'TAILOR' }}
              >
                <Ionicons
                  name="cut-outline"
                  size={18}
                  color={role === 'TAILOR' ? Colors.needleGreen : Colors.midGrey}
                />
                <Text style={[styles.roleLabel, role === 'TAILOR' && styles.roleLabelActive]}>
                  Tailor
                </Text>
              </TouchableOpacity>
            </View>

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
                  <Ionicons name="logo-apple" size={18} color={oauthPalette.appleFg} />
                  <Text style={[styles.oauthLabel, styles.oauthLabelApple]}>
                    {oauthLoading === 'apple' ? 'Opening…' : 'Apple'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Divider label="or use email" />

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
                  <Text style={[styles.passwordMeterValue, { color: strength.color }]}>
                    {strength.label}
                  </Text>
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
                        <View
                          style={[
                            styles.passwordCheckDot,
                            requirement.met && styles.passwordCheckDotMet,
                          ]}
                        >
                          <Text
                            style={[
                              styles.passwordCheckGlyph,
                              requirement.met && styles.passwordCheckGlyphMet,
                            ]}
                          >
                            {requirement.met ? '✓' : ''}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.passwordCheckText,
                            requirement.met && styles.passwordCheckTextMet,
                          ]}
                        >
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

            <Text style={styles.confirmationNote}>
              We’ll send a confirmation link before opening your setup flow.
            </Text>

            <Text style={styles.signInPrompt}>
              Already have an account?{' '}
              <Text
                style={styles.link}
                onPress={() => router.replace({
                  pathname: '/(auth)/sign-in',
                  params: { intent: role },
                })}
              >
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
  keyboardAvoider: { flex: 1 },
  back: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.md,
  },
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
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  passwordMeterValue: {
    fontFamily: Fonts.bodySemiBold,
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
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
  passwordCheckGlyphMet: {
    color: Colors.textInverse,
  },
  passwordCheckText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  passwordCheckTextMet: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
  roleRow: {
    backgroundColor: Colors.bone,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: 4,
  },
  roleSegment: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: Spacing.md,
  },
  roleSegmentActive: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roleLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  roleLabelActive: { color: Colors.needleGreen },
  signInPrompt: { fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center' },
  link: { fontFamily: Fonts.bodyMedium, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  confirmationNote: {
    color: Colors.midGrey,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  oauthRow: { flexDirection: 'row', gap: Spacing.md },
  oauthBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: oauthPalette.googleBorder,
    backgroundColor: oauthPalette.googleBg,
  },
  oauthBtnApple: { backgroundColor: oauthPalette.appleBg, borderColor: oauthPalette.appleBg },
  oauthIcon: { fontFamily: Fonts.bodyBold, fontSize: FontSize.md, fontWeight: FontWeight.bold, color: oauthPalette.googleFg },
  oauthIconApple: { color: oauthPalette.appleFg },
  oauthLabel: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: oauthPalette.googleFg },
  oauthLabelApple: { color: oauthPalette.appleFg },
})

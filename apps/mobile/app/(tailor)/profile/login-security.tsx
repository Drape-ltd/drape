/**
 * Login & Security
 *
 * Change password + biometric lock toggle.
 *
 * Security model:
 *   Before the password-change form is shown the user must re-authenticate
 *   via biometric (if enabled + available) or their current password.
 *   This prevents "shoulder surfing" password changes on an unlocked device.
 */

import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Platform,
} from 'react-native'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { signInWithPasswordResilient, useAuth } from '@/lib/auth'
import { requestAccountDeletion } from '@/lib/account-deletion'
import { goBackOrFallback } from '@/lib/navigation'
import {
  isBiometricAvailable, getBiometricLabel,
  isBiometricEnabled, setBiometricEnabled, authenticate,
} from '@/lib/biometric'
import { markRecentReauth } from '@/lib/recent-reauth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'

type Step = 'reauth' | 'change'

export default function LoginSecurityScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  // ── Re-auth gate ─────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('reauth')
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthLoading, setReauthLoading] = useState(false)
  const [biometricAvailableForReauth, setBiometricAvailableForReauth] = useState(false)

  // ── Password change ──────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

  // ── Biometric toggle ─────────────────────────────────────────────────────
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricLabel, setBiometricLabel] = useState('Biometrics')
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [togglingBiometric, setTogglingBiometric] = useState(false)
  const newPasswordError = newPassword
    ? (validatePasswordStrength(newPassword, { forbiddenValues: [user?.email] }) ?? '')
    : ''

  useFocusEffect(
    useCallback(() => {
      setStep('reauth')
      setReauthPassword('')
      async function checkBiometric() {
        const available = await isBiometricAvailable()
        setBiometricAvailable(available)
        if (available) {
          setBiometricLabel(await getBiometricLabel())
          const enabled = await isBiometricEnabled()
          setBiometricEnabledState(enabled)
          setBiometricAvailableForReauth(enabled) // only offer biometric re-auth if it's already enabled
        }
      }
      checkBiometric()
    }, [])
  )

  // ── Re-auth via biometric ────────────────────────────────────────────────
  async function reauthWithBiometric() {
    try {
      setReauthLoading(true)
      const ok = await authenticate('Verify your identity to change your password')
      if (ok) {
        await markRecentReauth(user?.id)
        setStep('change')
      } else {
        Alert.alert('Verification failed', 'Could not verify your identity. Enter your current password instead.')
      }
    } catch {
      Alert.alert('Verification failed', 'Biometric verification is unavailable right now. Enter your current password instead.')
    } finally {
      setReauthLoading(false)
    }
  }

  // ── Re-auth via current password ─────────────────────────────────────────
  async function reauthWithPassword() {
    if (reauthLoading) return
    if (!reauthPassword) {
      Alert.alert('Required', 'Enter your current password to continue.')
      return
    }
    setReauthLoading(true)
    const { error } = await signInWithPasswordResilient(user?.email ?? '', reauthPassword)
    setReauthLoading(false)
    if (error) {
      Alert.alert('Incorrect password', 'The password you entered is wrong.')
    } else {
      await markRecentReauth(user?.id)
      setReauthPassword('')
      setStep('change')
    }
  }

  // ── Change password ──────────────────────────────────────────────────────
  async function changePassword() {
    if (savingPassword) return
    if (newPasswordError) {
      Alert.alert('Password issue', newPasswordError)
      return
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.')
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      Alert.alert('Password changed', 'Your password has been updated successfully.')
      setNewPassword('')
      setConfirmPassword('')
      setStep('reauth') // reset gate after success
    }
  }

  // ── Biometric toggle ─────────────────────────────────────────────────────
  async function toggleBiometric(value: boolean) {
    try {
      setTogglingBiometric(true)
      if (value) {
        const ok = await authenticate(`Confirm ${biometricLabel} to enable it for Drape`)
        if (!ok) return
      }
      await setBiometricEnabled(value)
      setBiometricEnabledState(value)
    } catch {
      Alert.alert('Could not update setting', `We couldn't update ${biometricLabel} just now. Your current lock setting has not changed.`)
    } finally {
      setTogglingBiometric(false)
    }
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This starts a permanent account deletion request inside Drape. We may retain transaction records where legally required, but your account will be closed and queued for removal.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingAccount(true)
              const result = await requestAccountDeletion()
              setDeletingAccount(false)

              if (result.error) {
                Alert.alert('Error', result.error)
                return
              }

              if (result.alreadyPending) {
                Alert.alert(
                  'Already requested',
                  'You already have a pending deletion request. Our team will continue processing it.'
                )
                return
              }

              Alert.alert(
                'Request received',
                'Your deletion request has been submitted inside Drape. We will process it and contact you if anything requires confirmation.'
              )
            })()
          },
        },
      ],
    )
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/account-settings')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Login & security</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.guideCard}>
          <Text style={styles.guideEyebrow}>Account protection</Text>
          <Text style={styles.guideTitle}>Protect your payout and client work with a cleaner security routine.</Text>
          <Text style={styles.guideCopy}>Use biometric unlock if it fits your device, then re-verify your identity before changing your password or requesting deletion.</Text>
        </View>

        {/* ── Biometric toggle (always visible) ── */}
        {biometricAvailable && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'Fingerprint'}
            </Text>
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Use {biometricLabel}</Text>
                  <Text style={styles.toggleSub}>
                    Lock Drape after 5 minutes in the background. {biometricLabel} will unlock it instantly.
                  </Text>
                </View>
                {togglingBiometric
                  ? <ActivityIndicator color={Colors.needleGreen} />
                  : (
                    <Switch
                      value={biometricEnabled}
                      onValueChange={toggleBiometric}
                      trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
                      thumbColor={Colors.white}
                    />
                  )
                }
              </View>
            </View>
          </View>
        )}

        {/* ── Change password ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change password</Text>

          {step === 'reauth' ? (
            // Re-auth gate — must verify identity before seeing the form
            <View style={styles.card}>
              <View style={styles.gateWrap}>
                <Feather name="lock" size={28} color={Colors.needleGreen} style={{ marginBottom: Spacing.md }} />
                <Text style={styles.gateTitle}>Verify your identity</Text>
                <Text style={styles.gateSub}>
                  To protect your account, confirm who you are before changing your password.
                </Text>

                {biometricAvailableForReauth && (
                  <TouchableOpacity
                    style={[styles.biometricBtn, reauthLoading && { opacity: 0.6 }]}
                    onPress={reauthWithBiometric}
                    disabled={reauthLoading}
                  >
                    <Feather
                      name={Platform.OS === 'ios' ? 'eye' : 'cpu'}
                      size={18}
                      color={Colors.needleGreen}
                    />
                    <Text style={styles.biometricBtnText}>
                      Use {biometricLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={styles.divider} />

                <View style={styles.field}>
                  <Text style={styles.label}>Current password</Text>
                  <TextInput
                    style={styles.input}
                    value={reauthPassword}
                    onChangeText={setReauthPassword}
                    placeholder="Enter current password"
                    placeholderTextColor={Colors.midGrey}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    maxLength={MAX_PASSWORD_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={reauthWithPassword}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.saveBtn, reauthLoading && { opacity: 0.6 }]}
                  onPress={reauthWithPassword}
                  disabled={reauthLoading}
                >
                  {reauthLoading
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <Text style={styles.saveBtnText}>Continue</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Identity confirmed — show the change-password form
            <>
              <View style={styles.card}>
                <View style={styles.verifiedBanner}>
                  <Feather name="check-circle" size={16} color={Colors.success} />
                  <Text style={styles.verifiedText}>Identity verified</Text>
                </View>

                <View style={styles.divider} />

                <View style={styles.field}>
                  <Text style={styles.label}>New password</Text>
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="10+ characters"
                    placeholderTextColor={Colors.midGrey}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="new-password"
                    maxLength={MAX_PASSWORD_LENGTH}
                    returnKeyType="next"
                  />
                  <Text style={newPasswordError ? styles.fieldError : styles.fieldHint}>
                    {newPasswordError || PASSWORD_POLICY_HINT}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.field}>
                  <Text style={styles.label}>Confirm new password</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repeat new password"
                    placeholderTextColor={Colors.midGrey}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="new-password"
                    maxLength={MAX_PASSWORD_LENGTH}
                    returnKeyType="done"
                  />
                  {confirmPassword && newPassword !== confirmPassword ? (
                    <Text style={styles.fieldError}>Passwords do not match.</Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                style={[styles.saveBtn, savingPassword && { opacity: 0.6 }]}
                onPress={changePassword}
                disabled={savingPassword || !newPassword || !confirmPassword || !!newPasswordError || newPassword !== confirmPassword}
              >
                {savingPassword
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.saveBtnText}>Change password</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.infoNote}>
          Drape uses Supabase Auth — passwords are hashed and never stored in plain text.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.dangerWrap}>
              <Text style={styles.dangerTitle}>Delete your account</Text>
              <Text style={styles.dangerCopy}>
                Start a permanent deletion request for your Drape account if you no longer want to operate on the platform.
              </Text>
              <TouchableOpacity
                style={[styles.deleteBtn, deletingAccount && { opacity: 0.6 }]}
                onPress={handleDeleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.deleteBtnText}>Request account deletion</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  body: { padding: Spacing.lg, paddingBottom: 32, gap: Spacing.sm },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },

  section: { gap: 8 },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.md },
  field: { padding: Spacing.md, gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  input: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, fontSize: FontSize.md, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  fieldError: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 18 },

  // Re-auth gate
  gateWrap: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  gateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  gateSub: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.md },
  biometricBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.needleGreen,
    marginBottom: Spacing.sm,
  },
  biometricBtnText: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  verifiedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, backgroundColor: Colors.success + '12',
  },
  verifiedText: { fontSize: FontSize.sm, color: Colors.success, fontWeight: FontWeight.medium },

  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.lg,
    padding: 12, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  toggleTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 4 },
  toggleSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  infoNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center', lineHeight: 18 },
  dangerWrap: { padding: Spacing.md },
  dangerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.error, fontFamily: 'Georgia' },
  dangerCopy: { marginTop: Spacing.sm, fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  deleteBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.error,
    borderRadius: Radius.full,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
})

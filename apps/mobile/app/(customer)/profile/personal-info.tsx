/**
 * Personal Information
 *
 * Lets the customer update their display name and phone number.
 * Email is shown read-only (tied to Supabase auth identity).
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { signInWithPasswordResilient, useAuth } from '@/lib/auth'
import { authenticate, getBiometricLabel, isBiometricAvailable, isBiometricEnabled } from '@/lib/biometric'
import { hasRecentReauth, markRecentReauth, RECENT_REAUTH_WINDOW_MINUTES } from '@/lib/recent-reauth'
import { goBackOrFallback } from '@/lib/navigation'
import { syncUserRow } from '@/lib/syncUserRow'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { normalizePhoneForStorage, PHONE_STORAGE_HINT, validatePhoneForProfile } from '@drape/shared/phone'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export default function PersonalInfoScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name ?? '')
  const [phone, setPhone] = useState(user?.user_metadata?.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [needsPhoneVerification, setNeedsPhoneVerification] = useState(false)
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthLoading, setReauthLoading] = useState(false)
  const [biometricLabel, setBiometricLabel] = useState('Biometrics')
  const [biometricAvailableForReauth, setBiometricAvailableForReauth] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  const normalizedDisplayName = displayName.trim()
  const normalizedPhone = normalizePhoneForStorage(phone)
  const initialDisplayName = user?.user_metadata?.display_name ?? ''
  const initialPhone = normalizePhoneForStorage(user?.user_metadata?.phone ?? '')
  const dirty = normalizedDisplayName !== initialDisplayName || normalizedPhone !== initialPhone
  const phoneChanged = normalizedPhone !== initialPhone

  useEffect(() => {
    let active = true

    async function loadVerificationState() {
      const [recent, available] = await Promise.all([
        hasRecentReauth(user?.id),
        isBiometricAvailable(),
      ])

      if (!active) return
      setPhoneVerified(recent)

      if (!available) {
        setBiometricAvailableForReauth(false)
        return
      }

      const [label, enabled] = await Promise.all([
        getBiometricLabel(),
        isBiometricEnabled(),
      ])

      if (!active) return
      setBiometricLabel(label)
      setBiometricAvailableForReauth(enabled)
    }

    void loadVerificationState()

    return () => {
      active = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!phoneChanged) {
      setNeedsPhoneVerification(false)
      setReauthPassword('')
    }
  }, [phoneChanged])

  function validateName(value: string) {
    const error = validateDisplayName(value)
    setNameError(error ?? '')
    return !error
  }

  function validatePhone(value: string) {
    if (!value.trim()) {
      setPhoneError('Phone number is required.')
      return false
    }
    const error = validatePhoneForProfile(value)
    if (error) {
      setPhoneError(error)
      return false
    }
    setPhoneError('')
    return true
  }

  async function persistProfile() {
    if (!user?.id) return

    setSaving(true)
    const { error: profileError } = await supabase
      .from('customer_profiles')
      .update({ phone: normalizedPhone || null })
      .eq('user_id', user.id)

    if (profileError) {
      setSaving(false)
      Alert.alert('Error', profileError.message)
      return
    }

    const { error } = await supabase.auth.updateUser({
      data: { display_name: normalizedDisplayName, phone: normalizedPhone || null },
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
      return
    }

    await syncUserRow({
      userId: user.id,
      displayName: normalizedDisplayName,
      role: 'CUSTOMER',
    })
    Alert.alert('Saved', 'Your personal information has been updated.')
    goBack()
  }

  async function save(options?: { skipPhoneVerification?: boolean }) {
    if (saving || (reauthLoading && !options?.skipPhoneVerification)) return
    if (!validateName(displayName)) {
      Alert.alert('Invalid name', 'Please fix your display name before saving.')
      return
    }
    if (!validatePhone(phone)) {
      Alert.alert('Invalid phone number', 'Please enter a valid phone number before saving.')
      return
    }
    if (!dirty) return

    if (phoneChanged && !options?.skipPhoneVerification && !phoneVerified) {
      setNeedsPhoneVerification(true)
      Alert.alert(
        'Verify this change',
        'Because phone numbers can become part of account recovery and security, please verify your identity before saving the new number.',
      )
      return
    }

    await persistProfile()
  }

  async function finishPhoneVerification() {
    await markRecentReauth(user?.id)
    setPhoneVerified(true)
    setNeedsPhoneVerification(false)
    setReauthPassword('')
    await save({ skipPhoneVerification: true })
  }

  async function verifyPhoneWithBiometric() {
    try {
      setReauthLoading(true)
      const ok = await authenticate('Verify your identity to update your phone number')
      if (ok) {
        await finishPhoneVerification()
      } else {
        Alert.alert('Verification failed', 'Could not verify your identity. Enter your current password instead.')
      }
    } catch {
      Alert.alert('Verification failed', 'Biometric verification is unavailable right now. Enter your current password instead.')
    } finally {
      setReauthLoading(false)
    }
  }

  async function verifyPhoneWithPassword() {
    if (reauthLoading) return
    if (!reauthPassword) {
      Alert.alert('Required', 'Enter your current password to continue.')
      return
    }

    setReauthLoading(true)
    const { error } = await signInWithPasswordResilient(user?.email ?? '', reauthPassword)
    if (error) {
      setReauthLoading(false)
      Alert.alert('Incorrect password', 'The password you entered is wrong.')
      return
    }

    await finishPhoneVerification()
    setReauthLoading(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal information</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>Email address</Text>
            <View style={styles.readOnly}>
              <Text style={styles.readOnlyText}>{user?.email}</Text>
            </View>
            <Text style={styles.hint}>Your email address cannot be changed here.</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={(value) => {
                setDisplayName(value)
                if (nameError) validateName(value)
              }}
              onBlur={() => validateName(displayName)}
              placeholder="John Doe"
              placeholderTextColor={Colors.midGrey}
              maxLength={50}
              autoCorrect={false}
              returnKeyType="next"
            />
            {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(value) => {
                setPhone(value)
                if (phoneError) validatePhone(value)
              }}
              onBlur={() => validatePhone(phone)}
              placeholder="+234... / +44... / +1..."
              placeholderTextColor={Colors.midGrey}
              keyboardType="phone-pad"
              maxLength={20}
              returnKeyType="done"
            />
            {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            {!phoneError ? (
              <Text style={styles.hint}>
                {phoneChanged
                  ? `Changing this number requires identity verification and stays fresh for ${RECENT_REAUTH_WINDOW_MINUTES} minutes.`
                  : PHONE_STORAGE_HINT}
              </Text>
            ) : null}
          </View>
        </View>

        {needsPhoneVerification && phoneChanged ? (
          <View style={styles.verifyCard}>
            <Text style={styles.verifyTitle}>Verify your identity</Text>
            <Text style={styles.verifyCopy}>
              Because this phone number may be used for account updates and future recovery, confirm this change before saving it.
            </Text>

            {biometricAvailableForReauth ? (
              <TouchableOpacity
                style={[styles.verifyBtn, reauthLoading && { opacity: 0.6 }]}
                onPress={verifyPhoneWithBiometric}
                disabled={reauthLoading}
              >
                <Feather name="shield" size={18} color={Colors.needleGreen} />
                <Text style={styles.verifyBtnText}>Use {biometricLabel}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Current password</Text>
              <TextInput
                style={styles.input}
                value={reauthPassword}
                onChangeText={setReauthPassword}
                placeholder="Enter current password"
                placeholderTextColor={Colors.midGrey}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, reauthLoading && { opacity: 0.6 }]}
              onPress={verifyPhoneWithPassword}
              disabled={reauthLoading}
            >
              {reauthLoading
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.saveBtnText}>Verify & save</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || saving || reauthLoading || !!nameError || !!phoneError) && { opacity: 0.6 }]}
          onPress={() => { void save() }}
          disabled={saving || reauthLoading || !dirty || !!nameError || !!phoneError}
        >
          {saving
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={styles.saveBtnText}>Save changes</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  body: { padding: Spacing.xl, paddingBottom: 64, gap: Spacing.lg },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  verifyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },
  field: { padding: Spacing.lg, gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  readOnly: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey,
  },
  readOnlyText: { fontSize: FontSize.md, color: Colors.midGrey },
  hint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  errorText: { fontSize: FontSize.xs, color: Colors.error, marginTop: 2 },
  input: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, fontSize: FontSize.md, color: Colors.ink,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  verifyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  verifyCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreenLight,
  },
  verifyBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.lg,
    padding: Spacing.lg, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
})

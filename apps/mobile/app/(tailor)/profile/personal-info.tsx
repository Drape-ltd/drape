/**
 * Personal Information (Tailor)
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { updatePersonalInfoWithServerPreflight } from '@/lib/account-profile-actions'
import { issueReauthProof } from '@/lib/reauth-proof'
import { goBackOrFallback } from '@/lib/navigation'
import { Input } from '@/components/ui'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { normalizePhoneForStorage, PHONE_STORAGE_HINT, validatePhoneForProfile } from '@drape/shared/phone'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export default function TailorPersonalInfoScreen() {
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
  const [phoneReauthProof, setPhoneReauthProof] = useState('')

  const normalizedDisplayName = displayName.trim()
  const normalizedPhone = normalizePhoneForStorage(phone)
  const initialDisplayName = user?.user_metadata?.display_name ?? ''
  const initialPhone = normalizePhoneForStorage(user?.user_metadata?.phone ?? '')
  const dirty = normalizedDisplayName !== initialDisplayName || normalizedPhone !== initialPhone
  const phoneChanged = normalizedPhone !== initialPhone

  useEffect(() => {
    if (!phoneChanged) {
      const timer = setTimeout(() => {
        setNeedsPhoneVerification(false)
        setReauthPassword('')
        setPhoneReauthProof('')
      }, 0)
      return () => clearTimeout(timer)
    }
    return undefined
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

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile/account-settings')
  }

  async function persistProfile(options?: { reauthProof?: string }) {
    if (!user?.id) return

    setSaving(true)
    const result = await updatePersonalInfoWithServerPreflight({
      role: 'TAILOR',
      displayName: normalizedDisplayName,
      phone: normalizedPhone,
      reauthProof: phoneChanged ? (options?.reauthProof ?? phoneReauthProof) : undefined,
    })
    setSaving(false)
    if (result.error) {
      Alert.alert('Could not save profile', result.error)
      return
    }

    Alert.alert('Saved', 'Your personal information has been updated.')
    goBack()
  }

  async function save(options?: { skipPhoneVerification?: boolean; reauthProof?: string }) {
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

    const confirmedProof = options?.reauthProof ?? phoneReauthProof
    if (phoneChanged && !options?.skipPhoneVerification && !confirmedProof) {
      setNeedsPhoneVerification(true)
      Alert.alert(
        'Verify this change',
        'Because phone numbers can become part of account recovery and security, please verify your identity before saving the new number.',
      )
      return
    }

    await persistProfile({ reauthProof: options?.reauthProof })
  }

  async function finishPhoneVerification(proof: string) {
    setPhoneReauthProof(proof)
    setNeedsPhoneVerification(false)
    setReauthPassword('')
    await save({ skipPhoneVerification: true, reauthProof: proof })
  }

  async function verifyPhoneWithPassword() {
    if (reauthLoading) return
    if (!reauthPassword) {
      Alert.alert('Required', 'Enter your current password to continue.')
      return
    }

    setReauthLoading(true)
    const result = await issueReauthProof({
      password: reauthPassword,
      purpose: 'PHONE_CHANGE',
    })
    if (result.error) {
      setReauthLoading(false)
      Alert.alert(
        result.error.toLowerCase().includes('incorrect') ? 'Incorrect password' : 'Could not confirm password',
        result.error,
      )
      return
    }

    if (!result.proof) {
      setReauthLoading(false)
      Alert.alert('Could not confirm password', 'Confirm your password again before saving this phone number.')
      return
    }

    await finishPhoneVerification(result.proof)
    setReauthLoading(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal information</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>Email address</Text>
            <View style={styles.readOnly}>
              <Text style={styles.readOnlyText}>{user?.email}</Text>
            </View>
            <Text style={styles.hint}>Change your email from Login & security so Drapeon can confirm your current password first.</Text>
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
              placeholder="e.g. John Doe"
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
                  ? 'Changing this number requires your current password before it saves.'
                  : PHONE_STORAGE_HINT}
              </Text>
            ) : null}
          </View>
        </View>

        {needsPhoneVerification && phoneChanged ? (
          <View style={styles.securityPanel}>
            <View style={styles.securityPanelHeader}>
              <View style={styles.securityIcon}>
                <Feather name="lock" size={16} color={Colors.needleGreen} />
              </View>
              <View style={styles.securityCopy}>
                <Text style={styles.securityTitle}>Confirm this change</Text>
                <Text style={styles.securityText}>
                  Enter your current password before saving a new phone number.
                </Text>
              </View>
            </View>

            <View style={styles.field}>
              <Input
                label="Current password"
                value={reauthPassword}
                onChangeText={setReauthPassword}
                placeholder="Enter current password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="done"
                onSubmitEditing={verifyPhoneWithPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, reauthLoading && styles.saveBtnDisabled]}
              onPress={verifyPhoneWithPassword}
              disabled={reauthLoading}
            >
              {reauthLoading
                ? <ActivityIndicator color={Colors.textInverse} size="small" />
                : <Text style={styles.saveBtnText}>Verify & save</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || saving || reauthLoading || !!nameError || !!phoneError) && styles.saveBtnDisabled]}
          onPress={() => { void save() }}
          disabled={saving || reauthLoading || !dirty || !!nameError || !!phoneError}
        >
          {saving
            ? <ActivityIndicator color={Colors.textInverse} size="small" />
            : <Text style={[styles.saveBtnText, (!dirty || reauthLoading || !!nameError || !!phoneError) && styles.saveBtnTextDisabled]}>Save changes</Text>
          }
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
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
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  securityPanel: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  securityPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  securityIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityCopy: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.md },
  field: { padding: Spacing.md, gap: 6 },
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
  securityTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  securityText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
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
    padding: 12, alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: Colors.disabledFill,
    borderColor: Colors.disabledFill,
  },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  saveBtnTextDisabled: { color: Colors.disabledText },
})

/**
 * Personal Information (Tailor)
 */

import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { syncUserRow } from '@/lib/syncUserRow'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export default function TailorPersonalInfoScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name ?? '')
  const [phone, setPhone] = useState(user?.user_metadata?.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [phoneError, setPhoneError] = useState('')

  const normalizedDisplayName = displayName.trim()
  const normalizedPhone = phone.trim()
  const initialDisplayName = user?.user_metadata?.display_name ?? ''
  const initialPhone = user?.user_metadata?.phone ?? ''
  const dirty = normalizedDisplayName !== initialDisplayName || normalizedPhone !== initialPhone

  function validateName(value: string) {
    const error = validateDisplayName(value)
    setNameError(error ?? '')
    return !error
  }

  function validatePhone(value: string) {
    const normalized = value.trim()
    if (!normalized) {
      setPhoneError('Phone number is required.')
      return false
    }
    if (normalized.replace(/\D/g, '').length < 7) {
      setPhoneError('Enter a valid phone number.')
      return false
    }
    setPhoneError('')
    return true
  }

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/profile')
  }

  async function save() {
    if (saving) return
    if (!validateName(displayName)) {
      Alert.alert('Invalid name', 'Please fix your display name before saving.')
      return
    }
    if (!validatePhone(phone)) {
      Alert.alert('Invalid phone number', 'Please enter a valid phone number before saving.')
      return
    }
    if (!dirty) return
    setSaving(true)
    const { error } = await supabase.auth.updateUser({
      data: { display_name: normalizedDisplayName, phone: normalizedPhone || null },
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      await syncUserRow({
        userId: user?.id,
        displayName: normalizedDisplayName,
        role: 'TAILOR',
      })
      Alert.alert('Saved', 'Your personal information has been updated.')
      goBack()
    }
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
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Profile identity</Text>
          </View>
          <Text style={styles.heroTitle}>Keep the business-facing details on your profile current.</Text>
          <Text style={styles.heroSub}>
            Your name and phone number help customers trust your profile and make coordination
            smoother once orders begin moving.
          </Text>
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideEyebrow}>Used across Drape</Text>
          <Text style={styles.guideTitle}>These details help customers trust your profile and keep live coordination smooth.</Text>
          <Text style={styles.guideCopy}>
            Your email stays tied to account identity, while your display name and phone can be updated here as your business presence evolves.
          </Text>
        </View>

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
              placeholder="Your name"
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
              placeholder="+44 7700 000000"
              placeholderTextColor={Colors.midGrey}
              keyboardType="phone-pad"
              maxLength={20}
              returnKeyType="done"
            />
            {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || saving || !!nameError || !!phoneError) && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving || !dirty || !!nameError || !!phoneError}
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
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
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
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.lg,
    padding: Spacing.lg, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.white },
})

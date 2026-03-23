import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { syncUserRow } from '@/lib/syncUserRow'
import { Button, Input } from '@/components/ui'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type Unit = 'in' | 'cm'
type GarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT'

const GARMENT_OPTIONS: Array<{ value: GarmentContext; label: string; hint: string }> = [
  { value: 'MENSWEAR', label: 'Menswear', hint: 'Suits, Agbada, kaftans, shirts, trousers' },
  { value: 'WOMENSWEAR', label: 'Womenswear', hint: 'Dresses, blouses, skirts, saree blouses' },
  { value: 'BOTH', label: 'Both', hint: 'I order menswear and womenswear' },
  { value: 'PREFER_NOT', label: 'Prefer not to say', hint: 'Tailor works from measurements only' },
]

export default function CustomerSetupScreen() {
  const router = useRouter()
  const { user } = useAuth()

  // Pre-fill display name from OAuth metadata if available
  const oauthName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? ''

  const [displayName, setDisplayName] = useState(oauthName)
  const [nameError, setNameError] = useState('')
  const [phone, setPhone] = useState(user?.user_metadata?.phone ?? '')
  const [phoneError, setPhoneError] = useState('')
  const [unit, setUnit] = useState<Unit>('in')
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    supabase
      .from('customer_profiles')
      .select('display_name, phone, unit_preference, garment_context, measurements')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return

        const measurements = (data as any).measurements ?? {}
        const nextDisplayName = (data as any).display_name ?? oauthName
        const nextPhone = (data as any).phone ?? user.user_metadata?.phone ?? ''
        const nextUnit = ((data as any).unit_preference ?? measurements.unit) as Unit | undefined
        const nextGarmentContext = ((data as any).garment_context ?? measurements.garmentContext) as GarmentContext | undefined

        if (typeof nextDisplayName === 'string' && nextDisplayName.trim().length > 0) {
          setDisplayName(nextDisplayName)
        }
        if (typeof nextPhone === 'string' && nextPhone.trim().length > 0) {
          setPhone(nextPhone)
        }
        if (nextUnit === 'in' || nextUnit === 'cm') {
          setUnit(nextUnit)
        }
        if (nextGarmentContext && ['MENSWEAR', 'WOMENSWEAR', 'BOTH', 'PREFER_NOT'].includes(nextGarmentContext)) {
          setGarmentContext(nextGarmentContext)
        }
      })
    return () => {
      cancelled = true
    }
  }, [user?.id, oauthName])

  function validateName(name: string) {
    const err = validateDisplayName(name)
    setNameError(err ?? '')
    return !err
  }

  function validatePhone(value: string) {
    const normalized = value.trim()
    if (normalized.length < 7) {
      setPhoneError('Enter a valid phone number for order updates and account recovery.')
      return false
    }
    setPhoneError('')
    return true
  }

  async function save() {
    if (saving) return
    if (!validateName(displayName)) return
    if (!validatePhone(phone)) return
    if (!garmentContext) {
      Alert.alert('Almost there', 'Please select what you typically order.')
      return
    }

    setSaveError('')
    setSaving(true)
    const now = new Date().toISOString()

    const normalizedPhone = phone.trim()

    const { error } = await supabase
      .from('customer_profiles')
      .upsert(
        {
          user_id: user?.id,
          display_name: displayName.trim(),
          phone: normalizedPhone,
          unit_preference: unit,
          garment_context: garmentContext,
          // Seed garment context + unit into measurements so it's available from the start
          measurements: {
            unit,
            garmentContext,
            fitFlags: [],
          },
          updated_at: now,
        },
        { onConflict: 'user_id' }
      )

    if (!error) {
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          display_name: displayName.trim(),
          phone: normalizedPhone,
        },
      })

      if (authError) {
        setSaving(false)
        setSaveError('We saved part of your setup, but could not finish updating your account. Please try again.')
        Alert.alert('Error', 'Could not finish saving your account details. Please try again.')
        return
      }

      await syncUserRow({
        userId: user?.id,
        displayName: displayName.trim(),
        role: 'CUSTOMER',
      })
    }

    setSaving(false)

    if (error) {
      setSaveError('We could not save your setup. Please try again.')
      Alert.alert('Error', 'Could not save your profile. Please try again.')
      return
    }

    capture('customer_profile_completed', { via: 'sso_gate', garment_context: garmentContext, unit })
    // RouteGuard will now detect the profile is complete and navigate to (customer)
    router.replace('/(customer)')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            <View style={styles.heroCard}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Finish your customer setup</Text>
              </View>
              <View style={styles.heading}>
                <Text style={styles.title}>Set up your side of Drape in one calm pass.</Text>
                <Text style={styles.subtitle}>
                  We’ll use this to personalise fit, tailor matching, and order communication from your very first booking.
                </Text>
              </View>
              <View style={styles.heroPoints}>
                <View style={styles.heroPoint}>
                  <Text style={styles.heroPointTitle}>Visible to tailors</Text>
                  <Text style={styles.heroPointCopy}>Your name and order context, so communication stays clear and professional.</Text>
                </View>
                <View style={styles.heroPoint}>
                  <Text style={styles.heroPointTitle}>Used privately</Text>
                  <Text style={styles.heroPointCopy}>Your phone and sizing preferences, so bookings and recovery flows work cleanly.</Text>
                </View>
              </View>
            </View>

            <View style={styles.formCard}>
              <View style={styles.sectionIntro}>
                <Text style={styles.sectionEyebrow}>Your profile</Text>
                <Text style={styles.sectionTitle}>Basics that shape every order.</Text>
              </View>

              <View style={styles.guideCard}>
                <Text style={styles.guideTitle}>Best starting point</Text>
                <Text style={styles.guideText}>
                  Keep this simple and accurate. You can refine measurements and preferences later, but these basics make your first booking feel much smoother.
                </Text>
              </View>

              <Input
                label="Your name"
                placeholder="How your tailor will address you"
                value={displayName}
                onChangeText={(v) => { setDisplayName(v); if (nameError) validateName(v) }}
                onBlur={() => validateName(displayName)}
                error={nameError}
                required
                autoCapitalize="words"
                hint="This is shown to tailors on your orders."
              />

              <Input
                label="Phone number"
                placeholder="For order updates and account recovery"
                value={phone}
                onChangeText={(v) => { setPhone(v); if (phoneError) validatePhone(v) }}
                onBlur={() => validatePhone(phone)}
                error={phoneError}
                required
                keyboardType="phone-pad"
                autoCapitalize="none"
              />

              <View>
                <Text style={styles.fieldLabel}>Measurement units <Text style={styles.required}>*</Text></Text>
                <View style={styles.unitRow}>
                  {(['in', 'cm'] as Unit[]).map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[styles.unitLabel, unit === u && styles.unitLabelActive]}>
                        {u === 'in' ? 'Inches (in)' : 'Centimetres (cm)'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.formCard}>
              <View style={styles.sectionIntro}>
                <Text style={styles.sectionEyebrow}>Fit context</Text>
                <Text style={styles.sectionTitle}>Help tailors understand what you usually order.</Text>
              </View>

              <Text style={styles.fieldLabel}>What do you typically order? <Text style={styles.required}>*</Text></Text>
              <Text style={styles.fieldHint}>Helps tailors understand your fitting needs.</Text>
              <View style={styles.optionList}>
                {GARMENT_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionCard, garmentContext === opt.value && styles.optionCardActive]}
                    onPress={() => setGarmentContext(opt.value)}
                  >
                    <View style={[styles.radio, garmentContext === opt.value && styles.radioActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionLabel, garmentContext === opt.value && styles.optionLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.optionHint}>{opt.hint}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.cta}>
          <View style={styles.nextCard}>
            <Text style={styles.nextEyebrow}>What happens next</Text>
            <Text style={styles.nextTitle}>You’ll land in customer home ready to discover tailors and start your first brief.</Text>
            <Text style={styles.nextCopy}>
              Measurements, saved tailors, orders, and messages all build from this setup, so we keep it short and get you moving quickly.
            </Text>
          </View>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <Button
            label="Continue to Drape"
            onPress={save}
            loading={saving}
            disabled={saving || !displayName.trim() || !phone.trim() || !!nameError || !!phoneError || !garmentContext}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  heroPoints: { gap: Spacing.md },
  heroPoint: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  heroPointTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  heroPointCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  sectionIntro: { gap: 4 },
  sectionEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, lineHeight: 24 },
  guideCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  guideTitle: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  heading: { gap: Spacing.sm, paddingTop: Spacing.lg },
  title: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 40, letterSpacing: -0.6 },
  subtitle: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },

  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  required: { color: Colors.error },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginBottom: Spacing.md, lineHeight: 18 },

  unitRow: { gap: Spacing.sm },
  unitBtn: {
    padding: Spacing.lg, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  unitBtnActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  unitLabel: { fontSize: FontSize.md, color: Colors.inkLight, fontWeight: FontWeight.medium },
  unitLabelActive: { color: Colors.needleGreen },

  optionList: { gap: Spacing.sm },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.lightGrey, ...Shadow.sm,
  },
  optionCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  radio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  radioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  optionLabelActive: { color: Colors.needleGreen },
  optionHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 18 },

  cta: {
    padding: Spacing.xl, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
    marginBottom: Spacing.md,
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
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 21,
  },
  nextCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  saveError: { fontSize: FontSize.sm, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
})

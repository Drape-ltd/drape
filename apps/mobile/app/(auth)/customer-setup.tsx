import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
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
  const [unit, setUnit] = useState<Unit>('in')
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)
  const [saving, setSaving] = useState(false)

  function validateName(name: string) {
    const err = validateDisplayName(name)
    setNameError(err ?? '')
    return !err
  }

  async function save() {
    if (!validateName(displayName)) return
    if (!garmentContext) {
      Alert.alert('Almost there', 'Please select what you typically order.')
      return
    }

    setSaving(true)
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('customer_profiles')
      .upsert(
        {
          user_id: user?.id,
          display_name: displayName.trim(),
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

    setSaving(false)

    if (error) {
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
            <View style={styles.heading}>
              <Text style={styles.title}>One last step</Text>
              <Text style={styles.subtitle}>
                Tell us a little about yourself so we can personalise your experience.
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

            <View>
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
          <Button
            label="Continue to Drape"
            onPress={save}
            loading={saving}
            disabled={!displayName.trim() || !!nameError || !garmentContext}
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

  heading: { gap: Spacing.sm, paddingTop: Spacing.lg },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
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
})

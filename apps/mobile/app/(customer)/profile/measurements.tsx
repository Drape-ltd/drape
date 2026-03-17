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
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

type Unit = 'in' | 'cm'
type FitStyle = 'Slim' | 'Regular' | 'Relaxed'
type GarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT'
type BodyShape = 'RECTANGLE' | 'BROAD_SHOULDERS' | 'FULL_HIPS' | 'DEFINED_WAIST' | 'FULL_MIDSECTION' | 'ATHLETIC' | 'PREFER_NOT'
type FitFlag =
  | 'LARGE_THIGHS' | 'BROAD_SHOULDERS' | 'SHORT_TORSO' | 'FULL_SEAT'
  | 'SLOPING_SHOULDERS' | 'LONG_ARMS' | 'FULL_BELLY' | 'LONG_RISE'
  | 'NARROW_SHOULDERS' | 'FULL_CHEST'

interface CustomMeasurement {
  id: string
  name: string
  value: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GARMENT_CONTEXT_OPTIONS: Array<{ value: GarmentContext; label: string; hint: string }> = [
  { value: 'MENSWEAR', label: 'Menswear cuts', hint: 'Suits, trousers, Agbada, kaftans, shirts, native wear' },
  { value: 'WOMENSWEAR', label: 'Womenswear cuts', hint: 'Dresses, skirts, blouses, Asobi, Lehenga, saree blouses' },
  { value: 'BOTH', label: 'Both', hint: 'I order both menswear and womenswear pieces' },
  { value: 'PREFER_NOT', label: 'Prefer not to say', hint: 'Tailor works from measurements only' },
]

const BODY_SHAPE_OPTIONS: Array<{ value: BodyShape; label: string; hint: string }> = [
  { value: 'RECTANGLE', label: 'Rectangle', hint: 'Shoulders, waist, and hips roughly equal in width' },
  { value: 'BROAD_SHOULDERS', label: 'Broad shoulders', hint: 'Shoulders noticeably wider than hips' },
  { value: 'FULL_HIPS', label: 'Full hips', hint: 'Hips noticeably wider than shoulders' },
  { value: 'DEFINED_WAIST', label: 'Defined waist', hint: 'Shoulders and hips similar, clear waist indent' },
  { value: 'FULL_MIDSECTION', label: 'Full midsection', hint: 'Width concentrated through the torso' },
  { value: 'ATHLETIC', label: 'Athletic / muscular', hint: 'Broad frame with visible muscle volume' },
  { value: 'PREFER_NOT', label: 'Prefer not to say', hint: '' },
]

const FIT_FLAG_OPTIONS: Array<{ value: FitFlag; label: string; hint: string }> = [
  { value: 'LARGE_THIGHS', label: 'Large thighs', hint: 'Extra ease through the thigh' },
  { value: 'BROAD_SHOULDERS', label: 'Broad shoulders', hint: 'Wider shoulder seam, back panel width' },
  { value: 'SHORT_TORSO', label: 'Short torso', hint: 'Shorter rise, adjusted waistband' },
  { value: 'FULL_SEAT', label: 'Full seat', hint: 'Extra fabric at back seat of trousers' },
  { value: 'SLOPING_SHOULDERS', label: 'Sloping shoulders', hint: 'Repositioned sleeve seams' },
  { value: 'LONG_ARMS', label: 'Long arms', hint: 'Extended sleeve length' },
  { value: 'FULL_BELLY', label: 'Full belly / midsection', hint: 'Extra ease through trunk' },
  { value: 'LONG_RISE', label: 'Long rise needed', hint: 'Raised back waistband' },
  { value: 'NARROW_SHOULDERS', label: 'Narrow shoulders', hint: 'Reduced armhole, brought-in seam' },
  { value: 'FULL_CHEST', label: 'Full chest', hint: 'Extra ease across chest panel' },
]

const STEP_TITLES = [
  'Body measurements',
  'Garment cuts',
  'Body shape',
  'Fit challenges',
]

const STEP_SUBTITLES = [
  'Add as many measurements as you can — the more detail, the better your tailor can quote and cut.',
  'This helps your tailor understand which cuts and shapes to use — this is a fit question, not a personal one.',
  'Pick the closest match. This helps your tailor visualise how a garment will fall before they start cutting.',
  'Where do clothes usually fit you badly off the rack? Select all that apply.',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function MeasurementsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Layer 1
  const [unit, setUnit] = useState<Unit>('in')
  const [chest, setChest] = useState('')
  const [waist, setWaist] = useState('')
  const [hips, setHips] = useState('')
  const [shoulderWidth, setShoulderWidth] = useState('')
  const [inseam, setInseam] = useState('')
  const [sleeveLength, setSleeveLength] = useState('')
  const [neckCircumference, setNeckCircumference] = useState('')
  const [height, setHeight] = useState('')
  const [fitStyle, setFitStyle] = useState<FitStyle | null>(null)
  const [customMeasurements, setCustomMeasurements] = useState<CustomMeasurement[]>([])

  // Layer 2
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)

  // Layer 3
  const [bodyShape, setBodyShape] = useState<BodyShape | null>(null)

  // Layer 4
  const [fitFlags, setFitFlags] = useState<FitFlag[]>([])
  const [bodyNote, setBodyNote] = useState('')
  const [bodyNoteError, setBodyNoteError] = useState('')

  function canProceedStep(): boolean {
    switch (step) {
      case 0: return !!chest.trim() && !!waist.trim() && !!fitStyle
      case 1: return !!garmentContext
      case 2: return !!bodyShape
      case 3: return true
      default: return true
    }
  }

  function stepBlockedMessage(): string {
    switch (step) {
      case 0: return 'Please enter your chest, waist, and select a fit style to continue.'
      case 1: return 'Please select the garment cut style that applies to you.'
      case 2: return 'Please select the body shape that closest matches yours.'
      default: return ''
    }
  }

  function addCustomMeasurement() {
    setCustomMeasurements((prev) => [
      ...prev,
      { id: Date.now().toString(), name: '', value: '' },
    ])
  }

  function updateCustomMeasurement(id: string, field: 'name' | 'value', text: string) {
    setCustomMeasurements((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: text } : m))
    )
  }

  function removeCustomMeasurement(id: string) {
    setCustomMeasurements((prev) => prev.filter((m) => m.id !== id))
  }

  function toggleFlag(flag: FitFlag) {
    setFitFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    )
  }

  function validateBodyNote(text: string) {
    const result = filterContactInfo(text)
    if (result.blocked) {
      setBodyNoteError("Contact details can't be included in this note.")
      return false
    }
    setBodyNoteError('')
    return true
  }

  async function save() {
    if (!validateBodyNote(bodyNote)) return

    setSaving(true)

    const customExtras: Record<string, number | null> = {}
    for (const m of customMeasurements) {
      if (m.name.trim()) {
        customExtras[m.name.trim()] = m.value ? parseFloat(m.value) : null
      }
    }

    const payload = {
      chest: chest ? parseFloat(chest) : null,
      waist: waist ? parseFloat(waist) : null,
      hips: hips ? parseFloat(hips) : null,
      shoulderWidth: shoulderWidth ? parseFloat(shoulderWidth) : null,
      inseam: inseam ? parseFloat(inseam) : null,
      sleeveLength: sleeveLength ? parseFloat(sleeveLength) : null,
      neckCircumference: neckCircumference ? parseFloat(neckCircumference) : null,
      height: height ? parseFloat(height) : null,
      unit,
      fitStyle,
      garmentContext,
      bodyShape,
      fitFlags,
      bodyNote: bodyNote.trim() || null,
      ...customExtras,
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('customer_profiles')
      .upsert(
        { user_id: user?.id, measurements: payload, updated_at: now },
        { onConflict: 'user_id' },
      )

    setSaving(false)

    if (error) {
      Alert.alert('Error', 'Could not save your measurements. Please try again.')
    } else {
      capture('measurements_saved', { unit })
      router.back()
    }
  }

  function next() {
    if (!canProceedStep()) {
      Alert.alert('Required', stepBlockedMessage())
      return
    }
    if (step < 3) setStep(step + 1)
    else save()
  }

  function back() {
    if (step > 0) setStep(step - 1)
    else router.back()
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepIndicator}>Step {step + 1} of 4</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.progressSegment, i <= step && styles.progressSegmentDone]} />
          ))}
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            <View style={styles.stepHeading}>
              <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
              <Text style={styles.stepSub}>{STEP_SUBTITLES[step]}</Text>
            </View>

            {/* ── Step 0: Body measurements ── */}
            {step === 0 && (
              <View style={styles.fields}>
                {/* Unit toggle */}
                <View style={styles.unitToggle}>
                  {(['in', 'cm'] as Unit[]).map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[styles.unitLabel, unit === u && styles.unitLabelActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.measureGrid}>
                  {[
                    { label: 'Chest', value: chest, set: setChest },
                    { label: 'Waist', value: waist, set: setWaist },
                    { label: 'Hips', value: hips, set: setHips },
                    { label: 'Shoulder width', value: shoulderWidth, set: setShoulderWidth },
                    { label: 'Inseam', value: inseam, set: setInseam },
                    { label: 'Sleeve length', value: sleeveLength, set: setSleeveLength },
                    { label: 'Neck', value: neckCircumference, set: setNeckCircumference },
                    { label: 'Height', value: height, set: setHeight },
                  ].map(({ label, value, set }) => (
                    <View key={label} style={styles.measureField}>
                      <Input
                        label={label}
                        placeholder={`0 ${unit}`}
                        value={value}
                        onChangeText={set}
                        keyboardType="decimal-pad"
                        containerStyle={styles.measureInput}
                      />
                    </View>
                  ))}
                </View>

                <View style={styles.fitStyleSection}>
                  <Text style={styles.fieldLabel}>Fit style</Text>
                  <View style={styles.fitStyleRow}>
                    {(['Slim', 'Regular', 'Relaxed'] as FitStyle[]).map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.fitStyleBtn, fitStyle === s && styles.fitStyleBtnActive]}
                        onPress={() => setFitStyle(s)}
                      >
                        <Text style={[styles.fitStyleLabel, fitStyle === s && styles.fitStyleLabelActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Custom measurements */}
                <View style={styles.customSection}>
                  <Text style={styles.fieldLabel}>Additional measurements</Text>
                  <Text style={styles.customHint}>Add any measurement your tailor may need — ankle, wrist, rise, etc.</Text>

                  {customMeasurements.map((m) => (
                    <View key={m.id} style={styles.customRow}>
                      <View style={styles.customNameField}>
                        <Input
                          label=""
                          placeholder="e.g. Ankle"
                          value={m.name}
                          onChangeText={(t) => updateCustomMeasurement(m.id, 'name', t)}
                          containerStyle={styles.measureInput}
                        />
                      </View>
                      <View style={styles.customValueField}>
                        <Input
                          label=""
                          placeholder={`0 ${unit}`}
                          value={m.value}
                          onChangeText={(t) => updateCustomMeasurement(m.id, 'value', t)}
                          keyboardType="decimal-pad"
                          containerStyle={styles.measureInput}
                        />
                      </View>
                      <TouchableOpacity style={styles.customRemoveBtn} onPress={() => removeCustomMeasurement(m.id)}>
                        <Text style={styles.customRemoveText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomMeasurement}>
                    <Text style={styles.addCustomText}>+ Add measurement</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Step 1: Garment context ── */}
            {step === 1 && (
              <View style={styles.optionList}>
                {GARMENT_CONTEXT_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionCard, garmentContext === opt.value && styles.optionCardActive]}
                    onPress={() => setGarmentContext(opt.value)}
                  >
                    <View style={[styles.optionRadio, garmentContext === opt.value && styles.optionRadioActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionLabel, garmentContext === opt.value && styles.optionLabelActive]}>
                        {opt.label}
                      </Text>
                      {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Step 2: Body shape ── */}
            {step === 2 && (
              <View style={styles.optionList}>
                {BODY_SHAPE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionCard, bodyShape === opt.value && styles.optionCardActive]}
                    onPress={() => setBodyShape(opt.value)}
                  >
                    <View style={[styles.optionRadio, bodyShape === opt.value && styles.optionRadioActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionLabel, bodyShape === opt.value && styles.optionLabelActive]}>
                        {opt.label}
                      </Text>
                      {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Step 3: Fit flags + body note ── */}
            {step === 3 && (
              <View style={styles.fields}>
                <View style={styles.flagGrid}>
                  {FIT_FLAG_OPTIONS.map((opt) => {
                    const active = fitFlags.includes(opt.value)
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.flagCard, active && styles.flagCardActive]}
                        onPress={() => toggleFlag(opt.value)}
                      >
                        <View style={[styles.flagCheck, active && styles.flagCheckActive]}>
                          {active && <Text style={styles.flagCheckMark}>✓</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.flagLabel, active && styles.flagLabelActive]}>{opt.label}</Text>
                          <Text style={styles.flagHint}>{opt.hint}</Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <Input
                  label="Anything else your tailor needs to know?"
                  placeholder='e.g. "My family has naturally large thighs — every tailor needs to know this"'
                  value={bodyNote}
                  onChangeText={(v) => {
                    setBodyNote(v)
                    if (bodyNoteError) validateBodyNote(v)
                  }}
                  onBlur={() => validateBodyNote(bodyNote)}
                  error={bodyNoteError}
                  hint="Max 150 characters. No contact details."
                  maxLength={150}
                  multiline
                  numberOfLines={3}
                  filterContact
                />
              </View>
            )}
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.cta}>
          <Button
            label={step < 3 ? 'Continue' : 'Save measurements'}
            onPress={next}
            loading={saving}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  stepIndicator: { fontSize: FontSize.sm, color: Colors.midGrey },
  headerSpacer: { width: 60 },

  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegmentDone: { backgroundColor: Colors.needleGreen },

  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  stepHeading: { gap: Spacing.sm },
  stepTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  stepSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Layer 1 — measurements
  fields: { gap: Spacing.xl },
  unitToggle: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full, padding: 3, alignSelf: 'flex-start',
  },
  unitBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xl, borderRadius: Radius.full },
  unitBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  unitLabel: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },
  unitLabelActive: { color: Colors.ink },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  measureField: { width: '47%' },
  measureInput: { marginBottom: 0 },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },

  fitStyleSection: { gap: Spacing.sm },
  fitStyleRow: { flexDirection: 'row', gap: Spacing.sm },
  fitStyleBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white, alignItems: 'center',
  },
  fitStyleBtnActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  fitStyleLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  fitStyleLabelActive: { color: Colors.needleGreen },

  // Custom measurements
  customSection: { gap: Spacing.sm },
  customHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: -4 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  customNameField: { flex: 2 },
  customValueField: { flex: 1 },
  customRemoveBtn: {
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  customRemoveText: { fontSize: FontSize.sm, color: Colors.midGrey },
  addCustomBtn: {
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.needleGreen,
    borderStyle: 'dashed', alignItems: 'center', backgroundColor: Colors.white,
  },
  addCustomText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Layers 2 + 3 — option cards
  optionList: { gap: Spacing.md },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.lightGrey, ...Shadow.sm,
  },
  optionCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  optionRadio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  optionRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  optionLabelActive: { color: Colors.needleGreen },
  optionHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 18 },

  // Layer 4 — fit flags
  flagGrid: { gap: Spacing.sm },
  flagCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  flagCardActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRustLight },
  flagCheck: {
    width: 22, height: 22, borderRadius: 4, marginTop: 1,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  flagCheckActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRust },
  flagCheckMark: { color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold },
  flagLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  flagLabelActive: { color: Colors.kanteRust },
  flagHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // CTA
  cta: {
    padding: Spacing.xl, gap: Spacing.sm,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
})

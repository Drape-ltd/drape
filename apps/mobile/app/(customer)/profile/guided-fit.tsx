import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { capture } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { appendToHistory, goBackOrReturnToIfNeeded, pickSafeReturnTo } from '@/lib/navigation'
import {
  BODY_PROFILE_FLAG_LABELS,
  buildMeasurementConfidenceByField,
  buildOrderFitProfile,
  captureMethodForMeasurementSource,
  COVERAGE_PREFERENCE_LABELS,
  deriveOverallMeasurementConfidence,
  FABRIC_STRETCH_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_INTENT_LABELS,
  isMeasurementSource,
  MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS,
  SYMMETRY_FLAG_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  type BodyProfileFlag,
  type CoveragePreference,
  type FabricStretch,
  type FitIntent,
  type MeasurementScanCaptureMethod,
  type MeasurementScanStatus,
  type WearDaySupport,
} from '@/lib/order-support'
import { supabase } from '@/lib/supabase'
import { Button, Input } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const FIT_INTENT_OPTIONS: FitIntent[] = ['FITTED', 'BALANCED', 'RELAXED']
const FABRIC_STRETCH_OPTIONS: FabricStretch[] = ['NO_STRETCH', 'LOW_STRETCH', 'HIGH_STRETCH']
const WEAR_DAY_SUPPORT_OPTIONS: WearDaySupport[] = [
  'NONE',
  'LIGHT_SUPPORT',
  'STRUCTURED_SUPPORT',
  'SHAPEWEAR',
]
const COVERAGE_OPTIONS: CoveragePreference[] = ['STANDARD', 'MODEST', 'FULL_COVERAGE']
const BODY_FLAG_OPTIONS: BodyProfileFlag[] = [
  'FULLER_BUST',
  'FULLER_HIPS',
  'LONG_TORSO',
  'SHORT_TORSO',
  'ROUNDED_SHOULDERS',
  'FORWARD_POSTURE',
]
const SYMMETRY_FLAG_OPTIONS = [
  'LEFT_SHOULDER_LOWER',
  'RIGHT_SHOULDER_LOWER',
  'HIP_IMBALANCE',
  'ARM_LENGTH_DIFFERENCE',
  'HEEL_HEIGHT_AFFECTS_DRAPE',
] as const

type SymmetryFlag = (typeof SYMMETRY_FLAG_OPTIONS)[number]
type SelectorKey =
  | 'fitIntent'
  | 'fabricStretch'
  | 'wearDaySupport'
  | 'coveragePreference'
  | 'bodyFlags'
  | 'symmetryFlags'

type SelectorOption = {
  label: string
  value: string
}

function hasCompleteMeasurementProfile(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hasCore = value.chest != null && value.waist != null && typeof value.fitStyle === 'string'
  const hasContext = typeof value.garmentContext === 'string' && value.garmentContext.length > 0
  const bodyShapes = Array.isArray(value.bodyShape)
    ? value.bodyShape
    : value.bodyShape
      ? [value.bodyShape]
      : []
  return hasCore && hasContext && bodyShapes.length > 0
}

function safeNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function labelsForSelected<T extends string>(
  selected: T[],
  labels: Record<T, string>,
  fallback = 'None selected'
) {
  if (selected.length === 0) return fallback
  if (selected.length <= 2) return selected.map((item) => labels[item]).join(', ')
  return `${selected.slice(0, 2).map((item) => labels[item]).join(', ')} +${selected.length - 2}`
}

function isMeasurementScansUnavailable(
  error:
    | { code?: string | null; message?: string | null; details?: string | null }
    | null
    | undefined
) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  return (
    error?.code === 'PGRST205' ||
    message.includes('measurement_scans') ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  )
}
export default function GuidedFitScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { returnTo, historyChain } = useLocalSearchParams<{ returnTo?: string; historyChain?: string }>()
  const { user } = useAuth()
  const pickedReturnTo = pickSafeReturnTo(historyChain, returnTo)
  const safeReturnTo =
    typeof pickedReturnTo === 'string' &&
    pickedReturnTo.length > 0 &&
    pickedReturnTo !== '/(customer)/profile/guided-fit'
      ? pickedReturnTo
      : null

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [measurements, setMeasurements] = useState<Record<string, unknown> | null>(null)
  const [fetchError, setFetchError] = useState(false)

  const [fitIntent, setFitIntent] = useState<FitIntent>('BALANCED')
  const [fabricStretch, setFabricStretch] = useState<FabricStretch>('NO_STRETCH')
  const [wearDaySupport, setWearDaySupport] = useState<WearDaySupport>('NONE')
  const [coveragePreference, setCoveragePreference] = useState<CoveragePreference>('STANDARD')
  const [heelHeight, setHeelHeight] = useState('')
  const [styleEaseNotes, setStyleEaseNotes] = useState('')
  const [postureNote, setPostureNote] = useState('')
  const [asymmetryNote, setAsymmetryNote] = useState('')
  const [bodyFlags, setBodyFlags] = useState<BodyProfileFlag[]>([])
  const [symmetryFlags, setSymmetryFlags] = useState<SymmetryFlag[]>([])
  const [noteError, setNoteError] = useState('')
  const [activeSelector, setActiveSelector] = useState<SelectorKey | null>(null)

  const fitPreview = useMemo<{
    captureMethod: MeasurementScanCaptureMethod
    confidenceByField: ReturnType<typeof buildMeasurementConfidenceByField>
    confidenceOverall: ReturnType<typeof deriveOverallMeasurementConfidence>
    requiresTailorReview: boolean
  } | null>(() => {
    if (!measurements) return null
    const source = isMeasurementSource(measurements.measurementSource)
      ? measurements.measurementSource
      : 'SELF_GUIDED'
    const confidenceByField = buildMeasurementConfidenceByField(measurements, source)
    const confidenceOverall = deriveOverallMeasurementConfidence(measurements, source)
    const requiresTailorReview = confidenceOverall === 'LOW' || symmetryFlags.length > 0
    return {
      captureMethod: captureMethodForMeasurementSource(source),
      confidenceByField,
      confidenceOverall,
      requiresTailorReview,
    }
  }, [measurements, symmetryFlags])

  const selectorConfig = useMemo(() => {
    if (!activeSelector) return null

    if (activeSelector === 'fitIntent') {
      return {
        title: 'Fit direction',
        description: 'Choose the silhouette your tailor should bias toward.',
        selectedValues: [fitIntent],
        options: FIT_INTENT_OPTIONS.map((value) => ({
          value,
          label: FIT_INTENT_LABELS[value],
        })),
        multiple: false,
      }
    }

    if (activeSelector === 'fabricStretch') {
      return {
        title: 'Fabric stretch',
        description: 'Use the fabric behavior you expect for this garment.',
        selectedValues: [fabricStretch],
        options: FABRIC_STRETCH_OPTIONS.map((value) => ({
          value,
          label: FABRIC_STRETCH_LABELS[value],
        })),
        multiple: false,
      }
    }

    if (activeSelector === 'wearDaySupport') {
      return {
        title: 'Wear-day support',
        description: 'Tell the tailor what structure or foundation garments affect the fit.',
        selectedValues: [wearDaySupport],
        options: WEAR_DAY_SUPPORT_OPTIONS.map((value) => ({
          value,
          label: WEAR_DAY_SUPPORT_LABELS[value],
        })),
        multiple: false,
      }
    }

    if (activeSelector === 'coveragePreference') {
      return {
        title: 'Coverage preference',
        description: 'Set the baseline coverage expectation before styling notes.',
        selectedValues: [coveragePreference],
        options: COVERAGE_OPTIONS.map((value) => ({
          value,
          label: COVERAGE_PREFERENCE_LABELS[value],
        })),
        multiple: false,
      }
    }

    if (activeSelector === 'bodyFlags') {
      return {
        title: 'Body profile flags',
        description: 'Optional context that helps prevent common fit misses.',
        selectedValues: bodyFlags,
        options: BODY_FLAG_OPTIONS.map((value) => ({
          value,
          label: BODY_PROFILE_FLAG_LABELS[value],
        })),
        multiple: true,
      }
    }

    return {
      title: 'Symmetry flags',
      description: 'Optional asymmetry notes that should trigger tailor review before cutting.',
      selectedValues: symmetryFlags,
      options: SYMMETRY_FLAG_OPTIONS.map((value) => ({
        value,
        label: SYMMETRY_FLAG_LABELS[value],
      })),
      multiple: true,
    }
  }, [
    activeSelector,
    bodyFlags,
    coveragePreference,
    fabricStretch,
    fitIntent,
    symmetryFlags,
    wearDaySupport,
  ])

  useEffect(() => {
    async function load() {
      if (!user?.id) {
        setLoading(false)
        return
      }

      setLoading(true)
      setFetchError(false)
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('measurements')
        .eq('user_id', user.id)
        .maybeSingle()

      setLoading(false)

      if (error) {
        setFetchError(true)
        return
      }

      const nextMeasurements =
        data?.measurements &&
        typeof data.measurements === 'object' &&
        !Array.isArray(data.measurements)
          ? (data.measurements as Record<string, unknown>)
          : null

      setMeasurements(nextMeasurements)

      const existingFitProfile = buildOrderFitProfile(nextMeasurements)
      if (existingFitProfile) {
        if (
          existingFitProfile.fitIntent === 'FITTED' ||
          existingFitProfile.fitIntent === 'BALANCED' ||
          existingFitProfile.fitIntent === 'RELAXED'
        ) {
          setFitIntent(existingFitProfile.fitIntent)
        }
        if (
          existingFitProfile.fabricStretch === 'NO_STRETCH' ||
          existingFitProfile.fabricStretch === 'LOW_STRETCH' ||
          existingFitProfile.fabricStretch === 'HIGH_STRETCH'
        ) {
          setFabricStretch(existingFitProfile.fabricStretch)
        }
        if (
          existingFitProfile.wearDaySupport === 'NONE' ||
          existingFitProfile.wearDaySupport === 'LIGHT_SUPPORT' ||
          existingFitProfile.wearDaySupport === 'STRUCTURED_SUPPORT' ||
          existingFitProfile.wearDaySupport === 'SHAPEWEAR'
        ) {
          setWearDaySupport(existingFitProfile.wearDaySupport)
        }
        if (
          existingFitProfile.coveragePreference === 'STANDARD' ||
          existingFitProfile.coveragePreference === 'MODEST' ||
          existingFitProfile.coveragePreference === 'FULL_COVERAGE'
        ) {
          setCoveragePreference(existingFitProfile.coveragePreference)
        }
        if (typeof existingFitProfile.heelHeightCm === 'number') {
          setHeelHeight(String(existingFitProfile.heelHeightCm))
        }
        if (typeof existingFitProfile.styleEaseNotes === 'string')
          setStyleEaseNotes(existingFitProfile.styleEaseNotes)
        if (typeof existingFitProfile.postureNote === 'string')
          setPostureNote(existingFitProfile.postureNote)
        if (typeof existingFitProfile.asymmetryNote === 'string')
          setAsymmetryNote(existingFitProfile.asymmetryNote)
        if (Array.isArray(existingFitProfile.bodyFlags))
          setBodyFlags(
            existingFitProfile.bodyFlags.filter((value): value is BodyProfileFlag =>
              BODY_FLAG_OPTIONS.includes(value as BodyProfileFlag)
            )
          )
        if (Array.isArray(existingFitProfile.symmetryFlags))
          setSymmetryFlags(
            existingFitProfile.symmetryFlags.filter((value): value is SymmetryFlag =>
              SYMMETRY_FLAG_OPTIONS.includes(value as SymmetryFlag)
            )
          )
      }
    }

    void load()
  }, [user?.id])

  function goBack() {
    goBackOrReturnToIfNeeded(router, navigation, safeReturnTo, '/(customer)/profile')
  }

  function finishAfterSave() {
    goBackOrReturnToIfNeeded(router, navigation, safeReturnTo, '/(customer)/profile')
  }

  function validateNotes() {
    const noteFields = [styleEaseNotes, postureNote, asymmetryNote]
    const blocked = noteFields.some((value) => filterContactInfo(value).blocked)
    if (blocked) {
      setNoteError("Contact details can't be included in fit notes.")
      return false
    }
    setNoteError('')
    return true
  }

  function toggleFlag<T extends string>(value: T, selected: T[], setSelected: (next: T[]) => void) {
    setSelected(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
    )
  }

  function handleSelectorOption(value: string) {
    if (!activeSelector) return

    if (activeSelector === 'fitIntent') {
      setFitIntent(value as FitIntent)
      setActiveSelector(null)
      return
    }
    if (activeSelector === 'fabricStretch') {
      setFabricStretch(value as FabricStretch)
      setActiveSelector(null)
      return
    }
    if (activeSelector === 'wearDaySupport') {
      setWearDaySupport(value as WearDaySupport)
      setActiveSelector(null)
      return
    }
    if (activeSelector === 'coveragePreference') {
      setCoveragePreference(value as CoveragePreference)
      setActiveSelector(null)
      return
    }
    if (activeSelector === 'bodyFlags') {
      toggleFlag(value as BodyProfileFlag, bodyFlags, setBodyFlags)
      return
    }
    toggleFlag(value as SymmetryFlag, symmetryFlags, setSymmetryFlags)
  }

  async function save() {
    if (saving || !user?.id || !measurements) return
    if (!hasCompleteMeasurementProfile(measurements)) {
      Alert.alert(
        'Complete measurements first',
        'Finish your measurement profile first so fit notes have a trustworthy baseline.'
      )
      return
    }
    if (!validateNotes()) return

    setSaving(true)

    const measurementSource = isMeasurementSource(measurements.measurementSource)
      ? measurements.measurementSource
      : 'SELF_GUIDED'
    const captureMethod: MeasurementScanCaptureMethod =
      captureMethodForMeasurementSource(measurementSource)
    const confidenceByField = buildMeasurementConfidenceByField(measurements, measurementSource)
    const confidenceOverall = deriveOverallMeasurementConfidence(measurements, measurementSource)
    const requiresTailorReview = confidenceOverall === 'LOW' || symmetryFlags.length > 0
    const status: MeasurementScanStatus = requiresTailorReview
      ? 'TAILOR_REVIEW_REQUIRED'
      : 'CAPTURED'
    const now = new Date().toISOString()
    const sourceDevice = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      app: 'mobile-guided-fit-v1',
    }

    const fitProfile = {
      measurementScanId: null,
      captureMethod,
      captureMethodLabel: MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[captureMethod],
      captureVersion: 'guided-fit-v1',
      status,
      capturedAt: now,
      confidenceOverall,
      confidenceByField,
      fitIntent,
      heelHeightCm: safeNumber(heelHeight),
      fabricStretch,
      wearDaySupport,
      postureNote: postureNote.trim() || null,
      asymmetryNote: asymmetryNote.trim() || null,
      coveragePreference,
      styleEaseNotes: styleEaseNotes.trim() || null,
      bodyFlags,
      symmetryFlags,
      requiresTailorReview,
      tailorMeasurementOverride: false,
      tailorMeasurementOverrideReason: null,
      tailorMeasurementOverrideAt: null,
    }

    const { data: inserted, error: scanError } = await supabase
      .from('measurement_scans')
      .insert({
        user_id: user.id,
        capture_method: captureMethod,
        capture_version: 'guided-fit-v1',
        status,
        confidence_overall: confidenceOverall,
        confidence_by_field: confidenceByField,
        measurement_snapshot: measurements,
        garment_preferences: fitProfile,
        body_flags: bodyFlags,
        symmetry_flags: symmetryFlags,
        requires_tailor_review: requiresTailorReview,
        source_device: sourceDevice,
      })
      .select('id')
      .single()

    if (scanError || !inserted?.id) {
      setSaving(false)
      Alert.alert(
        'Could not save fit notes',
        isLikelyConnectivityIssue(scanError)
          ? 'Connection looks weak. Retry when the signal improves.'
          : isMeasurementScansUnavailable(scanError)
            ? 'Fit notes are not ready in this build yet. Your measurements are still safe.'
            : 'Please try again in a moment.'
      )
      return
    }

    const nextMeasurements = {
      ...measurements,
      captureMethod,
      captureVersion: 'guided-fit-v1',
      capturedAt: now,
      confidenceOverall,
      confidenceByField,
      sourceDevice,
      latestMeasurementScanId: inserted.id,
      latestMeasurementScanStatus: status,
      bodyFlags,
      symmetryFlags,
      requiresTailorReview,
      latestFitProfile: {
        ...fitProfile,
        measurementScanId: inserted.id,
      },
    }

    const { error: updateError } = await supabase.from('customer_profiles').upsert(
      {
        user_id: user.id,
        measurements: nextMeasurements,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )

    setSaving(false)

    if (updateError) {
      Alert.alert(
        'Could not finish fit notes',
        isLikelyConnectivityIssue(updateError)
          ? 'Connection looks weak. The session saved, but your fit profile summary did not finish updating yet.'
          : 'The session saved, but the profile summary did not finish updating. Please try again.'
      )
      return
    }

    capture('guided_fit_saved', {
      confidence_overall: confidenceOverall,
      requires_tailor_review: requiresTailorReview,
      has_symmetry_flags: symmetryFlags.length > 0,
    })

    Alert.alert(
      requiresTailorReview ? 'Saved with tailor review' : 'Fit notes saved',
      requiresTailorReview
        ? 'Your fit notes are saved. A tailor review will still be expected before cutting starts.'
        : 'Your fit notes are saved and can carry into your next order.',
      [{ text: 'Continue', onPress: finishAfterSave }]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centerState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Fit notes</Text>
            <Text style={styles.stateTitle}>Loading your measurements…</Text>
            <Text style={styles.stateHint}>
              We’re pulling your saved measurements so these notes stay grounded in the same
              profile your tailor will see.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centerState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Fit notes</Text>
            <Text style={styles.stateTitle}>Couldn't load your fit baseline.</Text>
            <Text style={styles.stateHint}>
              Please try again in a moment, or update your measurements first if this keeps
              happening.
            </Text>
            <Button
              label="Try again"
              onPress={() => router.replace('/(customer)/profile/guided-fit')}
            />
            <Button label="Back" variant="secondary" onPress={goBack} />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!hasCompleteMeasurementProfile(measurements)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centerState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Fit notes</Text>
            <Text style={styles.stateTitle}>Complete measurements first.</Text>
            <Text style={styles.stateHint}>
              Fit notes are optional. Add them after your core measurements are saved, or when an
              order needs extra garment context.
            </Text>
            <Button
              label="Open measurements"
              onPress={() =>
	                router.replace({
	                  pathname: '/(customer)/profile/measurements',
	                  params: {
	                    returnTo: '/(customer)/profile/guided-fit',
	                    historyChain: appendToHistory(historyChain ?? safeReturnTo ?? undefined, '/(customer)/profile/guided-fit'),
	                  },
	                })
              }
            />
            <Button label="Back" variant="secondary" onPress={goBack} />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Fit notes</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>Optional context</Text>
            <Text style={styles.heroTitle}>Add fit notes when the garment needs it.</Text>
            <Text style={styles.heroText}>
              Measurements stay first. These notes give your tailor fit direction, stretch context,
              posture notes, and symmetry cues when an order needs more than numbers.
            </Text>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Fit direction</Text>
            <Text style={styles.sectionHint}>
              Choose the overall silhouette you want the tailor to bias toward.
            </Text>
            <SelectSummaryRow
              label="Current fit direction"
              value={FIT_INTENT_LABELS[fitIntent]}
              onPress={() => setActiveSelector('fitIntent')}
            />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Fabric and support</Text>
            <Text style={styles.sectionHint}>
              These are the context clues that change drape, contour, and ease.
            </Text>
            <SelectSummaryRow
              label="Fabric stretch"
              value={FABRIC_STRETCH_LABELS[fabricStretch]}
              onPress={() => setActiveSelector('fabricStretch')}
            />
            <SelectSummaryRow
              label="Wear-day support"
              value={WEAR_DAY_SUPPORT_LABELS[wearDaySupport]}
              onPress={() => setActiveSelector('wearDaySupport')}
            />

            <Input
              label="Heel height in cm (optional)"
              placeholder="e.g. 7"
              value={heelHeight}
              onChangeText={setHeelHeight}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Coverage and styling</Text>
            <Text style={styles.sectionHint}>
              These notes travel with your next order so the tailor can quote and cut with fewer
              assumptions.
            </Text>
            <SelectSummaryRow
              label="Coverage preference"
              value={COVERAGE_PREFERENCE_LABELS[coveragePreference]}
              onPress={() => setActiveSelector('coveragePreference')}
            />

            <Input
              label="Style ease notes"
              placeholder="e.g. I like a softly structured buba, but not oversized through the shoulders."
              value={styleEaseNotes}
              onChangeText={(value) => {
                setStyleEaseNotes(value)
                if (noteError) validateNotes()
              }}
              onBlur={validateNotes}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={240}
              filterContact
            />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Body and symmetry cues</Text>
            <Text style={styles.sectionHint}>
              These are optional, but they’re the kind of details that prevent a “looks good on
              paper” fit from missing on the body.
            </Text>
            <SelectSummaryRow
              label="Body profile flags"
              value={labelsForSelected(bodyFlags, BODY_PROFILE_FLAG_LABELS)}
              onPress={() => setActiveSelector('bodyFlags')}
            />
            <SelectSummaryRow
              label="Symmetry flags"
              value={labelsForSelected(symmetryFlags, SYMMETRY_FLAG_LABELS)}
              onPress={() => setActiveSelector('symmetryFlags')}
            />

            <Input
              label="Posture note"
              placeholder="e.g. I carry tension through my shoulders and prefer a little extra room across the back."
              value={postureNote}
              onChangeText={(value) => {
                setPostureNote(value)
                if (noteError) validateNotes()
              }}
              onBlur={validateNotes}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={240}
              filterContact
            />

            <Input
              label="Asymmetry note"
              placeholder="e.g. One hip sits slightly higher, so skirts usually dip on one side."
              value={asymmetryNote}
              onChangeText={(value) => {
                setAsymmetryNote(value)
                if (noteError) validateNotes()
              }}
              onBlur={validateNotes}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={240}
              filterContact
            />
          </View>

          {fitPreview ? (
            <View
              style={[styles.sectionCard, fitPreview.requiresTailorReview && styles.warningCard]}
            >
              <Text style={styles.sectionTitle}>Pre-cutting preview</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Confidence</Text>
                <Text style={styles.summaryValue}>
                  {FIT_CONFIDENCE_LABELS[fitPreview.confidenceOverall]}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Capture method</Text>
                <Text style={styles.summaryValue}>
                  {MEASUREMENT_SCAN_CAPTURE_METHOD_LABELS[fitPreview.captureMethod]}
                </Text>
              </View>
              <Text style={styles.summaryHint}>
                {fitPreview.requiresTailorReview
                  ? 'These notes will carry a tailor-review checkpoint before cutting starts.'
                  : 'These notes can attach to your next order as fit context.'}
              </Text>
            </View>
          ) : null}

          <Button
            label="Save fit notes"
            onPress={save}
            loading={saving}
            disabled={saving}
          />
        </ScrollView>

        <OptionSelectorSheet
          visible={!!selectorConfig}
          title={selectorConfig?.title ?? ''}
          description={selectorConfig?.description ?? ''}
          options={selectorConfig?.options ?? []}
          selectedValues={selectorConfig?.selectedValues ?? []}
          multiple={selectorConfig?.multiple ?? false}
          onSelect={handleSelectorOption}
          onClose={() => setActiveSelector(null)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SelectSummaryRow({
  label,
  value,
  onPress,
}: {
  label: string
  value: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={styles.selectRow}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.selectTextBlock}>
        <Text style={styles.selectLabel}>{label}</Text>
        <Text style={styles.selectValue}>{value}</Text>
      </View>
      <Text style={styles.selectChevron}>›</Text>
    </TouchableOpacity>
  )
}

function OptionSelectorSheet({
  visible,
  title,
  description,
  options,
  selectedValues,
  multiple,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  description: string
  options: SelectorOption[]
  selectedValues: string[]
  multiple: boolean
  onSelect: (value: string) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Text style={styles.sheetDescription}>{description}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.sheetClose} accessibilityRole="button">
              <Text style={styles.sheetCloseText}>{multiple ? 'Done' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.optionList}>
            {options.map((option) => {
              const selected = selectedValues.includes(option.value)
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.optionRow, selected && styles.optionRowSelected]}
                  onPress={() => onSelect(option.value)}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {option.label}
                  </Text>
                  <View style={[styles.optionCheck, selected && styles.optionCheckSelected]}>
                    {selected ? <Text style={styles.optionCheckText}>✓</Text> : null}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxl },
  centerState: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  stateHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: {
    color: Colors.needleGreen,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
  headerTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    fontFamily: Fonts.display,
  },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.md,
  },
  heroEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: FontWeight.semibold,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  heroText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.md,
  },
  warningCard: {
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    fontFamily: Fonts.display,
  },
  sectionHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 19,
  },
  selectRow: {
    minHeight: 62,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  selectTextBlock: { flex: 1, gap: 3 },
  selectLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  selectValue: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  selectChevron: {
    fontSize: 30,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    marginBottom: Spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  sheetTitle: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  sheetDescription: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
    marginTop: 4,
  },
  sheetClose: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  sheetCloseText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  optionList: { gap: Spacing.xs },
  optionRow: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  optionRowSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  optionLabel: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  optionLabelSelected: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  optionCheck: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  optionCheckSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  optionCheckText: {
    color: Colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryLabel: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
  },
  summaryValue: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  summaryHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
})

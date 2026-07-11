import { useCallback, useState, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { goBackOrReturnToIfNeeded, sanitizeReturnTo } from '@/lib/navigation'
import {
  isMeasurementSource,
  isMeasurementMetadataKey,
  deriveMeasurementFitConfidence,
  MEASUREMENT_SOURCE_LABELS,
  type MeasurementSource,
} from '@/lib/order-support'
import { Button, ChoiceSheet, DisclosureSection, Input, type ChoiceSheetOption } from '@/components/ui'
import { DRAPE_VISION_ROUTE } from '@/constants/drapeVision'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { buildMeasurementProfileStoragePayload } from '@drape/shared/measurement-profile'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

// ─── Types ────────────────────────────────────────────────────────────────────

type Unit = 'in' | 'cm'
type FitStyle = 'Slim' | 'Regular' | 'Relaxed'
type GarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT_TO_SAY'
type BodyShape =
  | 'RECTANGLE'
  | 'BROAD_SHOULDERS'
  | 'FULL_HIPS'
  | 'DEFINED_WAIST'
  | 'FULL_MIDSECTION'
  | 'ATHLETIC'
  | 'PREFER_NOT_TO_SAY'
type FitFlag =
  | 'LARGE_THIGHS'
  | 'BROAD_SHOULDERS'
  | 'SHORT_TORSO'
  | 'FULL_SEAT'
  | 'SLOPING_SHOULDERS'
  | 'LONG_ARMS'
  | 'FULL_BELLY'
  | 'LONG_RISE'
  | 'NARROW_SHOULDERS'
  | 'FULL_CHEST'
  | 'FULL_UPPER_ARM'
  | 'WIDE_CALVES'
  | 'ONE_SHOULDER_LOWER'
  | 'HIP_TILT'
  | 'FORWARD_NECK'
  | 'USES_SHAPEWEAR'
  | 'CORSETED_FIT'
  | 'NURSING_OR_POSTPARTUM'
  | 'MODEST_COVERAGE'
  | 'HEADWEAR_FIT_NEEDED'
  | 'BRAIDS_LOCS_OR_WIG'

interface CustomMeasurement {
  id: string
  name: string
  value: string
}

type MeasurementProfileRow = {
  id: string
  label: string
  relationship: string | null
  measurements: Record<string, unknown> | null
  unit_preference: Unit | null
  source: string | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}

type MeasurementModuleKey = 'lengths' | 'upper' | 'lower' | 'headwear' | 'custom'

function isEditableCustomMeasurementEntry(key: string, value: unknown) {
  if (isMeasurementMetadataKey(key)) return false
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GARMENT_CONTEXT_OPTIONS: Array<{ value: GarmentContext; label: string; hint: string }> = [
  {
    value: 'MENSWEAR',
    label: 'Menswear cuts',
    hint: 'Suits, trousers, Agbada, kaftans, shirts, native wear',
  },
  {
    value: 'WOMENSWEAR',
    label: 'Womenswear cuts',
    hint: 'Dresses, skirts, blouses, Asobi, Lehenga, saree blouses',
  },
  { value: 'BOTH', label: 'Both', hint: 'I order both menswear and womenswear pieces' },
  {
    value: 'PREFER_NOT_TO_SAY',
    label: 'Prefer not to say',
    hint: 'Tailor works from measurements only',
  },
]

const BODY_SHAPE_OPTIONS: Array<{ value: BodyShape; label: string; hint: string }> = [
  {
    value: 'RECTANGLE',
    label: 'Rectangle',
    hint: 'Shoulders, waist, and hips roughly equal in width',
  },
  {
    value: 'BROAD_SHOULDERS',
    label: 'Broad shoulders',
    hint: 'Shoulders noticeably wider than hips',
  },
  { value: 'FULL_HIPS', label: 'Full hips', hint: 'Hips noticeably wider than shoulders' },
  {
    value: 'DEFINED_WAIST',
    label: 'Defined waist',
    hint: 'Shoulders and hips similar, clear waist indent',
  },
  {
    value: 'FULL_MIDSECTION',
    label: 'Full midsection',
    hint: 'Width concentrated through the torso',
  },
  {
    value: 'ATHLETIC',
    label: 'Athletic / muscular',
    hint: 'Broad frame with visible muscle volume',
  },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', hint: '' },
]

const FIT_FLAG_OPTIONS: Array<{ value: FitFlag; label: string; hint: string }> = [
  { value: 'LARGE_THIGHS', label: 'Large thighs', hint: 'Extra ease through the thigh' },
  {
    value: 'BROAD_SHOULDERS',
    label: 'Broad shoulders',
    hint: 'Wider shoulder seam, back panel width',
  },
  { value: 'SHORT_TORSO', label: 'Short torso', hint: 'Shorter rise, adjusted waistband' },
  { value: 'FULL_SEAT', label: 'Full seat', hint: 'Extra fabric at back seat of trousers' },
  { value: 'SLOPING_SHOULDERS', label: 'Sloping shoulders', hint: 'Repositioned sleeve seams' },
  { value: 'LONG_ARMS', label: 'Long arms', hint: 'Extended sleeve length' },
  { value: 'FULL_BELLY', label: 'Full belly / midsection', hint: 'Extra ease through trunk' },
  { value: 'LONG_RISE', label: 'Long rise needed', hint: 'Raised back waistband' },
  {
    value: 'NARROW_SHOULDERS',
    label: 'Narrow shoulders',
    hint: 'Reduced armhole, brought-in seam',
  },
  { value: 'FULL_CHEST', label: 'Full chest', hint: 'Extra ease across chest panel' },
  {
    value: 'FULL_UPPER_ARM',
    label: 'Full upper arm',
    hint: 'More comfort through sleeve and armhole',
  },
  {
    value: 'WIDE_CALVES',
    label: 'Wide calves',
    hint: 'More room through fitted trousers or narrow hems',
  },
  {
    value: 'ONE_SHOULDER_LOWER',
    label: 'One shoulder sits lower',
    hint: 'Helps avoid uneven hems and necklines',
  },
  {
    value: 'HIP_TILT',
    label: 'Hip tilt or uneven waist',
    hint: 'Useful for skirts, trousers, and gowns',
  },
  {
    value: 'FORWARD_NECK',
    label: 'Forward neck / rounded back',
    hint: 'Helps collars and back length sit better',
  },
  {
    value: 'USES_SHAPEWEAR',
    label: 'Uses shapewear',
    hint: 'Measurements may need to match the support worn with the garment',
  },
  {
    value: 'CORSETED_FIT',
    label: 'Corseted or snatched fit',
    hint: 'Tailor should verify bust, waist, and comfort before cutting',
  },
  {
    value: 'NURSING_OR_POSTPARTUM',
    label: 'Nursing or postpartum fit',
    hint: 'Useful for bust ease, access, and comfort changes',
  },
  {
    value: 'MODEST_COVERAGE',
    label: 'Modest coverage preferred',
    hint: 'Neckline, sleeve, and length choices should respect coverage',
  },
  {
    value: 'HEADWEAR_FIT_NEEDED',
    label: 'Matching headwear needed',
    hint: 'Fila, kufi, cap, gele prep, or formal headpiece context',
  },
  {
    value: 'BRAIDS_LOCS_OR_WIG',
    label: 'Braids, locs, wig, or volume',
    hint: 'Important for headwear, collars, and neckline comfort',
  },
]

const STEP_TITLES = ['Body measurements', 'Garment cuts', 'Body shape', 'Fit challenges & context']

const STEP_SUBTITLES = [
  'Add as many measurements as you can. The more detail you share, the better your tailor can quote and cut.',
  'This helps your tailor understand which cuts and shapes to use. This is a fit question, not a personal one.',
  'Pick all that apply. This helps your tailor visualise how a garment will fall before they start cutting.',
  'Where do clothes usually fit badly, and what context should your tailor know before cutting?',
]

const MEASUREMENT_SOURCE_OPTIONS: Array<{ value: MeasurementSource; label: string; hint: string }> =
  [
    {
      value: 'DRAPE_VISION',
      label: 'Drapeon Vision scan',
      hint: 'AI-assisted starting point. Tailors can still verify high-risk fields.',
    },
    {
      value: 'TAILOR_ASSISTED_DRAPE_VISION',
      label: 'Tailor-assisted Drapeon Vision',
      hint: 'A tailor helped capture or verify the scan.',
    },
    {
      value: 'SELF_GUIDED',
      label: 'I measured myself',
      hint: 'Best when you used a tape carefully and double-checked the numbers.',
    },
    {
      value: 'HELPER_GUIDED',
      label: 'A helper measured me',
      hint: 'Useful when a friend or family member helped with the tape.',
    },
    {
      value: 'TAILOR_CAPTURED',
      label: 'A tailor measured me',
      hint: 'Usually stronger for fit-critical garments.',
    },
    {
      value: 'EXTERNAL_PRO_CAPTURED',
      label: 'Another professional measured me',
      hint: 'For showroom, bridal, or alteration-desk measurements.',
    },
  ]
const CM_PER_INCH = 2.54

const CUSTOM_MEASUREMENT_SUGGESTION_GROUPS = [
  {
    title: 'Bodice',
    items: [
      'Round bust',
      'High bust',
      'Under bust',
      'Front bust',
      'Back bust',
      'Bust point spacing',
      'Bust point to waist',
      'Bust radius',
      'Across chest',
      'Across back',
      'Armhole depth',
      'Front waist length',
      'Back waist length',
    ],
  },
  {
    title: 'Length & posture',
    items: [
      'Nape',
      'Front shoulder',
      'Back shoulder',
      'Full front length',
      'Waist to hip',
      'Waist to knee',
      'Waist to floor',
    ],
  },
  {
    title: 'Sleeves',
    items: ['Bicep', 'Forearm', 'Wrist', 'Shoulder to elbow', 'Round elbow'],
  },
  {
    title: 'Trousers',
    items: ['Front rise', 'Back rise', 'Crotch depth', 'Seat depth', 'Calf', 'Ankle'],
  },
  {
    title: 'Headwear',
    items: [
      'Head circumference',
      'Hat band line',
      'Head length',
      'Head width',
      'Ear to ear over crown',
      'Front to back over crown',
      'Fila height',
    ],
  },
]

const MEASUREMENTS_GUIDE_KEY = 'drape_customer_measurements_best_use_dismissed'

const MEASUREMENT_MODULE_OPTIONS: Array<{
  value: MeasurementModuleKey
  title: string
  body: string
  icon: keyof typeof Feather.glyphMap
}> = [
  {
    value: 'lengths',
    title: 'Lengths',
    body: 'Height, sleeve, inseam, outseam, torso, and back length.',
    icon: 'maximize-2',
  },
  {
    value: 'upper',
    title: 'Upper body detail',
    body: 'Neck, under bust, bicep, and wrist for shirts, cuffs, bodice, and corset work.',
    icon: 'watch',
  },
  {
    value: 'lower',
    title: 'Lower body detail',
    body: 'Thigh and knee for trousers, fitted skirts, and narrow hems.',
    icon: 'align-justify',
  },
  {
    value: 'headwear',
    title: 'Headwear',
    body: 'Head, hat band, crown, and fila details for caps, gele, and formal headwear.',
    icon: 'circle',
  },
  {
    value: 'custom',
    title: 'Custom tape points',
    body: 'Add garment-specific points your tailor asked for.',
    icon: 'plus-circle',
  },
]

const MODULE_FIELD_KEYS: Record<Exclude<MeasurementModuleKey, 'custom'>, string[]> = {
  lengths: ['height', 'inseam', 'sleeveLength', 'backLength', 'outseam', 'torsoLength'],
  upper: ['neckCircumference', 'underBust', 'bicepCircumference', 'wristCircumference'],
  lower: ['thighCircumference', 'kneeCircumference'],
  headwear: [
    'headCircumference',
    'hatBandLine',
    'headLength',
    'headWidth',
    'earToEarOverCrown',
    'frontToBackOverCrown',
    'filaHeight',
  ],
}

function normalizeGarmentContext(value: unknown): GarmentContext | null {
  if (value === 'PREFER_NOT') return 'PREFER_NOT_TO_SAY'
  if (
    value === 'MENSWEAR' ||
    value === 'WOMENSWEAR' ||
    value === 'BOTH' ||
    value === 'PREFER_NOT_TO_SAY'
  ) {
    return value
  }
  return null
}

function normalizeBodyShape(value: unknown): BodyShape | null {
  if (value === 'PREFER_NOT') return 'PREFER_NOT_TO_SAY'
  if (
    value === 'RECTANGLE' ||
    value === 'BROAD_SHOULDERS' ||
    value === 'FULL_HIPS' ||
    value === 'DEFINED_WAIST' ||
    value === 'FULL_MIDSECTION' ||
    value === 'ATHLETIC' ||
    value === 'PREFER_NOT_TO_SAY'
  ) {
    return value
  }
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MeasurementsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>()
  const sanitizedReturnTo = sanitizeReturnTo(returnTo)
  const safeReturnTo = sanitizedReturnTo && sanitizedReturnTo !== '/(customer)/profile/measurements'
    ? sanitizedReturnTo
    : undefined
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [measurementSourceSheetOpen, setMeasurementSourceSheetOpen] = useState(false)
  const [measurementModuleSheetOpen, setMeasurementModuleSheetOpen] = useState(false)
  const [customMeasurementSheetOpen, setCustomMeasurementSheetOpen] = useState(false)
  const [measurementProfiles, setMeasurementProfiles] = useState<MeasurementProfileRow[]>([])
  const [visibleMeasurementModules, setVisibleMeasurementModules] = useState<MeasurementModuleKey[]>([])

  // Layer 1
  const [measurementProfileLabel, setMeasurementProfileLabel] = useState('Me')
  const [unit, setUnit] = useState<Unit>('in')
  const [chest, setChest] = useState('')
  const [waist, setWaist] = useState('')
  const [hips, setHips] = useState('')
  const [shoulderWidth, setShoulderWidth] = useState('')
  const [inseam, setInseam] = useState('')
  const [sleeveLength, setSleeveLength] = useState('')
  const [neckCircumference, setNeckCircumference] = useState('')
  const [underBust, setUnderBust] = useState('')
  const [height, setHeight] = useState('')
  const [backLength, setBackLength] = useState('')
  const [outseam, setOutseam] = useState('')
  const [thighCircumference, setThighCircumference] = useState('')
  const [kneeCircumference, setKneeCircumference] = useState('')
  const [bicepCircumference, setBicepCircumference] = useState('')
  const [wristCircumference, setWristCircumference] = useState('')
  const [headCircumference, setHeadCircumference] = useState('')
  const [hatBandLine, setHatBandLine] = useState('')
  const [headLength, setHeadLength] = useState('')
  const [headWidth, setHeadWidth] = useState('')
  const [earToEarOverCrown, setEarToEarOverCrown] = useState('')
  const [frontToBackOverCrown, setFrontToBackOverCrown] = useState('')
  const [filaHeight, setFilaHeight] = useState('')
  const [torsoLength, setTorsoLength] = useState('')
  const [fitStyle, setFitStyle] = useState<FitStyle | null>(null)
  const [measurementSource, setMeasurementSource] = useState<MeasurementSource>('SELF_GUIDED')
  const [customMeasurements, setCustomMeasurements] = useState<CustomMeasurement[]>([])

  // Layer 2
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)

  // Layer 3
  const [bodyShapes, setBodyShapes] = useState<BodyShape[]>([])

  // Layer 4
  const [fitFlags, setFitFlags] = useState<FitFlag[]>([])
  const [bodyNote, setBodyNote] = useState('')
  const [bodyNoteError, setBodyNoteError] = useState('')
  const [fitCaptureMeta, setFitCaptureMeta] = useState<Record<string, unknown>>({})

  function applyMeasurements(m: Record<string, unknown> | null) {
    setUnit('in')
    setMeasurementProfileLabel('Me')
    setChest('')
    setWaist('')
    setHips('')
    setShoulderWidth('')
    setInseam('')
    setSleeveLength('')
    setNeckCircumference('')
    setUnderBust('')
    setHeight('')
    setBackLength('')
    setOutseam('')
    setThighCircumference('')
    setKneeCircumference('')
    setBicepCircumference('')
    setWristCircumference('')
    setHeadCircumference('')
    setHatBandLine('')
    setHeadLength('')
    setHeadWidth('')
    setEarToEarOverCrown('')
    setFrontToBackOverCrown('')
    setFilaHeight('')
    setTorsoLength('')
    setFitStyle(null)
    setMeasurementSource('SELF_GUIDED')
    setGarmentContext(null)
    setBodyShapes([])
    setFitFlags([])
    setBodyNote('')
    setBodyNoteError('')
    setCustomMeasurements([])
    setFitCaptureMeta({})
    setVisibleMeasurementModules([])
    if (!m) return
    if (typeof m.measurementProfileLabel === 'string' && m.measurementProfileLabel.trim()) {
      setMeasurementProfileLabel(m.measurementProfileLabel.trim())
    }
    if (m.unit === 'cm' || m.unit === 'in') setUnit(m.unit)
    if (typeof m.chest === 'number') setChest(String(m.chest))
    if (typeof m.waist === 'number') setWaist(String(m.waist))
    if (typeof m.hips === 'number') setHips(String(m.hips))
    if (typeof m.shoulderWidth === 'number') setShoulderWidth(String(m.shoulderWidth))
    if (typeof m.inseam === 'number') setInseam(String(m.inseam))
    if (typeof m.sleeveLength === 'number') setSleeveLength(String(m.sleeveLength))
    if (typeof m.neckCircumference === 'number') setNeckCircumference(String(m.neckCircumference))
    if (typeof m.underBust === 'number') setUnderBust(String(m.underBust))
    if (typeof m.height === 'number') setHeight(String(m.height))
    if (typeof m.backLength === 'number') setBackLength(String(m.backLength))
    if (typeof m.outseam === 'number') setOutseam(String(m.outseam))
    if (typeof m.thighCircumference === 'number')
      setThighCircumference(String(m.thighCircumference))
    if (typeof m.kneeCircumference === 'number') setKneeCircumference(String(m.kneeCircumference))
    if (typeof m.bicepCircumference === 'number')
      setBicepCircumference(String(m.bicepCircumference))
    if (typeof m.wristCircumference === 'number')
      setWristCircumference(String(m.wristCircumference))
    if (typeof m.headCircumference === 'number') setHeadCircumference(String(m.headCircumference))
    if (typeof m.hatBandLine === 'number') setHatBandLine(String(m.hatBandLine))
    if (typeof m.headLength === 'number') setHeadLength(String(m.headLength))
    if (typeof m.headWidth === 'number') setHeadWidth(String(m.headWidth))
    if (typeof m.earToEarOverCrown === 'number') setEarToEarOverCrown(String(m.earToEarOverCrown))
    if (typeof m.frontToBackOverCrown === 'number')
      setFrontToBackOverCrown(String(m.frontToBackOverCrown))
    if (typeof m.filaHeight === 'number') setFilaHeight(String(m.filaHeight))
    if (typeof m.torsoLength === 'number') setTorsoLength(String(m.torsoLength))
    if (m.fitStyle === 'Slim' || m.fitStyle === 'Regular' || m.fitStyle === 'Relaxed')
      setFitStyle(m.fitStyle)
    if (isMeasurementSource(m.measurementSource)) {
      setMeasurementSource(m.measurementSource)
    }
    const nextGarmentContext = normalizeGarmentContext(m.garmentContext)
    if (nextGarmentContext) setGarmentContext(nextGarmentContext)
    if (Array.isArray(m.bodyShape)) {
      setBodyShapes(
        m.bodyShape.map(normalizeBodyShape).filter((value): value is BodyShape => !!value)
      )
    } else {
      const nextBodyShape = normalizeBodyShape(m.bodyShape)
      if (nextBodyShape) setBodyShapes([nextBodyShape])
    }
    if (Array.isArray(m.fitFlags)) setFitFlags(m.fitFlags as FitFlag[])
    if (typeof m.bodyNote === 'string') setBodyNote(m.bodyNote)
    const standardKeys = new Set([
      'chest',
      'waist',
      'hips',
      'shoulderWidth',
      'inseam',
      'sleeveLength',
      'neckCircumference',
      'underBust',
      'height',
      'backLength',
      'outseam',
      'thighCircumference',
      'kneeCircumference',
      'bicepCircumference',
      'wristCircumference',
      'headCircumference',
      'hatBandLine',
      'headLength',
      'headWidth',
      'earToEarOverCrown',
      'frontToBackOverCrown',
      'filaHeight',
      'torsoLength',
      'unit',
      'measurementProfileLabel',
      'measurementProfileUpdatedAt',
      'wearerContext',
      'fitStyle',
      'fitPassportVersion',
      'measurementSource',
      'measurementSourceLabel',
      'fitConfidence',
      'needsConfirmation',
      'confirmationReason',
      'confirmationRequestedAt',
      'confirmedAt',
      'confirmedBy',
      'garmentContext',
      'bodyShape',
      'fitFlags',
      'bodyNote',
      'captureMethod',
      'captureVersion',
      'capturedAt',
      'confidenceOverall',
      'confidenceByField',
      'sourceDevice',
      'latestMeasurementScanId',
      'latestMeasurementScanStatus',
      'bodyFlags',
      'symmetryFlags',
      'requiresTailorReview',
      'latestFitProfile',
    ])
    const preservedLatestFitProfile =
      m.latestFitProfile &&
      typeof m.latestFitProfile === 'object' &&
      !Array.isArray(m.latestFitProfile)
        ? {
            ...(m.latestFitProfile as Record<string, unknown>),
            measurementScanId: null,
            captureMethod: null,
            captureMethodLabel: null,
            captureVersion: null,
            status: null,
            capturedAt: null,
            confidenceOverall: null,
            confidenceByField: null,
            requiresTailorReview: false,
            tailorMeasurementOverride: false,
            tailorMeasurementOverrideReason: null,
            tailorMeasurementOverrideAt: null,
          }
        : null
    setFitCaptureMeta({
      bodyFlags: Array.isArray(m.bodyFlags) ? m.bodyFlags : [],
      symmetryFlags: Array.isArray(m.symmetryFlags) ? m.symmetryFlags : [],
      latestFitProfile: preservedLatestFitProfile,
    })
    const extras = Object.entries(m).filter(([k, value]) => !standardKeys.has(k) && isEditableCustomMeasurementEntry(k, value))
    setCustomMeasurements(
      extras.map(([name, value]) => ({
        id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        name,
        value: value != null ? String(value) : '',
      }))
    )
    const modulesWithValues = MEASUREMENT_MODULE_OPTIONS
      .filter((module) => {
        if (module.value === 'custom') return extras.length > 0
        return MODULE_FIELD_KEYS[module.value].some((key) => typeof m[key] === 'number')
      })
      .map((module) => module.value)
    setVisibleMeasurementModules(modulesWithValues)
  }

  const loadMeasurements = useCallback(async () => {
    if (!user?.id) {
      setFetchError(false)
      return
    }
    setFetchError(false)
    const { data, error } = await supabase
      .from('customer_profiles')
      .select('measurements')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      setFetchError(true)
      return
    }

    applyMeasurements((data?.measurements as Record<string, unknown> | null) ?? null)
  }, [user?.id])

  const loadMeasurementProfiles = useCallback(async () => {
    if (!user?.id) {
      setMeasurementProfiles([])
      return
    }
    const { data, error } = await supabase
      .from('customer_measurement_profiles')
      .select('id, label, relationship, measurements, unit_preference, source, is_default, last_measured_at, updated_at')
      .eq('customer_id', user.id)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })

    if (!error) {
      setMeasurementProfiles((data ?? []) as MeasurementProfileRow[])
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const timer = setTimeout(() => {
      void loadMeasurements()
      void loadMeasurementProfiles()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadMeasurementProfiles, loadMeasurements, user?.id])

  useEffect(() => {
    AsyncStorage.getItem(`${MEASUREMENTS_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {
        // Best effort: showing guidance again is safer than hiding help.
      })
  }, [user?.id])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${MEASUREMENTS_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {
      // Best effort persistence only; dismiss immediately for this session.
    }
  }

  function canProceedStep(): boolean {
    switch (step) {
      case 0:
        return !!chest.trim() && !!waist.trim() && !!fitStyle && !!measurementSource
      case 1:
        return !!garmentContext
      case 2:
        return bodyShapes.length > 0
      case 3:
        return true
      default:
        return true
    }
  }

  function stepBlockedMessage(): string {
    switch (step) {
      case 0:
        return 'Please enter your chest, waist, fit style, and how these measurements were taken to continue.'
      case 1:
        return 'Please select the garment cut style that applies to you.'
      case 2:
        return 'Please select the body shape that closest matches yours.'
      default:
        return ''
    }
  }

  function addCustomMeasurement(name = '', value = '') {
    setCustomMeasurements((prev) => [
      ...prev,
      { id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`, name, value },
    ])
  }

  function addSuggestedMeasurement(name: string) {
    setCustomMeasurements((prev) => {
      if (
        prev.some((measurement) => measurement.name.trim().toLowerCase() === name.toLowerCase())
      ) {
        return prev
      }
      return [
        ...prev,
        {
          id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
          name,
          value: '',
        },
      ]
    })
  }

  function toggleMeasurementModule(moduleKey: MeasurementModuleKey) {
    setVisibleMeasurementModules((previous) =>
      previous.includes(moduleKey)
        ? previous.filter((key) => key !== moduleKey)
        : [...previous, moduleKey]
    )
  }

  function applyMeasurementProfile(profile: MeasurementProfileRow) {
    const storedUnit = profile.measurements?.unit
    const nextUnit =
      profile.unit_preference === 'cm' || profile.unit_preference === 'in'
        ? profile.unit_preference
        : storedUnit === 'cm' || storedUnit === 'in'
          ? storedUnit
          : unit
    applyMeasurements({
      ...(profile.measurements ?? {}),
      unit: nextUnit,
      measurementProfileLabel: profile.label,
      measurementSource: profile.measurements?.measurementSource ?? measurementSource,
    })
    setProfileSheetOpen(false)
  }

  function moduleHasValue(moduleKey: Exclude<MeasurementModuleKey, 'custom'>) {
    const valuesByKey: Record<string, string> = {
      height,
      inseam,
      sleeveLength,
      backLength,
      outseam,
      torsoLength,
      neckCircumference,
      underBust,
      bicepCircumference,
      wristCircumference,
      thighCircumference,
      kneeCircumference,
      headCircumference,
      hatBandLine,
      headLength,
      headWidth,
      earToEarOverCrown,
      frontToBackOverCrown,
      filaHeight,
    }
    return MODULE_FIELD_KEYS[moduleKey].some((key) => valuesByKey[key]?.trim())
  }

  function shouldShowModule(moduleKey: MeasurementModuleKey) {
    if (visibleMeasurementModules.includes(moduleKey)) return true
    if (moduleKey === 'custom') return customMeasurements.length > 0
    return moduleHasValue(moduleKey)
  }

  function updateCustomMeasurement(id: string, field: 'name' | 'value', text: string) {
    setCustomMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: text } : m)))
  }

  function removeCustomMeasurement(id: string) {
    setCustomMeasurements((prev) => prev.filter((m) => m.id !== id))
  }

  function toggleBodyShape(shape: BodyShape) {
    setBodyShapes((prev) => {
      if (shape === 'PREFER_NOT_TO_SAY') {
        return prev.includes('PREFER_NOT_TO_SAY') ? [] : ['PREFER_NOT_TO_SAY']
      }
      const without = prev.filter((s) => s !== 'PREFER_NOT_TO_SAY')
      return without.includes(shape) ? without.filter((s) => s !== shape) : [...without, shape]
    })
  }

  function toggleFlag(flag: FitFlag) {
    setFitFlags((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]))
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

  function safeParse(v: string): number | null {
    if (!v.trim()) return null
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  function formatMeasurementInput(value: number) {
    return value.toFixed(2).replace(/\.?0+$/, '')
  }

  function convertMeasurementText(value: string, fromUnit: Unit, toUnit: Unit) {
    if (fromUnit === toUnit || !value.trim()) return value
    const parsed = safeParse(value)
    if (parsed == null) return value
    return formatMeasurementInput(fromUnit === 'in' ? parsed * CM_PER_INCH : parsed / CM_PER_INCH)
  }

  function changeUnit(nextUnit: Unit) {
    if (nextUnit === unit) return

    setChest((value) => convertMeasurementText(value, unit, nextUnit))
    setWaist((value) => convertMeasurementText(value, unit, nextUnit))
    setHips((value) => convertMeasurementText(value, unit, nextUnit))
    setShoulderWidth((value) => convertMeasurementText(value, unit, nextUnit))
    setInseam((value) => convertMeasurementText(value, unit, nextUnit))
    setSleeveLength((value) => convertMeasurementText(value, unit, nextUnit))
    setNeckCircumference((value) => convertMeasurementText(value, unit, nextUnit))
    setHeight((value) => convertMeasurementText(value, unit, nextUnit))
    setBackLength((value) => convertMeasurementText(value, unit, nextUnit))
    setOutseam((value) => convertMeasurementText(value, unit, nextUnit))
    setThighCircumference((value) => convertMeasurementText(value, unit, nextUnit))
    setKneeCircumference((value) => convertMeasurementText(value, unit, nextUnit))
    setTorsoLength((value) => convertMeasurementText(value, unit, nextUnit))
    setCustomMeasurements((previous) =>
      previous.map((measurement) => ({
        ...measurement,
        value: convertMeasurementText(measurement.value, unit, nextUnit),
      }))
    )
    setUnit(nextUnit)
  }

  function openDrapeVision() {
    router.push({
      pathname: DRAPE_VISION_ROUTE,
      params: {
        mode: 'customer_scan',
        returnTo: safeReturnTo ?? '/(customer)/profile/measurements',
      },
    } as never)
  }

  async function save() {
    if (saving) return
    if (!validateBodyNote(bodyNote)) return

    setSaving(true)

    const customExtras: Record<string, number | null> = {}
    for (const m of customMeasurements) {
      const name = m.name.trim()
      if (name && !isMeasurementMetadataKey(name)) {
        customExtras[name] = safeParse(m.value)
      }
    }

    const payload = {
      measurementProfileLabel: measurementProfileLabel.trim() || 'Me',
      measurementProfileUpdatedAt: new Date().toISOString(),
      wearerContext: {
        mode: 'SELF',
        label: measurementProfileLabel.trim() || 'Me',
        measurementProfileLabel: measurementProfileLabel.trim() || 'Me',
        relationship: 'BUYER',
        selectedAt: new Date().toISOString(),
      },
      chest: safeParse(chest),
      waist: safeParse(waist),
      hips: safeParse(hips),
      shoulderWidth: safeParse(shoulderWidth),
      inseam: safeParse(inseam),
      sleeveLength: safeParse(sleeveLength),
      neckCircumference: safeParse(neckCircumference),
      underBust: safeParse(underBust),
      height: safeParse(height),
      backLength: safeParse(backLength),
      outseam: safeParse(outseam),
      thighCircumference: safeParse(thighCircumference),
      kneeCircumference: safeParse(kneeCircumference),
      bicepCircumference: safeParse(bicepCircumference),
      wristCircumference: safeParse(wristCircumference),
      headCircumference: safeParse(headCircumference),
      hatBandLine: safeParse(hatBandLine),
      headLength: safeParse(headLength),
      headWidth: safeParse(headWidth),
      earToEarOverCrown: safeParse(earToEarOverCrown),
      frontToBackOverCrown: safeParse(frontToBackOverCrown),
      filaHeight: safeParse(filaHeight),
      torsoLength: safeParse(torsoLength),
      unit,
      fitStyle,
      measurementSource,
      measurementSourceLabel: MEASUREMENT_SOURCE_LABELS[measurementSource],
      fitConfidence: deriveMeasurementFitConfidence(measurementSource),
      needsConfirmation: false,
      confirmationReason: null,
      confirmationRequestedAt: null,
      confirmedAt: null,
      confirmedBy: null,
      garmentContext,
      bodyShape: bodyShapes,
      fitFlags,
      bodyNote: bodyNote.trim() || null,
      ...fitCaptureMeta,
      ...customExtras,
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('customer_profiles')
      .upsert(
        { user_id: user?.id, measurements: payload, updated_at: now },
        { onConflict: 'user_id' }
      )

    if (error) {
      setSaving(false)
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your measurements yet. Your edits are still here, so retry when the signal improves.'
          : 'Could not save your measurements right now. Please try again in a moment.'
      )
    } else {
      if (user?.id) {
        const { data: existingDefault } = await supabase
          .from('customer_measurement_profiles')
          .select('id')
          .eq('customer_id', user.id)
          .eq('is_default', true)
          .maybeSingle()

        const namedProfilePayload = {
          customer_id: user.id,
          label: measurementProfileLabel.trim() || 'Me',
          relationship: 'SELF',
          measurements: buildMeasurementProfileStoragePayload(payload),
          unit_preference: unit,
          source: measurementSource === 'DRAPE_VISION'
            ? 'DRAPE_VISION'
            : measurementSource === 'TAILOR_ASSISTED_DRAPE_VISION' || measurementSource === 'TAILOR_CAPTURED'
              ? 'TAILOR_ASSISTED'
              : 'MANUAL',
          is_default: true,
          last_measured_at: payload.measurementProfileUpdatedAt,
        }

        if (existingDefault?.id) {
          await supabase
            .from('customer_measurement_profiles')
            .update(namedProfilePayload)
            .eq('id', existingDefault.id)
        } else {
          await supabase
            .from('customer_measurement_profiles')
            .insert(namedProfilePayload)
        }
      }
      setSaving(false)
      capture('measurements_saved', { unit, measurement_source: measurementSource })
      goBackOrReturnToIfNeeded(router, navigation, safeReturnTo, '/(customer)/profile')
    }
  }

  function next() {
    if (saving) return
    if (!canProceedStep()) {
      Alert.alert('Required', stepBlockedMessage())
      return
    }
    if (step < 3) setStep(step + 1)
    else save()
  }

  function back() {
    if (step > 0) setStep(step - 1)
    else goBackOrReturnToIfNeeded(router, navigation, safeReturnTo, '/(customer)/profile')
  }

  const sourceLabel = MEASUREMENT_SOURCE_OPTIONS.find((option) => option.value === measurementSource)?.label
    ?? MEASUREMENT_SOURCE_LABELS[measurementSource]
    ?? 'Choose source'
  const selectedProfile = measurementProfiles.find((profile) => profile.label === measurementProfileLabel)
  const profileOptions: ChoiceSheetOption[] = measurementProfiles.length > 0
    ? measurementProfiles.map((profile) => ({
        value: profile.id,
        title: profile.is_default ? `${profile.label} · default` : profile.label,
        body: profile.last_measured_at
          ? `Updated ${new Date(profile.last_measured_at).toLocaleDateString()}`
          : profile.source
            ? `${profile.source.replace(/_/g, ' ').toLowerCase()} profile`
            : 'Saved profile',
        icon: profile.relationship === 'SELF' ? 'user' : 'users',
      }))
    : [{
        value: 'current',
        title: measurementProfileLabel.trim() || 'Me',
        body: 'Current profile on this device',
        icon: 'user' as keyof typeof Feather.glyphMap,
      }]
  const customMeasurementOptions = CUSTOM_MEASUREMENT_SUGGESTION_GROUPS.flatMap((group) =>
    group.items.map((name) => ({
      value: name,
      title: name,
      body: group.title,
      icon: 'plus-circle' as keyof typeof Feather.glyphMap,
    }))
  )
  const coreFields = [
    { label: 'Chest', value: chest, set: setChest },
    { label: 'Waist', value: waist, set: setWaist },
    { label: 'Hips', value: hips, set: setHips },
    { label: 'Shoulder width', value: shoulderWidth, set: setShoulderWidth },
  ]
  const optionalModules = [
    {
      key: 'lengths' as const,
      title: 'Lengths',
      subtitle: 'Useful for sleeves, trousers, torso balance, and overall garment length.',
      fields: [
        { label: 'Height', value: height, set: setHeight },
        { label: 'Inseam', value: inseam, set: setInseam },
        { label: 'Sleeve length', value: sleeveLength, set: setSleeveLength },
        { label: 'Back length', value: backLength, set: setBackLength },
        { label: 'Outseam', value: outseam, set: setOutseam },
        { label: 'Torso length', value: torsoLength, set: setTorsoLength },
      ],
    },
    {
      key: 'upper' as const,
      title: 'Upper body detail',
      subtitle: 'Use for cuffs, sleeves, bodice, corset, shirts, and fitted tops.',
      fields: [
        { label: 'Neck', value: neckCircumference, set: setNeckCircumference },
        { label: 'Under bust', value: underBust, set: setUnderBust },
        { label: 'Bicep', value: bicepCircumference, set: setBicepCircumference },
        { label: 'Wrist', value: wristCircumference, set: setWristCircumference },
      ],
    },
    {
      key: 'lower' as const,
      title: 'Lower body detail',
      subtitle: 'Use for trousers, fitted skirts, and narrow hems.',
      fields: [
        { label: 'Thigh', value: thighCircumference, set: setThighCircumference },
        { label: 'Knee', value: kneeCircumference, set: setKneeCircumference },
      ],
    },
    {
      key: 'headwear' as const,
      title: 'Headwear',
      subtitle: 'Use for fila, caps, gele prep, hat bands, and formal headpieces.',
      fields: [
        { label: 'Head circumference', value: headCircumference, set: setHeadCircumference },
        { label: 'Hat band line', value: hatBandLine, set: setHatBandLine },
        { label: 'Head length', value: headLength, set: setHeadLength },
        { label: 'Head width', value: headWidth, set: setHeadWidth },
        { label: 'Ear to ear over crown', value: earToEarOverCrown, set: setEarToEarOverCrown },
        { label: 'Front to back over crown', value: frontToBackOverCrown, set: setFrontToBackOverCrown },
        { label: 'Fila height', value: filaHeight, set: setFilaHeight },
      ],
    },
  ]

  function renderMeasurementInputGrid(
    fields: Array<{ label: string; value: string; set: (value: string) => void }>
  ) {
    return (
      <View style={styles.measureGrid}>
        {fields.map(({ label, value, set }) => (
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
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Measurements</Text>
            <Text style={styles.stateTitle}>Couldn't load your measurements.</Text>
            <Text style={styles.stateHint}>
              This screen should help you keep your fit profile accurate so booking a tailor feels
              faster and more reliable.
            </Text>
            <TouchableOpacity
              style={styles.errorRetry}
              onPress={() => {
                void loadMeasurements()
              }}
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.errorSecondary}
              onPress={() => goBackOrReturnToIfNeeded(router, navigation, safeReturnTo, '/(customer)/profile')}
            >
              <Text style={styles.errorSecondaryText}>Open profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={back}>
              <Text style={styles.errorLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={back} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepIndicator}>Step {step + 1} of 4</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.progressSegment, i <= step && styles.progressSegmentDone]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            {showGuide && (
              <View style={styles.guideCard}>
                <View style={styles.guideHeader}>
                  <Text style={styles.guideEyebrow}>Fit profile</Text>
                  <TouchableOpacity onPress={() => void dismissGuide()} style={styles.guideClose}>
                    <Text style={styles.guideCloseText}>×</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.guideCopy}>
                  Start with your core fit details, then keep refining this profile as you place
                  more orders.
                </Text>
              </View>
            )}

            <View style={styles.stepHeading}>
              <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
              <Text style={styles.stepSub}>{STEP_SUBTITLES[step]}</Text>
            </View>

            {/* ── Step 0: Body measurements ── */}
            {step === 0 && (
              <View style={styles.fields}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Open Drapeon Vision"
                  onPress={openDrapeVision}
                  style={styles.visionPassportCard}
                >
                  <View style={styles.visionPassportIcon}>
                    <Feather name="aperture" size={20} color={PRIMARY_GREEN} />
                  </View>
                  <View style={styles.visionPassportCopy}>
                    <Text style={styles.visionPassportTitle}>Drapeon Vision</Text>
                    <Text style={styles.visionPassportText}>
                      Scan flow, manual entry, and tailor-assisted measurements all save into this
                      Fit Passport.
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={Colors.midGrey} />
                </TouchableOpacity>

                <View style={styles.passportSummaryCard}>
                  <View style={styles.passportSummaryHeader}>
                    <View>
                      <Text style={styles.summaryEyebrow}>Fit Passport</Text>
                      <Text style={styles.summaryTitle}>
                        {measurementProfileLabel.trim() || 'Me'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.smallAction}
                      onPress={() => setProfileSheetOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Choose measurement profile"
                    >
                      <Text style={styles.smallActionText}>Switch</Text>
                    </TouchableOpacity>
                  </View>
                  <Input
                    label="Profile name"
                    placeholder="Me, Mum, Partner, Child"
                    value={measurementProfileLabel}
                    onChangeText={setMeasurementProfileLabel}
                    hint="Name the person these measurements belong to."
                  />
                  {selectedProfile ? (
                    <Text style={styles.profileMeta}>
                      {selectedProfile.is_default ? 'Default profile' : 'Saved profile'} · {selectedProfile.source?.replace(/_/g, ' ').toLowerCase() ?? 'manual'}
                    </Text>
                  ) : null}
                </View>

                {/* Unit toggle */}
                <View style={styles.controlsRow}>
                  <View style={styles.unitToggle}>
                    {(['in', 'cm'] as Unit[]).map((u) => (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                        onPress={() => changeUnit(u)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: unit === u }}
                      >
                        <Text style={[styles.unitLabel, unit === u && styles.unitLabelActive]}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.sourceSelector}
                    onPress={() => setMeasurementSourceSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Choose measurement source"
                  >
                    <Feather name="clipboard" size={15} color={Colors.needleGreen} />
                    <Text style={styles.sourceSelectorText} numberOfLines={1}>{sourceLabel}</Text>
                    <Feather name="chevron-down" size={15} color={Colors.midGrey} />
                  </TouchableOpacity>
                </View>

                <View style={styles.moduleCard}>
                  <View style={styles.moduleHeader}>
                    <View style={styles.moduleIcon}>
                      <Feather name="target" size={17} color={Colors.needleGreen} />
                    </View>
                    <View style={styles.moduleCopy}>
                      <Text style={styles.moduleTitle}>Core measurements</Text>
                      <Text style={styles.moduleSubtitle}>
                        Fit 360 and most orders start with these four.
                      </Text>
                    </View>
                  </View>
                  {renderMeasurementInputGrid(coreFields)}
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
                        <Text
                          style={[
                            styles.fitStyleLabel,
                            fitStyle === s && styles.fitStyleLabelActive,
                          ]}
                        >
                          {s}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.addMoreCard}>
                  <View style={styles.addMoreCopy}>
                    <Text style={styles.addMoreTitle}>Add more measurements</Text>
                    <Text style={styles.addMoreText}>
                      Choose only the garment areas you need. Empty optional fields stay out of the way.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.addMoreButton}
                    onPress={() => setMeasurementModuleSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Add measurement module"
                  >
                    <Feather name="plus" size={15} color={Colors.textInverse} />
                    <Text style={styles.addMoreButtonText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {optionalModules
                  .filter((module) => shouldShowModule(module.key))
                  .map((module) => (
                    <View key={module.key} style={styles.moduleCard}>
                      <View style={styles.moduleHeader}>
                        <View style={styles.moduleIcon}>
                          <Feather
                            name={MEASUREMENT_MODULE_OPTIONS.find((option) => option.value === module.key)?.icon ?? 'sliders'}
                            size={17}
                            color={Colors.needleGreen}
                          />
                        </View>
                        <View style={styles.moduleCopy}>
                          <Text style={styles.moduleTitle}>{module.title}</Text>
                          <Text style={styles.moduleSubtitle}>{module.subtitle}</Text>
                        </View>
                      </View>
                      {renderMeasurementInputGrid(module.fields)}
                    </View>
                  ))}

                {/* Custom measurements */}
                {shouldShowModule('custom') ? (
                  <View style={styles.moduleCard}>
                    <View style={styles.moduleHeader}>
                      <View style={styles.moduleIcon}>
                        <Feather name="plus-circle" size={17} color={Colors.needleGreen} />
                      </View>
                      <View style={styles.moduleCopy}>
                        <Text style={styles.moduleTitle}>Custom tape points</Text>
                        <Text style={styles.moduleSubtitle}>
                          Add any named point your tailor asked for.
                        </Text>
                      </View>
                    </View>
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
                      <TouchableOpacity
                        style={styles.customRemoveBtn}
                        onPress={() => removeCustomMeasurement(m.id)}
                      >
                        <Text style={styles.customRemoveText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                    <View style={styles.customActionsRow}>
                      <TouchableOpacity
                        style={styles.addCustomBtn}
                        onPress={() => addCustomMeasurement()}
                      >
                        <Text style={styles.addCustomText}>+ Blank point</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.addCustomBtn}
                        onPress={() => setCustomMeasurementSheetOpen(true)}
                      >
                        <Text style={styles.addCustomText}>Choose preset</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                <DisclosureSection
                  title="How Drapeon uses these"
                  summary="Core values help quotes start faster. Specialist and custom points stay available when the garment needs them."
                  tone="info"
                  icon="shield"
                >
                  <Text style={styles.disclosureText}>
                    Only reviewed measurements save to your Fit Passport. Tailors can still request
                    tape checks before cutting high-risk garments.
                  </Text>
                </DisclosureSection>
              </View>
            )}

            {/* ── Step 1: Garment context ── */}
            {step === 1 && (
              <View style={styles.optionList}>
                {GARMENT_CONTEXT_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionCard,
                      garmentContext === opt.value && styles.optionCardActive,
                    ]}
                    onPress={() => setGarmentContext(opt.value)}
                  >
                    <View
                      style={[
                        styles.optionRadio,
                        garmentContext === opt.value && styles.optionRadioActive,
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          garmentContext === opt.value && styles.optionLabelActive,
                        ]}
                      >
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
                {BODY_SHAPE_OPTIONS.map((opt) => {
                  const active = bodyShapes.includes(opt.value)
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.optionCard, active && styles.optionCardActive]}
                      onPress={() => toggleBodyShape(opt.value)}
                    >
                      <View style={[styles.optionCheck, active && styles.optionCheckActive]}>
                        {active && <Text style={styles.optionCheckMark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                          {opt.label}
                        </Text>
                        {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  )
                })}
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
                          <Text style={[styles.flagLabel, active && styles.flagLabelActive]}>
                            {opt.label}
                          </Text>
                          <Text style={styles.flagHint}>{opt.hint}</Text>
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <Input
                  label="Anything else your tailor needs to know?"
                  placeholder='e.g. "I will wear braids for this event, and I prefer modest necklines with a little sleeve ease."'
                  value={bodyNote}
                  onChangeText={(v) => {
                    setBodyNote(v)
                    if (bodyNoteError) validateBodyNote(v)
                  }}
                  onBlur={() => validateBodyNote(bodyNote)}
                  error={bodyNoteError}
                  hint="No contact details."
                  maxLength={280}
                  showCharacterCount
                  multiline
                  numberOfLines={3}
                  filterContact
                />
              </View>
            )}
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom + Spacing.sm, 12) }]}>
          <Button
            label={step < 3 ? 'Continue' : 'Save measurements'}
            size="md"
            onPress={next}
            loading={saving}
            disabled={saving}
          />
        </View>
      </KeyboardAvoidingView>
      <ChoiceSheet
        visible={profileSheetOpen}
        title="Choose profile"
        subtitle="Use a saved wearer profile, or keep editing the current one."
        options={profileOptions}
        selectedValue={selectedProfile?.id ?? 'current'}
        onClose={() => setProfileSheetOpen(false)}
        onSelect={(value) => {
          if (value === 'current') {
            setProfileSheetOpen(false)
            return
          }
          const profile = measurementProfiles.find((item) => item.id === value)
          if (profile) applyMeasurementProfile(profile)
        }}
      />
      <ChoiceSheet
        visible={measurementSourceSheetOpen}
        title="How were these taken?"
        subtitle="This helps Drapeon and tailors understand how much tape-checking the profile needs."
        options={MEASUREMENT_SOURCE_OPTIONS.map((option) => ({
          value: option.value,
          title: option.label,
          body: option.hint,
          icon: (option.value.includes('VISION') ? 'aperture' : 'clipboard') as keyof typeof Feather.glyphMap,
        }))}
        selectedValue={measurementSource}
        onClose={() => setMeasurementSourceSheetOpen(false)}
        onSelect={(value) => {
          if (isMeasurementSource(value)) setMeasurementSource(value)
          setMeasurementSourceSheetOpen(false)
        }}
      />
      <ChoiceSheet
        visible={measurementModuleSheetOpen}
        title="Add measurement area"
        subtitle="Pick the extra detail this garment or wearer needs."
        options={MEASUREMENT_MODULE_OPTIONS}
        selectedValues={visibleMeasurementModules}
        multiple
        doneLabel="Use selected"
        onClose={() => setMeasurementModuleSheetOpen(false)}
        onDone={() => setMeasurementModuleSheetOpen(false)}
        onSelect={(value) => toggleMeasurementModule(value as MeasurementModuleKey)}
      />
      <ChoiceSheet
        visible={customMeasurementSheetOpen}
        title="Add custom tape point"
        subtitle="Common tailor-requested points. You can still add a blank one."
        options={customMeasurementOptions}
        onClose={() => setCustomMeasurementSheetOpen(false)}
        onSelect={(value) => {
          addSuggestedMeasurement(value)
          setVisibleMeasurementModules((previous) =>
            previous.includes('custom') ? previous : [...previous, 'custom']
          )
        }}
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.sm,
  },
  stateEyebrow: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  stateHint: { fontSize: 13, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
    minHeight: 44,
  },
  backButton: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backText: { color: PRIMARY_GREEN, fontSize: 14, fontWeight: FontWeight.medium },
  stepIndicator: { fontSize: 13, color: MUTED_GREY },
  headerSpacer: { width: 44, height: 44 },

  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.lg, marginBottom: 6 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegmentDone: { backgroundColor: PRIMARY_GREEN },
  errorRetry: {
    backgroundColor: PRIMARY_GREEN,
    borderRadius: Radius.full,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xxxl,
    minHeight: 44,
    justifyContent: 'center',
  },
  errorRetryText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  errorSecondary: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xxxl,
    minHeight: 44,
    justifyContent: 'center',
  },
  errorSecondaryText: { color: CHARCOAL, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorLink: {
    marginTop: 4,
    color: PRIMARY_GREEN,
    fontSize: 13,
    fontWeight: FontWeight.medium,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 80 },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.md },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  guideCloseText: { fontSize: 18, lineHeight: 18, color: Colors.midGrey },
  guideEyebrow: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideCopy: {
    fontSize: 13,
    color: Colors.inkLight,
    lineHeight: 18,
  },

  stepHeading: { gap: 6 },
  stepTitle: {
    fontSize: 20,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  stepSub: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },

  // Layer 1 — measurements
  fields: { gap: Spacing.md },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.full,
    padding: 3,
    alignSelf: 'flex-start',
  },
  unitBtn: {
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: Radius.full,
    justifyContent: 'center',
  },
  unitBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  unitLabel: { fontSize: 13, color: MUTED_GREY, fontWeight: FontWeight.medium },
  unitLabelActive: { color: CHARCOAL },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  measureField: { width: '48%' },
  measureInput: { marginBottom: 0 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    marginBottom: 6,
    fontFamily: Fonts.display,
  },
  visionPassportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
    ...Shadow.sm,
  },
  visionPassportIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  visionPassportCopy: {
    flex: 1,
    gap: 2,
  },
  visionPassportTitle: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  visionPassportText: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  passportSummaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  passportSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  summaryTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  smallAction: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  smallActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
  },
  profileMeta: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  sourceSelector: {
    minHeight: 42,
    flex: 1,
    minWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
  },
  sourceSelectorText: {
    flexShrink: 1,
    fontSize: FontSize.xs,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  moduleCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  moduleIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  moduleCopy: { flex: 1, gap: 2 },
  moduleTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  moduleSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  addMoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  addMoreCopy: { flex: 1, gap: 3 },
  addMoreTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    fontFamily: Fonts.display,
  },
  addMoreText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  addMoreButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: Radius.full,
    backgroundColor: PRIMARY_GREEN,
    paddingHorizontal: Spacing.md,
  },
  addMoreButtonText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  customActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  disclosureText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.inkLight,
  },

  fitStyleSection: { gap: 6 },
  fitStyleRow: { flexDirection: 'row', gap: 8 },
  fitStyleBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitStyleBtnActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  fitStyleLabel: { fontSize: 13, fontWeight: FontWeight.medium, color: Colors.inkLight },
  fitStyleLabelActive: { color: PRIMARY_GREEN },

  // Custom measurements
  customSection: { gap: 8 },
  customHint: { fontSize: 12, color: MUTED_GREY, lineHeight: 16, marginTop: -2 },
  customSuggestionGroup: {
    gap: 6,
    marginTop: 4,
  },
  customSuggestionGroupTitle: {
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  customSuggestionList: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginTop: 2,
  },
  customSuggestionRow: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  customSuggestionText: {
    fontSize: 12,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customNameField: { flex: 2 },
  customValueField: { flex: 1 },
  customRemoveBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  customRemoveText: { fontSize: 13, color: MUTED_GREY },
  addCustomBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.needleGreen,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  addCustomText: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },

  // Layers 2 + 3 — option cards
  optionList: { gap: 8 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  optionCardActive: { borderColor: PRIMARY_GREEN, backgroundColor: Colors.needleGreenLight },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  optionRadioActive: { borderColor: PRIMARY_GREEN, backgroundColor: PRIMARY_GREEN },
  optionCheck: {
    width: 22,
    height: 22,
    borderRadius: 4,
    marginTop: 2,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCheckActive: { borderColor: PRIMARY_GREEN, backgroundColor: PRIMARY_GREEN },
  optionCheckMark: { color: Colors.textInverse, fontSize: 12, fontWeight: FontWeight.bold },
  optionLabel: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
    fontFamily: Fonts.display,
  },
  optionLabelActive: { color: PRIMARY_GREEN },
  optionHint: { fontSize: 12, color: MUTED_GREY, marginTop: 2, lineHeight: 16 },

  // Layer 4 — fit flags
  flagGrid: { gap: 8 },
  flagCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  flagCardActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRustLight },
  flagCheck: {
    width: 22,
    height: 22,
    borderRadius: 4,
    marginTop: 1,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagCheckActive: { borderColor: Colors.kanteRust, backgroundColor: Colors.kanteRust },
  flagCheckMark: { color: Colors.textInverse, fontSize: 12, fontWeight: FontWeight.bold },
  flagLabel: {
    fontSize: 13,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
    fontFamily: Fonts.display,
  },
  flagLabelActive: { color: Colors.kanteRust },
  flagHint: { fontSize: 12, color: MUTED_GREY, marginTop: 2, lineHeight: 16 },

  // CTA
  cta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 8,
    paddingBottom: 8,
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
})

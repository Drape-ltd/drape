import type { DrapeVisionMeasurementField } from '@drape/drape-vision'
import { colors, darkColors } from '@drape/shared/design-system'

export const DRAPE_VISION_ROUTE = '/vision' as const

export const DRAPE_VISION_COLORS = {
  screen: darkColors.background,
  panel: darkColors.surface,
  panelSoft: colors.surfaceDark,
  line: darkColors.border,
  text: colors.textInverse,
  textMuted: darkColors.textSecondary,
  textDim: darkColors.textMuted,
} as const

export const DRAPE_VISION_MODES = [
  'customer_scan',
  'tailor_client_scan',
  'garment_qc',
  'size_guide_scan',
] as const

export const DRAPE_VISION_BODY_SCAN_MODES = ['customer_scan', 'tailor_client_scan'] as const

export type DrapeVisionMode = (typeof DRAPE_VISION_MODES)[number]

export type DrapeVisionModeMeta = {
  eyebrow: string
  title: string
  subtitle: string
  destinationTitle: string
  destinationBody: string
  primaryLabel: string
  fallbackRoute: string
  icon: 'aperture' | 'user-check' | 'shield' | 'grid'
}

export const DRAPE_VISION_MODE_META: Record<DrapeVisionMode, DrapeVisionModeMeta> = {
  customer_scan: {
    eyebrow: 'Fit Passport',
    title: 'Drape Vision for your measurements',
    subtitle: 'Your measurement profile will power custom orders, ready-made fit checks, and tailor briefs from one place.',
    destinationTitle: 'Saved to your profile',
    destinationBody: 'Vision measurements flow into your measurement profile, custom order measurement step, ready-made fit guide, and every tailor brief you approve.',
    primaryLabel: 'Open measurements',
    fallbackRoute: '/(customer)/profile/measurements',
    icon: 'aperture',
  },
  tailor_client_scan: {
    eyebrow: 'Tailor assisted',
    title: 'Measure a client into Drape',
    subtitle: 'Capture a client with consent, keep the session in Diary, then invite them to claim their Fit Passport.',
    destinationTitle: 'Saved to Diary',
    destinationBody: 'Tailor-assisted scans will prefill the client diary, preserve fitting context, and create a claimable passport without storing raw video.',
    primaryLabel: 'Open client diary',
    fallbackRoute: '/(tailor)/clients/diary/new',
    icon: 'user-check',
  },
  garment_qc: {
    eyebrow: 'Garment QC',
    title: 'Verify fit before handoff',
    subtitle: 'Use Vision as a production check for final measurements, symmetry, and dispatch confidence.',
    destinationTitle: 'Saved to the order',
    destinationBody: 'Garment QC results belong in the production timeline so ops, tailor, and customer can all see the same verified handoff state.',
    primaryLabel: 'Return to order',
    fallbackRoute: '/(tailor)/orders',
    icon: 'shield',
  },
  size_guide_scan: {
    eyebrow: 'Ready-made sizing',
    title: 'Build a listing size guide',
    subtitle: 'Scan finished garments so shoppers understand real fit before they buy.',
    destinationTitle: 'Saved to the listing',
    destinationBody: 'Size guide scans attach to ready-made listings and improve fit matching for shoppers using their Fit Passport.',
    primaryLabel: 'Open shop',
    fallbackRoute: '/(tailor)/shop',
    icon: 'grid',
  },
}

export const DRAPE_VISION_CAPABILITIES = [
  {
    title: 'Customer Fit Passport',
    body: 'Vision measurements carry into profiles, custom orders, ready-made fit checks, and tailor briefs.',
    icon: 'aperture',
  },
  {
    title: 'Tailor-assisted scans',
    body: 'Tailors can measure walk-in, home, or event clients into Diary before passport claim.',
    icon: 'user-check',
  },
  {
    title: 'Garment QC',
    body: 'Tailors can verify finished work before collection, dispatch, or ready-made listing.',
    icon: 'shield',
  },
] as const

export const DRAPE_VISION_PRIVACY_POINTS = [
  'Video stays in memory and is never written to the photo library.',
  'Landmarks are cleared after measurement calculation.',
  'Only final measurement values are saved to Drape.',
] as const

export const DRAPE_VISION_CALCULATION_MESSAGES = [
  'Detecting body landmarks...',
  'Calibrating with your height...',
  'Fitting measurement model...',
  'Calculating circumference...',
  'Finalising your profile...',
] as const

export const DRAPE_VISION_HEIGHT_STEP_CM = 1

export const DRAPE_VISION_HEIGHT_STEP_INCHES = 1

export const DRAPE_VISION_MEASUREMENT_LABELS: Record<DrapeVisionMeasurementField, string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulder width',
  sleeveLength: 'Sleeve length',
  backLength: 'Back length',
  neckCircumference: 'Neck',
  underBust: 'Under bust',
  inseam: 'Inseam',
  outseam: 'Outseam',
  thighCircumference: 'Thigh',
  kneeCircumference: 'Knee',
  bicepCircumference: 'Bicep',
  wristCircumference: 'Wrist',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  height: 'Height',
  torsoLength: 'Torso length',
}

export const DRAPE_VISION_RESULT_FIELDS: DrapeVisionMeasurementField[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'sleeveLength',
  'backLength',
  'inseam',
  'outseam',
]

export function isDrapeVisionMode(value: unknown): value is DrapeVisionMode {
  return typeof value === 'string' && DRAPE_VISION_MODES.includes(value as DrapeVisionMode)
}

export function isDrapeVisionBodyScanMode(value: DrapeVisionMode) {
  return DRAPE_VISION_BODY_SCAN_MODES.includes(value as (typeof DRAPE_VISION_BODY_SCAN_MODES)[number])
}

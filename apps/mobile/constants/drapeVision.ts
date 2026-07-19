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

export const DRAPE_VISION_DEFERRED_MODES = [
  'tailor_client_scan',
  'garment_qc',
  'size_guide_scan',
] as const

export const DRAPE_VISION_BODY_SCAN_MODES = ['customer_scan', 'tailor_client_scan'] as const

export type DrapeVisionMode = (typeof DRAPE_VISION_MODES)[number]

export type DrapeVisionSpecialistScanMode =
  | 'fit_360'
  | 'hand_wrist'
  | 'headwear'
  | 'bodice_corset'
  | 'lower_body_detail'

export type DrapeVisionSpecialistScanMeta = {
  mode: DrapeVisionSpecialistScanMode
  title: string
  subtitle: string
  status: 'active' | 'planned_ios_first'
  icon:
    | 'rotate-360'
    | 'hand-front-right-outline'
    | 'hat-fedora'
    | 'human-female'
    | 'human-male-height-variant'
  fields: readonly DrapeVisionMeasurementField[]
}

export const DRAPE_VISION_SPECIALIST_SCAN_MODULES: readonly DrapeVisionSpecialistScanMeta[] = [
  {
    mode: 'fit_360',
    title: 'Fit 360',
    subtitle: 'A guided turn for chest, waist, hips, and shoulder width.',
    status: 'active',
    icon: 'rotate-360',
    fields: ['chest', 'waist', 'hips', 'shoulderWidth'],
  },
  {
    mode: 'hand_wrist',
    title: 'Hand/Wrist Scan',
    subtitle: 'For cuff, bracelet, bangle, wrist, palm, and sleeve-opening fit.',
    status: 'active',
    icon: 'hand-front-right-outline',
    fields: ['wristCircumference', 'palmWidth', 'palmLength', 'sleeveOpening', 'banglePassOver'],
  },
  {
    mode: 'headwear',
    title: 'Headwear Scan',
    subtitle: 'For fila, gele, hats, bands, and headwear prep.',
    status: 'active',
    icon: 'hat-fedora',
    fields: [
      'headCircumference',
      'hatBandLine',
      'headLength',
      'headWidth',
      'earToEarOverCrown',
      'frontToBackOverCrown',
      'filaHeight',
    ],
  },
  {
    mode: 'bodice_corset',
    title: 'Bodice/Corset Scan',
    subtitle: 'For corsets, fitted bodices, bust fit, ribcage, waist, and torso detail.',
    status: 'active',
    icon: 'human-female',
    fields: ['underBust', 'chest', 'waist', 'shoulderWidth', 'torsoLength', 'backLength', 'bicepCircumference'],
  },
  {
    mode: 'lower_body_detail',
    title: 'Lower Body Detail',
    subtitle: 'For trousers, hems, thigh, knee, inseam, outseam, and ankle fit.',
    status: 'active',
    icon: 'human-male-height-variant',
    fields: ['thighCircumference', 'kneeCircumference', 'inseam', 'outseam', 'ankleHemOpening'],
  },
]

export const DRAPE_VISION_FIELD_SCAN_MODULES: Partial<Record<DrapeVisionMeasurementField, DrapeVisionSpecialistScanMode>> = {
  wristCircumference: 'hand_wrist',
  palmWidth: 'hand_wrist',
  palmLength: 'hand_wrist',
  sleeveOpening: 'hand_wrist',
  banglePassOver: 'hand_wrist',
  headCircumference: 'headwear',
  hatBandLine: 'headwear',
  headLength: 'headwear',
  headWidth: 'headwear',
  earToEarOverCrown: 'headwear',
  frontToBackOverCrown: 'headwear',
  filaHeight: 'headwear',
  underBust: 'bodice_corset',
  bicepCircumference: 'bodice_corset',
  kneeCircumference: 'lower_body_detail',
  ankleHemOpening: 'lower_body_detail',
}

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
    eyebrow: 'Fit profile',
    title: 'Create your Drapeon Vision profile',
    subtitle: 'A guided turn helps estimate your core measurements for custom orders, ready-made fit checks, and tailor briefs.',
    destinationTitle: 'Saved to your profile',
    destinationBody: 'Reviewed measurements flow into your profile, custom orders, ready-made fit guide, and every tailor brief you approve.',
    primaryLabel: 'Open measurements',
    fallbackRoute: '/(customer)/profile/measurements',
    icon: 'aperture',
  },
  tailor_client_scan: {
    eyebrow: 'Tailor Guide',
    title: 'Guide a client Vision scan',
    subtitle: 'Capture an in-person or remote client with consent, keep the draft in Diary, then invite them to claim their fit profile.',
    destinationTitle: 'Saved to Diary',
    destinationBody: 'Tailor Guide drafts prefill the client diary, preserve fitting context, and create a claimable fit profile without storing raw video.',
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
    destinationBody: 'Size guide scans attach to ready-made listings and improve fit matching for shoppers using their fit profile.',
    primaryLabel: 'Open shop',
    fallbackRoute: '/(tailor)/shop',
    icon: 'grid',
  },
}

export const DRAPE_VISION_CAPABILITIES = [
  {
    title: 'Vision measurements',
    body: 'Core measurements carry into profiles, custom orders, ready-made fit checks, and tailor briefs.',
    icon: 'aperture',
  },
] as const

export const DRAPE_VISION_PRIVACY_POINTS = [
  'No scan video is saved or uploaded.',
  'Body shape data is processed on your device and cleared after scanning.',
  'Only measurements you review are saved; photos save only when you attach one.',
] as const

export const DRAPE_VISION_CALCULATION_MESSAGES = [
  'Reading your proportions...',
  'Building your fit profile...',
  'Checking the key measurements...',
  'Preparing your results...',
  'Almost there...',
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
  palmWidth: 'Palm width',
  palmLength: 'Palm length',
  sleeveOpening: 'Sleeve opening',
  banglePassOver: 'Bangle pass-over',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  height: 'Height',
  torsoLength: 'Torso length',
  ankleHemOpening: 'Ankle / hem opening',
}

export const DRAPE_VISION_RESULT_FIELDS: DrapeVisionMeasurementField[] = [
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'sleeveLength',
  'backLength',
  'torsoLength',
  'inseam',
  'outseam',
  'thighCircumference',
  'kneeCircumference',
  'neckCircumference',
  'underBust',
  'bicepCircumference',
  'wristCircumference',
  'palmWidth',
  'palmLength',
  'sleeveOpening',
  'banglePassOver',
  'headCircumference',
  'hatBandLine',
  'headLength',
  'headWidth',
  'earToEarOverCrown',
  'frontToBackOverCrown',
  'filaHeight',
  'ankleHemOpening',
]

export function isDrapeVisionMode(value: unknown): value is DrapeVisionMode {
  return typeof value === 'string' && DRAPE_VISION_MODES.includes(value as DrapeVisionMode)
}

export function isDrapeVisionDeferredMode(value: DrapeVisionMode) {
  return DRAPE_VISION_DEFERRED_MODES.includes(
    value as (typeof DRAPE_VISION_DEFERRED_MODES)[number],
  )
}

export function isDrapeVisionBodyScanMode(value: DrapeVisionMode) {
  return DRAPE_VISION_BODY_SCAN_MODES.includes(value as (typeof DRAPE_VISION_BODY_SCAN_MODES)[number])
}

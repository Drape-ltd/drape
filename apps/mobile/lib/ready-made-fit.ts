import type { MeasurementFieldKey } from '@/lib/order-support'

export type ReadyMadeFitUnit = 'in' | 'cm'
export type ReadyMadeFitFieldKey = MeasurementFieldKey
export type ReadyMadeSizeGuideAdvice = 'SIZE_UP_IF_BETWEEN' | 'SIZE_DOWN_IF_BETWEEN' | 'ASK_SELLER'

export type ReadyMadeFitRange = {
  min: number | null
  max: number | null
}

export type ReadyMadeSizeGuide = {
  version: 1
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  sizeRanges: Record<string, Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>>>
  fitNotes: string | null
  stretchNotes: string | null
  sizeAdvice: ReadyMadeSizeGuideAdvice | null
}

export type ReadyMadeSizeGuideDraft = Record<
  string,
  Partial<Record<ReadyMadeFitFieldKey, { min: string; max: string }>>
>

export type ReadyMadeSizeRecommendation =
  | {
      status: 'MISSING_GUIDE'
      summary: string
      detail: string
      size: null
      secondarySize: null
      matchedFields: ReadyMadeFitFieldKey[]
      missingCustomerFields: ReadyMadeFitFieldKey[]
      confidence: 'LOW'
    }
  | {
      status: 'MISSING_MEASUREMENTS'
      summary: string
      detail: string
      size: null
      secondarySize: null
      matchedFields: ReadyMadeFitFieldKey[]
      missingCustomerFields: ReadyMadeFitFieldKey[]
      confidence: 'LOW'
    }
  | {
      status: 'NO_MATCH'
      summary: string
      detail: string
      size: null
      secondarySize: null
      matchedFields: ReadyMadeFitFieldKey[]
      missingCustomerFields: ReadyMadeFitFieldKey[]
      confidence: 'LOW'
    }
  | {
      status: 'RECOMMENDED' | 'BETWEEN'
      summary: string
      detail: string
      size: string
      secondarySize: string | null
      matchedFields: ReadyMadeFitFieldKey[]
      missingCustomerFields: ReadyMadeFitFieldKey[]
      confidence: 'HIGH' | 'MEDIUM' | 'LOW'
    }

type RecommendationInput = {
  guide: ReadyMadeSizeGuide | null | undefined
  measurements: Record<string, unknown> | null | undefined
  sizes?: string[]
}

const FALLBACK_FIELDS: ReadyMadeFitFieldKey[] = ['chest', 'waist', 'hips']

export const READY_MADE_FIT_FIELDS: Array<{
  key: ReadyMadeFitFieldKey
  label: string
  shortLabel: string
}> = [
  { key: 'chest', label: 'Chest', shortLabel: 'Chest' },
  { key: 'waist', label: 'Waist', shortLabel: 'Waist' },
  { key: 'hips', label: 'Hips', shortLabel: 'Hips' },
  { key: 'shoulderWidth', label: 'Shoulders', shortLabel: 'Shoulders' },
  { key: 'inseam', label: 'Inseam', shortLabel: 'Inseam' },
  { key: 'sleeveLength', label: 'Sleeve length', shortLabel: 'Sleeve' },
  { key: 'neckCircumference', label: 'Neck', shortLabel: 'Neck' },
  { key: 'underBust', label: 'Under bust', shortLabel: 'Under bust' },
  { key: 'height', label: 'Height', shortLabel: 'Height' },
  { key: 'backLength', label: 'Back length', shortLabel: 'Back' },
  { key: 'outseam', label: 'Outseam', shortLabel: 'Outseam' },
  { key: 'thighCircumference', label: 'Thigh', shortLabel: 'Thigh' },
  { key: 'kneeCircumference', label: 'Knee', shortLabel: 'Knee' },
  { key: 'bicepCircumference', label: 'Bicep', shortLabel: 'Bicep' },
  { key: 'wristCircumference', label: 'Wrist', shortLabel: 'Wrist' },
  { key: 'headCircumference', label: 'Head circumference', shortLabel: 'Head' },
  { key: 'hatBandLine', label: 'Hat band line', shortLabel: 'Hat band' },
  { key: 'headLength', label: 'Head length', shortLabel: 'Head length' },
  { key: 'headWidth', label: 'Head width', shortLabel: 'Head width' },
  { key: 'earToEarOverCrown', label: 'Ear to ear over crown', shortLabel: 'Crown ear-to-ear' },
  { key: 'frontToBackOverCrown', label: 'Front to back over crown', shortLabel: 'Crown front-back' },
  { key: 'filaHeight', label: 'Fila height', shortLabel: 'Fila height' },
  { key: 'torsoLength', label: 'Torso length', shortLabel: 'Torso' },
]

export const READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS: Array<{
  value: ReadyMadeSizeGuideAdvice
  label: string
  hint: string
}> = [
  {
    value: 'SIZE_UP_IF_BETWEEN',
    label: 'Size up if between',
    hint: 'Good for fitted pieces or when the fabric has very little stretch.',
  },
  {
    value: 'SIZE_DOWN_IF_BETWEEN',
    label: 'Size down if between',
    hint: 'Good for relaxed cuts or when the fabric has stretch.',
  },
  {
    value: 'ASK_SELLER',
    label: 'Ask seller if between',
    hint: 'Use this when fit depends on styling or how the piece is cut.',
  },
]

const CATEGORY_FIELD_MAP: Record<string, ReadyMadeFitFieldKey[]> = {
  agbada: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  kaftan: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  suit: ['chest', 'waist', 'shoulderWidth', 'sleeveLength', 'inseam', 'outseam'],
  dress: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  crochet: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  'ready-made': ['chest', 'waist', 'hips'],
  'two-piece set': ['chest', 'waist', 'hips', 'inseam', 'outseam'],
  trousers: ['waist', 'hips', 'inseam', 'outseam', 'thighCircumference'],
  skirt: ['waist', 'hips', 'height'],
  shirt: ['chest', 'shoulderWidth', 'sleeveLength', 'neckCircumference'],
  'native wear': ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  headwear: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  hat: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  cap: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  fila: ['headCircumference', 'hatBandLine', 'earToEarOverCrown', 'frontToBackOverCrown', 'filaHeight'],
  gele: ['headCircumference', 'hatBandLine'],
}

const FIT_FIELD_SET = new Set<ReadyMadeFitFieldKey>(READY_MADE_FIT_FIELDS.map((field) => field.key))

function asFinitePositive(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function sizeOrderIndex(sizes: string[], size: string) {
  const index = sizes.findIndex((value) => value === size)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function fieldLabel(field: ReadyMadeFitFieldKey) {
  return READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field
}

function normalizedRange(raw: unknown): ReadyMadeFitRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  let min = asFinitePositive((raw as Record<string, unknown>).min)
  let max = asFinitePositive((raw as Record<string, unknown>).max)

  if (min == null && max == null) return null
  if (min != null && max != null && max < min) {
    const nextMin = max
    max = min
    min = nextMin
  }

  return { min, max }
}

function normalizeFields(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((field): field is ReadyMadeFitFieldKey => typeof field === 'string' && FIT_FIELD_SET.has(field as ReadyMadeFitFieldKey))
    .filter((field, index, all) => all.indexOf(field) === index)
}

function comparableGuideFields(
  guide: ReadyMadeSizeGuide,
  sizes: string[],
) {
  return guide.fields.filter((field) =>
    sizes.some((size) => {
      const range = guide.sizeRanges[size]?.[field]
      return Boolean(range && (range.min != null || range.max != null))
    }),
  )
}

function convertMeasurementUnit(value: number, fromUnit: ReadyMadeFitUnit, toUnit: ReadyMadeFitUnit) {
  if (fromUnit === toUnit) return value
  if (fromUnit === 'in' && toUnit === 'cm') return Number((value * 2.54).toFixed(2))
  return Number((value / 2.54).toFixed(2))
}

function measurementValue(
  measurements: Record<string, unknown> | null | undefined,
  field: ReadyMadeFitFieldKey,
  targetUnit: ReadyMadeFitUnit,
) {
  if (!measurements) return null
  const rawValue = measurements[field]
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) return null
  const sourceUnit = measurements.unit === 'cm' ? 'cm' : 'in'
  return convertMeasurementUnit(rawValue, sourceUnit, targetUnit)
}

function rangeDelta(value: number, range: ReadyMadeFitRange) {
  if (range.min != null && value < range.min) return Number((range.min - value).toFixed(2))
  if (range.max != null && value > range.max) return Number((value - range.max).toFixed(2))
  return 0
}

function buildBetweenSizesDetail(
  advice: ReadyMadeSizeGuideAdvice | null,
  lowerSize: string,
  upperSize: string,
) {
  if (advice === 'SIZE_UP_IF_BETWEEN') {
    return `You sit between ${lowerSize} and ${upperSize}. This seller recommends sizing up when someone lands between two sizes.`
  }
  if (advice === 'SIZE_DOWN_IF_BETWEEN') {
    return `You sit between ${lowerSize} and ${upperSize}. This seller recommends sizing down when someone lands between two sizes.`
  }
  return `You sit between ${lowerSize} and ${upperSize}. Ask the seller if you want a second opinion before you pay.`
}

export function recommendedFitFieldsForCategory(category: string | null | undefined) {
  const normalized = category?.trim().toLowerCase() ?? ''
  return CATEGORY_FIELD_MAP[normalized] ?? FALLBACK_FIELDS
}

export function emptyReadyMadeSizeGuide(unit: ReadyMadeFitUnit = 'in'): ReadyMadeSizeGuide {
  return {
    version: 1,
    unit,
    fields: [],
    sizeRanges: {},
    fitNotes: null,
    stretchNotes: null,
    sizeAdvice: 'ASK_SELLER',
  }
}

export function normalizeReadyMadeSizeGuide(
  raw: unknown,
  sizes: string[],
): ReadyMadeSizeGuide {
  const base = emptyReadyMadeSizeGuide()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base

  const value = raw as Record<string, unknown>
  const fields = normalizeFields(value.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}

  for (const size of sizes) {
    const rawSizeRanges = value.sizeRanges && typeof value.sizeRanges === 'object' && !Array.isArray(value.sizeRanges)
      ? (value.sizeRanges as Record<string, unknown>)[size]
      : null

    if (!rawSizeRanges || typeof rawSizeRanges !== 'object' || Array.isArray(rawSizeRanges)) continue

    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const range = normalizedRange((rawSizeRanges as Record<string, unknown>)[field])
      if (range) nextRanges[field] = range
    }

    if (Object.keys(nextRanges).length > 0) {
      sizeRanges[size] = nextRanges
    }
  }

  const unit = value.unit === 'cm' ? 'cm' : 'in'
  const fitNotes = typeof value.fitNotes === 'string' && value.fitNotes.trim().length > 0 ? value.fitNotes.trim() : null
  const stretchNotes = typeof value.stretchNotes === 'string' && value.stretchNotes.trim().length > 0 ? value.stretchNotes.trim() : null
  const sizeAdvice =
    value.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ||
    value.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ||
    value.sizeAdvice === 'ASK_SELLER'
      ? value.sizeAdvice
      : 'ASK_SELLER'

  return {
    version: 1,
    unit,
    fields,
    sizeRanges,
    fitNotes,
    stretchNotes,
    sizeAdvice,
  }
}

export function hasReadyMadeSizeGuide(guide: ReadyMadeSizeGuide | null | undefined, sizes?: string[]) {
  if (!guide) return false
  const relevantSizes = sizes?.length ? sizes : Object.keys(guide.sizeRanges)
  if (guide.fields.length === 0 || relevantSizes.length === 0) return false

  return relevantSizes.some((size) =>
    guide.fields.some((field) => {
      const range = guide.sizeRanges[size]?.[field]
      return Boolean(range && (range.min != null || range.max != null))
    }),
  )
}

export function guideDraftFromSizeGuide(input: {
  sizes: string[]
  fields: ReadyMadeFitFieldKey[]
  guide: ReadyMadeSizeGuide | null | undefined
}): ReadyMadeSizeGuideDraft {
  const normalizedGuide = input.guide ?? emptyReadyMadeSizeGuide()
  const nextDraft: ReadyMadeSizeGuideDraft = {}

  for (const size of input.sizes) {
    nextDraft[size] = {}
    for (const field of input.fields) {
      const range = normalizedGuide.sizeRanges[size]?.[field]
      nextDraft[size][field] = {
        min: range?.min != null ? String(range.min) : '',
        max: range?.max != null ? String(range.max) : '',
      }
    }
  }

  return nextDraft
}

export function draftToReadyMadeSizeGuide(input: {
  sizes: string[]
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  draft: ReadyMadeSizeGuideDraft
  fitNotes: string
  stretchNotes: string
  sizeAdvice: ReadyMadeSizeGuideAdvice | null
}): ReadyMadeSizeGuide {
  const fields = normalizeFields(input.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}

  for (const size of input.sizes) {
    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const rangeDraft = input.draft[size]?.[field]
      const range = normalizedRange({
        min: typeof rangeDraft?.min === 'string' && rangeDraft.min.trim().length > 0 ? Number(rangeDraft.min) : null,
        max: typeof rangeDraft?.max === 'string' && rangeDraft.max.trim().length > 0 ? Number(rangeDraft.max) : null,
      })
      if (range) nextRanges[field] = range
    }
    if (Object.keys(nextRanges).length > 0) {
      sizeRanges[size] = nextRanges
    }
  }

  return {
    version: 1,
    unit: input.unit,
    fields,
    sizeRanges,
    fitNotes: input.fitNotes.trim() || null,
    stretchNotes: input.stretchNotes.trim() || null,
    sizeAdvice: input.sizeAdvice ?? 'ASK_SELLER',
  }
}

export function formatFitRange(range: ReadyMadeFitRange | null | undefined, unit: ReadyMadeFitUnit) {
  if (!range) return null
  if (range.min != null && range.max != null) return `${range.min}-${range.max} ${unit}`
  if (range.min != null) return `${range.min}+ ${unit}`
  if (range.max != null) return `Up to ${range.max} ${unit}`
  return null
}

export function recommendReadyMadeSize(input: RecommendationInput): ReadyMadeSizeRecommendation {
  const guide = input.guide
  if (!guide || !hasReadyMadeSizeGuide(guide, input.sizes)) {
    return {
      status: 'MISSING_GUIDE',
      summary: 'Size recommendation unavailable',
      detail: 'This seller has not added a fit guide for this item yet.',
      size: null,
      secondarySize: null,
      matchedFields: [],
      missingCustomerFields: [],
      confidence: 'LOW',
    }
  }

  const sizes = (input.sizes?.length ? input.sizes : Object.keys(guide.sizeRanges)).filter((size) => size.trim().length > 0)
  const fields = comparableGuideFields(guide, sizes)

  if (fields.length === 0) {
    return {
      status: 'MISSING_GUIDE',
      summary: 'Size recommendation unavailable',
      detail: 'This seller has not finished setting up the fit guide for this item yet.',
      size: null,
      secondarySize: null,
      matchedFields: [],
      missingCustomerFields: [],
      confidence: 'LOW',
    }
  }

  const customerValues = Object.fromEntries(
    fields.map((field) => [field, measurementValue(input.measurements, field, guide.unit)]),
  ) as Partial<Record<ReadyMadeFitFieldKey, number | null>>

  const missingAcrossGuide = fields.filter((field) => customerValues[field] == null)
  if (missingAcrossGuide.length === fields.length) {
    return {
      status: 'MISSING_MEASUREMENTS',
      summary: 'Add your measurements for a size recommendation',
      detail: `Drapeon can suggest a size once you save the ${fields.map(fieldLabel).join(', ').toLowerCase()} measurements this seller uses.`,
      size: null,
      secondarySize: null,
      matchedFields: [],
      missingCustomerFields: missingAcrossGuide,
      confidence: 'LOW',
    }
  }

  const evaluations = sizes
    .map((size) => {
      const matchedFields: ReadyMadeFitFieldKey[] = []
      const missingCustomerFields: ReadyMadeFitFieldKey[] = []
      const usedFields: ReadyMadeFitFieldKey[] = []
      let outOfRangeCount = 0
      let distance = 0

      for (const field of fields) {
        const range = guide.sizeRanges[size]?.[field]
        if (!range) continue
        const value = customerValues[field]
        if (value == null) {
          missingCustomerFields.push(field)
          continue
        }
        usedFields.push(field)
        const delta = rangeDelta(value, range)
        if (delta === 0) {
          matchedFields.push(field)
        } else {
          outOfRangeCount += 1
          distance += delta
        }
      }

      return {
        size,
        matchedFields,
        missingCustomerFields,
        usedFields,
        comparableCount: usedFields.length,
        outOfRangeCount,
        distance: Number(distance.toFixed(2)),
      }
    })
    .filter((entry) => entry.comparableCount > 0)

  if (evaluations.length === 0) {
    return {
      status: 'MISSING_MEASUREMENTS',
      summary: 'Add your measurements for a size recommendation',
      detail: 'Drapeon does not have enough saved measurements yet to compare against this size guide.',
      size: null,
      secondarySize: null,
      matchedFields: [],
      missingCustomerFields: missingAcrossGuide,
      confidence: 'LOW',
    }
  }

  const perfectMatches = evaluations
    .filter((entry) => entry.outOfRangeCount === 0)
    .sort((left, right) => sizeOrderIndex(sizes, left.size) - sizeOrderIndex(sizes, right.size))

  if (perfectMatches.length > 0) {
    const primary =
      guide.sizeAdvice === 'SIZE_UP_IF_BETWEEN'
        ? perfectMatches[perfectMatches.length - 1]
        : perfectMatches[0]

    const secondary =
      perfectMatches.length > 1
        ? guide.sizeAdvice === 'SIZE_UP_IF_BETWEEN'
          ? perfectMatches[0]
          : perfectMatches[perfectMatches.length - 1]
        : null

    if (secondary && secondary.size !== primary.size) {
      const lowerSize = perfectMatches[0].size
      const upperSize = perfectMatches[perfectMatches.length - 1].size
      return {
        status: 'BETWEEN',
        summary: `You are between ${lowerSize} and ${upperSize}`,
        detail: buildBetweenSizesDetail(guide.sizeAdvice, lowerSize, upperSize),
        size: primary.size,
        secondarySize: secondary.size,
        matchedFields: primary.matchedFields,
        missingCustomerFields: primary.missingCustomerFields,
        confidence: primary.comparableCount >= 3 ? 'MEDIUM' : 'LOW',
      }
    }

    return {
      status: 'RECOMMENDED',
      summary: `Recommended size: ${primary.size}`,
      detail: `Based on ${primary.matchedFields.map(fieldLabel).join(', ').toLowerCase()}.`,
      size: primary.size,
      secondarySize: null,
      matchedFields: primary.matchedFields,
      missingCustomerFields: primary.missingCustomerFields,
      confidence: primary.comparableCount >= 3 ? 'HIGH' : 'MEDIUM',
    }
  }

  const nearest = [...evaluations].sort((left, right) => {
    if (left.outOfRangeCount !== right.outOfRangeCount) return left.outOfRangeCount - right.outOfRangeCount
    if (left.distance !== right.distance) return left.distance - right.distance
    return sizeOrderIndex(sizes, left.size) - sizeOrderIndex(sizes, right.size)
  })[0]

  if (nearest && nearest.matchedFields.length > 0) {
    return {
      status: 'RECOMMENDED',
      summary: `Closest size: ${nearest.size}`,
      detail: `Based on ${nearest.matchedFields.map(fieldLabel).join(', ').toLowerCase()}. Some measurements still sit outside this seller's fit guide.`,
      size: nearest.size,
      secondarySize: null,
      matchedFields: nearest.matchedFields,
      missingCustomerFields: nearest.missingCustomerFields,
      confidence: 'LOW',
    }
  }

  return {
    status: 'NO_MATCH',
    summary: 'No clear size match yet',
    detail: "Your saved measurements fall outside this seller's current fit guide. Ask a question before you pay if you are unsure.",
    size: null,
    secondarySize: null,
    matchedFields: [],
    missingCustomerFields: missingAcrossGuide,
    confidence: 'LOW',
  }
}

import { MEASUREMENT_FIELD_KEYS, type MeasurementFieldKey } from './measurement-profile'

export type ReadyMadeFitUnit = 'in' | 'cm'
export type ReadyMadeSizeGuideAdvice = 'SIZE_UP_IF_BETWEEN' | 'SIZE_DOWN_IF_BETWEEN' | 'ASK_SELLER'
export type ReadyMadeFitRange = { min: number | null; max: number | null }
export type ReadyMadeSizeGuide = {
  version: 1
  unit: ReadyMadeFitUnit
  fields: MeasurementFieldKey[]
  sizeRanges: Record<string, Partial<Record<MeasurementFieldKey, ReadyMadeFitRange>>>
  fitNotes: string | null
  stretchNotes: string | null
  sizeAdvice: ReadyMadeSizeGuideAdvice | null
}
export type ReadyMadeSizeRecommendation = {
  status: 'MISSING_GUIDE' | 'MISSING_MEASUREMENTS' | 'NO_MATCH' | 'RECOMMENDED' | 'BETWEEN'
  summary: string
  detail: string
  size: string | null
  secondarySize: string | null
  matchedFields: MeasurementFieldKey[]
  missingCustomerFields: MeasurementFieldKey[]
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export const READY_MADE_FIT_FIELDS: Array<{ key: MeasurementFieldKey; label: string }> = [
  { key: 'chest', label: 'Chest' }, { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' }, { key: 'shoulderWidth', label: 'Shoulders' },
  { key: 'inseam', label: 'Inseam' }, { key: 'sleeveLength', label: 'Sleeve length' },
  { key: 'neckCircumference', label: 'Neck' }, { key: 'underBust', label: 'Under bust' },
  { key: 'height', label: 'Height' }, { key: 'backLength', label: 'Back length' },
  { key: 'outseam', label: 'Outseam' }, { key: 'thighCircumference', label: 'Thigh' },
  { key: 'kneeCircumference', label: 'Knee' }, { key: 'bicepCircumference', label: 'Bicep' },
  { key: 'wristCircumference', label: 'Wrist' }, { key: 'headCircumference', label: 'Head circumference' },
  { key: 'hatBandLine', label: 'Hat band line' }, { key: 'headLength', label: 'Head length' },
  { key: 'headWidth', label: 'Head width' }, { key: 'earToEarOverCrown', label: 'Ear to ear over crown' },
  { key: 'frontToBackOverCrown', label: 'Front to back over crown' }, { key: 'filaHeight', label: 'Fila height' },
  { key: 'torsoLength', label: 'Torso length' },
]

const FIELD_SET = new Set<string>(MEASUREMENT_FIELD_KEYS)
const labelFor = (field: MeasurementFieldKey) => READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null

export function normalizeReadyMadeSizeGuide(raw: unknown, sizes: string[]): ReadyMadeSizeGuide {
  const empty: ReadyMadeSizeGuide = { version: 1, unit: 'in', fields: [], sizeRanges: {}, fitNotes: null, stretchNotes: null, sizeAdvice: 'ASK_SELLER' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
  const value = raw as Record<string, unknown>
  const fields = Array.isArray(value.fields)
    ? value.fields.filter((field): field is MeasurementFieldKey => typeof field === 'string' && FIELD_SET.has(field))
    : []
  const sourceRanges = value.sizeRanges && typeof value.sizeRanges === 'object' && !Array.isArray(value.sizeRanges)
    ? value.sizeRanges as Record<string, unknown> : {}
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}
  for (const size of sizes) {
    const source = sourceRanges[size]
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    const ranges: Partial<Record<MeasurementFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const rawRange = (source as Record<string, unknown>)[field]
      if (!rawRange || typeof rawRange !== 'object' || Array.isArray(rawRange)) continue
      let min = positive((rawRange as Record<string, unknown>).min)
      let max = positive((rawRange as Record<string, unknown>).max)
      if (min == null && max == null) continue
      if (min != null && max != null && max < min) [min, max] = [max, min]
      ranges[field] = { min, max }
    }
    if (Object.keys(ranges).length) sizeRanges[size] = ranges
  }
  return {
    version: 1,
    unit: value.unit === 'cm' ? 'cm' : 'in',
    fields,
    sizeRanges,
    fitNotes: typeof value.fitNotes === 'string' && value.fitNotes.trim() ? value.fitNotes.trim() : null,
    stretchNotes: typeof value.stretchNotes === 'string' && value.stretchNotes.trim() ? value.stretchNotes.trim() : null,
    sizeAdvice: ['SIZE_UP_IF_BETWEEN', 'SIZE_DOWN_IF_BETWEEN', 'ASK_SELLER'].includes(String(value.sizeAdvice))
      ? value.sizeAdvice as ReadyMadeSizeGuideAdvice : 'ASK_SELLER',
  }
}

export function formatReadyMadeFitRange(range: ReadyMadeFitRange | null | undefined, unit: ReadyMadeFitUnit) {
  if (!range) return null
  if (range.min != null && range.max != null) return `${range.min}–${range.max} ${unit}`
  if (range.min != null) return `${range.min}+ ${unit}`
  if (range.max != null) return `Up to ${range.max} ${unit}`
  return null
}

export const formatFitRange = formatReadyMadeFitRange

export function hasReadyMadeSizeGuide(guide: ReadyMadeSizeGuide | null | undefined, sizes?: string[]) {
  if (!guide?.fields.length) return false
  const relevantSizes = sizes?.length ? sizes : Object.keys(guide.sizeRanges)
  return relevantSizes.some((size) => guide.fields.some((field) => {
    const range = guide.sizeRanges[size]?.[field]
    return range?.min != null || range?.max != null
  }))
}

function measuredValue(measurements: Record<string, unknown> | null | undefined, field: MeasurementFieldKey, unit: ReadyMadeFitUnit) {
  const raw = positive(measurements?.[field])
  if (raw == null) return null
  const sourceUnit = measurements?.unit === 'cm' ? 'cm' : 'in'
  if (sourceUnit === unit) return raw
  return sourceUnit === 'in' ? Number((raw * 2.54).toFixed(2)) : Number((raw / 2.54).toFixed(2))
}

export function recommendReadyMadeSize(input: { guide: ReadyMadeSizeGuide; measurements?: Record<string, unknown> | null; sizes?: string[] }): ReadyMadeSizeRecommendation {
  const sizes = (input.sizes?.length ? input.sizes : Object.keys(input.guide.sizeRanges)).filter(Boolean)
  const fields = input.guide.fields.filter((field) => sizes.some((size) => input.guide.sizeRanges[size]?.[field]))
  const base = { size: null, secondarySize: null, matchedFields: [] as MeasurementFieldKey[], missingCustomerFields: [] as MeasurementFieldKey[], confidence: 'LOW' as const }
  if (!fields.length) return { ...base, status: 'MISSING_GUIDE', summary: 'Size recommendation unavailable', detail: 'This seller has not added a complete fit guide for this piece.' }
  const values = Object.fromEntries(fields.map((field) => [field, measuredValue(input.measurements, field, input.guide.unit)])) as Partial<Record<MeasurementFieldKey, number | null>>
  const missing = fields.filter((field) => values[field] == null)
  if (missing.length === fields.length) return { ...base, status: 'MISSING_MEASUREMENTS', summary: 'Add measurements for a recommendation', detail: `Save ${fields.map(labelFor).join(', ').toLowerCase()} to compare your fit with this seller's guide.`, missingCustomerFields: missing }
  const evaluated = sizes.map((size) => {
    const matched: MeasurementFieldKey[] = []; let misses = 0; let distance = 0; let used = 0
    for (const field of fields) {
      const range = input.guide.sizeRanges[size]?.[field]; const value = values[field]
      if (!range || value == null) continue
      used += 1
      const delta = range.min != null && value < range.min ? range.min - value : range.max != null && value > range.max ? value - range.max : 0
      if (delta === 0) matched.push(field); else { misses += 1; distance += delta }
    }
    return { size, matched, misses, distance, used }
  }).filter((entry) => entry.used > 0).sort((a, b) => a.misses - b.misses || a.distance - b.distance || sizes.indexOf(a.size) - sizes.indexOf(b.size))
  const perfect = evaluated.filter((entry) => entry.misses === 0)
  if (perfect.length > 1) {
    const lower = perfect[0]!
    const upper = perfect[perfect.length - 1]!
    const primary = input.guide.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ? upper : lower
    const secondary = primary === lower ? upper : lower
    return { status: 'BETWEEN', summary: `You are between ${lower.size} and ${upper.size}`, detail: input.guide.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ? 'This seller recommends sizing up between sizes.' : input.guide.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ? 'This seller recommends sizing down between sizes.' : 'Ask the tailor if you want a second opinion before paying.', size: primary.size, secondarySize: secondary.size, matchedFields: primary.matched, missingCustomerFields: missing, confidence: primary.used >= 3 ? 'MEDIUM' : 'LOW' }
  }
  const best = perfect[0] ?? evaluated[0]
  if (!best?.matched.length) return { ...base, status: 'NO_MATCH', summary: 'No clear size match', detail: "Your saved measurements sit outside this seller's guide. Ask the tailor before paying if you are unsure.", missingCustomerFields: missing }
  return { status: 'RECOMMENDED', summary: `${perfect.length ? 'Recommended' : 'Closest'} size: ${best.size}`, detail: `Based on ${best.matched.map(labelFor).join(', ').toLowerCase()}${perfect.length ? '.' : ". Some measurements sit outside this seller's guide."}`, size: best.size, secondarySize: null, matchedFields: best.matched, missingCustomerFields: missing, confidence: perfect.length && best.used >= 3 ? 'HIGH' : 'LOW' }
}

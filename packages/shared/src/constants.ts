// ─── Brand colours ───────────────────────────────────────────────────────────
export const COLORS = {
  needleGreen: '#2D6A4F',
  kanteRust: '#D85A30',
  inkBlack: '#1A1A1A',
  boneWhite: '#F5F0E8',
  midGrey: '#9CA3AF',
} as const

// ─── Contact directory ───────────────────────────────────────────────────────
export const CONTACTS = {
  founders: 'founders@drapeon.co',
  hello: 'hello@drapeon.co',
  support: 'support@drapeon.co',
  tailors: 'tailors@drapeon.co',
  verify: 'verify@drapeon.co',
  payouts: 'payouts@drapeon.co',
  partnerships: 'partnerships@drapeon.co',
  press: 'press@drapeon.co',
  privacy: 'privacy@drapeon.co',
  security: 'security@drapeon.co',
  legal: 'legal@drapeon.co',
  careers: 'careers@drapeon.co',
  noreply: 'noreply@drapeon.co',
  ops: 'ops@drapeon.co',
} as const

// ─── Tier thresholds ─────────────────────────────────────────────────────────
export const TIER_THRESHOLDS = {
  RISING: { minOrders: 10, minRating: 4.6 },
  MASTER: { minOrders: 50, minRating: 4.8 },
} as const

// ─── Order timing ─────────────────────────────────────────────────────────────
export const ORDER_TIMING = {
  QUOTE_EXPIRY_HOURS: 48,
  AUTO_RELEASE_DAYS: 14,
  AUTO_RELEASE_WARNING_DAYS: 12,
  COLLECTION_CODE_EXPIRY_HOURS: 24,
  REVIEW_PUBLISH_HOLD_MINUTES: 10,
} as const

// ─── Measurement fields ──────────────────────────────────────────────────────
export const MEASUREMENT_FIELDS = [
  { key: 'chestCm', label: 'Chest' },
  { key: 'waistCm', label: 'Waist' },
  { key: 'hipsCm', label: 'Hips' },
  { key: 'shoulderWidthCm', label: 'Shoulder width' },
  { key: 'inseamCm', label: 'Inseam' },
  { key: 'sleeveLengthCm', label: 'Sleeve length' },
  { key: 'neckCircumferenceCm', label: 'Neck circumference' },
  { key: 'heightCm', label: 'Height' },
] as const

// ─── Fit challenge flags ─────────────────────────────────────────────────────
export const FIT_FLAGS = [
  { key: 'LARGE_THIGHS', label: 'Large thighs' },
  { key: 'BROAD_SHOULDERS', label: 'Broad shoulders' },
  { key: 'SHORT_TORSO', label: 'Short torso' },
  { key: 'FULL_SEAT', label: 'Full seat' },
  { key: 'SLOPING_SHOULDERS', label: 'Sloping shoulders' },
  { key: 'LONG_ARMS', label: 'Long arms' },
  { key: 'FULL_BELLY', label: 'Full belly / midsection' },
  { key: 'LONG_RISE', label: 'Long rise needed' },
  { key: 'NARROW_SHOULDERS', label: 'Narrow shoulders' },
  { key: 'FULL_CHEST', label: 'Full chest' },
] as const

// ─── Review tags ─────────────────────────────────────────────────────────────
export const REVIEW_TAGS = [
  { key: 'PERFECT_FIT', label: 'Perfect fit' },
  { key: 'GREAT_COMMUNICATION', label: 'Great communication' },
  { key: 'DELIVERED_ON_TIME', label: 'Delivered on time' },
  { key: 'EXCEEDED_EXPECTATIONS', label: 'Exceeded expectations' },
  { key: 'QUALITY_CRAFTSMANSHIP', label: 'Quality craftsmanship' },
] as const

// ─── Supported currencies ─────────────────────────────────────────────────────
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES'] as const
export type SupportedCurrency = (typeof CURRENCIES)[number]

// ─── Escalation thresholds ────────────────────────────────────────────────────
export const BYPASS_ESCALATION = {
  FLAG_AT: 2,    // 2nd attempt triggers moderation queue
  REVIEW_AT: 3,  // 3rd attempt triggers account review
} as const

// ─── Platform limits ─────────────────────────────────────────────────────────
export const LIMITS = {
  PORTFOLIO_MIN: 4,
  PORTFOLIO_MAX: 12,
  REFERENCE_PHOTOS_MAX: 5,
  BRIEF_DESCRIPTION_MAX: 500,
  BRIEF_NOTE_MAX: 200,
  BIO_MAX: 600,
  BODY_NOTE_MAX: 150,
  REVIEW_MAX: 300,
  VOICE_NOTE_MAX_SECONDS: 90,
} as const

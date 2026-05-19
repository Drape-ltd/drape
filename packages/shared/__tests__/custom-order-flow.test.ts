import {
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_GARMENT_TYPES,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  CUSTOM_ORDER_MIN_DELIVERY_DAYS,
  CUSTOM_ORDER_RESUMABLE_STAGES,
  CUSTOM_PRODUCTION_STAGE_REQUIREMENTS,
  customOrderBriefLineCount,
  customOrderDefaultDeadline,
  customOrderMinimumDeliveryDate,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  isKnownCustomGarmentType,
  isResumableCustomOrderStage,
} from '../src/custom-order-flow'

describe('isResumableCustomOrderStage', () => {
  it('allows active custom-order stages to resume', () => {
    expect(isResumableCustomOrderStage('PENDING_QUOTE')).toBe(true)
    expect(isResumableCustomOrderStage('CONSULTATION')).toBe(true)
    expect(isResumableCustomOrderStage('QUOTE_SENT')).toBe(true)
    expect(isResumableCustomOrderStage('PAYMENT_FAILED')).toBe(true)
    expect(isResumableCustomOrderStage('FINISHING')).toBe(true)
    expect(isResumableCustomOrderStage('SHIPPED')).toBe(true)
  })

  it('never resumes terminal or cancelled states', () => {
    expect(isResumableCustomOrderStage('CANCELLED')).toBe(false)
    expect(isResumableCustomOrderStage('DECLINED')).toBe(false)
    expect(isResumableCustomOrderStage('REFUNDED')).toBe(false)
    expect(isResumableCustomOrderStage('COMPLETE')).toBe(false)
    expect(isResumableCustomOrderStage('EXPIRED')).toBe(false)
    expect(isResumableCustomOrderStage('DELIVERED')).toBe(false)
  })

  it('keeps the resumable stage list free of cancelled orders', () => {
    expect(CUSTOM_ORDER_RESUMABLE_STAGES).not.toContain('CANCELLED')
  })
})

describe('custom order intake contract', () => {
  it('keeps core intake limits explicit', () => {
    expect(CUSTOM_ORDER_MIN_DELIVERY_DAYS).toBe(14)
    expect(CUSTOM_ORDER_MAX_REFERENCE_PHOTOS).toBe(6)
    expect(CUSTOM_ORDER_MAX_STYLE_LINKS).toBe(3)
    expect(CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS).toBe(5)
  })

  it('derives customer-facing deadlines from shared constants', () => {
    const now = new Date(2026, 4, 2, 12)
    const minimum = customOrderMinimumDeliveryDate(now)
    const defaultDeadline = customOrderDefaultDeadline(now)
    expect([minimum.getFullYear(), minimum.getMonth(), minimum.getDate()]).toEqual([2026, 4, 16])
    expect([defaultDeadline.getFullYear(), defaultDeadline.getMonth(), defaultDeadline.getDate()]).toEqual([2026, 4, 30])
  })

  it('requires a real three-line brief', () => {
    expect(customOrderBriefLineCount('line one\nline two\nline three')).toBe(3)
    expect(isCustomOrderBriefLongEnough('line one\nline two\nline three')).toBe(true)
    expect(isCustomOrderBriefLongEnough('one detailed paragraph only')).toBe(false)
    expect(isCustomOrderBriefLongEnough('I need a clean agbada set for pickup with a structured top, comfortable trousers, simple embroidery, and a polished finish for an evening event.')).toBe(true)
  })

  it('limits style references to supported social platforms', () => {
    expect(isAllowedCustomStyleReference('https://www.instagram.com/p/example')).toBe(true)
    expect(isAllowedCustomStyleReference('https://pin.it/example')).toBe(true)
    expect(isAllowedCustomStyleReference('https://www.tiktok.com/@tailor/video/123')).toBe(true)
    expect(isAllowedCustomStyleReference('https://youtube.com/watch?v=123')).toBe(false)
    expect(isAllowedCustomStyleReference('not a url')).toBe(false)
  })

  it('includes expanded diaspora garment coverage', () => {
    expect(isKnownCustomGarmentType('Agbada')).toBe(true)
    expect(isKnownCustomGarmentType('Iro and Buba')).toBe(true)
    expect(isKnownCustomGarmentType('Sherwani')).toBe(true)
    expect(isKnownCustomGarmentType('Abaya')).toBe(true)
    expect(CUSTOM_ORDER_GARMENT_TYPES).toContain('Other')
  })
})

describe('custom production stage contract', () => {
  it('requires photo evidence for core production stages', () => {
    expect(CUSTOM_PRODUCTION_STAGE_REQUIREMENTS.FABRIC.photoRequired).toBe(true)
    expect(CUSTOM_PRODUCTION_STAGE_REQUIREMENTS.CUTTING.photoRequired).toBe(true)
    expect(CUSTOM_PRODUCTION_STAGE_REQUIREMENTS.SEWING.photoRequired).toBe(true)
    expect(CUSTOM_PRODUCTION_STAGE_REQUIREMENTS.FINISHING.minPhotoCount).toBe(2)
    expect(CUSTOM_PRODUCTION_STAGE_REQUIREMENTS.DISPATCHED.noteRequired).toBe(true)
  })
})

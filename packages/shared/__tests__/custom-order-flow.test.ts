import {
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_GARMENT_TYPES,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  CUSTOM_ORDER_MIN_DELIVERY_DAYS,
  CUSTOM_ORDER_RESUMABLE_STAGES,
  CUSTOM_PRODUCTION_STAGE_REQUIREMENTS,
  CUSTOM_PRODUCTION_EVIDENCE_PURPOSES,
  customOrderBriefLineCount,
  customOrderDefaultDeadline,
  customOrderMinimumDeliveryDate,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  isKnownCustomGarmentType,
  isFabricApprovalEvidence,
  isResumableCustomOrderStage,
  latestFabricApprovalEvidence,
  sourcedFabricDecisionFromNote,
  sourcedFabricChangeFeedbackFromUpdates,
  styleAlignmentChangeFeedbackFromUpdates,
  styleAlignmentDecisionFromNote,
  styleAlignmentEventFromNote,
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

  it('keeps sourcing progress separate from exact fabric approval evidence', () => {
    expect(isFabricApprovalEvidence({
      stageKey: 'FABRIC',
      metadata: { evidence_purpose: CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.FABRIC_APPROVAL },
    })).toBe(true)
    expect(isFabricApprovalEvidence({
      stageKey: 'PRE_CUTTING',
      metadata: { evidence_purpose: CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.SOURCING_PROGRESS },
    })).toBe(false)
    expect(isFabricApprovalEvidence({ stageKey: 'FABRIC', metadata: {} })).toBe(false)
  })

  it('keeps the approval card scoped to the latest fabric submission batch', () => {
    const latest = latestFabricApprovalEvidence([
      {
        id: 'old-approval',
        stage_key: 'FABRIC',
        metadata: { evidence_purpose: CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.FABRIC_APPROVAL },
        created_at: '2026-08-01T09:00:00Z',
        photo_urls: ['old.jpg'],
      },
      {
        id: 'sourcing-update',
        stage_key: 'PRE_CUTTING',
        metadata: { evidence_purpose: CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.SOURCING_PROGRESS },
        created_at: '2026-08-01T09:30:00Z',
        photo_urls: ['market.jpg'],
      },
      {
        id: 'replacement-approval',
        stage_key: 'FABRIC',
        metadata: { evidence_purpose: CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.FABRIC_APPROVAL },
        created_at: '2026-08-01T10:00:00Z',
        photo_urls: ['replacement.mp4'],
      },
    ])

    expect(latest?.id).toBe('replacement-approval')
    expect(latest?.photo_urls).toEqual(['replacement.mp4'])
  })

  it('returns the latest complete sourced-fabric change request', () => {
    expect(sourcedFabricChangeFeedbackFromUpdates([
      { note: 'Customer requested sourced fabric changes: Use a darker green.', created_at: '2026-08-01T10:00:00Z' },
      { note: 'Sourcing update from the market.', created_at: '2026-08-01T10:02:00Z' },
      { note: 'Customer requested sourced fabric changes: Keep the darker green, but find a lighter weave for warm weather.', created_at: '2026-08-01T10:04:00Z' },
    ])).toEqual({
      feedback: 'Keep the darker green, but find a lighter weave for warm weather.',
      createdAt: '2026-08-01T10:04:00Z',
    })
  })

  it('ignores empty and unrelated stage notes', () => {
    expect(sourcedFabricChangeFeedbackFromUpdates([
      { note: 'Customer requested sourced fabric changes:   ', createdAt: '2026-08-01T10:00:00Z' },
      { note: 'Fabric sourced at the market.', createdAt: '2026-08-01T10:01:00Z' },
    ])).toBeNull()
  })

  it('classifies authoritative fabric decision timeline notes', () => {
    expect(sourcedFabricDecisionFromNote('Customer approved the tailor-sourced fabric.')).toBe('APPROVED')
    expect(sourcedFabricDecisionFromNote('Customer requested sourced fabric changes: Send a video.')).toBe('CHANGES_REQUESTED')
    expect(sourcedFabricDecisionFromNote('Tailor visited a supplier.')).toBeNull()
  })

  it('classifies style decisions and preserves the latest full clarification', () => {
    expect(styleAlignmentEventFromNote('Tailor requested style approval before cutting: Keep the same neckline.')).toBe('REQUESTED')
    expect(styleAlignmentDecisionFromNote('Customer approved the tailor style interpretation before cutting.')).toBe('APPROVED')
    expect(styleAlignmentDecisionFromNote('Customer requested style clarification before cutting: Make the neckline larger.')).toBe('CHANGES_REQUESTED')
    expect(styleAlignmentDecisionFromNote('Tailor started designing.')).toBeNull()
    expect(styleAlignmentChangeFeedbackFromUpdates([
      { note: 'Customer requested style clarification before cutting: Make the neckline larger.', createdAt: '2026-08-01T10:00:00Z' },
      { note: 'Customer requested style clarification before cutting: Keep the larger neckline and remove the chest embroidery.', createdAt: '2026-08-01T10:05:00Z' },
    ])).toEqual({
      feedback: 'Keep the larger neckline and remove the chest embroidery.',
      createdAt: '2026-08-01T10:05:00Z',
    })
  })
})

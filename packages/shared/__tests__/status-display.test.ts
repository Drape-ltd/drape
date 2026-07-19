import {
  formatConsultationStatusLabel,
  formatMaterialAdvanceStatusLabel,
  formatMeasurementStatusLabel,
  formatOrderStageLabel,
  formatScopeChangeStatusLabel,
  formatStatusLabel,
  resolveStatusDisplay,
} from '../src/status-display'

describe('status display', () => {
  it('uses product copy for statuses that need more than title casing', () => {
    expect(formatStatusLabel('PENDING_TAILOR_UPLOAD')).toBe('Awaiting Tailor Upload')
    expect(formatStatusLabel('PAYMENT_PENDING')).toBe('Awaiting Payment')
    expect(formatStatusLabel('IN_DISPUTE')).toBe('Under Review')
  })

  it('formats unknown enum values without exposing screaming snake case', () => {
    expect(formatStatusLabel('READY_FOR_CUSTOMER_FITTING')).toBe('Ready For Customer Fitting')
  })

  it('resolves status tones centrally', () => {
    expect(resolveStatusDisplay('VERIFIED').tone).toBe('success')
    expect(resolveStatusDisplay('PENDING_REVIEW').tone).toBe('warning')
    expect(resolveStatusDisplay('PAYOUT_DESTINATION_MISMATCH').tone).toBe('danger')
    expect(resolveStatusDisplay('DESIGNING').tone).toBe('info')
  })

  it('returns a neutral fallback for empty values', () => {
    expect(resolveStatusDisplay(null, { fallback: 'Unavailable' })).toEqual({
      label: 'Unavailable',
      tone: 'neutral',
    })
  })

  it('keeps role-specific order and material status copy in the shared layer', () => {
    expect(formatOrderStageLabel('CONFIRMED', { orderKind: 'READY_MADE', audience: 'customer' })).toBe('Order Placed')
    expect(formatOrderStageLabel('CONFIRMED', { orderKind: 'READY_MADE', audience: 'tailor' })).toBe('Paid Order')
    expect(formatMaterialAdvanceStatusLabel('REQUESTED', 'customer')).toBe('Needs Your Decision')
    expect(formatMaterialAdvanceStatusLabel('REQUESTED', 'tailor')).toBe('Waiting on Customer Decision')
  })

  it('formats contextual statuses without screen-local maps', () => {
    expect(formatConsultationStatusLabel('SCHEDULED')).toBe('Consultation Scheduled')
    expect(formatMeasurementStatusLabel('TAILOR_REVIEW_REQUIRED')).toBe('Tailor Review Required')
    expect(formatScopeChangeStatusLabel('SUPERSEDED')).toBe('Updated by a Newer Request')
  })
})

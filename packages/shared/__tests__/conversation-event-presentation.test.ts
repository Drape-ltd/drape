import { deriveConversationEventPresentation, parseScheduledOrderCallMessage } from '../src/conversation-event-presentation'

describe('deriveConversationEventPresentation', () => {
  it('breaks quote metadata into scannable facts', () => {
    const result = deriveConversationEventPresentation({
      eventType: 'QUOTE_SENT',
      title: 'Quote sent',
      summary: 'Includes fabric sourcing.',
      quoteVersion: 2,
      metadata: { currency: 'USD', totalAmount: 12500, completionDate: '2026-08-15', changeKind: 'TAILOR_CORRECTION' },
    })
    expect(result.eyebrow).toBe('Quote v2')
    expect(result.facts).toEqual([
      { label: 'Total', value: '$125.00' },
      { label: 'Delivery', value: 'Aug 15, 2026' },
      { label: 'Change', value: 'Tailor Correction' },
    ])
  })

  it('supports snake-case scope metadata and omits empty fields', () => {
    const result = deriveConversationEventPresentation({
      eventType: 'SCOPE_CHANGE_REQUESTED',
      metadata: { change_type: 'FIT_CHANGE', impacts: ['PRICE', 'DEADLINE'], deadline_impact: 'Two extra days' },
    })
    expect(result.tone).toBe('warning')
    expect(result.facts).toEqual([
      { label: 'Type', value: 'Fit Change' },
      { label: 'Impact', value: 'Price, Deadline' },
      { label: 'Deadline', value: 'Two extra days' },
    ])
  })

  it('gives remedy events an explicit warning presentation', () => {
    const result = deriveConversationEventPresentation({
      eventType: 'REMEDY_DECISION_RECORDED',
      metadata: { decision: 'REFUND_REVIEW', reason: 'ITEM_DAMAGED', requested_by: 'CUSTOMER' },
    })
    expect(result.icon).toBe('remedy')
    expect(result.facts).toHaveLength(3)
  })

  it('parses generated order-call messages without touching ordinary chat', () => {
    expect(parseScheduledOrderCallMessage(
      'Drapeon order call scheduled for 31 Jul 2026, 10:20 about pickup or delivery. This call is free and stays inside Drapeon; keep final decisions in this thread. Note: Compare measurements',
    )).toEqual({ scheduledFor: '31 Jul 2026 · 10:20 AM', reason: 'pickup or delivery', note: 'Compare measurements' })
    expect(parseScheduledOrderCallMessage('Can we call tomorrow?')).toBeNull()
  })
})

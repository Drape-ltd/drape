import {
  clampNegotiationRoundLimit,
  deriveOrderConversationActions,
} from '../src/order-negotiation'

describe('order negotiation action matrix', () => {
  const activeQuote = { id: 'quote-1', version: 1, status: 'ACTIVE' as const }

  it('offers formal customer negotiation only after an active quote exists', () => {
    const beforeQuote = deriveOrderConversationActions({
      role: 'CUSTOMER',
      orderKind: 'CUSTOM',
      stage: 'PENDING_QUOTE',
    })
    const afterQuote = deriveOrderConversationActions({
      role: 'CUSTOMER',
      orderKind: 'CUSTOM',
      stage: 'QUOTE_SENT',
      activeQuote,
    })

    expect(beforeQuote.primary?.kind).toBe('REQUEST_CONSULTATION')
    expect(beforeQuote.overflow.map((item) => item.kind)).toEqual(['CANCEL_BRIEF'])
    expect(afterQuote.primary?.kind).toBe('ACCEPT_AND_PAY')
    expect(afterQuote.overflow.map((item) => item.kind)).toEqual([
      'VIEW_QUOTE',
      'REQUEST_QUOTE_CHANGES',
      'DECLINE_QUOTE',
    ])
  })

  it('removes the revision action once the customer reaches the round limit', () => {
    const actions = deriveOrderConversationActions({
      role: 'CUSTOMER',
      orderKind: 'CUSTOM',
      stage: 'QUOTE_SENT',
      activeQuote,
      negotiationRoundsUsed: 3,
      negotiationRoundLimit: 3,
    })

    expect(actions.revisionLimitReached).toBe(true)
    expect(actions.overflow.map((item) => item.kind)).not.toContain('REQUEST_QUOTE_CHANGES')
  })

  it('shows request management while a customer revision is open', () => {
    const actions = deriveOrderConversationActions({
      role: 'CUSTOMER',
      orderKind: 'CUSTOM',
      stage: 'QUOTE_SENT',
      activeQuote,
      openRevision: { id: 'revision-1', status: 'OPEN', roundNumber: 1 },
    })

    expect(actions.primary?.kind).toBe('EDIT_QUOTE_CHANGE_REQUEST')
    expect(actions.overflow.map((item) => item.kind)).toEqual([
      'VIEW_QUOTE',
      'WITHDRAW_QUOTE_CHANGE_REQUEST',
    ])
  })

  it('gives the tailor one authoritative response set for an open revision', () => {
    const actions = deriveOrderConversationActions({
      role: 'TAILOR',
      orderKind: 'CUSTOM',
      stage: 'QUOTE_SENT',
      activeQuote,
      openRevision: { id: 'revision-1', status: 'OPEN', roundNumber: 1 },
    })

    expect(actions.primary?.kind).toBe('REVISE_QUOTE')
    expect(actions.overflow.map((item) => item.kind)).toEqual([
      'KEEP_CURRENT_QUOTE',
      'VIEW_QUOTE',
      'DECLINE_AFTER_REVISION',
    ])
  })

  it('does not expose custom negotiation actions for ready-made orders', () => {
    const actions = deriveOrderConversationActions({
      role: 'CUSTOMER',
      orderKind: 'READY_MADE',
      stage: 'QUOTE_SENT',
      activeQuote,
    })

    expect(actions.primary).toBeNull()
    expect(actions.overflow).toEqual([])
  })

  it('clamps ops extensions to the audited maximum', () => {
    expect(clampNegotiationRoundLimit(undefined)).toBe(3)
    expect(clampNegotiationRoundLimit(0)).toBe(1)
    expect(clampNegotiationRoundLimit(20)).toBe(6)
  })
})

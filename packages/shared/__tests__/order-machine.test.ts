import {
  canTransition,
  validNextStages,
  isTerminal,
  TERMINAL_STAGES,
  ORDER_TRANSITIONS,
  type OrderStage,
  type Actor,
} from '../src/order-machine'

// ─── canTransition ────────────────────────────────────────────────────────────

describe('canTransition — valid paths', () => {
  const valid: [OrderStage, OrderStage, Actor][] = [
    ['DRAFT', 'PENDING_QUOTE', 'CUSTOMER'],
    ['PENDING_QUOTE', 'QUOTE_SENT', 'TAILOR'],
    ['PENDING_QUOTE', 'DECLINED', 'TAILOR'],
    ['QUOTE_SENT', 'CONFIRMED', 'CUSTOMER'],
    ['QUOTE_SENT', 'DECLINED', 'CUSTOMER'],
    ['QUOTE_SENT', 'EXPIRED', 'SYSTEM'],
    ['PAYMENT_PENDING', 'CONFIRMED', 'SYSTEM'],
    ['CONFIRMED', 'DESIGNING', 'TAILOR'],
    ['CONFIRMED', 'SOURCING', 'TAILOR'],
    ['CONFIRMED', 'CUTTING', 'TAILOR'],
    ['DESIGNING', 'SOURCING', 'TAILOR'],
    ['DESIGNING', 'CUTTING', 'TAILOR'],
    ['SOURCING', 'CUTTING', 'TAILOR'],
    ['CUTTING', 'SEWING', 'TAILOR'],
    ['SEWING', 'FINISHING', 'TAILOR'],
    ['FINISHING', 'SHIPPED', 'TAILOR'],
    ['FINISHING', 'READY_FOR_COLLECTION', 'TAILOR'],
    ['SHIPPED', 'DELIVERED', 'CUSTOMER'],
    ['SHIPPED', 'DELIVERED', 'SYSTEM'],
    ['DELIVERED', 'COMPLETE', 'CUSTOMER'],
    ['READY_FOR_COLLECTION', 'COLLECTED', 'SYSTEM'],
    ['READY_FOR_COLLECTION', 'COLLECTED', 'TAILOR'],
    ['READY_FOR_COLLECTION', 'COLLECTED', 'CUSTOMER'],
    ['DELIVERED', 'COMPLETE', 'SYSTEM'],
    ['COLLECTED', 'COMPLETE', 'CUSTOMER'],
    ['COLLECTED', 'COMPLETE', 'SYSTEM'],
  ]

  test.each(valid)('%s → %s by %s', (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true)
  })
})

describe('canTransition — invalid actor', () => {
  it('customer cannot advance production stages', () => {
    expect(canTransition('CONFIRMED', 'CUTTING', 'CUSTOMER')).toBe(false)
    expect(canTransition('CUTTING', 'SEWING', 'CUSTOMER')).toBe(false)
    expect(canTransition('FINISHING', 'SHIPPED', 'CUSTOMER')).toBe(false)
  })

  it('tailor cannot accept or decline a quote on behalf of customer', () => {
    expect(canTransition('QUOTE_SENT', 'CONFIRMED', 'TAILOR')).toBe(false)
    expect(canTransition('QUOTE_SENT', 'DECLINED', 'TAILOR')).toBe(false)
  })

  it('customer cannot trigger system events', () => {
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED', 'CUSTOMER')).toBe(false)
    expect(canTransition('QUOTE_SENT', 'EXPIRED', 'CUSTOMER')).toBe(false)
    expect(canTransition('SHIPPED', 'DELIVERED', 'TAILOR')).toBe(false)
  })

  it('tailor cannot complete a delivered or collected order on behalf of the customer', () => {
    expect(canTransition('DELIVERED', 'COMPLETE', 'TAILOR')).toBe(false)
    expect(canTransition('COLLECTED', 'COMPLETE', 'TAILOR')).toBe(false)
  })
})

describe('canTransition — invalid stage skips', () => {
  it('cannot skip from CONFIRMED directly to SHIPPED', () => {
    expect(canTransition('CONFIRMED', 'SHIPPED', 'TAILOR')).toBe(false)
  })

  it('cannot go backward (SEWING → CUTTING)', () => {
    expect(canTransition('SEWING', 'CUTTING', 'TAILOR')).toBe(false)
  })

  it('cannot transition from terminal stages', () => {
    expect(canTransition('COMPLETE', 'CONFIRMED', 'TAILOR')).toBe(false)
    expect(canTransition('DECLINED', 'PENDING_QUOTE', 'CUSTOMER')).toBe(false)
    expect(canTransition('CANCELLED', 'DRAFT', 'CUSTOMER')).toBe(false)
  })
})

// ─── disputes ─────────────────────────────────────────────────────────────────

describe('canTransition — disputes', () => {
  const disputeFrom: OrderStage[] = ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'READY_FOR_COLLECTION']

  it.each(disputeFrom)('customer can open dispute from %s', (stage) => {
    expect(canTransition(stage, 'IN_DISPUTE', 'CUSTOMER')).toBe(true)
  })

  it('platform can resolve dispute as refund', () => {
    expect(canTransition('IN_DISPUTE', 'REFUNDED', 'PLATFORM')).toBe(true)
  })

  it('platform can resolve dispute as release', () => {
    expect(canTransition('IN_DISPUTE', 'COMPLETE', 'PLATFORM')).toBe(true)
  })

  it('tailor cannot open dispute', () => {
    expect(canTransition('CONFIRMED', 'IN_DISPUTE', 'TAILOR')).toBe(false)
  })
})

// ─── validNextStages ──────────────────────────────────────────────────────────

describe('validNextStages', () => {
  it('tailor at PENDING_QUOTE can quote or decline', () => {
    const stages = validNextStages('PENDING_QUOTE', 'TAILOR')
    expect(stages).toContain('QUOTE_SENT')
    expect(stages).toContain('DECLINED')
    expect(stages).not.toContain('CONFIRMED')
  })

  it('customer at QUOTE_SENT can accept or decline', () => {
    const stages = validNextStages('QUOTE_SENT', 'CUSTOMER')
    expect(stages).toContain('CONFIRMED')
    expect(stages).toContain('DECLINED')
  })

  it('tailor at FINISHING has both shipping and collection paths', () => {
    const stages = validNextStages('FINISHING', 'TAILOR')
    expect(stages).toContain('SHIPPED')
    expect(stages).toContain('READY_FOR_COLLECTION')
  })

  it('customer can complete delivered or collected orders', () => {
    expect(validNextStages('DELIVERED', 'CUSTOMER')).toContain('COMPLETE')
    expect(validNextStages('COLLECTED', 'CUSTOMER')).toContain('COMPLETE')
  })

  it('returns empty array for terminal stages', () => {
    expect(validNextStages('COMPLETE', 'TAILOR')).toHaveLength(0)
    expect(validNextStages('DECLINED', 'CUSTOMER')).toHaveLength(0)
  })
})

// ─── isTerminal ───────────────────────────────────────────────────────────────

describe('isTerminal', () => {
  it.each(TERMINAL_STAGES)('%s is terminal', (stage) => {
    expect(isTerminal(stage)).toBe(true)
  })

  const nonTerminal: OrderStage[] = ['PENDING_QUOTE', 'QUOTE_SENT', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'SHIPPED', 'DELIVERED', 'COLLECTED']
  it.each(nonTerminal)('%s is NOT terminal', (stage) => {
    expect(isTerminal(stage)).toBe(false)
  })
})

// ─── Transition integrity ─────────────────────────────────────────────────────

describe('ORDER_TRANSITIONS integrity', () => {
  it('every "from" stage in transitions is a valid OrderStage', () => {
    const validStages = new Set<string>([
      'DRAFT', 'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING',
      'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING',
      'SHIPPED', 'READY_FOR_COLLECTION', 'DELIVERED', 'COLLECTED',
      'COMPLETE', 'DECLINED', 'EXPIRED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED',
    ])
    for (const t of ORDER_TRANSITIONS) {
      expect(validStages).toContain(t.from)
      expect(validStages).toContain(t.to)
    }
  })

  it('no duplicate transitions (same from/to/actor)', () => {
    const seen = new Set<string>()
    for (const t of ORDER_TRANSITIONS) {
      const key = `${t.from}:${t.to}:${t.actor}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('every terminal stage has no outgoing transitions (except platform resolves)', () => {
    for (const t of ORDER_TRANSITIONS) {
      if (TERMINAL_STAGES.includes(t.from)) {
        throw new Error(`Terminal stage ${t.from} has outgoing transition to ${t.to}`)
      }
    }
  })
})

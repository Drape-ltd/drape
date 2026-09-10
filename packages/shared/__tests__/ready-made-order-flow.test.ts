import { readyMadeStageLabel, readyMadeTailorNextStages } from '../src/order-machine'

describe('ready-made order flow', () => {
  it('skips every custom production stage after payment confirmation', () => {
    expect(readyMadeTailorNextStages('CONFIRMED', 'SHIPPING')).toEqual(['FINISHING'])
    expect(readyMadeTailorNextStages('CONFIRMED', 'SHIPPING')).not.toContain('DESIGNING')
    expect(readyMadeTailorNextStages('CONFIRMED', 'SHIPPING')).not.toContain('SOURCING')
    expect(readyMadeTailorNextStages('CONFIRMED', 'SHIPPING')).not.toContain('CUTTING')
  })

  it('derives the handoff from fulfillment', () => {
    expect(readyMadeTailorNextStages('FINISHING', 'LOCAL_COLLECTION')).toEqual([
      'READY_FOR_COLLECTION',
    ])
    expect(readyMadeTailorNextStages('FINISHING', 'PICKUP')).toEqual(['READY_FOR_COLLECTION'])
    expect(readyMadeTailorNextStages('FINISHING', 'LOCAL_DELIVERY')).toEqual([
      'READY_FOR_DRAPE_DISPATCH',
    ])
    expect(readyMadeTailorNextStages('FINISHING', 'SHIPPING')).toEqual([
      'READY_FOR_DRAPE_DISPATCH',
    ])
  })

  it('does not give the tailor another production action after handoff', () => {
    expect(readyMadeTailorNextStages('READY_FOR_COLLECTION', 'LOCAL_COLLECTION')).toEqual([])
    expect(readyMadeTailorNextStages('READY_FOR_DRAPE_DISPATCH', 'SHIPPING')).toEqual([])
  })

  it('uses purchase language instead of custom-production language', () => {
    expect(readyMadeStageLabel('CONFIRMED')).toBe('Order confirmed')
    expect(readyMadeStageLabel('FINISHING')).toBe('Preparing order')
    expect(readyMadeStageLabel('READY_FOR_COLLECTION')).toBe('Ready for pickup')
  })
})

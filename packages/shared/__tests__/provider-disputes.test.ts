import { presentProviderDispute } from '../src/provider-disputes'

describe('provider dispute presentation', () => {
  it('keeps an evidence review explicit without exposing provider enums', () => {
    const result = presentProviderDispute({
      status: 'NEEDS_RESPONSE',
      amount: 50_000,
      currency: 'NGN',
      evidenceDueAt: '2026-08-20T12:00:00.000Z',
      moneyMovementBlocked: true,
    })

    expect(result.label).toBe('Payment review needs evidence')
    expect(result.blocksRelease).toBe(true)
    expect(result.deadline).toBe('2026-08-20T12:00:00.000Z')
  })

  it('does not claim money can move while a terminal provider decision is unreconciled', () => {
    const result = presentProviderDispute({
      status: 'LOST',
      amount: 5_000,
      currency: 'USD',
      moneyMovementBlocked: true,
    })

    expect(result.title).toBe('Order funds need reconciliation')
    expect(result.blocksRelease).toBe(true)
  })
})

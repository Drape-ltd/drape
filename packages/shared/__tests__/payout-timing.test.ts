import { hasPayoutWindowClosed, payoutWindowClosesAt } from '../src/payout-timing'

describe('payout timing', () => {
  const confirmedAt = '2026-05-19T04:39:10.287Z'

  it('calculates the exact 72-hour dispute window close time', () => {
    expect(payoutWindowClosesAt(confirmedAt)).toBe('2026-05-22T04:39:10.287Z')
  })

  it('does not close the payout window before the exact timestamp', () => {
    expect(hasPayoutWindowClosed(confirmedAt, Date.parse('2026-05-22T04:39:10.286Z'))).toBe(false)
  })

  it('closes the payout window at the exact timestamp', () => {
    expect(hasPayoutWindowClosed(confirmedAt, Date.parse('2026-05-22T04:39:10.287Z'))).toBe(true)
  })
})

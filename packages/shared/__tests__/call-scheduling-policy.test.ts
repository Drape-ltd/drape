import {
  recommendedSchedulingStartDate,
  repairSchedulingOptions,
} from '../src/call-scheduling-policy'

describe('scheduling recommendations', () => {
  const now = Date.parse('2026-08-15T14:58:37.000Z')

  it('rounds past hidden seconds to a clear quarter-hour boundary', () => {
    expect(recommendedSchedulingStartDate({ nowMs: now, minLookaheadMinutes: 60 }).toISOString())
      .toBe('2026-08-15T16:00:00.000Z')
  })

  it('repairs only unavailable or duplicated choices', () => {
    const validLater = '2026-08-17T14:00:00.000Z'
    const result = repairSchedulingOptions([
      '2026-08-15T15:58:00.000Z',
      validLater,
      validLater,
    ], { nowMs: now, minLookaheadMinutes: 60 })

    expect(result.changedIndexes).toEqual([0, 2])
    expect(result.values[0].toISOString()).toBe('2026-08-15T16:00:00.000Z')
    expect(result.values[1].toISOString()).toBe(validLater)
    expect(new Set(result.values.map((value) => value.toISOString())).size).toBe(3)
  })
})

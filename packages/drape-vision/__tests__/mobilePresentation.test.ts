import {
  clampVisionProgress,
  visionConfidenceStatus,
  visionMetricGroup,
} from '../../../apps/mobile/components/drapeVision/presentation'

describe('Drapeon Vision mobile presentation rules', () => {
  it('groups core, length, and specialist measurements predictably', () => {
    expect(visionMetricGroup('chest')).toBe('core')
    expect(visionMetricGroup('inseam')).toBe('lengths')
    expect(visionMetricGroup('bicepCircumference')).toBe('specialist')
  })

  it('formats confidence without exposing engine enums', () => {
    expect(visionConfidenceStatus('HIGH')).toEqual({ label: 'High confidence', tone: 'success' })
    expect(visionConfidenceStatus('MEDIUM')).toEqual({ label: 'Review suggested', tone: 'warning' })
    expect(visionConfidenceStatus('LOW')).toEqual({ label: 'Tape check needed', tone: 'blocked' })
    expect(visionConfidenceStatus(null)).toEqual({ label: 'Not measured', tone: 'neutral' })
  })

  it('clamps invalid and out-of-range progress values', () => {
    expect(clampVisionProgress(-1)).toBe(0)
    expect(clampVisionProgress(0.45)).toBe(0.45)
    expect(clampVisionProgress(2)).toBe(1)
    expect(clampVisionProgress(Number.NaN)).toBe(0)
  })
})

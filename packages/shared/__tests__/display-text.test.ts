import { decodeDisplayText, formatDatabaseEnumLabel } from '../src/display-text'

describe('decodeDisplayText', () => {
  it('decodes URL-encoded copy before display', () => {
    expect(decodeDisplayText('Need%20a%20deep%20green%20Agbada')).toBe('Need a deep green Agbada')
  })

  it('decodes double-encoded copy without looping forever', () => {
    expect(decodeDisplayText('Need%2520clean%2520embroidery')).toBe('Need clean embroidery')
  })

  it('leaves normal percentage copy alone', () => {
    expect(decodeDisplayText('Use 100% cotton if available')).toBe('Use 100% cotton if available')
  })
})

describe('formatDatabaseEnumLabel', () => {
  it('formats database enums for display', () => {
    expect(formatDatabaseEnumLabel('AWAITING_TAILOR_UPLOAD')).toBe('Awaiting Tailor Upload')
    expect(formatDatabaseEnumLabel('EXPRESS')).toBe('Express')
  })

  it('uses the supplied fallback when the database value is empty', () => {
    expect(formatDatabaseEnumLabel(null, 'In progress')).toBe('In progress')
  })
})

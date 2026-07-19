import {
  classifyPayoutNameMatch,
  isValidLegalName,
  normalizeLegalName,
} from '../src/identity-trust'

describe('identity trust helpers', () => {
  it('accepts human names with accents, apostrophes, and hyphens', () => {
    expect(isValidLegalName("Adélaïde O'Connor-Smith")).toBe(true)
  })

  it('rejects digits, handles, emojis, and business punctuation', () => {
    expect(isValidLegalName('Kai 2')).toBe(false)
    expect(isValidLegalName('@kai')).toBe(false)
    expect(isValidLegalName('Kai ✨')).toBe(false)
    expect(isValidLegalName('Kai & Co.')).toBe(false)
  })

  it('normalizes whitespace without changing legal characters', () => {
    expect(normalizeLegalName('  Ada   Nwosu  ')).toBe('Ada Nwosu')
  })

  it('matches payout names independent of order, case, and accents', () => {
    expect(classifyPayoutNameMatch('Adélaïde Nwosu', 'NWOSU ADELAIDE')).toBe('MATCH')
  })

  it('routes partial payout names to review and unrelated names to mismatch', () => {
    expect(classifyPayoutNameMatch('Ada Nwosu', 'Ada Okafor')).toBe('REVIEW_REQUIRED')
    expect(classifyPayoutNameMatch('Ada Nwosu', 'Kai Smith')).toBe('MISMATCH')
    expect(classifyPayoutNameMatch(null, 'Ada Nwosu')).toBe('REVIEW_REQUIRED')
  })
})

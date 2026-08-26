import { isMeaningfulTailorQuoteDraft, type TailorQuoteDraftFields } from '../src/quote-draft'

const empty: TailorQuoteDraftFields = {
  amount: '', tailoringAmount: '', fabricAllowanceAmount: '', fabricCoverage: [],
  fabricAssumptions: '', completionDate: '', laborAmount: '', sourcingAmount: '',
  rushAmount: '', includedText: '', excludedText: '', breakdownSummary: '', note: '', currency: 'NGN',
}

describe('tailor quote draft', () => {
  it('distinguishes untouched and resumable quote work', () => {
    expect(isMeaningfulTailorQuoteDraft(empty)).toBe(false)
    expect(isMeaningfulTailorQuoteDraft({ ...empty, tailoringAmount: '50,000' })).toBe(true)
  })
})

import {
  formatMoneyInputValue,
  integerToEnglishWords,
  moneyAmountReadback,
  normalizeMoneyInput,
  parseMoneyInputToMinorUnits,
} from '../src/money-input'

describe('shared money input safety', () => {
  it('groups digits while preserving decimals', () => {
    expect(formatMoneyInputValue('50000')).toBe('50,000')
    expect(formatMoneyInputValue('500000.5')).toBe('500,000.5')
    expect(normalizeMoneyInput('₦ 50,000.25')).toBe('50000.25')
  })

  it('parses canonical minor units without floats', () => {
    expect(parseMoneyInputToMinorUnits('50,000')).toBe(5_000_000)
    expect(parseMoneyInputToMinorUnits('0.01')).toBe(1)
    expect(parseMoneyInputToMinorUnits('0')).toBeNull()
    expect(parseMoneyInputToMinorUnits('0', { allowZero: true })).toBe(0)
  })

  it('provides an unmistakable English readback', () => {
    expect(integerToEnglishWords(500_000)).toBe('five hundred thousand')
    expect(moneyAmountReadback(50_000_00, 'NGN')).toBe('fifty thousand naira')
    expect(moneyAmountReadback(12_550, 'USD')).toBe('one hundred twenty-five US dollar and fifty cent')
  })
})

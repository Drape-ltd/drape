import {
  MANUAL_BANK_ENTRY_NOTE,
  MANUAL_BANK_VALIDATION,
  normalizeSwiftBic,
  payoutBankLogoUrl,
  validateManualBankEntry,
} from '../src/payout-setup'

describe('manual bank entry validation', () => {
  it('keeps the customer-facing manual verification note exact', () => {
    expect(MANUAL_BANK_ENTRY_NOTE).toBe(
      'Manual bank details require verification before your first payout. This usually takes 1-2 business days.',
    )
  })

  it('normalizes SWIFT / BIC codes before validation', () => {
    expect(normalizeSwiftBic('  deut de ff 500 ')).toBe('DEUTDEFF500')
  })

  it('returns bank logo URLs for known payout banks and null otherwise', () => {
    expect(payoutBankLogoUrl('Guaranty Trust Bank')).toBe('https://logo.clearbit.com/gtbank.com')
    expect(payoutBankLogoUrl('A small regional bank')).toBeNull()
  })

  it('accepts valid 8 and 11 character SWIFT / BIC codes', () => {
    expect(validateManualBankEntry({
      payoutCurrency: 'NGN',
      bankName: 'Regional Trust Bank',
      bankCountryCode: 'NG',
      swiftBic: 'FBNINGLA',
      accountNumber: '1234567890',
      accountName: 'Amara Atelier',
    }).ok).toBe(true)

    expect(validateManualBankEntry({
      payoutCurrency: 'GBP',
      bankName: 'International Tailor Bank',
      bankCountryCode: 'GB',
      swiftBic: 'BARCGB22XXX',
      accountNumber: 'GB82WEST12345698765432',
      accountName: 'Amara Atelier',
    }).ok).toBe(true)
  })

  it('rejects incomplete manual bank submissions with field-specific errors', () => {
    const result = validateManualBankEntry({
      payoutCurrency: 'KES',
      bankName: '',
      bankCountryCode: '',
      swiftBic: 'BAD',
      accountNumber: '',
      accountName: '',
    })

    expect(result.ok).toBe(false)
    if (!('fieldErrors' in result)) {
      throw new Error('Expected manual bank validation to fail.')
    }

    expect(result.fieldErrors.bankName).toBe(MANUAL_BANK_VALIDATION.BANK_NAME_REQUIRED_MESSAGE)
    expect(result.fieldErrors.bankCountryCode).toBe(MANUAL_BANK_VALIDATION.BANK_COUNTRY_REQUIRED_MESSAGE)
    expect(result.fieldErrors.swiftBic).toBe(MANUAL_BANK_VALIDATION.SWIFT_BIC_INVALID_MESSAGE)
    expect(result.fieldErrors.accountNumber).toBe(MANUAL_BANK_VALIDATION.ACCOUNT_NUMBER_REQUIRED_MESSAGE)
    expect(result.fieldErrors.accountName).toBe(MANUAL_BANK_VALIDATION.ACCOUNT_NAME_REQUIRED_MESSAGE)
  })
})

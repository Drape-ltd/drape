export const MANUAL_BANK_ENTRY_OPTION_LABEL = 'My bank is not listed'

export const MANUAL_BANK_ENTRY_NOTE =
  'Manual bank details require verification before your first payout. This usually takes 1-2 business days.'

export const MANUAL_BANK_VERIFICATION_STATUSES = [
  'NOT_SUBMITTED',
  'PENDING',
  'IN_REVIEW',
  'VERIFIED',
  'REJECTED',
] as const
export type ManualBankVerificationStatus = (typeof MANUAL_BANK_VERIFICATION_STATUSES)[number]

export const MANUAL_BANK_PAYOUT_CURRENCIES = ['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'] as const
export type ManualBankPayoutCurrency = (typeof MANUAL_BANK_PAYOUT_CURRENCIES)[number]

export const MANUAL_BANK_COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'CA', name: 'Canada' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AT', name: 'Austria' },
  { code: 'FI', name: 'Finland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'BR', name: 'Brazil' },
] as const

export type ManualBankCountryCode = (typeof MANUAL_BANK_COUNTRIES)[number]['code']

export const MANUAL_BANK_VALIDATION = {
  BANK_NAME_REQUIRED_MESSAGE: 'Enter the bank name.',
  BANK_COUNTRY_REQUIRED_MESSAGE: 'Choose the bank country.',
  SWIFT_BIC_REQUIRED_MESSAGE: 'Enter the SWIFT / BIC code.',
  SWIFT_BIC_INVALID_MESSAGE: 'Enter an 8 or 11 character SWIFT / BIC. Bank codes like 001 or 057 are not BICs; use the bank picker for Paystack tests.',
  ACCOUNT_NUMBER_REQUIRED_MESSAGE: 'Enter the account number.',
  ACCOUNT_NAME_REQUIRED_MESSAGE: 'Enter the account name.',
  INVALID_MESSAGE: 'Please complete the manual bank details before submitting.',
} as const

export const PAYOUT_BANK_LOGO_DOMAINS = {
  ACCESS: 'accessbankplc.com',
  ECOBANK: 'ecobank.com',
  FIDELITY: 'fidelitybank.ng',
  FIRST_BANK: 'firstbanknigeria.com',
  FCMB: 'fcmb.com',
  GTBANK: 'gtbank.com',
  KEYSTONE: 'keystonebankng.com',
  POLARIS: 'polarisbanklimited.com',
  STANBIC: 'stanbicibtcbank.com',
  STERLING: 'sterling.ng',
  UNION: 'unionbankng.com',
  UBA: 'ubagroup.com',
  WEMA: 'wemabank.com',
  ZENITH: 'zenithbank.com',
  ABSA: 'absa.africa',
  EQUITY: 'equitygroupholdings.com',
  KCB: 'kcbgroup.com',
  STANCHART: 'sc.com',
} as const

export type ManualBankEntryField =
  | 'bankName'
  | 'bankCountryCode'
  | 'swiftBic'
  | 'accountNumber'
  | 'accountName'

export type ManualBankEntryFieldErrors = Partial<Record<ManualBankEntryField, string>>

export type ManualBankEntryInput = {
  payoutCurrency?: string | null
  bankName?: string | null
  bankCountryCode?: string | null
  swiftBic?: string | null
  accountNumber?: string | null
  accountName?: string | null
}

export type NormalizedManualBankEntry = {
  payoutCurrency: ManualBankPayoutCurrency
  bankName: string
  bankCountryCode: ManualBankCountryCode
  bankCountryName: string
  swiftBic: string
  accountNumber: string
  accountName: string
}

const SWIFT_BIC_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/
const LOGO_BASE_URL = 'https://logo.clearbit.com'

function normalizeRequiredText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : ''
}

export function normalizeSwiftBic(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, '').toUpperCase() : ''
}

function normalizeBankName(value: string | null | undefined) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/&/gu, 'and')
    : ''
}

export function payoutBankLogoUrl(bankName: string | null | undefined): string | null {
  const normalized = normalizeBankName(bankName)
  if (!normalized) return null

  const domain =
    normalized.includes('access') ? PAYOUT_BANK_LOGO_DOMAINS.ACCESS
      : normalized.includes('ecobank') ? PAYOUT_BANK_LOGO_DOMAINS.ECOBANK
        : normalized.includes('fidelity') ? PAYOUT_BANK_LOGO_DOMAINS.FIDELITY
          : normalized.includes('first city monument') || normalized.includes('fcmb') ? PAYOUT_BANK_LOGO_DOMAINS.FCMB
            : normalized.includes('first bank') ? PAYOUT_BANK_LOGO_DOMAINS.FIRST_BANK
              : normalized.includes('guaranty trust') || normalized.includes('gtbank') || normalized.includes('gt bank') ? PAYOUT_BANK_LOGO_DOMAINS.GTBANK
                : normalized.includes('keystone') ? PAYOUT_BANK_LOGO_DOMAINS.KEYSTONE
                  : normalized.includes('polaris') ? PAYOUT_BANK_LOGO_DOMAINS.POLARIS
                    : normalized.includes('stanbic') ? PAYOUT_BANK_LOGO_DOMAINS.STANBIC
                      : normalized.includes('sterling') ? PAYOUT_BANK_LOGO_DOMAINS.STERLING
                        : normalized.includes('union bank') ? PAYOUT_BANK_LOGO_DOMAINS.UNION
                          : normalized.includes('united bank for africa') || normalized.includes('uba') ? PAYOUT_BANK_LOGO_DOMAINS.UBA
                            : normalized.includes('wema') ? PAYOUT_BANK_LOGO_DOMAINS.WEMA
                              : normalized.includes('zenith') ? PAYOUT_BANK_LOGO_DOMAINS.ZENITH
                                : normalized.includes('absa') ? PAYOUT_BANK_LOGO_DOMAINS.ABSA
                                  : normalized.includes('equity') ? PAYOUT_BANK_LOGO_DOMAINS.EQUITY
                                    : normalized.includes('kcb') ? PAYOUT_BANK_LOGO_DOMAINS.KCB
                                      : normalized.includes('standard chartered') ? PAYOUT_BANK_LOGO_DOMAINS.STANCHART
                                        : null

  return domain ? `${LOGO_BASE_URL}/${domain}` : null
}

export function isValidSwiftBic(value: string | null | undefined) {
  const normalized = normalizeSwiftBic(value)
  return (normalized.length === 8 || normalized.length === 11) && SWIFT_BIC_PATTERN.test(normalized)
}

export function isManualBankCountryCode(value: string | null | undefined): value is ManualBankCountryCode {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return MANUAL_BANK_COUNTRIES.some((country) => country.code === normalized)
}

export function manualBankCountryName(value: ManualBankCountryCode) {
  return MANUAL_BANK_COUNTRIES.find((country) => country.code === value)?.name ?? value
}

export function normalizeManualBankPayoutCurrency(value: string | null | undefined): ManualBankPayoutCurrency {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return MANUAL_BANK_PAYOUT_CURRENCIES.includes(normalized as ManualBankPayoutCurrency)
    ? normalized as ManualBankPayoutCurrency
    : 'USD'
}

export function validateManualBankEntry(input: ManualBankEntryInput):
  | { ok: true; value: NormalizedManualBankEntry }
  | { ok: false; fieldErrors: ManualBankEntryFieldErrors; message: string } {
  const fieldErrors: ManualBankEntryFieldErrors = {}
  const payoutCurrency = normalizeManualBankPayoutCurrency(input.payoutCurrency)
  const bankName = normalizeRequiredText(input.bankName)
  const bankCountryCode = normalizeRequiredText(input.bankCountryCode).toUpperCase()
  const swiftBic = normalizeSwiftBic(input.swiftBic)
  const accountNumber = normalizeRequiredText(input.accountNumber)
  const accountName = normalizeRequiredText(input.accountName)

  if (!bankName) fieldErrors.bankName = MANUAL_BANK_VALIDATION.BANK_NAME_REQUIRED_MESSAGE
  if (!isManualBankCountryCode(bankCountryCode)) {
    fieldErrors.bankCountryCode = MANUAL_BANK_VALIDATION.BANK_COUNTRY_REQUIRED_MESSAGE
  }
  if (!swiftBic) {
    fieldErrors.swiftBic = MANUAL_BANK_VALIDATION.SWIFT_BIC_REQUIRED_MESSAGE
  } else if (!isValidSwiftBic(swiftBic)) {
    fieldErrors.swiftBic = MANUAL_BANK_VALIDATION.SWIFT_BIC_INVALID_MESSAGE
  }
  if (!accountNumber) fieldErrors.accountNumber = MANUAL_BANK_VALIDATION.ACCOUNT_NUMBER_REQUIRED_MESSAGE
  if (!accountName) fieldErrors.accountName = MANUAL_BANK_VALIDATION.ACCOUNT_NAME_REQUIRED_MESSAGE

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      fieldErrors,
      message: MANUAL_BANK_VALIDATION.INVALID_MESSAGE,
    }
  }

  const countryCode = bankCountryCode as ManualBankCountryCode

  return {
    ok: true,
    value: {
      payoutCurrency,
      bankName,
      bankCountryCode: countryCode,
      bankCountryName: manualBankCountryName(countryCode),
      swiftBic,
      accountNumber,
      accountName,
    },
  }
}

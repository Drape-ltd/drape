import { PHONE_STORAGE_HINT } from '@drape/shared/phone'

type PhoneContextRule = {
  pattern: RegExp
  hint: string
}

const PHONE_CONTEXT_RULES: PhoneContextRule[] = [
  {
    pattern: /\b(nigeria|lagos|abuja|ibadan|lekki|port harcourt|oyo|kaduna)\b/i,
    hint: 'For Nigeria, 08012345678 or +2348012345678 both work.',
  },
  {
    pattern: /\b(united kingdom|uk|england|scotland|wales|london|manchester|birmingham)\b/i,
    hint: 'For the UK, use +44, for example +447700900123.',
  },
  {
    pattern: /\b(united states|usa|us|new york|california|texas|florida|georgia)\b/i,
    hint: 'For the US, use +1, for example +14155550123.',
  },
  {
    pattern: /\b(canada|toronto|ontario|vancouver|montreal|calgary|british columbia)\b/i,
    hint: 'For Canada, use +1, for example +14165550123.',
  },
  {
    pattern: /\b(ghana|accra|kumasi)\b/i,
    hint: 'For Ghana, use +233, for example +233201234567.',
  },
  {
    pattern: /\b(kenya|nairobi|mombasa)\b/i,
    hint: 'For Kenya, use +254, for example +254712345678.',
  },
]

export function phoneHintForContext(...values: Array<string | null | undefined>) {
  const combined = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ')
  const match = PHONE_CONTEXT_RULES.find((rule) => rule.pattern.test(combined))
  return match ? `${match.hint} ${PHONE_STORAGE_HINT}` : PHONE_STORAGE_HINT
}

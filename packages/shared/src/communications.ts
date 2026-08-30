export const COMMUNICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'] as const
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number]

export const COMMUNICATION_PURPOSES = ['TRANSACTIONAL', 'OPERATIONAL', 'MARKETING'] as const
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number]

export const COMMUNICATION_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const
export type CommunicationSeverity = (typeof COMMUNICATION_SEVERITIES)[number]

export const COMMUNICATION_CATEGORIES = [
  'ORDER',
  'MESSAGE',
  'PAYMENT',
  'PAYOUT',
  'ACCOUNT',
  'SECURITY',
  'SUPPORT',
  'SAFETY',
  'SERVICE_STATUS',
  'PROMOTION',
  'PRODUCT_UPDATE',
] as const
export type CommunicationCategory = (typeof COMMUNICATION_CATEGORIES)[number]

export type CommunicationPolicyInput = {
  category: CommunicationCategory
  purpose: CommunicationPurpose
  severity?: CommunicationSeverity
  actionRequired?: boolean
  timeSensitive?: boolean
  allowSmsFallback?: boolean
}

export type CommunicationPolicy = {
  category: CommunicationCategory
  purpose: CommunicationPurpose
  severity: CommunicationSeverity
  channels: readonly CommunicationChannel[]
  mandatory: boolean
  requiresConsent: boolean
  acknowledgementRequired: boolean
  smsFallback: boolean
}

const MANDATORY_CATEGORIES = new Set<CommunicationCategory>([
  'PAYMENT',
  'PAYOUT',
  'ACCOUNT',
  'SECURITY',
  'SUPPORT',
  'SAFETY',
  'SERVICE_STATUS',
])

export function isMandatoryCommunication(input: Pick<CommunicationPolicyInput, 'category' | 'purpose' | 'severity'>) {
  return input.purpose !== 'MARKETING' && (
    MANDATORY_CATEGORIES.has(input.category) || input.severity === 'CRITICAL'
  )
}

export function resolveCommunicationPolicy(input: CommunicationPolicyInput): CommunicationPolicy {
  const severity = input.severity ?? 'NOTICE'
  const requiresConsent = input.purpose === 'MARKETING'
  const mandatory = isMandatoryCommunication({ ...input, severity })
  const actionRequired = input.actionRequired === true || severity === 'WARNING' || severity === 'CRITICAL'
  const channels: CommunicationChannel[] = requiresConsent
    ? ['IN_APP']
    : actionRequired
      ? ['IN_APP', 'PUSH', 'EMAIL']
      : ['IN_APP']
  const smsFallback = mandatory && input.timeSensitive === true && input.allowSmsFallback === true

  return {
    category: input.category,
    purpose: input.purpose,
    severity,
    channels,
    mandatory,
    requiresConsent,
    acknowledgementRequired: input.actionRequired === true || severity === 'CRITICAL',
    smsFallback,
  }
}

export type CommunicationPreferenceDefaults = Record<CommunicationCategory, Record<CommunicationChannel, boolean>>

export function defaultCommunicationPreferences(): CommunicationPreferenceDefaults {
  return Object.fromEntries(COMMUNICATION_CATEGORIES.map((category) => [
    category,
    Object.fromEntries(COMMUNICATION_CHANNELS.map((channel) => [
      channel,
      category === 'PROMOTION' || category === 'PRODUCT_UPDATE' ? false : channel !== 'SMS',
    ])),
  ])) as CommunicationPreferenceDefaults
}

export function legacyPreferenceCategory(key: string): CommunicationCategory | null {
  switch (key) {
    case 'messages': return 'MESSAGE'
    case 'quotes':
    case 'newOrders':
    case 'orderUpdates': return 'ORDER'
    case 'paymentConfirmations': return 'PAYMENT'
    case 'paymentReleased': return 'PAYOUT'
    case 'promotions': return 'PROMOTION'
    case 'platformUpdates': return 'PRODUCT_UPDATE'
    case 'reviews': return 'ORDER'
    default: return null
  }
}

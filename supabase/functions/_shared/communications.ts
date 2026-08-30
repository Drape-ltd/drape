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

export const COMMUNICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'] as const

export type CommunicationCategory = (typeof COMMUNICATION_CATEGORIES)[number]
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number]

const MANDATORY_CATEGORIES = new Set<CommunicationCategory>([
  'PAYMENT',
  'PAYOUT',
  'ACCOUNT',
  'SECURITY',
  'SUPPORT',
  'SAFETY',
  'SERVICE_STATUS',
])

export function isCommunicationCategory(value: unknown): value is CommunicationCategory {
  return typeof value === 'string' && COMMUNICATION_CATEGORIES.includes(value as CommunicationCategory)
}
export function isCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === 'string' && COMMUNICATION_CHANNELS.includes(value as CommunicationChannel)
}

export function isMandatoryCommunicationCategory(category: CommunicationCategory): boolean {
  return MANDATORY_CATEGORIES.has(category)
}

export function defaultCommunicationEnabled(
  category: CommunicationCategory,
  channel: CommunicationChannel,
): boolean {
  if (channel === 'IN_APP') return true
  if (category === 'PROMOTION' || category === 'PRODUCT_UPDATE') return false
  return channel !== 'SMS'
}

export function communicationDefaults() {
  return Object.fromEntries(COMMUNICATION_CATEGORIES.map((category) => [
    category,
    Object.fromEntries(COMMUNICATION_CHANNELS.map((channel) => [
      channel,
      {
        enabled: defaultCommunicationEnabled(category, channel),
        mandatory: isMandatoryCommunicationCategory(category),
        requiresConsent: (category === 'PROMOTION' || category === 'PRODUCT_UPDATE') && channel !== 'IN_APP',
      },
    ])),
  ]))
}

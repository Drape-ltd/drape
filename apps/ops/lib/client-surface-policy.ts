const MOBILE_USER_AGENT = /Android|iPad|iPhone|iPod|IEMobile|Mobile|Opera Mini/u

export type OpsClientHeaders = {
  get(name: string): string | null
}

/**
 * Classifies the requesting surface for the restricted Ops PWA contract.
 *
 * This is deliberately a fail-closed server decision. Client CSS and hidden
 * navigation are presentation only and never expand the actions available on
 * a phone.
 */
export function isRestrictedOpsPhoneHeaders(value: OpsClientHeaders) {
  const mobileHint = value.get('sec-ch-ua-mobile')?.trim()
  if (mobileHint === '?1') return true
  return MOBILE_USER_AGENT.test(value.get('user-agent') ?? '')
}

import { CONTACTS } from '@drape/shared'
import { deriveTailorReadiness, type TailorReadinessInput } from './tailor-readiness'

export type TailorAccessState = 'CLEAR' | 'FIX_REQUIRED' | 'UNDER_REVIEW'

export type TailorAccessGuidance = {
  state: TailorAccessState
  title: string
  body: string
  reasonCategory: string
  blockedCapabilities: string[]
  nextStep: string
  supportEmail: string | null
  supportLabel: string | null
  supportSubject: string | null
  appealCopy: string | null
}

function sharedBlockedCapabilities(readiness: ReturnType<typeof deriveTailorReadiness>) {
  const blocked: string[] = []

  if (!readiness.publicDiscoveryReady) {
    blocked.push('Public discovery stays limited')
  }

  if (!readiness.canAcceptPaidOrders) {
    blocked.push('Paid quotes stay blocked')
  }

  if (!readiness.canPublishPaidItems) {
    blocked.push('Live paid shop items stay blocked')
  }

  return blocked
}

export function deriveTailorAccessGuidance(input: TailorReadinessInput | null | undefined): TailorAccessGuidance {
  const readiness = deriveTailorReadiness(input)
  const idStatus = input?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const liveHigherRisk = input?.isLive === true && input?.shipsInternationally === true
  const blockedCapabilities = sharedBlockedCapabilities(readiness)

  if (!input?.profileCompleted) {
    return {
      state: 'FIX_REQUIRED',
      title: 'Finish setup before full seller access opens',
      body: 'This is a self-fixable setup hold, not a trust strike. Customers should not discover or pay a storefront that is still missing the core public profile.',
      reasonCategory: 'Profile setup',
      blockedCapabilities,
      nextStep: 'Complete your public profile first, then return here if anything still looks stuck.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drapeon tailor setup help',
      appealCopy: null,
    }
  }

  if (idStatus === 'PENDING') {
    return {
      state: 'UNDER_REVIEW',
      title: 'Identity review is in progress',
      body: 'This is a review state, not an appeal state. Public discovery and paid work should stay conservative until identity review finishes.',
      reasonCategory: 'Identity review',
      blockedCapabilities,
      nextStep: 'Wait for review to finish, or contact the verification team if something has been pending unusually long or you submitted the wrong document.',
      supportEmail: CONTACTS.verify,
      supportLabel: 'Verification team',
      supportSubject: 'Drapeon verification review follow-up',
      appealCopy: 'Appeals are usually unnecessary while review is still active. Use support to add missing context instead.',
    }
  }

  if (idStatus === 'REJECTED') {
    return {
      state: 'FIX_REQUIRED',
      title: 'Verification needs attention before access can expand',
      body: 'This usually means Drapeon still needs clearer or corrected identity evidence. It should be treated as fix-first, not full appeal-first.',
      reasonCategory: 'Verification follow-up',
      blockedCapabilities,
      nextStep: 'Resubmit verification with clearer evidence. If you think Drapeon made a factual mistake, contact the verification team with that context.',
      supportEmail: CONTACTS.verify,
      supportLabel: 'Verification team',
      supportSubject: 'Drapeon verification follow-up',
      appealCopy: 'Use support for factual-error correction or new evidence. A simple disagreement is usually not enough by itself.',
    }
  }

  if (!readiness.payoutReady) {
    return {
      state: 'FIX_REQUIRED',
      title: 'Set up your payout account before paid work opens',
      body: 'This is an operational hold, not a trust strike. Identity checks look good, but Drapeon should not route paid work to a seller whose payout path is not actually ready.',
      reasonCategory: 'Payout readiness',
      blockedCapabilities,
      nextStep: 'Open payout setup, verify the payout path Drapeon should use, and use the payouts inbox only if the in-app path still gets stuck.',
      supportEmail: CONTACTS.payouts,
      supportLabel: 'Payouts',
      supportSubject: 'Drapeon payout readiness question',
      appealCopy: 'Operational payout holds are usually solved by fixing the requirement rather than filing a formal appeal.',
    }
  }

  if (liveHigherRisk) {
    return {
      state: 'CLEAR',
      title: 'Access is open, with higher-risk work kept conservative',
      body: 'Your current setup supports standard paid work. Keep international orders especially clear in the order thread so support can help quickly if anything changes.',
      reasonCategory: 'Higher-risk capability',
      blockedCapabilities,
      nextStep: 'Keep your storefront, payout setup, and communication clean. If support asks for extra context on a higher-risk order, keep the response inside Drapeon.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drapeon tailor trust question',
      appealCopy: null,
    }
  }

  return {
    state: 'CLEAR',
    title: 'Your standard seller access looks healthy',
    body: 'Profile, identity, and payout signals currently support normal paid work.',
    reasonCategory: 'Normal access',
    blockedCapabilities,
    nextStep: 'Keep your storefront honest, your communication in Drapeon, and your payout details up to date.',
    supportEmail: CONTACTS.tailors,
    supportLabel: 'Tailor support',
    supportSubject: 'Drapeon tailor trust question',
    appealCopy: null,
  }
}

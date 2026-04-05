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
  caution: string | null
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
      supportSubject: 'Drape tailor setup help',
      appealCopy: null,
      caution: 'Drape will use this screen for broader review or restriction states later. Right now it reflects live onboarding, verification, and payout access only.',
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
      supportSubject: 'Drape verification review follow-up',
      appealCopy: 'Appeals are usually unnecessary while review is still active. Use support to add missing context instead.',
      caution: null,
    }
  }

  if (idStatus === 'REJECTED') {
    return {
      state: 'FIX_REQUIRED',
      title: 'Verification needs attention before access can expand',
      body: 'This usually means Drape still needs clearer or corrected identity evidence. It should be treated as fix-first, not full appeal-first.',
      reasonCategory: 'Verification follow-up',
      blockedCapabilities,
      nextStep: 'Resubmit verification with clearer evidence. If you think Drape made a factual mistake, contact the verification team with that context.',
      supportEmail: CONTACTS.verify,
      supportLabel: 'Verification team',
      supportSubject: 'Drape verification follow-up',
      appealCopy: 'Use support for factual-error correction or new evidence. A simple disagreement is usually not enough by itself.',
      caution: null,
    }
  }

  if (!readiness.payoutReady) {
    return {
      state: 'FIX_REQUIRED',
      title: 'Payout setup is the last blocker before paid work',
      body: 'This is an operational hold. Identity checks look good, but Drape should not route paid work to a seller whose payout path is not actually ready.',
      reasonCategory: 'Payout readiness',
      blockedCapabilities,
      nextStep: 'Review payout readiness, connect the missing payout path, and use the payouts inbox if the provider or bank side still looks blocked.',
      supportEmail: CONTACTS.payouts,
      supportLabel: 'Payouts',
      supportSubject: 'Drape payout readiness question',
      appealCopy: 'Operational payout holds are usually solved by fixing the requirement rather than filing a formal appeal.',
      caution: null,
    }
  }

  if (liveHigherRisk) {
    return {
      state: 'CLEAR',
      title: 'Access is open, with higher-risk work kept conservative',
      body: 'Your current setup supports standard paid work. Cross-border or higher-risk flows should still stay more ops-visible while Drape is learning.',
      reasonCategory: 'Higher-risk capability',
      blockedCapabilities,
      nextStep: 'Keep your storefront, payout setup, and communication clean. If Drape ever limits a higher-risk capability later, this screen should explain the reason and next step.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drape tailor trust question',
      appealCopy: null,
      caution: 'No broader trust restriction is shown right now. This screen is still a visibility-first layer around the signals Drape already stores.',
    }
  }

  return {
    state: 'CLEAR',
    title: 'Your standard seller access looks healthy',
    body: 'Profile, identity, and payout signals currently support normal paid work. This is the calm state we want before more advanced trust controls land.',
    reasonCategory: 'Normal access',
    blockedCapabilities,
    nextStep: 'Keep your storefront honest, your communication in Drape, and your payout details up to date.',
    supportEmail: CONTACTS.tailors,
    supportLabel: 'Tailor support',
    supportSubject: 'Drape tailor trust question',
    appealCopy: null,
    caution: 'If Drape later limits discovery, intake, payouts, or higher-risk work, this screen should become the place that explains why and what clears it.',
  }
}

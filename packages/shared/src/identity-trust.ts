export const IDENTITY_CONSENT_POLICY_VERSION = 'tailor-trust-video-v1' as const

export const IDENTITY_CONSENT_COPY =
  'I consent to Drapeon processing this short challenge video for marketplace trust review, account safety, and fraud prevention. The video stays private, is limited to authorized trust reviewers, and is retained or erased under Drapeon\'s published privacy obligations.'

export const TAILOR_TRUST_VIDEO_MIN_SECONDS = 8
export const TAILOR_TRUST_VIDEO_MAX_SECONDS = 15

export const TAILOR_TRUST_VIDEO_CHALLENGES = [
  {
    id: 'profile-work-payments',
    text: 'Say your name, then say: I created this Drapeon tailor profile, the work shown is mine, and I will keep orders and payments on Drapeon.',
  },
  {
    id: 'profile-orders-safety',
    text: 'Say your name, then say: I am the person running this Drapeon tailor profile, and I will manage customer orders safely through Drapeon.',
  },
  {
    id: 'profile-craft-trust',
    text: 'Say your name, then say: This is my Drapeon tailor profile, I stand behind the work I share, and I will communicate with customers inside Drapeon.',
  },
] as const

export type IdentityRetentionState =
  | 'ACTIVE'
  | 'RESTRICTED_PROCESSING'
  | 'LEGAL_HOLD'
  | 'ERASURE_DUE'
  | 'ERASED'

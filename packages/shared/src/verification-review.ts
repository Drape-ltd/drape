export const VERIFICATION_REJECTION_CODES = [
  'INVALID_PROFILE_IMAGE',
  'INVALID_PORTFOLIO_MEDIA',
  'OFF_PLATFORM_CONTACT',
  'BUSINESS_IDENTITY_MISMATCH',
  'LOCATION_MISMATCH',
  'PAYOUT_DESTINATION_MISMATCH',
  'NEEDS_LIVE_SELFIE_RETAKE',
  'GENERAL_TRUST_REVIEW',
] as const

export type VerificationRejectionCode = (typeof VERIFICATION_REJECTION_CODES)[number]

export const PROFILE_CHANGE_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'CANCELLED',
] as const

export type ProfileChangeRequestStatus = (typeof PROFILE_CHANGE_REQUEST_STATUSES)[number]

export const PAYOUT_CHANGE_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const

export type PayoutChangeRequestStatus = (typeof PAYOUT_CHANGE_REQUEST_STATUSES)[number]

export const LIVE_TAILOR_VERIFICATION_STATUSES = ['VERIFIED', 'APPROVED'] as const

export function isLiveTailorVerificationStatus(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized === 'VERIFIED' || normalized === 'APPROVED'
}

export const PROFILE_IMAGE_REJECTION_MESSAGE =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'

export function normalizeVerificationRejectionCode(value: string | null | undefined): VerificationRejectionCode | null {
  const normalized = value?.trim().toUpperCase()
  return VERIFICATION_REJECTION_CODES.find((code) => code === normalized) ?? null
}

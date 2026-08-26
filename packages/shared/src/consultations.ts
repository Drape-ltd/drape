export const CONSULTATION_POLICY_VERSION = 'consultation-2026-07-31-v1' as const

export const CONSULTATION_MODES = ['UNAVAILABLE', 'FREE', 'PAID'] as const
export const CONSULTATION_REQUIREMENTS = ['OPTIONAL', 'REQUIRED'] as const
export const CONSULTATION_CALL_TYPES = ['AUDIO', 'VIDEO', 'AUDIO_OR_VIDEO'] as const
export const CONCRETE_CONSULTATION_CALL_TYPES = ['AUDIO', 'VIDEO'] as const
export const CONSULTATION_REQUEST_EXPIRY_HOURS = 48 as const
export const CONSULTATION_ATTENDANCE_OUTCOMES = [
  'PENDING_WINDOW',
  'ATTENDED',
  'CUSTOMER_NO_SHOW_ELIGIBLE',
  'TAILOR_NO_SHOW_ELIGIBLE',
  'CONNECTION_OR_SCHEDULING_ISSUE',
  'INSUFFICIENT_EVIDENCE',
] as const

export type ConsultationMode = (typeof CONSULTATION_MODES)[number]
export type ConsultationRequirement = (typeof CONSULTATION_REQUIREMENTS)[number]
export type ConsultationCallType = (typeof CONSULTATION_CALL_TYPES)[number]
export type ConcreteConsultationCallType = (typeof CONCRETE_CONSULTATION_CALL_TYPES)[number]
export type ConsultationAttendanceOutcome = (typeof CONSULTATION_ATTENDANCE_OUTCOMES)[number]

export const CONSULTATION_TERMINAL_ACTIONS = [
  'COMPLETE_FREE',
  'CLOSE_FREE_NO_ACTIVITY',
  'RELEASE_TAILOR_EARNING',
  'REFUND_CUSTOMER',
  'OPS_REVIEW',
] as const

export type ConsultationTerminalAction = (typeof CONSULTATION_TERMINAL_ACTIONS)[number]

/**
 * Turns provider-backed attendance into the one terminal commercial action the
 * server must take. Creating or opening a call room is intentionally absent:
 * only recorded participation can prove attendance.
 */
export function deriveConsultationTerminalAction(input: {
  feeMode: 'FREE' | 'PAID'
  paymentStatus?: string | null
  attendanceOutcome: ConsultationAttendanceOutcome
  customerVerifiedSeconds: number
  tailorVerifiedSeconds: number
  hasOpenReview?: boolean
}): ConsultationTerminalAction {
  if (input.hasOpenReview) return 'OPS_REVIEW'

  const paid = input.feeMode === 'PAID'
  if (paid && input.paymentStatus !== 'PAID') return 'OPS_REVIEW'

  if (input.attendanceOutcome === 'ATTENDED') {
    return paid ? 'RELEASE_TAILOR_EARNING' : 'COMPLETE_FREE'
  }
  if (input.attendanceOutcome === 'CUSTOMER_NO_SHOW_ELIGIBLE') {
    return paid ? 'RELEASE_TAILOR_EARNING' : 'CLOSE_FREE_NO_ACTIVITY'
  }
  if (input.attendanceOutcome === 'TAILOR_NO_SHOW_ELIGIBLE') {
    return paid ? 'REFUND_CUSTOMER' : 'CLOSE_FREE_NO_ACTIVITY'
  }

  const noActivity = input.customerVerifiedSeconds <= 0 && input.tailorVerifiedSeconds <= 0
  if (noActivity) return paid ? 'REFUND_CUSTOMER' : 'CLOSE_FREE_NO_ACTIVITY'

  return 'OPS_REVIEW'
}

const CONSULTATION_ATTENDANCE_EVIDENCE_COPY: Record<ConsultationAttendanceOutcome, { title: string; detail: string }> = {
  PENDING_WINDOW: {
    title: 'Call activity is still being checked',
    detail: 'Drapeon is waiting for the scheduled attendance window to finish.',
  },
  ATTENDED: {
    title: 'Call attendance verified',
    detail: 'Call records show enough shared time to confirm attendance.',
  },
  CUSTOMER_NO_SHOW_ELIGIBLE: {
    title: 'Customer attendance could not be verified',
    detail: 'Call records show the tailor waiting, but not enough customer activity to decide automatically.',
  },
  TAILOR_NO_SHOW_ELIGIBLE: {
    title: 'Tailor attendance could not be verified',
    detail: 'Call records show the customer waiting, but not enough tailor activity to decide automatically.',
  },
  CONNECTION_OR_SCHEDULING_ISSUE: {
    title: 'Call timing or connection needs review',
    detail: 'Call records show some activity, but not enough shared time to confirm attendance.',
  },
  INSUFFICIENT_EVIDENCE: {
    title: 'Call activity could not be verified',
    detail: 'There was not enough call activity to confirm attendance. The other person has been asked to respond.',
  },
}

export function consultationAttendanceEvidenceCopy(value: string | null | undefined) {
  if (value && value in CONSULTATION_ATTENDANCE_EVIDENCE_COPY) {
    return CONSULTATION_ATTENDANCE_EVIDENCE_COPY[value as ConsultationAttendanceOutcome]
  }
  return {
    title: 'Call activity needs review',
    detail: 'Drapeon is checking the call activity and both accounts before recording an outcome.',
  }
}

export type ConsultationAttendanceReviewSnapshot = {
  status: string | null
  reportedByRole: 'CUSTOMER' | 'TAILOR' | null
  resolutionCode: string | null
}

export type ConsultationOrderListState = {
  label: string
  needsAction: boolean
}

export function consultationAttendanceResolutionCopy(resolutionCode: string | null | undefined) {
  if (resolutionCode === 'RESCHEDULE_REQUIRED') {
    return {
      title: 'Order ready for a quote',
      status: 'Consultation closed',
      detail: 'Drapeon reviewed the call activity. The order can move to a quote; any make-up conversation is optional and free.',
    }
  }
  if (resolutionCode === 'CUSTOMER_REFUND_APPROVED') {
    return {
      title: 'Consultation refund approved',
      status: 'Refund processing',
      detail: 'The refund is in Money Desk and provider processing. The order will show the terminal result when it arrives.',
    }
  }
  if (resolutionCode === 'TAILOR_EARNING_VERIFIED') {
    return {
      title: 'Tailor attendance verified',
      status: 'Earning processing',
      detail: 'The consultation earning is in Money Desk and payout processing. The terminal provider result will be recorded here.',
    }
  }
  return {
    title: 'Attendance review complete',
    status: 'Review complete',
    detail: 'Drapeon recorded the consultation attendance outcome.',
  }
}

export function consultationOrderListState(input: {
  actorRole: 'CUSTOMER' | 'TAILOR'
  review?: ConsultationAttendanceReviewSnapshot | null
}): ConsultationOrderListState | null {
  const review = input.review
  if (!review) return null

  if (review.status === 'COUNTERPARTY_REVIEW') {
    return review.reportedByRole === input.actorRole
      ? { label: 'Attendance report sent', needsAction: false }
      : { label: 'Attendance response needed', needsAction: true }
  }
  if (review.status === 'OPS_REVIEW') {
    return { label: 'Attendance under review', needsAction: false }
  }
  if (review.resolutionCode === 'RESCHEDULE_REQUIRED') {
    return { label: 'Quote ready', needsAction: false }
  }
  if (review.resolutionCode === 'CUSTOMER_REFUND_APPROVED') {
    return { label: 'Consultation refund processing', needsAction: false }
  }
  if (review.resolutionCode === 'TAILOR_EARNING_VERIFIED') {
    return { label: 'Consultation earning processing', needsAction: false }
  }
  if (review.status === 'RESOLVED') {
    return { label: 'Attendance review complete', needsAction: false }
  }
  return null
}

export type ConsultationPolicy = {
  version: typeof CONSULTATION_POLICY_VERSION | string
  mode: ConsultationMode
  requirement: ConsultationRequirement
  feeAmount: number | null
  currency: string | null
  durationMinutes: 15 | 30 | 45 | 60
  callType: ConsultationCallType
  feeCreditable: boolean
}

export function resolveConsultationCallType(
  publishedType: ConsultationCallType | null | undefined,
  requestedType?: ConcreteConsultationCallType | null,
): ConcreteConsultationCallType | null {
  if (publishedType === 'AUDIO' || publishedType === 'VIDEO') return publishedType
  if (publishedType === 'AUDIO_OR_VIDEO') {
    return requestedType && CONCRETE_CONSULTATION_CALL_TYPES.includes(requestedType)
      ? requestedType
      : null
  }
  return requestedType ?? null
}

export function consultationRequestExpiresAt(requestedAt: string | Date | number) {
  const timestamp = new Date(requestedAt).getTime()
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp + CONSULTATION_REQUEST_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
}

/**
 * The booked appointment and the order workflow use separate clocks. Once the
 * booked window ends, quote preparation resumes. Attendance, fee settlement,
 * and optional make-up conversations never block the commercial order.
 */
export function shouldOpenQuotePreparationAfterConsultation(input: {
  scheduledEndAt: string | Date | number
  now?: string | Date | number
}) {
  const scheduledEndAt = timestamp(input.scheduledEndAt)
  const now = timestamp(input.now ?? Date.now())
  if (scheduledEndAt == null || now == null) return false
  return now >= scheduledEndAt
}

export type ConsultationParticipationInterval = {
  joinedAt: string | Date | number
  leftAt: string | Date | number | null
}

export type ConsultationAttendanceEvaluation = {
  outcome: ConsultationAttendanceOutcome
  customerVerifiedSeconds: number
  tailorVerifiedSeconds: number
  verifiedOverlapSeconds: number
  customerWaitedThroughDeadline: boolean
  tailorWaitedThroughDeadline: boolean
  customerLateVisit: boolean
  tailorLateVisit: boolean
  providerEvidenceComplete: boolean
}

export const CONSULTATION_ATTENDANCE_POLICY = Object.freeze({
  graceMinutes: 10,
  claimantWaitMinutes: 15,
  attendedOverlapMinutes: 5,
  contestWindowHours: 24,
})

export const CONSULTATION_CANCELLATION_POLICY = Object.freeze({
  fullRefundNoticeHours: 24,
  lateCustomerRefundPercent: 50,
})

export type ConsultationCancellationActor = 'CUSTOMER' | 'TAILOR' | 'SYSTEM'
export type ConsultationCancellationOutcome =
  | 'CUSTOMER_FULL_REFUND'
  | 'CUSTOMER_PARTIAL_REFUND'
  | 'TAILOR_FULL_REFUND'
  | 'PROVIDER_FULL_REFUND'
  | 'REVIEW_REQUIRED'

export function deriveConsultationCancellation(input: {
  actorRole: ConsultationCancellationActor
  scheduledStartAt: string | Date | number
  cancelledAt?: string | Date | number
  feeAmount: number
  providerFailure?: boolean
}) {
  const scheduledStart = timestamp(input.scheduledStartAt)
  const cancelledAt = timestamp(input.cancelledAt ?? Date.now())
  const feeAmount = Number.isInteger(input.feeAmount) && input.feeAmount > 0 ? input.feeAmount : 0
  if (scheduledStart == null || cancelledAt == null) throw new Error('Consultation schedule is invalid.')
  const hoursBeforeStart = (scheduledStart - cancelledAt) / (60 * minuteMs)

  if (input.providerFailure || input.actorRole === 'SYSTEM') {
    return { outcome: 'PROVIDER_FULL_REFUND' as const, refundAmount: feeAmount, tailorEarnedAmount: 0, hoursBeforeStart, requiresReview: false }
  }
  if (input.actorRole === 'TAILOR') {
    return { outcome: 'TAILOR_FULL_REFUND' as const, refundAmount: feeAmount, tailorEarnedAmount: 0, hoursBeforeStart, requiresReview: false }
  }
  if (hoursBeforeStart <= 0) {
    return { outcome: 'REVIEW_REQUIRED' as const, refundAmount: 0, tailorEarnedAmount: 0, hoursBeforeStart, requiresReview: true }
  }
  if (hoursBeforeStart >= CONSULTATION_CANCELLATION_POLICY.fullRefundNoticeHours) {
    return { outcome: 'CUSTOMER_FULL_REFUND' as const, refundAmount: feeAmount, tailorEarnedAmount: 0, hoursBeforeStart, requiresReview: false }
  }
  const refundAmount = Math.floor(feeAmount * CONSULTATION_CANCELLATION_POLICY.lateCustomerRefundPercent / 100)
  return {
    outcome: 'CUSTOMER_PARTIAL_REFUND' as const,
    refundAmount,
    tailorEarnedAmount: feeAmount - refundAmount,
    hoursBeforeStart,
    requiresReview: false,
  }
}

const minuteMs = 60_000

function timestamp(value: string | Date | number | null) {
  if (value == null) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function mergeIntervals(intervals: ConsultationParticipationInterval[]) {
  const normalized = intervals
    .map((interval) => {
      const start = timestamp(interval.joinedAt)
      const end = timestamp(interval.leftAt)
      if (start == null || end == null || end <= start) return null
      return { start, end }
    })
    .filter((interval): interval is { start: number; end: number } => interval != null)
    .sort((left, right) => left.start - right.start)

  return normalized.reduce<Array<{ start: number; end: number }>>((result, interval) => {
    const previous = result[result.length - 1]
    if (!previous || interval.start > previous.end) {
      result.push({ ...interval })
    } else {
      previous.end = Math.max(previous.end, interval.end)
    }
    return result
  }, [])
}

function intervalSeconds(intervals: Array<{ start: number; end: number }>) {
  return Math.round(intervals.reduce((total, interval) => total + interval.end - interval.start, 0) / 1000)
}

function clipped(
  intervals: Array<{ start: number; end: number }>,
  start: number,
  end: number,
) {
  return intervals
    .map((interval) => ({ start: Math.max(interval.start, start), end: Math.min(interval.end, end) }))
    .filter((interval) => interval.end > interval.start)
}

function overlapSeconds(
  left: Array<{ start: number; end: number }>,
  right: Array<{ start: number; end: number }>,
) {
  let leftIndex = 0
  let rightIndex = 0
  let longest = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex]!
    const rightInterval = right[rightIndex]!
    const start = Math.max(leftInterval.start, rightInterval.start)
    const end = Math.min(leftInterval.end, rightInterval.end)
    if (end > start) longest = Math.max(longest, end - start)
    if (leftInterval.end <= rightInterval.end) leftIndex += 1
    else rightIndex += 1
  }
  return Math.round(longest / 1000)
}

function waitedContinuously(
  intervals: Array<{ start: number; end: number }>,
  deadline: number,
  requiredMs: number,
) {
  return intervals.some((interval) => interval.start <= deadline && interval.end - interval.start >= requiredMs)
}

export function validateConsultationPolicy(policy: ConsultationPolicy) {
  if (!CONSULTATION_MODES.includes(policy.mode)) return { ok: false as const, error: 'Choose a consultation availability.' }
  if (!CONSULTATION_REQUIREMENTS.includes(policy.requirement)) return { ok: false as const, error: 'Choose whether consultation is optional or required.' }
  if (![15, 30, 45, 60].includes(policy.durationMinutes)) return { ok: false as const, error: 'Choose a 15, 30, 45, or 60 minute consultation.' }
  if (!CONSULTATION_CALL_TYPES.includes(policy.callType)) return { ok: false as const, error: 'Choose an audio or video call option.' }
  if (policy.mode === 'PAID') {
    if (!Number.isInteger(policy.feeAmount) || (policy.feeAmount ?? 0) <= 0) return { ok: false as const, error: 'Enter a valid consultation fee.' }
    if (!policy.currency?.trim()) return { ok: false as const, error: 'Choose a consultation currency.' }
  }
  if (policy.mode !== 'PAID' && policy.feeAmount != null) return { ok: false as const, error: 'Only paid consultations can have a fee.' }
  if (policy.mode !== 'PAID' && policy.feeCreditable) return { ok: false as const, error: 'Only a paid consultation can be credited toward an order.' }
  return { ok: true as const }
}

export function formatConsultationPolicy(policy: ConsultationPolicy) {
  if (policy.mode === 'UNAVAILABLE') return 'Consultations are not offered.'
  if (policy.mode === 'FREE') return `${policy.requirement === 'REQUIRED' ? 'Required' : 'Optional'} free ${policy.durationMinutes}-minute consultation.`
  return `${policy.requirement === 'REQUIRED' ? 'Required' : 'Optional'} paid ${policy.durationMinutes}-minute consultation${policy.feeCreditable ? '; credited toward an accepted order' : ''}.`
}

export function evaluateConsultationAttendance(input: {
  scheduledStartAt: string | Date | number
  scheduledEndAt: string | Date | number
  evaluatedAt?: string | Date | number
  customerIntervals: ConsultationParticipationInterval[]
  tailorIntervals: ConsultationParticipationInterval[]
  providerEvidenceComplete: boolean
}): ConsultationAttendanceEvaluation {
  const scheduledStart = timestamp(input.scheduledStartAt)
  const scheduledEnd = timestamp(input.scheduledEndAt)
  const evaluatedAt = timestamp(input.evaluatedAt ?? Date.now())
  if (scheduledStart == null || scheduledEnd == null || evaluatedAt == null || scheduledEnd <= scheduledStart) {
    throw new Error('Consultation schedule is invalid.')
  }

  const graceDeadline = scheduledStart + CONSULTATION_ATTENDANCE_POLICY.graceMinutes * minuteMs
  const claimWindowEnd = scheduledStart + CONSULTATION_ATTENDANCE_POLICY.claimantWaitMinutes * minuteMs
  const customer = mergeIntervals(input.customerIntervals)
  const tailor = mergeIntervals(input.tailorIntervals)
  const customerInWindow = clipped(customer, scheduledStart - 5 * minuteMs, scheduledEnd)
  const tailorInWindow = clipped(tailor, scheduledStart - 5 * minuteMs, scheduledEnd)
  const customerWaited = waitedContinuously(customerInWindow, graceDeadline, CONSULTATION_ATTENDANCE_POLICY.claimantWaitMinutes * minuteMs)
  const tailorWaited = waitedContinuously(tailorInWindow, graceDeadline, CONSULTATION_ATTENDANCE_POLICY.claimantWaitMinutes * minuteMs)
  const overlap = overlapSeconds(customerInWindow, tailorInWindow)
  const attended = overlap >= CONSULTATION_ATTENDANCE_POLICY.attendedOverlapMinutes * 60
  const customerLateVisit = customer.some((interval) => interval.start > claimWindowEnd)
  const tailorLateVisit = tailor.some((interval) => interval.start > claimWindowEnd)

  let outcome: ConsultationAttendanceOutcome
  if (!input.providerEvidenceComplete) outcome = 'INSUFFICIENT_EVIDENCE'
  else if (attended) outcome = 'ATTENDED'
  else if (evaluatedAt < claimWindowEnd) outcome = 'PENDING_WINDOW'
  else if (tailorWaited && customerInWindow.every((interval) => interval.start > claimWindowEnd)) outcome = 'CUSTOMER_NO_SHOW_ELIGIBLE'
  else if (customerWaited && tailorInWindow.every((interval) => interval.start > claimWindowEnd)) outcome = 'TAILOR_NO_SHOW_ELIGIBLE'
  else if (customerInWindow.length > 0 || tailorInWindow.length > 0) outcome = 'CONNECTION_OR_SCHEDULING_ISSUE'
  else outcome = 'INSUFFICIENT_EVIDENCE'

  return {
    outcome,
    customerVerifiedSeconds: intervalSeconds(customerInWindow),
    tailorVerifiedSeconds: intervalSeconds(tailorInWindow),
    verifiedOverlapSeconds: overlap,
    customerWaitedThroughDeadline: customerWaited,
    tailorWaitedThroughDeadline: tailorWaited,
    customerLateVisit,
    tailorLateVisit,
    providerEvidenceComplete: input.providerEvidenceComplete,
  }
}

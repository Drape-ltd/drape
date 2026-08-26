import {
  CONSULTATION_ATTENDANCE_POLICY,
  CONSULTATION_POLICY_VERSION,
  consultationAttendanceEvidenceCopy,
  consultationAttendanceResolutionCopy,
  consultationOrderListState,
  consultationRequestExpiresAt,
  deriveConsultationTerminalAction,
  deriveConsultationCancellation,
  evaluateConsultationAttendance,
  formatConsultationPolicy,
  resolveConsultationCallType,
  shouldOpenQuotePreparationAfterConsultation,
  validateConsultationPolicy,
} from '../src/consultations'

const start = '2026-08-01T15:00:00.000Z'
const end = '2026-08-01T15:30:00.000Z'
const at = (minutes: number) => new Date(new Date(start).getTime() + minutes * 60_000).toISOString()

describe('consultation commercial policy', () => {
  it('reopens quote preparation at appointment end without waiting for fee settlement', () => {
    expect(shouldOpenQuotePreparationAfterConsultation({
      scheduledEndAt: end,
      now: end,
    })).toBe(true)
    expect(shouldOpenQuotePreparationAfterConsultation({
      scheduledEndAt: end,
      now: at(29),
    })).toBe(false)
  })

  it('does not let a reschedule record hold the order outside quote preparation', () => {
    expect(shouldOpenQuotePreparationAfterConsultation({
      scheduledEndAt: end,
      now: at(60),
    })).toBe(true)
  })

  it('requires a positive amount and currency only for paid consultations', () => {
    expect(validateConsultationPolicy({
      version: CONSULTATION_POLICY_VERSION,
      mode: 'PAID',
      requirement: 'OPTIONAL',
      feeAmount: 2_500,
      currency: 'USD',
      durationMinutes: 30,
      callType: 'VIDEO',
      feeCreditable: true,
    })).toEqual({ ok: true })

    expect(validateConsultationPolicy({
      version: CONSULTATION_POLICY_VERSION,
      mode: 'FREE',
      requirement: 'OPTIONAL',
      feeAmount: 2_500,
      currency: 'USD',
      durationMinutes: 30,
      callType: 'VIDEO',
      feeCreditable: false,
    })).toEqual({ ok: false, error: 'Only paid consultations can have a fee.' })
  })

  it('discloses creditability without exposing raw enum values', () => {
    expect(formatConsultationPolicy({
      version: CONSULTATION_POLICY_VERSION,
      mode: 'PAID',
      requirement: 'REQUIRED',
      feeAmount: 2_500,
      currency: 'USD',
      durationMinutes: 30,
      callType: 'VIDEO',
      feeCreditable: true,
    })).toBe('Required paid 30-minute consultation; credited toward an accepted order.')
  })

  it('requires a concrete choice only when the tailor supports both call types', () => {
    expect(resolveConsultationCallType('AUDIO', 'VIDEO')).toBe('AUDIO')
    expect(resolveConsultationCallType('VIDEO', 'AUDIO')).toBe('VIDEO')
    expect(resolveConsultationCallType('AUDIO_OR_VIDEO', null)).toBeNull()
    expect(resolveConsultationCallType('AUDIO_OR_VIDEO', 'AUDIO')).toBe('AUDIO')
  })

  it('expires an unanswered consultation request after 48 hours', () => {
    expect(consultationRequestExpiresAt('2026-08-14T12:00:00.000Z'))
      .toBe('2026-08-16T12:00:00.000Z')
  })

  it('makes early customer and tailor cancellations full refunds', () => {
    expect(deriveConsultationCancellation({
      actorRole: 'CUSTOMER', scheduledStartAt: start, cancelledAt: at(-25 * 60), feeAmount: 5_000,
    })).toMatchObject({ outcome: 'CUSTOMER_FULL_REFUND', refundAmount: 5_000, tailorEarnedAmount: 0 })
    expect(deriveConsultationCancellation({
      actorRole: 'TAILOR', scheduledStartAt: start, cancelledAt: at(-1), feeAmount: 5_000,
    })).toMatchObject({ outcome: 'TAILOR_FULL_REFUND', refundAmount: 5_000, tailorEarnedAmount: 0 })
  })

  it('splits a late customer cancellation and routes post-start claims to review', () => {
    expect(deriveConsultationCancellation({
      actorRole: 'CUSTOMER', scheduledStartAt: start, cancelledAt: at(-60), feeAmount: 5_001,
    })).toMatchObject({ outcome: 'CUSTOMER_PARTIAL_REFUND', refundAmount: 2_500, tailorEarnedAmount: 2_501 })
    expect(deriveConsultationCancellation({
      actorRole: 'CUSTOMER', scheduledStartAt: start, cancelledAt: at(1), feeAmount: 5_000,
    })).toMatchObject({ outcome: 'REVIEW_REQUIRED', requiresReview: true })
  })
})

describe('consultation attendance evidence', () => {
  it('settles deterministic terminal outcomes without treating a room as attendance', () => {
    expect(deriveConsultationTerminalAction({
      feeMode: 'PAID', paymentStatus: 'PAID', attendanceOutcome: 'INSUFFICIENT_EVIDENCE',
      customerVerifiedSeconds: 0, tailorVerifiedSeconds: 0,
    })).toBe('REFUND_CUSTOMER')
    expect(deriveConsultationTerminalAction({
      feeMode: 'FREE', attendanceOutcome: 'INSUFFICIENT_EVIDENCE',
      customerVerifiedSeconds: 0, tailorVerifiedSeconds: 0,
    })).toBe('CLOSE_FREE_NO_ACTIVITY')
    expect(deriveConsultationTerminalAction({
      feeMode: 'PAID', paymentStatus: 'PAID', attendanceOutcome: 'CUSTOMER_NO_SHOW_ELIGIBLE',
      customerVerifiedSeconds: 0, tailorVerifiedSeconds: 900,
    })).toBe('RELEASE_TAILOR_EARNING')
    expect(deriveConsultationTerminalAction({
      feeMode: 'PAID', paymentStatus: 'PAID', attendanceOutcome: 'TAILOR_NO_SHOW_ELIGIBLE',
      customerVerifiedSeconds: 900, tailorVerifiedSeconds: 0,
    })).toBe('REFUND_CUSTOMER')
    expect(deriveConsultationTerminalAction({
      feeMode: 'PAID', paymentStatus: 'PAID', attendanceOutcome: 'ATTENDED',
      customerVerifiedSeconds: 500, tailorVerifiedSeconds: 500,
    })).toBe('RELEASE_TAILOR_EARNING')
    expect(deriveConsultationTerminalAction({
      feeMode: 'FREE', attendanceOutcome: 'ATTENDED',
      customerVerifiedSeconds: 500, tailorVerifiedSeconds: 500,
    })).toBe('COMPLETE_FREE')
  })

  it('routes conflicting activity or an open report to Ops', () => {
    expect(deriveConsultationTerminalAction({
      feeMode: 'PAID', paymentStatus: 'PAID', attendanceOutcome: 'CONNECTION_OR_SCHEDULING_ISSUE',
      customerVerifiedSeconds: 30, tailorVerifiedSeconds: 20,
    })).toBe('OPS_REVIEW')
    expect(deriveConsultationTerminalAction({
      feeMode: 'FREE', attendanceOutcome: 'ATTENDED', customerVerifiedSeconds: 500,
      tailorVerifiedSeconds: 500, hasOpenReview: true,
    })).toBe('OPS_REVIEW')
  })

  it('shows the reporter and counterpart their correct current list state', () => {
    const review = {
      status: 'COUNTERPARTY_REVIEW',
      reportedByRole: 'CUSTOMER' as const,
      resolutionCode: null,
    }
    expect(consultationOrderListState({ actorRole: 'CUSTOMER', review })).toEqual({
      label: 'Attendance report sent',
      needsAction: false,
    })
    expect(consultationOrderListState({ actorRole: 'TAILOR', review })).toEqual({
      label: 'Attendance response needed',
      needsAction: true,
    })
  })

  it('keeps a resolved attendance reschedule from blocking quote preparation', () => {
    expect(consultationOrderListState({
      actorRole: 'TAILOR',
      review: { status: 'RESOLVED', reportedByRole: 'CUSTOMER', resolutionCode: 'RESCHEDULE_REQUIRED' },
    })).toEqual({ label: 'Quote ready', needsAction: false })
  })

  it('keeps refund and earning outcomes visible without exposing raw decision codes', () => {
    expect(consultationOrderListState({
      actorRole: 'CUSTOMER',
      review: { status: 'RESOLVED', reportedByRole: 'CUSTOMER', resolutionCode: 'CUSTOMER_REFUND_APPROVED' },
    })).toEqual({ label: 'Consultation refund processing', needsAction: false })
    expect(consultationAttendanceResolutionCopy('TAILOR_EARNING_VERIFIED')).toMatchObject({
      title: 'Tailor attendance verified',
      status: 'Earning processing',
    })
  })

  it('uses plain language instead of exposing evidence enums', () => {
    expect(consultationAttendanceEvidenceCopy('INSUFFICIENT_EVIDENCE')).toEqual({
      title: 'Call activity could not be verified',
      detail: 'There was not enough call activity to confirm attendance. The other person has been asked to respond.',
    })
    expect(consultationAttendanceEvidenceCopy('UNKNOWN')).toMatchObject({ title: 'Call activity needs review' })
  })

  it('requires five verified minutes of overlap for attendance', () => {
    expect(evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(20),
      providerEvidenceComplete: true,
      customerIntervals: [{ joinedAt: at(0), leftAt: at(8) }],
      tailorIntervals: [{ joinedAt: at(2), leftAt: at(7) }],
    }).outcome).toBe('ATTENDED')
  })

  it('confirms five minutes of completed overlap without waiting for the no-show deadline', () => {
    expect(evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(8),
      providerEvidenceComplete: true,
      customerIntervals: [{ joinedAt: at(0), leftAt: at(6) }],
      tailorIntervals: [{ joinedAt: at(0), leftAt: at(6) }],
    }).outcome).toBe('ATTENDED')
  })

  it('does not combine disconnected overlap into five continuous minutes', () => {
    expect(evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(20),
      providerEvidenceComplete: true,
      customerIntervals: [{ joinedAt: at(0), leftAt: at(3) }, { joinedAt: at(7), leftAt: at(10) }],
      tailorIntervals: [{ joinedAt: at(0), leftAt: at(3) }, { joinedAt: at(7), leftAt: at(10) }],
    }).outcome).toBe('CONNECTION_OR_SCHEDULING_ISSUE')
  })

  it('makes a customer no-show eligible only when the tailor waited continuously', () => {
    const result = evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(20),
      providerEvidenceComplete: true,
      customerIntervals: [],
      tailorIntervals: [{ joinedAt: at(1), leftAt: at(16) }],
    })
    expect(result.outcome).toBe('CUSTOMER_NO_SHOW_ELIGIBLE')
    expect(result.tailorWaitedThroughDeadline).toBe(true)
  })

  it('does not mistake opening the room briefly for the required wait', () => {
    expect(evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(20),
      providerEvidenceComplete: true,
      customerIntervals: [],
      tailorIntervals: [{ joinedAt: at(0), leftAt: at(2) }],
    }).outcome).toBe('CONNECTION_OR_SCHEDULING_ISSUE')
  })

  it('records a later visit but does not erase the earlier eligible absence', () => {
    const result = evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(25),
      providerEvidenceComplete: true,
      customerIntervals: [{ joinedAt: at(20), leftAt: at(22) }],
      tailorIntervals: [{ joinedAt: at(0), leftAt: at(15) }],
    })
    expect(result.outcome).toBe('CUSTOMER_NO_SHOW_ELIGIBLE')
    expect(result.customerLateVisit).toBe(true)
  })

  it('routes incomplete provider evidence to review', () => {
    expect(evaluateConsultationAttendance({
      scheduledStartAt: start,
      scheduledEndAt: end,
      evaluatedAt: at(30),
      providerEvidenceComplete: false,
      customerIntervals: [],
      tailorIntervals: [{ joinedAt: at(0), leftAt: at(CONSULTATION_ATTENDANCE_POLICY.claimantWaitMinutes) }],
    }).outcome).toBe('INSUFFICIENT_EVIDENCE')
  })
})

import {
  firstPreflightFailure,
  preflightErrorPayload,
  runPreflight,
  type PreflightCheck,
} from '../src/preflight'

describe('runPreflight', () => {
  const checks: PreflightCheck[] = [
    {
      name: 'user_authenticated',
      condition: true,
      errorCode: 'AUTH_REQUIRED',
      message: 'User must be authenticated.',
      severity: 'BLOCKING',
    },
    {
      name: 'payout_account_verified',
      condition: false,
      errorCode: 'TAILOR_NO_PAYOUT_ACCOUNT',
      message: 'Tailor has not set up a payout account.',
      field: 'payout_account_verified',
      severity: 'BLOCKING',
    },
    {
      name: 'push_token_present',
      condition: false,
      errorCode: 'PUSH_TOKEN_MISSING',
      message: 'Push notification will be skipped.',
      severity: 'WARNING',
    },
  ]

  it('separates blocking failures from warnings', () => {
    const result = runPreflight(checks)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.errorCode).toBe('TAILOR_NO_PAYOUT_ACCOUNT')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.errorCode).toBe('PUSH_TOKEN_MISSING')
  })

  it('passes when only warnings fail', () => {
    const result = runPreflight([
      checks[0]!,
      { ...checks[2]!, condition: false },
    ])

    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('builds a human-readable payload for the first blocking failure', () => {
    const result = runPreflight(checks)
    const failure = firstPreflightFailure(result)

    expect(failure).not.toBeNull()
    expect(preflightErrorPayload(failure!, result.warnings)).toEqual({
      error: 'PREFLIGHT_FAILED',
      reason: 'TAILOR_NO_PAYOUT_ACCOUNT',
      message: 'Tailor has not set up a payout account.',
      field: 'payout_account_verified',
      check: 'payout_account_verified',
      warnings: [
        {
          reason: 'PUSH_TOKEN_MISSING',
          message: 'Push notification will be skipped.',
          field: undefined,
          check: 'push_token_present',
        },
      ],
    })
  })
})
